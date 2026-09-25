import type { Appointment, Client } from '~/types/models'
import { localDateTimeToDate, localNow } from '~/utils/schedule'
import { fullName } from '~/utils/format'

/**
 * Pure mapping from a Dentora visit to a Google Calendar event body.
 * Kept free of network and DOM so it can be unit tested.
 */

export interface GoogleEventOptions {
  /** IANA zone the wall-clock time is meant in, e.g. `Europe/Moscow`. */
  timeZone: string
  emailReminders: boolean
  invitePatient: boolean
}

export interface GoogleEventBody {
  summary: string
  description: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  status: 'confirmed' | 'cancelled'
  reminders: { useDefault: false; overrides: { method: 'popup' | 'email'; minutes: number }[] }
  attendees?: { email: string; displayName?: string }[]
  extendedProperties: { private: { dentoraAppointmentId: string } }
}

/** Google refuses reminders more than four weeks ahead. */
export const GOOGLE_MAX_REMINDER_MINUTES = 40_320

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL.test(value.trim())
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** `2026-08-24T10:30` → `2026-08-24T10:30:00` (RFC 3339 without offset). */
function toRfcLocal(value: string): string {
  return `${value}:00`
}

function addMinutes(value: string, minutes: number): string {
  const start = localDateTimeToDate(value)
  if (!start) return value
  return localNow(new Date(start.getTime() + minutes * 60_000))
}

export function buildGoogleEvent(
  appointment: Appointment,
  client: Client | undefined,
  options: GoogleEventOptions,
): GoogleEventBody {
  const patient = client ? fullName(client) : ''
  const summary = patient ? `${appointment.title} — ${patient}` : appointment.title

  const lines: string[] = []
  if (patient) lines.push(`Пациент: ${patient}`)
  if (client?.phone) lines.push(`Телефон: ${client.phone}`)
  if (appointment.notes.trim()) lines.push('', appointment.notes.trim())
  lines.push('', 'Создано в Dentora')

  const duration = appointment.durationMinutes > 0 ? appointment.durationMinutes : 30
  const minutes = Math.min(Math.max(0, appointment.remindMinutesBefore), GOOGLE_MAX_REMINDER_MINUTES)
  const overrides: GoogleEventBody['reminders']['overrides'] = [{ method: 'popup', minutes }]
  if (options.emailReminders) overrides.push({ method: 'email', minutes })

  const body: GoogleEventBody = {
    summary,
    description: lines.join('\n'),
    start: { dateTime: toRfcLocal(appointment.at), timeZone: options.timeZone },
    end: { dateTime: toRfcLocal(addMinutes(appointment.at, duration)), timeZone: options.timeZone },
    status: appointment.status === 'cancelled' ? 'cancelled' : 'confirmed',
    reminders: { useDefault: false, overrides },
    extendedProperties: { private: { dentoraAppointmentId: appointment.id } },
  }

  if (options.invitePatient && client && isValidEmail(client.email)) {
    body.attendees = [{ email: client.email.trim(), displayName: patient || undefined }]
  }
  return body
}

/**
 * What the sync has to do with one visit's Google copy.
 *  - `create` / `update`: push the event body;
 *  - `delete`: the visit is gone or cancelled, remove the event;
 *  - `skip`: nothing to mirror (e.g. an old visit that was never synced).
 */
export type GoogleSyncAction = 'create' | 'update' | 'delete' | 'skip'

export function planGoogleSync(appointment: Appointment, todayStart: string): GoogleSyncAction {
  const gone = appointment.deleted === 1 || appointment.status === 'cancelled'
  if (appointment.googleEventId) return gone ? 'delete' : 'update'
  if (gone) return 'skip'
  // Back-filling months of history would flood the calendar; only visits
  // from today onwards get a fresh event.
  return appointment.at >= todayStart ? 'create' : 'skip'
}
