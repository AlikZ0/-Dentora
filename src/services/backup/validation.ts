import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupDatabase,
  type BackupFileEntry,
  type BackupManifest,
} from '~/types/backup'
import type { Client, Work } from '~/types/models'
import { currentDatabaseVersion } from '~/database/db'
import { BackupFormatError } from '~/utils/errors'
import { isUuid } from '~/utils/id'

/**
 * Everything an unknown .zip has to survive before a single byte reaches
 * IndexedDB. Failures are phrased for the person holding the phone, not for
 * a stack trace.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function fail(message: string, technical?: string): never {
  throw new BackupFormatError(message, technical)
}

export function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    return fail(
      `Файл ${what} внутри архива повреждён и не читается.`,
      (error as Error).message,
    )
  }
}

export function validateManifest(input: unknown): BackupManifest {
  if (!input || typeof input !== 'object') {
    fail('В архиве нет описания backup (manifest.json). Это не backup нашего приложения.')
  }
  const m = input as Partial<BackupManifest>

  if (m.format !== BACKUP_FORMAT) {
    fail(
      'Неизвестный формат файла. Выберите backup, созданный этим приложением.',
      `format=${String(m.format)}`,
    )
  }
  if (typeof m.version !== 'number' || !Number.isFinite(m.version)) {
    fail('Не удалось определить версию backup. Файл повреждён.')
  }
  if (m.version > BACKUP_FORMAT_VERSION) {
    fail(
      `Этот backup создан более новой версией приложения (формат ${m.version}). Обновите приложение и попробуйте снова.`,
    )
  }
  if (m.version < 1) {
    fail('Версия backup слишком старая и больше не поддерживается.')
  }
  if (typeof m.databaseVersion !== 'number') {
    fail('В backup не указана версия базы данных. Файл повреждён.')
  }
  if (m.databaseVersion > currentDatabaseVersion) {
    fail(
      `Backup содержит базу более новой версии (${m.databaseVersion}). Обновите приложение, чтобы открыть его.`,
    )
  }
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) {
    fail('В backup не указана дата создания. Файл повреждён.')
  }

  const counts = m.counts ?? { clients: 0, works: 0, files: 0 }
  return {
    format: BACKUP_FORMAT,
    version: m.version,
    createdAt: m.createdAt,
    appVersion: typeof m.appVersion === 'string' ? m.appVersion : 'unknown',
    databaseVersion: m.databaseVersion,
    counts: {
      clients: Number(counts.clients) || 0,
      works: Number(counts.works) || 0,
      files: Number(counts.files) || 0,
    },
    totalFileSize: Number(m.totalFileSize) || 0,
    label: typeof m.label === 'string' ? m.label : undefined,
  }
}

function normaliseClient(raw: unknown, index: number): Client {
  const c = raw as Partial<Client>
  if (!isUuid(c?.id)) fail(`Запись клиента №${index + 1} повреждена: отсутствует идентификатор.`)
  if (typeof c.firstName !== 'string' || typeof c.lastName !== 'string') {
    fail(`Запись клиента №${index + 1} повреждена: нет имени.`)
  }
  const createdAt = typeof c.createdAt === 'string' ? c.createdAt : new Date(0).toISOString()
  return {
    id: c.id!,
    firstName: c.firstName,
    lastName: c.lastName,
    arrivalDate: ISO_DATE.test(String(c.arrivalDate)) ? c.arrivalDate! : createdAt.slice(0, 10),
    phone: typeof c.phone === 'string' && c.phone ? c.phone : undefined,
    email: typeof c.email === 'string' && c.email ? c.email : undefined,
    notes: typeof c.notes === 'string' ? c.notes : '',
    createdAt,
    updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : createdAt,
    deleted: c.deleted === 1 ? 1 : 0,
    deletedAt: typeof c.deletedAt === 'string' ? c.deletedAt : undefined,
  }
}

function normaliseWork(raw: unknown, index: number, clientIds: Set<string>): Work | null {
  const w = raw as Partial<Work>
  if (!isUuid(w?.id)) fail(`Запись работы №${index + 1} повреждена: отсутствует идентификатор.`)
  if (!isUuid(w.clientId)) fail(`Запись работы №${index + 1} повреждена: не указан клиент.`)
  // Orphans are dropped rather than failing the whole import.
  if (!clientIds.has(w.clientId!)) return null

  const createdAt = typeof w.createdAt === 'string' ? w.createdAt : new Date(0).toISOString()
  return {
    id: w.id!,
    clientId: w.clientId!,
    date: ISO_DATE.test(String(w.date)) ? w.date! : createdAt.slice(0, 10),
    title: typeof w.title === 'string' ? w.title : '',
    description: typeof w.description === 'string' ? w.description : '',
    notes: typeof w.notes === 'string' ? w.notes : '',
    createdAt,
    updatedAt: typeof w.updatedAt === 'string' ? w.updatedAt : createdAt,
    deleted: w.deleted === 1 ? 1 : 0,
    deletedAt: typeof w.deletedAt === 'string' ? w.deletedAt : undefined,
  }
}

const KINDS = new Set(['xray', 'photo', 'document', 'other'])

/** Rejects `../` traversal and absolute paths inside the archive. */
export function isSafeArchivePath(path: string): boolean {
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  if (path.includes('\\')) return false
  return !path.split('/').some((segment) => segment === '..')
}

function normaliseFile(
  raw: unknown,
  index: number,
  clientIds: Set<string>,
  workIds: Set<string>,
): BackupFileEntry | null {
  const f = raw as Partial<BackupFileEntry>
  if (!isUuid(f?.id)) fail(`Запись файла №${index + 1} повреждена: отсутствует идентификатор.`)
  if (!isUuid(f.clientId)) fail(`Запись файла №${index + 1} повреждена: не указан клиент.`)
  if (typeof f.path !== 'string' || !f.path) {
    fail(`Запись файла №${index + 1} повреждена: не указан путь внутри архива.`)
  }
  if (!isSafeArchivePath(f.path)) {
    fail('Архив содержит небезопасные пути к файлам и не может быть импортирован.', 'path_traversal')
  }
  if (!clientIds.has(f.clientId!)) return null

  const createdAt = typeof f.createdAt === 'string' ? f.createdAt : new Date(0).toISOString()
  return {
    id: f.id!,
    clientId: f.clientId!,
    workId: isUuid(f.workId) && workIds.has(f.workId) ? f.workId : undefined,
    name: typeof f.name === 'string' && f.name ? f.name : 'file',
    mimeType: typeof f.mimeType === 'string' ? f.mimeType : 'application/octet-stream',
    size: Number(f.size) || 0,
    kind: KINDS.has(String(f.kind)) ? f.kind! : 'other',
    hash: typeof f.hash === 'string' ? f.hash : undefined,
    width: Number(f.width) || undefined,
    height: Number(f.height) || undefined,
    createdAt,
    updatedAt: typeof f.updatedAt === 'string' ? f.updatedAt : createdAt,
    deleted: f.deleted === 1 ? 1 : 0,
    deletedAt: typeof f.deletedAt === 'string' ? f.deletedAt : undefined,
    path: f.path,
  }
}

/**
 * Validates and normalises `database.json`. Unknown extra keys are ignored,
 * missing optional keys get defaults, and rows that reference a client the
 * backup does not contain are dropped instead of aborting the import.
 */
export function validateDatabase(input: unknown): BackupDatabase {
  if (!input || typeof input !== 'object') {
    fail('В архиве нет базы данных (database.json). Файл повреждён.')
  }
  const raw = input as Partial<Record<'clients' | 'works' | 'files', unknown>>
  if (!Array.isArray(raw.clients)) fail('В backup нет списка клиентов. Файл повреждён.')

  const clients = raw.clients.map(normaliseClient)
  const clientIds = new Set(clients.map((c) => c.id))

  const works = (Array.isArray(raw.works) ? raw.works : [])
    .map((w, i) => normaliseWork(w, i, clientIds))
    .filter((w): w is Work => w !== null)
  const workIds = new Set(works.map((w) => w.id))

  const files = (Array.isArray(raw.files) ? raw.files : [])
    .map((f, i) => normaliseFile(f, i, clientIds, workIds))
    .filter((f): f is BackupFileEntry => f !== null)

  const seen = new Set<string>()
  for (const id of [...clientIds, ...workIds, ...files.map((f) => f.id)]) {
    if (seen.has(id)) fail('Backup содержит повторяющиеся идентификаторы и повреждён.', 'duplicate_uuid')
    seen.add(id)
  }

  return { clients, works, files }
}
