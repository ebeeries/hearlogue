import type { NormalizedEvent } from '@shared/schemas/spotify';
import { DEMO_ARTISTS, DEMO_PHASES, type DemoArtist, type DemoScene } from './demo-catalog';
import { monthRange, startOfMonthTs, MS_PER_DAY, MS_PER_MINUTE } from '@shared/utils/time';

/**
 * Generates a synthetic listening history.
 *
 * The demo has to be convincing enough that every screen in the app has
 * something real to show — eras that actually separate, obsessions that actually
 * spike, sessions that hold together, and favourites that were genuinely
 * abandoned. A uniform random stream would produce none of that, so the
 * generator simulates a life instead:
 *
 *  - listening happens in **sittings**: a run of tracks played back to back,
 *    which is what makes sessions, day details and the listening clock real;
 *  - phases with different scene mixes, which become eras;
 *  - occasional fixations on one track that burn out, which become obsessions;
 *  - artists dropped for good, which populate the graveyard;
 *  - realistic skipping, album runs, repeats and offline listening.
 *
 * It is fully deterministic given a seed, which is what lets the integration
 * tests assert on real numbers.
 */

/** mulberry32 — small, fast, and good enough for plausible listening behaviour. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TrackRef {
  artist: DemoArtist;
  album: string;
  title: string;
  uri: string;
  /** Index within its album, so a sitting can play a record in order. */
  albumIndex: number;
  albumTracks: number;
}

interface CatalogIndex {
  byScene: Map<DemoScene, TrackRef[]>;
  byAlbum: Map<string, TrackRef[]>;
}

function buildTrackIndex(): CatalogIndex {
  const byScene = new Map<DemoScene, TrackRef[]>();
  const byAlbum = new Map<string, TrackRef[]>();
  let counter = 0;

  for (const artist of DEMO_ARTISTS) {
    for (const album of artist.albums) {
      const albumKey = `${artist.name}::${album.title}`;
      const refs: TrackRef[] = [];
      album.tracks.forEach((title, index) => {
        counter += 1;
        refs.push({
          artist,
          album: album.title,
          title,
          uri: `spotify:track:demo${String(counter).padStart(18, '0')}`,
          albumIndex: index,
          albumTracks: album.tracks.length,
        });
      });
      byAlbum.set(albumKey, refs);
      const scene = artist.scene as DemoScene;
      const bucket = byScene.get(scene);
      if (bucket) bucket.push(...refs);
      else byScene.set(scene, [...refs]);
    }
  }

  return { byScene, byAlbum };
}

function pickWeighted<T>(items: T[], weights: number[], random: () => number): T {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return items[Math.floor(random() * items.length)];
  let roll = random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Hour-of-day weights for when a sitting *starts*. Evening peak, a real
 * late-night tail, a commute bump — the shape the Listening Clock reveals.
 */
const START_HOUR_WEIGHTS = [
  0.8, 0.45, 0.25, 0.15, 0.12, 0.3, 1.0, 2.2, 2.6, 1.9, 1.5, 1.4, 1.7, 1.8, 1.7, 1.8, 2.3, 2.9,
  3.1, 3.0, 3.2, 3.4, 2.6, 1.5,
];

const PLATFORMS = ['windows', 'android', 'ios', 'web'] as const;

export interface DemoOptions {
  seed?: number;
  /** Inclusive month bounds; defaults to the phase table's full span. */
  fromYm?: string;
  toYm?: string;
  /** Roughly how many playback events per active month. */
  intensity?: number;
  /** Reference "now" so the demo always ends just before today. */
  now?: number;
}

export interface DemoDataset {
  events: NormalizedEvent[];
  fromTs: number;
  toTs: number;
}

export function generateDemoEvents(options: DemoOptions = {}): DemoDataset {
  const random = createRandom(options.seed ?? 20260823);
  const { byScene, byAlbum } = buildTrackIndex();
  const now = options.now ?? Date.now();

  const fromYm = options.fromYm ?? DEMO_PHASES[0].fromYm;
  const toYm = options.toYm ?? DEMO_PHASES[DEMO_PHASES.length - 1].toYm;
  const baseIntensity = options.intensity ?? 620;

  const months = monthRange(fromYm, toYm);
  const events: NormalizedEvent[] = [];

  let obsessionTrack: TrackRef | null = null;
  let obsessionMonthsLeft = 0;
  const abandoned = new Set<string>();
  let phaseIndex = 0;

  const hourIndices = START_HOUR_WEIGHTS.map((_, h) => h);

  for (const ym of months) {
    if (startOfMonthTs(ym) > now) break;

    while (phaseIndex < DEMO_PHASES.length - 1 && ym > DEMO_PHASES[phaseIndex].toYm) {
      // Leaving a phase: retire some of its artists for good.
      const leaving = DEMO_PHASES[phaseIndex];
      for (const scene of Object.keys(leaving.weights) as DemoScene[]) {
        const pool = byScene.get(scene) ?? [];
        if (pool.length === 0) continue;
        if (random() < 0.55) {
          abandoned.add(pool[Math.floor(random() * pool.length)].artist.name);
        }
      }
      phaseIndex += 1;
    }

    const phase = DEMO_PHASES[Math.min(phaseIndex, DEMO_PHASES.length - 1)];
    const scenes = (Object.keys(phase.weights) as DemoScene[]).filter(
      (s) => (byScene.get(s) ?? []).length > 0,
    );
    if (scenes.length === 0) continue;
    const sceneWeights = scenes.map((s) => phase.weights[s] ?? 0);

    const seasonal = 1 + 0.32 * Math.sin((Number(ym.slice(5, 7)) / 12) * Math.PI * 2);
    const noise = 0.6 + random() * 0.85;
    const monthTarget = Math.max(24, Math.round(baseIntensity * seasonal * noise));

    if (obsessionMonthsLeft <= 0 && random() < 0.16) {
      const scene = pickWeighted(scenes, sceneWeights, random);
      const pool = (byScene.get(scene) ?? []).filter((t) => !abandoned.has(t.artist.name));
      if (pool.length > 0) {
        obsessionTrack = pool[Math.floor(random() * pool.length)];
        obsessionMonthsLeft = 1 + Math.floor(random() * 2);
      }
    } else if (obsessionMonthsLeft > 0) {
      obsessionMonthsLeft -= 1;
      if (obsessionMonthsLeft === 0) obsessionTrack = null;
    }

    const daysInMonth = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    const monthStart = startOfMonthTs(ym);
    let emitted = 0;

    while (emitted < monthTarget) {
      // ---- one sitting ----
      const day = 1 + Math.floor(random() * daysInMonth);
      const hour = pickWeighted(hourIndices, START_HOUR_WEIGHTS, random);
      let cursor =
        monthStart +
        (day - 1) * MS_PER_DAY +
        hour * 3_600_000 +
        Math.floor(random() * 60) * MS_PER_MINUTE;

      // Sitting length: mostly short, occasionally a long evening.
      const sittingLength = Math.max(
        1,
        Math.round(Math.pow(random(), 1.9) * 26) + 1 + (random() < 0.08 ? 20 : 0),
      );

      const scene = pickWeighted(scenes, sceneWeights, random);
      const scenePool = (byScene.get(scene) ?? []).filter((t) => !abandoned.has(t.artist.name));
      const pool = scenePool.length > 0 ? scenePool : (byScene.get(scene) ?? []);
      if (pool.length === 0) break;

      // Sittings often lean on one record; the taste curve is steep but not extreme.
      const anchorIndex = Math.floor(Math.pow(random(), 1.55) * pool.length);
      let current = pool[Math.min(anchorIndex, pool.length - 1)];
      const albumRun = random() < 0.42;
      const albumTracks = byAlbum.get(`${current.artist.name}::${current.album}`) ?? [current];
      let albumCursor = current.albumIndex;

      for (let i = 0; i < sittingLength && emitted < monthTarget; i++) {
        let ref: TrackRef;
        if (obsessionTrack && random() < 0.3) {
          ref = obsessionTrack;
        } else if (i === 0) {
          ref = current;
        } else if (albumRun && random() < 0.72) {
          albumCursor = (albumCursor + 1) % albumTracks.length;
          ref = albumTracks[albumCursor];
        } else if (random() < 0.1) {
          ref = current; // an immediate replay
        } else {
          const index = Math.floor(Math.pow(random(), 1.55) * pool.length);
          ref = pool[Math.min(index, pool.length - 1)];
        }
        current = ref;

        const roll = random();
        let msPlayed: number;
        let skipped = false;
        let reasonEnd: string;
        if (roll < 0.15) {
          msPlayed = Math.floor(1_500 + random() * 26_000);
          skipped = true;
          reasonEnd = random() < 0.78 ? 'fwdbtn' : 'backbtn';
        } else if (roll < 0.21) {
          msPlayed = Math.floor(30_000 + random() * 95_000);
          reasonEnd = 'endplay';
        } else {
          msPlayed = Math.floor(148_000 + random() * 152_000);
          reasonEnd = 'trackdone';
        }

        if (cursor > now) break;

        events.push({
          ts: cursor,
          trackName: ref.title,
          artistName: ref.artist.name,
          albumName: ref.album,
          uri: ref.uri,
          msPlayed,
          platform: PLATFORMS[Math.floor(random() * PLATFORMS.length)],
          country: random() < 0.9 ? 'GB' : 'GR',
          reasonStart: i === 0 ? 'clickrow' : reasonEnd === 'fwdbtn' ? 'fwdbtn' : 'trackdone',
          reasonEnd,
          shuffle: !albumRun && random() < 0.72,
          skipped,
          offline: random() < 0.08,
          incognito: random() < 0.012,
        });
        emitted += 1;

        // Next track starts when this one finished, plus a beat.
        cursor += msPlayed + Math.floor(random() * 8_000);
      }
    }
  }

  events.sort((a, b) => a.ts - b.ts);

  return {
    events,
    fromTs: events.length > 0 ? events[0].ts : now,
    toTs: events.length > 0 ? events[events.length - 1].ts : now,
  };
}

/**
 * Renders a demo dataset as Spotify-shaped JSON, so import fixtures exercise the
 * real parsing path rather than bypassing it.
 */
export function toSpotifyExportJson(events: NormalizedEvent[]): unknown[] {
  return events.map((e) => ({
    ts: new Date(e.ts).toISOString(),
    platform: e.platform,
    ms_played: e.msPlayed,
    conn_country: e.country,
    master_metadata_track_name: e.trackName,
    master_metadata_album_artist_name: e.artistName,
    master_metadata_album_album_name: e.albumName,
    spotify_track_uri: e.uri,
    episode_name: null,
    episode_show_name: null,
    spotify_episode_uri: null,
    reason_start: e.reasonStart,
    reason_end: e.reasonEnd,
    shuffle: e.shuffle,
    skipped: e.skipped,
    offline: e.offline,
    offline_timestamp: e.offline ? Math.floor(e.ts / 1000) : null,
    incognito_mode: e.incognito,
  }));
}
