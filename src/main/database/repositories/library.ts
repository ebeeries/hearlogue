import type { Db } from '../types';
import { TRACK_SUMMARY } from './projections';
import type { Tag, Note, TrackFlags, TrackSummary, NoteEntityKindWire } from '@shared/types/domain';
import type { Paginated } from '@shared/types/common';
import { slugify } from '@shared/utils/hash';
import { HearlogueError, notFound } from '../../utils/errors';

/**
 * The personal layer: tags, notes and per-track flags.
 *
 * This is HEARLOGUE's own library, deliberately independent of anything Spotify
 * knows. It is also the most private data in the archive — notes especially —
 * and it never leaves the local database.
 */

export function listTags(db: Db): Tag[] {
  return (
    db
      .prepare(
        `SELECT t.id, t.name, t.slug, t.icon, t.color, t.is_builtin AS isBuiltin,
                (SELECT COUNT(*) FROM track_tags tt WHERE tt.tag_id = t.id) AS trackCount
         FROM tags t ORDER BY t.position ASC, t.id ASC`,
      )
      .all() as (Omit<Tag, 'isBuiltin'> & { isBuiltin: number })[]
  ).map((row) => ({ ...row, isBuiltin: row.isBuiltin === 1 }));
}

export function createTag(db: Db, name: string, icon: string, color: string): Tag {
  const slug = slugify(name);
  const exists = db.prepare('SELECT id FROM tags WHERE slug = ?').get(slug);
  if (exists) throw new HearlogueError('VALIDATION', 'error.tagExists', name);

  const position = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tags').get() as { p: number }
  ).p;
  const info = db
    .prepare(
      'INSERT INTO tags (name, slug, icon, color, is_builtin, position, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    )
    .run(name, slug, icon, color, position, Date.now());

  return {
    id: Number(info.lastInsertRowid),
    name,
    slug,
    icon,
    color,
    isBuiltin: false,
    trackCount: 0,
  };
}

export function updateTag(
  db: Db,
  id: number,
  patch: { name?: string; icon?: string; color?: string },
): Tag {
  const current = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as
    | { id: number; name: string; slug: string; icon: string; color: string; is_builtin: number }
    | undefined;
  if (!current) throw notFound(`tag:${id}`);

  const name = patch.name ?? current.name;
  const slug = patch.name ? slugify(patch.name) : current.slug;

  if (slug !== current.slug) {
    const clash = db.prepare('SELECT id FROM tags WHERE slug = ? AND id != ?').get(slug, id);
    if (clash) throw new HearlogueError('VALIDATION', 'error.tagExists', name);
  }

  db.prepare('UPDATE tags SET name = ?, slug = ?, icon = ?, color = ? WHERE id = ?').run(
    name,
    slug,
    patch.icon ?? current.icon,
    patch.color ?? current.color,
    id,
  );

  return {
    id,
    name,
    slug,
    icon: patch.icon ?? current.icon,
    color: patch.color ?? current.color,
    isBuiltin: current.is_builtin === 1,
  };
}

export function deleteTag(db: Db, id: number): void {
  const info = db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  if (info.changes === 0) throw notFound(`tag:${id}`);
}

export function assignTag(db: Db, trackId: number, tagId: number): void {
  const track = db.prepare('SELECT id FROM tracks WHERE id = ?').get(trackId);
  if (!track) throw notFound(`track:${trackId}`);
  const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId);
  if (!tag) throw notFound(`tag:${tagId}`);
  db.prepare(
    'INSERT INTO track_tags (track_id, tag_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
  ).run(trackId, tagId, Date.now());
}

export function unassignTag(db: Db, trackId: number, tagId: number): void {
  db.prepare('DELETE FROM track_tags WHERE track_id = ? AND tag_id = ?').run(trackId, tagId);
}

export function setTrackFlags(
  db: Db,
  trackId: number,
  patch: { favorite?: boolean; retired?: boolean },
): TrackFlags {
  const track = db.prepare('SELECT id FROM tracks WHERE id = ?').get(trackId);
  if (!track) throw notFound(`track:${trackId}`);

  const current = (db.prepare('SELECT favorite, retired FROM track_flags WHERE track_id = ?').get(
    trackId,
  ) as { favorite: number; retired: number } | undefined) ?? { favorite: 0, retired: 0 };

  const favorite = patch.favorite ?? current.favorite === 1;
  const retired = patch.retired ?? current.retired === 1;

  db.prepare(
    `INSERT INTO track_flags (track_id, favorite, retired, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(track_id) DO UPDATE SET favorite = excluded.favorite, retired = excluded.retired, updated_at = excluded.updated_at`,
  ).run(trackId, favorite ? 1 : 0, retired ? 1 : 0, Date.now());

  return { favorite, retired };
}

export function getNote(db: Db, entityType: NoteEntityKindWire, entityId: number): Note | null {
  const row = db
    .prepare(
      `SELECT id, entity_type AS entityType, entity_id AS entityId, body,
              created_at AS createdAt, updated_at AS updatedAt
       FROM notes WHERE entity_type = ? AND entity_id = ?`,
    )
    .get(entityType, entityId) as Note | undefined;
  return row ?? null;
}

export function setNote(
  db: Db,
  entityType: NoteEntityKindWire,
  entityId: number,
  body: string,
): Note | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    db.prepare('DELETE FROM notes WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
    return null;
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO notes (entity_type, entity_id, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_id)
     DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
  ).run(entityType, entityId, trimmed, now, now);
  return getNote(db, entityType, entityId);
}

export interface NoteWithSubject extends Note {
  subject: string;
  secondary: string | null;
}

/** Every note, with enough context to render a browsable list. */
export function listNotes(db: Db): NoteWithSubject[] {
  return db
    .prepare(
      `SELECT n.id, n.entity_type AS entityType, n.entity_id AS entityId, n.body,
              n.created_at AS createdAt, n.updated_at AS updatedAt,
              CASE n.entity_type
                WHEN 'track'  THEN (SELECT t.name FROM tracks t WHERE t.id = n.entity_id)
                WHEN 'artist' THEN (SELECT a.name FROM artists a WHERE a.id = n.entity_id)
                WHEN 'album'  THEN (SELECT al.name FROM albums al WHERE al.id = n.entity_id)
                WHEN 'era'    THEN (SELECT COALESCE(e.custom_title, e.auto_title) FROM eras e WHERE e.id = n.entity_id)
              END AS subject,
              CASE n.entity_type
                WHEN 'track'  THEN (SELECT ar.name FROM tracks t JOIN artists ar ON ar.id = t.artist_id WHERE t.id = n.entity_id)
                WHEN 'album'  THEN (SELECT ar.name FROM albums al JOIN artists ar ON ar.id = al.artist_id WHERE al.id = n.entity_id)
                WHEN 'era'    THEN (SELECT e.start_ym || ' – ' || e.end_ym FROM eras e WHERE e.id = n.entity_id)
                ELSE NULL
              END AS secondary
       FROM notes n
       ORDER BY n.updated_at DESC`,
    )
    .all() as NoteWithSubject[];
}

export interface LibraryQuery {
  tagId: number | null;
  search: string;
  sort: 'plays' | 'msPlayed' | 'recent' | 'name' | 'artist' | 'lostFavorite';
  direction: 'asc' | 'desc';
  offset: number;
  limit: number;
  status: 'any' | 'favorite' | 'retired' | 'tagged' | 'untagged';
}

export interface LibraryTrack extends TrackSummary {
  favorite: boolean;
  retired: boolean;
  lostFavoriteScore: number;
  tagIds: number[];
}

const SORT_COLUMNS: Record<LibraryQuery['sort'], string> = {
  plays: 'COALESCE(ts.q_plays, 0)',
  msPlayed: 'COALESCE(ts.ms_played, 0)',
  recent: 'COALESCE(ts.last_ts, 0)',
  name: 't.name COLLATE NOCASE',
  artist: 'ar.name COLLATE NOCASE',
  lostFavorite: 'COALESCE(ts.lost_score, 0)',
};

export function libraryTracks(db: Db, query: LibraryQuery): Paginated<LibraryTrack> {
  const where: string[] = [];
  const params: Record<string, unknown> = { limit: query.limit, offset: query.offset };

  if (query.tagId !== null) {
    where.push('EXISTS (SELECT 1 FROM track_tags tt WHERE tt.track_id = t.id AND tt.tag_id = @tagId)');
    params.tagId = query.tagId;
  }
  if (query.search.trim().length > 0) {
    where.push('(t.name LIKE @search COLLATE NOCASE OR ar.name LIKE @search COLLATE NOCASE)');
    params.search = `%${query.search.trim()}%`;
  }
  switch (query.status) {
    case 'favorite':
      where.push('EXISTS (SELECT 1 FROM track_flags f WHERE f.track_id = t.id AND f.favorite = 1)');
      break;
    case 'retired':
      where.push('EXISTS (SELECT 1 FROM track_flags f WHERE f.track_id = t.id AND f.retired = 1)');
      break;
    case 'tagged':
      where.push('EXISTS (SELECT 1 FROM track_tags tt WHERE tt.track_id = t.id)');
      break;
    case 'untagged':
      where.push('NOT EXISTS (SELECT 1 FROM track_tags tt WHERE tt.track_id = t.id)');
      break;
    default:
      break;
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = `ORDER BY ${SORT_COLUMNS[query.sort]} ${query.direction === 'asc' ? 'ASC' : 'DESC'}, t.id ASC`;

  const items = db
    .prepare(
      `SELECT sub.*,
              COALESCE(f.favorite, 0) AS favoriteRaw,
              COALESCE(f.retired, 0) AS retiredRaw,
              COALESCE(lts.lost_score, 0) AS lostFavoriteScore
       FROM (${TRACK_SUMMARY} ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset) sub
       LEFT JOIN track_flags f ON f.track_id = sub.id
       LEFT JOIN track_stats lts ON lts.track_id = sub.id`,
    )
    .all(params) as (TrackSummary & {
    favoriteRaw: number;
    retiredRaw: number;
    lostFavoriteScore: number;
  })[];

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM tracks t
         JOIN artists ar ON ar.id = t.artist_id
         LEFT JOIN track_stats ts ON ts.track_id = t.id
         ${whereSql}`,
      )
      .get(params) as { n: number }
  ).n;

  const tagStmt = db.prepare('SELECT tag_id FROM track_tags WHERE track_id = ?').pluck();

  return {
    items: items.map((row) => {
      const { favoriteRaw, retiredRaw, ...rest } = row;
      return {
        ...rest,
        favorite: favoriteRaw === 1,
        retired: retiredRaw === 1,
        tagIds: tagStmt.all(row.id) as number[],
      };
    }),
    total,
    offset: query.offset,
    limit: query.limit,
  };
}
