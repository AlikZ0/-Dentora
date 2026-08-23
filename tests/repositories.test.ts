import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freshDatabase, imageBlob, repositories, type Repos } from './helpers'
import type { DentoraDatabase } from '~/database/db'
import { isUuid } from '~/utils/id'

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

describe('clientRepository', () => {
  it('creates a client with a UUID and timestamps', async () => {
    const client = await repo.clients.create({
      firstName: '  Анна ',
      lastName: 'Петрова',
      arrivalDate: '2026-08-01',
      phone: ' +7 900 000-00-00 ',
      notes: 'Аллергия на лидокаин',
    })

    expect(isUuid(client.id)).toBe(true)
    expect(client.firstName).toBe('Анна')
    expect(client.phone).toBe('+7 900 000-00-00')
    expect(client.createdAt).toBe(client.updatedAt)
    expect(client.deleted).toBe(0)

    const loaded = await repo.clients.getById(client.id)
    expect(loaded?.lastName).toBe('Петрова')
  })

  it('defaults arrivalDate to today and notes to empty', async () => {
    const client = await repo.clients.create({ firstName: 'И', lastName: 'И' })
    expect(client.arrivalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(client.notes).toBe('')
  })

  it('updates and bumps updatedAt', async () => {
    const client = await repo.clients.create({ firstName: 'Иван', lastName: 'Иванов' })
    await new Promise((r) => setTimeout(r, 5))
    const updated = await repo.clients.update(client.id, { lastName: 'Сидоров', phone: '' })

    expect(updated.lastName).toBe('Сидоров')
    expect(updated.phone).toBeUndefined()
    expect(updated.updatedAt > client.updatedAt).toBe(true)
    expect(updated.createdAt).toBe(client.createdAt)
  })

  it('searches across name, phone, email and notes', async () => {
    await repo.clients.create({ firstName: 'Анна', lastName: 'Петрова', phone: '+79001112233' })
    await repo.clients.create({ firstName: 'Пётр', lastName: 'Анненков', email: 'p@example.com' })
    await repo.clients.create({ firstName: 'Мария', lastName: 'Смирнова', notes: 'кариес' })

    expect((await repo.clients.search({ search: 'петров' })).length).toBe(1)
    expect((await repo.clients.search({ search: 'анн' })).length).toBe(2)
    expect((await repo.clients.search({ search: '1112233' })).length).toBe(1)
    expect((await repo.clients.search({ search: 'p@example' })).length).toBe(1)
    expect((await repo.clients.search({ search: 'кариес' })).length).toBe(1)
    expect((await repo.clients.search({ search: 'нет-такого' })).length).toBe(0)
  })

  it('treats е and ё as the same letter', async () => {
    await repo.clients.create({ firstName: 'Пётр', lastName: 'Фёдоров' })
    expect((await repo.clients.search({ search: 'федоров' })).length).toBe(1)
    expect((await repo.clients.search({ search: 'Фёдоров' })).length).toBe(1)
  })

  it('matches all whitespace-separated tokens', async () => {
    await repo.clients.create({ firstName: 'Анна', lastName: 'Петрова' })
    await repo.clients.create({ firstName: 'Анна', lastName: 'Смирнова' })
    expect((await repo.clients.search({ search: 'анна петрова' })).length).toBe(1)
  })

  it('sorts and filters by arrival date', async () => {
    await repo.clients.create({ firstName: 'A', lastName: 'Яковлев', arrivalDate: '2026-01-10' })
    await repo.clients.create({ firstName: 'B', lastName: 'Абрамов', arrivalDate: '2026-05-20' })
    await repo.clients.create({ firstName: 'C', lastName: 'Морозов', arrivalDate: '2026-09-01' })

    const byName = await repo.clients.search({ sort: 'lastName' })
    expect(byName.map((c) => c.lastName)).toEqual(['Абрамов', 'Морозов', 'Яковлев'])

    const desc = await repo.clients.search({ sort: 'arrivalDate', direction: 'desc' })
    expect(desc.map((c) => c.lastName)).toEqual(['Морозов', 'Абрамов', 'Яковлев'])

    const window = await repo.clients.search({ from: '2026-02-01', to: '2026-06-01' })
    expect(window.map((c) => c.lastName)).toEqual(['Абрамов'])
  })

  it('paginates', async () => {
    for (let i = 0; i < 10; i++) {
      await repo.clients.create({ firstName: 'X', lastName: `Ф${String(i).padStart(2, '0')}` })
    }
    const page = await repo.clients.search({ limit: 3, offset: 3 })
    expect(page.map((c) => c.lastName)).toEqual(['Ф03', 'Ф04', 'Ф05'])
  })

  it('soft-deletes a client together with works and files, then restores', async () => {
    const client = await repo.clients.create({ firstName: 'Иван', lastName: 'Тестов' })
    const work = await repo.works.create({ clientId: client.id, title: 'Пломба' })
    const file = await repo.files.create(
      { clientId: client.id, workId: work.id, name: 'x.jpg', mimeType: 'image/jpeg', size: 128, kind: 'xray' },
      imageBlob(),
    )

    await repo.clients.softDelete(client.id)

    expect(await repo.clients.count()).toBe(0)
    expect((await repo.works.getByClientId(client.id)).length).toBe(0)
    expect((await repo.files.getByClientId(client.id)).length).toBe(0)
    // Nothing is actually gone.
    expect(await repo.clients.count(true)).toBe(1)
    expect(await repo.files.getBlob(file.id)).toBeDefined()

    const trashed = await repo.clients.search({ onlyDeleted: true })
    expect(trashed.map((c) => c.id)).toEqual([client.id])

    await repo.clients.restore(client.id)
    expect(await repo.clients.count()).toBe(1)
    expect((await repo.works.getByClientId(client.id)).length).toBe(1)
    expect((await repo.files.getByClientId(client.id)).length).toBe(1)
  })

  it('destroys a client together with works, file metadata and blobs', async () => {
    const client = await repo.clients.create({ firstName: 'Иван', lastName: 'Тестов' })
    await repo.works.create({ clientId: client.id, title: 'Работа' })
    const file = await repo.files.create(
      { clientId: client.id, name: 'x.jpg', mimeType: 'image/jpeg', size: 128, kind: 'xray' },
      imageBlob(),
    )

    await repo.clients.destroy(client.id)

    expect(await repo.clients.getById(client.id)).toBeUndefined()
    expect(await repo.works.count(true)).toBe(0)
    expect(await repo.files.count(true)).toBe(0)
    expect(await repo.files.getBlob(file.id)).toBeUndefined()
    expect(await database.fileBlobs.count()).toBe(0)
  })
})

describe('workRepository', () => {
  it('creates and lists works newest first', async () => {
    const client = await repo.clients.create({ firstName: 'A', lastName: 'B' })
    await repo.works.create({ clientId: client.id, title: 'Старая', date: '2026-01-01' })
    await repo.works.create({ clientId: client.id, title: 'Новая', date: '2026-08-01' })
    await repo.works.create({ clientId: client.id, title: 'Средняя', date: '2026-04-01' })

    const works = await repo.works.getByClientId(client.id)
    expect(works.map((w) => w.title)).toEqual(['Новая', 'Средняя', 'Старая'])
  })

  it('scopes works to their client', async () => {
    const a = await repo.clients.create({ firstName: 'A', lastName: 'A' })
    const b = await repo.clients.create({ firstName: 'B', lastName: 'B' })
    await repo.works.create({ clientId: a.id, title: 'A1' })
    await repo.works.create({ clientId: b.id, title: 'B1' })

    expect((await repo.works.getByClientId(a.id)).map((w) => w.title)).toEqual(['A1'])
    expect(await repo.works.countByClient(b.id)).toBe(1)
  })

  it('updates a work', async () => {
    const client = await repo.clients.create({ firstName: 'A', lastName: 'B' })
    const work = await repo.works.create({ clientId: client.id, title: 'Черновик' })
    await new Promise((r) => setTimeout(r, 5))
    const updated = await repo.works.update(work.id, { title: 'Финал', notes: 'Готово' })
    expect(updated.title).toBe('Финал')
    expect(updated.notes).toBe('Готово')
    expect(updated.updatedAt > work.updatedAt).toBe(true)
  })

  it('detaches files when a work is destroyed, keeping the files', async () => {
    const client = await repo.clients.create({ firstName: 'A', lastName: 'B' })
    const work = await repo.works.create({ clientId: client.id, title: 'W' })
    const file = await repo.files.create(
      { clientId: client.id, workId: work.id, name: 'x.jpg', mimeType: 'image/jpeg', size: 4, kind: 'xray' },
      imageBlob(4),
    )

    await repo.works.destroy(work.id)

    const kept = await repo.files.getById(file.id)
    expect(kept).toBeDefined()
    expect(kept?.workId).toBeUndefined()
    expect(await repo.files.getBlob(file.id)).toBeDefined()
  })

  it('soft-deletes and restores a work', async () => {
    const client = await repo.clients.create({ firstName: 'A', lastName: 'B' })
    const work = await repo.works.create({ clientId: client.id, title: 'W' })
    await repo.works.softDelete(work.id)
    expect(await repo.works.count()).toBe(0)
    await repo.works.restore(work.id)
    expect(await repo.works.count()).toBe(1)
  })
})

describe('fileRepository', () => {
  it('keeps bytes out of the metadata store', async () => {
    const client = await repo.clients.create({ firstName: 'A', lastName: 'B' })
    const blob = imageBlob(4096, 9)
    const file = await repo.files.create(
      { clientId: client.id, name: 'xray.jpg', mimeType: 'image/jpeg', size: blob.size, kind: 'xray' },
      blob,
    )

    const metaRow = await database.files.get(file.id)
    expect(metaRow).toBeDefined()
    expect((metaRow as unknown as Record<string, unknown>).blob).toBeUndefined()

    const bytes = await repo.files.getBlob(file.id)
    expect(bytes?.size).toBe(4096)
    expect(new Uint8Array(await bytes!.arrayBuffer())[0]).toBe(9)
  })

  it('filters by client, work and kind', async () => {
    const client = await repo.clients.create({ firstName: 'A', lastName: 'B' })
    const work = await repo.works.create({ clientId: client.id, title: 'W' })
    await repo.files.create(
      { clientId: client.id, workId: work.id, name: 'a.jpg', mimeType: 'image/jpeg', size: 1, kind: 'xray' },
      imageBlob(1),
    )
    await repo.files.create(
      { clientId: client.id, name: 'b.pdf', mimeType: 'application/pdf', size: 2, kind: 'document' },
      imageBlob(2),
    )

    expect((await repo.files.getByClientId(client.id)).length).toBe(2)
    expect((await repo.files.getByWorkId(work.id)).length).toBe(1)
    expect((await repo.files.query({ clientId: client.id, kind: 'document' })).length).toBe(1)
  })

  it('reports total size from metadata alone', async () => {
    const client = await repo.clients.create({ firstName: 'A', lastName: 'B' })
    await repo.files.create(
      { clientId: client.id, name: 'a', mimeType: 'image/jpeg', size: 1000, kind: 'photo' },
      imageBlob(1000),
    )
    await repo.files.create(
      { clientId: client.id, name: 'b', mimeType: 'image/jpeg', size: 2500, kind: 'photo' },
      imageBlob(2500),
    )
    expect(await repo.files.totalSize()).toBe(3500)
  })

  it('destroys metadata and bytes together', async () => {
    const client = await repo.clients.create({ firstName: 'A', lastName: 'B' })
    const file = await repo.files.create(
      { clientId: client.id, name: 'a', mimeType: 'image/jpeg', size: 8, kind: 'photo' },
      imageBlob(8),
    )
    await repo.files.destroy(file.id)
    expect(await repo.files.getById(file.id)).toBeUndefined()
    expect(await database.fileBlobs.count()).toBe(0)
  })

  it('purges bytes of soft-deleted files', async () => {
    const client = await repo.clients.create({ firstName: 'A', lastName: 'B' })
    const keep = await repo.files.create(
      { clientId: client.id, name: 'keep', mimeType: 'image/jpeg', size: 8, kind: 'photo' },
      imageBlob(8),
    )
    const drop = await repo.files.create(
      { clientId: client.id, name: 'drop', mimeType: 'image/jpeg', size: 8, kind: 'photo' },
      imageBlob(8),
    )
    await repo.files.softDelete(drop.id)

    expect(await repo.files.purgeDeleted()).toBe(1)
    expect(await repo.files.getBlob(keep.id)).toBeDefined()
    expect(await repo.files.getBlob(drop.id)).toBeUndefined()
    expect(await database.fileBlobs.count()).toBe(1)
  })

  it('indexes hashes for deduplication', async () => {
    const client = await repo.clients.create({ firstName: 'A', lastName: 'B' })
    const file = await repo.files.create(
      { clientId: client.id, name: 'a', mimeType: 'image/jpeg', size: 8, kind: 'photo', hash: 'abc' },
      imageBlob(8),
    )
    const index = await repo.files.hashIndex()
    expect(index.get('abc')).toBe(file.id)
  })
})

describe('metaRepository', () => {
  it('tracks export and import history', async () => {
    expect((await repo.meta.getBackupStats()).backupCount).toBe(0)

    await repo.meta.recordExport(1024, '2026-08-23T19:42:00.000Z')
    await repo.meta.recordExport(2048, '2026-08-24T19:42:00.000Z')
    await repo.meta.recordImport('2026-08-22T09:15:00.000Z')

    const stats = await repo.meta.getBackupStats()
    expect(stats.backupCount).toBe(2)
    expect(stats.lastBackupSize).toBe(2048)
    expect(stats.lastExportAt).toBe('2026-08-24T19:42:00.000Z')
    expect(stats.lastImportAt).toBe('2026-08-22T09:15:00.000Z')
  })

  it('merges settings over defaults', async () => {
    expect((await repo.meta.getSettings()).dailyBackupReminder).toBe(true)
    await repo.meta.saveSettings({ dailyBackupReminder: false })
    const settings = await repo.meta.getSettings()
    expect(settings.dailyBackupReminder).toBe(false)
    expect(settings.theme).toBe('system')
  })
})
