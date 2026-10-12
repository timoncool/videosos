// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useCompositionsStore } from '../compositions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { resetTimelineCompositionTestState } from '../../test-helpers'
import { setCompositionCanvasSettings } from './composition-settings-actions'

const COMP_ID = 'motion-comp'

function addComposition() {
  useCompositionsStore.getState().setCompositions([
    {
      id: COMP_ID,
      name: 'Motion title',
      editorKind: 'composite-2d',
      tracks: [],
      items: [],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 300,
      backgroundColor: '#000000',
    },
  ])
}

describe('setCompositionCanvasSettings', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useTimelineCommandStore.getState().clearHistory()
    addComposition()
  })

  it('updates the composition canvas as one undoable action', () => {
    setCompositionCanvasSettings(COMP_ID, {
      width: 1080,
      height: 1920,
      backgroundColor: '#112233',
    })

    expect(useCompositionsStore.getState().getComposition(COMP_ID)).toMatchObject({
      width: 1080,
      height: 1920,
      backgroundColor: '#112233',
    })

    useTimelineCommandStore.getState().undo()

    expect(useCompositionsStore.getState().getComposition(COMP_ID)).toMatchObject({
      width: 1920,
      height: 1080,
      backgroundColor: '#000000',
    })
  })

  it('clamps dimensions and ignores non-finite values', () => {
    setCompositionCanvasSettings(COMP_ID, {
      width: 9000,
      height: -12,
    })
    expect(useCompositionsStore.getState().getComposition(COMP_ID)).toMatchObject({
      width: 7680,
      height: 1,
    })

    setCompositionCanvasSettings(COMP_ID, {
      width: Number.NaN,
      height: Number.POSITIVE_INFINITY,
    })
    expect(useCompositionsStore.getState().getComposition(COMP_ID)).toMatchObject({
      width: 7680,
      height: 1,
    })
  })

  it('does not update sequence-style compositions', () => {
    useCompositionsStore.getState().updateComposition(COMP_ID, { editorKind: 'sequence' })

    setCompositionCanvasSettings(COMP_ID, { width: 720 })

    expect(useCompositionsStore.getState().getComposition(COMP_ID)?.width).toBe(1920)
  })
})
