import type { Db } from '../types';
import { TRACK_SUMMARY } from './projections';
import type {
  SmartCollection,
  SmartRule,
  RuleField,
  RuleOperator,
  TrackSummary,
} from '@shared/types/domain';
import type { Paginated } from '@shared/types/common';
import { MS_PER_DAY } from '@shared/utils/time';
import { HearlogueError, notFound } from '../../utils/errors';

/**
 * Smart Collections.
 *
 * Rules are compiled to parameterised SQL. Every value a user types is bound,
 * never interpolated: the field and operator select from a fixed table of known
 * expressions, and nothing else from the rule reaches the query text.
 */

interface CompiledField {
  /** SQL expression evaluated per track. */
  expr: string;
  type: 'number' | 'text' | 'boolean';
}

const FIELDS: Record<RuleField, CompiledField> = {
  plays: { expr: 'COALESCE(ts.q_plays, 0)', type: 'number' },
  qualifyingPlays: { expr: 'COALESCE(ts.q_plays, 0)', type: 'number' },
  msPlayed: { expr: 'COALESCE(ts.ms_played, 0) / 60000.0', type: 'number' },
  firstHeardYear: { expr: "CAST(strftime('%Y', ts.first_ts / 1000, 'unixepoch', 'localtime') AS INTEGER)", type: 'number' },
  lastHeardYear: { expr: "CAST(strftime('%Y', ts.last_ts / 1000, 'unixepoch', 'localtime') AS INTEGER)", type: 'number' },
  daysSinceLastPlay: { expr: '(@now - COALESCE(ts.last_ts, @now)) / 86400000.0', type: 'number' },
  lostFavoriteScore: { expr: 'COALESCE(ts.lost_score, 0)', type: 'number' },
  peakYear: { expr: 'COALESCE(ts.peak_year, 0)', type: 'number' },
  skipRate: {
    expr: 'CASE WHEN COALESCE(ts.plays, 0) > 0 THEN 100.0 * COALESCE(ts.skips, 0) / ts.plays ELSE 0 END',
    type: 'number',
  },
  artist: { expr: 'ar.name', type: 'text' },
  album: { expr: "COALESCE(al.name, '')", type: 'text' },
  tag: { expr: 'tag_names.names', type: 'text' },
  favorite: { expr: 'COALESCE(fl.favorite, 0)', type: 'boolean' },
  retired: { expr: 'COALESCE(fl.retired, 0)', type: 'boolean' },
};

const NUMERIC_OPERATORS: Partial<Record<RuleOperator, string>> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  eq: '=',
  neq: '!=',
};

interface CompiledRule {
  sql: string;
  params: Record<string, unknown>;
}

function compileRule(rule: SmartRule, index: number): CompiledRule {
  const field = FIELDS[rule.field];
  if (!field) throw new HearlogueError('VALIDATION', 'error.unknownRuleField', rule.field);

  const p = (suffix = '') => `r${index}${suffix}`;

  if (field.type === 'boolean') {
    if (rule.operator === 'isFalse') return { sql: `${field.expr} = 0`, params: {} };
    return { sql: `${field.expr} = 1`, params: {} };
  }

  if (field.type === 'text') {
    switch (rule.operator) {
      case 'eq':
        return { sql: `${field.expr} = @${p()} COLLATE NOCASE`, params: { [p()]: rule.value } };
      case 'neq':
        return { sql: `${field.expr} != @${p()} COLLATE NOCASE`, params: { [p()]: rule.value } };
      case 'notContains':
        return {
          sql: `COALESCE(${field.expr}, '') NOT LIKE @${p()} COLLATE NOCASE`,
          params: { [p()]: `%${rule.value}%` },
        };
      default:
        return {
          sql: `COALESCE(${field.expr}, '') LIKE @${p()} COLLATE NOCASE`,
          params: { [p()]: `%${rule.value}%` },
        };
    }
  }

  const numeric = Number(rule.value);
  if (rule.operator === 'between') {
    const second = Number(rule.value2 ?? rule.value);
    return {
      sql: `${field.expr} BETWEEN @${p('a')} AND @${p('b')}`,
      params: {
        [p('a')]: Number.isFinite(numeric) ? numeric : 0,
        [p('b')]: Number.isFinite(second) ? second : 0,
      },
    };
  }

  const operator = NUMERIC_OPERATORS[rule.operator] ?? '>=';
  return {
    sql: `${field.expr} ${operator} @${p()}`,
    params: { [p()]: Number.isFinite(numeric) ? numeric : 0 },
  };
}

export interface CompiledCollectionQuery {
  where: string;
  params: Record<string, unknown>;
  needsTags: boolean;
}

export function compileRules(
  rules: SmartRule[],
  matchMode: 'all' | 'any',
  now: number,
): CompiledCollectionQuery {
  if (rules.length === 0) {
    return { where: '1=1', params: { now }, needsTags: false };
  }
  const compiled = rules.map((rule, index) => compileRule(rule, index));
  const params: Record<string, unknown> = { now };
  for (const rule of compiled) Object.assign(params, rule.params);
  return {
    where: compiled.map((r) => `(${r.sql})`).join(matchMode === 'any' ? ' OR ' : ' AND '),
    params,
    needsTags: rules.some((r) => r.field === 'tag'),
  };
}

function collectionSql(where: string, needsTags: boolean): string {
  const tagJoin = needsTags
    ? `LEFT JOIN (
         SELECT tt.track_id, GROUP_CONCAT(tg.name, ' | ') AS names
         FROM track_tags tt JOIN tags tg ON tg.id = tt.tag_id
         GROUP BY tt.track_id
       ) tag_names ON tag_names.track_id = t.id`
    : '';
  return `
    ${TRACK_SUMMARY}
    LEFT JOIN track_flags fl ON fl.track_id = t.id
    ${tagJoin}
    WHERE ${where}
  `;
}

export function previewCollection(
  db: Db,
  rules: SmartRule[],
  matchMode: 'all' | 'any',
  offset: number,
  limit: number,
  now: number,
): Paginated<TrackSummary> {
  const compiled = compileRules(rules, matchMode, now);
  const base = collectionSql(compiled.where, compiled.needsTags);

  const items = db
    .prepare(`${base} ORDER BY COALESCE(ts.q_plays, 0) DESC, t.id ASC LIMIT @limit OFFSET @offset`)
    .all({ ...compiled.params, limit, offset }) as TrackSummary[];

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (${base.replace(TRACK_SUMMARY, TRACK_SUMMARY)} ) sub`,
      )
      .get(compiled.params) as { n: number }
  ).n;

  return { items, total, offset, limit };
}

function loadRules(db: Db, collectionId: number): SmartRule[] {
  return db
    .prepare(
      `SELECT id, field, operator, value, value2, position
       FROM smart_collection_rules WHERE collection_id = ? ORDER BY position ASC`,
    )
    .all(collectionId) as SmartRule[];
}

interface CollectionRow {
  id: number;
  name: string;
  description: string | null;
  icon: string;
  match_mode: 'all' | 'any';
  pinned: number;
  created_at: number;
  updated_at: number;
}

function hydrate(db: Db, row: CollectionRow, now: number, withCount: boolean): SmartCollection {
  const rules = loadRules(db, row.id);
  let count: number | undefined;
  if (withCount) {
    try {
      const compiled = compileRules(rules, row.match_mode, now);
      const base = collectionSql(compiled.where, compiled.needsTags);
      count = (
        db.prepare(`SELECT COUNT(*) AS n FROM (${base}) sub`).get(compiled.params) as { n: number }
      ).n;
    } catch {
      count = 0;
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    matchMode: row.match_mode,
    rules,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    count,
  };
}

export function listCollections(db: Db, now: number): SmartCollection[] {
  const rows = db
    .prepare('SELECT * FROM smart_collections ORDER BY pinned DESC, name COLLATE NOCASE ASC')
    .all() as CollectionRow[];
  return rows.map((row) => hydrate(db, row, now, true));
}

export function getCollection(db: Db, id: number, now: number): SmartCollection {
  const row = db.prepare('SELECT * FROM smart_collections WHERE id = ?').get(id) as
    | CollectionRow
    | undefined;
  if (!row) throw notFound(`collection:${id}`);
  return hydrate(db, row, now, true);
}

export interface SaveCollectionInput {
  id: number | null;
  name: string;
  description: string | null;
  icon: string;
  matchMode: 'all' | 'any';
  pinned: boolean;
  rules: SmartRule[];
}

export function saveCollection(db: Db, input: SaveCollectionInput, now: number): SmartCollection {
  // Validate before writing so a bad rule never leaves a half-saved collection.
  compileRules(input.rules, input.matchMode, now);

  const run = db.transaction((): number => {
    let id = input.id;
    if (id === null) {
      const info = db
        .prepare(
          `INSERT INTO smart_collections (name, description, icon, match_mode, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name,
          input.description,
          input.icon,
          input.matchMode,
          input.pinned ? 1 : 0,
          now,
          now,
        );
      id = Number(info.lastInsertRowid);
    } else {
      const info = db
        .prepare(
          `UPDATE smart_collections
           SET name = ?, description = ?, icon = ?, match_mode = ?, pinned = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name,
          input.description,
          input.icon,
          input.matchMode,
          input.pinned ? 1 : 0,
          now,
          id,
        );
      if (info.changes === 0) throw notFound(`collection:${id}`);
      db.prepare('DELETE FROM smart_collection_rules WHERE collection_id = ?').run(id);
    }

    const insertRule = db.prepare(
      `INSERT INTO smart_collection_rules (collection_id, field, operator, value, value2, position)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    input.rules.forEach((rule, index) => {
      insertRule.run(id, rule.field, rule.operator, rule.value, rule.value2 ?? null, index);
    });

    db.prepare("DELETE FROM search_index WHERE kind = 'collection' AND entity_id = ?").run(id);
    db.prepare(
      "INSERT INTO search_index (title, subtitle, kind, entity_id) VALUES (?, ?, 'collection', ?)",
    ).run(input.name, input.description ?? '', id);

    return id;
  });

  return getCollection(db, run(), now);
}

export function deleteCollection(db: Db, id: number): void {
  const info = db.prepare('DELETE FROM smart_collections WHERE id = ?').run(id);
  if (info.changes === 0) throw notFound(`collection:${id}`);
  db.prepare("DELETE FROM search_index WHERE kind = 'collection' AND entity_id = ?").run(id);
}

export function collectionTracks(
  db: Db,
  id: number,
  offset: number,
  limit: number,
  now: number,
): Paginated<TrackSummary> {
  const collection = getCollection(db, id, now);
  return previewCollection(db, collection.rules, collection.matchMode, offset, limit, now);
}

/** Days a rule expresses, useful for tests and for describing rules in the UI. */
export function daysFromYears(years: number): number {
  return Math.round(years * 365 * (MS_PER_DAY / MS_PER_DAY));
}
