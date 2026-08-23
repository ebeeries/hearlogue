import type { Migration } from '../types';

/**
 * Late-night listening per artist.
 *
 * The artist page states what share of an artist's listening happened after
 * 10pm. Answering that from the event table means scanning every play by that
 * artist — a quarter of a million rows for a favourite in a large archive, and
 * the slowest thing on the page by an order of magnitude.
 *
 * It is a fixed aggregate over data that only changes on import, so it belongs
 * in the derived stats table like every other figure on that page.
 */
export const migration003: Migration = {
  version: 3,
  name: 'artist-night-plays',
  up: (db) => {
    db.exec(`
      ALTER TABLE artist_stats ADD COLUMN night_plays INTEGER NOT NULL DEFAULT 0;
    `);
  },
};
