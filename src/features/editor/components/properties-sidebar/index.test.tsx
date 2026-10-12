import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
} from '@/features/editor/deps/timeline-store'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import type { AudioItem, VideoItem } from '@/types/timeline'
import { PropertiesSidebar } from './index'

const panelModuleLoads = vi.hoisted(() => ({
  clip: vi.fn(),
}))

vi.mock('./canvas-panel', () => ({
  CanvasPanel: () => <div>Canvas Panel</div>,
}))

vi.mock('./clip-panel', () => ({
  ClipPanel: (() => {
    panelModuleLoads.clip()
    return () => <div>Clip Panel</div>
  })(),
}))

vi.mock('./marker-panel', () => ({
  MarkerPanel: () => <div>Marker Panel</div>,
}))

vi.mock('./transition-panel', () => ({
  TransitionPanel: () => <div>Transition Panel</div>,
}))

const CLIP_A: VideoItem = {
  id: 'clip-a',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'clip-a.mp4',
  src: 'blob:clip-a',
  mediaId: 'media-a',
}

const CLIP_B: VideoItem = {
  id: 'clip-b',
  type: 'video',
  trackId: 'track-1',
  from: 90,
  durationInFrames: 90,
  label: 'clip-b.mp4',
  src: 'blob:clip-b',
  mediaId: 'media-b',
}

const CLIP_A_AUDIO: AudioItem = {
  id: 'clip-a-audio',
  type: 'audio',
  trackId: 'track-2',
  from: 0,
  durationInFrames: 90,
  label: 'clip-a.wav',
  src: 'blob:clip-a-audio',
  mediaId: 'media-a',
  linkedGroupId: 'linked-a',
}

const CLIP_A_VIDEO_LINKED: VideoItem = {
  ...CLIP_A,
  linkedGroupId: 'linked-a',
}

function resetStores(items: Array<VideoItem | AudioItem>, selectedItemIds: string[]) {
  useEditorStore.setState({
    rightSidebarOpen: true,
    rightSidebarWidth: 320,
  })

  useSelectionStore.setState({
    selectedItemIds,
    selectedMarkerId: null,
    selectedTransitionId: null,
    selectedTrackId: null,
    selectedTrackIds: [],
    activeTrackId: null,
    selectionType: selectedItemIds.length > 0 ? 'item' : null,
    dragState: null,
  })

  useItemsStore.getState().setItems(items)
  useCompositionNavigationStore.setState({ activeCompositionId: null })
  useCompositionsStore.getState().setCompositions([])
}

describe('PropertiesSidebar', () => {
  beforeEach(() => {
    resetStores([CLIP_A], [CLIP_A.id])
  })

  it('mounts the clip inspector before the first clip selection', async () => {
    resetStores([CLIP_A], [])

    render(<PropertiesSidebar />)

    await waitFor(() => {
      expect(panelModuleLoads.clip).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText('Canvas Panel')).toBeInTheDocument()
  })

  it('identifies the active composition when Motion has no layer selection', () => {
    resetStores([], [])
    useEditorStore.setState({ workspace: 'motion' })
    useCompositionsStore.getState().setCompositions([
      {
        id: 'motion-card',
        name: 'Motion Card',
        editorKind: 'composite-2d',
        items: [],
        tracks: [],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1080,
        height: 1920,
        durationInFrames: 300,
      },
    ])
    useCompositionNavigationStore.setState({ activeCompositionId: 'motion-card' })

    render(<PropertiesSidebar />)

    expect(screen.getByRole('heading', { name: 'Composition-Motion Card' })).toBeInTheDocument()
    expect(screen.getByText('Canvas Panel')).toBeInTheDocument()
  })

  it('shows the selected clip filename in the header', async () => {
    render(<PropertiesSidebar />)

    expect(screen.getByText('clip-a.mp4')).toBeInTheDocument()
    expect(await screen.findByText('Clip Panel')).toBeInTheDocument()
  })

  it('gives the Motion clip inspector a resolved height for its inner scroller', async () => {
    useEditorStore.setState({ workspace: 'motion', clipInspectorTab: 'motion' })

    render(<PropertiesSidebar />)

    expect(await screen.findByText('Clip Panel')).toBeInTheDocument()
    expect(screen.getByTestId('properties-clip-panel-host')).toHaveClass('h-full', 'min-h-0')
  })

  it('shows the first filename with a multi-select summary in the header', () => {
    resetStores([CLIP_A, CLIP_B], [CLIP_A.id, CLIP_B.id])

    render(<PropertiesSidebar />)

    expect(screen.getByText('2 clips selected')).toBeInTheDocument()
    expect(screen.getByTitle('clip-a.mp4, clip-b.mp4')).toBeInTheDocument()
  })

  it('treats a linked audio-video pair as one clip in the header', () => {
    resetStores([CLIP_A_VIDEO_LINKED, CLIP_A_AUDIO], [CLIP_A_VIDEO_LINKED.id, CLIP_A_AUDIO.id])

    render(<PropertiesSidebar />)

    expect(screen.getByText('clip-a.mp4')).toBeInTheDocument()
    expect(screen.queryByText('2 clips selected')).not.toBeInTheDocument()
    expect(screen.getByTitle('clip-a.mp4, clip-a.wav')).toBeInTheDocument()
  })

  it('hides the clip header when a transition selection takes priority', async () => {
    resetStores([CLIP_A], [CLIP_A.id])
    useSelectionStore.setState({
      selectedTransitionId: 'transition-1',
      selectionType: 'transition',
    })

    render(<PropertiesSidebar />)

    expect(await screen.findByText('Transition Panel')).toBeInTheDocument()
    expect(screen.queryByText('clip-a.mp4')).not.toBeInTheDocument()
  })

  it('hides the clip header when a marker selection takes priority', async () => {
    resetStores([CLIP_A], [CLIP_A.id])
    useSelectionStore.setState({
      selectedMarkerId: 'marker-1',
      selectionType: 'marker',
    })

    render(<PropertiesSidebar />)

    expect(await screen.findByText('Marker Panel')).toBeInTheDocument()
    expect(screen.queryByText('clip-a.mp4')).not.toBeInTheDocument()
  })
})
