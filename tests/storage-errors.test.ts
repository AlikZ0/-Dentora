import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, QuotaError, isQuotaError, toTechnical, toUserMessage } from '~/utils/errors'
import { assertCanStore, estimateStorage, STORAGE_WARN_RATIO, shouldWarnAboutStorage } from '~/services/storage/storage'
import { logger } from '~/utils/logger'
import { sanitizeFileName, formatBytes, extensionOf } from '~/utils/format'
import { isSafeArchivePath } from '~/services/backup/validation'
import { isUuid, uuid } from '~/utils/id'

describe('user-facing error messages', () => {
  it('never leaks a DOMException name to the user', () => {
    const technical = [
      new DOMException('boom', 'QuotaExceededError'),
      new DOMException('boom', 'DataCloneError'),
      new DOMException('boom', 'VersionError'),
      new DOMException('boom', 'SecurityError'),
      new DOMException('boom', 'NotReadableError'),
      new TypeError('Cannot read properties of undefined'),
      { name: 'UnknownError', message: 'internal' },
      'a bare string',
    ]

    for (const error of technical) {
      const message = toUserMessage(error)
      expect(message).not.toMatch(/DOMException|Error:|undefined|QuotaExceeded|DataClone/)
      // Every message is a real sentence in Russian, ending with a full stop.
      expect(message).toMatch(/^[А-ЯЁ].*[.!]$/u)
    }
  })

  it('maps the quota failure to actionable advice', () => {
    expect(toUserMessage(new DOMException('x', 'QuotaExceededError'))).toMatch(/недостаточно места|Освободите место/i)
    expect(toUserMessage(new QuotaError())).toMatch(/недостаточно свободного места/i)
  })

  it('unwraps the DOMException Dexie hides inside its own error', () => {
    const dexieish = { name: 'DexieError', inner: { name: 'QuotaExceededError' } }
    expect(toUserMessage(dexieish)).toMatch(/Освободите место/)
    expect(isQuotaError(dexieish)).toBe(true)
  })

  it('recognises the quota failure in every browser spelling', () => {
    expect(isQuotaError(new DOMException('x', 'QuotaExceededError'))).toBe(true)
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true)
    expect(isQuotaError(new QuotaError())).toBe(true)
    expect(isQuotaError(new Error('The quota has been exceeded.'))).toBe(true)
    expect(isQuotaError(new Error('unrelated'))).toBe(false)
  })

  it('keeps the technical detail out of the message but available for the log', () => {
    const error = new AppError('Понятное сообщение.', 'some_code', 'raw detail 0x1f')
    expect(toUserMessage(error)).toBe('Понятное сообщение.')
    expect(toTechnical(error)).toContain('raw detail 0x1f')
  })
})

describe('local diagnostic log', () => {
  beforeEach(() => logger.clear())

  it('keeps entries locally and caps their number', () => {
    for (let i = 0; i < 250; i++) logger.info('test', `event-${i}`)
    const entries = logger.entries()
    expect(entries.length).toBe(200)
    expect(entries[entries.length - 1]!.message).toBe('event-249')
  })

  it('records only what the caller passed - no personal data path exists', () => {
    logger.warn('backup.export', 'clients=3 works=5 files=9 bytes=1024')
    const entry = logger.entries()[0]!
    expect(entry.message).not.toMatch(/[А-Яа-яЁё]/) // no names, notes or filenames
    expect(entry.scope).toBe('backup.export')
  })
})

describe('storage budget', () => {
  const original = globalThis.navigator

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true })
    vi.restoreAllMocks()
  })

  function stubEstimate(usage: number, quota: number): void {
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: { estimate: async () => ({ usage, quota }) } },
      configurable: true,
    })
  }

  it('reports usage and ratio', async () => {
    stubEstimate(600, 1000)
    const estimate = await estimateStorage()
    expect(estimate).toMatchObject({ usage: 600, quota: 1000, supported: true })
    expect(estimate.ratio).toBeCloseTo(0.6)
  })

  it('degrades gracefully when the browser will not say', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
    const estimate = await estimateStorage()
    expect(estimate.supported).toBe(false)
    expect(estimate.ratio).toBeNull()
    // With no estimate we must not block the write.
    await expect(assertCanStore(10 ** 9)).resolves.toBeUndefined()
  })

  it('refuses a write that would not fit, before any bytes are read', async () => {
    const quota = 1_000_000_000
    stubEstimate(quota - 40 * 1024 * 1024, quota) // 40 MB free
    // 32 MB of that is reserved headroom, so only ~8 MB is really available.
    await expect(assertCanStore(4 * 1024 * 1024)).resolves.toBeUndefined()
    await expect(assertCanStore(16 * 1024 * 1024)).rejects.toBeInstanceOf(QuotaError)
    await expect(assertCanStore(16 * 1024 * 1024)).rejects.toThrow(/недостаточно свободного места/i)
  })

  it('warns once usage crosses the threshold', async () => {
    stubEstimate(STORAGE_WARN_RATIO * 1000 + 1, 1000)
    expect(await shouldWarnAboutStorage()).toBe(true)
    stubEstimate(100, 1000)
    expect(await shouldWarnAboutStorage()).toBe(false)
  })
})

describe('input hardening', () => {
  it('rejects archive paths that escape the backup folder', () => {
    expect(isSafeArchivePath('backup/files/client-1/x.jpg')).toBe(true)
    expect(isSafeArchivePath('../../../etc/passwd')).toBe(false)
    expect(isSafeArchivePath('backup/../../secret')).toBe(false)
    expect(isSafeArchivePath('/absolute/path')).toBe(false)
    expect(isSafeArchivePath('C:/Windows/system32')).toBe(false)
    expect(isSafeArchivePath('backup\\files\\x.jpg')).toBe(false)
    expect(isSafeArchivePath('')).toBe(false)
  })

  it('sanitises file names for ZIP entries and Windows', () => {
    expect(sanitizeFileName('снимок 36.jpg')).toBe('снимок 36.jpg')
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(sanitizeFileName('...hidden')).toBe('hidden')
    expect(sanitizeFileName('   ')).toBe('file')
    expect(sanitizeFileName('x'.repeat(300)).length).toBe(120)
  })

  it('derives an extension from the name or the MIME type', () => {
    expect(extensionOf('scan.JPG')).toBe('.jpg')
    expect(extensionOf('no-extension', 'application/pdf')).toBe('.pdf')
    expect(extensionOf('no-extension', 'image/webp')).toBe('.webp')
    expect(extensionOf('no-extension')).toBe('')
  })

  it('generates valid v4 UUIDs', () => {
    const ids = new Set(Array.from({ length: 500 }, uuid))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(isUuid(id)).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('')).toBe(false)
  })
})

describe('formatting', () => {
  it('renders sizes the way the spec shows them', () => {
    expect(formatBytes(0)).toBe('0 Б')
    expect(formatBytes(512)).toBe('512 Б')
    expect(formatBytes(1024)).toBe('1 КБ')
    expect(formatBytes(1_503_238_553)).toBe('1.4 ГБ')
    expect(formatBytes(undefined)).toBe('-')
  })
})
