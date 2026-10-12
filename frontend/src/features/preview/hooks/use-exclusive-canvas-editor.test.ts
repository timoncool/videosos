// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { hasExclusiveCanvasEditor } from './use-exclusive-canvas-editor'

describe('hasExclusiveCanvasEditor', () => {
  it.each(['cornerPin', 'mask', 'powerWindow', 'spatialEffect'] as const)(
    'treats %s editing as exclusive',
    (editor) => {
      expect(
        hasExclusiveCanvasEditor({
          cornerPin: editor === 'cornerPin',
          mask: editor === 'mask',
          powerWindow: editor === 'powerWindow',
          spatialEffect: editor === 'spatialEffect',
        }),
      ).toBe(true)
    },
  )

  it('allows normal canvas input only when no editor is active', () => {
    expect(
      hasExclusiveCanvasEditor({
        cornerPin: false,
        mask: false,
        powerWindow: false,
        spatialEffect: false,
      }),
    ).toBe(false)
  })
})
