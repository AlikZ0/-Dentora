import type { Transaction } from 'dexie'
import type { FileKind } from '~/types/models'

/**
 * Data migrations, one per schema version that needs to rewrite rows.
 * Registered in `db.ts` via `.upgrade()`. Structural-only versions are absent.
 */

/** Best-effort classification of an existing file from its MIME type / name. */
export function inferFileKind(mimeType: string, name = ''): FileKind {
  const mime = (mimeType || '').toLowerCase()
  const lower = name.toLowerCase()

  if (/x-?ray|rtg|рентген|снимок|opg|ортопантом/.test(lower)) return 'xray'
  if (mime === 'application/dicom' || lower.endsWith('.dcm')) return 'xray'
  if (mime.startsWith('image/')) return 'photo'
  if (mime === 'application/pdf') return 'document'
  if (
    mime.startsWith('text/') ||
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('spreadsheet') ||
    mime.includes('document')
  ) {
    return 'document'
  }
  return 'other'
}

/**
 * v1 -> v2: backfill `files.kind` for rows created before categories existed.
 * Runs inside Dexie's upgrade transaction; existing rows are modified in
 * place, never dropped.
 */
export async function upgradeToV2(tx: Transaction): Promise<void> {
  await tx
    .table('files')
    .toCollection()
    .modify((file: Record<string, unknown>) => {
      if (!file.kind) {
        file.kind = inferFileKind(String(file.mimeType ?? ''), String(file.name ?? ''))
      }
      if (file.deleted === undefined) file.deleted = 0
    })
}
