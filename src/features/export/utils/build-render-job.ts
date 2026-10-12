/**
 * Build render-queue jobs from the current editor state.
 *
 * A job freezes a deep copy of the timeline (tracks/items/transitions/
 * keyframes) plus the project metadata and audio bus state at enqueue time, so
 * later edits don't change what an already-queued job renders. Settings are
 * resolved (codec fallback) up front so the queue shows the real output format.
 */

import type { ExtendedExportSettings } from '@/types/export'
import type { ProjectMarker } from '@/types/timeline'
import {
  getActiveExportSequenceId,
  getExportableSequence,
  type ExportableSequence,
} from '@/features/export/deps/timeline-compositions'
import { useProjectStore } from '@/features/export/deps/projects'
import { mapRequestedClientSettings, resolveClientSettings } from '../deps/renderer'
import { assessSmartCopyEligibility } from './smart-copy'
import type { ClientExportSettings } from '../deps/renderer'
import type { RenderJob, RenderJobSnapshot } from '../stores/render-queue-store'

export interface FrameRange {
  start: number
  end: number
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T)
}

/** End frame of the last item on the timeline (0 when empty). */
function timelineDurationFrames(
  items: ReadonlyArray<{ from: number; durationInFrames: number }>,
): number {
  if (items.length === 0) return 0
  return Math.max(...items.map((item) => item.from + item.durationInFrames))
}

interface TimelineCapture {
  snapshot: RenderJobSnapshot
  fps: number
  projectId?: string
  projectName: string
  durationFrames: number
  storeInPoint: number | null
  storeOutPoint: number | null
  markers: ProjectMarker[]
}

/**
 * Read + deep-copy everything a render needs for a chosen sequence (Main or a
 * standalone sequence tab). Defaults to the active tab — "export what you see" —
 * so callers that don't pick a sequence behave exactly as before.
 */
function captureTimeline(sequence?: ExportableSequence): TimelineCapture {
  const seq = sequence ?? getExportableSequence(getActiveExportSequenceId())
  const currentProject = useProjectStore.getState().currentProject

  const snapshot: RenderJobSnapshot = {
    tracks: clone(seq.tracks),
    items: clone(seq.items),
    transitions: clone(seq.transitions),
    keyframes: clone(seq.keyframes),
    fps: seq.fps,
    width: seq.width,
    height: seq.height,
    backgroundColor: seq.backgroundColor,
    busAudioEq: seq.busAudioEq,
    masterBusDb: seq.masterBusDb,
  }

  // Distinguish exported sequence files from the Main-timeline export.
  const baseName = currentProject?.name ?? 'export'
  const projectName = seq.id === null ? baseName : `${baseName} - ${seq.name}`

  return {
    snapshot,
    fps: seq.fps,
    projectId: currentProject?.id,
    projectName,
    durationFrames: seq.durationFrames || timelineDurationFrames(seq.items),
    storeInPoint: seq.inPoint,
    storeOutPoint: seq.outPoint,
    markers: seq.markers,
  }
}

function rangeLabel(inPoint: number | null, outPoint: number | null, fps: number): string {
  if (inPoint == null || outPoint == null) return ''
  const startSec = Math.round(inPoint / fps)
  const endSec = Math.round(outPoint / fps)
  return ` ${startSec}s-${endSec}s`
}

export interface BuildRenderJobOptions {
  settings: ExtendedExportSettings
  /** Render range in project frames; null/null = whole project. */
  inPoint?: number | null
  outPoint?: number | null
  /** Overrides the auto-generated display name. */
  name?: string
  /** Reuse a single capture across many segment jobs (avoids re-cloning). */
  capture?: TimelineCapture
  /** Which sequence to export (Main or a standalone tab). Defaults to active. */
  sequence?: ExportableSequence
}

/**
 * Assemble a RenderJob from an already-resolved capture + settings (synchronous,
 * no codec probe). Segment building resolves settings ONCE and assembles many
 * jobs from it — avoiding one WebCodecs probe per segment.
 */
function assembleJob(
  capture: TimelineCapture,
  clientSettings: ClientExportSettings,
  exportMode: 'video' | 'audio',
  inPoint: number | null,
  outPoint: number | null,
  name?: string,
): RenderJob {
  const hasRange = inPoint != null && outPoint != null
  const durationFrames = hasRange ? outPoint - inPoint : capture.durationFrames

  const label = rangeLabel(inPoint, outPoint, capture.fps)
  const displayName = name ?? `${capture.projectName}${label}`
  const fileName = `${capture.projectName}${label}.${clientSettings.container}`

  return {
    id: crypto.randomUUID(),
    name: displayName,
    projectId: capture.projectId,
    status: 'queued',
    progress: 0,
    inPoint,
    outPoint,
    durationFrames,
    exportMode,
    clientSettings,
    snapshot: capture.snapshot,
    fileName,
    createdAt: Date.now(),
  }
}

/** Build one queued render job from the current editor state. */
export async function buildRenderJob({
  settings,
  inPoint = null,
  outPoint = null,
  name,
  capture,
  sequence,
}: BuildRenderJobOptions): Promise<RenderJob> {
  const cap = capture ?? captureTimeline(sequence)
  const requested = mapRequestedClientSettings(settings, cap.fps)
  const smartCopy = assessSmartCopyEligibility({
    settings: requested.clientSettings,
    tracks: cap.snapshot.tracks,
    items: cap.snapshot.items,
    transitions: cap.snapshot.transitions,
    keyframes: cap.snapshot.keyframes,
    fps: cap.snapshot.fps,
    width: cap.snapshot.width,
    height: cap.snapshot.height,
    inPoint,
    outPoint,
    busAudioEq: cap.snapshot.busAudioEq,
    masterBusDb: cap.snapshot.masterBusDb,
  })
  const { clientSettings, exportMode } = smartCopy.eligible
    ? requested
    : await resolveClientSettings(settings, cap.fps)
  return assembleJob(cap, clientSettings, exportMode, inPoint, outPoint, name)
}

/* ─────────────────────────── Segment generators ─────────────────────────── */

/**
 * Split the window [rangeStart, rangeEnd) at each marker inside it into
 * consecutive ranges. Markers on the bounds (and duplicates) collapse;
 * zero-length ranges are dropped. With no interior markers this returns a
 * single range spanning the whole window.
 */
export function rangesFromMarkers(
  markers: ProjectMarker[],
  rangeStart: number,
  rangeEnd: number,
): FrameRange[] {
  if (rangeEnd <= rangeStart) return []
  const cuts = [
    rangeStart,
    ...markers.map((m) => Math.round(m.frame)).filter((f) => f > rangeStart && f < rangeEnd),
    rangeEnd,
  ]
  const unique = [...new Set(cuts)].sort((a, b) => a - b)
  const ranges: FrameRange[] = []
  for (let i = 0; i < unique.length - 1; i++) {
    const start = unique[i]!
    const end = unique[i + 1]!
    if (end > start) ranges.push({ start, end })
  }
  return ranges
}

/**
 * Split the window [rangeStart, rangeEnd) into fixed-length chunks; the last
 * chunk holds the remainder.
 */
export function rangesFromFixedDuration(
  rangeStart: number,
  rangeEnd: number,
  chunkFrames: number,
): FrameRange[] {
  if (rangeEnd <= rangeStart || chunkFrames <= 0) return []
  const ranges: FrameRange[] = []
  for (let start = rangeStart; start < rangeEnd; start += chunkFrames) {
    ranges.push({ start, end: Math.min(start + chunkFrames, rangeEnd) })
  }
  return ranges
}

/**
 * Build one job per range, sharing a single timeline capture AND a single
 * resolved codec (one WebCodecs probe for the whole batch — not one per
 * segment). Names are provided by `partLabel` with a 0-based index.
 */
export async function buildSegmentJobs(
  settings: ExtendedExportSettings,
  ranges: FrameRange[],
  partLabel: (index: number, range: FrameRange) => string,
  sequence?: ExportableSequence,
): Promise<RenderJob[]> {
  const capture = captureTimeline(sequence)
  const { clientSettings, exportMode } = await resolveClientSettings(settings, capture.fps)
  return ranges.map((range, i) =>
    assembleJob(capture, clientSettings, exportMode, range.start, range.end, partLabel(i, range)),
  )
}
