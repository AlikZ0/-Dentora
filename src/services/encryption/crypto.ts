import { DecryptionError, AppError } from '~/utils/errors'

/**
 * Password-protected backup container.
 *
 * AES-GCM cannot be streamed by the Web Crypto API - `encrypt()` wants the
 * whole plaintext and `decrypt()` the whole ciphertext. A 1.4 GB backup
 * would therefore need several gigabytes of RAM. So the payload is split
 * into fixed-size chunks, each sealed independently with a deterministic IV
 * (`noncePrefix || counter`) and an AAD that binds the chunk's index and
 * whether it is the last one. That is the standard STREAM construction;
 * no primitive here is home-grown.
 *
 * Layout (all integers big-endian):
 *
 *   0   8   magic  "DNTRAEN1"
 *   8   1   container version (1)
 *   9   1   KDF id (1 = PBKDF2-SHA256)
 *   10  4   PBKDF2 iterations
 *   14  16  salt
 *   30  8   nonce prefix
 *   38  4   plaintext chunk size
 *   42  ..  repeated: [4-byte ciphertext length][ciphertext]
 */

export const MAGIC = new Uint8Array([0x44, 0x4e, 0x54, 0x52, 0x41, 0x45, 0x4e, 0x31]) // DNTRAEN1
export const CONTAINER_VERSION = 1
export const KDF_PBKDF2_SHA256 = 1
export const HEADER_SIZE = 42

/** OWASP-recommended floor for PBKDF2-SHA256 (2023). */
export const DEFAULT_ITERATIONS = 600_000
/** 4 MiB plaintext per chunk: ~16 chunks per 64 MB x-ray, tiny peak memory. */
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024
const GCM_TAG_BYTES = 16

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) {
    throw new AppError(
      'Шифрование недоступно. Откройте приложение по HTTPS или на localhost.',
      'crypto_unavailable',
    )
  }
  return s
}

export function isEncryptedContainer(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_SIZE) return false
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) return false
  return true
}

interface Header {
  containerVersion: number
  kdfId: number
  iterations: number
  salt: Uint8Array
  noncePrefix: Uint8Array
  chunkSize: number
}

function readHeader(bytes: Uint8Array): Header {
  if (!isEncryptedContainer(bytes)) {
    throw new AppError('Файл не является зашифрованным backup.', 'not_encrypted')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const header: Header = {
    containerVersion: view.getUint8(8),
    kdfId: view.getUint8(9),
    iterations: view.getUint32(10, false),
    salt: bytes.subarray(14, 30),
    noncePrefix: bytes.subarray(30, 38),
    chunkSize: view.getUint32(38, false),
  }
  if (header.containerVersion !== CONTAINER_VERSION) {
    throw new AppError(
      `Backup зашифрован более новой версией приложения (формат ${header.containerVersion}). Обновите приложение.`,
      'container_version',
    )
  }
  if (header.kdfId !== KDF_PBKDF2_SHA256) {
    throw new AppError('Неподдерживаемый способ шифрования backup.', 'kdf_unsupported')
  }
  if (header.chunkSize <= 0 || header.chunkSize > 64 * 1024 * 1024) {
    throw new AppError('Повреждённый заголовок зашифрованного backup.', 'bad_header')
  }
  return header
}

function writeHeader(h: Header): Uint8Array {
  const out = new Uint8Array(HEADER_SIZE)
  out.set(MAGIC, 0)
  const view = new DataView(out.buffer)
  view.setUint8(8, h.containerVersion)
  view.setUint8(9, h.kdfId)
  view.setUint32(10, h.iterations, false)
  out.set(h.salt, 14)
  out.set(h.noncePrefix, 30)
  view.setUint32(38, h.chunkSize, false)
  return out
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function chunkIv(noncePrefix: Uint8Array, counter: number): Uint8Array {
  const iv = new Uint8Array(12)
  iv.set(noncePrefix, 0)
  new DataView(iv.buffer).setUint32(8, counter, false)
  return iv
}

/** AAD binds each chunk to its position, so chunks cannot be reordered or truncated. */
function chunkAad(counter: number, isFinal: boolean): Uint8Array {
  const aad = new Uint8Array(MAGIC.length + 5)
  aad.set(MAGIC, 0)
  new DataView(aad.buffer).setUint32(MAGIC.length, counter, false)
  aad[MAGIC.length + 4] = isFinal ? 1 : 0
  return aad
}

export interface CryptoProgress {
  processed: number
  total: number
}

/**
 * Encrypts a blob into the container above. Reads and writes chunk by chunk,
 * so peak memory is roughly `chunkSize`, not the size of the backup.
 */
export async function encryptBlob(
  input: Blob,
  password: string,
  options: {
    iterations?: number
    chunkSize?: number
    onProgress?: (p: CryptoProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<Blob> {
  if (!password) throw new AppError('Пароль не может быть пустым.', 'empty_password')

  const iterations = options.iterations ?? DEFAULT_ITERATIONS
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const noncePrefix = crypto.getRandomValues(new Uint8Array(8))
  const key = await deriveKey(password, salt, iterations)

  const parts: BlobPart[] = [
    writeHeader({
      containerVersion: CONTAINER_VERSION,
      kdfId: KDF_PBKDF2_SHA256,
      iterations,
      salt,
      noncePrefix,
      chunkSize,
    }) as BlobPart,
  ]

  const total = input.size
  // A zero-byte payload still needs one (empty, final) chunk so that decrypt
  // has something to authenticate.
  const chunkCount = Math.max(1, Math.ceil(total / chunkSize))

  for (let index = 0; index < chunkCount; index++) {
    options.signal?.throwIfAborted()
    const start = index * chunkSize
    const slice = input.slice(start, Math.min(start + chunkSize, total))
    const plaintext = new Uint8Array(await slice.arrayBuffer())
    const isFinal = index === chunkCount - 1

    const ciphertext = new Uint8Array(
      await subtle().encrypt(
        {
          name: 'AES-GCM',
          iv: chunkIv(noncePrefix, index) as BufferSource,
          additionalData: chunkAad(index, isFinal) as BufferSource,
        },
        key,
        plaintext as BufferSource,
      ),
    )

    const length = new Uint8Array(4)
    new DataView(length.buffer).setUint32(0, ciphertext.byteLength, false)
    parts.push(length as BlobPart, ciphertext as BlobPart)

    options.onProgress?.({ processed: Math.min(start + chunkSize, total), total })
  }

  return new Blob(parts, { type: 'application/octet-stream' })
}

/**
 * Reverses `encryptBlob`. Any authentication failure - wrong password, a
 * flipped bit, a truncated file - surfaces as the same `DecryptionError`,
 * because the three are cryptographically indistinguishable.
 */
export async function decryptBlob(
  input: Blob,
  password: string,
  options: { onProgress?: (p: CryptoProgress) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  const headerBytes = new Uint8Array(await input.slice(0, HEADER_SIZE).arrayBuffer())
  const header = readHeader(headerBytes)
  const key = await deriveKey(password, header.salt, header.iterations)

  const parts: BlobPart[] = []
  let offset = HEADER_SIZE
  let index = 0
  const total = input.size

  while (offset < total) {
    options.signal?.throwIfAborted()

    const lengthBytes = new Uint8Array(await input.slice(offset, offset + 4).arrayBuffer())
    if (lengthBytes.byteLength < 4) throw new DecryptionError('truncated_length_prefix')
    const cipherLength = new DataView(lengthBytes.buffer).getUint32(0, false)
    offset += 4

    if (cipherLength < GCM_TAG_BYTES || offset + cipherLength > total) {
      throw new DecryptionError('truncated_chunk')
    }
    const ciphertext = await input.slice(offset, offset + cipherLength).arrayBuffer()
    offset += cipherLength
    const isFinal = offset >= total

    try {
      const plaintext = await subtle().decrypt(
        {
          name: 'AES-GCM',
          iv: chunkIv(header.noncePrefix, index) as BufferSource,
          additionalData: chunkAad(index, isFinal) as BufferSource,
        },
        key,
        ciphertext,
      )
      parts.push(plaintext)
    } catch {
      throw new DecryptionError(`chunk_${index}_auth_failed`)
    }

    index += 1
    options.onProgress?.({ processed: offset, total })
  }

  if (index === 0) throw new DecryptionError('no_chunks')
  return new Blob(parts, { type: 'application/zip' })
}

/** Rough strength hint for the export dialog. Never blocks the user. */
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3; label: string } {
  const length = password.length
  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password))

  if (length < 8) return { score: 0, label: 'Слишком короткий' }
  if (length < 12 || classes < 2) return { score: 1, label: 'Слабый' }
  if (length < 16 || classes < 3) return { score: 2, label: 'Нормальный' }
  return { score: 3, label: 'Надёжный' }
}
