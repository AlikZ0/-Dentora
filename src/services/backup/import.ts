import type {
  BackupDatabase,
  BackupFileEntry,
  BackupManifest,
  BackupPreview,
  ImportMode,
  ImportResult,
} from '~/types/backup'
import type { Client, StoredFile, Work } from '~/types/models'
import { clearAllData, db, type DentoraDatabase } from '~/database/db'
import { createMetaRepository } from '~/database/repositories/meta'
import { STOP_READING, decodeText, readZip } from './zip'
import { DATABASE_PATH, MANIFEST_PATH } from './paths'
import { parseJson, validateDatabase, validateManifest } from './validation'
import { decideFile, emptyReport } from './merge'
import { decryptBlob, isEncryptedContainer } from '~/services/encryption/crypto'
import { AppError, isQuotaError, QuotaError } from '~/utils/errors'
import { nowIso } from '~/utils/datetime'
import { logger } from '~/utils/logger'
import { generateThumbnail } from '~/services/files/thumbnails'

export interface ImportProgress {
  stage: 'reading' | 'decrypting' | 'validating' | 'writing' | 'done'
  ratio: number | null
  label: string
}

export interface ImportOptions {
  password?: string
  onProgress?: (p: ImportProgress) => void
  signal?: AbortSignal
  database?: DentoraDatabase
}

/** Fast probe: is this archive password-protected? */
export async function isEncryptedArchive(archive: Blob): Promise<boolean> {
  const head = new Uint8Array(await archive.slice(0, 64).arrayBuffer())
  return isEncryptedContainer(head)
}

async function openArchive(
  archive: Blob,
  options: ImportOptions,
): Promise<{ zip: Blob; encrypted: boolean }> {
  if (!(await isEncryptedArchive(archive))) return { zip: archive, encrypted: false }

  if (!options.password) {
    throw new AppError('Этот backup защищён паролем. Введите пароль.', 'password_required')
  }
  options.onProgress?.({ stage: 'decrypting', ratio: 0, label: 'Расшифровываем backup…' })
  const zip = await decryptBlob(archive, options.password, {
    signal: options.signal,
    onProgress: (p) =>
      options.onProgress?.({
        stage: 'decrypting',
        ratio: p.total ? p.processed / p.total : null,
        label: 'Расшифровываем backup…',
      }),
  })
  return { zip, encrypted: true }
}

/**
 * Reads only `manifest.json` and `database.json`, then stops.
 *
 * Because the export writes those two entries first, previewing a 1.4 GB
 * backup reads a few hundred kilobytes.
 */
export async function previewBackup(
  archive: Blob,
  options: ImportOptions = {},
): Promise<BackupPreview> {
  const { zip, encrypted } = await openArchive(archive, options)

  options.onProgress?.({ stage: 'validating', ratio: null, label: 'Проверяем backup…' })

  let manifest: BackupManifest | null = null
  let database: BackupDatabase | null = null

  await readZip(
    zip,
    (entry) => {
      if (entry.path === MANIFEST_PATH) {
        manifest = validateManifest(parseJson(decodeText(entry.bytes), 'manifest.json'))
      } else if (entry.path === DATABASE_PATH) {
        database = validateDatabase(parseJson(decodeText(entry.bytes), 'database.json'))
      }
      if (manifest && database) throw STOP_READING
    },
    { shouldRead: (path) => path === MANIFEST_PATH || path === DATABASE_PATH, signal: options.signal },
  )

  if (!manifest) {
    throw new AppError(
      'В архиве нет описания backup (manifest.json). Выберите backup, созданный этим приложением.',
      'manifest_missing',
    )
  }
  if (!database) {
    throw new AppError('В архиве нет базы данных (database.json). Файл повреждён.', 'database_missing')
  }

  const db_ = database as BackupDatabase
  const mf = manifest as BackupManifest
  return {
    manifest: mf,
    clients: db_.clients.length,
    works: db_.works.length,
    files: db_.files.length,
    archiveSize: archive.size,
    payloadSize: mf.totalFileSize || db_.files.reduce((s, f) => s + f.size, 0),
    encrypted,
  }
}

function toStoredFile(entry: BackupFileEntry, thumbnail?: Blob): StoredFile {
  const { path: _path, ...rest } = entry
  return { ...rest, thumbnail }
}

/**
 * Applies a backup to the local database.
 *
 * Both modes stream: `database.json` is validated in full (it is small), then
 * payload files are written to IndexedDB one at a time as they come off the
 * archive. Nothing accumulates.
 *
 * `replace` wipes the local rows *after* the archive has been validated, so a
 * corrupt file can never leave the user with an empty database.
 */
export async function importBackup(
  archive: Blob,
  mode: ImportMode,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const database = options.database ?? db()
  const meta = createMetaRepository(database)
  const report = { ...emptyReport(), mode }

  const { zip } = await openArchive(archive, options)

  // Pass 1 - validate the descriptors before touching anything.
  const preview = await previewBackup(zip, { ...options, password: undefined })
  options.signal?.throwIfAborted()

  let payload: BackupDatabase | null = null
  await readZip(
    zip,
    (entry) => {
      if (entry.path === DATABASE_PATH) {
        payload = validateDatabase(parseJson(decodeText(entry.bytes), 'database.json'))
        throw STOP_READING
      }
    },
    { shouldRead: (p) => p === DATABASE_PATH, signal: options.signal },
  )
  if (!payload) {
    throw new AppError('В архиве нет базы данных (database.json). Файл повреждён.', 'database_missing')
  }
  const data = payload as BackupDatabase

  options.onProgress?.({ stage: 'writing', ratio: 0, label: 'Записываем данные…' })

  if (mode === 'replace') {
    await clearAllData(database)
  }

  // --- clients & works -------------------------------------------------
  const localClients = await database.clients.toArray()
  const localWorks = await database.works.toArray()
  const clientById = new Map(localClients.map((c) => [c.id, c]))
  const workById = new Map(localWorks.map((w) => [w.id, w]))

  const clientsToWrite: Client[] = []
  for (const client of data.clients) {
    const local = clientById.get(client.id)
    if (!local) {
      clientsToWrite.push(client)
      report.clientsAdded += 1
    } else if (client.updatedAt > local.updatedAt) {
      clientsToWrite.push(client)
      report.clientsUpdated += 1
    } else {
      report.clientsSkipped += 1
    }
  }

  const worksToWrite: Work[] = []
  for (const work of data.works) {
    const local = workById.get(work.id)
    if (!local) {
      worksToWrite.push(work)
      report.worksAdded += 1
    } else if (work.updatedAt > local.updatedAt) {
      worksToWrite.push(work)
      report.worksUpdated += 1
    } else {
      report.worksSkipped += 1
    }
  }

  try {
    await database.transaction('rw', [database.clients, database.works], async () => {
      if (clientsToWrite.length) await database.clients.bulkPut(clientsToWrite)
      if (worksToWrite.length) await database.works.bulkPut(worksToWrite)
    })
  } catch (error) {
    if (isQuotaError(error)) throw new QuotaError('import_clients_works')
    throw error
  }

  // --- files -----------------------------------------------------------
  const localFiles = await database.files.toArray()
  const fileById = new Map(localFiles.map((f) => [f.id, f]))
  const entryByPath = new Map(data.files.map((f) => [f.path, f]))
  const wantedPaths = new Set(entryByPath.keys())

  let written = 0
  const totalFiles = data.files.length
  const missing: string[] = []

  await readZip(
    zip,
    async (entry) => {
      const fileEntry = entryByPath.get(entry.path)
      if (!fileEntry) return
      entryByPath.delete(entry.path)

      const local = fileById.get(fileEntry.id)
      const { decision, needsBytes } = decideFile(fileEntry, local)

      if (decision === 'skip') {
        report.filesSkipped += 1
      } else {
        const blob = new Blob([entry.bytes.slice().buffer as ArrayBuffer], {
          type: fileEntry.mimeType || 'application/octet-stream',
        })
        // Thumbnails are regenerated locally rather than shipped in the
        // archive: they are cheap to make and would bloat every backup.
        const thumbnail = needsBytes
          ? await generateThumbnail(blob, fileEntry.mimeType).catch(() => undefined)
          : local?.thumbnail

        const record = toStoredFile(fileEntry, thumbnail)
        try {
          await database.transaction('rw', [database.files, database.fileBlobs], async () => {
            await database.files.put(record)
            if (needsBytes) await database.fileBlobs.put({ id: record.id, blob })
          })
        } catch (error) {
          if (isQuotaError(error)) throw new QuotaError('import_file_blob')
          throw error
        }
        if (decision === 'add') report.filesAdded += 1
        else report.filesUpdated += 1
      }

      written += 1
      options.onProgress?.({
        stage: 'writing',
        ratio: totalFiles ? written / totalFiles : 1,
        label: `Импортировано файлов: ${written} из ${totalFiles}`,
      })
    },
    { shouldRead: (path) => wantedPaths.has(path), signal: options.signal },
  )

  // File records whose bytes never showed up are dropped: a record without
  // content is worse than no record at all.
  for (const orphan of entryByPath.values()) {
    missing.push(orphan.id)
    report.filesSkipped += 1
  }
  if (missing.length) {
    logger.warn('backup.import', `${missing.length} file entries had no payload in the archive`)
  }

  await meta.recordImport(nowIso())
  logger.info(
    'backup.import',
    `mode=${mode} clients=+${report.clientsAdded}/~${report.clientsUpdated} ` +
      `works=+${report.worksAdded}/~${report.worksUpdated} ` +
      `files=+${report.filesAdded}/~${report.filesUpdated} source=${preview.manifest.appVersion}`,
  )

  options.onProgress?.({ stage: 'done', ratio: 1, label: 'Импорт завершён' })
  return report
}
