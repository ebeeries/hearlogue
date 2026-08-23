export type EntityKind = 'track' | 'artist' | 'album';
export type NoteEntityKind = EntityKind | 'era';

export interface Paginated<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export type AppErrorCode =
  | 'UNKNOWN'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'NO_ARCHIVE'
  | 'DB_LOCKED'
  | 'DB_CORRUPT'
  | 'DISK_FULL'
  | 'PERMISSION'
  | 'IMPORT_RUNNING'
  | 'IMPORT_CANCELLED'
  | 'IMPORT_NO_DATA'
  | 'UNSUPPORTED_FORMAT'
  | 'CORRUPT_ARCHIVE'
  | 'BACKUP_INCOMPATIBLE'
  | 'EXTERNAL_BLOCKED'
  | 'DEMO_ACTIVE';

export interface AppError {
  code: AppErrorCode;
  /** Localisation key used to render a human-friendly message. */
  messageKey: string;
  /** Optional already-resolved detail (file name, count, ...). */
  detail?: string;
}

export type SortDirection = 'asc' | 'desc';
