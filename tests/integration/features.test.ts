import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createAnalyzedArchive, TEST_NOW, TEST_SETTINGS, type TempArchive } from '../fixtures/archive';
import { openDatabase, closeDatabase } from '@main/database/db';
import * as archiveRepo from '@main/database/repositories/archive';
import * as entityRepo from '@main/database/repositories/entities';
import * as discoveryRepo from '@main/database/repositories/discovery';
import * as eraRepo from '@main/database/repositories/eras';
import * as obsessionRepo from '@main/database/repositories/obsessions';
import * as rewindRepo from '@main/database/repositories/rewind';
import * as calendarRepo from '@main/database/repositories/calendar';
import * as libraryRepo from '@main/database/repositories/library';
import * as collectionRepo from '@main/database/repositories/collections';
import * as searchRepo from '@main/database/repositories/search';
import { readSettings, writeSettings } from '@main/database/repositories/settings';
import { rebuildAnalytics } from '@main/analytics/rebuild';
import { LOST_FAVORITE_MIN_SCORE, GRAVEYARD_MIN_DAYS_MISSING } from '@shared/constants/analytics';
import { MS_PER_DAY, localParts } from '@shared/utils/time';

/**
 * Feature-level integration tests.
 *
 * One analysed archive is built for the whole file — it is the expensive part —
 * and every repository is then asked the questions a screen would ask. The
 * assertions check invariants rather than exact figures, so the suite stays
 * meaningful if the demo generator is ever retuned.
 */

let archive: TempArchive;

beforeAll(() => {
  archive = createAnalyzedArchive(220);
}, 120_000);

afterAll(() => {
  archive?.cleanup();
});

const db = () => archive.db;

describe('archive overview', () => {
  it('reports coherent lifetime figures', () => {
    const stats = archiveRepo.lifetimeStats(db());
    expect(stats.streams).toBeGreaterThan(10_000);
    expect(stats.qualifyingPlays).toBeLessThanOrEqual(stats.streams);
    expect(stats.msPlayed).toBeGreaterThan(0);
    expect(stats.years).toBeGreaterThan(5);
    expect(stats.activeDays).toBeGreaterThan(100);
    expect(stats.skipRate).toBeGreaterThan(0);
    expect(stats.skipRate).toBeLessThan(1);
    expect(stats.firstTs).toBeLessThan(stats.lastTs!);
  });

  it('yearly points cover a contiguous span', () => {
    const years = archiveRepo.yearlyPoints(db());
    expect(years.length).toBeGreaterThan(5);
    for (let i = 1; i < years.length; i++) {
      expect(years[i].year).toBe(years[i - 1].year + 1);
    }
  });

  it('offers a rediscovery that meets the Lost Favorite bar', () => {
    const card = archiveRepo.rediscovery(db(), TEST_NOW);
    expect(card).not.toBeNull();
    expect(card!.score).toBeGreaterThanOrEqual(LOST_FAVORITE_MIN_SCORE);
    expect(card!.daysSinceLastPlay).toBeGreaterThanOrEqual(365);
    expect(card!.track.qualifyingPlays).toBeGreaterThan(0);
  });

  it('rotates the rediscovery from day to day but holds it within a day', () => {
    // Anchored to local midnight: the card is keyed on the local date, so a
    // fixed UTC offset could cross midnight in some timezones and look flaky.
    const parts = localParts(TEST_NOW);
    const localMidnight = new Date(parts.year, parts.month - 1, parts.day).getTime();
    const morning = archiveRepo.rediscovery(db(), localMidnight + 9 * 3_600_000);
    const evening = archiveRepo.rediscovery(db(), localMidnight + 21 * 3_600_000);
    expect(evening!.track.id).toBe(morning!.track.id);

    const laterDays = new Set<number>();
    for (let day = 0; day < 12; day++) {
      laterDays.add(
        archiveRepo.rediscovery(db(), localMidnight + day * MS_PER_DAY + 9 * 3_600_000)!.track.id,
      );
    }
    expect(laterDays.size).toBeGreaterThan(3);
  });

  it('builds a records board of real superlatives', () => {
    const records = archiveRepo.records(db(), TEST_NOW);
    expect(records.length).toBeGreaterThan(6);

    const topTrack = records.find((record) => record.key === 'records.mostPlayedTrack');
    expect(topTrack?.entity?.kind).toBe('track');

    // The most played track really is the most played one.
    const actual = db()
      .prepare('SELECT track_id FROM track_stats ORDER BY q_plays DESC LIMIT 1')
      .pluck()
      .get() as number;
    expect(topTrack?.entity?.id).toBe(actual);
  });

  it('summarises the listening clock consistently', () => {
    const clock = archiveRepo.clockStats(db());
    expect(clock.hourly).toHaveLength(24);
    const totalPlays = clock.hourly.reduce((sum, hour) => sum + hour.plays, 0);
    const daypartPlays = clock.dayparts.reduce((sum, part) => sum + part.plays, 0);
    expect(daypartPlays).toBe(totalPlays);
    expect(clock.weekday.plays + clock.weekend.plays).toBe(totalPlays);
    expect(clock.peakHour).toBeGreaterThanOrEqual(0);
    expect(clock.peakHour).toBeLessThan(24);
  });
});

describe('lost favorites', () => {
  it('returns only tracks that clear every gate', () => {
    const page = discoveryRepo.lostFavorites(db(), {
      filter: 'all',
      offset: 0,
      limit: 50,
      diversify: false,
      now: TEST_NOW,
    });

    expect(page.items.length).toBeGreaterThan(10);
    for (const item of page.items) {
      expect(item.score).toBeGreaterThanOrEqual(LOST_FAVORITE_MIN_SCORE);
      expect(item.qualifyingPlays).toBeGreaterThanOrEqual(8);
      expect(item.daysSinceLastPlay).toBeGreaterThanOrEqual(365);
      expect(Object.values(item.dimensions).every((value) => value >= 0 && value <= 1)).toBe(true);
    }
  });

  it('orders by score, descending', () => {
    const page = discoveryRepo.lostFavorites(db(), {
      filter: 'all',
      offset: 0,
      limit: 40,
      diversify: false,
      now: TEST_NOW,
    });
    for (let i = 1; i < page.items.length; i++) {
      expect(page.items[i - 1].score).toBeGreaterThanOrEqual(page.items[i].score);
    }
  });

  it('diversification stops one artist dominating the page', () => {
    const plain = discoveryRepo.lostFavorites(db(), {
      filter: 'all', offset: 0, limit: 20, diversify: false, now: TEST_NOW,
    });
    const mixed = discoveryRepo.lostFavorites(db(), {
      filter: 'all', offset: 0, limit: 20, diversify: true, now: TEST_NOW,
    });

    const maxPerArtist = (items: { artistId: number }[]): number => {
      const counts = new Map<number, number>();
      for (const item of items) counts.set(item.artistId, (counts.get(item.artistId) ?? 0) + 1);
      return Math.max(...counts.values());
    };

    expect(maxPerArtist(mixed.items)).toBeLessThanOrEqual(maxPerArtist(plain.items));
    expect(new Set(mixed.items.map((i) => i.artistId)).size).toBeGreaterThanOrEqual(
      new Set(plain.items.map((i) => i.artistId)).size,
    );
  });

  it('applies the dormancy filters correctly', () => {
    for (const [filter, years] of [
      ['years3', 3],
      ['years5', 5],
    ] as const) {
      const page = discoveryRepo.lostFavorites(db(), {
        filter, offset: 0, limit: 30, diversify: false, now: TEST_NOW,
      });
      for (const item of page.items) {
        expect(item.lastTs).toBeLessThanOrEqual(TEST_NOW - years * 365 * MS_PER_DAY);
      }
    }
  });

  it('finds nothing to search for when the query matches nothing', () => {
    const page = discoveryRepo.lostFavorites(db(), {
      filter: 'all', offset: 0, limit: 30, diversify: false, search: 'zzzznothing', now: TEST_NOW,
    });
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(0);
  });
});

describe('graveyard', () => {
  it('only lists entities that were significant and are genuinely gone', () => {
    for (const kind of ['track', 'artist', 'album'] as const) {
      const page = discoveryRepo.graveyard(db(), { kind, offset: 0, limit: 30, minDaysMissing: null });
      for (const item of page.items) {
        expect(item.daysMissing).toBeGreaterThanOrEqual(GRAVEYARD_MIN_DAYS_MISSING);
        expect(item.historicalPlays).toBeGreaterThan(0);
        expect(item.name).toBeTruthy();
        expect(item.score).toBeGreaterThan(0);
      }
      for (let i = 1; i < page.items.length; i++) {
        expect(page.items[i - 1].score).toBeGreaterThanOrEqual(page.items[i].score);
      }
    }
  });

  it('offers a working Spotify link for every kind, including artists', () => {
    for (const kind of ['track', 'artist', 'album'] as const) {
      const page = discoveryRepo.graveyard(db(), { kind, offset: 0, limit: 20, minDaysMissing: null });
      expect(page.items.length).toBeGreaterThan(0);
      // Spotify only exports track URIs, so artists and albums fall back to
      // their most-played track rather than showing a dead Revive button.
      for (const item of page.items) {
        expect(item.uri, `${kind} "${item.name}" had no Spotify link`).toMatch(
          /^spotify:track:/,
        );
      }
    }
  });

  it('never lists something that was played recently', () => {
    const page = discoveryRepo.graveyard(db(), {
      kind: 'artist', offset: 0, limit: 40, minDaysMissing: null,
    });
    for (const item of page.items) {
      const recent = db()
        .prepare('SELECT COUNT(*) AS n FROM playback_events WHERE artist_id = ? AND ts > ?')
        .get(item.entityId, TEST_NOW - 365 * MS_PER_DAY) as { n: number };
      expect(recent.n).toBe(0);
    }
  });
});

describe('obsessions', () => {
  it('every obsession describes a window inside its own history', () => {
    const sections = obsessionRepo.obsessionSections(db(), 12);
    const all = Object.values(sections).flat();
    expect(all.length).toBeGreaterThan(5);

    for (const item of all) {
      expect(item.windowStart).toBeLessThanOrEqual(item.windowEnd);
      expect(item.windowPlays).toBeLessThanOrEqual(item.lifetimePlays);
      expect(item.share).toBeGreaterThan(0);
      expect(item.share).toBeLessThanOrEqual(1);
      expect(item.name).toBeTruthy();

      // The window really contains that many qualifying plays.
      const column =
        item.kind === 'track' ? 'track_id' : item.kind === 'artist' ? 'artist_id' : 'album_id';
      const actual = db()
        .prepare(
          `SELECT COUNT(*) AS n FROM playback_events
           WHERE ${column} = ? AND ts >= ? AND ts <= ? AND ms_played >= ?`,
        )
        .get(item.entityId, item.windowStart, item.windowEnd, TEST_SETTINGS.qualifyingPlayMs) as {
        n: number;
      };
      expect(actual.n).toBe(item.windowPlays);
    }
  });

  it('one-hit obsessions really did burn out', () => {
    const sections = obsessionRepo.obsessionSections(db(), 12);
    for (const item of sections.oneHit) {
      expect(item.share).toBeGreaterThanOrEqual(0.6);
      expect(item.afterShare).toBeLessThanOrEqual(0.12);
    }
  });

  it('fastest-to-100 is ordered and only includes tracks that got there', () => {
    const sections = obsessionRepo.obsessionSections(db(), 12);
    for (const item of sections.fastestHundred) {
      expect(item.daysToHundred).not.toBeNull();
      expect(item.lifetimePlays).toBeGreaterThanOrEqual(100);
    }
    for (let i = 1; i < sections.fastestHundred.length; i++) {
      expect(sections.fastestHundred[i - 1].daysToHundred!).toBeLessThanOrEqual(
        sections.fastestHundred[i].daysToHundred!,
      );
    }
  });
});

describe('eras', () => {
  it('produces a contiguous, non-overlapping, titled timeline', () => {
    const eras = eraRepo.listEras(db());
    expect(eras.length).toBeGreaterThan(2);

    for (let i = 0; i < eras.length; i++) {
      const era = eras[i];
      expect(era.startYm <= era.endYm).toBe(true);
      expect(era.months).toBeGreaterThan(0);
      expect(era.title.length).toBeGreaterThan(3);
      expect(era.topArtists.length).toBeGreaterThan(0);
      expect(era.streams).toBeGreaterThan(0);
      if (i > 0) {
        // Eras run forwards in time and never overlap.
        expect(era.startYm > eras[i - 1].endYm).toBe(true);
      }
    }
  });

  it('names each era after artists who actually led it', () => {
    for (const era of eraRepo.listEras(db())) {
      if (era.title.includes('Stretch')) continue;
      const leaders = era.topArtists.slice(0, 2).map((artist) => artist.name);
      const mentioned = leaders.some((name) =>
        era.title.includes(name.replace(/^(the|a|an)\s+/i, '')),
      );
      expect(mentioned, `${era.title} vs ${leaders.join(', ')}`).toBe(true);
    }
  });

  it('renaming keeps the generated title and updates search', () => {
    const [first] = eraRepo.listEras(db());
    const renamed = eraRepo.renameEra(db(), first.id, '  Montreal Summer  ');
    expect(renamed.title).toBe('Montreal Summer');
    expect(renamed.customTitle).toBe('Montreal Summer');
    expect(renamed.autoTitle).toBe(first.autoTitle);

    const found = searchRepo.search(db(), {
      query: 'montreal', limit: 10, offset: 0, filters: {}, now: TEST_NOW,
    });
    expect(found.items.some((hit) => hit.kind === 'era' && hit.id === first.id)).toBe(true);

    // Clearing the custom title restores the generated one.
    const restored = eraRepo.renameEra(db(), first.id, null);
    expect(restored.title).toBe(first.autoTitle);
    expect(restored.customTitle).toBeNull();
  });
});

describe('rewind', () => {
  it('returns a coherent year', () => {
    const years = rewindRepo.availableYears(db());
    const year = years[Math.floor(years.length / 2)];
    const view = rewindRepo.rewindYear(db(), year, TEST_NOW);

    expect(view.year).toBe(year);
    expect(view.streams).toBeGreaterThan(0);
    expect(view.topTracks.length).toBeGreaterThan(0);
    expect(view.monthly.length).toBeGreaterThan(0);
    expect(view.hourly).toHaveLength(24);
    expect(view.lateNightShare).toBeGreaterThanOrEqual(0);
    expect(view.lateNightShare).toBeLessThanOrEqual(1);

    for (const point of view.monthly) expect(point.ym.startsWith(String(year))).toBe(true);
    for (const artist of view.firstHeardArtists) {
      expect(new Date(artist.ts).getFullYear()).toBe(year);
    }
    // Anything listed as vanished really was last heard that year.
    for (const track of view.vanished) {
      expect(new Date(track.lastTs!).getFullYear()).toBe(year);
    }
  });

  it('rejects a year that is not in the archive', () => {
    expect(() => rewindRepo.rewindYear(db(), 1874, TEST_NOW)).toThrow();
  });

  it('returns a coherent month and a random month that exists', () => {
    const ym = rewindRepo.availableMonths(db())[4];
    const view = rewindRepo.rewindMonth(db(), ym);
    expect(view.ym).toBe(ym);
    expect(view.streams).toBeGreaterThan(0);
    for (const day of view.daily) expect(day.date.startsWith(ym)).toBe(true);

    const random = rewindRepo.randomMonth(db(), 12345);
    expect(random).not.toBeNull();
    expect(() => rewindRepo.rewindMonth(db(), random!)).not.toThrow();
  });
});

describe('calendar and sessions', () => {
  it('builds a heatmap whose totals match the daily table', () => {
    const heatmap = calendarRepo.heatmap(db(), null, null, 'msPlayed');
    expect(heatmap.days.length).toBeGreaterThan(100);
    expect(heatmap.max).toBeGreaterThan(0);

    const total = heatmap.days.reduce((sum, day) => sum + day.msPlayed, 0);
    const expected = db().prepare('SELECT SUM(ms_played) AS ms FROM daily_stats').get() as {
      ms: number;
    };
    expect(total).toBe(expected.ms);
  });

  it('a day detail agrees with its own events', () => {
    const date = db()
      .prepare('SELECT local_date FROM daily_stats ORDER BY plays DESC LIMIT 1')
      .pluck()
      .get() as string;
    const day = calendarRepo.dayDetail(db(), date);

    expect(day.events).toBeGreaterThan(0);
    expect(day.hourly).toHaveLength(24);
    expect(day.hourly.reduce((sum, hour) => sum + hour.plays, 0)).toBe(day.events);
    expect(day.topTracks.length).toBeGreaterThan(0);
    expect(day.firstTs).toBeLessThanOrEqual(day.lastTs!);
  });

  it('sessions partition the archive without gaps or overlaps', () => {
    const stats = calendarRepo.sessionStats(db());
    expect(stats.total).toBeGreaterThan(50);
    expect(stats.averageEvents).toBeGreaterThan(2);

    const totals = db()
      .prepare('SELECT SUM(events) AS events, COUNT(*) AS n FROM sessions')
      .get() as { events: number; n: number };
    const eventCount = db().prepare('SELECT COUNT(*) AS n FROM playback_events').get() as {
      n: number;
    };
    // Every event belongs to exactly one session.
    expect(totals.events).toBe(eventCount.n);

    const rows = db()
      .prepare('SELECT start_ts, end_ts FROM sessions ORDER BY start_ts')
      .all() as { start_ts: number; end_ts: number }[];
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].start_ts).toBeGreaterThan(rows[i - 1].end_ts);
    }
  });

  it('a session detail lists the tracks it contains', () => {
    const [session] = calendarRepo.listSessions(db(), 'longest', 0, 1).items;
    const detail = calendarRepo.sessionDetail(db(), session.id);
    expect(detail.events_list.length).toBe(session.events);
    for (let i = 1; i < detail.events_list.length; i++) {
      expect(detail.events_list[i].ts).toBeGreaterThanOrEqual(detail.events_list[i - 1].ts);
    }
  });

  it('changing the session gap changes the sessions', () => {
    const before = (db().prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
    rebuildAnalytics(db(), { ...TEST_SETTINGS, sessionGapMinutes: 5 }, () => {}, TEST_NOW);
    const after = (db().prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
    expect(after).toBeGreaterThan(before);

    rebuildAnalytics(db(), TEST_SETTINGS, () => {}, TEST_NOW);
    const restored = (db().prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
    expect(restored).toBe(before);
  });
});

describe('entity detail', () => {
  it('a track detail is internally consistent', () => {
    const trackId = db()
      .prepare('SELECT track_id FROM track_stats ORDER BY q_plays DESC LIMIT 1')
      .pluck()
      .get() as number;
    const detail = entityRepo.trackDetail(db(), trackId);

    expect(detail.track.qualifyingPlays).toBeGreaterThan(0);
    expect(detail.monthly.length).toBeGreaterThan(0);
    expect(detail.hourly).toHaveLength(24);

    const monthlyPlays = detail.monthly.reduce((sum, point) => sum + point.qualifyingPlays, 0);
    expect(monthlyPlays).toBe(detail.track.qualifyingPlays);

    // Milestones run forwards and start with the first hearing.
    expect(detail.milestones[0].kind).toBe('first-heard');
    for (let i = 1; i < detail.milestones.length; i++) {
      expect(detail.milestones[i].ts).toBeGreaterThanOrEqual(detail.milestones[i - 1].ts);
    }
  });

  it('an artist detail only claims what the numbers support', () => {
    const artistId = db()
      .prepare('SELECT artist_id FROM artist_stats ORDER BY ms_played DESC LIMIT 1')
      .pluck()
      .get() as number;
    const detail = entityRepo.artistDetail(db(), artistId);

    expect(detail.topTracks.length).toBeGreaterThan(0);
    expect(detail.artist.trackCount).toBeGreaterThan(0);
    for (const insight of detail.insights) {
      expect(insight.key.startsWith('insight.')).toBe(true);
      for (const value of Object.values(insight.values)) {
        expect(Number.isFinite(Number(value)) || typeof value === 'string').toBe(true);
      }
    }
  });

  it('an album detail describes how it was listened to', () => {
    const albumId = db()
      .prepare('SELECT album_id FROM album_stats ORDER BY q_plays DESC LIMIT 1')
      .pluck()
      .get() as number;
    const detail = entityRepo.albumDetail(db(), albumId);

    expect(detail.topTracks.length).toBeGreaterThan(0);
    expect(detail.breadth).toBeGreaterThanOrEqual(0);
    expect(detail.breadth).toBeLessThanOrEqual(1);
    expect(detail.concentrationTop3).toBeGreaterThan(0);
    expect(detail.concentrationTop3).toBeLessThanOrEqual(1);
  });

  it('reports a missing entity as not found', () => {
    expect(() => entityRepo.trackDetail(db(), 999_999)).toThrow();
    expect(() => entityRepo.artistDetail(db(), 999_999)).toThrow();
  });
});

describe('library and collections', () => {
  it('tags can be created, assigned, filtered and removed', () => {
    const tag = libraryRepo.createTag(db(), 'Night Drives', 'Car', '#7C8BA3');
    const trackId = db().prepare('SELECT id FROM tracks LIMIT 1').pluck().get() as number;

    libraryRepo.assignTag(db(), trackId, tag.id);
    const tagged = libraryRepo.libraryTracks(db(), {
      tagId: tag.id, search: '', sort: 'plays', direction: 'desc', offset: 0, limit: 10, status: 'any',
    });
    expect(tagged.items.map((item) => item.id)).toContain(trackId);

    libraryRepo.unassignTag(db(), trackId, tag.id);
    expect(
      libraryRepo.libraryTracks(db(), {
        tagId: tag.id, search: '', sort: 'plays', direction: 'desc', offset: 0, limit: 10, status: 'any',
      }).total,
    ).toBe(0);

    libraryRepo.deleteTag(db(), tag.id);
    expect(libraryRepo.listTags(db()).some((t) => t.id === tag.id)).toBe(false);
  });

  it('refuses a duplicate tag name', () => {
    const tag = libraryRepo.createTag(db(), 'Unique Name', 'Tag', '#D6B06A');
    expect(() => libraryRepo.createTag(db(), 'unique  name', 'Tag', '#D6B06A')).toThrow();
    libraryRepo.deleteTag(db(), tag.id);
  });

  it('flags and notes round-trip', () => {
    const trackId = db().prepare('SELECT id FROM tracks LIMIT 1').pluck().get() as number;

    expect(libraryRepo.setTrackFlags(db(), trackId, { favorite: true }).favorite).toBe(true);
    expect(libraryRepo.setTrackFlags(db(), trackId, { retired: true }).favorite).toBe(true);

    const note = libraryRepo.setNote(db(), 'track', trackId, '  Reminds me of Montreal.  ');
    expect(note?.body).toBe('Reminds me of Montreal.');
    expect(libraryRepo.getNote(db(), 'track', trackId)?.body).toBe('Reminds me of Montreal.');
    expect(libraryRepo.listNotes(db()).some((n) => n.entityId === trackId)).toBe(true);

    // Clearing a note removes it rather than storing an empty string.
    expect(libraryRepo.setNote(db(), 'track', trackId, '   ')).toBeNull();
    expect(libraryRepo.getNote(db(), 'track', trackId)).toBeNull();

    libraryRepo.setTrackFlags(db(), trackId, { favorite: false, retired: false });
  });

  it('starter collections return only matching tracks', () => {
    const collections = collectionRepo.listCollections(db(), TEST_NOW);
    expect(collections.length).toBeGreaterThan(1);

    const lostClassics = collections.find((c) => c.name === 'Lost Classics');
    expect(lostClassics).toBeDefined();

    const page = collectionRepo.collectionTracks(db(), lostClassics!.id, 0, 30, TEST_NOW);
    for (const track of page.items) {
      expect(track.qualifyingPlays).toBeGreaterThan(30);
      expect(TEST_NOW - track.lastTs!).toBeGreaterThan(1095 * MS_PER_DAY);
      expect(track.skipRate).toBeLessThan(0.2);
    }
  });

  it('a saved collection survives a round trip and can be deleted', () => {
    const saved = collectionRepo.saveCollection(
      db(),
      {
        id: null,
        name: 'Deep 2019',
        description: 'Test collection',
        icon: 'Sparkles',
        matchMode: 'all',
        pinned: false,
        rules: [
          { field: 'peakYear', operator: 'eq', value: '2019' },
          { field: 'plays', operator: 'gte', value: '20' },
        ],
      },
      TEST_NOW,
    );

    expect(saved.rules).toHaveLength(2);
    expect(saved.count).toBeGreaterThanOrEqual(0);

    const tracks = collectionRepo.collectionTracks(db(), saved.id, 0, 20, TEST_NOW);
    for (const track of tracks.items) {
      const peak = db()
        .prepare('SELECT peak_year FROM track_stats WHERE track_id = ?')
        .pluck()
        .get(track.id) as number;
      expect(peak).toBe(2019);
      expect(track.qualifyingPlays).toBeGreaterThanOrEqual(20);
    }

    collectionRepo.deleteCollection(db(), saved.id);
    expect(() => collectionRepo.getCollection(db(), saved.id, TEST_NOW)).toThrow();
  });
});

describe('search', () => {
  it('finds artists whose names contain an ampersand', () => {
    const name = db()
      .prepare("SELECT name FROM artists WHERE name LIKE '%&%' LIMIT 1")
      .pluck()
      .get() as string | undefined;
    expect(name, 'demo catalogue should contain an ampersand name').toBeTruthy();

    const results = searchRepo.search(db(), {
      query: name!, limit: 20, offset: 0, filters: {}, now: TEST_NOW,
    });
    expect(results.items.some((hit) => hit.title === name)).toBe(true);
  });

  it('finds an artist by an exact name', () => {
    const name = db()
      .prepare('SELECT name FROM artists ORDER BY id LIMIT 1')
      .pluck()
      .get() as string;
    const results = searchRepo.search(db(), {
      query: name, limit: 20, offset: 0, filters: {}, now: TEST_NOW,
    });
    expect(results.items.some((hit) => hit.kind === 'artist' && hit.title === name)).toBe(true);
  });

  it('matches a prefix, so search works while typing', () => {
    const name = db()
      .prepare("SELECT name FROM artists WHERE name LIKE 'Noc%' LIMIT 1")
      .pluck()
      .get() as string | undefined;
    if (!name) return;
    const results = searchRepo.search(db(), {
      query: name.slice(0, 4), limit: 20, offset: 0, filters: {}, now: TEST_NOW,
    });
    expect(results.items.length).toBeGreaterThan(0);
  });

  it('applies filters', () => {
    const byKind = searchRepo.search(db(), {
      query: '', limit: 40, offset: 0, filters: { kinds: ['artist'] }, now: TEST_NOW,
    });
    expect(byKind.items.every((hit) => hit.kind === 'artist')).toBe(true);

    const busy = searchRepo.search(db(), {
      query: '', limit: 40, offset: 0, filters: { kinds: ['track'], minPlays: 100 }, now: TEST_NOW,
    });
    expect(busy.items.every((hit) => hit.plays >= 100)).toBe(true);

    const dormant = searchRepo.search(db(), {
      query: '', limit: 40, offset: 0, filters: { kinds: ['track'], status: 'dormant' }, now: TEST_NOW,
    });
    for (const hit of dormant.items) {
      expect(TEST_NOW - hit.lastTs!).toBeGreaterThanOrEqual(365 * MS_PER_DAY);
    }
  });

  it('does not fall over on punctuation or FTS operators', () => {
    for (const query of ['AC/DC', 'NEAR', '"', '*', 'a AND b', "O'Brien", '--']) {
      expect(() =>
        searchRepo.search(db(), { query, limit: 10, offset: 0, filters: {}, now: TEST_NOW }),
      ).not.toThrow();
    }
  });

  it('offers facets drawn from the archive', () => {
    const facets = searchRepo.searchFacets(db());
    expect(facets.years.length).toBeGreaterThan(3);
    expect(facets.artists.length).toBeGreaterThan(5);
    expect(facets.tags.length).toBeGreaterThan(3);
  });
});

describe('settings persistence', () => {
  it('reads back what was written and ignores unknown keys', () => {
    const before = readSettings(db());
    writeSettings(db(), { density: 'compact', qualifyingPlayMs: 45_000 });
    const after = readSettings(db());

    expect(after.density).toBe('compact');
    expect(after.qualifyingPlayMs).toBe(45_000);
    expect(after.language).toBe(before.language);

    writeSettings(db(), {
      density: before.density,
      qualifyingPlayMs: before.qualifyingPlayMs,
    });
  });
});

describe('backup', () => {
  it('produces a file that opens as a complete archive', async () => {
    const target = path.join(archive.dir, 'backup.hearlogue');
    await db().backup(target);

    const restored = openDatabase(target, { skipMigrations: true });
    try {
      const original = db().prepare('SELECT COUNT(*) AS n FROM playback_events').get() as { n: number };
      const copy = restored.prepare('SELECT COUNT(*) AS n FROM playback_events').get() as { n: number };
      expect(copy.n).toBe(original.n);

      // Derived analytics and the personal layer travel with it.
      expect((restored.prepare('SELECT COUNT(*) AS n FROM eras').get() as { n: number }).n).toBeGreaterThan(0);
      expect((restored.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number }).n).toBeGreaterThan(0);

      const integrity = restored.pragma('integrity_check') as { integrity_check: string }[];
      expect(integrity[0].integrity_check).toBe('ok');
    } finally {
      closeDatabase(restored);
      fs.rmSync(target, { force: true });
    }
  });
});
