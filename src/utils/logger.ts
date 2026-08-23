/**
 * Local-only diagnostic log.
 *
 * Hard rule from the spec: no client names, phone numbers, e-mails, note
 * text or file names ever go through here. Callers pass a short code plus
 * an already-scrubbed technical string. Nothing leaves the device.
 */
const MAX_ENTRIES = 200

export interface LogEntry {
  at: string
  level: 'info' | 'warn' | 'error'
  scope: string
  message: string
}

const entries: LogEntry[] = []

function push(level: LogEntry['level'], scope: string, message: string): void {
  entries.push({ at: new Date().toISOString(), level, scope, message })
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  if (import.meta.dev) {
    // Dev-only console output. Still no personal data - `message` is already scrubbed.
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
    fn(`[${scope}] ${message}`)
  }
}

export const logger = {
  info: (scope: string, message: string) => push('info', scope, message),
  warn: (scope: string, message: string) => push('warn', scope, message),
  error: (scope: string, message: string) => push('error', scope, message),
  entries: (): readonly LogEntry[] => entries,
  clear: () => entries.splice(0, entries.length),
}
