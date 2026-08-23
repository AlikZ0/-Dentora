import type { StoredFile } from '~/types/models'
import { extensionOf, sanitizeFileName } from '~/utils/format'

export const BACKUP_ROOT = 'backup'
export const MANIFEST_PATH = `${BACKUP_ROOT}/manifest.json`
export const DATABASE_PATH = `${BACKUP_ROOT}/database.json`

/**
 * Archive path for one file:
 *   `backup/files/client-<8 hex>/<safe-name>-<8 hex><ext>`
 *
 * The short id suffix guarantees uniqueness even when a client has three
 * files literally named `xray.jpg`, while the readable prefix keeps the
 * archive browsable in Finder / Explorer / the iOS Files app.
 */
export function filePathFor(file: Pick<StoredFile, 'id' | 'clientId' | 'name' | 'mimeType'>): string {
  const folder = `client-${file.clientId.slice(0, 8)}`
  const ext = extensionOf(file.name, file.mimeType)
  const base = sanitizeFileName(file.name.replace(/\.[A-Za-z0-9]{1,8}$/, ''), 'file')
  return `${BACKUP_ROOT}/files/${folder}/${base}-${file.id.slice(0, 8)}${ext}`
}

export function backupFileName(timestamp: string, encrypted: boolean): string {
  return encrypted ? `backup_${timestamp}.zip.enc` : `backup_${timestamp}.zip`
}
