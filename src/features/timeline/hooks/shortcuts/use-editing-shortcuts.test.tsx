import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { HOTKEYS } from '@/config/hotkeys'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '../../stores/items-store'
import { setTimelineState } from '../../test-helpers'
import { useTimelineCommandStore } from '../../stores/timeline-command-store'
import { useKeyframeSelectionStore } from '../../stores/keyframe-selection-store'
import { useEditingShortcuts } from './use-editing-shortcuts'
import type { TimelineTrack, VideoItem } from '@/types/timeline'

const { useHotkeysMock } = vi.hoisted(() => ({
  useHotkeysMock: vi.fn(),
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: useHotkeysMock,
}))

function ShortcutHarness() {
  useEditingShortcuts({})
  return null
}

type HotkeyEvent = {
  preventDefault: () => void
  stopPropagation: () => void
}

type HotkeyCallback = (event: HotkeyEvent) => void

const TRACK: TimelineTrack = {
  id: 'track-1',
  name: 'V1',
  kind: 'video',
  order: 0,
  height: 80,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  items: [],
}

const TRACK_2: TimelineTrack = {
  id: 'track-2',
  name: 'V2',
  kind: 'video',
  order: 1,
  height: 80,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  items: [],
}

const ITEM: VideoItem = {
  id: 'clip-1',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 30,
  label: 'Clip 1',
  src: 'clip.mp4',
}

function getHotkeyRegistration(binding: string) {
  const registration = useHotkeysMock.mock.calls.find(([keys]) => keys === binding)

  expect(registration).toBeDefined()
  return registration as [string, HotkeyCallback, { enabled?: boolean }]
}

function createHotkeyEvent(): HotkeyEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }
}

describe('useEditingShortcuts delete ownership', () => {
  beforeEach(() => {
    useHotkeysMock.mockClear()
    useTimelineCommandStore.getState().clearHistory()
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedMarkerId: null,
      selectedTransitionId: null,
      selectionType: null,
      editKeyframePanelOpen: false,
      expandedKeyframeLanes: new Set(),
    })
    useKeyframeSelectionStore.setState({
      selectedKeyframes: [],
      clipboard: null,
      isCut: false,
    })
    useEditorStore.setState({
      keyframeEditorShortcutScopeActive: false,
      transcriptEditorShortcutScopeActive: false,
    })
    usePlaybackStore.setState({
      currentFrame: 0,
      previewFrame: null,
      previewItemId: null,
    })
    setTimelineState({
      tracks: [TRACK],
      items: [ITEM],
      transitions: [],
      keyframes: [],
      markers: [],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('disables clip delete shortcuts while the keyframe editor owns a keyframe selection', () => {
    useSelectionStore.setState({
      selectedItemIds: ['clip-1'],
      selectionType: 'item',
      editKeyframePanelOpen: true,
      expandedKeyframeLanes: new Set(['clip-1']),
    })
    useKeyframeSelectionStore.setState({
      selectedKeyframes: [{ itemId: 'clip-1', property: 'x', keyframeId: 'kf-1' }],
    })
    useEditorStore.setState({ keyframeEditorShortcutScopeActive: false })

    render(<ShortcutHarness />)

    const [, deleteCallback, deleteOptions] = getHotkeyRegistration(HOTKEYS.DELETE_SELECTED)
    const [, backspaceCallback, backspaceOptions] = getHotkeyRegistration(
      HOTKEYS.DELETE_SELECTED_ALT,
    )
    const [, rippleDeleteCallback, rippleDeleteOptions] = getHotkeyRegistration(
      HOTKEYS.RIPPLE_DELETE,
    )

    expect(deleteOptions.enabled).not.toBe(false)
    expect(backspaceOptions.enabled).not.toBe(false)
    expect(rippleDeleteOptions.enabled).not.toBe(false)

    const deleteEvent = createHotkeyEvent()
    const backspaceEvent = createHotkeyEvent()
    const rippleDeleteEvent = createHotkeyEvent()

    act(() => {
      deleteCallback(deleteEvent)
      backspaceCallback(backspaceEvent)
      rippleDeleteCallback(rippleDeleteEvent)
    })

    expect(useItemsStore.getState().items).toHaveLength(1)
    expect(deleteEvent.preventDefault).toHaveBeenCalled()
    expect(deleteEvent.stopPropagation).toHaveBeenCalled()
    expect(backspaceEvent.preventDefault).toHaveBeenCalled()
    expect(backspaceEvent.stopPropagation).toHaveBeenCalled()
    expect(rippleDeleteEvent.preventDefault).toHaveBeenCalled()
    expect(rippleDeleteEvent.stopPropagation).toHaveBeenCalled()
  })

  it('disables clip delete shortcuts while the pointer or focus is inside the keyframe editor', () => {
    useSelectionStore.setState({
      selectedItemIds: ['clip-1'],
      selectionType: 'item',
      editKeyframePanelOpen: false,
    })
    useEditorStore.setState({
      keyframeEditorShortcutScopeActive: true,
    })

    render(<ShortcutHarness />)

    const [, deleteCallback, deleteOptions] = getHotkeyRegistration(HOTKEYS.DELETE_SELECTED)
    const [, backspaceCallback, backspaceOptions] = getHotkeyRegistration(
      HOTKEYS.DELETE_SELECTED_ALT,
    )

    expect(deleteOptions.enabled).not.toBe(false)
    expect(backspaceOptions.enabled).not.toBe(false)

    const deleteEvent = createHotkeyEvent()
    const backspaceEvent = createHotkeyEvent()

    act(() => {
      deleteCallback(deleteEvent)
      backspaceCallback(backspaceEvent)
    })

    expect(useItemsStore.getState().items).toHaveLength(1)
    expect(deleteEvent.preventDefault).toHaveBeenCalled()
    expect(deleteEvent.stopPropagation).toHaveBeenCalled()
    expect(backspaceEvent.preventDefault).toHaveBeenCalled()
    expect(backspaceEvent.stopPropagation).toHaveBeenCalled()
  })

  it('disables clip delete shortcuts while the transcript editor owns delete', () => {
    useSelectionStore.setState({
      selectedItemIds: ['clip-1'],
      selectionType: 'item',
      editKeyframePanelOpen: false,
      expandedKeyframeLanes: new Set(),
    })
    useEditorStore.setState({
      transcriptEditorShortcutScopeActive: true,
    })

    render(<ShortcutHarness />)

    const [, deleteCallback] = getHotkeyRegistration(HOTKEYS.DELETE_SELECTED)
    const [, backspaceCallback] = getHotkeyRegistration(HOTKEYS.DELETE_SELECTED_ALT)
    const [, rippleDeleteCallback] = getHotkeyRegistration(HOTKEYS.RIPPLE_DELETE)

    const deleteEvent = createHotkeyEvent()
    const backspaceEvent = createHotkeyEvent()
    const rippleDeleteEvent = createHotkeyEvent()

    act(() => {
      deleteCallback(deleteEvent)
      backspaceCallback(backspaceEvent)
      rippleDeleteCallback(rippleDeleteEvent)
    })

    expect(useItemsStore.getState().items).toHaveLength(1)
    expect(deleteEvent.preventDefault).toHaveBeenCalled()
    expect(deleteEvent.stopPropagation).toHaveBeenCalled()
    expect(backspaceEvent.preventDefault).toHaveBeenCalled()
    expect(backspaceEvent.stopPropagation).toHaveBeenCalled()
    expect(rippleDeleteEvent.preventDefault).toHaveBeenCalled()
    expect(rippleDeleteEvent.stopPropagation).toHaveBeenCalled()
  })

  it('keeps clip delete shortcuts active when the keyframe editor is closed', () => {
    useSelectionStore.setState({
      selectedItemIds: ['clip-1'],
      selectionType: 'item',
    })
    useKeyframeSelectionStore.setState({
      selectedKeyframes: [{ itemId: 'clip-1', property: 'x', keyframeId: 'kf-1' }],
    })
    useEditorStore.setState({
      keyframeEditorShortcutScopeActive: false,
    })

    render(<ShortcutHarness />)

    const [, deleteCallback, deleteOptions] = getHotkeyRegistration(HOTKEYS.DELETE_SELECTED)
    expect(deleteOptions.enabled).not.toBe(false)

    const deleteEvent = createHotkeyEvent()
    act(() => {
      deleteCallback(deleteEvent)
    })

    expect(useItemsStore.getState().items).toHaveLength(0)
    expect(deleteEvent.preventDefault).toHaveBeenCalled()
    expect(deleteEvent.stopPropagation).not.toHaveBeenCalled()
  })

  it('registers Alt+C as the split-at-playhead shortcut and undoes in one step', () => {
    const clip1 = {
      ...ITEM,
      from: 20,
      durationInFrames: 40,
    }
    const clip2 = {
      ...ITEM,
      id: 'clip-2',
      trackId: 'track-2',
      from: 40,
      durationInFrames: 30,
    }

    setTimelineState({
      tracks: [TRACK, TRACK_2],
      items: [clip1, clip2],
    })
    usePlaybackStore.setState({
      currentFrame: 50,
      previewFrame: null,
      previewItemId: null,
    })

    render(<ShortcutHarness />)

    const [, splitCallback] = getHotkeyRegistration(HOTKEYS.SPLIT_AT_PLAYHEAD_ALT)
    const splitEvent = createHotkeyEvent()

    act(() => {
      splitCallback(splitEvent)
    })

    const items = useItemsStore.getState().items.toSorted((left, right) => left.from - right.from)
    expect(items).toHaveLength(4)
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'clip-1', from: 20, durationInFrames: 30 })
    expect(items[1]).toMatchObject({ id: 'clip-2', from: 40, durationInFrames: 10 })
    expect(items[2]).toMatchObject({ from: 50, durationInFrames: 10 })
    expect(items[3]).toMatchObject({ from: 50, durationInFrames: 20 })
    expect(splitEvent.preventDefault).toHaveBeenCalled()

    act(() => {
      useTimelineCommandStore.getState().undo()
    })

    expect(useItemsStore.getState().items).toEqual([clip1, clip2])
  })
})
