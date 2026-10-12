// Tiny static media server for headless rendering.
//
// Serves media files by id with CORS + Cross-Origin-Resource-Policy headers so
// the harness page (which runs under COEP: require-corp) can fetch them
// cross-origin, plus HTTP Range support for partial reads.
import http from 'node:http'
import path from 'node:path'
import {
  assertSinglePathComponent,
  decodeRequestPath,
  requireGetOrHead,
  sendHttpError,
  serveFile,
  setHttpTimeouts,
} from './lib/http-security.mjs'

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/**
 * @param {Map<string,string> | ((mediaId: string) => string | null)} mediaFilesOrResolver
 *   A mediaId->path Map, or a resolver function (mediaId) => absolute path | null.
 * @param {number} [port]  0 = ephemeral
 * @returns {Promise<{ base: string, url: (id: string) => string, close: () => Promise<void> }>}
 */
export async function createMediaServer(mediaFilesOrResolver, port = 0) {
  const resolveMedia =
    typeof mediaFilesOrResolver === 'function'
      ? mediaFilesOrResolver
      : (mediaId) => mediaFilesOrResolver.get(mediaId) ?? null
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Access-Control-Allow-Headers', 'range')
    res.setHeader('Access-Control-Expose-Headers', 'content-range, accept-ranges, content-length')

    try {
      if (!requireGetOrHead(req, res)) return
      const pathname = decodeRequestPath(req)
      const match = pathname.match(/^\/media\/(.+)$/)
      if (!match) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      const mediaId = assertSinglePathComponent(match[1], 'media id')
      const filePath = resolveMedia(mediaId)
      if (!filePath) {
        res.writeHead(404)
        res.end('media not found')
        return
      }
      await serveFile(req, res, filePath, {
        contentType: MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        allowRange: true,
      })
    } catch (error) {
      sendHttpError(res, error)
    }
  })
  setHttpTimeouts(server)

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  const actualPort = server.address().port
  const base = `http://127.0.0.1:${actualPort}`

  return {
    base,
    url: (mediaId) => `${base}/media/${encodeURIComponent(mediaId)}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
