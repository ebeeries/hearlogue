import type { Db } from '../types';
import type { Era, EraArtistRef, EraTrackRef } from '@shared/types/domain';
import { getNote } from './library';
import { notFound } from '../../utils/errors';

/** Read/update access to the eras produced by the segmentation pass. */

interface EraRow {
  id: number;
  position: number;
  start_ym: string;
  end_ym: string;
  start_ts: number;
  end_ts: number;
  months: number;
  auto_title: string;
  custom_title: string | null;
  streams: number;
  q_plays: number;
  ms_played: number;
  new_artists: number;
  change_strength: number;
  accent: string;
}

function hydrate(db: Db, row: EraRow): Era {
  const topArtists = db
    .prepare(
      `SELECT a.id, a.name, ea.plays, ea.ms_played AS msPlayed
       FROM era_artists ea JOIN artists a ON a.id = ea.artist_id
       WHERE ea.era_id = ? ORDER BY ea.rank ASC`,
    )
    .all(row.id) as EraArtistRef[];

  const topTracks = db
    .prepare(
      `SELECT t.id, t.name, ar.name AS artist, et.plays
       FROM era_tracks et
       JOIN tracks t ON t.id = et.track_id
       JOIN artists ar ON ar.id = t.artist_id
       WHERE et.era_id = ? ORDER BY et.rank ASC`,
    )
    .all(row.id) as EraTrackRef[];

  return {
    id: row.id,
    position: row.position,
    startYm: row.start_ym,
    endYm: row.end_ym,
    startTs: row.start_ts,
    endTs: row.end_ts,
    months: row.months,
    autoTitle: row.auto_title,
    customTitle: row.custom_title,
    title: row.custom_title ?? row.auto_title,
    streams: row.streams,
    qualifyingPlays: row.q_plays,
    msPlayed: row.ms_played,
    topArtists,
    topTracks,
    newArtists: row.new_artists,
    changeStrength: row.change_strength,
    accent: row.accent,
    note: getNote(db, 'era', row.id),
  };
}

export function listEras(db: Db): Era[] {
  const rows = db.prepare('SELECT * FROM eras ORDER BY position ASC').all() as EraRow[];
  return rows.map((row) => hydrate(db, row));
}

export function getEra(db: Db, id: number): Era {
  const row = db.prepare('SELECT * FROM eras WHERE id = ?').get(id) as EraRow | undefined;
  if (!row) throw notFound(`era:${id}`);
  return hydrate(db, row);
}

/** Renaming an era keeps the generated title so it can always be restored. */
export function renameEra(db: Db, id: number, customTitle: string | null): Era {
  const trimmed = customTitle?.trim() ?? '';
  const info = db
    .prepare('UPDATE eras SET custom_title = ? WHERE id = ?')
    .run(trimmed.length > 0 ? trimmed : null, id);
  if (info.changes === 0) throw notFound(`era:${id}`);

  // Keep the search index in step with the new label.
  db.prepare("DELETE FROM search_index WHERE kind = 'era' AND entity_id = ?").run(id);
  const row = db.prepare('SELECT * FROM eras WHERE id = ?').get(id) as EraRow;
  db.prepare(
    "INSERT INTO search_index (title, subtitle, kind, entity_id) VALUES (?, ?, 'era', ?)",
  ).run(row.custom_title ?? row.auto_title, `${row.start_ym} - ${row.end_ym}`, id);

  return getEra(db, id);
}

export function eraCount(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM eras').get() as { n: number }).n;
}

/** The era containing a given timestamp, if any — used to place a track in time. */
export function eraAt(db: Db, ts: number): Era | null {
  const row = db
    .prepare('SELECT * FROM eras WHERE start_ts <= ? AND end_ts >= ? LIMIT 1')
    .get(ts, ts) as EraRow | undefined;
  return row ? hydrate(db, row) : null;
}
