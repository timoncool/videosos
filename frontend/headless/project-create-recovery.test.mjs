import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { withIdempotency } from './lib/idempotency.mjs'
import { createProjectResource } from './lib/lifecycle-store.mjs'
import { recoverDeterministicProjectCreate } from './serve.mjs'

const workspace = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-project-recovery-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

const requestHash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const keyHash = (key) => crypto.createHash('sha256').update(key).digest('hex')

function writePending(root, key, raw) {
  const directory = path.join(root, '.freecut-headless', 'idempotency')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${keyHash(key)}.json`)
  fs.writeFileSync(
    file,
    JSON.stringify({
      method: 'POST',
      route: '/v1/projects',
      requestHash: requestHash(raw),
      state: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  )
  return file
}

function projectFrom(body, overrides = {}) {
  return {
    id: body.id,
    name: body.name,
    description: body.description ?? '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    schemaVersion: 14,
    metadata: {
      width: body.width ?? 1920,
      height: body.height ?? 1080,
      fps: body.fps ?? 30,
      ...(body.backgroundColor ? { backgroundColor: body.backgroundColor } : {}),
    },
    ...overrides,
  }
}

const body = {
  id: 'reels_project',
  name: 'Reels Project',
  description: 'Imported recording',
  width: 1080,
  height: 1920,
  fps: 30,
  backgroundColor: '#000000',
}

function idempotentCreate(root, requestBody, key, execute) {
  const raw = Buffer.from(JSON.stringify(requestBody))
  return withIdempotency(
    root,
    {
      key,
      method: 'POST',
      route: '/v1/projects',
      requestBytes: raw,
      recoverPending: () => recoverDeterministicProjectCreate(root, requestBody, execute),
    },
    execute,
  )
}

test('pending deterministic create reruns safely when the project is absent', async (t) => {
  const root = workspace(t)
  const raw = Buffer.from(JSON.stringify(body))
  const ledger = writePending(root, 'absent-key', raw)
  let executions = 0
  const execute = async () => {
    executions++
    const resource = await createProjectResource(root, projectFrom(body))
    return { status: 201, response: { ok: true, apiVersion: 1, ...resource } }
  }
  const result = await idempotentCreate(root, body, 'absent-key', execute)
  assert.equal(result.replayed, true)
  assert.equal(executions, 1)
  assert.equal(JSON.parse(fs.readFileSync(ledger, 'utf8')).state, 'complete')
})

test('pending deterministic create adopts an exact resource without browser side effects', async (t) => {
  const root = workspace(t)
  await createProjectResource(root, projectFrom(body))
  const raw = Buffer.from(JSON.stringify(body))
  const ledger = writePending(root, 'matching-key', raw)
  let executions = 0
  const result = await idempotentCreate(root, body, 'matching-key', async () => {
    executions++
    throw new Error('must not execute')
  })
  assert.equal(result.replayed, true)
  assert.equal(result.status, 201)
  assert.equal(result.response.project.id, body.id)
  assert.equal(executions, 0)
  assert.equal(JSON.parse(fs.readFileSync(ledger, 'utf8')).state, 'complete')
})

test('pending deterministic create conflicts on profile mismatch and retains evidence', async (t) => {
  const root = workspace(t)
  await createProjectResource(root, projectFrom(body, { name: 'Different' }))
  const raw = Buffer.from(JSON.stringify(body))
  const ledger = writePending(root, 'mismatch-key', raw)
  let executions = 0
  await assert.rejects(
    () =>
      idempotentCreate(root, body, 'mismatch-key', async () => {
        executions++
      }),
    (error) => error.code === 'PROJECT_CREATE_CONFLICT' && error.statusCode === 409,
  )
  assert.equal(executions, 0)
  assert.equal(JSON.parse(fs.readFileSync(ledger, 'utf8')).state, 'pending')
})

test('pending create without a caller id remains indeterminate', async (t) => {
  const root = workspace(t)
  const nondeterministic = { name: 'No id', width: 1080, height: 1920, fps: 30 }
  const raw = Buffer.from(JSON.stringify(nondeterministic))
  const ledger = writePending(root, 'no-id-key', raw)
  let executions = 0
  await assert.rejects(
    () =>
      idempotentCreate(root, nondeterministic, 'no-id-key', async () => {
        executions++
      }),
    (error) => error.code === 'IDEMPOTENCY_INDETERMINATE',
  )
  assert.equal(executions, 0)
  assert.equal(JSON.parse(fs.readFileSync(ledger, 'utf8')).state, 'pending')
})
