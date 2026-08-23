import type { FileKind, StoredFile, Uuid } from '~/types/models'
import { createFileRepository, type FileRepository } from '~/database/repositories/files'
import { inferFileKind } from '~/database/migrations'
import { generateThumbnail, readImageDimensions } from './thumbnails'
import { assertCanStore } from '~/services/storage/storage'
import { sha256 } from '~/utils/hash'
import { isQuotaError, QuotaError } from '~/utils/errors'
import { logger } from '~/utils/logger'

/**
 * Turning a picked `File` into a stored attachment: classify it, build a
 * preview, check the storage budget, hash it for later dedup, then write.
 */

export interface AttachOptions {
  clientId: Uuid
  workId?: Uuid
  kind?: FileKind
  repository?: FileRepository
  onProgress?: (done: number, total: number) => void
}

export const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
  'image/avif',
  'application/pdf',
  'application/dicom',
]

/** `accept` attribute for the picker: named types plus a permissive fallback. */
export const ACCEPT_ATTRIBUTE = [...ACCEPTED_TYPES, '.dcm', '.heic', '.heif'].join(',')

export async function attachFile(file: File, options: AttachOptions): Promise<StoredFile> {
  const repository = options.repository ?? createFileRepository()

  // Fail before reading the bytes when the device clearly has no room.
  await assertCanStore(file.size)

  const mimeType = file.type || guessMime(file.name)
  const kind = options.kind ?? inferFileKind(mimeType, file.name)

  const [hash, thumbnail, dimensions] = await Promise.all([
    sha256(file).catch(() => undefined),
    generateThumbnail(file, mimeType),
    readImageDimensions(file),
  ])

  try {
    const stored = await repository.create(
      {
        clientId: options.clientId,
        workId: options.workId,
        name: file.name || 'file',
        mimeType,
        size: file.size,
        kind,
        hash,
        thumbnail,
        width: dimensions?.width,
        height: dimensions?.height,
      },
      file,
    )
    logger.info('files', `stored kind=${kind} bytes=${file.size}`)
    return stored
  } catch (error) {
    if (isQuotaError(error)) throw new QuotaError(`attach bytes=${file.size}`)
    throw error
  }
}

export async function attachFiles(
  files: File[],
  options: AttachOptions,
): Promise<{ stored: StoredFile[]; failed: { name: string; error: unknown }[] }> {
  const stored: StoredFile[] = []
  const failed: { name: string; error: unknown }[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!
    try {
      stored.push(await attachFile(file, options))
    } catch (error) {
      failed.push({ name: file.name, error })
    }
    options.onProgress?.(i + 1, files.length)
  }
  return { stored, failed }
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  pdf: 'application/pdf',
  dcm: 'application/dicom',
}

/** iOS sometimes hands over a `File` with an empty `type`. */
export function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? 'application/octet-stream'
}

export const KIND_LABELS: Record<FileKind, string> = {
  xray: 'Рентген',
  photo: 'Фото',
  document: 'Документ',
  other: 'Файл',
}

export function isViewableImage(file: Pick<StoredFile, 'mimeType'>): boolean {
  return /^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(file.mimeType)
}

export function isPdf(file: Pick<StoredFile, 'mimeType'>): boolean {
  return file.mimeType === 'application/pdf'
}
