import AdaptiveSceneDetectionWorker from './adaptive-scene-detection-worker.ts?worker'

export function createAdaptiveSceneDetectionWorker(): Worker {
  return new AdaptiveSceneDetectionWorker()
}
