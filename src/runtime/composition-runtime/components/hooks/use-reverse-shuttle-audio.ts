import { useEffect, type MutableRefObject } from 'react'
import { getAudioTargetTimeSeconds } from '../../utils/video-timing'
import {
  copyShuttleGrainSamples,
  REVERSE_SHUTTLE_GRAIN_FADE_SECONDS,
  REVERSE_SHUTTLE_GRAIN_OUTPUT_SECONDS,
  REVERSE_SHUTTLE_LOOKAHEAD_SECONDS,
  resolveReverseShuttleGrainPlan,
  type ReverseShuttleGrainPlan,
} from '../../utils/reverse-shuttle-audio'
import type { PreviewClipAudioGraph } from '../../utils/preview-audio-graph'

const SCHEDULER_INTERVAL_MS = 30
const START_SAFETY_SECONDS = 0.01

interface UseReverseShuttleAudioParams {
  graphRef: MutableRefObject<PreviewClipAudioGraph | null>
  buffer: AudioBuffer | null
  bufferStartTimeSeconds?: number
  frameRef: MutableRefObject<number>
  fps: number
  trimBefore: number
  sourceFps?: number
  sourceStartOffsetSec?: number
  authoredPlaybackRate: number
  authoredReversed?: boolean
  reverseSourceEnd?: number
  playing: boolean
  transportPlaybackRate: number
}

function createShuttleGrainBuffer(
  context: AudioContext,
  buffer: AudioBuffer,
  bufferStartTimeSeconds: number,
  plan: ReverseShuttleGrainPlan,
): AudioBuffer {
  const sourceStartInBuffer = plan.sourceStartSeconds - bufferStartTimeSeconds
  const sourceFrameCount = Math.max(1, Math.round(plan.sourceDurationSeconds * buffer.sampleRate))
  const sourceStartSample = Math.max(
    0,
    Math.min(buffer.length - sourceFrameCount, Math.round(sourceStartInBuffer * buffer.sampleRate)),
  )
  const grainBuffer = context.createBuffer(
    buffer.numberOfChannels,
    sourceFrameCount,
    buffer.sampleRate,
  )
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    copyShuttleGrainSamples(
      buffer.getChannelData(channel),
      grainBuffer.getChannelData(channel),
      sourceStartSample,
      plan.reverseSamples,
    )
  }
  return grainBuffer
}

function calculatePcmRms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sumSquares = 0
  for (const sample of samples) sumSquares += sample * sample
  return Math.sqrt(sumSquares / samples.length)
}

/**
 * Schedules short decoded-PCM grains against the signed transport clock.
 * Grains intentionally preserve ordinary shuttle pitch shift: playback rate
 * follows the authored rate multiplied by |transport rate|. Scheduling runs
 * at a bounded audio cadence and never subscribes React to frame ticks.
 */
export function useReverseShuttleAudio({
  graphRef,
  buffer,
  bufferStartTimeSeconds = 0,
  frameRef,
  fps,
  trimBefore,
  sourceFps,
  sourceStartOffsetSec = 0,
  authoredPlaybackRate,
  authoredReversed = false,
  reverseSourceEnd,
  playing,
  transportPlaybackRate,
}: UseReverseShuttleAudioParams): void {
  useEffect(() => {
    if (!playing || transportPlaybackRate >= 0 || !buffer) return

    const graph = graphRef.current
    if (!graph) return
    const context = graph.context
    const scheduledNodes = new Set<AudioBufferSourceNode>()
    let nextContextTime = context.currentTime + START_SAFETY_SECONDS
    let sourceCursorSeconds: number | null = null
    let disposed = false
    const devStats = import.meta.env.DEV
      ? {
          active: true,
          scheduledGrains: 0,
          stoppedGrains: 0,
          lastPcmRms: 0,
          outputGain: graph.outputGainNode.gain.value,
          transportPlaybackRate,
        }
      : null
    if (devStats) {
      ;(window as unknown as Record<string, unknown>).__REVERSE_SHUTTLE_AUDIO__ = devStats
    }

    const stopScheduledNodes = () => {
      for (const node of scheduledNodes) {
        try {
          node.stop()
        } catch {
          // One-shot grain already ended.
        }
        node.disconnect()
        if (devStats) devStats.stoppedGrains += 1
      }
      scheduledNodes.clear()
    }

    const readClockSourceTime = () => {
      const effectiveSourceFps = sourceFps ?? fps
      return (
        getAudioTargetTimeSeconds(
          trimBefore,
          effectiveSourceFps,
          frameRef.current,
          authoredPlaybackRate,
          fps,
          authoredReversed,
          reverseSourceEnd,
        ) - sourceStartOffsetSec
      )
    }

    const schedule = () => {
      if (disposed) return
      const now = context.currentTime
      const clockSourceTime = readClockSourceTime()
      const sourceRate = Math.max(
        0.0625,
        Math.min(16, Math.abs(authoredPlaybackRate * transportPlaybackRate)),
      )
      const maximumClockDrift =
        REVERSE_SHUTTLE_LOOKAHEAD_SECONDS * sourceRate +
        REVERSE_SHUTTLE_GRAIN_OUTPUT_SECONDS * sourceRate * 2

      if (
        sourceCursorSeconds === null ||
        Math.abs(sourceCursorSeconds - clockSourceTime) > maximumClockDrift
      ) {
        stopScheduledNodes()
        sourceCursorSeconds = clockSourceTime
        nextContextTime = now + START_SAFETY_SECONDS
      }

      while (nextContextTime < now + REVERSE_SHUTTLE_LOOKAHEAD_SECONDS) {
        const plan = resolveReverseShuttleGrainPlan({
          sourceCursorSeconds,
          authoredPlaybackRate,
          transportPlaybackRate,
          authoredReversed,
          bufferStartSeconds: bufferStartTimeSeconds,
          bufferDurationSeconds: buffer.duration,
        })
        if (!plan) break

        const grainBuffer = createShuttleGrainBuffer(context, buffer, bufferStartTimeSeconds, plan)
        if (devStats) {
          const samples = grainBuffer.getChannelData(0)
          devStats.lastPcmRms = calculatePcmRms(samples)
          devStats.outputGain = graph.outputGainNode.gain.value
          devStats.scheduledGrains += 1
        }

        const source = context.createBufferSource()
        const envelope = context.createGain()
        source.buffer = grainBuffer
        source.playbackRate.value = plan.playbackRate
        const startAt = Math.max(nextContextTime, now + START_SAFETY_SECONDS)
        const outputDuration = plan.sourceDurationSeconds / plan.playbackRate
        const endAt = startAt + outputDuration
        envelope.gain.setValueAtTime(0, startAt)
        envelope.gain.linearRampToValueAtTime(1, startAt + REVERSE_SHUTTLE_GRAIN_FADE_SECONDS)
        envelope.gain.setValueAtTime(
          1,
          Math.max(startAt, endAt - REVERSE_SHUTTLE_GRAIN_FADE_SECONDS),
        )
        envelope.gain.linearRampToValueAtTime(0, endAt)
        source.connect(envelope)
        envelope.connect(graph.sourceInputNode)
        scheduledNodes.add(source)
        source.onended = () => {
          scheduledNodes.delete(source)
          source.disconnect()
          envelope.disconnect()
        }
        source.start(startAt)

        sourceCursorSeconds = plan.nextSourceCursorSeconds
        nextContextTime = endAt
      }
    }

    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined)
    }
    schedule()
    const intervalId = window.setInterval(schedule, SCHEDULER_INTERVAL_MS)

    return () => {
      disposed = true
      window.clearInterval(intervalId)
      stopScheduledNodes()
      if (devStats) devStats.active = false
    }
  }, [
    authoredPlaybackRate,
    authoredReversed,
    buffer,
    bufferStartTimeSeconds,
    fps,
    frameRef,
    graphRef,
    playing,
    reverseSourceEnd,
    sourceFps,
    sourceStartOffsetSec,
    transportPlaybackRate,
    trimBefore,
  ])
}
