import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { AppError } from '~/utils/errors'

/**
 * Thin streaming wrapper around fflate.
 *
 * Both directions are chunked. A 1.4 GB backup is never held in a single
 * ArrayBuffer: on write we flush into intermediate Blobs (which browsers can
 * spill to disk), on read we hand each entry to the caller as it arrives.
 */

/** Bytes accumulated in JS memory before being folded into a Blob. */
const FLUSH_THRESHOLD = 32 * 1024 * 1024
/** Bytes read from a source blob per iteration. */
const READ_CHUNK = 8 * 1024 * 1024

export interface ZipEntryInput {
  path: string
  data: Blob | Uint8Array | string
  /**
   * Deflate the entry. Default: off. JPEG/PNG/PDF are already compressed and
   * deflating them burns CPU for ~0 %; JSON is worth compressing.
   */
  compress?: boolean
}

export interface ZipProgress {
  entriesDone: number
  entriesTotal: number
  bytesDone: number
  bytesTotal: number
  currentPath: string
}

function toUint8(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data
}

async function* iterateBlob(blob: Blob): AsyncGenerator<Uint8Array> {
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) yield value as Uint8Array
      }
      return
    } catch {
      // Fall through to the slicing path (older iOS Safari).
    } finally {
      reader.releaseLock?.()
    }
  }
  for (let offset = 0; offset < blob.size; offset += READ_CHUNK) {
    yield new Uint8Array(await blob.slice(offset, offset + READ_CHUNK).arrayBuffer())
  }
}

/**
 * Builds a ZIP archive from `entries`, one entry at a time.
 * Returns a Blob whose parts are already flushed, so peak JS heap stays
 * around `FLUSH_THRESHOLD` regardless of archive size.
 */
export async function createZip(
  entries: ZipEntryInput[],
  options: { onProgress?: (p: ZipProgress) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  const parts: BlobPart[] = []
  let pending: Uint8Array[] = []
  let pendingBytes = 0
  let failure: Error | null = null

  const flush = () => {
    if (!pending.length) return
    parts.push(new Blob(pending as BlobPart[]))
    pending = []
    pendingBytes = 0
  }

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      failure ||= err as Error
      return
    }
    if (chunk && chunk.length) {
      pending.push(chunk)
      pendingBytes += chunk.length
      if (pendingBytes >= FLUSH_THRESHOLD) flush()
    }
    if (final) flush()
  })

  const bytesTotal = entries.reduce(
    (sum, e) => sum + (e.data instanceof Blob ? e.data.size : toUint8(e.data as Uint8Array | string).length),
    0,
  )
  let bytesDone = 0

  try {
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!
      options.signal?.throwIfAborted()
      if (failure) throw failure

      const stream = entry.compress
        ? new ZipDeflate(entry.path, { level: 6 })
        : new ZipPassThrough(entry.path)
      zip.add(stream)

      if (entry.data instanceof Blob) {
        let previous: Uint8Array | null = null
        for await (const chunk of iterateBlob(entry.data)) {
          options.signal?.throwIfAborted()
          if (previous) {
            stream.push(previous, false)
            bytesDone += previous.length
          }
          previous = chunk
          // Yield to the event loop so the UI stays responsive on big files.
          await Promise.resolve()
        }
        stream.push(previous ?? new Uint8Array(0), true)
        if (previous) bytesDone += previous.length
      } else {
        const bytes = toUint8(entry.data)
        stream.push(bytes, true)
        bytesDone += bytes.length
      }

      options.onProgress?.({
        entriesDone: index + 1,
        entriesTotal: entries.length,
        bytesDone,
        bytesTotal,
        currentPath: entry.path,
      })
    }

    zip.end()
    if (failure) throw failure
  } catch (error) {
    try {
      zip.terminate()
    } catch {
      /* already ended */
    }
    throw error
  }

  flush()
  return new Blob(parts, { type: 'application/zip' })
}

export interface ZipEntryOutput {
  path: string
  /** Full bytes of the entry. */
  bytes: Uint8Array
}

export type ZipEntryHandler = (entry: ZipEntryOutput) => void | Promise<void>

/** Signals `readZip` to stop early; not an error. */
export const STOP_READING = Symbol('stop-reading')

/**
 * Streams a ZIP archive, invoking `handler` once per entry with the entry's
 * complete bytes. Entries the caller does not want can be skipped via
 * `shouldRead`, in which case their bytes are discarded as they stream past.
 *
 * Throw `STOP_READING` from `handler` to finish early (used by preview,
 * which only needs the first two entries).
 */
export async function readZip(
  archive: Blob,
  handler: ZipEntryHandler,
  options: {
    shouldRead?: (path: string) => boolean
    signal?: AbortSignal
    onProgress?: (bytesRead: number, total: number) => void
  } = {},
): Promise<void> {
  const pendingHandlers: Promise<void>[] = []
  let failure: unknown = null
  let stopped = false
  let sawEntry = false

  const unzip = new Unzip()
  unzip.register(UnzipInflate)

  unzip.onfile = (file) => {
    sawEntry = true
    const wanted = options.shouldRead ? options.shouldRead(file.name) : true
    const chunks: Uint8Array[] = []

    file.ondata = (err, data, final) => {
      if (err) {
        failure ||= err
        return
      }
      if (wanted && data && data.length) chunks.push(data)
      if (final && wanted) {
        let total = 0
        for (const c of chunks) total += c.length
        const bytes = new Uint8Array(total)
        let offset = 0
        for (const c of chunks) {
          bytes.set(c, offset)
          offset += c.length
        }
        chunks.length = 0
        // `handler` may throw synchronously, so wrap the call itself.
        pendingHandlers.push(
          (async () => handler({ path: file.name, bytes }))().catch((error) => {
            if (error === STOP_READING) stopped = true
            else failure ||= error
          }),
        )
      }
    }
    file.start()
  }

  let read = 0
  const total = archive.size
  const iterator = iterateBlob(archive)

  for (;;) {
    options.signal?.throwIfAborted()
    if (failure) break
    if (stopped) break

    const { done, value } = await iterator.next()
    if (done) {
      unzip.push(new Uint8Array(0), true)
      break
    }
    read += value.length
    unzip.push(value, false)
    options.onProgress?.(read, total)
    // Let queued handlers run so IndexedDB writes keep pace with parsing.
    await Promise.all(pendingHandlers.splice(0, pendingHandlers.length))
  }

  await Promise.all(pendingHandlers)

  if (failure && failure !== STOP_READING) {
    // Errors raised by the caller's handler (validation, quota, ...) already
    // carry a user-facing message; only fflate's own failures get wrapped.
    if (failure instanceof AppError) throw failure
    throw new AppError(
      'Не удалось прочитать архив. Возможно, файл повреждён или это не backup-архив.',
      'zip_read_failed',
      String((failure as Error)?.message ?? failure),
    )
  }
  if (!sawEntry && !stopped) {
    throw new AppError(
      'Архив пуст или имеет неизвестный формат.',
      'zip_empty',
    )
  }
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}
