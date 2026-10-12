// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { handlesMocks } from '../test-utils/storage-test-mocks'

import { createProject, getAllProjects, getProject } from './projects'
import {
  softDeleteProject,
  restoreProject,
  isProjectTrashed,
  listTrashedProjects,
  sweepTrashOlderThan,
} from './trash'
import { setWorkspaceRoot } from './root'
import { type MemDir, asHandle, createRoot, readFileText } from './__tests__/in-memory-handle'

/** Overwrite a file in the in-memory FS with arbitrary raw text. */
async function corruptFile(dir: MemDir, ...segments: string[]): Promise<void> {
  let current = dir
  for (let i = 0; i < segments.length - 1; i++) {
    current = await current.getDirectoryHandle(segments[i]!)
  }
  const filename = segments[segments.length - 1]!
  const fh = await current.getFileHandle(filename, { create: true })
  const writable = await fh.createWritable()
  await writable.write('{not json')
  await writable.close()
}

function makeProject(id: string, name = 'Test', updatedAt = 1000): Project {
  return {
    id,
    name,
    description: '',
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
    createdAt: updatedAt,
    updatedAt,
  } as Project
}

beforeEach(() => {
  handlesMocks.getHandle.mockResolvedValue(null)
  handlesMocks.deleteHandle.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('workspace-fs trash', () => {
  it('softDeleteProject writes the marker and removes from index', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Live'))

    const marker = await softDeleteProject('p1')

    expect(marker.originalName).toBe('Live')
    expect(typeof marker.deletedAt).toBe('number')

    const markerText = await readFileText(root, 'projects', 'p1', '.freecut-trashed.json')
    expect(markerText).not.toBeNull()

    // Trashed projects disappear from getAllProjects + getProject.
    expect(await getAllProjects()).toEqual([])
    expect(await getProject('p1')).toBeUndefined()

    // But still exist on disk for potential restore.
    const projectText = await readFileText(root, 'projects', 'p1', 'project.json')
    expect(projectText).not.toBeNull()
  })

  it('isProjectTrashed reflects marker state', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    expect(await isProjectTrashed('p1')).toBe(false)
    await softDeleteProject('p1')
    expect(await isProjectTrashed('p1')).toBe(true)
  })

  it('restoreProject removes the marker and brings it back to the index', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Live'))
    await softDeleteProject('p1')

    await restoreProject('p1')

    const markerText = await readFileText(root, 'projects', 'p1', '.freecut-trashed.json')
    expect(markerText).toBeNull()
    const all = await getAllProjects()
    expect(all.map((p) => p.id)).toEqual(['p1'])
  })

  it('softDeleteProject is idempotent on already-trashed projects', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Live'))

    const first = await softDeleteProject('p1')
    const second = await softDeleteProject('p1')

    // Same marker instance semantically (deletedAt preserved).
    expect(second.deletedAt).toBe(first.deletedAt)
  })

  it('restoreProject is a no-op for live projects', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await expect(restoreProject('p1')).resolves.toBeUndefined()
  })

  it('softDeleteProject throws for unknown projects', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await expect(softDeleteProject('missing')).rejects.toThrow(/not found/i)
  })

  it('listTrashedProjects returns most-recently-deleted first', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('a', 'Alpha'))
    await createProject(makeProject('b', 'Beta'))
    await createProject(makeProject('c', 'Gamma'))

    await softDeleteProject('a')
    // Small artificial gap so deletedAt differs.
    await new Promise((r) => setTimeout(r, 5))
    await softDeleteProject('c')

    const trashed = await listTrashedProjects()
    expect(trashed.map((t) => t.id)).toEqual(['c', 'a'])
    expect(trashed[0]!.marker.originalName).toBe('Gamma')
  })

  it('sweepTrashOlderThan invokes onPurge only for expired entries', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('old', 'Old'))
    await createProject(makeProject('new', 'New'))

    // Trash both. Mutate the marker timestamps to force "old" to be past TTL.
    await softDeleteProject('old')
    await softDeleteProject('new')

    const oldMarker = JSON.parse(
      (await readFileText(root, 'projects', 'old', '.freecut-trashed.json'))!,
    )
    oldMarker.deletedAt = Date.now() - 1_000_000
    // Rewrite via the writeJsonAtomic path so behavior matches production.
    const { writeJsonAtomic } = await import('./fs-primitives')
    await writeJsonAtomic(asHandle(root), ['projects', 'old', '.freecut-trashed.json'], oldMarker)

    const purged: string[] = []
    const result = await sweepTrashOlderThan(500_000, async (id) => {
      purged.push(id)
    })

    expect(result).toEqual(['old'])
    expect(purged).toEqual(['old'])
  })

  it('sweepTrashOlderThan continues past per-id failures', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('a'))
    await createProject(makeProject('b'))
    await softDeleteProject('a')
    await softDeleteProject('b')

    // Force both markers very old.
    const { writeJsonAtomic } = await import('./fs-primitives')
    for (const id of ['a', 'b']) {
      await writeJsonAtomic(asHandle(root), ['projects', id, '.freecut-trashed.json'], {
        deletedAt: 0,
        originalName: id,
      })
    }

    const calls: string[] = []
    const result = await sweepTrashOlderThan(1, async (id) => {
      calls.push(id)
      if (id === 'a') throw new Error('boom')
    })

    expect(calls.sort()).toEqual(['a', 'b'])
    expect(result).toEqual(['b']) // only b successfully purged
  })

  it('softDeleteProject succeeds with a corrupt sibling project.json', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Live'))
    await createProject(makeProject('p2', 'Corrupt'))
    await corruptFile(root, 'projects', 'p2', 'project.json')

    await softDeleteProject('p1')

    // index.json should contain neither p1 (trashed) nor p2 (corrupt, skipped).
    const indexText = await readFileText(root, 'index.json')
    const index = JSON.parse(indexText!)
    expect(index.projects.map((p: { id: string }) => p.id)).not.toContain('p1')
    expect(index.projects.map((p: { id: string }) => p.id)).not.toContain('p2')
  })

  it('restoreProject succeeds with a corrupt sibling project.json', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Live'))
    await createProject(makeProject('p2', 'Corrupt'))
    await softDeleteProject('p1')
    await corruptFile(root, 'projects', 'p2', 'project.json')

    await restoreProject('p1')

    const indexText = await readFileText(root, 'index.json')
    const index = JSON.parse(indexText!)
    const ids = index.projects.map((p: { id: string }) => p.id)
    expect(ids).toContain('p1')
    expect(ids).not.toContain('p2')
  })

  it('corrupt trash marker keeps project visible in the trash list', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Live'))
    await softDeleteProject('p1')
    await corruptFile(root, 'projects', 'p1', '.freecut-trashed.json')

    const trashed = await listTrashedProjects()
    expect(trashed).toHaveLength(1)
    expect(trashed[0]!.id).toBe('p1')
    expect(typeof trashed[0]!.marker.deletedAt).toBe('number')
    expect(trashed[0]!.marker.deletedAt).toBeGreaterThan(0)
  })

  it('corrupt trash marker does not trigger auto-purge on sweep', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Live'))
    await softDeleteProject('p1')
    await corruptFile(root, 'projects', 'p1', '.freecut-trashed.json')

    const onPurge = vi.fn()
    // Use a very large TTL cutoff — a Date.now()-based fallback should NOT be older than this.
    const result = await sweepTrashOlderThan(1000 * 60, onPurge)

    expect(onPurge).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })
})
