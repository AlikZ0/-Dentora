import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freshDatabase, repositories, TEST_ITERATIONS, type Repos } from './helpers'
import type { DentoraDatabase } from '~/database/db'
import { exportBackup } from '~/services/backup/export'
import { importBackup, previewBackup } from '~/services/backup/import'
import { decide, decideFile, planClients } from '~/services/backup/merge'
import { sha256 } from '~/utils/hash'
import { DecryptionError, AppError } from '~/utils/errors'

function bytes(size: number, fill: number, type = 'image/jpeg'): Blob {
  return new Blob([new Uint8Array(size).fill(fill)], { type })
}

async function addClient(repo: Repos, lastName: string, fill = 1) {
  const client = await repo.clients.create({ firstName: 'Имя', lastName, arrivalDate: '2026-08-01' })
  const work = await repo.works.create({ clientId: client.id, title: `Работа ${lastName}` })
  const blob = bytes(1024, fill)
  const file = await repo.files.create(
    {
      clientId: client.id,
      workId: work.id,
      name: `xray-${lastName}.jpg`,
      mimeType: 'image/jpeg',
      size: 1024,
      kind: 'xray',
      hash: await sha256(blob),
    },
    blob,
  )
  return { client, work, file }
}

let dbA: DentoraDatabase
let dbB: DentoraDatabase
let a: Repos
let b: Repos

beforeEach(async () => {
  dbA = freshDatabase()
  dbB = freshDatabase()
  await Promise.all([dbA.open(), dbB.open()])
  a = repositories(dbA)
  b = repositories(dbB)
})

afterEach(async () => {
  dbA.close()
  dbB.close()
  await Promise.all([dbA.delete(), dbB.delete()])
})

describe('merge decision rules', () => {
  it('adds unknown ids, updates newer ones and keeps local on ties', () => {
    const incoming = { id: 'x', updatedAt: '2026-08-23T10:00:00.000Z' }
    expect(decide(undefined, incoming)).toBe('add')
    expect(decide({ id: 'x', updatedAt: '2026-08-22T10:00:00.000Z' }, incoming)).toBe('update')
    expect(decide({ id: 'x', updatedAt: '2026-08-23T10:00:00.000Z' }, incoming)).toBe('skip')
    expect(decide({ id: 'x', updatedAt: '2026-08-24T10:00:00.000Z' }, incoming)).toBe('skip')
  })

  it('skips re-writing bytes when the hash is unchanged', () => {
    const incoming = {
      id: 'f',
      updatedAt: '2026-08-23T10:00:00.000Z',
      hash: 'same',
    } as Parameters<typeof decideFile>[0]
    const local = {
      id: 'f',
      updatedAt: '2026-08-22T10:00:00.000Z',
      hash: 'same',
    } as Parameters<typeof decideFile>[1]

    expect(decideFile(incoming, local)).toEqual({ decision: 'update', needsBytes: false })
    expect(decideFile(incoming, undefined)).toEqual({ decision: 'add', needsBytes: true })
    expect(decideFile(incoming, { ...local!, hash: 'other' })).toEqual({
      decision: 'update',
      needsBytes: true,
    })
  })

  it('plans a batch of clients', () => {
    const base = { firstName: 'A', lastName: 'B', arrivalDate: '2026-01-01', notes: '', deleted: 0 as const }
    const local = [
      { ...base, id: '1', createdAt: 'x', updatedAt: '2026-01-01T00:00:00.000Z' },
      { ...base, id: '2', createdAt: 'x', updatedAt: '2026-05-01T00:00:00.000Z' },
    ]
    const incoming = [
      { ...base, id: '1', createdAt: 'x', updatedAt: '2026-03-01T00:00:00.000Z' }, // newer -> update
      { ...base, id: '2', createdAt: 'x', updatedAt: '2026-02-01T00:00:00.000Z' }, // older -> skip
      { ...base, id: '3', createdAt: 'x', updatedAt: '2026-02-01T00:00:00.000Z' }, // new   -> add
    ]
    const plan = planClients(incoming, local)
    expect(plan.add.map((c) => c.id)).toEqual(['3'])
    expect(plan.update.map((c) => c.id)).toEqual(['1'])
    expect(plan.skipped).toBe(1)
  })
})

describe('replace mode', () => {
  it('wipes local data and installs the backup exactly', async () => {
    await addClient(a, 'Изархива', 7)
    const { blob } = await exportBackup({ database: dbA })

    await addClient(b, 'Локальный', 2)
    await addClient(b, 'ЕщёОдин', 3)
    expect(await b.clients.count()).toBe(2)

    const result = await importBackup(blob, 'replace', { database: dbB })

    expect(result.mode).toBe('replace')
    expect(result.clientsAdded).toBe(1)
    expect(await b.clients.count()).toBe(1)
    expect((await b.clients.all())[0]!.lastName).toBe('Изархива')
    expect(await b.works.count()).toBe(1)
    expect(await b.files.count()).toBe(1)
    expect(await dbB.fileBlobs.count()).toBe(1)
  })

  it('leaves the local database untouched when the archive is invalid', async () => {
    await addClient(b, 'Ценные данные')
    const garbage = new Blob([new Uint8Array(1024).fill(4)], { type: 'application/zip' })

    await expect(importBackup(garbage, 'replace', { database: dbB })).rejects.toBeInstanceOf(AppError)

    // The wipe happens only after validation succeeds.
    expect(await b.clients.count()).toBe(1)
  })
})

describe('merge mode', () => {
  it('combines two devices without creating duplicates', async () => {
    const onlyOnA = await addClient(a, 'ТолькоНаA', 1)
    const shared = await addClient(a, 'Общий', 2)
    const { blob } = await exportBackup({ database: dbA })

    // Device B starts from that same backup, so it shares the UUIDs.
    await importBackup(blob, 'replace', { database: dbB })
    await addClient(b, 'ТолькоНаB', 3)

    expect(await b.clients.count()).toBe(3)

    // Re-merging the very same backup must change nothing.
    const again = await importBackup(blob, 'merge', { database: dbB })
    expect(again.clientsAdded).toBe(0)
    expect(again.clientsUpdated).toBe(0)
    expect(again.clientsSkipped).toBe(2)
    expect(again.filesSkipped).toBe(2)
    expect(await b.clients.count()).toBe(3)
    expect(await b.files.count()).toBe(3)
    expect(await dbB.fileBlobs.count()).toBe(3)

    expect(onlyOnA.client.id).not.toBe(shared.client.id)
  })

  it('keeps the newer version of a record edited on both devices', async () => {
    const { client } = await addClient(a, 'Первичный')
    const { blob: fromA } = await exportBackup({ database: dbA })
    await importBackup(fromA, 'replace', { database: dbB })

    // B edits later than A.
    await new Promise((r) => setTimeout(r, 10))
    await b.clients.update(client.id, { lastName: 'ИзмененоНаB' })
    const { blob: fromB } = await exportBackup({ database: dbB })

    // A merges B's backup: B's newer edit wins.
    const result = await importBackup(fromB, 'merge', { database: dbA })
    expect(result.clientsUpdated).toBe(1)
    expect((await a.clients.getById(client.id))!.lastName).toBe('ИзмененоНаB')

    // Merging A's older backup back into B must not undo it.
    const reverse = await importBackup(fromA, 'merge', { database: dbB })
    expect(reverse.clientsUpdated).toBe(0)
    expect(reverse.clientsSkipped).toBe(1)
    expect((await b.clients.getById(client.id))!.lastName).toBe('ИзмененоНаB')
  })

  // The full two-device scenario from the spec.
  it('A exports -> B imports -> B modifies -> B exports -> A merges', async () => {
    const seeded = await addClient(a, 'Петрова', 1)
    const { blob: backupFromA } = await exportBackup({ database: dbA })

    // --- Device B ---
    const imported = await importBackup(backupFromA, 'replace', { database: dbB })
    expect(imported.clientsAdded).toBe(1)
    expect(imported.filesAdded).toBe(1)

    await new Promise((r) => setTimeout(r, 10))
    await b.clients.update(seeded.client.id, { notes: 'Осмотр 24.08' })
    const newWork = await b.works.create({
      clientId: seeded.client.id,
      title: 'Новая работа на B',
      date: '2026-08-24',
    })
    const newBlob = bytes(2048, 9)
    const newFile = await b.files.create(
      {
        clientId: seeded.client.id,
        workId: newWork.id,
        name: 'photo-b.jpg',
        mimeType: 'image/jpeg',
        size: 2048,
        kind: 'photo',
        hash: await sha256(newBlob),
      },
      newBlob,
    )
    const { blob: backupFromB } = await exportBackup({ database: dbB })

    // --- Back on device A ---
    const merged = await importBackup(backupFromB, 'merge', { database: dbA })

    expect(merged.clientsAdded).toBe(0)
    expect(merged.clientsUpdated).toBe(1)
    expect(merged.worksAdded).toBe(1)
    expect(merged.worksSkipped).toBe(1)
    expect(merged.filesAdded).toBe(1)
    expect(merged.filesSkipped).toBe(1) // unchanged x-ray: same id, same timestamp

    // A now has exactly one client with both works and both files.
    expect(await a.clients.count()).toBe(1)
    expect((await a.clients.getById(seeded.client.id))!.notes).toBe('Осмотр 24.08')
    expect((await a.works.getByClientId(seeded.client.id)).length).toBe(2)

    const files = await a.files.getByClientId(seeded.client.id)
    expect(files.length).toBe(2)
    const restored = await a.files.getBlob(newFile.id)
    expect(restored?.size).toBe(2048)
    expect(new Uint8Array(await restored!.arrayBuffer())[0]).toBe(9)

    // And the original x-ray bytes on A were never rewritten.
    expect((await a.files.getBlob(seeded.file.id))!.size).toBe(1024)
  })

  it('does not duplicate when the same backup is imported repeatedly', async () => {
    await addClient(a, 'Петрова')
    await addClient(a, 'Смирнова', 4)
    const { blob } = await exportBackup({ database: dbA })

    for (let i = 0; i < 3; i++) await importBackup(blob, 'merge', { database: dbB })

    expect(await b.clients.count()).toBe(2)
    expect(await b.works.count()).toBe(2)
    expect(await b.files.count()).toBe(2)
    expect(await dbB.fileBlobs.count()).toBe(2)
  })

  it('carries soft-deleted rows across devices', async () => {
    const { client } = await addClient(a, 'Удалённый')
    await a.clients.softDelete(client.id)
    const { blob } = await exportBackup({ database: dbA })

    await importBackup(blob, 'replace', { database: dbB })
    expect(await b.clients.count()).toBe(0)
    expect(await b.clients.count(true)).toBe(1)
    expect((await b.clients.search({ onlyDeleted: true })).length).toBe(1)
  })
})

describe('encrypted backups', () => {
  it('round-trips through export -> import with a password', async () => {
    const { client } = await addClient(a, 'Секретов')
    const { blob, fileName, encrypted } = await exportBackup({
      database: dbA,
      password: 'верный-пароль',
      iterations: TEST_ITERATIONS,
    })

    expect(encrypted).toBe(true)
    expect(fileName).toMatch(/\.zip\.enc$/)

    const preview = await previewBackup(blob, { password: 'верный-пароль' })
    expect(preview.encrypted).toBe(true)
    expect(preview.clients).toBe(1)

    await importBackup(blob, 'replace', { database: dbB, password: 'верный-пароль' })
    expect((await b.clients.getById(client.id))!.lastName).toBe('Секретов')
    expect(await dbB.fileBlobs.count()).toBe(1)
  })

  it('asks for a password when none was given', async () => {
    await addClient(a, 'Секретов')
    const { blob } = await exportBackup({
      database: dbA,
      password: 'pw',
      iterations: TEST_ITERATIONS,
    })
    await expect(previewBackup(blob)).rejects.toThrow(/защищён паролем/)
  })

  it('rejects a wrong password with one clear message', async () => {
    await addClient(a, 'Секретов')
    const { blob } = await exportBackup({
      database: dbA,
      password: 'pw',
      iterations: TEST_ITERATIONS,
    })
    await expect(previewBackup(blob, { password: 'не-тот' })).rejects.toBeInstanceOf(DecryptionError)
    await expect(previewBackup(blob, { password: 'не-тот' })).rejects.toThrow(
      'Неверный пароль или повреждённый backup.',
    )
  })
})

describe('scale', () => {
  it('handles a backup with many files', async () => {
    const client = await a.clients.create({ firstName: 'Пациент', lastName: 'Многофайловый' })
    const total = 120
    for (let i = 0; i < total; i++) {
      const blob = bytes(2048, i % 251)
      await a.files.create(
        {
          clientId: client.id,
          name: `xray-${String(i).padStart(3, '0')}.jpg`,
          mimeType: 'image/jpeg',
          size: 2048,
          kind: 'xray',
          hash: await sha256(blob),
        },
        blob,
      )
    }

    const { blob, manifest } = await exportBackup({ database: dbA })
    expect(manifest.counts.files).toBe(total)
    expect(manifest.totalFileSize).toBe(total * 2048)

    const result = await importBackup(blob, 'replace', { database: dbB })
    expect(result.filesAdded).toBe(total)
    expect(await dbB.fileBlobs.count()).toBe(total)

    // Spot-check that bytes did not get shuffled between entries.
    const files = await b.files.getByClientId(client.id)
    const target = files.find((f) => f.name === 'xray-042.jpg')!
    const restored = new Uint8Array(await (await b.files.getBlob(target.id))!.arrayBuffer())
    expect(restored[0]).toBe(42)
    expect(restored.length).toBe(2048)
  })
})
