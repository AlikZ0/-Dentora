import type { AppSettings, BackupStats } from '~/types/models'
import { DEFAULT_SETTINGS } from '~/types/models'
import { db, type DentoraDatabase } from '../db'

export const META_KEYS = {
  backupStats: 'backupStats',
  settings: 'settings',
  lastReminderShownOn: 'lastReminderShownOn',
  installedAt: 'installedAt',
} as const

const EMPTY_STATS: BackupStats = { backupCount: 0 }

export function createMetaRepository(database: DentoraDatabase = db()) {
  const table = () => database.meta

  async function get<T>(key: string, fallback: T): Promise<T> {
    const row = await table().get(key)
    return row === undefined ? fallback : (row.value as T)
  }

  async function set<T>(key: string, value: T): Promise<void> {
    await table().put({ key, value })
  }

  return {
    get,
    set,

    async getBackupStats(): Promise<BackupStats> {
      return { ...EMPTY_STATS, ...(await get<Partial<BackupStats>>(META_KEYS.backupStats, {})) }
    },

    async recordExport(size: number, at: string): Promise<BackupStats> {
      const stats = await this.getBackupStats()
      const next: BackupStats = {
        ...stats,
        lastExportAt: at,
        lastBackupSize: size,
        backupCount: stats.backupCount + 1,
      }
      await set(META_KEYS.backupStats, next)
      return next
    },

    async recordImport(at: string): Promise<BackupStats> {
      const stats = await this.getBackupStats()
      const next: BackupStats = { ...stats, lastImportAt: at }
      await set(META_KEYS.backupStats, next)
      return next
    },

    async getSettings(): Promise<AppSettings> {
      return { ...DEFAULT_SETTINGS, ...(await get<Partial<AppSettings>>(META_KEYS.settings, {})) }
    },

    async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
      const next = { ...(await this.getSettings()), ...patch }
      await set(META_KEYS.settings, next)
      return next
    },

    async getReminderShownOn(): Promise<string | undefined> {
      return get<string | undefined>(META_KEYS.lastReminderShownOn, undefined)
    },

    async setReminderShownOn(day: string): Promise<void> {
      await set(META_KEYS.lastReminderShownOn, day)
    },
  }
}

export type MetaRepository = ReturnType<typeof createMetaRepository>

let cached: MetaRepository | null = null
export function metaRepository(): MetaRepository {
  if (!cached) cached = createMetaRepository()
  return cached
}
export function resetMetaRepository(): void {
  cached = null
}
