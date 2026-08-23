import type { Uuid, Work } from '~/types/models'
import { db, type DentoraDatabase } from '../db'
import { uuid } from '~/utils/id'
import { nowIso, todayIso } from '~/utils/datetime'

export type WorkDraft = {
  clientId: Uuid
  date?: string
  title: string
  description?: string
  notes?: string
}

export function createWorkRepository(database: DentoraDatabase = db()) {
  const table = () => database.works

  return {
    async create(draft: WorkDraft): Promise<Work> {
      const timestamp = nowIso()
      const work: Work = {
        id: uuid(),
        clientId: draft.clientId,
        date: draft.date?.trim() || todayIso(),
        title: draft.title.trim(),
        description: draft.description?.trim() ?? '',
        notes: draft.notes?.trim() ?? '',
        createdAt: timestamp,
        updatedAt: timestamp,
        deleted: 0,
      }
      await table().add(work)
      return work
    },

    async put(work: Work): Promise<void> {
      await table().put(work)
    },

    async bulkPut(works: Work[]): Promise<void> {
      if (works.length) await table().bulkPut(works)
    },

    async update(id: Uuid, patch: Partial<Omit<WorkDraft, 'clientId'>>): Promise<Work> {
      const existing = await table().get(id)
      if (!existing) throw new Error(`work_not_found:${id.slice(0, 8)}`)
      const next: Work = {
        ...existing,
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.date !== undefined ? { date: patch.date } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        updatedAt: nowIso(),
      }
      await table().put(next)
      return next
    },

    async getById(id: Uuid): Promise<Work | undefined> {
      return table().get(id)
    },

    /** Newest first - the client card shows the most recent work at the top. */
    async getByClientId(clientId: Uuid, includeDeleted = false): Promise<Work[]> {
      const rows = await table().where('clientId').equals(clientId).toArray()
      const visible = includeDeleted ? rows : rows.filter((w) => !w.deleted)
      return visible.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)))
    },

    async all(includeDeleted = false): Promise<Work[]> {
      const rows = await table().toArray()
      return includeDeleted ? rows : rows.filter((w) => !w.deleted)
    },

    async count(includeDeleted = false): Promise<number> {
      if (includeDeleted) return table().count()
      return table().where('deleted').equals(0).count()
    },

    async countByClient(clientId: Uuid): Promise<number> {
      const rows = await table().where('clientId').equals(clientId).toArray()
      return rows.filter((w) => !w.deleted).length
    },

    /** Works dated on or after `from`, newest first. Drives the dashboard. */
    async recent(limit = 5): Promise<Work[]> {
      const rows = await table().where('deleted').equals(0).toArray()
      return rows
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
    },

    async softDelete(id: Uuid): Promise<void> {
      const timestamp = nowIso()
      await table().update(id, { deleted: 1, deletedAt: timestamp, updatedAt: timestamp })
    },

    async restore(id: Uuid): Promise<void> {
      await table().update(id, { deleted: 0, deletedAt: undefined, updatedAt: nowIso() })
    },

    /** Irreversible. Attached files are detached, not deleted. */
    async destroy(id: Uuid): Promise<void> {
      await database.transaction('rw', [database.works, database.files], async () => {
        await database.files.where('workId').equals(id).modify({ workId: undefined })
        await database.works.delete(id)
      })
    },
  }
}

export type WorkRepository = ReturnType<typeof createWorkRepository>

let cached: WorkRepository | null = null
export function workRepository(): WorkRepository {
  if (!cached) cached = createWorkRepository()
  return cached
}
export function resetWorkRepository(): void {
  cached = null
}
