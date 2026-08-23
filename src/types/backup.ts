import type { Client, StoredFile, Work } from './models'

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
}

export type ImportMode = 'replace' | 'merge'

export interface BackupPreview {
  manifest: BackupManifest
  clients: number
  works: number
  files: number
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
  filesAdded: number
  filesUpdated: number
  filesSkipped: number
}

export interface ImportResult extends MergeReport {
  mode: ImportMode
}
