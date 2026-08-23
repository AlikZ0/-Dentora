/** SHA-256 of a blob, hex-encoded. Used to deduplicate file bytes on merge. */
export async function sha256(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  let buffer: ArrayBuffer
  if (data instanceof Blob) buffer = await data.arrayBuffer()
  else if (data instanceof Uint8Array) buffer = data.slice().buffer
  else buffer = data

  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const bytes = new Uint8Array(digest)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0')
  return out
}
