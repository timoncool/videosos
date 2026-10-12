export interface EffectParam {
  /** 'json' params hold structured data as a JSON string (custom panels only — no generic UI) */
  type: 'number' | 'boolean' | 'select' | 'color' | 'point' | 'json' | 'text'
  label: string
  default: number | boolean | string
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
  animatable?: boolean
  quality?: boolean
  visibleWhen?: (params: Record<string, number | boolean | string>) => boolean
}

/** rgba8unorm texel payload for an effect's auxiliary data texture. */
export interface EffectDataTexturePayload {
  width: number
  height: number
  /** 1 for 2d textures */
  depth: number
  /** rgba8: width * height * depth * 4 bytes */
  data: Uint8Array
}

/**
 * Auxiliary data texture bound at @group(0) @binding(3), sampled with the
 * shared linear sampler at binding 0. Built CPU-side from the effect params
 * (e.g. a 256x1 curve LUT or a 3D color LUT) and cached by `key` — the
 * texture is only rewritten when the key changes.
 */
export interface EffectDataTextureSpec {
  dimension: '2d' | '3d'
  /** Cheap change-detection key derived from params */
  key: (params: Record<string, number | boolean | string>) => string
  /** Build texel data; must always return a valid payload (use identity data as fallback) */
  build: (params: Record<string, number | boolean | string>) => EffectDataTexturePayload
}

/**
 * Marks an effect as running through a compute pass instead of the default
 * fragment render pass. Compute effects read the input via `textureLoad`
 * (binding 0, a plain `texture_2d<f32>` — no sampler) and write results with
 * `textureStore` into a `texture_storage_2d<rgba8unorm, write>` (binding 1);
 * uniforms stay at binding 2. This unlocks passes a single fragment shader
 * can't express — scatter writes, cross-pixel sorting, prefix scans — because
 * an invocation can write to an output location other than its own.
 */
export interface GpuEffectComputeSpec {
  /**
   * Workgroup counts to dispatch, derived from the output dimensions. Must
   * cover every output texel given the shader's `@workgroup_size` (the shader
   * is responsible for bounds-guarding invocations past width/height).
   */
  dispatch: (width: number, height: number) => [number, number, number]
}

export interface GpuEffectDefinition {
  id: string
  name: string
  category: GpuEffectCategory
  shader: string
  entryPoint: string
  uniformSize: number
  params: Record<string, EffectParam>
  packUniforms: (
    params: Record<string, number | boolean | string>,
    width: number,
    height: number,
    timelineTimeSeconds?: number,
  ) => Float32Array | null
  dataTexture?: EffectDataTextureSpec
  /** When set, the effect runs as a compute pass rather than a fragment pass. */
  compute?: GpuEffectComputeSpec
}

export type GpuEffectCategory = 'color' | 'blur' | 'distort' | 'stylize' | 'keying'

export interface GpuEffectInstance {
  /** Composition timeline time, never wall-clock or media source time. */
  timelineTimeSeconds?: number
  id: string
  type: string
  name: string
  enabled: boolean
  params: Record<string, number | boolean | string>
}
