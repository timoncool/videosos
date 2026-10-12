import assert from 'node:assert/strict'
import test from 'node:test'
import { ServiceStatus } from './lib/service-status.mjs'

test('service lifecycle and render progress are observable without retaining results', async () => {
  let now = 100
  const status = new ServiceStatus({ now: () => now, instanceId: 'instance-1' })
  status.ready()
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const operation = status.track('render', async () => {
    status.reportProgress({ phase: 'encode', progress: 42, currentFrame: 4, totalFrames: 10 })
    await blocked
    return 'done'
  })
  await Promise.resolve()
  assert.deepEqual(status.snapshot({ active: 1 }).activeOperation.progress, {
    phase: 'encode',
    progress: 42,
    currentFrame: 4,
    totalFrames: 10,
  })
  now = 150
  release()
  assert.equal(await operation, 'done')
  const snapshot = status.snapshot({ active: 0 })
  assert.equal(snapshot.state, 'ready')
  assert.equal(snapshot.activeOperation, null)
  assert.deepEqual(snapshot.activeOperations, [])
  assert.equal(snapshot.lastOperation.state, 'succeeded')
  assert.equal(snapshot.lastOperation.finishedAt, 150)
  assert.equal(snapshot.uptimeMs, 50)
  status.draining()
  assert.equal(status.snapshot({}).state, 'draining')
  status.stopped()
  assert.equal(status.snapshot({}).state, 'stopped')
})

test('concurrent public operations remain independently observable', async () => {
  const status = new ServiceStatus({ now: () => 10, instanceId: 'concurrent' })
  let releaseFirst
  let releaseSecond
  const first = status.track(
    'project-update',
    () => new Promise((resolve) => (releaseFirst = resolve)),
  )
  const second = status.track(
    'project-edit',
    () => new Promise((resolve) => (releaseSecond = resolve)),
  )
  assert.deepEqual(
    status.snapshot({}).activeOperations.map((operation) => operation.kind),
    ['project-update', 'project-edit'],
  )
  releaseSecond('second')
  assert.equal(await second, 'second')
  assert.equal(status.snapshot({}).activeOperation.kind, 'project-update')
  releaseFirst('first')
  assert.equal(await first, 'first')
})

test('failed operations expose a stable error and a fresh instance resets lifecycle state', async () => {
  const first = new ServiceStatus({ now: () => 10, instanceId: 'first' })
  first.ready()
  await assert.rejects(
    first.track('edit', async () => {
      const error = new Error('conflict')
      error.code = 'REVISION_CONFLICT'
      throw error
    }),
  )
  assert.deepEqual(first.snapshot({}).lastOperation.error, { code: 'REVISION_CONFLICT' })

  const restarted = new ServiceStatus({ now: () => 20, instanceId: 'second' })
  assert.equal(restarted.snapshot({}).state, 'starting')
  assert.equal(restarted.snapshot({}).lastOperation, null)
  assert.notEqual(restarted.instanceId, first.instanceId)
})
