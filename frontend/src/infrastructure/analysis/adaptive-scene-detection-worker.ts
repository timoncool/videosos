import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source'
import { ensureProResDecoderRegistered } from '@/infrastructure/browser/register-prores-decoder'
import {
  classifyAdaptiveSceneCuts,
  compareFrameFeatures,
  extractFrameFeatures,
  type AdaptiveFrameScore,
  type FrameFeatures,
} from './adaptive-scene-detector'
import type {
  AdaptiveSceneAnalyzeRequest,
  AdaptiveSceneWorkerRequest,
  AdaptiveSceneWorkerResponse,
} from './adaptive-scene-detection-worker.types'

interface ActiveAnalysis {
  requestId: string
  aborted: boolean
}

interface DecodedSceneCanvas {
  canvas: OffscreenCanvas
  timestamp: number
}

interface SceneCanvasSink {
  canvases(): AsyncIterable<DecodedSceneCanvas>
  dispose?: () => void
}

interface DecodeState {
  scores: AdaptiveFrameScore[]
  previousFeatures: FrameFeatures | null
  twoFramesBackFeatures: FrameFeatures | null
  decodedFrames: number
  lastReportedPercent: number
}

let activeAnalysis: ActiveAnalysis | null = null

function post(response: AdaptiveSceneWorkerResponse): void {
  self.postMessage(response)
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Adaptive scene analysis failed'
}

function readFrameFeatures(wrapped: DecodedSceneCanvas): FrameFeatures {
  const { canvas } = wrapped
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Unable to read decoded scene-analysis frames')

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  return extractFrameFeatures(imageData.data, canvas.width, canvas.height)
}

function appendFrameScore(
  state: DecodeState,
  currentFeatures: FrameFeatures,
  timestamp: number,
): void {
  if (state.previousFeatures) {
    if (state.twoFramesBackFeatures && state.scores.length > 0) {
      state.scores[state.scores.length - 1]!.returnScore = compareFrameFeatures(
        state.twoFramesBackFeatures,
        currentFeatures,
      ).contentScore
    }

    state.scores.push({
      frameIndex: state.decodedFrames,
      time: timestamp,
      ...compareFrameFeatures(state.previousFeatures, currentFeatures),
    })
  }

  state.twoFramesBackFeatures = state.previousFeatures
  state.previousFeatures = currentFeatures
  state.decodedFrames++
}

function analysisPercent(timestamp: number, duration: number): number {
  if (duration <= 0) return 0
  return Math.min(99, Math.max(0, Math.floor((timestamp / duration) * 100)))
}

function reportAnalysisProgress(
  request: AdaptiveSceneAnalyzeRequest,
  state: DecodeState,
  percent: number,
): void {
  state.lastReportedPercent = percent
  post({
    type: 'progress',
    requestId: request.requestId,
    stage: 'analyzing',
    percent,
    decodedFrames: state.decodedFrames,
    sceneCuts: 0,
  })
}

async function decodeFrameScores(
  sink: SceneCanvasSink,
  request: AdaptiveSceneAnalyzeRequest,
  active: ActiveAnalysis,
): Promise<DecodeState> {
  const state: DecodeState = {
    scores: [],
    previousFeatures: null,
    twoFramesBackFeatures: null,
    decodedFrames: 0,
    lastReportedPercent: -1,
  }

  for await (const wrapped of sink.canvases()) {
    if (active.aborted) break

    appendFrameScore(state, readFrameFeatures(wrapped), wrapped.timestamp)
    const percent = analysisPercent(wrapped.timestamp, request.duration)
    if (percent !== state.lastReportedPercent || state.decodedFrames <= 2) {
      reportAnalysisProgress(request, state, percent)
    }
  }

  return state
}

async function analyze(
  request: AdaptiveSceneAnalyzeRequest,
  active: ActiveAnalysis,
): Promise<void> {
  const [mb] = await Promise.all([import('mediabunny'), ensureProResDecoderRegistered()])
  const input = new mb.Input({
    source: createMediabunnyInputSource(mb, request.sourceUrl, {
      metadata: request.sourceMetadata,
      fallbackBlob: request.fallbackBlob,
    }),
    formats: mb.ALL_FORMATS,
  })

  let sink: SceneCanvasSink | null = null

  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack) throw new Error('No video track found for scene analysis')
    if (!(await videoTrack.canDecode())) {
      throw new Error('The primary video track cannot be decoded in this browser')
    }

    sink = new mb.CanvasSink(videoTrack, {
      width: 96,
      poolSize: 1,
    }) as unknown as SceneCanvasSink
    const { scores, decodedFrames } = await decodeFrameScores(sink, request, active)

    if (active.aborted) {
      post({ type: 'aborted', requestId: request.requestId })
      return
    }

    post({
      type: 'progress',
      requestId: request.requestId,
      stage: 'classifying',
      percent: 99,
      decodedFrames,
      sceneCuts: 0,
    })
    const cuts = classifyAdaptiveSceneCuts(scores)

    post({
      type: 'progress',
      requestId: request.requestId,
      stage: 'classifying',
      percent: 100,
      decodedFrames,
      sceneCuts: cuts.length,
    })
    post({ type: 'complete', requestId: request.requestId, decodedFrames, cuts })
  } finally {
    sink?.dispose?.()
    input.dispose()
  }
}

self.onmessage = (event: MessageEvent<AdaptiveSceneWorkerRequest>) => {
  const request = event.data

  if (request.type === 'abort') {
    if (activeAnalysis?.requestId === request.requestId) activeAnalysis.aborted = true
    return
  }

  if (activeAnalysis) {
    post({
      type: 'error',
      requestId: request.requestId,
      error: 'Adaptive scene analysis worker is already busy',
    })
    return
  }

  const active: ActiveAnalysis = { requestId: request.requestId, aborted: false }
  activeAnalysis = active
  void analyze(request, active)
    .catch((error) => {
      if (active.aborted) {
        post({ type: 'aborted', requestId: request.requestId })
      } else {
        post({ type: 'error', requestId: request.requestId, error: safeErrorMessage(error) })
      }
    })
    .finally(() => {
      if (activeAnalysis === active) activeAnalysis = null
    })
}
