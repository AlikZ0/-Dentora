import type { Appointment, AppointmentStatus, Uuid } from '~/types/models'
import { db, type DentoraDatabase } from '../db'
import { uuid } from '~/utils/id'
import { nowIso } from '~/utils/datetime'
import { localDateTimeToDate, localNow, startOfLocalDay } from '~/utils/schedule'

export interface AppointmentDraft {
  clientId: Uuid
  /** Local wall-clock start, `YYYY-MM-DDTHH:mm`. */
  at: string
  title?: string
  notes?: string
  durationMinutes?: number
  remindMinutesBefore?: number
}

export function createAppointmentRepository(database: DentoraDatabase = db()) {
  const table = () => database.appointments

  function visible(rows: Appointment[], includeDeleted: boolean): Appointment[] {
    return includeDeleted ? rows : rows.filter((a) => !a.deleted)
  }

  return {
    async create(draft: AppointmentDraft): Promise<Appointment> {
      const timestamp = nowIso()
      const appointment: Appointment = {
        id: uuid(),
        clientId: draft.clientId,
        at: draft.at,
        durationMinutes: draft.durationMinutes ?? 30,
        title: draft.title?.trim() || 'Визит',
        notes: draft.notes?.trim() ?? '',
        status: 'scheduled',
        remindMinutesBefore: draft.remindMinutesBefore ?? 60,
        createdAt: timestamp,
        updatedAt: timestamp,
        deleted: 0,
      }
      await table().add(appointment)
      return appointment
    },

    /** Import path: keeps the incoming UUID and timestamps. */
    async put(appointment: Appointment): Promise<void> {
      await table().put(appointment)
    },

    async bulkPut(appointments: Appointment[]): Promise<void> {
      if (appointments.length) await table().bulkPut(appointments)
    },

    async update(
      id: Uuid,
      patch: Partial<Omit<AppointmentDraft, 'clientId'>>,
    ): Promise<Appointment> {
      const existing = await table().get(id)
      if (!existing) throw new Error(`appointment_not_found:${id.slice(0, 8)}`)
      const movedInTime = patch.at !== undefined && patch.at !== existing.at
      const next: Appointment = {
        ...existing,
        ...(patch.at !== undefined ? { at: patch.at } : {}),
        ...(patch.title !== undefined ? { title: patch.title.trim() || 'Визит' } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.durationMinutes !== undefined ? { durationMinutes: patch.durationMinutes } : {}),
        ...(patch.remindMinutesBefore !== undefined
          ? { remindMinutesBefore: patch.remindMinutesBefore }
          : {}),
        // Rescheduling or changing the lead time re-arms the reminder.
        ...(movedInTime || patch.remindMinutesBefore !== undefined
          ? { notifiedAt: undefined }
          : {}),
        updatedAt: nowIso(),
      }
      await table().put(next)
      return next
    },

    async getById(id: Uuid): Promise<Appointment | undefined> {
      return table().get(id)
    },

    async getByClientId(clientId: Uuid, includeDeleted = false): Promise<Appointment[]> {
      const rows = await table().where('clientId').equals(clientId).toArray()
      return visible(rows, includeDeleted).sort((a, b) => b.at.localeCompare(a.at))
    },

    async all(includeDeleted = false): Promise<Appointment[]> {
      return visible(await table().toArray(), includeDeleted)
    },

    async count(includeDeleted = false): Promise<number> {
      if (includeDeleted) return table().count()
      return table().where('deleted').equals(0).count()
    },

    /**
     * Scheduled visits from `from` onwards, soonest first.
     * `from` defaults to the start of today, so a visit earlier today is still
     * listed rather than vanishing at noon.
     */
    async upcoming(options: { from?: string; limit?: number; clientId?: Uuid } = {}): Promise<
      Appointment[]
    > {
      const from = options.from ?? startOfLocalDay()
      const rows = (await table().toArray())
        .filter((a) => !a.deleted && a.status === 'scheduled' && a.at >= from)
        .filter((a) => !options.clientId || a.clientId === options.clientId)
        .sort((a, b) => a.at.localeCompare(b.at))
      return options.limit ? rows.slice(0, options.limit) : rows
    },

    /** Visits on one local calendar day, regardless of status. */
    async onDay(day: string, includeDeleted = false): Promise<Appointment[]> {
      const rows = (await table().toArray()).filter((a) => a.at.startsWith(day))
      return visible(rows, includeDeleted).sort((a, b) => a.at.localeCompare(b.at))
    },

    /**
     * Scheduled visits whose reminder is due and has not fired yet.
     *
     * Anything older than `graceMinutes` is skipped: reopening the app after a
     * week should not spray a dozen notifications for visits already past.
     */
    async dueReminders(now: Date = new Date(), graceMinutes = 120): Promise<Appointment[]> {
      const rows = await table().where('status').equals('scheduled').toArray()
      const current = now.getTime()
      return rows
        .filter((a) => !a.deleted && !a.notifiedAt)
        .filter((appointment) => {
          const start = localDateTimeToDate(appointment.at)
          if (!start) return false
          const dueAt = start.getTime() - appointment.remindMinutesBefore * 60_000
          return dueAt <= current && current - dueAt <= graceMinutes * 60_000
        })
        .sort((a, b) => a.at.localeCompare(b.at))
    },

    async markNotified(id: Uuid, at: string = nowIso()): Promise<void> {
      // `updatedAt` is intentionally untouched: delivering a local reminder is
      // not an edit, and bumping it would make this device win every merge.
      await table().update(id, { notifiedAt: at })
    },

    async setStatus(id: Uuid, status: AppointmentStatus): Promise<Appointment> {
      const existing = await table().get(id)
      if (!existing) throw new Error(`appointment_not_found:${id.slice(0, 8)}`)
      const next: Appointment = { ...existing, status, updatedAt: nowIso() }
      await table().put(next)
      return next
    },

    async softDelete(id: Uuid): Promise<void> {
      const timestamp = nowIso()
      await table().update(id, { deleted: 1, deletedAt: timestamp, updatedAt: timestamp })
    },

    async restore(id: Uuid): Promise<void> {
      await table().update(id, { deleted: 0, deletedAt: undefined, updatedAt: nowIso() })
    },

    async destroy(id: Uuid): Promise<void> {
      await table().delete(id)
    },

    /** How many scheduled visits fall on the given local day. */
    async countOnDay(day: string): Promise<number> {
      const rows = await this.onDay(day)
      return rows.filter((a) => a.status === 'scheduled').length
    },

    /** Convenience for the dashboard: today's and tomorrow's visits. */
    async agenda(now: Date = new Date()): Promise<{ today: Appointment[]; tomorrow: Appointment[] }> {
      const todayKey = localNow(now).slice(0, 10)
      const tomorrowDate = new Date(now)
      tomorrowDate.setDate(tomorrowDate.getDate() + 1)
      const tomorrowKey = localNow(tomorrowDate).slice(0, 10)
      const [today, tomorrow] = await Promise.all([this.onDay(todayKey), this.onDay(tomorrowKey)])
      return {
        today: today.filter((a) => a.status === 'scheduled'),
        tomorrow: tomorrow.filter((a) => a.status === 'scheduled'),
      }
    },
  }
}

export type AppointmentRepository = ReturnType<typeof createAppointmentRepository>

let cached: AppointmentRepository | null = null
export function appointmentRepository(): AppointmentRepository {
  if (!cached) cached = createAppointmentRepository()
  return cached
}
export function resetAppointmentRepository(): void {
  cached = null
}
