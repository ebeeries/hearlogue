import type { Migration } from '../types';

/**
 * The base schema.
 *
 * Design notes:
 *  - `playback_events` is the only large table. Artist and album ids are
 *    denormalised onto it so every aggregate is a single-table scan with no
 *    joins, which is what keeps a one-million-event archive responsive.
 *  - Local calendar parts are materialised at import time (see shared/utils/time)
 *    so day- and hour-level analytics never re-derive a timezone per row.
 *  - `fingerprint` is a 64-bit hash with a UNIQUE index: re-importing the same
 *    export is a no-op rather than a duplication.
 *  - Nothing here has a column for an IP address, a user agent or an account
 *    name. Those fields are dropped during normalisation and never reach SQL.
 */
export const migration001: Migration = {
  version: 1,
  name: 'initial',
  up: (db) => {
    db.exec(`
      CREATE TABLE app_metadata (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE imports (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at       INTEGER NOT NULL,
        finished_at      INTEGER,
        source_type      TEXT NOT NULL,
        source_name      TEXT NOT NULL,
        file_count       INTEGER NOT NULL DEFAULT 0,
        events_found     INTEGER NOT NULL DEFAULT 0,
        events_inserted  INTEGER NOT NULL DEFAULT 0,
        events_duplicate INTEGER NOT NULL DEFAULT 0,
        events_invalid   INTEGER NOT NULL DEFAULT 0,
        status           TEXT NOT NULL DEFAULT 'running',
        error_code       TEXT
      );

      CREATE TABLE import_files (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        import_id        INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
        file_name        TEXT NOT NULL,
        file_hash        TEXT NOT NULL,
        size_bytes       INTEGER NOT NULL DEFAULT 0,
        events_found     INTEGER NOT NULL DEFAULT 0,
        events_inserted  INTEGER NOT NULL DEFAULT 0,
        events_duplicate INTEGER NOT NULL DEFAULT 0,
        skipped          INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_import_files_hash ON import_files(file_hash);
      CREATE INDEX idx_import_files_import ON import_files(import_id);

      CREATE TABLE artists (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        name     TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        uri      TEXT
      );

      CREATE TABLE albums (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        name      TEXT NOT NULL,
        name_key  TEXT NOT NULL,
        uri       TEXT,
        UNIQUE(artist_id, name_key)
      );
      CREATE INDEX idx_albums_artist ON albums(artist_id);

      CREATE TABLE tracks (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        album_id  INTEGER REFERENCES albums(id) ON DELETE SET NULL,
        name      TEXT NOT NULL,
        name_key  TEXT NOT NULL,
        uri       TEXT,
        UNIQUE(artist_id, name_key)
      );
      CREATE INDEX idx_tracks_artist ON tracks(artist_id);
      CREATE INDEX idx_tracks_album ON tracks(album_id);

      CREATE TABLE playback_events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        ts           INTEGER NOT NULL,
        local_date   TEXT NOT NULL,
        ym           TEXT NOT NULL,
        year         INTEGER NOT NULL,
        hour         INTEGER NOT NULL,
        dow          INTEGER NOT NULL,
        track_id     INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        artist_id    INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        album_id     INTEGER REFERENCES albums(id) ON DELETE SET NULL,
        ms_played    INTEGER NOT NULL,
        platform     TEXT,
        country      TEXT,
        reason_start TEXT,
        reason_end   TEXT,
        shuffle      INTEGER,
        skipped      INTEGER,
        offline      INTEGER,
        incognito    INTEGER NOT NULL DEFAULT 0,
        fingerprint  INTEGER NOT NULL,
        import_id    INTEGER REFERENCES imports(id) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX idx_events_fingerprint ON playback_events(fingerprint);
      CREATE INDEX idx_events_ts ON playback_events(ts);
      CREATE INDEX idx_events_track_ts ON playback_events(track_id, ts);
      CREATE INDEX idx_events_artist_ts ON playback_events(artist_id, ts);
      CREATE INDEX idx_events_album_ts ON playback_events(album_id, ts);
      CREATE INDEX idx_events_date ON playback_events(local_date);
      CREATE INDEX idx_events_ym ON playback_events(ym);
      CREATE INDEX idx_events_year ON playback_events(year);

      /* ---------------- derived analytics ---------------- */

      CREATE TABLE track_stats (
        track_id          INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        plays             INTEGER NOT NULL DEFAULT 0,
        q_plays           INTEGER NOT NULL DEFAULT 0,
        short_plays       INTEGER NOT NULL DEFAULT 0,
        skips             INTEGER NOT NULL DEFAULT 0,
        ms_played         INTEGER NOT NULL DEFAULT 0,
        first_ts          INTEGER,
        last_ts           INTEGER,
        distinct_days     INTEGER NOT NULL DEFAULT 0,
        active_months     INTEGER NOT NULL DEFAULT 0,
        peak_year         INTEGER,
        peak_ym           TEXT,
        peak_ym_plays     INTEGER NOT NULL DEFAULT 0,
        peak_window_plays INTEGER NOT NULL DEFAULT 0,
        longest_gap_days  INTEGER NOT NULL DEFAULT 0,
        longest_gap_from  INTEGER,
        longest_gap_to    INTEGER,
        recent_plays      INTEGER NOT NULL DEFAULT 0,
        lost_score        REAL NOT NULL DEFAULT 0,
        lost_dims         TEXT
      );
      CREATE INDEX idx_track_stats_lost ON track_stats(lost_score DESC);
      CREATE INDEX idx_track_stats_plays ON track_stats(q_plays DESC);
      CREATE INDEX idx_track_stats_last ON track_stats(last_ts);
      CREATE INDEX idx_track_stats_ms ON track_stats(ms_played DESC);

      CREATE TABLE artist_stats (
        artist_id        INTEGER PRIMARY KEY REFERENCES artists(id) ON DELETE CASCADE,
        plays            INTEGER NOT NULL DEFAULT 0,
        q_plays          INTEGER NOT NULL DEFAULT 0,
        short_plays      INTEGER NOT NULL DEFAULT 0,
        skips            INTEGER NOT NULL DEFAULT 0,
        ms_played        INTEGER NOT NULL DEFAULT 0,
        first_ts         INTEGER,
        last_ts          INTEGER,
        track_count      INTEGER NOT NULL DEFAULT 0,
        album_count      INTEGER NOT NULL DEFAULT 0,
        distinct_days    INTEGER NOT NULL DEFAULT 0,
        peak_year        INTEGER,
        peak_ym          TEXT,
        longest_gap_days INTEGER NOT NULL DEFAULT 0,
        longest_gap_from INTEGER,
        longest_gap_to   INTEGER,
        recent_plays     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_artist_stats_plays ON artist_stats(q_plays DESC);
      CREATE INDEX idx_artist_stats_ms ON artist_stats(ms_played DESC);
      CREATE INDEX idx_artist_stats_last ON artist_stats(last_ts);

      CREATE TABLE album_stats (
        album_id      INTEGER PRIMARY KEY REFERENCES albums(id) ON DELETE CASCADE,
        plays         INTEGER NOT NULL DEFAULT 0,
        q_plays       INTEGER NOT NULL DEFAULT 0,
        skips         INTEGER NOT NULL DEFAULT 0,
        ms_played     INTEGER NOT NULL DEFAULT 0,
        first_ts      INTEGER,
        last_ts       INTEGER,
        track_count   INTEGER NOT NULL DEFAULT 0,
        peak_year     INTEGER,
        peak_ym       TEXT,
        recent_plays  INTEGER NOT NULL DEFAULT 0,
        breadth       REAL NOT NULL DEFAULT 0,
        top3_share    REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_album_stats_plays ON album_stats(q_plays DESC);
      CREATE INDEX idx_album_stats_ms ON album_stats(ms_played DESC);

      CREATE TABLE monthly_track_stats (
        track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        ym        TEXT NOT NULL,
        plays     INTEGER NOT NULL DEFAULT 0,
        q_plays   INTEGER NOT NULL DEFAULT 0,
        ms_played INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (track_id, ym)
      ) WITHOUT ROWID;
      CREATE INDEX idx_mts_ym ON monthly_track_stats(ym, q_plays DESC);

      CREATE TABLE monthly_artist_stats (
        artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        ym        TEXT NOT NULL,
        plays     INTEGER NOT NULL DEFAULT 0,
        q_plays   INTEGER NOT NULL DEFAULT 0,
        ms_played INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (artist_id, ym)
      ) WITHOUT ROWID;
      CREATE INDEX idx_mas_ym ON monthly_artist_stats(ym, q_plays DESC);

      CREATE TABLE yearly_stats (
        year      INTEGER PRIMARY KEY,
        plays     INTEGER NOT NULL DEFAULT 0,
        q_plays   INTEGER NOT NULL DEFAULT 0,
        ms_played INTEGER NOT NULL DEFAULT 0,
        tracks    INTEGER NOT NULL DEFAULT 0,
        artists   INTEGER NOT NULL DEFAULT 0,
        albums    INTEGER NOT NULL DEFAULT 0,
        days      INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE daily_stats (
        local_date     TEXT PRIMARY KEY,
        plays          INTEGER NOT NULL DEFAULT 0,
        q_plays        INTEGER NOT NULL DEFAULT 0,
        ms_played      INTEGER NOT NULL DEFAULT 0,
        unique_tracks  INTEGER NOT NULL DEFAULT 0,
        unique_artists INTEGER NOT NULL DEFAULT 0,
        first_ts       INTEGER,
        last_ts        INTEGER
      ) WITHOUT ROWID;
      CREATE INDEX idx_daily_ms ON daily_stats(ms_played DESC);

      CREATE TABLE hourly_stats (
        hour      INTEGER NOT NULL,
        dow       INTEGER NOT NULL,
        plays     INTEGER NOT NULL DEFAULT 0,
        ms_played INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (hour, dow)
      ) WITHOUT ROWID;

      CREATE TABLE sessions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        start_ts        INTEGER NOT NULL,
        end_ts          INTEGER NOT NULL,
        duration_ms     INTEGER NOT NULL,
        ms_played       INTEGER NOT NULL,
        events          INTEGER NOT NULL,
        q_plays         INTEGER NOT NULL,
        unique_tracks   INTEGER NOT NULL,
        unique_artists  INTEGER NOT NULL,
        top_artist_id   INTEGER REFERENCES artists(id) ON DELETE SET NULL,
        top_track_id    INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
        max_repeats     INTEGER NOT NULL DEFAULT 0,
        diversity       REAL NOT NULL DEFAULT 0,
        local_date      TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_start ON sessions(start_ts);
      CREATE INDEX idx_sessions_date ON sessions(local_date);
      CREATE INDEX idx_sessions_duration ON sessions(ms_played DESC);

      CREATE TABLE eras (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        position       INTEGER NOT NULL,
        start_ym       TEXT NOT NULL,
        end_ym         TEXT NOT NULL,
        start_ts       INTEGER NOT NULL,
        end_ts         INTEGER NOT NULL,
        months         INTEGER NOT NULL,
        auto_title     TEXT NOT NULL,
        custom_title   TEXT,
        streams        INTEGER NOT NULL DEFAULT 0,
        q_plays        INTEGER NOT NULL DEFAULT 0,
        ms_played      INTEGER NOT NULL DEFAULT 0,
        new_artists    INTEGER NOT NULL DEFAULT 0,
        change_strength REAL NOT NULL DEFAULT 0,
        accent         TEXT NOT NULL DEFAULT 'brass'
      );
      CREATE INDEX idx_eras_position ON eras(position);

      CREATE TABLE era_artists (
        era_id    INTEGER NOT NULL REFERENCES eras(id) ON DELETE CASCADE,
        artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        plays     INTEGER NOT NULL,
        ms_played INTEGER NOT NULL,
        rank      INTEGER NOT NULL,
        PRIMARY KEY (era_id, artist_id)
      ) WITHOUT ROWID;

      CREATE TABLE era_tracks (
        era_id   INTEGER NOT NULL REFERENCES eras(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        plays    INTEGER NOT NULL,
        rank     INTEGER NOT NULL,
        PRIMARY KEY (era_id, track_id)
      ) WITHOUT ROWID;

      CREATE TABLE obsessions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        kind          TEXT NOT NULL,
        entity_id     INTEGER NOT NULL,
        window_days   INTEGER NOT NULL,
        window_start  INTEGER NOT NULL,
        window_end    INTEGER NOT NULL,
        window_plays  INTEGER NOT NULL,
        lifetime_plays INTEGER NOT NULL,
        share         REAL NOT NULL,
        plays_per_day REAL NOT NULL,
        plays_after   INTEGER NOT NULL DEFAULT 0,
        after_share   REAL NOT NULL DEFAULT 0,
        intensity     REAL NOT NULL DEFAULT 0,
        days_to_50    INTEGER,
        days_to_100   INTEGER,
        longest_run   INTEGER NOT NULL DEFAULT 0,
        peak_week     INTEGER NOT NULL DEFAULT 0,
        UNIQUE(kind, entity_id, window_days)
      );
      CREATE INDEX idx_obsessions_kind ON obsessions(kind, intensity DESC);
      CREATE INDEX idx_obsessions_entity ON obsessions(kind, entity_id);

      CREATE TABLE graveyard (
        kind             TEXT NOT NULL,
        entity_id        INTEGER NOT NULL,
        peak_year        INTEGER,
        historical_plays INTEGER NOT NULL,
        ms_played        INTEGER NOT NULL,
        last_ts          INTEGER NOT NULL,
        days_missing     INTEGER NOT NULL,
        rank_at_peak     INTEGER,
        score            REAL NOT NULL,
        PRIMARY KEY (kind, entity_id)
      ) WITHOUT ROWID;
      CREATE INDEX idx_graveyard_score ON graveyard(kind, score DESC);

      /* ---------------- personal layer ---------------- */

      CREATE TABLE tags (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        slug       TEXT NOT NULL UNIQUE,
        icon       TEXT NOT NULL DEFAULT 'Tag',
        color      TEXT NOT NULL DEFAULT '#D6B06A',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        position   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE track_tags (
        track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (track_id, tag_id)
      ) WITHOUT ROWID;
      CREATE INDEX idx_track_tags_tag ON track_tags(tag_id);

      CREATE TABLE notes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id   INTEGER NOT NULL,
        body        TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        UNIQUE(entity_type, entity_id)
      );

      CREATE TABLE track_flags (
        track_id   INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        favorite   INTEGER NOT NULL DEFAULT 0,
        retired    INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE smart_collections (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        description TEXT,
        icon        TEXT NOT NULL DEFAULT 'Sparkles',
        match_mode  TEXT NOT NULL DEFAULT 'all',
        pinned      INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE smart_collection_rules (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER NOT NULL REFERENCES smart_collections(id) ON DELETE CASCADE,
        field         TEXT NOT NULL,
        operator      TEXT NOT NULL,
        value         TEXT NOT NULL DEFAULT '',
        value2        TEXT,
        position      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_rules_collection ON smart_collection_rules(collection_id);
    `);
  },
};
