import type { Db } from '../database/types';
import { BUILTIN_TAGS, STARTER_COLLECTIONS, DEFAULT_SETTINGS } from '@shared/models/defaults';
import { slugify } from '@shared/utils/hash';

/**
 * Seeds a fresh archive with the tags and Smart Collections that make the
 * personal layer useful from the first minute. Everything here is editable and
 * deletable — these are starting points, not fixtures.
 */
export function seedArchiveDefaults(db: Db): void {
  const run = db.transaction(() => {
    const tagCount = db.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number };
    if (tagCount.n === 0) {
      const insert = db.prepare(
        'INSERT INTO tags (name, slug, icon, color, is_builtin, position, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      );
      BUILTIN_TAGS.forEach((tag, index) => {
        insert.run(tag.name, tag.slug, tag.icon, tag.color, index, Date.now());
      });
    }

    const collectionCount = db.prepare('SELECT COUNT(*) AS n FROM smart_collections').get() as {
      n: number;
    };
    if (collectionCount.n === 0) {
      const insertCollection = db.prepare(
        `INSERT INTO smart_collections (name, description, icon, match_mode, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertRule = db.prepare(
        `INSERT INTO smart_collection_rules (collection_id, field, operator, value, value2, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const now = Date.now();
      for (const collection of STARTER_COLLECTIONS) {
        const info = insertCollection.run(
          collection.name,
          collection.description,
          collection.icon,
          collection.matchMode,
          collection.pinned ? 1 : 0,
          now,
          now,
        );
        const id = Number(info.lastInsertRowid);
        collection.rules.forEach((rule, index) => {
          insertRule.run(
            id,
            rule.field,
            rule.operator,
            rule.value,
            'value2' in rule ? ((rule as { value2?: string }).value2 ?? null) : null,
            index,
          );
        });
      }
    }

    const settingsCount = db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
    if (settingsCount.n === 0) {
      const insert = db.prepare(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
      );
      const now = Date.now();
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        insert.run(key, JSON.stringify(value), now);
      }
    }
  });
  run();
}

/** Ensures a tag exists, returning its id. Used by import and by the UI. */
export function ensureTag(
  db: Db,
  name: string,
  icon = 'Tag',
  color = '#D6B06A',
): number {
  const slug = slugify(name);
  const existing = db.prepare('SELECT id FROM tags WHERE slug = ?').get(slug) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tags').get() as { p: number }
  ).p;
  const info = db
    .prepare(
      'INSERT INTO tags (name, slug, icon, color, is_builtin, position, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    )
    .run(name, slug, icon, color, position, Date.now());
  return Number(info.lastInsertRowid);
}
