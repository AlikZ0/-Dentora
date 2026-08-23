import type { IsoDate, IsoDateTime } from '~/types/models'

export function nowIso(): IsoDateTime {
  return new Date().toISOString()
}

/** Local calendar date (not UTC) - `arrivalDate` should match the wall clock. */
export function todayIso(date: Date = new Date()): IsoDate {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/** `23 августа 2026` */
export function formatDateLong(value?: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return `${d.getDate()} ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** `23.08.2026` */
export function formatDate(value?: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

/** `23.08.2026, 19:42` */
export function formatDateTime(value?: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(value)}, ${hh}:${mi}`
}

/** True when the timestamp falls on the same local calendar day as `ref`. */
export function isSameLocalDay(value: string | undefined, ref: Date = new Date()): boolean {
  if (!value) return false
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return false
  return todayIso(d) === todayIso(ref)
}

/** `2026-08-23_23-59-12` */
export function backupTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  )
}
