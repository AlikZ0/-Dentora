import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AppSettings, BackupStats } from '~/types/models'
import { DEFAULT_SETTINGS } from '~/types/models'
import { metaRepository } from '~/database/repositories/meta'
import { clientRepository } from '~/database/repositories/clients'
import { workRepository } from '~/database/repositories/works'
import { fileRepository } from '~/database/repositories/files'
import { estimateStorage, isPersisted, requestPersistence } from '~/services/storage/storage'
import { isSameLocalDay, todayIso } from '~/utils/datetime'
import { logger } from '~/utils/logger'

export interface DashboardCounts {
  clients: number
  works: number
  files: number
  storageUsed: number
}

/**
 * Cross-page application state: counters for the dashboard, backup history,
 * settings and the once-a-day backup reminder.
 */
export const useAppStore = defineStore('app', () => {
  const ready = ref(false)
  const online = ref(true)
  const counts = ref<DashboardCounts>({ clients: 0, works: 0, files: 0, storageUsed: 0 })
  const backupStats = ref<BackupStats>({ backupCount: 0 })
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS })
  const storage = ref({ usage: 0, quota: 0, ratio: null as number | null, supported: false })
  const persisted = ref(false)
  const reminderVisible = ref(false)

  const backedUpToday = computed(() => isSameLocalDay(backupStats.value.lastExportAt))

  async function refreshCounts(): Promise<void> {
    const [clients, works, files, storageUsed] = await Promise.all([
      clientRepository().count(),
      workRepository().count(),
      fileRepository().count(),
      fileRepository().totalSize(),
    ])
    counts.value = { clients, works, files, storageUsed }
  }

  async function refreshBackupStats(): Promise<void> {
    backupStats.value = await metaRepository().getBackupStats()
  }

  async function refreshStorage(): Promise<void> {
    storage.value = await estimateStorage()
    persisted.value = await isPersisted()
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([refreshCounts(), refreshBackupStats(), refreshStorage()])
  }

  /**
   * Decides whether to show the "no backup today" banner. It appears at most
   * once per calendar day and only when the database actually has data.
   */
  async function evaluateReminder(): Promise<void> {
    if (!settings.value.dailyBackupReminder) return
    if (counts.value.clients === 0) return
    if (backedUpToday.value) return

    const today = todayIso()
    const shownOn = await metaRepository().getReminderShownOn()
    if (shownOn === today) return
    reminderVisible.value = true
  }

  async function dismissReminder(): Promise<void> {
    reminderVisible.value = false
    await metaRepository().setReminderShownOn(todayIso())
  }

  async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
    settings.value = await metaRepository().saveSettings(patch)
  }

  async function init(): Promise<void> {
    if (ready.value) return
    settings.value = await metaRepository().getSettings()
    await refreshAll()
    // Ask once; browsers that ignore it simply return false.
    await requestPersistence().then((granted) => {
      persisted.value = persisted.value || granted
    })
    await evaluateReminder()
    ready.value = true
    logger.info('app', `ready clients=${counts.value.clients} files=${counts.value.files}`)
  }

  function setOnline(value: boolean): void {
    online.value = value
  }

  return {
    ready,
    online,
    counts,
    backupStats,
    settings,
    storage,
    persisted,
    reminderVisible,
    backedUpToday,
    init,
    refreshAll,
    refreshCounts,
    refreshBackupStats,
    refreshStorage,
    evaluateReminder,
    dismissReminder,
    saveSettings,
    setOnline,
  }
})
