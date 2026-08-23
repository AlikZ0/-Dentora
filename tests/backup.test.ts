import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freshDatabase, repositories, TEST_ITERATIONS, type Repos } from './helpers'
import type { DentoraDatabase } from '~/database/db'
import { exportBackup } from '~/services/backup/export'
import { importBackup, isEncryptedArchive, previewBackup } from '~/services/backup/import'
import { BACKUP_FORMAT } from '~/types/backup'
import { createZip } from '~/services/backup/zip'
import { BackupFormatError, AppError } from '~/utils/errors'
import { sha256 } from '~/utils/hash'

function bytes(size: number, fill: number): Blob {
  return new Blob([new Uint8Array(size).fill(fill)], { type: 'image/jpeg' })
}

/** Seeds a realistic client with a work and two attachments. */
async function seedClient(repo: Repos, lastName: string, fill = 1) {
  const client = await repo.clients.create({
    firstName: 'Анна',
    lastName,
    arrivalDate: '2026-08-01',
    phone: '+79001112233',
    notes: 'Заметка',
  })
  const work = await repo.works.create({
    clientId: client.id,
    title: 'Лечение кариеса',
    date: '2026-08-02',
    description: 'Зуб 36',
  })
  const xrayBlob = bytes(4096, fill)
  const xray = await repo.files.create(
    {
      clientId: client.id,
      workId: work.id,
      name: 'xray-001.jpg',
      mimeType: 'image/jpeg',
      size: 4096,
      kind: 'xray',
      hash: await sha256(xrayBlob),
    },
    xrayBlob,
  )
  const pdfBlob = new Blob([new Uint8Array(512).fill(fill + 1)], { type: 'application/pdf' })
  const doc = await repo.files.create(
    {
      clientId: client.id,
      name: 'document.pdf',
      mimeType: 'application/pdf',
      size: 512,
      kind: 'document',
      hash: await sha256(pdfBlob),
    },
    pdfBlob,
  )
  return { client, work, xray, doc }
}

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

describe('export', () => {
  it('produces a valid, self-describing archive', async () => {
    await seedClient(repo, 'Петрова')

    const result = await exportBackup({ database, now: new Date('2026-08-23T23:59:12Z') })

    expect(result.fileName).toMatch(/^backup_2026-08-\d\d_\d\d-\d\d-\d\d\.zip$/)
    expect(result.encrypted).toBe(false)
    expect(result.manifest.format).toBe(BACKUP_FORMAT)
    expect(result.manifest.version).toBe(1)
    expect(result.manifest.databaseVersion).toBe(2)
    expect(result.manifest.counts).toEqual({ clients: 1, works: 1, files: 2 })
    expect(result.manifest.totalFileSize).toBe(4096 + 512)
    expect(result.blob.size).toBeGreaterThan(4096)
  })

  it('records the export in backup history', async () => {
    await seedClient(repo, 'Петрова')
    await exportBackup({ database })
    await exportBackup({ database })

    const stats = await repo.meta.getBackupStats()
    expect(stats.backupCount).toBe(2)
    expect(stats.lastExportAt).toBeDefined()
    expect(stats.lastBackupSize).toBeGreaterThan(0)
  })

  it('reports progress through every stage', async () => {
    await seedClient(repo, 'Петрова')
    const stages: string[] = []
    await exportBackup({
      database,
      onProgress: (p) => {
        if (stages[stages.length - 1] !== p.stage) stages.push(p.stage)
      },
    })
    expect(stages[0]).toBe('collecting')
    expect(stages).toContain('packing')
    expect(stages[stages.length - 1]).toBe('done')
  })
})

describe('preview', () => {
  it('summarises an archive without reading the payload', async () => {
    await seedClient(repo, 'Петрова')
    await seedClient(repo, 'Смирнова', 5)
    const { blob } = await exportBackup({ database })

    const preview = await previewBackup(blob)
    expect(preview.clients).toBe(2)
    expect(preview.works).toBe(2)
    expect(preview.files).toBe(4)
    expect(preview.encrypted).toBe(false)
    expect(preview.archiveSize).toBe(blob.size)
    expect(preview.payloadSize).toBe((4096 + 512) * 2)
    expect(Date.parse(preview.manifest.createdAt)).not.toBeNaN()
  })

  it('rejects a zip that is not our backup', async () => {
    const alien = await createZip([{ path: 'readme.txt', data: 'hello' }])
    await expect(previewBackup(alien)).rejects.toBeInstanceOf(AppError)
    await expect(previewBackup(alien)).rejects.toThrow(/manifest\.json/)
  })

  it('rejects an unknown manifest format', async () => {
    const archive = await createZip([
      { path: 'backup/manifest.json', data: JSON.stringify({ format: 'other-app', version: 1 }) },
      { path: 'backup/database.json', data: '{"clients":[]}' },
    ])
    await expect(previewBackup(archive)).rejects.toBeInstanceOf(BackupFormatError)
    await expect(previewBackup(archive)).rejects.toThrow(/Неизвестный формат/)
  })

  it('rejects a backup from a newer app version', async () => {
    const archive = await createZip([
      {
        path: 'backup/manifest.json',
        data: JSON.stringify({
          format: BACKUP_FORMAT,
          version: 99,
          createdAt: new Date().toISOString(),
          databaseVersion: 1,
        }),
      },
      { path: 'backup/database.json', data: '{"clients":[]}' },
    ])
    await expect(previewBackup(archive)).rejects.toThrow(/более новой версией/)
  })

  it('rejects a backup whose database version is ahead of ours', async () => {
    const archive = await createZip([
      {
        path: 'backup/manifest.json',
        data: JSON.stringify({
          format: BACKUP_FORMAT,
          version: 1,
          createdAt: new Date().toISOString(),
          databaseVersion: 999,
        }),
      },
      { path: 'backup/database.json', data: '{"clients":[]}' },
    ])
    await expect(previewBackup(archive)).rejects.toThrow(/более новой версии/)
  })

  it('rejects a corrupted database.json', async () => {
    const archive = await createZip([
      {
        path: 'backup/manifest.json',
        data: JSON.stringify({
          format: BACKUP_FORMAT,
          version: 1,
          createdAt: new Date().toISOString(),
          databaseVersion: 1,
        }),
      },
      { path: 'backup/database.json', data: '{ this is not json' },
    ])
    await expect(previewBackup(archive)).rejects.toThrow(/повреждён/)
  })

  it('rejects archive paths that try to escape the backup folder', async () => {
    const archive = await createZip([
      {
        path: 'backup/manifest.json',
        data: JSON.stringify({
          format: BACKUP_FORMAT,
          version: 1,
          createdAt: new Date().toISOString(),
          databaseVersion: 1,
        }),
      },
      {
        path: 'backup/database.json',
        data: JSON.stringify({
          clients: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              firstName: 'A',
              lastName: 'B',
              arrivalDate: '2026-01-01',
              notes: '',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              deleted: 0,
            },
          ],
          works: [],
          files: [
            {
              id: '550e8400-e29b-41d4-a716-446655440001',
              clientId: '550e8400-e29b-41d4-a716-446655440000',
              name: 'evil',
              mimeType: 'image/jpeg',
              size: 1,
              kind: 'photo',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              deleted: 0,
              path: '../../../etc/passwd',
            },
          ],
        }),
      },
    ])
    await expect(previewBackup(archive)).rejects.toThrow(/небезопасные пути/)
  })
})

describe('the main round trip', () => {
  // The scenario named in the spec: create -> export -> clear -> import.
  it('create client -> export -> clear DB -> import -> client exists', async () => {
    const { client, work, xray } = await seedClient(repo, 'Петрова')
    const originalBytes = new Uint8Array(await (await repo.files.getBlob(xray.id))!.arrayBuffer())

    const { blob } = await exportBackup({ database })

    await database.clients.clear()
    await database.works.clear()
    await database.files.clear()
    await database.fileBlobs.clear()
    expect(await repo.clients.count()).toBe(0)

    const result = await importBackup(blob, 'replace', { database })

    expect(result.clientsAdded).toBe(1)
    expect(result.worksAdded).toBe(1)
    expect(result.filesAdded).toBe(2)

    const restored = await repo.clients.getById(client.id)
    expect(restored).toBeDefined()
    expect(restored!.lastName).toBe('Петрова')
    expect(restored!.phone).toBe('+79001112233')
    expect(restored!.createdAt).toBe(client.createdAt)

    const works = await repo.works.getByClientId(client.id)
    expect(works.map((w) => w.id)).toEqual([work.id])
    expect(works[0]!.description).toBe('Зуб 36')

    const files = await repo.files.getByClientId(client.id)
    expect(files.length).toBe(2)
    const restoredXray = files.find((f) => f.id === xray.id)!
    expect(restoredXray.kind).toBe('xray')
    expect(restoredXray.workId).toBe(work.id)
    expect(restoredXray.size).toBe(4096)

    const restoredBytes = new Uint8Array(await (await repo.files.getBlob(xray.id))!.arrayBuffer())
    expect(restoredBytes.length).toBe(originalBytes.length)
    expect(Array.from(restoredBytes.slice(0, 32))).toEqual(Array.from(originalBytes.slice(0, 32)))
  })

  it('records the import in backup history', async () => {
    await seedClient(repo, 'Петрова')
    const { blob } = await exportBackup({ database })
    await importBackup(blob, 'merge', { database })
    expect((await repo.meta.getBackupStats()).lastImportAt).toBeDefined()
  })
})
