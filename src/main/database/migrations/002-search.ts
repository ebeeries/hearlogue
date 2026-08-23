import type { Migration } from '../types';

/**
 * Full-text search.
 *
 * FTS5 with the `unicode61` tokenizer plus diacritic folding, so "bjork" finds
 * "Björk" and "sigur ros" finds "Sigur Rós". The index is a contentless-style
 * table we own outright: it is rebuilt at the end of every analytics pass rather
 * than kept in sync by triggers, because imports write in large batches where
 * per-row triggers would dominate the cost.
 */
export const migration002: Migration = {
  version: 2,
  name: 'search',
  up: (db) => {
    db.exec(`
      CREATE VIRTUAL TABLE search_index USING fts5(
        title,
        subtitle,
        kind      UNINDEXED,
        entity_id UNINDEXED,
        tokenize  = "unicode61 remove_diacritics 2"
      );
    `);
  },
};
