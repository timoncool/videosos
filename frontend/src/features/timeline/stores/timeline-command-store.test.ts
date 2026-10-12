// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

// Undo/redo history is restored into the domain stores, and restoring project
// metadata writes it back through storage — mock the storage write only.
const indexedDbMocks = vi.hoisted(() => ({
  updateProject: vi.fn(),
}))

vi.mock('@/infrastructure/storage', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    ...indexedDbMocks,
  }
})

import { useProjectStore } from '@/features/timeline/deps/projects'
import { resetTimelineCompositionTestState, setTimelineState } from '../test-helpers'
import { useItemsStore } from './items-store'
import { useTimelineCommandStore } from './timeline-command-store'
import { captureSnapshot } from './commands/snapshot'
import { rateStretchItemWithoutHistory } from './actions/item-edit-actions'
import { updateItem } from './actions/item-actions'

describe('timeline-command-store undo/redo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetTimelineCompositionTestState()
  })

  it('undos and redos an item update', () => {
    setTimelineState({
      tracks: [
        {
          id: 'track-a1',
          name: 'A1',
          kind: 'audio',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
      ],
      items: [
        {
          id: 'audio-1',
          type: 'audio',
          trackId: 'track-a1',
          from: 0,
          durationInFrames: 90,
          label: 'voiceover.wav',
          src: 'blob:audio',
          mediaId: 'media-a1',
          volume: 0,
        },
      ],
    })

    updateItem('audio-1', { volume: -9.5 })
    expect(useItemsStore.getState().itemById['audio-1']?.volume).toBe(-9.5)

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().itemById['audio-1']?.volume).toBe(0)

    useTimelineCommandStore.getState().redo()
    expect(useItemsStore.getState().itemById['audio-1']?.volume).toBe(-9.5)
  })

  it('undos and redos current project metadata changes through the shared history', async () => {
    useProjectStore.setState({
      projects: [
        {
          id: 'project-1',
          name: 'Test Project',
          description: '',
          createdAt: 1,
          updatedAt: 1,
          duration: 0,
          metadata: {
            width: 1920,
            height: 1080,
            fps: 30,
            backgroundColor: '#000000',
          },
        },
      ],
      currentProject: {
        id: 'project-1',
        name: 'Test Project',
        description: '',
        createdAt: 1,
        updatedAt: 1,
        duration: 0,
        metadata: {
          width: 1920,
          height: 1080,
          fps: 30,
          backgroundColor: '#000000',
        },
      },
    })

    const beforeSnapshot = captureSnapshot()
    useProjectStore.setState((state) => ({
      currentProject: state.currentProject
        ? {
            ...state.currentProject,
            metadata: {
              ...state.currentProject.metadata,
              width: 1280,
              height: 720,
            },
          }
        : null,
      projects: state.projects.map((project) =>
        project.id === 'project-1'
          ? {
              ...project,
              metadata: {
                ...project.metadata,
                width: 1280,
                height: 720,
              },
            }
          : project,
      ),
    }))
    useTimelineCommandStore
      .getState()
      .addUndoEntry(
        { type: 'UPDATE_PROJECT_METADATA', payload: { fields: ['width', 'height'] } },
        beforeSnapshot,
      )

    expect(useProjectStore.getState().currentProject?.metadata).toMatchObject({
      width: 1280,
      height: 720,
    })

    useTimelineCommandStore.getState().undo()
    expect(useProjectStore.getState().currentProject?.metadata).toMatchObject({
      width: 1920,
      height: 1080,
    })

    useTimelineCommandStore.getState().redo()
    expect(useProjectStore.getState().currentProject?.metadata).toMatchObject({
      width: 1280,
      height: 720,
    })

    await Promise.resolve()
    expect(indexedDbMocks.updateProject).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          width: 1280,
          height: 720,
        }),
      }),
    )
  })

  it('collapses multiple rate-stretch preview steps into one undo entry when committed once', () => {
    useItemsStore.getState().setTracks([
      {
        id: 'track-v1',
        name: 'V1',
        kind: 'video',
        height: 80,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ])
    useItemsStore.getState().setItems([
      {
        id: 'video-1',
        type: 'video',
        trackId: 'track-v1',
        from: 0,
        durationInFrames: 120,
        label: 'clip.mp4',
        src: 'blob:video',
        mediaId: 'media-v1',
        sourceStart: 0,
        sourceEnd: 120,
        sourceDuration: 120,
        sourceFps: 30,
        speed: 1,
      },
    ])

    const beforeSnapshot = captureSnapshot()

    rateStretchItemWithoutHistory('video-1', 0, 96, 1.25)
    rateStretchItemWithoutHistory('video-1', 0, 80, 1.5)
    useTimelineCommandStore
      .getState()
      .addUndoEntry(
        { type: 'RATE_STRETCH_ITEM', payload: { ids: ['video-1'], newSpeed: 1.5 } },
        beforeSnapshot,
      )

    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(useItemsStore.getState().itemById['video-1']).toMatchObject({
      durationInFrames: 80,
      speed: 1.5,
    })

    useTimelineCommandStore.getState().undo()

    expect(useItemsStore.getState().itemById['video-1']).toMatchObject({
      durationInFrames: 120,
      speed: 1,
    })
  })
})
