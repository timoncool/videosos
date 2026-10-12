import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteFile, withResourceLock } from './lifecycle-store.mjs'
import { HttpError } from './http-security.mjs'

const IDEMPOTENCY_LIMITS = {
  ttlMs: 24 * 60 * 60 * 1000,
  maxCount: 4096,
  maxTotalResponseBytes: 512 * 1024 * 1024,
  maxResponseBytes: 40 * 1024 * 1024,
}

function validateIdempotencyKey(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[\x20-\x7e]+$/.test(value)
  ) {
    throw new HttpError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key must be 1-128 printable ASCII characters',
    )
  }
  return value
}

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const responseBytes = (record, limits) =>
  record.state === 'pending'
    ? limits.maxResponseBytes
    : Buffer.byteLength(JSON.stringify(record.response ?? null))

async function inspectAndClean(dir, now, limits) {
  const records = []
  const entries = await fs.promises
    .readdir(dir, { withFileTypes: true })
    .catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)))
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) continue
    const file = path.join(dir, entry.name)
    try {
      const record = JSON.parse(await fs.promises.readFile(file, 'utf8'))
      const timestamp = Number(record.updatedAt ?? record.createdAt)
      if (Number.isFinite(timestamp) && now - timestamp > limits.ttlMs) {
        await fs.promises.rm(file, { force: true })
        continue
      }
      records.push({ file, record })
    } catch {
      // Corrupt ledgers still consume count capacity and are never deleted as
      // an eviction shortcut; operator inspection is safer than reuse.
      records.push({ file, record: { state: 'pending' } })
    }
  }
  return records
}

function assertCapacity(records, limits) {
  const total = records.reduce((sum, entry) => sum + responseBytes(entry.record, limits), 0)
  if (
    records.length >= limits.maxCount ||
    total + limits.maxResponseBytes > limits.maxTotalResponseBytes
  ) {
    throw new HttpError(
      507,
      'IDEMPOTENCY_CAPACITY',
      'Idempotency ledger capacity is exhausted; retry after completed ledgers expire',
    )
  }
}

export async function withIdempotency(
  workspace,
  {
    key,
    method,
    route,
    requestBytes,
    limits = IDEMPOTENCY_LIMITS,
    now = () => Date.now(),
    recoverPending,
  },
  operation,
) {
  validateIdempotencyKey(key)
  const dir = path.join(workspace, '.freecut-headless', 'idempotency')
  const keyHash = hash(key)
  const file = path.join(dir, `${keyHash}.json`)
  const requestHash = hash(requestBytes)
  return withResourceLock(`idempotency:${keyHash}`, async () => {
    let existing
    let created = false
    await withResourceLock('idempotency:capacity', async () => {
      await fs.promises.mkdir(dir, { recursive: true })
      const records = await inspectAndClean(dir, now(), limits)
      existing = records.find((entry) => entry.file === file)?.record
      if (existing) return
      assertCapacity(records, limits)
      const timestamp = now()
      const pending = {
        method,
        route,
        requestHash,
        state: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await atomicWriteFile(file, Buffer.from(`${JSON.stringify(pending, null, 2)}\n`))
      existing = pending
      created = true
    })

    if (
      existing.method !== method ||
      existing.route !== route ||
      existing.requestHash !== requestHash
    ) {
      throw new HttpError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Idempotency-Key was used for a different request',
      )
    }
    if (existing.state === 'complete')
      return { replayed: true, status: existing.status, response: existing.response }
    // A pending record created by this invocation has the same timestamp and
    // request. Any older pending record is crash-left and must not be replayed.
    if (!created) {
      const recovered = await recoverPending?.({ requestHash })
      if (!recovered)
        throw new HttpError(
          409,
          'IDEMPOTENCY_INDETERMINATE',
          'A previous request with this key may have committed',
        )
      const complete = {
        ...existing,
        state: 'complete',
        updatedAt: now(),
        status: recovered.status,
        response: recovered.response,
      }
      await atomicWriteFile(file, Buffer.from(`${JSON.stringify(complete, null, 2)}\n`))
      return { replayed: true, ...recovered }
    }

    let result
    try {
      result = await operation({ requestHash })
    } catch (error) {
      if (error?.idempotencyCommitState !== 'may-have-committed')
        await fs.promises.rm(file, { force: true }).catch(() => {})
      throw error
    }
    const serializedResponseBytes = Buffer.byteLength(JSON.stringify(result.response ?? null))
    if (serializedResponseBytes > limits.maxResponseBytes) {
      await fs.promises.rm(file, { force: true }).catch(() => {})
      throw new HttpError(507, 'IDEMPOTENCY_CAPACITY', 'Response exceeds idempotency ledger limit')
    }
    const complete = {
      ...existing,
      state: 'complete',
      updatedAt: now(),
      status: result.status,
      response: result.response,
    }
    await atomicWriteFile(file, Buffer.from(`${JSON.stringify(complete, null, 2)}\n`))
    return { replayed: false, ...result }
  })
}
