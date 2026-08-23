import { describe, expect, it } from 'vitest'
import { STOP_READING, createZip, decodeText, readZip } from '~/services/backup/zip'

describe('zip service', () => {
  it('round-trips text and binary entries', async () => {
    const bin = new Uint8Array(1024).map((_, i) => i % 251)
    const archive = await createZip([
      { path: 'backup/manifest.json', data: '{"format":"client-app-backup"}', compress: true },
      { path: 'backup/files/client-001/xray-001.jpg', data: new Blob([bin]) },
    ])

    const seen = new Map<string, Uint8Array>()
    await readZip(archive, (e) => {
      seen.set(e.path, e.bytes)
    })

    expect([...seen.keys()].sort()).toEqual([
      'backup/files/client-001/xray-001.jpg',
      'backup/manifest.json',
    ])
    expect(decodeText(seen.get('backup/manifest.json')!)).toBe('{"format":"client-app-backup"}')
    expect(Array.from(seen.get('backup/files/client-001/xray-001.jpg')!)).toEqual(Array.from(bin))
  })

  it('streams a blob larger than one read chunk', async () => {
    const size = 9 * 1024 * 1024 // above the 8 MiB read chunk
    const payload = new Uint8Array(size)
    for (let i = 0; i < size; i += 7919) payload[i] = 42
    const archive = await createZip([{ path: 'big.bin', data: new Blob([payload]) }])

    let received: Uint8Array | null = null
    await readZip(archive, (e) => {
      received = e.bytes
    })
    expect(received!.length).toBe(size)
    expect(received![0]).toBe(42)
    expect(received![7919]).toBe(42)
    expect(received![size - 1]).toBe(0)
  })

  it('skips entries the caller does not want', async () => {
    const archive = await createZip([
      { path: 'a.txt', data: 'A' },
      { path: 'b.bin', data: new Uint8Array(4096) },
    ])
    const paths: string[] = []
    await readZip(
      archive,
      (e) => {
        paths.push(e.path)
      },
      { shouldRead: (p) => p.endsWith('.txt') },
    )
    expect(paths).toEqual(['a.txt'])
  })

  it('stops early when the handler throws STOP_READING', async () => {
    const archive = await createZip([
      { path: '1.txt', data: 'one' },
      { path: '2.txt', data: 'two' },
      { path: '3.txt', data: 'three' },
    ])
    const paths: string[] = []
    await readZip(archive, (e) => {
      paths.push(e.path)
      if (paths.length === 1) throw STOP_READING
    })
    expect(paths.length).toBeLessThanOrEqual(2)
    expect(paths[0]).toBe('1.txt')
  })

  it('reports progress while writing', async () => {
    const events: number[] = []
    await createZip(
      [
        { path: 'a', data: new Uint8Array(10) },
        { path: 'b', data: new Uint8Array(20) },
      ],
      { onProgress: (p) => events.push(p.entriesDone) },
    )
    expect(events).toEqual([1, 2])
  })

  it('raises a user-facing error for a non-archive', async () => {
    const garbage = new Blob([new Uint8Array(512).fill(9)])
    await expect(readZip(garbage, () => {})).rejects.toThrow(/архив/i)
  })

  it('handles a zero-byte entry', async () => {
    const archive = await createZip([{ path: 'empty.bin', data: new Blob([]) }])
    const sizes: number[] = []
    await readZip(archive, (e) => {
      sizes.push(e.bytes.length)
    })
    expect(sizes).toEqual([0])
  })
})
