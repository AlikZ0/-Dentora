import type { Appointment, AppSettings } from '~/types/models'
import { appointmentRepository } from '~/database/repositories/appointments'
import { clientRepository } from '~/database/repositories/clients'
import { metaRepository } from '~/database/repositories/meta'
import { startOfLocalDay } from '~/utils/schedule'
import { logger } from '~/utils/logger'
import { buildGoogleEvent, deviceTimeZone, isValidEmail, planGoogleSync } from './events'
import { deleteEvent, GoogleCalendarError, upsertEvent, validToken } from './calendar'

/**
 * Pushes local visits to Google Calendar. IndexedDB stays the source of
 * truth: a failed push never blocks saving, the visit just stays "pending"
 * (`updatedAt > googleSyncedAt`) and goes out on the next sync.
 */

export interface GoogleSyncResult {
  pushed: number
  removed: number
  skipped: number
  failed: number
  /** First error, already phrased for the user. */
  error?: string
}

export function googleSyncConfigured(settings: AppSettings): boolean {
  return settings.googleCalendarSync && isValidEmail(settings.googleEmail)
}

async function syncOne(appointment: Appointment, settings: AppSettings, token: string): Promise<'pushed' | 'removed' | 'skipped'> {
  const repo = appointmentRepository()
  const action = planGoogleSync(appointment, startOfLocalDay())
  const client = await clientRepository().getById(appointment.clientId)
  const notify = settings.googleInvitePatient && isValidEmail(client?.email)

  if (action === 'skip') {
    await repo.markGoogleSynced(appointment.id, appointment.googleEventId)
    return 'skipped'
  }
  if (action === 'delete') {
    await deleteEvent(token, appointment.googleEventId!, notify)
    await repo.markGoogleSynced(appointment.id, undefined)
    return 'removed'
  }
  const body = buildGoogleEvent(appointment, client, {
    timeZone: deviceTimeZone(),
    emailReminders: settings.googleEmailReminders,
    invitePatient: settings.googleInvitePatient,
  })
  const eventId = await upsertEvent(token, body, appointment.googleEventId, notify)
  await repo.markGoogleSynced(appointment.id, eventId)
  return 'pushed'
}

/**
 * Syncs the given visits, or every pending one when `ids` is omitted.
 * Never throws: the caller only has to decide how loudly to report.
 */
export async function syncToGoogle(ids?: string[]): Promise<GoogleSyncResult> {
  const result: GoogleSyncResult = { pushed: 0, removed: 0, skipped: 0, failed: 0 }
  const settings = await metaRepository().getSettings()
  if (!googleSyncConfigured(settings)) return result

  const token = validToken(settings.googleEmail)
  const pending = await appointmentRepository().pendingGoogleSync()
  const targets = ids ? pending.filter((a) => ids.includes(a.id)) : pending
  if (!targets.length) return result

  if (!token) {
    result.failed = targets.length
    result.error = 'Google Календарь не подключён. Откройте Настройки → Google Календарь и нажмите «Подключить».'
    return result
  }

  for (const appointment of targets) {
    try {
      result[await syncOne(appointment, settings, token)] += 1
    } catch (error) {
      result.failed += 1
      result.error ??=
        error instanceof GoogleCalendarError ? error.message : 'Не удалось синхронизировать визит с Google.'
      logger.warn('google', `sync failed ${(error as Error).name}`)
      // Without a valid token every remaining request would fail the same way.
      if (error instanceof GoogleCalendarError && error.status === 401) {
        result.failed += targets.length - (result.pushed + result.removed + result.skipped + result.failed)
        break
      }
    }
  }
  logger.info('google', `sync pushed=${result.pushed} removed=${result.removed} failed=${result.failed}`)
  return result
}

/** How many visits are still waiting to reach Google. */
export async function pendingGoogleCount(): Promise<number> {
  const start = startOfLocalDay()
  const rows = await appointmentRepository().pendingGoogleSync()
  return rows.filter((a) => planGoogleSync(a, start) !== 'skip').length
}
