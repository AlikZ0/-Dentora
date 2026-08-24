import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The reminder loop, driven against a real IndexedDB but with the platform
 * notification call stubbed - what matters here is *which* reminders are
 * chosen, how often, and what happens when delivery fails.
 */
const delivered: { title: string; body: string; tag: string }[] = []
let permission: 'granted' | 'denied' | 'default' | 'unsupported' = 'granted'
let deliverySucceeds = true

vi.mock('~/services/notifications/notifications', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~/services/notifications/notifications')
  >()
  return {
    ...actual,
    notificationsSupported: () => permission !== 'unsupported',
    notificationPermission: () => permission,
    requestNotificationPermission: async () => permission,
    showNotification: async (payload: { title: string; body: string; tag: string }) => {
      if (!deliverySucceeds) return false
      delivered.push(payload)
      return true
    },
  }
})

const { useAppointmentReminders } = await import('~/composables/useAppointmentReminders')
const { DentoraDatabase, setDatabase } = await import('~/database/db')
const { appointmentRepository, resetAppointmentRepository } = await import(
  '~/database/repositories/appointments'
)
const { clientRepository, resetClientRepository } = await import(
  '~/database/repositories/clients'
)
const { metaRepository, resetMetaRepository } = await import('~/database/repositories/meta')
const { resetFileRepository } = await import('~/database/repositories/files')
const { resetWorkRepository } = await import('~/database/repositories/works')
const { localNow, dayKey } = await import('~/utils/schedule')

let database: InstanceType<typeof DentoraDatabase>
let clientId: string
let scope: ReturnType<typeof effectScope>

/** The composable registers an onScopeDispose hook, so give it a real scope. */
function reminders() {
  return scope.run(() => useAppointmentReminders())!
}

/** Local wall-clock stamp `minutes` from now. */
function at(minutes: number, base = new Date()): string {
  return localNow(new Date(base.getTime() + minutes * 60_000))
}

beforeEach(async () => {
  delivered.length = 0
  permission = 'granted'
  deliverySucceeds = true
  scope = effectScope()

  database = new DentoraDatabase(`dentora-reminders-${Math.random().toString(36).slice(2)}`)
  await database.open()
  // Point the app-wide singletons at this test database.
  setDatabase(database)
  resetAppointmentRepository()
  resetClientRepository()
  resetMetaRepository()
  resetFileRepository()
  resetWorkRepository()

  await metaRepository().saveSettings({ appointmentNotifications: true, dailyAgenda: true })
  const client = await clientRepository().create({ firstName: 'Анна', lastName: 'Петрова' })
  clientId = client.id
})

afterEach(async () => {
  scope.stop()
  database.close()
  await database.delete()
  setDatabase(null)
  resetAppointmentRepository()
  resetClientRepository()
  resetMetaRepository()
})

describe('reminder delivery', () => {
  it('delivers a due reminder naming the client and time', async () => {
    const loop = reminders()
    const visit = await appointmentRepository().create({
      clientId,
      at: at(30),
      title: 'Лечение кариеса',
      remindMinutesBefore: 60,
    })

    expect(await loop.check()).toBe(1)
    expect(delivered.length).toBe(1)
    expect(delivered[0]!.title).toContain('Петрова Анна')
    expect(delivered[0]!.body).toContain('Лечение кариеса')
    expect(delivered[0]!.tag).toBe(`appointment-${visit.id}`)
  })

  it('delivers each reminder exactly once, even across restarts', async () => {
    const loop = reminders()
    await appointmentRepository().create({ clientId, at: at(10), remindMinutesBefore: 60 })

    expect(await loop.check()).toBe(1)
    expect(await loop.check()).toBe(0)
    // A fresh instance (a reload) must not repeat it either.
    expect(await reminders().check()).toBe(0)
    expect(delivered.length).toBe(1)
  })

  it('stays silent while the lead time has not been reached', async () => {
    const loop = reminders()
    await appointmentRepository().create({ clientId, at: at(180), remindMinutesBefore: 60 })
    expect(await loop.check()).toBe(0)
    expect(delivered.length).toBe(0)
  })

  it('does nothing when the setting is off', async () => {
    await metaRepository().saveSettings({ appointmentNotifications: false })
    await appointmentRepository().create({ clientId, at: at(10), remindMinutesBefore: 60 })

    expect(await reminders().check()).toBe(0)
    expect(delivered.length).toBe(0)
  })

  it('does nothing when the browser permission was refused', async () => {
    permission = 'denied'
    await appointmentRepository().create({ clientId, at: at(10), remindMinutesBefore: 60 })

    expect(await reminders().check()).toBe(0)
    expect(delivered.length).toBe(0)
  })

  it('gives up on a platform that cannot deliver, instead of retrying forever', async () => {
    deliverySucceeds = false
    const loop = reminders()
    const visit = await appointmentRepository().create({ clientId, at: at(10), remindMinutesBefore: 60 })

    expect(await loop.check()).toBe(0)
    // Marked anyway, so the 30-second loop does not hammer it forever.
    expect((await appointmentRepository().getById(visit.id))!.notifiedAt).toBeDefined()
    expect(await loop.check()).toBe(0)
  })

  it('skips a visit whose client was deleted', async () => {
    const visit = await appointmentRepository().create({ clientId, at: at(10), remindMinutesBefore: 60 })
    await clientRepository().softDelete(clientId)

    expect(await reminders().check()).toBe(0)
    expect(delivered.length).toBe(0)
    // Still marked, so it never comes back.
    expect((await appointmentRepository().getById(visit.id))!.notifiedAt).toBeDefined()
  })

  it('delivers several due reminders in chronological order', async () => {
    await appointmentRepository().create({ clientId, at: at(40), title: 'Позже', remindMinutesBefore: 60 })
    await appointmentRepository().create({ clientId, at: at(10), title: 'Раньше', remindMinutesBefore: 60 })

    expect(await reminders().check()).toBe(2)
    expect(delivered.map((d) => d.body)).toEqual([
      expect.stringContaining('Раньше'),
      expect.stringContaining('Позже'),
    ])
  })
})

describe('daily agenda', () => {
  it('announces the day’s visits once', async () => {
    const loop = reminders()
    await appointmentRepository().create({ clientId, at: `${dayKey(0)}T23:30`, remindMinutesBefore: 0 })

    expect(await loop.showDailyAgenda()).toBe(true)
    expect(delivered[0]!.tag).toBe('daily-agenda')
    // Second open on the same day stays quiet.
    expect(await loop.showDailyAgenda()).toBe(false)
  })

  it('does not burn the day when there is nothing to announce yet', async () => {
    const loop = reminders()

    // Opened before anything was booked.
    expect(await loop.showDailyAgenda()).toBe(false)
    expect(delivered.length).toBe(0)

    // Booking something and reopening must still produce the summary.
    await appointmentRepository().create({ clientId, at: `${dayKey(0)}T23:30` })
    expect(await loop.showDailyAgenda()).toBe(true)
  })

  it('respects the agenda setting', async () => {
    await metaRepository().saveSettings({ dailyAgenda: false })
    await appointmentRepository().create({ clientId, at: `${dayKey(0)}T23:30` })
    expect(await reminders().showDailyAgenda()).toBe(false)
  })
})
