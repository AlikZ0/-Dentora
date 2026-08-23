import Dexie, { type Table } from 'dexie'
import type { Client, FileBlob, MetaRecord, StoredFile, Work } from '~/types/models'
import { DB_NAME, DB_VERSION, versions } from './schema'
import { upgradeToV2 } from './migrations'

/**
 * The single Dexie connection for the app.
 *
 * Nothing above the repository layer should touch this object; components
 * and stores go through `src/database/repositories/*`.
 */
export class DentoraDatabase extends Dexie {
  clients!: Table<Client, string>
  works!: Table<Work, string>
  files!: Table<StoredFile, string>
  fileBlobs!: Table<FileBlob, string>
  meta!: Table<MetaRecord, string>

  constructor(name: string = DB_NAME) {
    super(name)

    // Replay every historical version in order so that a browser sitting on
    // v1 walks the whole chain up to the current version.
    for (const entry of versions) {
      const version = this.version(entry.version).stores(entry.stores)
      if (entry.version === 2) version.upgrade(upgradeToV2)
    }
  }
}

let instance: DentoraDatabase | null = null

/** Lazily created singleton. */
export function db(): DentoraDatabase {
  if (!instance) instance = new DentoraDatabase()
  return instance
}

/** Test helper: point the app at a different Dexie instance. */
export function setDatabase(next: DentoraDatabase | null): void {
  instance = next
}

/** The schema version the app expects; written into every backup manifest. */
export const currentDatabaseVersion = DB_VERSION

/**
 * Deletes every user row but keeps the database (and its version) in place.
 * Used by Replace-import and by "Удалить все данные".
 */
export async function clearAllData(target: DentoraDatabase = db()): Promise<void> {
  await target.transaction(
    'rw',
    [target.clients, target.works, target.files, target.fileBlobs],
    async () => {
      await Promise.all([
        target.clients.clear(),
        target.works.clear(),
        target.files.clear(),
        target.fileBlobs.clear(),
      ])
    },
  )
}

/** Full wipe including metadata. Only reachable from the multi-step confirm. */
export async function destroyDatabase(target: DentoraDatabase = db()): Promise<void> {
  await clearAllData(target)
  await target.meta.clear()
}
