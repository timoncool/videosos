// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  canvasPointToSpatialEffectUv,
  spatialEffectUvToCanvasPoint,
} from './spatial-effect-coordinates'

describe('spatial effect project coordinates', () => {
  it('round-trips project UVs without depending on clip transform or crop geometry', () => {
    const projectSize = { width: 1920, height: 1080 }
    const uv = canvasPointToSpatialEffectUv({ x: 480, y: 810 }, projectSize)

    expect(uv).toEqual({ x: 0.25, y: 0.75 })
    expect(spatialEffectUvToCanvasPoint(uv, projectSize)).toEqual({ x: 480, y: 810 })
  })

  it('clamps pointer positions to the project texture', () => {
    expect(
      canvasPointToSpatialEffectUv({ x: -20, y: 1200 }, { width: 1920, height: 1080 }),
    ).toEqual({ x: 0, y: 1 })
  })
})
