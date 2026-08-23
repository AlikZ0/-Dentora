import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHUNK_SIZE,
  decryptBlob,
  encryptBlob,
  isEncryptedContainer,
  passwordStrength,
} from '~/services/encryption/crypto'
import { DecryptionError } from '~/utils/errors'

// Keep the KDF cheap in tests; production uses 600_000.
const ITER = 1_000

async function text(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer())
}

describe('backup encryption', () => {
  it('round-trips a payload', async () => {
    const payload = new Blob(['Клиент 1 — рентген'], { type: 'application/zip' })
    const sealed = await encryptBlob(payload, 'correct horse battery', { iterations: ITER })

    expect(sealed.size).toBeGreaterThan(payload.size)
    expect(
      isEncryptedContainer(new Uint8Array(await sealed.slice(0, 64).arrayBuffer())),
    ).toBe(true)

    const opened = await decryptBlob(sealed, 'correct horse battery')
    expect(await text(opened)).toBe('Клиент 1 — рентген')
  })

  it('rejects a wrong password with a user-facing message', async () => {
    const sealed = await encryptBlob(new Blob(['secret']), 'right', { iterations: ITER })
    await expect(decryptBlob(sealed, 'wrong')).rejects.toBeInstanceOf(DecryptionError)
    await expect(decryptBlob(sealed, 'wrong')).rejects.toThrow(
      'Неверный пароль или повреждённый backup.',
    )
  })

  it('rejects a corrupted container', async () => {
    const sealed = await encryptBlob(new Blob(['secret payload here']), 'pw', { iterations: ITER })
    const bytes = new Uint8Array(await sealed.arrayBuffer())
    bytes[bytes.length - 3] = (bytes[bytes.length - 3] ?? 0) ^ 0xff // flip a bit inside the GCM tag
    await expect(decryptBlob(new Blob([bytes]), 'pw')).rejects.toBeInstanceOf(DecryptionError)
  })

  it('rejects a truncated container', async () => {
    const sealed = await encryptBlob(new Blob(['secret payload here']), 'pw', { iterations: ITER })
    const cut = sealed.slice(0, sealed.size - 5)
    await expect(decryptBlob(cut, 'pw')).rejects.toBeInstanceOf(DecryptionError)
  })

  it('spans multiple chunks and reports progress', async () => {
    const chunkSize = 4096
    const payload = new Blob([new Uint8Array(chunkSize * 3 + 17).fill(7)])
    const seen: number[] = []
    const sealed = await encryptBlob(payload, 'pw', {
      iterations: ITER,
      chunkSize,
      onProgress: (p) => seen.push(p.processed),
    })
    expect(seen.length).toBe(4)

    const opened = await decryptBlob(sealed, 'pw')
    expect(opened.size).toBe(payload.size)
    expect(new Uint8Array(await opened.arrayBuffer()).every((b) => b === 7)).toBe(true)
  })

  it('detects chunk reordering via the AAD binding', async () => {
    // Two chunks of identical plaintext still get distinct IV+AAD, so swapping
    // the ciphertexts must fail authentication.
    const chunkSize = 32
    const payload = new Blob([new Uint8Array(64).fill(1)])
    const sealed = await encryptBlob(payload, 'pw', { iterations: ITER, chunkSize })
    const bytes = new Uint8Array(await sealed.arrayBuffer())

    const header = 42
    const len = 4
    const cipherLen = 32 + 16
    const a = bytes.slice(header + len, header + len + cipherLen)
    const b = bytes.slice(header + len + cipherLen + len, header + len + cipherLen + len + cipherLen)
    bytes.set(b, header + len)
    bytes.set(a, header + len + cipherLen + len)

    await expect(decryptBlob(new Blob([bytes]), 'pw')).rejects.toBeInstanceOf(DecryptionError)
  })

  it('handles an empty payload', async () => {
    const sealed = await encryptBlob(new Blob([]), 'pw', { iterations: ITER })
    const opened = await decryptBlob(sealed, 'pw')
    expect(opened.size).toBe(0)
  })

  it('uses a 4 MiB default chunk size', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(4 * 1024 * 1024)
  })

  it('scores password strength', () => {
    expect(passwordStrength('abc').score).toBe(0)
    expect(passwordStrength('abcdefghij').score).toBe(1)
    expect(passwordStrength('Abcdefghij12').score).toBe(2)
    expect(passwordStrength('Abcdefghij12!@#$').score).toBe(3)
  })
})
