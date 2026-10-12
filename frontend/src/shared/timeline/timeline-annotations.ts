import type { ProjectMarker } from '@/types/timeline'
import { clampFinite as clamp } from '@/shared/utils/math'

export interface TimelineAnnotationPoint {
  frame: number
  positionRatio: number
}

export interface TimelineAnnotationMarker extends ProjectMarker {
  positionRatio: number
}

export interface TimelineAnnotationModel {
  maxFrame: number
  inPoint: TimelineAnnotationPoint | null
  outPoint: TimelineAnnotationPoint | null
  ioRange: {
    inFrame: number
    outFrame: number
    startRatio: number
    endRatio: number
  } | null
  markers: TimelineAnnotationMarker[]
}

function normalizeFrame(frame: number | null | undefined): number | null {
  if (frame === null || frame === undefined || !Number.isFinite(frame)) return null
  return Math.round(frame)
}

function frameToRatio(frame: number, maxFrame: number): number {
  return clamp(frame / Math.max(1, maxFrame), 0, 1)
}

export function buildTimelineAnnotationModel({
  markers,
  inPoint,
  outPoint,
  maxFrame,
}: {
  markers: readonly ProjectMarker[]
  inPoint: number | null | undefined
  outPoint: number | null | undefined
  maxFrame: number
}): TimelineAnnotationModel {
  const safeMaxFrame = Math.max(1, Math.floor(Number.isFinite(maxFrame) ? maxFrame : 1))
  const normalizedIn = normalizeFrame(inPoint)
  const normalizedOut = normalizeFrame(outPoint)
  const safeIn = normalizedIn === null ? null : clamp(normalizedIn, 0, safeMaxFrame)
  const safeOut = normalizedOut === null ? null : clamp(normalizedOut, 0, safeMaxFrame)
  const hasRange = safeIn !== null && safeOut !== null && safeOut > safeIn

  return {
    maxFrame: safeMaxFrame,
    inPoint:
      safeIn === null
        ? null
        : {
            frame: safeIn,
            positionRatio: frameToRatio(safeIn, safeMaxFrame),
          },
    outPoint:
      safeOut === null
        ? null
        : {
            frame: safeOut,
            positionRatio: frameToRatio(safeOut, safeMaxFrame),
          },
    ioRange: hasRange
      ? {
          inFrame: safeIn,
          outFrame: safeOut,
          startRatio: frameToRatio(safeIn, safeMaxFrame),
          endRatio: frameToRatio(safeOut, safeMaxFrame),
        }
      : null,
    markers: markers
      .filter((marker) => Number.isFinite(marker.frame))
      .map((marker) => {
        const frame = clamp(Math.round(marker.frame), 0, safeMaxFrame)
        return {
          ...marker,
          frame,
          positionRatio: frameToRatio(frame, safeMaxFrame),
        }
      })
      .sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id)),
  }
}
