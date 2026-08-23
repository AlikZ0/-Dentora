/**
 * Domain models. Every entity carries a stable UUID that survives
 * export/import — this is what makes Merge able to recognise "the same"
 * record coming back from another device.
 */

/** ISO-8601 timestamp, e.g. `2026-08-23T19:42:11.512Z`. */
export type IsoDateTime = string
/** Calendar date without time, e.g. `2026-08-23`. */
export type IsoDate = string
/** UUID v4, e.g. `550e8400-e29b-41d4-a716-446655440000`. */
export type Uuid = string

/** Dexie cannot index `undefined`/`null`, so soft-delete uses a 0/1 flag. */
export type DeletedFlag = 0 | 1

export interface Client {
  id: Uuid
  firstName: string
  lastName: string
  /** Date the client first arrived. */
  arrivalDate: IsoDate
  phone?: string
  email?: string
  notes: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  deleted: DeletedFlag
  deletedAt?: IsoDateTime
}

export interface Work {
  id: Uuid
  clientId: Uuid
  date: IsoDate
  title: string
  description: string
  notes: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  deleted: DeletedFlag
  deletedAt?: IsoDateTime
}

/**
 * How a file is presented in the UI. Derived from the MIME type on upload,
 * but the user can re-tag a photo as an x-ray.
 */
export type FileKind = 'xray' | 'photo' | 'document' | 'other'

/**
 * File *metadata* only. The bytes live in a separate `fileBlobs` table so
 * that listing a client's 200 x-rays never pulls 1.4 GB into memory.
 */
export interface StoredFile {
  id: Uuid
  clientId: Uuid
  workId?: Uuid
  name: string
  mimeType: string
  size: number
  kind: FileKind
  /** SHA-256 of the bytes, used to deduplicate on Merge. */
  hash?: string
  /** Small (<= 320px) preview, safe to load in lists. */
  thumbnail?: Blob
  width?: number
  height?: number
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  deleted: DeletedFlag
  deletedAt?: IsoDateTime
}

/** The heavy half of a file, kept in its own object store. */
export interface FileBlob {
  id: Uuid
  blob: Blob
}

/** Free-form key/value store for app metadata and settings. */
export interface MetaRecord<T = unknown> {
  key: string
  value: T
}

export interface BackupStats {
  lastExportAt?: IsoDateTime
  lastImportAt?: IsoDateTime
  lastBackupSize?: number
  backupCount: number
}

export interface AppSettings {
  /** Warn once per day if no backup was produced yet. */
  dailyBackupReminder: boolean
  /** Default to compressing photos before storing them. */
  compressPhotos: boolean
  theme: 'system' | 'light' | 'dark'
}

export const DEFAULT_SETTINGS: AppSettings = {
  dailyBackupReminder: true,
  compressPhotos: false,
  theme: 'system',
}
