import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freshDatabase, repositories, type Repos } from './helpers'
import type { DentoraDatabase } from '~/database/db'
import { isUuid } from '~/utils/id'
import {
  combineDateAndTime,
  dayKey,
  daysFromToday,
  describeDay,
  describeLeadTime,
  describeRelative,
  isValidLocalDateTime,
  localDateTimeToDate,
  localNow,
  plural,
  splitDateTime,
  startOfLocalDay,
} from '~/utils/schedule'

let database: DentoraDatabase
let repo: Repos
let clientId: string

/** A local wall-clock stamp `minutes` from `base`. */
function at(minutes: number, base = new Date()): string {
  return localNow(new Date(base.getTime() + minutes * 60_000))
}

beforeEach(async () => {
  database = freshDatabase()
  await database.open()
  repo = repositories(database)
  const client = await repo.clients.create({ firstName: 'Анна', lastName: 'Петрова' })
  clientId = client.id
})

afterEach(async () => {
  database.close()
  await database.delete()
})

describe('local wall-clock times', () => {
  it('round-trips through a Date without shifting', () => {
    const value = '2026-08-24T10:30'
    const date = localDateTimeToDate(value)!
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(7)
    expect(date.getDate()).toBe(24)
    expect(date.getHours()).toBe(10)
    expect(date.getMinutes()).toBe(30)
    expect(localNow(date)).toBe(value)
  })

  it('rejects malformed values', () => {
    expect(isValidLocalDateTime('2026-08-24T10:30')).toBe(true)
    expect(isValidLocalDateTime('2026-08-24')).toBe(false)
    expect(isValidLocalDateTime('2026-08-24T10:30:00Z')).toBe(false)
    expect(isValidLocalDateTime('not a time')).toBe(false)
    expect(isValidLocalDateTime(undefined)).toBe(false)
  })

  it('sorts lexicographically in chronological order', () => {
    const times = ['2026-08-24T14:00', '2026-08-24T09:15', '2026-09-01T08:00', '2026-08-23T23:59']
    expect([...times].sort()).toEqual([
      '2026-08-23T23:59',
      '2026-08-24T09:15',
      '2026-08-24T14:00',
      '2026-09-01T08:00',
    ])
  })

  it('splits and recombines the form fields', () => {
    expect(splitDateTime('2026-08-24T10:30')).toEqual({ day: '2026-08-24', time: '10:30' })
    expect(combineDateAndTime('2026-08-24', '10:30')).toBe('2026-08-24T10:30')
  })

  it('describes days relative to today', () => {
    const now = new Date(2026, 7, 24, 12, 0)
    expect(describeDay(dayKey(0, now), now)).toBe('Сегодня')
    expect(describeDay(dayKey(1, now), now)).toBe('Завтра')
    expect(describeDay(dayKey(2, now), now)).toBe('Послезавтра')
    expect(describeDay(dayKey(-1, now), now)).toBe('Вчера')
    expect(describeDay(dayKey(5, now), now)).toMatch(/\d+ [а-яё]+$/u)
    expect(daysFromToday(dayKey(3, now), now)).toBe(3)
  })

  it('handles a month boundary when stepping days', () => {
    const now = new Date(2026, 7, 31, 12, 0) // 31 August
    expect(dayKey(1, now)).toBe('2026-09-01')
    expect(dayKey(-1, now)).toBe('2026-08-30')
  })

  it('uses correct Russian plurals', () => {
    expect(plural(1, 'минуту', 'минуты', 'минут')).toBe('минуту')
    expect(plural(2, 'минуту', 'минуты', 'минут')).toBe('минуты')
    expect(plural(5, 'минуту', 'минуты', 'минут')).toBe('минут')
    expect(plural(11, 'минуту', 'минуты', 'минут')).toBe('минут')
    expect(plural(21, 'минуту', 'минуты', 'минут')).toBe('минуту')
    expect(plural(22, 'минуту', 'минуты', 'минут')).toBe('минуты')
  })

  it('describes relative times in both directions', () => {
    const now = new Date(2026, 7, 24, 12, 0)
    expect(describeRelative('2026-08-24T12:25', now)).toBe('через 25 минут')
    expect(describeRelative('2026-08-24T14:00', now)).toBe('через 2 часа')
    expect(describeRelative('2026-08-25T12:00', now)).toBe('через 1 день')
    expect(describeRelative('2026-08-24T11:45', now)).toBe('15 минут назад')
    expect(describeRelative('2026-08-24T12:00', now)).toBe('сейчас')
  })

  it('describes reminder lead times', () => {
    expect(describeLeadTime(0)).toBe('в момент визита')
    expect(describeLeadTime(15)).toBe('за 15 минут')
    expect(describeLeadTime(60)).toBe('за 1 час')
    expect(describeLeadTime(180)).toBe('за 3 часа')
    expect(describeLeadTime(1440)).toBe('за 1 день')
  })
})

describe('appointmentRepository', () => {
  it('creates a visit with defaults', async () => {
    const visit = await repo.appointments.create({ clientId, at: '2026-08-25T10:00' })

    expect(isUuid(visit.id)).toBe(true)
    expect(visit.status).toBe('scheduled')
    expect(visit.title).toBe('Визит')
    expect(visit.durationMinutes).toBe(30)
    expect(visit.remindMinutesBefore).toBe(60)
    expect(visit.notifiedAt).toBeUndefined()
    expect(visit.deleted).toBe(0)
  })

  it('lists a client’s visits newest first', async () => {
    await repo.appointments.create({ clientId, at: '2026-08-20T10:00', title: 'Старый' })
    await repo.appointments.create({ clientId, at: '2026-09-01T10:00', title: 'Новый' })
    const visits = await repo.appointments.getByClientId(clientId)
    expect(visits.map((v) => v.title)).toEqual(['Новый', 'Старый'])
  })

  it('lists upcoming visits soonest first and keeps earlier-today ones', async () => {
    const today = dayKey(0)
    await repo.appointments.create({ clientId, at: `${today}T08:00`, title: 'Утро' })
    await repo.appointments.create({ clientId, at: `${dayKey(1)}T09:00`, title: 'Завтра' })
    await repo.appointments.create({ clientId, at: `${dayKey(-3)}T09:00`, title: 'Прошлое' })

    const upcoming = await repo.appointments.upcoming()
    // A visit earlier today must still be listed, not vanish at noon.
    expect(upcoming.map((v) => v.title)).toEqual(['Утро', 'Завтра'])
    expect(startOfLocalDay()).toBe(`${today}T00:00`)
  })

  it('excludes cancelled and deleted visits from the upcoming list', async () => {
    const cancelled = await repo.appointments.create({ clientId, at: `${dayKey(1)}T10:00` })
    const removed = await repo.appointments.create({ clientId, at: `${dayKey(1)}T11:00` })
    await repo.appointments.create({ clientId, at: `${dayKey(1)}T12:00`, title: 'Остался' })

    await repo.appointments.setStatus(cancelled.id, 'cancelled')
    await repo.appointments.softDelete(removed.id)

    const upcoming = await repo.appointments.upcoming()
    expect(upcoming.map((v) => v.title)).toEqual(['Остался'])
  })

  it('groups today and tomorrow for the dashboard', async () => {
    await repo.appointments.create({ clientId, at: `${dayKey(0)}T09:00` })
    await repo.appointments.create({ clientId, at: `${dayKey(0)}T15:00` })
    await repo.appointments.create({ clientId, at: `${dayKey(1)}T11:00` })
    await repo.appointments.create({ clientId, at: `${dayKey(4)}T11:00` })

    const agenda = await repo.appointments.agenda()
    expect(agenda.today.length).toBe(2)
    expect(agenda.tomorrow.length).toBe(1)
    expect(await repo.appointments.countOnDay(dayKey(0))).toBe(2)
  })

  it('updates a visit and re-arms the reminder when it moves', async () => {
    const visit = await repo.appointments.create({ clientId, at: `${dayKey(1)}T10:00` })
    await repo.appointments.markNotified(visit.id)
    expect((await repo.appointments.getById(visit.id))!.notifiedAt).toBeDefined()

    await repo.appointments.update(visit.id, { at: `${dayKey(2)}T10:00` })
    const moved = await repo.appointments.getById(visit.id)
    // Rescheduling must let the reminder fire again for the new time.
    expect(moved!.notifiedAt).toBeUndefined()
    expect(moved!.at).toBe(`${dayKey(2)}T10:00`)
  })

  it('keeps the reminder armed when only the notes change', async () => {
    const visit = await repo.appointments.create({ clientId, at: `${dayKey(1)}T10:00` })
    await repo.appointments.markNotified(visit.id)
    await repo.appointments.update(visit.id, { notes: 'Взять снимок' })
    expect((await repo.appointments.getById(visit.id))!.notifiedAt).toBeDefined()
  })

  it('does not bump updatedAt when a reminder is delivered', async () => {
    const visit = await repo.appointments.create({ clientId, at: `${dayKey(1)}T10:00` })
    await new Promise((r) => setTimeout(r, 5))
    await repo.appointments.markNotified(visit.id)
    const after = await repo.appointments.getById(visit.id)
    // Delivery is device-local state; bumping updatedAt would make this device
    // win every merge for no reason.
    expect(after!.updatedAt).toBe(visit.updatedAt)
  })
})

describe('due reminders', () => {
  it('fires only once the lead time has been reached', async () => {
    const now = new Date()
    // 90 minutes out with a 60-minute lead: not due yet.
    await repo.appointments.create({
      clientId,
      at: at(90, now),
      remindMinutesBefore: 60,
      title: 'Позже',
    })
    // 30 minutes out with a 60-minute lead: due now.
    await repo.appointments.create({
      clientId,
      at: at(30, now),
      remindMinutesBefore: 60,
      title: 'Пора',
    })

    const due = await repo.appointments.dueReminders(now)
    expect(due.map((v) => v.title)).toEqual(['Пора'])
  })

  it('never fires the same reminder twice', async () => {
    const now = new Date()
    const visit = await repo.appointments.create({
      clientId,
      at: at(10, now),
      remindMinutesBefore: 60,
    })

    expect((await repo.appointments.dueReminders(now)).length).toBe(1)
    await repo.appointments.markNotified(visit.id)
    expect((await repo.appointments.dueReminders(now)).length).toBe(0)
  })

  it('drops reminders that are long overdue instead of spraying them', async () => {
    const now = new Date()
    // Opening the app a week later must not announce last week's visits.
    await repo.appointments.create({
      clientId,
      at: at(-60 * 24 * 7, now),
      remindMinutesBefore: 0,
      title: 'Неделю назад',
    })
    await repo.appointments.create({
      clientId,
      at: at(-30, now),
      remindMinutesBefore: 0,
      title: 'Полчаса назад',
    })

    const due = await repo.appointments.dueReminders(now, 120)
    expect(due.map((v) => v.title)).toEqual(['Полчаса назад'])
  })

  it('ignores cancelled, completed and deleted visits', async () => {
    const now = new Date()
    const cancelled = await repo.appointments.create({ clientId, at: at(5, now), remindMinutesBefore: 60 })
    const done = await repo.appointments.create({ clientId, at: at(5, now), remindMinutesBefore: 60 })
    const removed = await repo.appointments.create({ clientId, at: at(5, now), remindMinutesBefore: 60 })
    await repo.appointments.create({ clientId, at: at(5, now), remindMinutesBefore: 60, title: 'Активный' })

    await repo.appointments.setStatus(cancelled.id, 'cancelled')
    await repo.appointments.setStatus(done.id, 'done')
    await repo.appointments.softDelete(removed.id)

    const due = await repo.appointments.dueReminders(now)
    expect(due.map((v) => v.title)).toEqual(['Активный'])
  })

  it('fires at the visit time when the lead time is zero', async () => {
    const now = new Date()
    await repo.appointments.create({ clientId, at: at(5, now), remindMinutesBefore: 0, title: 'Скоро' })
    expect((await repo.appointments.dueReminders(now)).length).toBe(0)

    const later = new Date(now.getTime() + 6 * 60_000)
    expect((await repo.appointments.dueReminders(later)).length).toBe(1)
  })
})
