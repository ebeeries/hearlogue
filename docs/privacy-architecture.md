# Privacy architecture

> Your listening history never leaves your computer.

That sentence appears in the app, and this document is the technical account of
why it is true — including what the code does to make it hard to break by
accident later.

---

## Does the app use the network?

**No.** Not for analytics, not for telemetry, not for crash reporting, not for
update checks, not for album artwork.

This is enforced rather than merely intended:

1. **A request blocker.** `session.defaultSession.webRequest.onBeforeRequest`
   cancels every request that is not `file:`, `data:`, `blob:` or `devtools:`
   (plus the local Vite dev server, in development only). A stray `fetch` from a
   dependency does not silently succeed — it is cancelled and logged.
2. **A content security policy.** The packaged app runs under
   `default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'`.
   There is no origin it is permitted to contact.
3. **No remote assets.** Fonts are resolved from the fonts already on the system.
   Cover art is generated in-process from a hash of the name — which is why the
   art is deterministic and why the app has nothing to fetch.
4. **Permissions denied.** Every Chromium permission request is refused
   unconditionally.

The only way HEARLOGUE reaches the outside world is when *you* click "Open in
Spotify", which hands a URL to your browser through the operating system. That
path is covered below.

There is an end-to-end test asserting the renderer cannot see Node, cannot see
`ipcRenderer`, and cannot open an off-allowlist URL.

---

## What is imported

You give HEARLOGUE the export Spotify sends you. It reads the streaming-history
JSON files inside and ignores everything else — playlists, your library, search
queries, inferences, payment records, account details. Those files are never
opened.

Recognised shapes:

- `Streaming_History_Audio_*.json` / `endsong_*.json` — the extended export.
- `StreamingHistory*.json` — the older twelve-month export.

Podcast and audiobook rows are recognised and skipped; HEARLOGUE is a music
archive.

---

## What is stored

Per playback event, exactly this:

| Field | Why it is kept |
| --- | --- |
| Timestamp (epoch ms) | When it happened. |
| Local date, month, year, hour, weekday | Derived at import so day/hour analytics are correct in your timezone and fast to query. |
| Track, artist, album | What it was. |
| Spotify track URI | So "Open in Spotify" can work. |
| Milliseconds played | The only measure of engagement the export provides. |
| Platform **family** | See below. |
| Country code | Two letters, e.g. `GB`. |
| Reason started / reason ended | To tell a finished listen from a skip. |
| Shuffle, skipped, offline flags | Listening behaviour. |
| Private-session flag | So it can be excluded from every figure if you prefer. |
| Fingerprint | A 64-bit hash that makes re-imports idempotent. |

Plus your own layer: tags, per-track favourite/retired flags, notes, era names,
and Smart Collections.

---

## What is discarded

Some Spotify exports contain fields HEARLOGUE has no use for. They are dropped
while the file is being read and are never written to disk:

| Field | Status |
| --- | --- |
| `ip_addr_decrypted` | **Discarded.** |
| `user_agent_decrypted` | **Discarded.** |
| `username` | **Discarded.** |
| `offline_timestamp` | **Discarded.** |
| Any unrecognised field | **Discarded.** |

This is structural, not a filter that could be forgotten: the normalised event
type has no field capable of holding them, so there is no path from the export
into SQL. See
[`src/shared/schemas/spotify.ts`](../src/shared/schemas/spotify.ts) and
[`src/main/import/parsers/normalize.ts`](../src/main/import/parsers/normalize.ts).

An integration test imports records deliberately stuffed with an IP address, a
user agent and a username, then searches the **raw bytes of the database file**
for those values and fails if any is present.

### The platform field, specifically

Spotify records platform strings like:

```
Windows 10 (10.0.19045; x64; AppX)
```

That build number helps identify a machine. HEARLOGUE reduces it at import to one
of nine coarse families — `windows`, `android`, `ios`, `macos`, `linux`, `web`,
`cast`, `partner`, `other` — and stores only that. The original string is never
written.

---

## Where it lives

Everything is under Electron's `userData` directory, never in the application
folder and never in the repository:

```
Windows:  %APPDATA%\HEARLOGUE\
macOS:    ~/Library/Application Support/HEARLOGUE/
Linux:    ~/.config/HEARLOGUE/

  archive/hearlogue.db          your archive (SQLite)
  archive/hearlogue-demo.db     the demo archive
  backups/                      backups you create
  logs/                         local diagnostics
  window-state.json             window geometry
```

The database is a plain SQLite file. Settings → Data → **Show in folder** reveals
it. You can copy it, inspect it with any SQLite tool, or delete it by hand.

It is **not encrypted at rest.** Anyone with access to your user account can read
it, exactly as they could read your documents. If that matters for your threat
model, use full-disk encryption.

### The demo archive

The Demo Archive is a **separate database file**. There is no flag inside a
shared database that could be misread: exploring the demo physically cannot touch
imported history, and leaving the demo is a reconnection to a different file.
Demo content is entirely synthetic — invented artists, invented records.

---

## Process architecture

```
┌──────────────┐                      ┌──────────────┐
│   Renderer   │   contextBridge      │     Main     │
│              │ ───────────────────▶ │              │
│ nodeIntegr.  │   ~90 typed methods  │  SQLite      │
│    = false   │ ◀─────────────────── │  filesystem  │
│ contextIsol. │   validated payloads │  dialogs     │
│    = true    │                      │  shell       │
│ sandbox=true │                      └──────────────┘
└──────────────┘                             │
                                             │ utilityProcess
                                             ▼
                                      ┌──────────────┐
                                      │Import worker │
                                      │ own SQLite   │
                                      │ connection   │
                                      └──────────────┘
```

The renderer has no filesystem access, no Node, and no way to reach a channel
that is not in the bridge. `ipcRenderer` is captured in the preload module scope
and never exposed; there is no generic `invoke` escape hatch. Every payload
crossing the bridge is parsed by a Zod schema in the main process before it
reaches a repository — the renderer is treated as untrusted input.

Additional hardening: `webviewTag: false`, `will-attach-webview` prevented,
`setWindowOpenHandler` denies all, navigation is restricted to the local bundle,
and the packaged build blows the Electron fuses for `RunAsNode`,
`EnableNodeCliInspectArguments` and `EnableNodeOptionsEnvironmentVariable`, with
`OnlyLoadAppFromAsar` on.

---

## Opening Spotify links

The one outbound action. It is deliberately narrow:

1. A `spotify:track:…` URI is converted to an `https://open.spotify.com/…` URL by
   a strict pattern match — anything that does not match exactly is rejected.
2. The URL must parse, must be `https:`, and its **origin must equal** an entry
   in the allowlist. Origin equality, not prefix matching, because a prefix check
   would happily accept `https://open.spotify.com.example.com`.
3. Only then is it handed to the OS shell.

The allowlist is `open.spotify.com`, `www.spotify.com`, `support.spotify.com` and
`accounts.spotify.com`.

Nothing about *your* listening is included: the link contains only the public
Spotify identifier of the track, exactly as if you had searched for it. HEARLOGUE
never logs the URL — only the host, and only when a request is blocked.

---

## Logging

Local log files under `logs/`, rotated at 2 MB with five kept.

**Logged:** application lifecycle, migration versions, import counts and error
codes, database problems, blocked request hosts.

**Never logged:** listening history, track or artist names, note contents, tag
names, IP addresses, file contents, or raw JSON. The logger's `redact` helper
truncates anything unexpectedly large before it reaches disk as a second line of
defence.

Settings → Advanced → **Open logs folder** shows you exactly what has been
written.

---

## Backup and restore

**Backup** uses SQLite's online backup API, so the resulting file is internally
consistent even if written while the app is running. It contains your history,
analytics, tags, notes, eras, collections and settings, plus a manifest recording
the format version, app version, schema version and event count.

You choose where it goes. HEARLOGUE never uploads it anywhere.

**Restore** verifies the manifest and refuses a backup from a newer version of
the app rather than corrupting your archive. Before overwriting, the current
archive is copied aside to `archive/pre-restore-<timestamp>.db`. That copy is
left on disk deliberately — silently deleting someone's only remaining data would
be the worst possible outcome of a recovery flow.

---

## Deleting everything

Settings → Privacy → **Delete Entire Archive**, which requires typing `DELETE` to
confirm.

It removes:

- every imported playback event,
- every derived analytic,
- every tag, note, era name and Smart Collection,
- the search index.

It does **not** touch:

- your original Spotify export files, wherever they are — the app does not even
  remember where they were,
- backups you have created,
- log files.

To remove HEARLOGUE completely, uninstall it and delete the `userData` directory.

---

## Summary

| Question | Answer |
| --- | --- |
| Does it make network requests? | No. Blocked at the session level and by CSP. |
| Does it need a Spotify account? | No. It reads the export file. |
| Is there telemetry? | None. |
| Where is my data? | One SQLite file in your user folder. |
| Is it encrypted? | No. Use full-disk encryption if you need it. |
| Are IP addresses stored? | No — discarded during import, with a test that checks the database bytes. |
| Can I export it? | Yes: CSV, or copy the database file. |
| Can I delete it? | Yes, from Settings, or by deleting the file. |
| Do my notes leave the machine? | No. Same local database as everything else. |
