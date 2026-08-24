import { onScopeDispose } from 'vue'
import { appointmentRepository } from '~/database/repositories/appointments'
import { clientRepository } from '~/database/repositories/clients'
import { metaRepository } from '~/database/repositories/meta'
import {
  agendaPayload,
  appointmentPayload,
  notificationPermission,
  showNotification,
} from '~/services/notifications/notifications'
import { dayKey } from '~/utils/schedule'
import { logger } from '~/utils/logger'

/**
 * Drives visit reminders while the app is running.
 *
 * A polling loop rather than one timer per appointment: timers do not survive
 * a suspended tab or a phone going to sleep, whereas a check on wake-up
 * catches everything that came due in the meantime. Each appointment records
 * `notifiedAt` the moment it fires, so a reminder is delivered exactly once
 * even across reloads.
 */

const CHECK_INTERVAL_MS = 30_000
/** Reminders older than this are dropped rather than delivered late. */
const GRACE_MINUTES = 120

let running = false

export function useAppointmentReminders() {
  let timer: ReturnType<typeof setInterval> | undefined

  async function enabled(): Promise<boolean> {
    if (notificationPermission() !== 'granted') return false
    const settings = await metaRepository().getSettings()
    return settings.appointmentNotifications
  }

  /** Delivers every reminder that has come due. Safe to call at any time. */
  async function check(now: Date = new Date()): Promise<number> {
    if (!(await enabled())) return 0

    const appointments = appointmentRepository()
    const due = await appointments.dueReminders(now, GRACE_MINUTES)
    if (!due.length) return 0

    const clients = await clientRepository().getMany([...new Set(due.map((a) => a.clientId))])
    const byId = new Map(clients.map((c) => [c.id, c]))

    let delivered = 0
    for (const appointment of due) {
      const client = byId.get(appointment.clientId)
      // A visit whose client was deleted is no longer worth announcing.
      if (client?.deleted) {
        await appointments.markNotified(appointment.id)
        continue
      }
      const ok = await showNotification(appointmentPayload(appointment, client))
      // Mark it either way: a platform that cannot deliver would otherwise
      // retry every 30 seconds forever.
      await appointments.markNotified(appointment.id)
      if (ok) delivered += 1
    }

    if (delivered) logger.info('notifications', `delivered ${delivered} reminder(s)`)
    return delivered
  }

  /** Once-a-day summary of the day's visits, shown on first open. */
  async function showDailyAgenda(now: Date = new Date()): Promise<boolean> {
    if (!(await enabled())) return false
    const settings = await metaRepository().getSettings()
    if (!settings.dailyAgenda) return false

    const meta = metaRepository()
    const today = dayKey(0, now)
    if ((await meta.get<string | undefined>('lastAgendaShownOn', undefined)) === today) return false

    const count = await appointmentRepository().countOnDay(today)
    // Nothing to announce yet: leave the day unmarked so that opening the app
    // again after booking something still produces the summary.
    if (count === 0) return false

    await meta.set('lastAgendaShownOn', today)
    return showNotification(agendaPayload(count))
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') void check()
  }

  /** No DOM outside the browser (tests, prerender): the loop simply idles. */
  const hasDom = () => typeof document !== 'undefined' && typeof window !== 'undefined'

  function start(): void {
    if (running) return
    running = true
    void check()
    void showDailyAgenda()
    if (!hasDom()) return

    timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
    // Catches everything that came due while the tab was backgrounded.
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onVisibilityChange)
  }

  function stop(): void {
    running = false
    if (timer) clearInterval(timer)
    timer = undefined
    if (!hasDom()) return

    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', onVisibilityChange)
  }

  onScopeDispose(stop)

  return { start, stop, check, showDailyAgenda }
}
