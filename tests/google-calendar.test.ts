import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freshDatabase, repositories, type Repos } from './helpers'
import type { DentoraDatabase } from '~/database/db'
import type { Appointment, Client } from '~/types/models'
import {
  buildGoogleEvent,
  GOOGLE_MAX_REMINDER_MINUTES,
  isValidEmail,
  planGoogleSync,
} from '~/services/google/events'

const options = { timeZone: 'Europe/Moscow', emailReminders: false, invitePatient: false }

function visit(patch: Partial<Appointment> = {}): Appointment {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    clientId: '550e8400-e29b-41d4-a716-446655440001',
    at: '2026-08-24T10:30',
    durationMinutes: 45,
    title: 'Чистка',
    notes: '',
    status: 'scheduled',
    remindMinutesBefore: 60,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    deleted: 0,
    ...patch,
  }
}

const client: Client = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  firstName: 'Анна',
  lastName: 'Петрова',
  arrivalDate: '2026-01-01',
  phone: '+7 900 000-00-00',
  email: 'anna@example.com',
  notes: 'private client note',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deleted: 0,
}

describe('buildGoogleEvent', () => {
  it('maps wall-clock time, duration and reminder', () => {
    const body = buildGoogleEvent(visit(), client, options)
    expect(body.summary).toBe('Чистка — Петрова Анна')
    expect(body.start).toEqual({ dateTime: '2026-08-24T10:30:00', timeZone: 'Europe/Moscow' })
    expect(body.end).toEqual({ dateTime: '2026-08-24T11:15:00', timeZone: 'Europe/Moscow' })
    expect(body.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] })
    expect(body.extendedProperties.private.dentoraAppointmentId).toBe(visit().id)
    expect(body.attendees).toBeUndefined()
  })

  it('crosses midnight correctly', () => {
    const body = buildGoogleEvent(visit({ at: '2026-08-24T23:45', durationMinutes: 30 }), client, options)
    expect(body.end.dateTime).toBe('2026-08-25T00:15:00')
  })

  it('adds the e-mail reminder and clamps the lead time to what Google accepts', () => {
    const body = buildGoogleEvent(visit({ remindMinutesBefore: 99_999 }), client, {
      ...options,
      emailReminders: true,
    })
    expect(body.reminders.overrides).toEqual([
      { method: 'popup', minutes: GOOGLE_MAX_REMINDER_MINUTES },
      { method: 'email', minutes: GOOGLE_MAX_REMINDER_MINUTES },
    ])
  })

  it('invites the patient only when asked and the e-mail is valid', () => {
    const invited = buildGoogleEvent(visit(), client, { ...options, invitePatient: true })
    expect(invited.attendees).toEqual([{ email: 'anna@example.com', displayName: 'Петрова Анна' }])

    const noEmail = buildGoogleEvent(visit(), { ...client, email: 'nope' }, { ...options, invitePatient: true })
    expect(noEmail.attendees).toBeUndefined()
  })

  it('puts the phone and visit notes in the description but never the client notes', () => {
    const body = buildGoogleEvent(visit({ notes: 'Взять снимок' }), client, options)
    expect(body.description).toContain('+7 900 000-00-00')
    expect(body.description).toContain('Взять снимок')
    expect(body.description).not.toContain('private client note')
  })
})

describe('planGoogleSync', () => {
  const today = '2026-08-24T00:00'

  it('creates events for today and later, skips history', () => {
    expect(planGoogleSync(visit(), today)).toBe('create')
    expect(planGoogleSync(visit({ at: '2026-08-23T10:00' }), today)).toBe('skip')
  })

  it('updates an existing event, even for a past visit', () => {
    expect(planGoogleSync(visit({ googleEventId: 'e1', at: '2026-08-01T10:00' }), today)).toBe('update')
  })

  it('removes the event of a cancelled or deleted visit', () => {
    expect(planGoogleSync(visit({ googleEventId: 'e1', status: 'cancelled' }), today)).toBe('delete')
    expect(planGoogleSync(visit({ googleEventId: 'e1', deleted: 1 }), today)).toBe('delete')
    expect(planGoogleSync(visit({ deleted: 1 }), today)).toBe('skip')
  })
})

describe('isValidEmail', () => {
  it('accepts a Gmail and rejects junk', () => {
    expect(isValidEmail('doctor@gmail.com')).toBe(true)
    expect(isValidEmail(' doctor@gmail.com ')).toBe(true)
    expect(isValidEmail('doctor@')).toBe(false)
    expect(isValidEmail(undefined)).toBe(false)
  })
})

describe('google sync bookkeeping', () => {
  let database: DentoraDatabase
  let repo: Repos

  beforeEach(async () => {
    database = freshDatabase()
    await database.open()
    repo = repositories(database)
  })

  afterEach(async () => {
    database.close()
    await database.delete()
  })

  it('tracks pending visits without touching updatedAt', async () => {
    const c = await repo.clients.create({ firstName: 'Анна', lastName: 'Петрова' })
    const a = await repo.appointments.create({ clientId: c.id, at: '2099-01-01T10:00' })
    expect((await repo.appointments.pendingGoogleSync()).map((x) => x.id)).toEqual([a.id])

    await repo.appointments.markGoogleSynced(a.id, 'evt-1', '2999-01-01T00:00:00.000Z')
    const synced = await repo.appointments.getById(a.id)
    expect(synced?.googleEventId).toBe('evt-1')
    expect(synced?.updatedAt).toBe(a.updatedAt)
    expect(await repo.appointments.pendingGoogleSync()).toEqual([])

    const edited = await repo.appointments.update(a.id, { title: 'Пломба' })
    await repo.appointments.markGoogleSynced(a.id, 'evt-1', '2000-01-01T00:00:00.000Z')
    expect(edited.googleEventId).toBe('evt-1')
    expect((await repo.appointments.pendingGoogleSync()).length).toBe(1)
  })
})
