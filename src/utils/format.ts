const UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']

/** `1.4 ГБ` */
export function formatBytes(bytes?: number | null, digits = 1): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '-'
  if (bytes < 1) return '0 Б'
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : digits).replace(/\.0$/, '')} ${UNITS[i]}`
}

/** Grouped thousands: `1 247`. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value)
}

export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.lastName} ${person.firstName}`.trim()
}

export function initials(person: { firstName: string; lastName: string }): string {
  const a = person.lastName.trim()[0] ?? ''
  const b = person.firstName.trim()[0] ?? ''
  return `${a}${b}`.toUpperCase() || '?'
}

// Control chars, path separators and the characters Windows rejects in names.
const ILLEGAL_FILENAME_CHARS = /[\u0000-\u001f\\/:*?"<>|]/g

/** Strips characters that are illegal in ZIP entries or on Windows. */
export function sanitizeFileName(name: string, fallback = 'file'): string {
  const cleaned = name
    .replace(ILLEGAL_FILENAME_CHARS, '_')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 120) || fallback
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/avif': '.avif',
  'application/pdf': '.pdf',
  'application/dicom': '.dcm',
  'text/plain': '.txt',
  'application/zip': '.zip',
}

export function mimeExtension(mimeType: string): string {
  return MIME_EXT[mimeType.toLowerCase()] ?? ''
}

/** File extension including the dot, lower-cased. Falls back to the MIME map. */
export function extensionOf(name: string, mimeType?: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name)
  if (match) return `.${match[1]!.toLowerCase()}`
  return mimeType ? mimeExtension(mimeType) : ''
}
