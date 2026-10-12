import type { ShapeItem } from '@/types/timeline'

export interface RasterizedMaskLayerSettings {
  invert: boolean
  feather: number
  opacity: number
}

function getRasterizedMaskLayerSettings(
  shape: Pick<ShapeItem, 'maskType' | 'maskFeather' | 'maskOpacity' | 'maskInvert'>,
): RasterizedMaskLayerSettings {
  const maskType = shape.maskType ?? 'clip'

  return {
    invert: shape.maskInvert ?? false,
    feather: maskType === 'alpha' ? (shape.maskFeather ?? 0) : 0,
    opacity: Math.max(0, Math.min(100, shape.maskOpacity ?? 100)) / 100,
  }
}

export function getRasterizedMaskLayerSettingsList(
  shapes: Array<Pick<ShapeItem, 'maskType' | 'maskFeather' | 'maskOpacity' | 'maskInvert'>>,
): RasterizedMaskLayerSettings[] {
  return shapes.map(getRasterizedMaskLayerSettings)
}
