import { logger } from '~/utils/logger'

/**
 * Saving a generated file to the device.
 *
 * Three paths, in order of preference:
 *  1. File System Access API (`showSaveFilePicker`) - Chrome/Edge desktop.
 *     True streaming to disk: a 1.4 GB backup never has to exist as a Blob
 *     the browser must hold.
 *  2. Web Share API with files - iOS Safari 15+. Opens the share sheet so the
 *     backup can go to Files / iCloud Drive / AirDrop, which is the only
 *     reliable way to get a file *out* of an iPhone PWA.
 *  3. An `<a download>` object URL - everything else.
 */

interface SaveOptions {
  suggestedName: string
  mimeType?: string
  /** Offer the iOS share sheet when available. */
  preferShare?: boolean
}

type PickerHost = {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle>
}

export function supportsFilePicker(): boolean {
  return typeof (globalThis as unknown as PickerHost).showSaveFilePicker === 'function'
}

export function supportsFileShare(file?: File): boolean {
  const nav = globalThis.navigator as Navigator & {
    canShare?: (data: ShareData) => boolean
  }
  if (!nav?.share || !nav.canShare) return false
  if (!file) return true
  try {
    return nav.canShare({ files: [file] })
  } catch {
    return false
  }
}

export type SaveOutcome = 'saved' | 'shared' | 'downloaded' | 'cancelled'

export async function saveBlob(blob: Blob, options: SaveOptions): Promise<SaveOutcome> {
  const { suggestedName, mimeType = blob.type || 'application/octet-stream' } = options

  // 1. Desktop Chromium: stream straight to the chosen path.
  const picker = (globalThis as unknown as PickerHost).showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker({
        suggestedName,
        types: [
          {
            description: 'Backup',
            accept: { [mimeType]: [suggestedName.slice(suggestedName.lastIndexOf('.'))] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await blob.stream().pipeTo(writable)
      return 'saved'
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return 'cancelled'
      logger.warn('download', `file picker failed: ${(error as Error).name}`)
      // fall through to the other strategies
    }
  }

  // 2. iOS: the share sheet is the only route into the Files app.
  if (options.preferShare) {
    try {
      const file = new File([blob], suggestedName, { type: mimeType })
      if (supportsFileShare(file)) {
        await navigator.share({ files: [file], title: suggestedName })
        return 'shared'
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return 'cancelled'
      logger.warn('download', `share failed: ${(error as Error).name}`)
    }
  }

  // 3. Universal fallback.
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = suggestedName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return 'downloaded'
  } finally {
    // Safari needs the URL to outlive the click by a tick.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}

/** Best-effort detection of iOS / iPadOS, which drives the share-sheet hint. */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone
  return Boolean(iosStandalone) || window.matchMedia?.('(display-mode: standalone)').matches === true
}
