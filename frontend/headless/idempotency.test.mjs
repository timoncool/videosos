import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { withIdempotency } from './lib/idempotency.mjs'

const workspace = () => fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-idempotency-'))
const request = (key, overrides = {}) => ({
  key,
  method: 'POST',
  route: '/v1/projects',
  requestBytes: Buffer.from('{}'),
  ...overrides,
})
const operation = async () => ({ status: 201, response: { ok: true } })

test('expired ledgers are deterministically removed before capacity accounting', async (t) => {
  const root = workspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const limits = { ttlMs: 10, maxCount: 1, maxTotalResponseBytes: 1000, maxResponseBytes: 100 }
  let clock = 0
  await withIdempotency(root, request('old', { limits, now: () => clock }), operation)
  clock = 11
  const result = await withIdempotency(
    root,
    request('new', { limits, now: () => clock }),
    operation,
  )
  assert.equal(result.status, 201)
  assert.equal(fs.readdirSync(path.join(root, '.freecut-headless', 'idempotency')).length, 1)
})

test('capacity exhaustion is structured and does not evict a live pending ledger', async (t) => {
  const root = workspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, '.freecut-headless', 'idempotency')
  fs.mkdirSync(dir, { recursive: true })
  const pendingFile = path.join(dir, `${'0'.repeat(64)}.json`)
  fs.writeFileSync(
    pendingFile,
    JSON.stringify({
      method: 'POST',
      route: '/v1/projects',
      requestHash: 'hash',
      state: 'pending',
      createdAt: 100,
      updatedAt: 100,
    }),
  )
  const limits = { ttlMs: 1000, maxCount: 1, maxTotalResponseBytes: 1000, maxResponseBytes: 100 }
  await assert.rejects(
    () => withIdempotency(root, request('new', { limits, now: () => 100 }), operation),
    (error) => error.statusCode === 507 && error.code === 'IDEMPOTENCY_CAPACITY',
  )
  assert.equal(fs.existsSync(pendingFile), true)
})

test('total response-byte capacity is enforced independently of ledger count', async (t) => {
  const root = workspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const limits = {
    ttlMs: 1000,
    maxCount: 10,
    maxTotalResponseBytes: 110,
    maxResponseBytes: 100,
  }
  await withIdempotency(root, request('first', { limits, now: () => 100 }), operation)
  await assert.rejects(
    () => withIdempotency(root, request('second', { limits, now: () => 100 }), operation),
    (error) => error.statusCode === 507 && error.code === 'IDEMPOTENCY_CAPACITY',
  )
})
