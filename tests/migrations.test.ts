import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DentoraDatabase } from '~/database/db'
import { DB_VERSION, versions } from '~/database/schema'
import { inferFileKind } from '~/database/migrations'
import { createFileRepository } from '~/database/repositories/files'
import { createAppointmentRepository } from '~/database/repositories/appointments'

const opened: Dexie[] = []
function track<T extends Dexie>(instance: T): T {
  opened.push(instance)
  return instance
}

afterEach(async () => {
  for (const instance of opened.splice(0)) {
    instance.close()
    await instance.delete().catch(() => undefined)
  }
})

/** A database frozen at the shape v1 shipped with. */
function legacyV1(name: string): Dexie {
  const legacy = track(new Dexie(name))
  legacy.version(1).stores(versions[0]!.stores as Record<string, string>)
  return legacy
}

describe('schema versioning', () => {
  it('declares one entry per version, in order, with no gaps', () => {
    // Self-maintaining: a new version only has to be appended, but it must be
    // exactly one higher than the last and must match DB_VERSION.
    expect(versions.map((v) => v.version)).toEqual(
      Array.from({ length: versions.length }, (_, i) => i + 1),
    )
    expect(versions[versions.length - 1]!.version).toBe(DB_VERSION)
  })

  it('adds the appointments store in v3 without touching earlier versions', () => {
    expect(versions[2]!.stores.appointments).toBeTruthy()
    // v1 and v2 must not mention it - they shipped before visits existed.
    expect(versions[0]!.stores.appointments).toBeUndefined()
    expect(versions[1]!.stores.appointments).toBeUndefined()
  })

  it('never redefines a historical version in place', () => {
    // v1 must still describe the original five stores; changing it would
    // silently corrupt upgrades for anyone still on v1.
    expect(Object.keys(versions[0]!.stores).sort()).toEqual([
      'clients',
      'fileBlobs',
      'files',
      'meta',
      'works',
    ])
  })
})

describe('v1 -> v2 migration', () => {
  it('keeps every existing row and backfills file categories', async () => {
    const name = `dentora-migration-${Math.random().toString(36).slice(2)}`

    // --- Write data using the old schema ---
    const legacy = legacyV1(name)
    await legacy.open()
    expect(legacy.verno).toBe(1)

    await legacy.table('clients').add({
      id: '550e8400-e29b-41d4-a716-446655440000',
      firstName: 'Анна',
      lastName: 'Петрова',
      arrivalDate: '2026-01-15',
      phone: '+79001112233',
      notes: 'Старая запись',
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T10:00:00.000Z',
      deleted: 0,
    })
    await legacy.table('works').add({
      id: '550e8400-e29b-41d4-a716-446655440001',
      clientId: '550e8400-e29b-41d4-a716-446655440000',
      date: '2026-01-16',
      title: 'Пломба',
      description: '',
      notes: '',
      createdAt: '2026-01-16T10:00:00.000Z',
      updatedAt: '2026-01-16T10:00:00.000Z',
      deleted: 0,
    })
    // v1 rows have no `kind` and no `workId` index.
    const legacyFiles = [
      { id: '550e8400-e29b-41d4-a716-446655440002', name: 'xray-36.jpg', mimeType: 'image/jpeg' },
      { id: '550e8400-e29b-41d4-a716-446655440003', name: 'selfie.png', mimeType: 'image/png' },
      { id: '550e8400-e29b-41d4-a716-446655440004', name: 'выписка.pdf', mimeType: 'application/pdf' },
      { id: '550e8400-e29b-41d4-a716-446655440005', name: 'notes.bin', mimeType: 'application/octet-stream' },
    ]
    for (const file of legacyFiles) {
      await legacy.table('files').add({
        ...file,
        clientId: '550e8400-e29b-41d4-a716-446655440000',
        size: 64,
        createdAt: '2026-01-16T10:00:00.000Z',
        updatedAt: '2026-01-16T10:00:00.000Z',
        deleted: 0,
      })
      await legacy
        .table('fileBlobs')
        .add({ id: file.id, blob: new Blob([new Uint8Array(64).fill(1)], { type: file.mimeType }) })
    }
    await legacy.table('meta').put({ key: 'backupStats', value: { backupCount: 5 } })
    legacy.close()

    // --- Reopen with the current schema ---
    const upgraded = track(new DentoraDatabase(name))
    await upgraded.open()
    expect(upgraded.verno).toBe(DB_VERSION)

    // Nothing was dropped.
    expect(await upgraded.clients.count()).toBe(1)
    expect(await upgraded.works.count()).toBe(1)
    expect(await upgraded.files.count()).toBe(4)
    expect(await upgraded.fileBlobs.count()).toBe(4)

    const client = await upgraded.clients.get('550e8400-e29b-41d4-a716-446655440000')
    expect(client?.notes).toBe('Старая запись')
    expect(client?.phone).toBe('+79001112233')

    // Metadata survived too.
    expect((await upgraded.meta.get('backupStats'))?.value).toEqual({ backupCount: 5 })

    // The new column was populated from the existing MIME types / names.
    const files = await createFileRepository(upgraded).all()
    const byName = new Map(files.map((f) => [f.name, f.kind]))
    expect(byName.get('xray-36.jpg')).toBe('xray')
    expect(byName.get('selfie.png')).toBe('photo')
    expect(byName.get('выписка.pdf')).toBe('document')
    expect(byName.get('notes.bin')).toBe('other')

    // The new index is usable.
    const xrays = await createFileRepository(upgraded).query({ kind: 'xray' })
    expect(xrays.length).toBe(1)

    // Blobs still readable after the upgrade.
    const blob = await createFileRepository(upgraded).getBlob(
      '550e8400-e29b-41d4-a716-446655440002',
    )
    expect(blob?.size).toBe(64)

    // The v3 store exists and is usable on a database that started at v1.
    const appointments = createAppointmentRepository(upgraded)
    expect(await appointments.count()).toBe(0)
    const visit = await appointments.create({
      clientId: '550e8400-e29b-41d4-a716-446655440000',
      at: '2026-09-01T10:00',
    })
    expect(await appointments.getById(visit.id)).toBeDefined()
    expect((await appointments.upcoming({ from: '2026-01-01T00:00' })).length).toBe(1)
  })

  it('is idempotent - reopening at v2 changes nothing', async () => {
    const name = `dentora-idem-${Math.random().toString(36).slice(2)}`
    const first = track(new DentoraDatabase(name))
    await first.open()
    await first.clients.add({
      id: '550e8400-e29b-41d4-a716-446655440010',
      firstName: 'A',
      lastName: 'B',
      arrivalDate: '2026-01-01',
      notes: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deleted: 0,
    })
    first.close()

    const second = track(new DentoraDatabase(name))
    await second.open()
    expect(second.verno).toBe(DB_VERSION)
    expect(await second.clients.count()).toBe(1)
  })
})

describe('inferFileKind', () => {
  it('classifies by MIME type', () => {
    expect(inferFileKind('image/jpeg', 'photo.jpg')).toBe('photo')
    expect(inferFileKind('application/pdf', 'doc.pdf')).toBe('document')
    expect(inferFileKind('application/dicom', 'scan.dcm')).toBe('xray')
    expect(inferFileKind('application/octet-stream', 'blob.bin')).toBe('other')
  })

  it('recognises x-rays by name in both languages', () => {
    expect(inferFileKind('image/jpeg', 'xray-36.jpg')).toBe('xray')
    expect(inferFileKind('image/jpeg', 'X-Ray front.jpg')).toBe('xray')
    expect(inferFileKind('image/png', 'рентген-верх.png')).toBe('xray')
    expect(inferFileKind('image/jpeg', 'снимок.jpg')).toBe('xray')
    expect(inferFileKind('image/jpeg', 'OPG-2026.jpg')).toBe('xray')
  })
})
