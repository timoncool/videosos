// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MediaMetadata } from '@/types/storage'

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  getMediaForProject: vi.fn(),
  getMediaFile: vi.fn(),
  mirrorOpfsMediaToWorkspace: vi.fn(async () => ({ mirrored: 0 })),
  prefetchThumbnails: vi.fn(async () => {}),
}))

const proxyStatusListenerRef = vi.hoisted(() => ({
  current: null as
    | ((
        mediaId: string,
        status: 'generating' | 'ready' | 'error' | 'idle',
        progress?: number,
      ) => void)
    | null,
}))

const enhancementServiceListeners = vi.hoisted(() => ({
  interpolationMedia: null as ((media: MediaMetadata, projectId: string) => void) | null,
  upscaleMedia: null as ((media: MediaMetadata, projectId: string) => void) | null,
}))

const frameInterpolationServiceMocks = vi.hoisted(() => ({
  cancelAll: vi.fn(),
  onStatusChange: vi.fn(),
  onMediaCreated: vi.fn((listener) => {
    enhancementServiceListeners.interpolationMedia = listener
  }),
}))

const upscaleServiceMocks = vi.hoisted(() => ({
  cancelAll: vi.fn(),
  onStatusChange: vi.fn(),
  onMediaCreated: vi.fn((listener) => {
    enhancementServiceListeners.upscaleMedia = listener
  }),
}))
const proxyServiceMocks = vi.hoisted(() => ({
  canGenerateProxy: vi.fn(),
  clearProxyKey: vi.fn(),
  hasProxy: vi.fn(),
  setProxyKey: vi.fn(),
  loadExistingProxies: vi.fn(),
  generateProxy: vi.fn(),
  onStatusChange: vi.fn((listener) => {
    proxyStatusListenerRef.current = listener
  }),
  setMediaResolver: vi.fn(),
  setFilmstripPrewarm: vi.fn(),
}))

const indexedDbMocks = vi.hoisted(() => ({
  getTranscriptMediaIds: vi.fn(),
}))

const loggerEventMocks = vi.hoisted(() => ({
  set: vi.fn(),
  merge: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}))

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  event: vi.fn(),
  startEvent: vi.fn(() => loggerEventMocks),
  child: vi.fn(),
  setLevel: vi.fn(),
}))

vi.mock('../services/media-library-service', () => ({
  mediaLibraryService: mediaLibraryServiceMocks,
}))

vi.mock('./media-library-service-access', () => ({
  loadMediaLibraryService: vi.fn(async () => ({
    mediaLibraryService: mediaLibraryServiceMocks,
  })),
}))

vi.mock('../services/proxy-service', () => ({
  proxyService: proxyServiceMocks,
}))

vi.mock('../services/frame-interpolation-service', () => ({
  frameInterpolationService: frameInterpolationServiceMocks,
}))

vi.mock('../services/upscale-service', () => ({
  upscaleService: upscaleServiceMocks,
}))
vi.mock('../services/background-media-work', async () => {
  const { createBackgroundMediaWorkMocks } =
    await import('../test-utils/background-media-work-test-mocks')
  return createBackgroundMediaWorkMocks(vi)
})

vi.mock('../utils/proxy-key', () => ({
  getSharedProxyKey: vi.fn((media: { id: string }) => `proxy-${media.id}`),
}))

vi.mock('@/infrastructure/storage', () => ({
  getTranscriptMediaIds: indexedDbMocks.getTranscriptMediaIds,
}))

vi.mock('./media-import-actions', () => ({
  createImportActions: vi.fn(() => ({})),
}))

vi.mock('./media-delete-actions', () => ({
  createDeleteActions: vi.fn(() => ({})),
}))

vi.mock('./media-relinking-actions', () => ({
  createRelinkingActions: vi.fn(() => ({})),
}))

vi.mock('@/shared/logging/logger', () => ({
  createOperationId: vi.fn(() => 'test-op-id'),
  createLogger: vi.fn(() => loggerMocks),
}))

import { useMediaLibraryStore } from './media-library-store'

function makeMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1',
    storageType: 'handle',
    fileName: 'clip.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 5,
    width: 3840,
    height: 2160,
    fps: 30,
    codec: 'h264',
    bitrate: 5000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function resetStore(): void {
  useMediaLibraryStore.setState({
    currentProjectId: null,
    mediaItems: [],
    mediaById: {},
    isLoading: false,
    importingIds: [],
    error: null,
    errorLink: null,
    notification: null,
    selectedMediaIds: [],
    selectedCompositionIds: [],
    searchQuery: '',
    filterByType: null,
    sortBy: 'date',
    viewMode: 'grid',
    mediaItemSize: 1,
    brokenMediaIds: [],
    brokenMediaInfo: new Map(),
    showMissingMediaDialog: false,
    orphanedClips: [],
    showOrphanedClipsDialog: false,
    unsupportedCodecFiles: [],
    showUnsupportedCodecDialog: false,
    unsupportedCodecResolver: null,
    proxyStatus: new Map(),
    proxyProgress: new Map(),
    transcriptStatus: new Map(),
    transcriptProgress: new Map(),
  })
}

describe('useMediaLibraryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  it('clears loading without fetching when no project is selected', async () => {
    useMediaLibraryStore.setState({ isLoading: true, currentProjectId: null })

    await useMediaLibraryStore.getState().loadMediaItems()

    expect(useMediaLibraryStore.getState().isLoading).toBe(false)
    expect(mediaLibraryServiceMocks.getMediaForProject).not.toHaveBeenCalled()
  })

  it('loads media, transcript availability, and stale proxies for the current project', async () => {
    const video = makeMedia({ id: 'video-1', fileName: 'video.mp4' })
    const audio = makeMedia({
      id: 'audio-1',
      fileName: 'audio.mp3',
      mimeType: 'audio/mpeg',
      width: 0,
      height: 0,
    })

    mediaLibraryServiceMocks.getMediaForProject.mockResolvedValue([video, audio])
    indexedDbMocks.getTranscriptMediaIds.mockResolvedValue(new Set(['video-1']))
    proxyServiceMocks.canGenerateProxy.mockImplementation((mimeType: string) =>
      mimeType.startsWith('video/'),
    )
    proxyServiceMocks.hasProxy.mockReturnValue(false)
    proxyServiceMocks.loadExistingProxies.mockResolvedValue(['video-1'])

    useMediaLibraryStore.setState({ currentProjectId: 'project-1' })

    await useMediaLibraryStore.getState().loadMediaItems()

    const state = useMediaLibraryStore.getState()
    expect(state.isLoading).toBe(false)
    expect(state.mediaItems).toEqual([video, audio])
    expect(state.mediaById['video-1']).toEqual(video)
    expect(state.mediaById['audio-1']).toEqual(audio)
    expect(state.transcriptStatus.get('video-1')).toBe('ready')
    expect(state.transcriptStatus.get('audio-1')).toBe('idle')
    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('video-1', 'proxy-video-1')
    expect(proxyServiceMocks.loadExistingProxies).toHaveBeenCalledWith(['video-1'])
  })

  it('falls back to idle transcript status when transcript lookup fails', async () => {
    const video = makeMedia({ id: 'video-1' })
    mediaLibraryServiceMocks.getMediaForProject.mockResolvedValue([video])
    indexedDbMocks.getTranscriptMediaIds.mockRejectedValue(new Error('boom'))
    proxyServiceMocks.canGenerateProxy.mockReturnValue(true)
    proxyServiceMocks.loadExistingProxies.mockResolvedValue([])

    useMediaLibraryStore.setState({ currentProjectId: 'project-1' })

    await useMediaLibraryStore.getState().loadMediaItems()

    const state = useMediaLibraryStore.getState()
    expect(state.transcriptStatus.get('video-1')).toBe('idle')
    expect(proxyServiceMocks.loadExistingProxies).toHaveBeenCalledWith(['video-1'])
    expect(proxyServiceMocks.generateProxy).not.toHaveBeenCalled()
  })

  it('clears proxy status and progress when proxy generation is cancelled', () => {
    useMediaLibraryStore.getState().setProxyStatus('media-1', 'generating')
    useMediaLibraryStore.getState().setProxyProgress('media-1', 0.5)

    proxyStatusListenerRef.current?.('media-1', 'idle')

    const state = useMediaLibraryStore.getState()
    expect(state.proxyStatus.has('media-1')).toBe(false)
    expect(state.proxyProgress.has('media-1')).toBe(false)
  })
  it('cancels enhancement jobs only when the project changes', () => {
    useMediaLibraryStore.setState({ currentProjectId: 'project-a' })

    useMediaLibraryStore.getState().setCurrentProject('project-b')

    expect(frameInterpolationServiceMocks.cancelAll).toHaveBeenCalledOnce()
    expect(upscaleServiceMocks.cancelAll).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    useMediaLibraryStore.getState().setCurrentProject('project-b')
    expect(frameInterpolationServiceMocks.cancelAll).not.toHaveBeenCalled()
    expect(upscaleServiceMocks.cancelAll).not.toHaveBeenCalled()
  })

  it('ignores enhancement results created for a previous project', () => {
    const interpolated = makeMedia({ id: 'interpolated' })
    const upscaled = makeMedia({ id: 'upscaled' })
    useMediaLibraryStore.setState({ currentProjectId: 'project-b', mediaItems: [] })

    enhancementServiceListeners.interpolationMedia?.(interpolated, 'project-a')
    enhancementServiceListeners.upscaleMedia?.(upscaled, 'project-a')
    expect(useMediaLibraryStore.getState().mediaItems).toEqual([])

    enhancementServiceListeners.interpolationMedia?.(interpolated, 'project-b')
    enhancementServiceListeners.upscaleMedia?.(upscaled, 'project-b')
    expect(useMediaLibraryStore.getState().mediaItems).toEqual([upscaled, interpolated])
  })
})
