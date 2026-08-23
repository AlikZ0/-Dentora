/**
 * Tiny static server for the generated PWA.
 *
 * A plain file server is deliberate: the app has no backend, so this is
 * exactly how it will be hosted. SPA fallback sends unknown paths to
 * index.html, matching the service worker's `navigateFallback`.
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const ROOT = process.argv[2] ?? '.output/public'
const PORT = Number(process.argv[3] ?? 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let path = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''))

  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html')
  if (!existsSync(path)) path = join(ROOT, 'index.html') // SPA fallback

  res.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    // The service worker must never be served stale.
    'cache-control': path.endsWith('sw.js') ? 'no-cache' : 'public, max-age=0',
  })
  createReadStream(path).pipe(res)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`)
})
