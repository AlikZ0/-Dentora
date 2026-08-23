import type { FileKind, StoredFile, Uuid } from '~/types/models'
import { db, type DentoraDatabase } from '../db'
import { uuid } from '~/utils/id'
import { nowIso } from '~/utils/datetime'

export interface FileDraft {
  clientId: Uuid
  workId?: Uuid
  name: string
  mimeType: string
  size: number
  kind: FileKind
  hash?: string
  thumbnail?: Blob
  width?: number
  height?: number
  createdAt?: string
}

export interface FileQuery {
  clientId?: Uuid
  workId?: Uuid
  kind?: FileKind
  includeDeleted?: boolean
}

/**
 * Files are split across two stores on purpose:
 *   `files`     - metadata + a small thumbnail, cheap to list
 *   `fileBlobs` - the original bytes, only ever read one at a time
 *
 * Nothing in this module returns the original blob unless explicitly asked.
 */
export function createFileRepository(database: DentoraDatabase = db()) {
  const meta = () => database.files
  const blobs = () => database.fileBlobs

  return {
    /** Writes metadata and bytes in one transaction so they cannot diverge. */
    async create(draft: FileDraft, blob: Blob): Promise<StoredFile> {
      const timestamp = draft.createdAt ?? nowIso()
      const record: StoredFile = {
        id: uuid(),
        clientId: draft.clientId,
        workId: draft.workId,
        name: draft.name,
        mimeType: draft.mimeType || blob.type || 'application/octet-stream',
        size: draft.size || blob.size,
        kind: draft.kind,
        hash: draft.hash,
        thumbnail: draft.thumbnail,
        width: draft.width,
        height: draft.height,
        createdAt: timestamp,
        updatedAt: timestamp,
        deleted: 0,
      }

      await database.transaction('rw', [database.files, database.fileBlobs], async () => {
        await database.files.add(record)
        await database.fileBlobs.add({ id: record.id, blob })
      })
      return record
    },

    /** Import path: keeps the incoming UUID, timestamps and hash. */
    async put(record: StoredFile, blob?: Blob): Promise<void> {
      await database.transaction('rw', [database.files, database.fileBlobs], async () => {
        await database.files.put(record)
        if (blob) await database.fileBlobs.put({ id: record.id, blob })
      })
    },

    async update(
      id: Uuid,
      patch: Partial<Pick<StoredFile, 'name' | 'kind' | 'workId'>>,
    ): Promise<StoredFile> {
      const existing = await meta().get(id)
      if (!existing) throw new Error(`file_not_found:${id.slice(0, 8)}`)
      const next: StoredFile = { ...existing, ...patch, updatedAt: nowIso() }
      await meta().put(next)
      return next
    },

    /** Metadata only - never touches `fileBlobs`. */
    async getById(id: Uuid): Promise<StoredFile | undefined> {
      return meta().get(id)
    },

    /** The original bytes. Call this only when the user opens the file. */
    async getBlob(id: Uuid): Promise<Blob | undefined> {
      const row = await blobs().get(id)
      return row?.blob
    },

    async getByClientId(clientId: Uuid, includeDeleted = false): Promise<StoredFile[]> {
      const rows = await meta().where('clientId').equals(clientId).toArray()
      const visible = includeDeleted ? rows : rows.filter((f) => !f.deleted)
      return visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    async getByWorkId(workId: Uuid, includeDeleted = false): Promise<StoredFile[]> {
      const rows = await meta().where('workId').equals(workId).toArray()
      const visible = includeDeleted ? rows : rows.filter((f) => !f.deleted)
      return visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    async query(q: FileQuery = {}): Promise<StoredFile[]> {
      let rows: StoredFile[]
      if (q.clientId) rows = await meta().where('clientId').equals(q.clientId).toArray()
      else if (q.workId) rows = await meta().where('workId').equals(q.workId).toArray()
      else rows = await meta().toArray()

      if (!q.includeDeleted) rows = rows.filter((f) => !f.deleted)
      if (q.kind) rows = rows.filter((f) => f.kind === q.kind)
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    async all(includeDeleted = false): Promise<StoredFile[]> {
      const rows = await meta().toArray()
      return includeDeleted ? rows : rows.filter((f) => !f.deleted)
    },

    async count(includeDeleted = false): Promise<number> {
      if (includeDeleted) return meta().count()
      return meta().where('deleted').equals(0).count()
    },

    async countByClient(clientId: Uuid): Promise<number> {
      const rows = await meta().where('clientId').equals(clientId).toArray()
      return rows.filter((f) => !f.deleted).length
    },

    /** Sum of `size` across live files. Cheap: metadata store only. */
    async totalSize(includeDeleted = false): Promise<number> {
      const rows = await meta().toArray()
      return rows
        .filter((f) => includeDeleted || !f.deleted)
        .reduce((sum, f) => sum + (f.size || 0), 0)
    },

    /** Existing hashes, so an import can skip bytes it already holds. */
    async hashIndex(): Promise<Map<string, Uuid>> {
      const rows = await meta().toArray()
      const index = new Map<string, Uuid>()
      for (const row of rows) if (row.hash) index.set(row.hash, row.id)
      return index
    },

    async softDelete(id: Uuid): Promise<void> {
      const timestamp = nowIso()
      await meta().update(id, { deleted: 1, deletedAt: timestamp, updatedAt: timestamp })
    },

    async restore(id: Uuid): Promise<void> {
      await meta().update(id, { deleted: 0, deletedAt: undefined, updatedAt: nowIso() })
    },

    /** Irreversible: removes metadata and bytes together. */
    async destroy(id: Uuid): Promise<void> {
      await database.transaction('rw', [database.files, database.fileBlobs], async () => {
        await database.fileBlobs.delete(id)
        await database.files.delete(id)
      })
    },

    /** Purges bytes for every soft-deleted file. Frees space without losing history. */
    async purgeDeleted(): Promise<number> {
      const rows = await meta().where('deleted').equals(1).primaryKeys()
      if (!rows.length) return 0
      await database.transaction('rw', [database.files, database.fileBlobs], async () => {
        await database.fileBlobs.bulkDelete(rows)
        await database.files.bulkDelete(rows)
      })
      return rows.length
    },
  }
}

export type FileRepository = ReturnType<typeof createFileRepository>

let cached: FileRepository | null = null
export function fileRepository(): FileRepository {
  if (!cached) cached = createFileRepository()
  return cached
}
export function resetFileRepository(): void {
  cached = null
}
