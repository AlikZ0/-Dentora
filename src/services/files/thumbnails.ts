/**
 * Thumbnail generation.
 *
 * X-rays are routinely 20-80 MB. Rendering a client card must never decode
 * one, so every image gets a <= 320 px WebP/JPEG preview stored alongside
 * its metadata. The original is only read when the viewer opens it.
 */

export const THUMBNAIL_MAX_EDGE = 320
const THUMBNAIL_QUALITY = 0.72

export interface ImageDimensions {
  width: number
  height: number
}

function canDecodeImages(): boolean {
  return typeof createImageBitmap === 'function' && typeof document !== 'undefined'
}

/**
 * Decodes just enough of the image to produce a preview. `createImageBitmap`
 * with `resizeWidth` lets the browser downscale during decode, so a 80 MB
 * x-ray never materialises as a full-size bitmap.
 */
export async function generateThumbnail(
  blob: Blob,
  mimeType = blob.type,
): Promise<Blob | undefined> {
  if (!mimeType.startsWith('image/')) return undefined
  if (!canDecodeImages()) return undefined

  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(bitmap, 0, 0, width, height)

    return await new Promise<Blob | undefined>((resolve) => {
      // Safari only gained WebP encoding in 16; the callback yields null there,
      // so fall back to JPEG.
      canvas.toBlob(
        (result) => {
          if (result) return resolve(result)
          canvas.toBlob((jpeg) => resolve(jpeg ?? undefined), 'image/jpeg', THUMBNAIL_QUALITY)
        },
        'image/webp',
        THUMBNAIL_QUALITY,
      )
    })
  } catch {
    // Unsupported codec (HEIC on non-Apple, DICOM, …). No preview, no failure.
    return undefined
  } finally {
    bitmap?.close()
  }
}

/** Intrinsic dimensions, or `undefined` when the format cannot be decoded. */
export async function readImageDimensions(blob: Blob): Promise<ImageDimensions | undefined> {
  if (!blob.type.startsWith('image/') || typeof createImageBitmap !== 'function') return undefined
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(blob)
    return { width: bitmap.width, height: bitmap.height }
  } catch {
    return undefined
  } finally {
    bitmap?.close()
  }
}
