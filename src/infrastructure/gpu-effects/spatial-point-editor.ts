export interface SpatialPointEffectConfig {
  xParam: 'centerX' | 'originX'
  yParam: 'centerY' | 'originY'
}

const CENTER_CONFIG: SpatialPointEffectConfig = {
  xParam: 'centerX',
  yParam: 'centerY',
}

const SPATIAL_POINT_EFFECTS: Readonly<Record<string, SpatialPointEffectConfig>> = {
  'gpu-twirl': CENTER_CONFIG,
  'gpu-bulge': CENTER_CONFIG,
  'gpu-trigger-wave': CENTER_CONFIG,
  'gpu-radial-blur': CENTER_CONFIG,
  'gpu-zoom-blur': CENTER_CONFIG,
  'gpu-ripple-glass': { xParam: 'originX', yParam: 'originY' },
  'gpu-droste': CENTER_CONFIG,
}

export function getSpatialPointEffectConfig(
  gpuEffectType: string,
): SpatialPointEffectConfig | null {
  return SPATIAL_POINT_EFFECTS[gpuEffectType] ?? null
}
