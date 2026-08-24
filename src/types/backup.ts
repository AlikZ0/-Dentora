import type { Appointment, Client, StoredFile, Work } from './models'

export const BACKUP_FORMAT = 'client-app-backup'
export const BACKUP_FORMAT_VERSION = 1

/** `backup/manifest.json` — the first thing validated on import. */
export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: number
  createdAt: string
  appVersion: string
  databaseVersion: number
  counts: {
    clients: number
    works: number
    files: number
    /** Absent in archives written before visits existed. */
    appointments?: number
  }
  /** Total size of the payload files in bytes (uncompressed). */
  totalFileSize: number
  /** Free-form label the user can attach to a backup. */
  label?: string
}

/** A file entry as serialised into `database.json`. */
export interface BackupFileEntry extends Omit<StoredFile, 'thumbnail' | 'deleted'> {
  deleted: 0 | 1
  /** Path inside the archive, relative to `backup/`. */
  path: string
}

/** `backup/database.json`. */
export interface BackupDatabase {
  clients: Client[]
  works: Work[]
  files: BackupFileEntry[]
  /** Added in database version 3; older archives simply omit it. */
  appointments: Appointment[]
}

export type ImportMode = 'replace' | 'merge'

export interface BackupPreview {
  manifest: BackupManifest
  clients: number
  works: number
  files: number
  appointments: number
  /** Size of the selected archive on disk. */
  archiveSize: number
  /** Sum of the payload file sizes. */
  payloadSize: number
  encrypted: boolean
}

export interface MergeReport {
  clientsAdded: number
  clientsUpdated: number
  clientsSkipped: number
  worksAdded: number
  worksUpdated: number
  worksSkipped: number
  appointmentsAdded: number
  appointmentsUpdated: number
  appointmentsSkipped: number
  filesAdded: number
  filesUpdated: number
  filesSkipped: number
}

export interface ImportResult extends MergeReport {
  mode: ImportMode
}
