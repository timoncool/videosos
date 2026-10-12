// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ItemEffect } from '@/types/effects'
import {
  getGpuEffectKeyframeProperty,
  getGpuEffectKeyframeValue,
  getResolvedGpuEffectForFrame,
} from './effect-keyframes'
import { buildEffectAnimatableProperty, type ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'

const triggerWaveEffect: ItemEffect = {
  id: 'effect-1',
  enabled: true,
  effect: {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-trigger-wave',
    params: {
      strength: 0.04,
      radius: 0.85,
      frequency: 18,
      decay: 0.08,
      phase: 0,
      speed: 1,
      centerX: 0.5,
      centerY: 0.5,
      chroma: 0.006,
      scanlineMix: 0.18,
      glowColor: '#ff0000',
    },
  },
}

describe('effect keyframe helpers', () => {
  it('maps animatable color params to packed keyframe values', () => {
    expect(getGpuEffectKeyframeProperty(triggerWaveEffect, 'glowColor')).toBe(
      buildEffectAnimatableProperty('gpu-trigger-wave', 'effect-1', 'glowColor'),
    )
    expect(getGpuEffectKeyframeValue(triggerWaveEffect, 'glowColor', '#2e6b8c')).toBe(0x2e6b8c)
  })

  it('exposes ordinary effect colors and preserves RGBA keyframe values', () => {
    const flutedGlass: ItemEffect = {
      id: 'fluted-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-fluted-glass',
        params: { colorBack: '#00000000' },
      },
    }

    expect(getGpuEffectKeyframeProperty(flutedGlass, 'colorBack')).toBe(
      buildEffectAnimatableProperty('gpu-fluted-glass', 'fluted-1', 'colorBack'),
    )
    const rgbaValue = getGpuEffectKeyframeValue(flutedGlass, 'colorBack', '#12345678')
    expect(rgbaValue).not.toBeNull()

    const item: TimelineItem = {
      id: 'item-rgba',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 20,
      label: 'Clip',
      src: 'clip.mp4',
      effects: [flutedGlass],
    }
    const itemKeyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: buildEffectAnimatableProperty('gpu-fluted-glass', 'fluted-1', 'colorBack'),
          keyframes: [{ id: 'rgba-kf', frame: 0, value: rgbaValue!, easing: 'linear' }],
        },
      ],
    }

    expect(getResolvedGpuEffectForFrame(flutedGlass, item, itemKeyframes, 0).params.colorBack).toBe(
      '#12345678',
    )
  })

  it('resolves color keyframes for effect panel display', () => {
    const item: TimelineItem = {
      id: 'item-1',
      type: 'video',
      trackId: 'track-1',
      from: 20,
      durationInFrames: 60,
      label: 'Clip',
      src: 'clip.mp4',
      effects: [triggerWaveEffect],
    }
    const property = buildEffectAnimatableProperty('gpu-trigger-wave', 'effect-1', 'glowColor')
    const itemKeyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property,
          keyframes: [
            { id: 'kf-1', frame: 0, value: 0xff0000, easing: 'linear' },
            { id: 'kf-2', frame: 10, value: 0x0000ff, easing: 'linear' },
          ],
        },
      ],
    }

    const resolved = getResolvedGpuEffectForFrame(triggerWaveEffect, item, itemKeyframes, 25)
    expect(resolved.params.glowColor).toBe('#ba00c2')
  })

  it('resolves perceptual RGBA playback deterministically across arbitrary seeks', () => {
    const flutedGlass: ItemEffect = {
      id: 'fluted-playback',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-fluted-glass',
        params: { colorBack: '#ff000000' },
      },
    }
    const item: TimelineItem = {
      id: 'rgba-playback-item',
      type: 'video',
      trackId: 'track-1',
      from: 100,
      durationInFrames: 30,
      label: 'Clip',
      src: 'clip.mp4',
      effects: [flutedGlass],
    }
    const property = buildEffectAnimatableProperty(
      'gpu-fluted-glass',
      'fluted-playback',
      'colorBack',
    )
    const itemKeyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property,
          keyframes: [
            {
              id: 'rgba-start',
              frame: 0,
              value: getGpuEffectKeyframeValue(flutedGlass, 'colorBack', '#ff000000')!,
              easing: 'linear',
            },
            {
              id: 'rgba-end',
              frame: 10,
              value: getGpuEffectKeyframeValue(flutedGlass, 'colorBack', '#0000ffff')!,
              easing: 'linear',
            },
          ],
        },
      ],
    }

    const resolveAt = (relativeFrame: number) =>
      getResolvedGpuEffectForFrame(flutedGlass, item, itemKeyframes, item.from + relativeFrame)
        .params.colorBack

    expect(resolveAt(8)).toMatch(/^#[0-9a-f]{8}$/)
    expect(resolveAt(2)).toMatch(/^#[0-9a-f]{8}$/)
    expect(resolveAt(5)).toBe('#ba00c280')
    expect(resolveAt(5)).toBe('#ba00c280')
  })
})
