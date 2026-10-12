// @vitest-environment node

import { describe, it, expect } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { SmartTrimIntent, SmartBodyIntent } from '../../utils/smart-trim-zones'
import { getClipCursorClass, type ClipCursorInput } from './clip-cursor'

function input(overrides: Partial<ClipCursorInput> = {}): ClipCursorInput {
  return {
    trackLocked: false,
    activeTool: 'select',
    smartTrimIntent: null,
    smartBodyIntent: null,
    hoveredEdge: null,
    itemType: 'video',
    isBeingDragged: false,
    ...overrides,
  }
}

describe('getClipCursorClass', () => {
  it('locked track wins over everything', () => {
    expect(getClipCursorClass(input({ trackLocked: true, activeTool: 'razor' }))).toBe(
      'cursor-not-allowed opacity-60',
    )
  })

  it('razor tool', () => {
    expect(getClipCursorClass(input({ activeTool: 'razor' }))).toBe('cursor-scissors')
  })

  it.each([
    ['roll-start', 'cursor-trim-center'],
    ['roll-end', 'cursor-trim-center'],
    ['ripple-start', 'cursor-ripple-left'],
    ['ripple-end', 'cursor-ripple-right'],
    ['trim-start', 'cursor-trim-left'],
    ['trim-end', 'cursor-trim-right'],
  ] as const)(
    'smart-trim intent %s maps to %s (trim-edit)',
    (intent: SmartTrimIntent, expected: string) => {
      expect(getClipCursorClass(input({ activeTool: 'trim-edit', smartTrimIntent: intent }))).toBe(
        expected,
      )
    },
  )

  it('smart-trim intents also apply under the select tool', () => {
    expect(getClipCursorClass(input({ activeTool: 'select', smartTrimIntent: 'trim-end' }))).toBe(
      'cursor-trim-right',
    )
  })

  it('edge intent wins over body intent', () => {
    expect(
      getClipCursorClass(
        input({
          activeTool: 'trim-edit',
          smartTrimIntent: 'trim-start',
          smartBodyIntent: 'slip-body',
        }),
      ),
    ).toBe('cursor-trim-left')
  })

  it.each([
    ['slide-body', 'cursor-slide-smart'],
    ['slip-body', 'cursor-slip-smart'],
  ] as const)('smart-body intent %s maps to %s', (intent: SmartBodyIntent, expected: string) => {
    expect(getClipCursorClass(input({ activeTool: 'trim-edit', smartBodyIntent: intent }))).toBe(
      expected,
    )
  })

  it('hovered edge in trim-edit falls back to ew-resize', () => {
    expect(getClipCursorClass(input({ activeTool: 'trim-edit', hoveredEdge: 'start' }))).toBe(
      'cursor-ew-resize',
    )
  })

  it('rate-stretch tool', () => {
    expect(getClipCursorClass(input({ activeTool: 'rate-stretch' }))).toBe('cursor-gauge')
  })

  it.each(['video', 'audio', 'composition'] as const)(
    'slip/slide is allowed for %s',
    (itemType: TimelineItem['type']) => {
      expect(getClipCursorClass(input({ activeTool: 'slip', itemType }))).toBe('cursor-ew-resize')
      expect(getClipCursorClass(input({ activeTool: 'slide', itemType }))).toBe('cursor-ew-resize')
    },
  )

  it.each(['text', 'image', 'shape', 'adjustment'] as const)(
    'slip/slide is disallowed for %s',
    (itemType: TimelineItem['type']) => {
      expect(getClipCursorClass(input({ activeTool: 'slip', itemType }))).toBe('cursor-not-allowed')
    },
  )

  it('dragging shows grabbing', () => {
    expect(getClipCursorClass(input({ isBeingDragged: true }))).toBe('cursor-grabbing')
  })

  it('default cursor when idle', () => {
    expect(getClipCursorClass(input())).toBe('cursor-default')
  })
})
