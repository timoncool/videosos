export const SCENE_VERIFICATION_MODEL_IDS = ['gemma'] as const

export type SceneVerificationModelId = (typeof SCENE_VERIFICATION_MODEL_IDS)[number]

export const DEFAULT_SCENE_VERIFICATION_MODEL: SceneVerificationModelId = 'gemma'

export const SCENE_VERIFICATION_MODEL_LABELS: Record<SceneVerificationModelId, string> = {
  gemma: 'Gemma 4',
}

export const SCENE_VERIFICATION_MODEL_CACHE_MATCH_FRAGMENTS: Record<
  SceneVerificationModelId,
  readonly string[]
> = {
  gemma: ['/onnx-community/gemma-4-e4b-it-onnx/'],
}

export const SCENE_VERIFICATION_MODEL_CACHE_DESCRIPTIONS: Record<SceneVerificationModelId, string> =
  {
    gemma: 'Gemma 4 E4B (q4f16) scene detection and frame description files.',
  }

export const SCENE_VERIFICATION_MODEL_OPTIONS = SCENE_VERIFICATION_MODEL_IDS.map((value) => ({
  value,
  label: SCENE_VERIFICATION_MODEL_LABELS[value],
})) satisfies ReadonlyArray<{
  value: SceneVerificationModelId
  label: string
}>
