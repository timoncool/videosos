import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  acquireWriterLock,
  atomicWriteFile,
  createProjectResource,
  getProjectResource,
  listProjectResources,
  projectForEngine,
  publicProjectResource,
  revisionOf,
  saveProjectResource,
  saveProjectResourceWithCheckpointReceipt,
  stageLocalMedia,
} from './lib/lifecycle-store.mjs'

const tempWorkspace = () => fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-lifecycle-'))
const project = (id = 'p1') => ({
  id,
  name: 'One',
  description: '',
  createdAt: 1,
  updatedAt: 1,
  duration: 0,
  schemaVersion: 14,
  metadata: { width: 1920, height: 1080, fps: 30 },
})

test('checkpoint receipt is committed in the project write and survives phase-update crash', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const created = await createProjectResource(root, project())
  const receipt = {
    operationId: '018f22d2-8d42-7c2a-a4cc-7a3f2c5f6b10',
    requestSha256: `sha256:${'2'.repeat(64)}`,
    recipeSha256: `sha256:${'3'.repeat(64)}`,
    priorRevision: created.revision,
  }
  await assert.rejects(
    () =>
      saveProjectResourceWithCheckpointReceipt(
        root,
        'p1',
        { ...created.project, name: 'Applied once' },
        {
          expectedRevision: created.revision,
          receipt,
          afterCommit: () => {
            throw new Error('simulated kill after project rename')
          },
        },
      ),
    /simulated kill/,
  )
  const committed = await getProjectResource(root, 'p1')
  assert.equal(committed.project.name, 'Applied once')
  const embeddedReceipt = committed.project.checkpointApplicationReceipts[receipt.operationId]
  assert.deepEqual(
    { ...embeddedReceipt, appliedProjectSha256: undefined },
    { ...receipt, appliedProjectSha256: undefined },
  )
  assert.match(embeddedReceipt.appliedProjectSha256, /^sha256:[0-9a-f]{64}$/)
  assert.equal(projectForEngine(committed.project).checkpointApplicationReceipts, undefined)
  assert.equal(publicProjectResource(committed).project.checkpointApplicationReceipts, undefined)
  assert.notEqual(committed.revision, created.revision)
  await assert.rejects(
    () =>
      saveProjectResourceWithCheckpointReceipt(root, 'p1', committed.project, {
        expectedRevision: created.revision,
        receipt: { ...receipt, recipeSha256: `sha256:${'5'.repeat(64)}` },
      }),
    (error) => error.code === 'REVISION_CONFLICT',
  )
})

test('project writes return exact-byte revisions and reject stale saves', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const created = await createProjectResource(root, project())
  const bytes = fs.readFileSync(path.join(root, 'projects', 'p1', 'project.json'))
  assert.equal(created.revision, revisionOf(bytes))
  assert.equal((await getProjectResource(root, 'p1')).project.name, 'One')
  const saved = await saveProjectResource(
    root,
    'p1',
    { ...project(), name: 'Two' },
    { expectedRevision: created.revision },
  )
  assert.equal(saved.project.name, 'Two')
  await assert.rejects(
    () => saveProjectResource(root, 'p1', project(), { expectedRevision: created.revision }),
    (error) => error.code === 'REVISION_CONFLICT',
  )
  assert.deepEqual(
    (await listProjectResources(root)).map((entry) => entry.id),
    ['p1'],
  )
})

test('atomic pre-commit failure preserves live bytes and removes temp files', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const target = path.join(root, 'value.json')
  fs.writeFileSync(target, 'old')
  await assert.rejects(() =>
    atomicWriteFile(target, Buffer.from('new'), {
      beforeCommit: () => {
        throw new Error('interrupt')
      },
    }),
  )
  assert.equal(fs.readFileSync(target, 'utf8'), 'old')
  assert.deepEqual(fs.readdirSync(root), ['value.json'])
})

test('exclusive writer lock refuses a second writer', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const release = await acquireWriterLock(root)
  await assert.rejects(
    () => acquireWriterLock(root),
    (error) => error.code === 'WORKSPACE_LOCKED',
  )
  await assert.rejects(
    () => acquireWriterLock(root, { breakLock: true }),
    (error) => error.code === 'WORKSPACE_LOCKED',
  )
  await release()
  const releaseAgain = await acquireWriterLock(root)
  await releaseAgain()
})

test('writer lock automatically recovers an old lock with a confirmed-dead local PID', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const lockDir = path.join(root, '.freecut-headless')
  fs.mkdirSync(lockDir, { recursive: true })
  fs.writeFileSync(
    path.join(lockDir, 'writer.lock'),
    JSON.stringify({ pid: 2_147_483_647, token: 'stale', createdAt: 0 }),
  )
  const release = await acquireWriterLock(root, { staleGraceMs: 1 })
  await release()
})

test('media staging streams supported files and rejects traversal ids', async (t) => {
  const root = tempWorkspace()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'tiny.png')
  fs.writeFileSync(source, Buffer.from([1, 2, 3]))
  const staged = await stageLocalMedia(root, source, 'media_1')
  assert.deepEqual(fs.readFileSync(staged.target), Buffer.from([1, 2, 3]))
  await assert.rejects(
    () => stageLocalMedia(root, source, '../escape'),
    (error) => error.code === 'INVALID_ID',
  )
})
