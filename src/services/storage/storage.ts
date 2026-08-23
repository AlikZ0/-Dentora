import { AppError, QuotaError } from '~/utils/errors'
import { logger } from '~/utils/logger'

/**
 * Storage budget handling.
 *
 * Browsers evict "best effort" origins under disk pressure, which for this
 * app would mean losing a client database. We therefore ask for persistent
 * storage on first run and check the remaining quota before writing anything
 * large, so the user gets a plain-language warning instead of a
 * `QuotaExceededError` mid-write.
 */

export interface StorageEstimate {
  usage: number
  quota: number
  /** 0..1, or `null` when the browser refuses to say (Safari private mode). */
  ratio: number | null
  supported: boolean
}

export async function estimateStorage(): Promise<StorageEstimate> {
  const storage = globalThis.navigator?.storage
  if (!storage?.estimate) {
    return { usage: 0, quota: 0, ratio: null, supported: false }
  }
  try {
    const { usage = 0, quota = 0 } = await storage.estimate()
    return { usage, quota, ratio: quota > 0 ? usage / quota : null, supported: true }
  } catch {
    return { usage: 0, quota: 0, ratio: null, supported: false }
  }
}

/**
 * Requests persistent storage. Chrome grants it silently for installed PWAs;
 * Firefox prompts; Safari ignores it and applies its own 7-day eviction rules
 * for non-installed sites, which is exactly why the README tells iOS users to
 * add the app to the Home Screen.
 */
export async function requestPersistence(): Promise<boolean> {
  const storage = globalThis.navigator?.storage
  if (!storage?.persist) return false
  try {
    if (await storage.persisted?.()) return true
    const granted = await storage.persist()
    logger.info('storage', `persistent storage granted=${granted}`)
    return granted
  } catch {
    return false
  }
}

export async function isPersisted(): Promise<boolean> {
  try {
    return (await globalThis.navigator?.storage?.persisted?.()) ?? false
  } catch {
    return false
  }
}

/** Headroom we refuse to eat into, so the browser never evicts us mid-write. */
const SAFETY_MARGIN = 32 * 1024 * 1024

/**
 * Throws a user-facing error *before* a write that would not fit.
 * When the browser gives no estimate we let the write proceed and handle the
 * real `QuotaExceededError` at the call site.
 */
export async function assertCanStore(bytes: number): Promise<void> {
  const estimate = await estimateStorage()
  if (!estimate.supported || estimate.quota <= 0) return

  const free = estimate.quota - estimate.usage
  if (bytes + SAFETY_MARGIN > free) {
    throw new QuotaError(`need=${bytes} free=${free}`)
  }
}

/** Warn (not block) once usage crosses this share of the quota. */
export const STORAGE_WARN_RATIO = 0.85

export async function shouldWarnAboutStorage(): Promise<boolean> {
  const estimate = await estimateStorage()
  return estimate.ratio !== null && estimate.ratio >= STORAGE_WARN_RATIO
}

/**
 * Clears Cache Storage (the PWA app shell). Explicitly does NOT touch
 * IndexedDB: the spec requires that "Очистить кэш" never loses user data.
 */
export async function clearAppCache(): Promise<number> {
  if (!globalThis.caches) return 0
  const keys = await caches.keys()
  await Promise.all(keys.map((key) => caches.delete(key)))
  logger.info('storage', `cleared ${keys.length} cache bucket(s)`)
  return keys.length
}

/** Size of the Cache Storage buckets, when the browser exposes it. */
export async function estimateCacheSize(): Promise<number | null> {
  const storage = globalThis.navigator?.storage
  if (!storage?.estimate) return null
  try {
    const estimate = (await storage.estimate()) as StorageEstimate & {
      usageDetails?: Record<string, number>
    }
    const details = estimate.usageDetails
    if (!details) return null
    return (details.caches ?? 0) + (details.serviceWorkerRegistrations ?? 0)
  } catch {
    return null
  }
}

export function assertStorageAvailable(): void {
  if (typeof indexedDB === 'undefined') {
    throw new AppError(
      'Браузер не поддерживает локальное хранилище. Отключите приватный режим или используйте другой браузер.',
      'no_indexeddb',
    )
  }
}
