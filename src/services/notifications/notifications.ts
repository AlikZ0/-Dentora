import type { Appointment, Client } from '~/types/models'
import { fullName } from '~/utils/format'
import { describeLeadTime, formatTime, localDateTimeToDate } from '~/utils/schedule'
import { logger } from '~/utils/logger'

/**
 * Visit reminders.
 *
 * There is no server, so there is no Web Push. What we can do is show a real
 * system notification while the app is running - including from a background
 * tab or a minimised standalone window. What we deliberately do NOT do is
 * promise delivery when the app has been fully closed: no browser guarantees
 * that without a push server, and the UI says so plainly rather than letting
 * the user rely on something that will silently fail.
 *
 * `ServiceWorkerRegistration.showNotification` is preferred over
 * `new Notification()` because it is the only form iOS supports (16.4+, and
 * only for a web app installed on the Home Screen).
 */

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission(): NotificationPermissionState {
  if (!notificationsSupported()) return 'unsupported'
  return Notification.permission as NotificationPermissionState
}

/**
 * Asks the browser for permission. Must be called from a user gesture -
 * Safari rejects the request otherwise, and Chrome ignores it.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!notificationsSupported()) return 'unsupported'
  if (Notification.permission !== 'default') {
    return Notification.permission as NotificationPermissionState
  }
  try {
    const result = await Notification.requestPermission()
    logger.info('notifications', `permission=${result}`)
    return result as NotificationPermissionState
  } catch {
    // Older Safari only offers the callback form.
    return notificationPermission()
  }
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}

export interface NotificationPayload {
  title: string
  body: string
  tag: string
  /** Deep link opened when the notification is clicked. */
  url?: string
}

/** Shows one notification. Resolves to false when it could not be delivered. */
export async function showNotification(payload: NotificationPayload): Promise<boolean> {
  if (notificationPermission() !== 'granted') return false

  const options: NotificationOptions = {
    body: payload.body,
    tag: payload.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/maskable-192.png',
    // Reminders should persist until acknowledged rather than auto-dismiss.
    requireInteraction: false,
    data: { url: payload.url ?? '/schedule' },
  }

  const swRegistration = await registration()
  if (swRegistration?.showNotification) {
    try {
      await swRegistration.showNotification(payload.title, options)
      return true
    } catch {
      /* fall through to the constructor form */
    }
  }

  try {
    // iOS Safari does not expose this constructor at all; the SW path above is
    // the one that works there.
    const notification = new Notification(payload.title, options)
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    return true
  } catch {
    logger.warn('notifications', 'delivery failed on this platform')
    return false
  }
}

/** Builds the reminder text for one visit. */
export function appointmentPayload(
  appointment: Appointment,
  client: Client | undefined,
): NotificationPayload {
  const who = client ? fullName(client) : 'Клиент'
  const time = formatTime(appointment.at)
  const lead =
    appointment.remindMinutesBefore > 0
      ? ` (напоминание ${describeLeadTime(appointment.remindMinutesBefore)})`
      : ''

  return {
    title: `${who} — ${time}`,
    body: `${appointment.title}${lead}`,
    tag: `appointment-${appointment.id}`,
    url: `/clients/${appointment.clientId}`,
  }
}

/** Summary shown once a day when the app is opened, if enabled. */
export function agendaPayload(count: number): NotificationPayload {
  return {
    title: 'Визиты на сегодня',
    body:
      count === 1
        ? 'Сегодня запланирован 1 визит'
        : `Сегодня запланировано визитов: ${count}`,
    tag: 'daily-agenda',
    url: '/schedule',
  }
}

/** True when the visit is in the past by more than a couple of hours. */
export function isStale(appointment: Appointment, now = new Date(), graceMinutes = 120): boolean {
  const start = localDateTimeToDate(appointment.at)
  if (!start) return true
  return now.getTime() - start.getTime() > graceMinutes * 60_000
}
