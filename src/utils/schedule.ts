import type { LocalDateTime } from '~/types/models'

/**
 * Helpers for zone-less local wall-clock timestamps (`YYYY-MM-DDTHH:mm`).
 *
 * Appointments are stored this way on purpose - see `LocalDateTime`. These
 * functions are the only place that converts between that string and a real
 * `Date`, so the timezone assumption lives in exactly one file.
 */

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

const pad = (value: number) => String(value).padStart(2, '0')

/** `2026-08-24T10:30` for the given instant, in the device's own zone. */
export function localNow(date: Date = new Date()): LocalDateTime {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Midnight today, as a comparable local string. */
export function startOfLocalDay(date: Date = new Date()): LocalDateTime {
  return `${localNow(date).slice(0, 10)}T00:00`
}

/** Interprets a local string in the device's current zone. */
export function localDateTimeToDate(value: LocalDateTime): Date | null {
  const match = LOCAL_DATE_TIME.exec(value)
  if (!match) return null
  const [, y, m, d, hh, mm] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

export function isValidLocalDateTime(value: unknown): value is LocalDateTime {
  return typeof value === 'string' && LOCAL_DATE_TIME.test(value) && localDateTimeToDate(value) !== null
}

/** Combines the `<input type="date">` and `<input type="time">` values. */
export function combineDateAndTime(day: string, time: string): LocalDateTime {
  return `${day}T${time}`
}

export function splitDateTime(value: LocalDateTime): { day: string; time: string } {
  return { day: value.slice(0, 10), time: value.slice(11, 16) }
}

/** `10:30` */
export function formatTime(value: LocalDateTime): string {
  return value.slice(11, 16)
}

/** Local day key (`2026-08-24`) shifted by `days`. */
export function dayKey(days = 0, from: Date = new Date()): string {
  const date = new Date(from)
  date.setDate(date.getDate() + days)
  return localNow(date).slice(0, 10)
}

/** Whole local days between today and the given day key. Negative = past. */
export function daysFromToday(day: string, from: Date = new Date()): number {
  const target = localDateTimeToDate(`${day}T00:00`)
  const today = localDateTimeToDate(startOfLocalDay(from))
  if (!target || !today) return Number.NaN
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

/** `Сегодня`, `Завтра`, `Послезавтра`, otherwise `среда, 27 августа`. */
export function describeDay(day: string, from: Date = new Date()): string {
  const offset = daysFromToday(day, from)
  if (offset === 0) return 'Сегодня'
  if (offset === 1) return 'Завтра'
  if (offset === 2) return 'Послезавтра'
  if (offset === -1) return 'Вчера'

  const date = localDateTimeToDate(`${day}T00:00`)
  if (!date) return day
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ]
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`
}

/** `через 25 минут`, `через 2 часа`, `сейчас`, `15 минут назад`. */
export function describeRelative(value: LocalDateTime, from: Date = new Date()): string {
  const target = localDateTimeToDate(value)
  if (!target) return ''
  const diffMinutes = Math.round((target.getTime() - from.getTime()) / 60_000)
  const abs = Math.abs(diffMinutes)

  if (abs < 1) return 'сейчас'
  const suffix = (text: string) => (diffMinutes > 0 ? `через ${text}` : `${text} назад`)

  if (abs < 60) return suffix(`${abs} ${plural(abs, 'минуту', 'минуты', 'минут')}`)
  if (abs < 24 * 60) {
    const hours = Math.round(abs / 60)
    return suffix(`${hours} ${plural(hours, 'час', 'часа', 'часов')}`)
  }
  const days = Math.round(abs / (24 * 60))
  return suffix(`${days} ${plural(days, 'день', 'дня', 'дней')}`)
}

/** Russian plural selection: 1 минута, 2 минуты, 5 минут. */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/** `За час`, `За 15 минут`, `В момент визита`. */
export function describeLeadTime(minutes: number): string {
  if (minutes <= 0) return 'в момент визита'
  if (minutes < 60) return `за ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}`
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60)
    return `за ${hours} ${plural(hours, 'час', 'часа', 'часов')}`
  }
  const days = Math.round(minutes / 1440)
  return `за ${days} ${plural(days, 'день', 'дня', 'дней')}`
}
