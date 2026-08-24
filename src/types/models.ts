/**
 * Domain models. Every entity carries a stable UUID that survives
 * export/import — this is what makes Merge able to recognise "the same"
 * record coming back from another device.
 */

/** ISO-8601 timestamp, e.g. `2026-08-23T19:42:11.512Z`. */
export type IsoDateTime = string
/**
 * Local wall-clock date and time, e.g. `2026-08-24T10:30`.
 *
 * Deliberately zone-less: a visit booked for 10:30 is 10:30 wherever the
 * person happens to be. Storing a UTC instant would shift every appointment
 * when a backup moved between devices in different time zones. It also sorts
 * correctly as a plain string, so it can be indexed directly.
 */
export type LocalDateTime = string
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

/** Where an appointment stands. Only `scheduled` visits produce reminders. */
export type AppointmentStatus = 'scheduled' | 'done' | 'cancelled' | 'noshow'

export interface Appointment {
  id: Uuid
  clientId: Uuid
  /** Local start time of the visit. */
  at: LocalDateTime
  durationMinutes: number
  title: string
  notes: string
  status: AppointmentStatus
  /** Lead time for the reminder, in minutes before `at`. */
  remindMinutesBefore: number
  /** Set once the reminder fired, so it is never shown twice. */
  notifiedAt?: IsoDateTime
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  deleted: DeletedFlag
  deletedAt?: IsoDateTime
}

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Запланирован',
  done: 'Состоялся',
  cancelled: 'Отменён',
  noshow: 'Не пришёл',
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
  /** Master switch for visit reminders. */
  appointmentNotifications: boolean
  /** Default lead time offered when booking a visit. */
  defaultRemindMinutesBefore: number
  /** Also show a summary of the day's visits when the app is first opened. */
  dailyAgenda: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  dailyBackupReminder: true,
  compressPhotos: false,
  theme: 'system',
  appointmentNotifications: false,
  defaultRemindMinutesBefore: 60,
  dailyAgenda: true,
}

/** Lead times offered in the UI. */
export const REMINDER_CHOICES = [
  { value: 0, label: 'В момент визита' },
  { value: 15, label: 'За 15 минут' },
  { value: 30, label: 'За 30 минут' },
  { value: 60, label: 'За час' },
  { value: 180, label: 'За 3 часа' },
  { value: 1440, label: 'За день' },
] as const
