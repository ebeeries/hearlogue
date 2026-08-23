# How HEARLOGUE reads a listening history

This document defines every term the app uses and every threshold it applies.
The intent is that no number in the interface is unexplained, and that nothing is
claimed which the data cannot actually support.

Every constant named here lives in
[`src/shared/constants/analytics.ts`](../src/shared/constants/analytics.ts), and
the mathematics lives in
[`src/main/analytics/scoring.ts`](../src/main/analytics/scoring.ts), which is
covered by unit tests.

---

## The one thing the data does not contain

**Spotify's export does not include track durations.**

That single absence shapes everything below. Without a duration there is no
honest way to say "you listened to 84% of this song", so HEARLOGUE never says
it. There are no completion percentages anywhere in the app.

What the export *does* give, per playback event, is when it happened, what it
was, and how many milliseconds were played. From those, the app reasons about:

- **how often** something was played,
- **how long** was spent on it,
- **how densely** those plays were packed in time,
- **how it ended** — did playback finish, or was it skipped,
- **how long ago** it stopped.

Those five things are enough for everything HEARLOGUE claims, and each figure it
shows is a count of real events inside a real date range.

---

## Playback definitions

### Qualifying Play

> `ms_played >= 30,000`

A play only counts once it has run for at least thirty seconds. This matches the
threshold Spotify itself uses for a "stream", and it separates a real listen from
a track that flashed past while someone was skipping through a playlist.

Adjustable in Settings → Analytics (5 s to 60 s). Changing it invalidates every
derived figure and triggers a rebuild.

### Short Play

> `ms_played < 30,000`

Anything below the qualifying threshold. Counted and shown, never mixed into play
totals.

### Skip

> `skipped = 1` **or** (`ms_played < 20,000` **and** `reason_end` is `fwdbtn` or `backbtn`)

Two signals, because neither alone is sufficient. Spotify's own `skipped` flag is
authoritative when present but is absent from large stretches of older exports;
the behavioural pattern — moving on within the first twenty seconds by pressing
next or previous — catches the rest.

Note what is *not* a skip: pressing next at the four-minute mark of a five-minute
song. That is a finished listen, and counting it against the track would misread
the relationship.

### Dormant

> No qualifying play for at least 365 days.

Adjustable in Settings (180 days to 20 years).

---

## Lost Favorite Score

The score, 0–100, answers one question: *how much does this look like a song you
genuinely loved and then stopped playing?*

### Gates

A track is disqualified outright — score 0, not shown — unless **all** of:

| Gate | Value | Why |
| --- | --- | --- |
| Qualifying plays | ≥ 8 | A track played twice in 2014 is not a lost favorite; it is a track you never liked. |
| Listening time | ≥ 20 minutes | Guards against eight accidental thirty-second plays. |
| Days since last play | ≥ dormancy threshold (365 default) | It has to actually be gone. |
| Share of plays in the last 180 days | ≤ 5% | A track that has quietly returned to rotation is not lost, however long the earlier gap was. |

The last gate matters more than it looks. Without it the list fills with songs
you rediscovered last month — technically dormant for years, but not remotely
lost.

### Dimensions

Each dimension is normalised to 0–1 and weighted:

| Dimension | Weight | What it measures |
| --- | --- | --- |
| **Historical Affinity** | 0.30 | How much this track was played and listened to, on a log curve against the library. |
| **Dormancy** | 0.26 | How long the silence has been, on a saturating curve. |
| **Peak Intensity** | 0.17 | The densest 90-day stretch, both in absolute plays and as a share of the whole relationship. |
| **Engagement Quality** | 0.13 | 1 − skip rate, plus the ratio of qualifying to total plays. |
| **Historical Consistency** | 0.14 | How many distinct months and days it appeared across — a long relationship, not one weekend. |

`score = 100 × Σ (weight × dimension)`

The weights sum to exactly 1, so a hypothetical perfect track reaches 100. In
practice the top of a real archive sits in the high eighties or low nineties.

### Curve shapes

Two shapes recur, and both are deliberate:

**Log compression** — every count-like input passes through
`logScale(value, lo, hi)`. Play counts are heavily long-tailed: the difference
between 5 and 20 plays says far more about attachment than the difference between
300 and 315. A linear scale would let one obsessive track flatten everything
else.

**Saturating dormancy** — `dormancyCurve(days)` rises quickly and then flattens,
reaching 1 at eight years. Each additional day of silence counts for less than
the one before it, because the emotional distance between six months and two
years is large, and between eight and nine years is not.

### Diversity

A page of Lost Favorites caps each artist at two entries before showing anyone
else's. Without it, a listener who spent 2018 inside one record sees that record
and nothing else — the opposite of rediscovery. Entries beyond the cap are held
back and appended, never dropped, and the whole behaviour can be switched off.

---

## Obsessions

An obsession is a short stretch where one thing took over.

For every track with ≥ 20 qualifying plays (artists ≥ 60, albums ≥ 30), the app
slides a window over that entity's play timestamps and records:

| Figure | Meaning |
| --- | --- |
| **Peak window** | The densest 30 days, with its exact start and end dates. |
| **Window plays** | How many qualifying plays fell inside it. |
| **Share** | Window plays ÷ lifetime plays. |
| **Plays per day** | Density inside the window. |
| **Plays after** | Everything that happened once the window closed. |
| **Peak week** | The densest 7 days. |
| **Days to 50 / 100** | How long from the first play to the 50th and 100th. |
| **Longest run** | Consecutive months holding at least a fifth of the peak month's plays. |

### Intensity

```
intensity = 100 × (0.42 × share + 0.36 × logScale(windowPlays, 5, 150) + 0.22 × density)
```

Three things a listener would actually recognise: what share of the whole
relationship happened in that window, how many plays it was in absolute terms,
and how packed they were.

### Sections

- **Songs you absolutely destroyed** — highest window plays.
- **Burned bright, then gone** — share ≥ 60% and ≤ 12% of plays afterwards.
- **Artist binges** / **Album addictions** — the same analysis at those levels.
- **Fastest to 100 plays** — shortest time from first play to the hundredth.
- **Most intense week** — highest 7-day count.
- **Longest obsessions** — longest sustained monthly run.

A section with nothing in it is omitted rather than shown empty. If your history
contains no true one-hit obsession, that is a real answer about how you listen.

---

## Graveyard

The Graveyard is not "things you have not played lately". It is things that were
genuinely significant and then stopped.

An entity qualifies only if **all** of:

| Gate | Track | Artist | Album |
| --- | --- | --- | --- |
| Historical qualifying plays | ≥ 25 | ≥ 60 | ≥ 30 |
| Days since last play | ≥ 730 | ≥ 730 | ≥ 730 |
| Recent plays (last 180 days) | ≤ 2 | ≤ 2 | ≤ 2 |

### Ranking

```
score = 100 × (0.46 × magnitude + 0.36 × silence + 0.18 × prominence)
```

- **magnitude** — log-scaled historical plays.
- **silence** — the dormancy curve applied to days missing.
- **prominence** — where the entity ranked among *everything* you listened to
  during its own peak year.

Prominence is what separates a former favourite from a former curiosity. An
artist who was your number one in 2017 and has been silent since carries more
weight than a long-tail artist with the same total plays.

---

## Era segmentation

A listening life does not change month to month; it changes in stretches. Eras
find those stretches.

### Method

1. **Represent each month** as a sparse vector over artists, weighted by the
   square root of listening time, keeping the top 40 artists. Square-root
   weighting stops one enormous month swamping the direction of the vector.
2. **Compare by direction, not magnitude.** Cosine similarity means a quiet month
   and a heavy month spent on the same artists count as the same era.
3. **Score every boundary** against a *window* of three months either side rather
   than the single adjacent month. One unusual week does not start an era.
4. **Mark a change** where the distance exceeds 0.42 *and* is a local maximum, so
   one shift produces one boundary rather than three.
5. **Fold short segments** (under three months) into whichever neighbour they
   resemble more — unless the shift into them was unusually strong (≥ 0.68), in
   which case a brief era has earned its place.
6. **Merge neighbours** that turn out to be more than 78% similar anyway.
7. **Trim quiet edges** — months with fewer than 10 plays are gaps, not eras.

Eras require at least six active months in total. Below that, the app says so
rather than inventing structure.

### Naming

Eras are named after **who was actually being listened to**, because the export
contains no genre data and inventing one would be a fabrication.

- One dominant artist (≥ 24% of the era's listening) → *The Nujabes Period*
- Two comparable leaders → *The Kendrick / Travis Era*
- Nothing dominant → *The 2016–2017 Stretch*

The suffix reflects length: **Period** (≤ 5 months), **Era** (6–17), **Years**
(18+). A leading article in an artist's name is dropped so "The Harbour Lights"
does not become "The The Harbour Lights Years".

You can rename any era. The generated name is kept alongside and can be restored.

---

## Comebacks

A comeback is the longest silence in a track's history that was followed by a
*real* return, not by one stray play:

- gap ≥ 180 days, **and**
- ≥ 5 qualifying plays within 90 days of coming back.

Both halves are needed. A single accidental play after four years is not a
comeback, and the app does not report it as one.

---

## Sessions

The export has no notion of a session, so one is derived: a run of playback
separated from the next by more than **30 minutes** of silence (adjustable, 10 to
120 minutes).

Each session records its duration, listening time, event count, unique tracks and
artists, dominant artist, the most-repeated track, and a **diversity** figure —
the Shannon entropy of its artist distribution, normalised to 0–1. That is what
tells one album played end to end (near 0) from an evening wandering across
twenty artists (near 1).

Sessions partition the archive exactly: every event belongs to one, and no two
overlap. There is a test that asserts it.

---

## Album breadth

Two figures, shown together, answer "did I live inside this record or replay the
single?":

- **Breadth** — the share of the album's tracks that received at least three
  qualifying plays.
- **Top-three concentration** — how much of the album's listening went to its
  three biggest tracks.

---

## Listening clock

Playback timestamps are UTC, but a listening life is lived locally: "late-night
listening" means midnight where you were, not in Greenwich. Local calendar parts
(date, month, hour, weekday) are therefore computed **at import time** and stored
alongside the epoch timestamp.

Dayparts: late night 00–05, morning 05–12, afternoon 12–17, evening 17–22,
night 22–24.

---

## Idempotent imports

Every event gets a 64-bit fingerprint derived from the fields Spotify emits
identically every time it exports the same event:

```
hash64(timestamp | artistKey | trackKey | msPlayed | platform | reasonEnd)
```

`msPlayed` and `reasonEnd` are included because two genuinely distinct plays of
one track can share a timestamp truncated to the second — but essentially never
share the exact dwell time as well.

A `UNIQUE` index on that column makes duplicate suppression a property of the
schema rather than of application logic. `INSERT OR IGNORE` then reports exactly
how many rows were new. Whole files are also hashed, so a re-import of an
unchanged file is skipped before it costs a JSON parse.

Names are folded before hashing (`nameKey`): case, whitespace, curly quotes,
dashes and diacritics are normalised, because Spotify has spelled the same song
inconsistently across years. Remaster and version suffixes are deliberately
**kept** — someone who played the 2011 remaster has a different history from
someone who played the original.

---

## How it stays fast

A million-event archive stays responsive because almost nothing is computed at
read time.

**Aggregates in SQL.** Anything expressible as a `GROUP BY` — per-track, per-
artist, per-album, per-month, per-day, per-hour, per-year totals — is built by
SQLite into derived tables during the analytics pass.

**Sequences in typed arrays.** Questions that need order — "the densest 30 days",
"the longest silence", "days to the hundredth play" — cannot be expressed as a
group-by. The whole event stream is loaded once into typed arrays (about 25 MB
per million events), grouped into a compressed-sparse-row index, and every
sequential pass then walks memory linearly. A million JavaScript objects would
have spent the run in the garbage collector.

**Bulk-load index deferral.** On a first import into an empty archive the seven
secondary indexes on `playback_events` are dropped, the rows written, and the
indexes rebuilt in one pass — worth roughly a fifth of total import time. The
unique fingerprint index stays live throughout, because it is what makes the
import idempotent. If the app is interrupted mid-import, opening the database
rebuilds any missing index, so an interrupted run can never leave a permanently
slow archive.

**Derived, not recomputed.** Where a page needs a figure that would otherwise
scan an entity's whole history — an artist's late-night share, or their yearly
totals — that figure is computed once during the analytics pass and read back
from a stats table. This is the difference between an artist page taking 363 ms
and taking 6 ms.

### Measured

1,036,666 events across 512 MB of JSON:

| | |
| --- | --- |
| Full import (parse, write, analyse) | ~113 s |
| Archive home / Lost Favorites / Graveyard / Calendar / Search | 1–12 ms |
| Artist detail | ~6 ms |
| Track detail | ~60 ms |
| Rewind (a whole year) | ~115 ms |

Reproduce with:

```bash
HEARLOGUE_PERF=1 npx vitest run tests/integration/performance.test.ts
```

---

## Rebuilding

Derived analytics are versioned. When the engine version changes, or when any of
the four analytics settings change (qualifying play, session gap, private
sessions, dormancy), the archive is marked stale and rebuilt — automatically by
default, or on demand from Settings → Analytics.

Rebuilding only touches derived tables. Your imported events, tags, notes and
collections are never affected.
