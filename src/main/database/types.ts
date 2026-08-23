import type BetterSqlite3 from 'better-sqlite3';

export type Db = BetterSqlite3.Database;

export interface Migration {
  version: number;
  name: string;
  up: (db: Db) => void;
}

/** Row shapes returned by repositories, kept close to the SQL that produces them. */
export interface TrackRow {
  id: number;
  name: string;
  artist_id: number;
  artist: string;
  album_id: number | null;
  album: string | null;
  uri: string | null;
  plays: number;
  q_plays: number;
  ms_played: number;
  first_ts: number | null;
  last_ts: number | null;
  skips: number;
}

export interface ArtistRow {
  id: number;
  name: string;
  uri: string | null;
  plays: number;
  q_plays: number;
  ms_played: number;
  track_count: number;
  first_ts: number | null;
  last_ts: number | null;
}

export interface AlbumRow {
  id: number;
  name: string;
  artist_id: number;
  artist: string;
  uri: string | null;
  plays: number;
  q_plays: number;
  ms_played: number;
  track_count: number;
  first_ts: number | null;
  last_ts: number | null;
}
