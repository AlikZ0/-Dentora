import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupDatabase,
  type BackupFileEntry,
  type BackupManifest,
} from '~/types/backup'
import { currentDatabaseVersion, db, type DentoraDatabase } from '~/database/db'
import { createFileRepository } from '~/database/repositories/files'
import { createClientRepository } from '~/database/repositories/clients'
import { createWorkRepository } from '~/database/repositories/works'
import { createMetaRepository } from '~/database/repositories/meta'
import { createAppointmentRepository } from '~/database/repositories/appointments'
import { createZip, type ZipEntryInput } from './zip'
import { DATABASE_PATH, MANIFEST_PATH, backupFileName, filePathFor } from './paths'
import { encryptBlob } from '~/services/encryption/crypto'
import { backupTimestamp, nowIso } from '~/utils/datetime'
import { AppError } from '~/utils/errors'
import { logger } from '~/utils/logger'

/** Filled in from runtime config at app start; tests get the default. */
export let APP_VERSION = '1.0.0'
export function setAppVersion(version: string): void {
  APP_VERSION = version
}

export type ExportStage =
  | 'collecting'
  | 'packing'
  | 'encrypting'
  | 'finalising'
  | 'done'

export interface ExportProgress {
  stage: ExportStage
  /** 0..1, or `null` while the total is still unknown. */
  ratio: number | null
  label: string
}

export interface ExportOptions {
  password?: string
  /** Include soft-deleted rows so the trash survives a device transfer. */
  includeDeleted?: boolean
  label?: string
  onProgress?: (p: ExportProgress) => void
  signal?: AbortSignal
  /** Injected in tests. */
  database?: DentoraDatabase
  /** Fewer PBKDF2 rounds in tests; production uses the default. */
  iterations?: number
  now?: Date
}

export interface ExportResult {
  blob: Blob
  fileName: string
  manifest: BackupManifest
  encrypted: boolean
}

/**
 * Serialises the whole database into a single archive.
 *
 * `manifest.json` and `database.json` are written first on purpose: the
 * import preview can then read them and stop, without streaming past a
 * gigabyte of x-rays.
 */
export async function exportBackup(options: ExportOptions = {}): Promise<ExportResult> {
  const database = options.database ?? db()
  const clients = createClientRepository(database)
  const works = createWorkRepository(database)
  const files = createFileRepository(database)
  const meta = createMetaRepository(database)
  const appointments = createAppointmentRepository(database)

  const report = (stage: ExportStage, ratio: number | null, label: string) =>
    options.onProgress?.({ stage, ratio, label })

  report('collecting', null, 'Читаем базу данных…')

  const includeDeleted = options.includeDeleted ?? true
  const [clientRows, workRows, fileRows, appointmentRows] = await Promise.all([
    clients.all(includeDeleted),
    works.all(includeDeleted),
    files.all(includeDeleted),
    appointments.all(includeDeleted),
  ])

  options.signal?.throwIfAborted()

  const entries: ZipEntryInput[] = []
  const fileEntries: BackupFileEntry[] = []
  let totalFileSize = 0
  let missingBlobs = 0

  for (const file of fileRows) {
    const blob = await files.getBlob(file.id)
    if (!blob) {
      // Metadata without bytes: keep the record, skip the payload, warn later.
      missingBlobs += 1
      continue
    }
    const path = filePathFor(file)
    const { thumbnail: _thumbnail, ...rest } = file
    fileEntries.push({ ...rest, path })
    // Images/PDFs are already compressed; STORE keeps export fast on a phone.
    entries.push({ path, data: blob, compress: false })
    totalFileSize += blob.size
  }

  const payload: BackupDatabase = {
    clients: clientRows,
    works: workRows,
    files: fileEntries,
    appointments: appointmentRows,
  }

  const createdAt = (options.now ?? new Date()).toISOString()
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    createdAt,
    appVersion: APP_VERSION,
    databaseVersion: currentDatabaseVersion,
    counts: {
      clients: clientRows.length,
      works: workRows.length,
      files: fileEntries.length,
      appointments: appointmentRows.length,
    },
    totalFileSize,
    label: options.label,
  }

  // Order matters: manifest, then database, then payload.
  entries.unshift(
    { path: MANIFEST_PATH, data: JSON.stringify(manifest, null, 2), compress: true },
    { path: DATABASE_PATH, data: JSON.stringify(payload), compress: true },
  )

  report('packing', 0, 'Упаковываем файлы…')

  let archive = await createZip(entries, {
    signal: options.signal,
    onProgress: (p) => {
      const ratio = p.bytesTotal ? p.bytesDone / p.bytesTotal : p.entriesDone / p.entriesTotal
      report('packing', Math.min(0.99, ratio), `Упаковано ${p.entriesDone} из ${p.entriesTotal}`)
    },
  })

  const encrypted = Boolean(options.password)
  if (options.password) {
    report('encrypting', 0, 'Шифруем backup…')
    archive = await encryptBlob(archive, options.password, {
      signal: options.signal,
      iterations: options.iterations,
      onProgress: (p) => report('encrypting', p.total ? p.processed / p.total : null, 'Шифруем backup…'),
    })
  }

  report('finalising', 1, 'Готовим файл…')

  const fileName = backupFileName(backupTimestamp(options.now ?? new Date()), encrypted)
  await meta.recordExport(archive.size, nowIso())

  if (missingBlobs > 0) {
    logger.warn('backup.export', `${missingBlobs} file record(s) had no stored bytes`)
  }
  logger.info(
    'backup.export',
    `clients=${manifest.counts.clients} works=${manifest.counts.works} ` +
      `files=${manifest.counts.files} appointments=${appointmentRows.length} bytes=${archive.size}`,
  )

  report('done', 1, 'Backup готов')
  return { blob: archive, fileName, manifest, encrypted }
}

/** Guard used before starting an export on a device that has nothing to save. */
export async function assertExportable(database: DentoraDatabase = db()): Promise<void> {
  const count = await database.clients.count()
  if (count === 0) {
    throw new AppError('В базе пока нет данных для экспорта.', 'nothing_to_export')
  }
}
