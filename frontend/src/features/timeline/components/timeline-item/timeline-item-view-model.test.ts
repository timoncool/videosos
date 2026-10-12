// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  resolveActiveEdgeState,
  resolveTrimCursorAndTones,
  resolveTrimVisualState,
  type TrimVisualStateInput,
} from './timeline-item-view-model'

const idle: TrimVisualStateInput = {
  isTrimming: false,
  trimHandle: null,
  trimConstrained: false,
  isRollingEdit: false,
  rollingEditHandle: null,
  rollingEditConstrained: false,
  isSlipSlideActive: false,
  slipSlideConstrained: false,
  slipSlideConstraintEdge: null,
  isLinkedSlipCompanion: false,
  isLinkedSlideCompanion: false,
  isStretching: false,
  stretchHandle: null,
  stretchConstrained: false,
  smartTrimIntent: null,
  isRippleEdit: false,
}

describe('resolveActiveEdgeState', () => {
  it('returns null without an active gesture', () => {
    expect(resolveActiveEdgeState(idle)).toBeNull()
  })

  it('resolves trim edges with rolling constraint', () => {
    expect(
      resolveActiveEdgeState({
        ...idle,
        isTrimming: true,
        trimHandle: 'start',
        trimConstrained: true,
        isRollingEdit: true,
      }),
    ).toEqual({ start: true, end: false, constrainedEdge: 'both' })
  })

  it('swaps rolling edges (end handle drives the start edge)', () => {
    expect(
      resolveActiveEdgeState({ ...idle, rollingEditHandle: 'end', rollingEditConstrained: true }),
    ).toEqual({ start: true, end: false, constrainedEdge: 'both' })
  })

  it('covers both edges for slip/slide with fallback constraint', () => {
    expect(
      resolveActiveEdgeState({ ...idle, isSlipSlideActive: true, slipSlideConstrained: true }),
    ).toEqual({ start: true, end: true, constrainedEdge: 'both' })
  })

  it('covers both edges for linked companions', () => {
    expect(resolveActiveEdgeState({ ...idle, isLinkedSlideCompanion: true })).toEqual({
      start: true,
      end: true,
      constrainedEdge: null,
    })
  })

  it('resolves stretch edges', () => {
    expect(
      resolveActiveEdgeState({
        ...idle,
        isStretching: true,
        stretchHandle: 'end',
        stretchConstrained: true,
      }),
    ).toEqual({ start: false, end: true, constrainedEdge: 'end' })
  })
})

describe('resolveTrimCursorAndTones', () => {
  it('uses ripple styling for ripple intents', () => {
    expect(resolveTrimCursorAndTones({ ...idle, smartTrimIntent: 'ripple-start' })).toMatchObject({
      startCursorClass: 'cursor-ripple-left',
      startTone: 'ripple',
      endTone: 'default',
    })
  })

  it('falls back to trim styling without intent', () => {
    expect(resolveTrimCursorAndTones(idle)).toMatchObject({
      startCursorClass: 'cursor-trim-left',
      endCursorClass: 'cursor-trim-right',
      startTone: 'default',
      endTone: 'default',
    })
  })

  it('marks ripple tones during constrained ripple trims', () => {
    expect(
      resolveTrimCursorAndTones({
        ...idle,
        isTrimming: true,
        trimHandle: 'end',
        isRippleEdit: true,
      }).endTone,
    ).toBe('ripple')
  })
})

describe('resolveTrimVisualState', () => {
  it('composes edges with cursor and tone state', () => {
    const state = resolveTrimVisualState({ ...idle, isTrimming: true, trimHandle: 'start' })
    expect(state.activeEdges).toEqual({ start: true, end: false, constrainedEdge: null })
    expect(state.startCursorClass).toBe('cursor-trim-left')
  })
})
