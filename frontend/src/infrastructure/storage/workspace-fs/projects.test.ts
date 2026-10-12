// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { handlesMocks } from '../test-utils/storage-test-mocks'

// Passthrough spies so individual tests can fail a single index.json read or
// write, simulating a workspace we can't write to (or can't read at all).
vi.mock('./workspace-index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workspace-index')>()
  return {
    ...actual,
    readWorkspaceIndex: vi.fn(actual.readWorkspaceIndex),
    writeWorkspaceIndex: vi.fn(actual.writeWorkspaceIndex),
  }
})

import {
  createProject,
  deleteProject,
  getAllProjects,
  getDBStats,
  getProject,
  updateProject,
} from './projects'
import { setWorkspaceRoot } from './root'
import { readWorkspaceIndex, writeWorkspaceIndex } from './workspace-index'
import { asHandle, createRoot, readFileText, MemDir } from './__tests__/in-memory-handle'

/** Make the next single index.json write fail, as an unwritable workspace would. */
function failNextIndexWrite(): void {
  vi.mocked(writeWorkspaceIndex).mockRejectedValueOnce(
    new DOMException(
      'The implementation did not support the requested operation.',
      'NotSupportedError',
    ),
  )
}

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
  handlesMocks.saveHandle.mockClear()
  handlesMocks.deleteHandle.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  setWorkspaceRoot(null)
})

describe('workspace-fs projects', () => {
  it('createProject writes project.json and updates index.json', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const project = makeProject('p1', 'Hello')

    await createProject(project)

    const projectText = await readFileText(root, 'projects', 'p1', 'project.json')
    expect(projectText).not.toBeNull()
    const parsed = JSON.parse(projectText!)
    expect(parsed.id).toBe('p1')
    expect(parsed.name).toBe('Hello')

    const indexText = await readFileText(root, 'index.json')
    expect(indexText).not.toBeNull()
    const index = JSON.parse(indexText!)
    expect(index.projects.map((p: { id: string }) => p.id)).toEqual(['p1'])
  })

  it('createProject rejects duplicate ids', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    await expect(createProject(makeProject('p1'))).rejects.toThrow(/already exists/)
  })

  it('getAllProjects returns projects ordered by index (updatedAt desc)', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('old', 'Old', 1000))
    await createProject(makeProject('new', 'New', 5000))

    const all = await getAllProjects()
    expect(all.map((p) => p.id)).toEqual(['new', 'old'])
  })

  it('getProject returns undefined when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    expect(await getProject('missing')).toBeUndefined()
  })

  it('updateProject merges and bumps updatedAt', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Original', 1000))

    const before = await getProject('p1')
    const beforeTs = before!.updatedAt
    // ensure a later clock tick
    await new Promise((resolve) => setTimeout(resolve, 2))

    const updated = await updateProject('p1', { name: 'Renamed' })
    expect(updated.name).toBe('Renamed')
    expect(updated.updatedAt).toBeGreaterThan(beforeTs)

    const reloaded = await getProject('p1')
    expect(reloaded!.name).toBe('Renamed')
  })

  it('updateProject does not touch the handle registry when the patch omits rootFolderHandle', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Original', 1000))
    handlesMocks.saveHandle.mockClear()
    handlesMocks.deleteHandle.mockClear()

    await updateProject('p1', { name: 'Renamed' })

    // A patch that doesn't change the folder handle must avoid the per-save
    // IndexedDB write/delete on the handle registry.
    expect(handlesMocks.saveHandle).not.toHaveBeenCalled()
    expect(handlesMocks.deleteHandle).not.toHaveBeenCalled()
  })

  it('updateProject preserves fields absent from the patch (partial merge)', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject({ ...makeProject('p1', 'Original', 1000), description: 'keep me' })

    await updateProject('p1', { name: 'Renamed' })

    const reloaded = await getProject('p1')
    expect(reloaded!.name).toBe('Renamed')
    expect(reloaded!.description).toBe('keep me')
  })

  it('updateProject throws when missing', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await expect(updateProject('nope', { name: 'x' })).rejects.toThrow(/not found/)
  })

  it('deleteProject removes folder and index entry', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))
    expect(await readFileText(root, 'projects', 'p1', 'project.json')).not.toBeNull()

    await deleteProject('p1')
    expect(await readFileText(root, 'projects', 'p1', 'project.json')).toBeNull()

    const indexText = await readFileText(root, 'index.json')
    const index = JSON.parse(indexText!)
    expect(index.projects).toEqual([])
  })

  it('deleteProject is safe on non-existent id', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await expect(deleteProject('missing')).resolves.toBeUndefined()
  })

  it('throws when no workspace root is set', async () => {
    setWorkspaceRoot(null)
    await expect(getAllProjects()).rejects.toThrow(/Workspace root is not set/)
  })

  it('strips rootFolderHandle on write and registers it in handles-db', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const fakeHandle = { name: 'SomeFolder' } as FileSystemDirectoryHandle
    const project = {
      ...makeProject('p1'),
      rootFolderHandle: fakeHandle,
      rootFolderName: 'SomeFolder',
    } as Project

    await createProject(project)

    const projectText = await readFileText(root, 'projects', 'p1', 'project.json')
    const parsed = JSON.parse(projectText!)
    expect(parsed.rootFolderHandle).toBeUndefined() // stripped
    expect(parsed.rootFolderName).toBe('SomeFolder') // metadata kept

    expect(handlesMocks.saveHandle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'project-folder', id: 'p1', handle: fakeHandle }),
    )
  })

  it('restores rootFolderHandle from handles-db on read', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))

    const fakeHandle = { name: 'RestoredFolder' } as FileSystemDirectoryHandle
    handlesMocks.getHandle.mockImplementation(async (kind: string, id: string) =>
      kind === 'project-folder' && id === 'p1'
        ? {
            kind,
            id,
            handle: fakeHandle,
            name: 'RestoredFolder',
            key: `${kind}:${id}`,
            pickedAt: 0,
          }
        : null,
    )

    const loaded = await getProject('p1')
    expect(loaded!.rootFolderHandle).toBe(fakeHandle)
  })

  it('getDBStats returns project count from the index', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('a'))
    await createProject(makeProject('b'))
    const stats = await getDBStats()
    expect(stats.projectCount).toBe(2)
  })

  it('corrupt project.json is skipped by getAllProjects', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Good'))
    await createProject(makeProject('p2', 'WillCorrupt'))

    // Corrupt p2's project.json
    await corruptFile(root, 'projects', 'p2', 'project.json')

    const projects = await getAllProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]!.id).toBe('p1')
  })

  it('corrupt project.json does not break other projects CRUD', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Good'))
    await createProject(makeProject('p2', 'WillCorrupt'))

    // Corrupt p2's project.json
    await corruptFile(root, 'projects', 'p2', 'project.json')

    // Creating another project should succeed despite p2 being corrupt
    await createProject(makeProject('p3', 'New'))

    const indexText = await readFileText(root, 'index.json')
    const index = JSON.parse(indexText!)
    const ids: string[] = index.projects.map((p: { id: string }) => p.id)
    expect(ids).toContain('p1')
    expect(ids).toContain('p3')

    // The durable guarantee: a corrupt project.json never surfaces to consumers,
    // regardless of whether a transient index entry lingers (the incremental
    // index upsert no longer rescans every project on each write). It self-heals
    // on the next full rebuild.
    const loaded = await getAllProjects()
    const loadedIds = loaded.map((p) => p.id)
    expect(loadedIds).toContain('p1')
    expect(loadedIds).toContain('p3')
    expect(loadedIds).not.toContain('p2')
  })

  it('corrupt index.json self-heals: getAllProjects returns healthy projects', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1', 'Healthy'))

    // Corrupt index.json
    await corruptFile(root, 'index.json')

    const projects = await getAllProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]!.id).toBe('p1')

    // index.json should now be valid JSON again
    const indexText = await readFileText(root, 'index.json')
    expect(() => JSON.parse(indexText!)).not.toThrow()
  })

  // Regression: a workspace that can be read but not written (read-only mount,
  // or a browser whose FileSystemFileHandle.move() rejects) used to fail the
  // whole load — the rebuild's write threw straight out of getAllProjects as
  // "Failed to load projects from workspace". index.json is a derived cache;
  // projects/ on disk is the source of truth.
  it('getAllProjects still lists projects when index.json cannot be persisted', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('old', 'Old', 1000))
    await createProject(makeProject('new', 'New', 5000))
    // Force the rebuild path: an empty/corrupt index triggers a directory scan.
    await corruptFile(root, 'index.json')

    failNextIndexWrite()

    // Entries come from the scan, not a re-read of the file we failed to write,
    // so they must still arrive newest-first.
    const all = await getAllProjects()
    expect(all.map((p) => p.id)).toEqual(['new', 'old'])
  })

  // getAllProjects rejects a route beforeLoad, so its error is all the user and
  // any bug report ever see. Without `cause` the underlying DOMException name —
  // NotAllowedError vs NotSupportedError vs NotFoundError, i.e. the entire
  // diagnosis — is unrecoverable.
  it('getAllProjects preserves the underlying error as `cause`', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    const underlying = new DOMException('permission revoked', 'NotAllowedError')
    vi.mocked(readWorkspaceIndex).mockRejectedValueOnce(underlying)

    const caught = await getAllProjects().catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('Failed to load projects from workspace')
    expect((caught as Error).cause).toBe(underlying)
    expect(((caught as Error).cause as DOMException).name).toBe('NotAllowedError')
  })

  // The mirror of the above: for a caller that mutates state, a workspace that
  // won't accept writes is a real fault and must not be swallowed.
  it('deleteProject surfaces a failed index write', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p1'))

    failNextIndexWrite()

    await expect(deleteProject('p1')).rejects.toThrow(/Failed to delete project/)
  })

  it('getProject on a corrupt project still throws', async () => {
    const root = createRoot()
    setWorkspaceRoot(asHandle(root))
    await createProject(makeProject('p2', 'WillCorrupt'))

    // Corrupt p2's project.json
    await corruptFile(root, 'projects', 'p2', 'project.json')

    await expect(getProject('p2')).rejects.toThrow(/Failed to load project/)
  })
})
