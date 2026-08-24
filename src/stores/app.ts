import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Appointment, AppSettings, BackupStats } from '~/types/models'
import { DEFAULT_SETTINGS } from '~/types/models'
import { metaRepository } from '~/database/repositories/meta'
import { clientRepository } from '~/database/repositories/clients'
import { workRepository } from '~/database/repositories/works'
import { fileRepository } from '~/database/repositories/files'
import { appointmentRepository } from '~/database/repositories/appointments'
import {
  notificationPermission,
  notificationsSupported,
  requestNotificationPermission,
  type NotificationPermissionState,
} from '~/services/notifications/notifications'
import { estimateStorage, isPersisted, requestPersistence } from '~/services/storage/storage'
import { isSameLocalDay, todayIso } from '~/utils/datetime'
import { logger } from '~/utils/logger'

export interface DashboardCounts {
  clients: number
  works: number
  files: number
  storageUsed: number
  appointments: number
}

/**
 * Cross-page application state: counters for the dashboard, backup history,
 * settings and the once-a-day backup reminder.
 */
export const useAppStore = defineStore('app', () => {
  const ready = ref(false)
  const online = ref(true)
  const counts = ref<DashboardCounts>({
    clients: 0,
    works: 0,
    files: 0,
    storageUsed: 0,
    appointments: 0,
  })
  const agenda = ref<{ today: Appointment[]; tomorrow: Appointment[] }>({ today: [], tomorrow: [] })
  const notificationState = ref<NotificationPermissionState>('default')
  const backupStats = ref<BackupStats>({ backupCount: 0 })
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS })
  const storage = ref({ usage: 0, quota: 0, ratio: null as number | null, supported: false })
  const persisted = ref(false)
  const reminderVisible = ref(false)

  const backedUpToday = computed(() => isSameLocalDay(backupStats.value.lastExportAt))

  async function refreshCounts(): Promise<void> {
    const [clients, works, files, storageUsed, appointments] = await Promise.all([
      clientRepository().count(),
      workRepository().count(),
      fileRepository().count(),
      fileRepository().totalSize(),
      appointmentRepository().count(),
    ])
    counts.value = { clients, works, files, storageUsed, appointments }
  }

  async function refreshAgenda(): Promise<void> {
    agenda.value = await appointmentRepository().agenda()
  }

  function refreshNotificationState(): void {
    notificationState.value = notificationPermission()
  }

  /**
   * Turning reminders on has two halves: our own setting and the browser's
   * permission. Both must be true, and the permission prompt only works from a
   * user gesture - so this is called straight from the toggle.
   */
  async function setAppointmentNotifications(enabled: boolean): Promise<NotificationPermissionState> {
    if (!enabled) {
      await saveSettings({ appointmentNotifications: false })
      return notificationState.value
    }
    const state = await requestNotificationPermission()
    notificationState.value = state
    await saveSettings({ appointmentNotifications: state === 'granted' })
    return state
  }

  async function refreshBackupStats(): Promise<void> {
    backupStats.value = await metaRepository().getBackupStats()
  }

  async function refreshStorage(): Promise<void> {
    storage.value = await estimateStorage()
    persisted.value = await isPersisted()
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([refreshCounts(), refreshBackupStats(), refreshStorage(), refreshAgenda()])
    refreshNotificationState()
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

  /** True only when our setting AND the browser permission are both on. */
  const notificationsActive = computed(
    () => settings.value.appointmentNotifications && notificationState.value === 'granted',
  )

  /** One short line explaining why reminders will not arrive, or empty. */
  const notificationHint = computed(() => {
    if (notificationsActive.value) return ''
    if (!notificationsSupported()) {
      return 'Этот браузер не поддерживает уведомления. Визиты будут видны в приложении.'
    }
    if (notificationState.value === 'denied') {
      return 'Уведомления заблокированы в настройках браузера — напоминания не придут.'
    }
    return 'Напоминания о визитах выключены. Включить в настройках.'
  })

  return {
    ready,
    online,
    counts,
    agenda,
    backupStats,
    settings,
    storage,
    persisted,
    reminderVisible,
    backedUpToday,
    notificationState,
    notificationsActive,
    notificationHint,
    init,
    refreshAll,
    refreshCounts,
    refreshAgenda,
    refreshBackupStats,
    refreshStorage,
    refreshNotificationState,
    setAppointmentNotifications,
    evaluateReminder,
    dismissReminder,
    saveSettings,
    setOnline,
  }
})
