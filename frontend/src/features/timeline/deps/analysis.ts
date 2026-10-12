import {
  SCENE_VERIFICATION_MODEL_LABELS,
  SCENE_VERIFICATION_MODEL_OPTIONS,
  type SceneVerificationModelId,
} from '@/shared/utils/scene-verification-models'
import {
  SCENE_DETECTOR_VERSION,
  type SceneDetectionMethod,
} from '@/infrastructure/analysis/scene-detection-types'

export const importSceneDetection = () => import('@/infrastructure/analysis/scene-detection')

export function getSceneVerificationModelLabel(model: SceneVerificationModelId): string {
  return SCENE_VERIFICATION_MODEL_LABELS[model]
}

export function getSceneVerificationModelOptions(): readonly {
  value: SceneVerificationModelId
  label: string
}[] {
  return SCENE_VERIFICATION_MODEL_OPTIONS
}

export type VerificationModel = SceneVerificationModelId
export { SCENE_DETECTOR_VERSION }
export type { SceneDetectionMethod }
