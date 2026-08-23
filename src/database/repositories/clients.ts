import type { Client, Uuid } from '~/types/models'
import { db, type DentoraDatabase } from '../db'
import { uuid } from '~/utils/id'
import { nowIso, todayIso } from '~/utils/datetime'

export type ClientDraft = {
  firstName: string
  lastName: string
  arrivalDate?: string
  phone?: string
  email?: string
  notes?: string
}

export type ClientSort = 'lastName' | 'arrivalDate' | 'createdAt' | 'updatedAt'

export interface ClientQuery {
  search?: string
  sort?: ClientSort
  direction?: 'asc' | 'desc'
  /** Only clients whose `arrivalDate` is on/after this date. */
  from?: string
  /** Only clients whose `arrivalDate` is on/before this date. */
  to?: string
  /** Include soft-deleted rows (the Trash view). */
  includeDeleted?: boolean
  /** Return *only* soft-deleted rows. */
  onlyDeleted?: boolean
  limit?: number
  offset?: number
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е') // ё -> е
}

/** Matches on name, phone, e-mail and notes; diacritic-insensitive for ё/е. */
function matchesSearch(client: Client, needle: string): boolean {
  if (!needle) return true
  const haystack = normalise(
    [client.lastName, client.firstName, client.phone ?? '', client.email ?? '', client.notes].join(
      ' ',
    ),
  )
  return needle.split(/\s+/).every((token) => haystack.includes(token))
}

export function createClientRepository(database: DentoraDatabase = db()) {
  const table = () => database.clients

  return {
    async create(draft: ClientDraft): Promise<Client> {
      const timestamp = nowIso()
      const client: Client = {
        id: uuid(),
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        arrivalDate: draft.arrivalDate?.trim() || todayIso(),
        phone: draft.phone?.trim() || undefined,
        email: draft.email?.trim() || undefined,
        notes: draft.notes?.trim() ?? '',
        createdAt: timestamp,
        updatedAt: timestamp,
        deleted: 0,
      }
      await table().add(client)
      return client
    },

    /** Inserts a record verbatim (import path) - keeps the incoming UUID and timestamps. */
    async put(client: Client): Promise<void> {
      await table().put(client)
    },

    async bulkPut(clients: Client[]): Promise<void> {
      if (clients.length) await table().bulkPut(clients)
    },

    async update(id: Uuid, patch: Partial<ClientDraft>): Promise<Client> {
      const existing = await table().get(id)
      if (!existing) throw new Error(`client_not_found:${id.slice(0, 8)}`)

      const next: Client = {
        ...existing,
        ...(patch.firstName !== undefined ? { firstName: patch.firstName.trim() } : {}),
        ...(patch.lastName !== undefined ? { lastName: patch.lastName.trim() } : {}),
        ...(patch.arrivalDate !== undefined ? { arrivalDate: patch.arrivalDate } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        phone: patch.phone !== undefined ? patch.phone.trim() || undefined : existing.phone,
        email: patch.email !== undefined ? patch.email.trim() || undefined : existing.email,
        updatedAt: nowIso(),
      }
      await table().put(next)
      return next
    },

    async getById(id: Uuid): Promise<Client | undefined> {
      return table().get(id)
    },

    async getMany(ids: Uuid[]): Promise<Client[]> {
      const rows = await table().bulkGet(ids)
      return rows.filter((row): row is Client => Boolean(row))
    },

    async all(includeDeleted = false): Promise<Client[]> {
      const rows = await table().toArray()
      return includeDeleted ? rows : rows.filter((c) => !c.deleted)
    },

    async count(includeDeleted = false): Promise<number> {
      if (includeDeleted) return table().count()
      return table().where('deleted').equals(0).count()
    },

    /**
     * Search + filter + sort. Runs in memory after an indexed pre-filter:
     * IndexedDB has no substring index, and for the scale this app targets
     * (thousands of clients) a single pass is far cheaper than maintaining
     * a token index.
     */
    async search(query: ClientQuery = {}): Promise<Client[]> {
      const {
        search = '',
        sort = 'lastName',
        direction = 'asc',
        from,
        to,
        includeDeleted = false,
        onlyDeleted = false,
        limit,
        offset = 0,
      } = query

      let rows = await table().toArray()

      if (onlyDeleted) rows = rows.filter((c) => c.deleted === 1)
      else if (!includeDeleted) rows = rows.filter((c) => c.deleted !== 1)

      if (from) rows = rows.filter((c) => c.arrivalDate >= from)
      if (to) rows = rows.filter((c) => c.arrivalDate <= to)

      const needle = normalise(search)
      if (needle) rows = rows.filter((c) => matchesSearch(c, needle))

      const factor = direction === 'desc' ? -1 : 1
      rows.sort((a, b) => {
        let cmp: number
        if (sort === 'lastName') {
          cmp =
            a.lastName.localeCompare(b.lastName, 'ru') ||
            a.firstName.localeCompare(b.firstName, 'ru')
        } else {
          cmp = String(a[sort]).localeCompare(String(b[sort]))
        }
        return cmp * factor
      })

      if (offset || limit !== undefined) {
        rows = rows.slice(offset, limit === undefined ? undefined : offset + limit)
      }
      return rows
    },

    /** Soft delete - the row stays recoverable from Settings > Корзина. */
    async softDelete(id: Uuid): Promise<void> {
      const timestamp = nowIso()
      await database.transaction('rw', [database.clients, database.works, database.files], async () => {
        await database.clients.update(id, { deleted: 1, deletedAt: timestamp, updatedAt: timestamp })
        await database.works
          .where('clientId')
          .equals(id)
          .modify({ deleted: 1, deletedAt: timestamp, updatedAt: timestamp })
        await database.files
          .where('clientId')
          .equals(id)
          .modify({ deleted: 1, deletedAt: timestamp, updatedAt: timestamp })
      })
    },

    async restore(id: Uuid): Promise<void> {
      const timestamp = nowIso()
      await database.transaction('rw', [database.clients, database.works, database.files], async () => {
        await database.clients.update(id, { deleted: 0, deletedAt: undefined, updatedAt: timestamp })
        await database.works
          .where('clientId')
          .equals(id)
          .modify({ deleted: 0, deletedAt: undefined, updatedAt: timestamp })
        await database.files
          .where('clientId')
          .equals(id)
          .modify({ deleted: 0, deletedAt: undefined, updatedAt: timestamp })
      })
    },

    /** Irreversible: drops the client, its works, its file metadata and blobs. */
    async destroy(id: Uuid): Promise<void> {
      await database.transaction(
        'rw',
        [database.clients, database.works, database.files, database.fileBlobs],
        async () => {
          const fileIds = await database.files.where('clientId').equals(id).primaryKeys()
          await database.fileBlobs.bulkDelete(fileIds)
          await database.files.where('clientId').equals(id).delete()
          await database.works.where('clientId').equals(id).delete()
          await database.clients.delete(id)
        },
      )
    },
  }
}

export type ClientRepository = ReturnType<typeof createClientRepository>

let cached: ClientRepository | null = null
/** Default repository bound to the app-wide database singleton. */
export function clientRepository(): ClientRepository {
  if (!cached) cached = createClientRepository()
  return cached
}
export function resetClientRepository(): void {
  cached = null
}
