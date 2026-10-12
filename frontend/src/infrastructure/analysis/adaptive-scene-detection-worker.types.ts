import type { ObjectUrlSourceMetadata } from '@/infrastructure/browser/object-url-registry'
import type { SceneCut } from './scene-detection-types'

export interface AdaptiveSceneAnalyzeRequest {
  type: 'analyze'
  requestId: string
  sourceUrl: string
  fallbackBlob?: Blob
  sourceMetadata?: ObjectUrlSourceMetadata
  duration: number
}

export interface AdaptiveSceneAbortRequest {
  type: 'abort'
  requestId: string
}

export type AdaptiveSceneWorkerRequest = AdaptiveSceneAnalyzeRequest | AdaptiveSceneAbortRequest

export interface AdaptiveSceneProgressResponse {
  type: 'progress'
  requestId: string
  stage: 'analyzing' | 'classifying'
  percent: number
  decodedFrames: number
  sceneCuts: number
}

export interface AdaptiveSceneCompleteResponse {
  type: 'complete'
  requestId: string
  decodedFrames: number
  cuts: SceneCut[]
}

export interface AdaptiveSceneAbortedResponse {
  type: 'aborted'
  requestId: string
}

export interface AdaptiveSceneErrorResponse {
  type: 'error'
  requestId: string
  error: string
}

export type AdaptiveSceneWorkerResponse =
  | AdaptiveSceneProgressResponse
  | AdaptiveSceneCompleteResponse
  | AdaptiveSceneAbortedResponse
  | AdaptiveSceneErrorResponse
