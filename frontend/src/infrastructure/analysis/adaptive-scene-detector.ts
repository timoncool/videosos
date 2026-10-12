import type { AdaptiveSceneCutMetrics, SceneCut } from './scene-detection-types'

const FEATURE_STRIDE = 3
const HUE = 0
const SATURATION = 1
const LUMA = 2
const BYTE_SCALE = 255
const LOW_SATURATION_THRESHOLD = 8

export interface FrameFeatures {
  width: number
  height: number
  values: Float32Array
}

export interface AdaptiveFrameScore {
  frameIndex: number
  time: number
  contentScore: number
  hueDelta: number
  saturationDelta: number
  lumaDelta: number
  returnScore?: number
}

export interface AdaptiveSceneOptions {
  adaptiveThreshold: number
  minContentScore: number
  windowWidth: number
  minSceneFrames: number
  flashReturnThreshold: number
}

const DEFAULT_ADAPTIVE_SCENE_OPTIONS: Readonly<AdaptiveSceneOptions> = {
  adaptiveThreshold: 3,
  minContentScore: 15,
  windowWidth: 2,
  minSceneFrames: 3,
  flashReturnThreshold: 10,
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function rgbToFeatures(r: number, g: number, b: number): [number, number, number] {
  const red = r / BYTE_SCALE
  const green = g / BYTE_SCALE
  const blue = b / BYTE_SCALE
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min

  let hue = 0
  if (delta > 0) {
    if (max === red) {
      hue = ((green - blue) / delta) % 6
    } else if (max === green) {
      hue = (blue - red) / delta + 2
    } else {
      hue = (red - green) / delta + 4
    }
    hue /= 6
    if (hue < 0) hue += 1
  }

  const saturation = max === 0 ? 0 : delta / max
  const luma = 0.299 * red + 0.587 * green + 0.114 * blue
  return [hue * BYTE_SCALE, saturation * BYTE_SCALE, luma * BYTE_SCALE]
}

export function extractFrameFeatures(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): FrameFeatures {
  const pixelCount = width * height
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError('Frame dimensions must be positive integers')
  }
  if (pixels.length !== pixelCount * 4) {
    throw new RangeError('Pixel data length does not match frame dimensions')
  }

  const values = new Float32Array(pixelCount * FEATURE_STRIDE)
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    const pixelOffset = pixelIndex * 4
    const featureOffset = pixelIndex * FEATURE_STRIDE
    const [hue, saturation, luma] = rgbToFeatures(
      pixels[pixelOffset]!,
      pixels[pixelOffset + 1]!,
      pixels[pixelOffset + 2]!,
    )
    values[featureOffset + HUE] = hue
    values[featureOffset + SATURATION] = saturation
    values[featureOffset + LUMA] = luma
  }

  return { width, height, values }
}

export function compareFrameFeatures(
  previous: FrameFeatures,
  current: FrameFeatures,
): Omit<AdaptiveFrameScore, 'frameIndex' | 'time' | 'returnScore'> {
  if (previous.width !== current.width || previous.height !== current.height) {
    throw new RangeError('Frame feature dimensions must match')
  }

  const pixelCount = previous.width * previous.height
  if (pixelCount === 0) {
    return { contentScore: 0, hueDelta: 0, saturationDelta: 0, lumaDelta: 0 }
  }

  let hueDelta = 0
  let saturationDelta = 0
  let lumaDelta = 0

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    const offset = pixelIndex * FEATURE_STRIDE
    const previousHue = previous.values[offset + HUE]!
    const currentHue = current.values[offset + HUE]!
    const previousSaturation = previous.values[offset + SATURATION]!
    const currentSaturation = current.values[offset + SATURATION]!

    const rawHueDelta = Math.abs(previousHue - currentHue)
    const circularHueDelta = Math.min(rawHueDelta, BYTE_SCALE - rawHueDelta)
    const saturationWeight =
      Math.max(previousSaturation, currentSaturation) < LOW_SATURATION_THRESHOLD ? 0 : 1

    hueDelta += circularHueDelta * 2 * saturationWeight
    saturationDelta += Math.abs(previousSaturation - currentSaturation)
    lumaDelta += Math.abs(previous.values[offset + LUMA]! - current.values[offset + LUMA]!)
  }

  hueDelta /= pixelCount
  saturationDelta /= pixelCount
  lumaDelta /= pixelCount

  return {
    contentScore: (hueDelta + saturationDelta + lumaDelta) / 3,
    hueDelta,
    saturationDelta,
    lumaDelta,
  }
}

function getAdaptiveRatio(
  scores: readonly AdaptiveFrameScore[],
  index: number,
  windowWidth: number,
): number {
  let baselineTotal = 0
  let baselineCount = 0

  const start = Math.max(0, index - windowWidth)
  const end = Math.min(scores.length - 1, index + windowWidth)
  for (let neighborIndex = start; neighborIndex <= end; neighborIndex++) {
    if (neighborIndex === index) continue
    baselineTotal += scores[neighborIndex]!.contentScore
    baselineCount++
  }

  const baseline = Math.max(1, baselineCount > 0 ? baselineTotal / baselineCount : 0)
  return scores[index]!.contentScore / baseline
}

function findFlashScoreIndices(
  scores: readonly AdaptiveFrameScore[],
  options: AdaptiveSceneOptions,
): Set<number> {
  const flashIndices = new Set<number>()
  for (let index = 0; index < scores.length - 1; index++) {
    const score = scores[index]!
    const nextScore = scores[index + 1]!
    if (
      score.returnScore !== undefined &&
      score.returnScore <= options.flashReturnThreshold &&
      score.contentScore >= options.minContentScore &&
      nextScore.contentScore >= options.minContentScore
    ) {
      flashIndices.add(index)
      flashIndices.add(index + 1)
    }
  }
  return flashIndices
}

function toConfidence(
  contentScore: number,
  adaptiveRatio: number,
  options: AdaptiveSceneOptions,
): number {
  const contentMargin = (contentScore - options.minContentScore) / options.minContentScore
  const ratioMargin = (adaptiveRatio - options.adaptiveThreshold) / options.adaptiveThreshold
  return clamp01(0.5 + 0.25 * Math.tanh(contentMargin) + 0.25 * Math.tanh(ratioMargin))
}

export function classifyAdaptiveSceneCuts(
  scores: readonly AdaptiveFrameScore[],
  overrides: Partial<AdaptiveSceneOptions> = {},
): SceneCut[] {
  if (scores.length < 3) return []

  const options = { ...DEFAULT_ADAPTIVE_SCENE_OPTIONS, ...overrides }
  const flashIndices = findFlashScoreIndices(scores, options)
  const candidates: Array<SceneCut & { frameIndex: number }> = []

  for (let index = 0; index < scores.length; index++) {
    const score = scores[index]!
    if (flashIndices.has(index) || score.contentScore < options.minContentScore) continue

    const adaptiveRatio = getAdaptiveRatio(scores, index, options.windowWidth)
    if (adaptiveRatio < options.adaptiveThreshold) continue

    const metrics: AdaptiveSceneCutMetrics = {
      kind: 'adaptive',
      contentScore: score.contentScore,
      adaptiveRatio,
      hueDelta: score.hueDelta,
      saturationDelta: score.saturationDelta,
      lumaDelta: score.lumaDelta,
      returnScore: score.returnScore,
    }
    candidates.push({
      frameIndex: score.frameIndex,
      time: score.time,
      score: score.contentScore,
      confidence: toConfidence(score.contentScore, adaptiveRatio, options),
      type: 'cut',
      metrics,
    })
  }

  if (candidates.length <= 1) return candidates.map(({ frameIndex: _, ...cut }) => cut)

  const clustered: SceneCut[] = []
  let clusterStartFrame = candidates[0]!.frameIndex
  let clusterBest = candidates[0]!

  for (let index = 1; index < candidates.length; index++) {
    const candidate = candidates[index]!
    if (candidate.frameIndex - clusterStartFrame < options.minSceneFrames) {
      if (candidate.score > clusterBest.score) clusterBest = candidate
      continue
    }

    const { frameIndex: _, ...cut } = clusterBest
    clustered.push(cut)
    clusterStartFrame = candidate.frameIndex
    clusterBest = candidate
  }

  const { frameIndex: _, ...lastCut } = clusterBest
  clustered.push(lastCut)
  return clustered
}
