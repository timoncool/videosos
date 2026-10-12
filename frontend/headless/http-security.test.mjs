import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHarnessServer } from './server.mjs'
import { createMediaServer } from './media-server.mjs'
import {
  assertSinglePathComponent,
  readJsonBody,
  resolveContained,
  sendHttpError,
  setHttpTimeouts,
} from './lib/http-security.mjs'
import { loadProjectById, loadProjectFile, resolveMediaFile } from './lib/workspace.mjs'

function fixture() {
  // realpath: resolveContained returns canonical paths, and macOS tmpdir lives
  // behind the /var -> /private/var symlink — expectations must be canonical too.
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-http-security-')),
  )
  const dist = path.join(root, 'dist')
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dist, 'headless.html'), 'harness')
  fs.writeFileSync(path.join(dist, 'assets', 'asset.txt'), '0123456789')
  fs.mkdirSync(path.join(workspace, 'projects', 'safe-project'), { recursive: true })
  fs.writeFileSync(
    path.join(workspace, 'projects', 'safe-project', 'project.json'),
    JSON.stringify({ id: 'safe' }),
  )
  fs.mkdirSync(path.join(workspace, 'media', 'safe-media'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'media', 'safe-media', 'source.bin'), '0123456789')
  fs.writeFileSync(path.join(root, 'direct.json'), JSON.stringify({ id: 'direct' }))
  fs.mkdirSync(path.join(root, 'dist-secret'), { recursive: true })
  fs.writeFileSync(path.join(root, 'dist-secret', 'secret.txt'), 'secret')
  return { root, dist, workspace }
}

function rawRequest(base, requestPath, { method = 'GET', headers } = {}) {
  const url = new URL(base)
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: url.port, path: requestPath, method, headers },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

test('ids reject both separator styles and workspace lookups remain contained', () => {
  const { root, workspace } = fixture()
  try {
    for (const id of ['../escape', '..\\escape', '/absolute', 'C:\\absolute', '.', '..']) {
      assert.throws(
        () => assertSinglePathComponent(id),
        (error) => error.code === 'INVALID_ID',
      )
      assert.throws(
        () => loadProjectById(workspace, id),
        (error) => error.code === 'INVALID_ID',
      )
      assert.throws(
        () => resolveMediaFile(workspace, id),
        (error) => error.code === 'INVALID_ID',
      )
    }
    assert.equal(loadProjectById(workspace, 'safe-project').project.id, 'safe')
    assert.equal(loadProjectFile(path.join(root, 'direct.json')).project.id, 'direct')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('canonical containment rejects traversal and sibling-prefix paths', () => {
  const { root, dist } = fixture()
  try {
    assert.throws(
      () => resolveContained(dist, '../dist-secret/secret.txt'),
      (error) => error.code === 'PATH_OUTSIDE_ROOT',
    )
    assert.equal(resolveContained(dist, 'assets/asset.txt'), path.join(dist, 'assets', 'asset.txt'))
    const link = path.join(dist, 'outside-link')
    try {
      fs.symlinkSync(
        path.join(root, 'dist-secret'),
        link,
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      assert.throws(
        () => resolveContained(dist, 'outside-link/secret.txt'),
        (error) => error.code === 'PATH_OUTSIDE_ROOT',
      )
      assert.throws(
        () => resolveContained(dist, 'outside-link/missing.txt'),
        (error) => error.code === 'PATH_OUTSIDE_ROOT',
      )
    } catch (error) {
      if (!['EPERM', 'EACCES'].includes(error.code)) throw error
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('harness rejects encoded traversal, malformed encoding, and non-read methods', async () => {
  const { root, dist } = fixture()
  const server = await createHarnessServer({ distDir: dist })
  try {
    assert.equal((await rawRequest(server.base, '/%2e%2e/dist-secret/secret.txt')).status, 403)
    assert.equal(
      (await rawRequest(server.base, '/assets/%2e%2e/%2e%2e/dist-secret/secret.txt')).status,
      403,
    )
    assert.equal((await rawRequest(server.base, '/%E0%A4%A')).status, 400)
    const post = await rawRequest(server.base, '/headless.html', { method: 'POST' })
    assert.equal(post.status, 405)
    assert.equal(post.headers.allow, 'GET, HEAD')
  } finally {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('media server implements valid single ranges and 416 rejections', async () => {
  const { root, workspace } = fixture()
  const file = resolveMediaFile(workspace, 'safe-media')
  const server = await createMediaServer(new Map([['safe-media', file]]))
  try {
    const range = await rawRequest(server.base, '/media/safe-media', {
      headers: { Range: 'bytes=2-5' },
    })
    assert.equal(range.status, 206)
    assert.equal(range.body.toString(), '2345')
    assert.equal(range.headers['content-range'], 'bytes 2-5/10')
    const suffix = await rawRequest(server.base, '/media/safe-media', {
      headers: { Range: 'bytes=-3' },
    })
    assert.equal(suffix.body.toString(), '789')
    for (const invalid of ['bytes=20-30', 'bytes=5-2', 'bytes=0-1,3-4', 'items=0-2', 'bytes=-0']) {
      const response = await rawRequest(server.base, '/media/safe-media', {
        headers: { Range: invalid },
      })
      assert.equal(response.status, 416, invalid)
      assert.equal(response.headers['content-range'], 'bytes */10')
    }
    assert.equal((await rawRequest(server.base, '/media/%2e%2e%2fsecret')).status, 400)
    assert.equal(
      (await rawRequest(server.base, '/media/safe-media', { method: 'POST' })).status,
      405,
    )
  } finally {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

async function bodyTestServer(options) {
  const server = http.createServer(async (req, res) => {
    try {
      await readJsonBody(req, options)
      res.writeHead(200).end()
    } catch (error) {
      sendHttpError(res, error)
    }
  })
  setHttpTimeouts(server, { headersTimeoutMs: 100, requestTimeoutMs: 100 })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, base: `http://127.0.0.1:${server.address().port}` }
}

test('body reader counts bytes and rejects oversized chunked bodies', async () => {
  const { server, base } = await bodyTestServer({ maxBytes: 5, timeoutMs: 100 })
  try {
    const url = new URL(base)
    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: url.hostname,
          port: url.port,
          method: 'POST',
          headers: { 'Transfer-Encoding': 'chunked' },
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve(res))
        },
      )
      req.on('error', reject)
      req.write(Buffer.from([0xc3, 0xa9, 0xc3, 0xa9]))
      req.end(Buffer.from([0xc3, 0xa9]))
    })
    assert.equal(response.statusCode, 413)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('body reader rejects slow incomplete bodies', async () => {
  const { server, base } = await bodyTestServer({ maxBytes: 100, timeoutMs: 20 })
  try {
    const url = new URL(base)
    const response = await new Promise((resolve, reject) => {
      const req = http.request({ host: url.hostname, port: url.port, method: 'POST' }, (res) => {
        res.resume()
        res.on('end', () => resolve(res))
      })
      req.on('error', reject)
      req.write('{')
    })
    assert.equal(response.statusCode, 408)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('aborted file streams are cleaned up and do not poison the server', async () => {
  const { root, workspace } = fixture()
  const file = resolveMediaFile(workspace, 'safe-media')
  fs.writeFileSync(file, Buffer.alloc(2 * 1024 * 1024, 7))
  const server = await createMediaServer(new Map([['safe-media', file]]))
  try {
    const url = new URL(server.base)
    await new Promise((resolve, reject) => {
      const req = http.get(
        { host: url.hostname, port: url.port, path: '/media/safe-media' },
        (res) => {
          res.once('data', () => res.destroy())
          res.once('close', resolve)
        },
      )
      req.on('error', reject)
    })
    const next = await rawRequest(server.base, '/media/safe-media', { method: 'HEAD' })
    assert.equal(next.status, 200)
  } finally {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
