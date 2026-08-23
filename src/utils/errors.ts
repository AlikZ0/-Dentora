/**
 * User-facing errors. Technical details (DOMException names, stack traces)
 * live in `technical` and are never rendered - they only reach the local
 * diagnostic log, which carries no personal data.
 */
export class AppError extends Error {
  readonly technical?: string
  readonly code: string

  constructor(message: string, code = 'app_error', technical?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.technical = technical
  }
}

export class QuotaError extends AppError {
  constructor(technical?: string) {
    super(
      'Не удалось сохранить файл. Возможно, на устройстве недостаточно свободного места.',
      'quota_exceeded',
      technical,
    )
    this.name = 'QuotaError'
  }
}

export class BackupFormatError extends AppError {
  constructor(message: string, technical?: string) {
    super(message, 'backup_format', technical)
    this.name = 'BackupFormatError'
  }
}

export class DecryptionError extends AppError {
  constructor(technical?: string) {
    super('Неверный пароль или повреждённый backup.', 'decryption_failed', technical)
    this.name = 'DecryptionError'
  }
}

const DOM_MESSAGES: Record<string, string> = {
  QuotaExceededError:
    'Недостаточно места для сохранения. Освободите место на устройстве или удалите ненужные файлы.',
  NS_ERROR_DOM_QUOTA_REACHED:
    'Недостаточно места для сохранения. Освободите место на устройстве или удалите ненужные файлы.',
  DataCloneError:
    'Этот файл не удалось сохранить в базу. Попробуйте другой файл или другой формат.',
  NotFoundError: 'Запись не найдена. Возможно, она уже была удалена.',
  ConstraintError: 'Такая запись уже существует.',
  VersionError:
    'База данных открыта в другой вкладке. Закройте остальные вкладки приложения и повторите.',
  InvalidStateError:
    'База данных недоступна. Закройте остальные вкладки приложения и повторите.',
  AbortError: 'Операция была прервана.',
  SecurityError:
    'Браузер заблокировал доступ к локальному хранилищу. Отключите приватный режим и повторите.',
  NotReadableError: 'Не удалось прочитать файл. Возможно, он был перемещён или повреждён.',
  UnknownError: 'Хранилище браузера ответило ошибкой. Перезапустите приложение и повторите.',
}

/**
 * Translates any thrown value into a message an ordinary user can act on.
 * `QuotaExceededError`, `DataCloneError` and friends never reach the screen.
 */
export function toUserMessage(error: unknown): string {
  if (error instanceof AppError) return error.message

  const name = (error as { name?: string } | null)?.name
  if (name && DOM_MESSAGES[name]) return DOM_MESSAGES[name]!

  // Dexie wraps DOM exceptions; the inner name is what actually matters.
  const inner = (error as { inner?: { name?: string } } | null)?.inner?.name
  if (inner && DOM_MESSAGES[inner]) return DOM_MESSAGES[inner]!

  return 'Произошла ошибка. Повторите попытку.'
}

/** Extracts a technical string for the local log. Carries no personal data. */
export function toTechnical(error: unknown): string {
  if (error instanceof AppError && error.technical) return `${error.code}: ${error.technical}`
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/** True when the failure is "the device is full", in any browser spelling. */
export function isQuotaError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  const inner = (error as { inner?: { name?: string } } | null)?.inner?.name
  const message = (error as { message?: string } | null)?.message ?? ''
  return (
    error instanceof QuotaError ||
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    inner === 'QuotaExceededError' ||
    /quota/i.test(message)
  )
}
