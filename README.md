# HEARLOGUE

**Your past is still playing.**

**[ebeeries.github.io/hearlogue](https://ebeeries.github.io/hearlogue/)** · [Download for Windows](https://github.com/ebeeries/hearlogue/releases/latest)

HEARLOGUE turns a Spotify Extended Streaming History export into a private,
local-first archive of your musical life — and then helps you find your way back
into it.

It is not a stats dashboard. It is built around the things a listener actually
wonders about: what did I love and stop playing? What was 2019 *like*? What took
over my life for six weeks and then vanished? Which artists did I leave behind?

<p align="center">
  <img src="assets/icon.png" alt="" width="96" height="96" />
</p>

---

## What it does

| Screen | What it answers |
| --- | --- |
| **Archive** | The shape of your whole listening life, plus one thing you had forgotten. |
| **Lost Favorites** | Songs that genuinely mattered and then went quiet, scored 0–100. |
| **Rewind** | Any year or month, as you lived it — including what you loved that year and never heard again. |
| **Eras** | The stretches where your listening actually changed, named after who defined them. |
| **Obsessions** | What took over, how hard, for how long, and what survived it. |
| **Graveyard** | Artists, tracks and albums that were once central and are now gone. |
| **Library** | Your own tags, notes, favourites and Smart Collections. |
| **Calendar** | Every day you listened, as a heatmap, plus your listening clock and sessions. |
| **Search** | Everything, instantly, with filters that go well past a text match. |

Every track, artist and album also has a full detail page with its own timeline,
milestones and records.

---

## Principles

- **Local-first.** Your history is read on your machine and written to a SQLite
  database in your user folder.
- **Offline.** The app makes no network requests at all. It works with the
  network cable pulled out, and there is a test that asserts the renderer cannot
  reach anything but itself.
- **No account, no login, no API.** HEARLOGUE never talks to Spotify. It reads
  the export file Spotify already gives you.
- **No fake precision.** Spotify's export does not contain track durations, so
  the app never claims a completion percentage. It reasons about play counts,
  dwell time and behaviour, and says exactly what it means. See
  [docs/analytics.md](docs/analytics.md).

HEARLOGUE is an independent application. It is not affiliated with, endorsed by,
or connected to Spotify.

---

## Getting your data

1. Open your Spotify account privacy settings in a browser.
2. Request **Extended streaming history** — not the basic export, which only
   covers the last twelve months.
3. Confirm the email Spotify sends.
4. Spotify emails a ZIP file, usually within a few days.
5. Drop that ZIP onto HEARLOGUE's import screen.

The importer accepts a ZIP straight from Spotify, an extracted folder, or loose
JSON files, and understands both the modern `Streaming_History_Audio_*.json`
format and the older `StreamingHistory*.json` one.

Re-importing is safe. Every playback event carries a fingerprint, so importing a
newer export merges only what is genuinely new:

```
124,201 existing plays found
  3,849 new plays imported
      0 duplicates added
```

---

## Running it

Requires Node.js 22+ and npm.

```bash
npm install        # better-sqlite3 ships Node-API prebuilds; no native build step
npm run dev        # start the app with hot reload
```

### All scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the app in development. |
| `npm run typecheck` | TypeScript, strict, across main / preload / renderer / tests. |
| `npm run lint` | ESLint, zero warnings tolerated. |
| `npm run test` | Unit and integration tests (Vitest). |
| `npm run verify` | typecheck + lint + test. |
| `npm run package` | Build the app into `out/` (no installer). |
| `npm run make` | Build the Windows installer and ZIP into `out/make/`. |
| `npm run test:e2e` | End-to-end tests against the built app (run `package` first). |
| `npm run icon` | Regenerate `assets/icon.ico` from code. |

### Extra test modes

```bash
# Capture a screenshot of every screen into tests/e2e/.artifacts/screens
E2E_SCREENSHOTS=1 npx playwright test screenshots

# Regenerate the landing-page screenshots in site/screens (2x, from the real app)
E2E_SITE_SHOTS=1 npx playwright test site-shots

# Import a million synthetic events and assert every screen stays fast
HEARLOGUE_PERF=1 npx vitest run tests/integration/performance.test.ts
```

---

## Architecture

```
src/
  main/                  Electron main process — the only place with disk access
    database/            SQLite: schema, versioned migrations, repositories
    import/              Source resolution, parsing, normalisation, ingestion
      workers/           The import worker (runs in a utilityProcess)
    analytics/           Scoring, eras, obsessions, sessions, graveyard
    services/            Archive lifecycle, import orchestration, demo data
    ipc/                 Typed, Zod-validated IPC handlers
    windows/             Window creation, security posture, menu
  preload/               The contextBridge surface, and its types
  renderer/              React UI — no Node, no filesystem, no network
    components/          Primitives, domain components, charts
    features/            Search palette, share cards, collection builder
    pages/               One file per screen
    i18n/                Every user-facing string (English + Greek)
  shared/                Types, Zod schemas, constants, pure utilities
tests/
  unit/                  Pure logic: parsers, scoring, hashing, rules
  integration/           Real SQLite: migrations, import, analytics, queries
  e2e/                   The real app, driven over CDP
```

### Process model

The **main process** owns the database and the filesystem. The **renderer** owns
nothing: it has `nodeIntegration: false`, `contextIsolation: true`, `sandbox:
true`, and can only reach the narrow typed object the preload script exposes.
Imports run in a separate **utility process** with its own SQLite connection, so
a million-event import never blocks the window.

```
┌──────────┐   contextBridge    ┌───────────┐   utilityProcess   ┌────────────┐
│ Renderer │ ─────────────────▶ │   Main    │ ─────────────────▶ │   Import   │
│  (React) │ ◀───────────────── │  (SQLite) │ ◀───────────────── │   worker   │
└──────────┘   typed, validated └───────────┘   progress msgs    └────────────┘
                                      │                                 │
                                      └──────── WAL, one writer ────────┘
```

### Performance

Measured on a real import of **1,036,666 events** across 12 files (512 MB of
JSON), on a mid-range Windows laptop:

| | |
| --- | --- |
| Full import — parse, write, analyse | ~113 s |
| Archive home, Lost Favorites, Graveyard, Calendar, Search | 1–12 ms |
| Track detail / artist detail | ~60 ms / ~6 ms |
| Rewind (a full year) | ~115 ms |

Once analytics are built, navigation is instant. The techniques that get there —
columnar analysis passes, derived stat tables, and dropping secondary indexes for
a bulk load — are documented in [docs/analytics.md](docs/analytics.md).

---

## Documentation

- **[docs/analytics.md](docs/analytics.md)** — every definition and threshold:
  qualifying play, Lost Favorite Score, obsessions, graveyard, era segmentation,
  comebacks, sessions.
- **[docs/privacy-architecture.md](docs/privacy-architecture.md)** — what is
  imported, what is stored, what is discarded, where it lives, how deletion and
  backup work, and why the app makes no network requests.

---

## Data, backup and deletion

Everything lives under Electron's `userData` directory:

```
%APPDATA%/HEARLOGUE/
  archive/hearlogue.db          your archive
  archive/hearlogue-demo.db     the demo archive, kept entirely separate
  backups/                      backups you create
  logs/                         local diagnostics (never your listening data)
  window-state.json             window size and position
```

**Back up** from Settings → Data. A backup is a single file containing your
history, analytics, tags, notes, eras and collections.

**Delete** from Settings → Privacy. This removes the archive and everything
derived from it. Your original Spotify export files are never touched.

---

## Licence

MIT. HEARLOGUE is built on Electron, React, SQLite, better-sqlite3, Recharts,
Zod, Zustand, date-fns and Lucide, each under its own permissive licence.
