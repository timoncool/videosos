// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'

import type { VideoItem } from '@/types/timeline'
import { useItemsStore } from '../items-store'
import { useTransitionsStore } from '../transitions-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { updateItem } from './item-actions'
import { asOneStep } from './step-actions'

function clip(id: string): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: `${id}.mp4`,
    src: 'blob:test',
    mediaId: 'media-1',
    sourceStart: 0,
    sourceEnd: 30,
    sourceDuration: 120,
  }
}

describe('asOneStep', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore.getState().setTracks([])
    useItemsStore.getState().setItems([clip('video'), clip('sound')])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
  })

  it('makes the edits inside it one step that undo takes back together', () => {
    asOneStep('REPLACE_MEDIA', () => {
      updateItem('video', { mediaId: 'media-2' })
      updateItem('sound', { mediaId: 'media-2' })
    })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(1)

    useTimelineCommandStore.getState().undo()
    const media = useItemsStore.getState().items.map((item) => item.mediaId)
    expect(media).toEqual(['media-1', 'media-1'])
  })

  it('keeps each edit outside it a step of its own', () => {
    updateItem('video', { mediaId: 'media-2' })
    updateItem('sound', { mediaId: 'media-2' })
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(2)
  })
})
