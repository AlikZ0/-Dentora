/**
 * IndexedDB schema definition.
 *
 * Rules enforced here:
 *  - Every schema change bumps `DB_VERSION` and adds a new `versions[]` entry.
 *    The old entries stay untouched forever, so a user upgrading from any
 *    older build replays the migration chain instead of losing their data.
 *  - The database is NEVER deleted on upgrade.
 *  - File bytes live in their own store (`fileBlobs`) so that reading file
 *    metadata never deserialises a 60 MB x-ray.
 */

export const DB_NAME = 'dentora'

/** Current schema version. Bump + append to `versions` when changing stores. */
export const DB_VERSION = 2

export const TABLES = {
  clients: 'clients',
  works: 'works',
  files: 'files',
  fileBlobs: 'fileBlobs',
  meta: 'meta',
} as const

export interface SchemaVersion {
  version: number
  /** Dexie store definition strings, keyed by table name. */
  stores: Record<string, string | null>
  /** Human-readable note, surfaced in Settings > Storage. */
  note: string
}

/**
 * v1 - initial shipped schema.
 * v2 - adds `files.kind` (x-ray / photo / document) plus its index, and
 *      indexes `files.workId` so a work can list its own attachments.
 */
export const versions: SchemaVersion[] = [
  {
    version: 1,
    note: 'Начальная схема: клиенты, работы, файлы.',
    stores: {
      clients: 'id, lastName, firstName, arrivalDate, createdAt, updatedAt, deleted',
      works: 'id, clientId, date, [clientId+date], createdAt, updatedAt, deleted',
      files: 'id, clientId, [clientId+createdAt], createdAt, updatedAt, deleted',
      fileBlobs: 'id',
      meta: 'key',
    },
  },
  {
    version: 2,
    note: 'Добавлены категории файлов (рентген / фото / документ) и связь файла с работой.',
    stores: {
      // Only the changed store needs to be re-declared; Dexie carries the rest over.
      files:
        'id, clientId, workId, [clientId+createdAt], [clientId+kind], kind, createdAt, updatedAt, deleted',
    },
  },
]
