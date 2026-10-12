import { ProviderRegistry } from '@/shared/utils/provider-registry'
import {
  DEFAULT_SCENE_VERIFICATION_MODEL,
  type SceneVerificationModelId,
} from '@/shared/utils/scene-verification-models'
import { gemmaSceneVerificationProvider } from './gemma-scene-verification-provider'
import { lfmSceneVerificationProvider } from './lfm-scene-verification-provider'
import type { SceneVerificationProvider } from './types'

export type VerificationModel = SceneVerificationModelId

const sceneVerificationProviderRegistry = new ProviderRegistry<SceneVerificationProvider>(
  [gemmaSceneVerificationProvider, lfmSceneVerificationProvider],
  DEFAULT_SCENE_VERIFICATION_MODEL,
)

export function getSceneVerificationProvider(model: VerificationModel): SceneVerificationProvider {
  return sceneVerificationProviderRegistry.get(model)
}
