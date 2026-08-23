import 'fake-indexeddb/auto'

// Node exposes Blob/File/crypto.subtle natively (18+), and `structuredClone`
// can clone a Blob, which is what fake-indexeddb needs to persist file bytes.
if (!globalThis.crypto?.subtle) {
  throw new Error('Web Crypto is required to run these tests (Node 18+).')
}
