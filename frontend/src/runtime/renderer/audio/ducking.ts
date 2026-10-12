/**
 * Sidechain ducking: while a duck-source item is audible, other audio is
 * attenuated by its `duckOthersDb` with attack/release ramps. Applied as a
 * third per-segment gain layer (after volume/fades, before the additive mix),
 * so the source itself and out-of-scope tracks stay untouched.
 */

import type { CompositionInputProps } from '@/types/export'
import type { AudioDuckingSettings, AudioItem, CompositionItem } from '@/types/timeline'
import { useCompositionsStore } from '@/runtime/renderer/deps/timeline-compositions-contract'
import { isCompositionAudioItem } from '@/shared/utils/linked-media'
import {
  buildNestedWrapper,
  mapNestedItemWindow,
  resolveCompositionWrapper,
} from './nested-composition'
import { dbToGain } from './dsp'

const DUCKING_DEFAULT_ATTACK_SEC = 0.08

const DUCKING_DEFAULT_RELEASE_SEC = 0.25

export interface DuckingSource {
  itemId: string
  trackId: string
  /** Audible span on the timeline, in project frames. */
  startFrame: number
  endFrame: number
  /** Attenuation while audible, dB (negative). */
  duckDb: number
  attackFrames: number
  releaseFrames: number
  /** Restrict ducking to these tracks (default: every other track). */
  targetTrackIds?: string[]
}

type DuckSourceCandidate = CompositionInputProps['tracks'][number]['items'][number] & {
  audioDucking?: AudioDuckingSettings
  embeddedAudioMuted?: boolean
}

/** Map one item to a duck source, or null when it cannot duck anything. */
function duckingSourceFromItem(
  item: DuckSourceCandidate,
  trackId: string,
  fps: number,
  /** Parent-timeline window, for items reached through a pre-composition. */
  window?: { startFrame: number; endFrame: number },
): DuckingSource | null {
  const ducking = item.audioDucking
  if (!ducking || !(ducking.duckOthersDb < 0)) return null
  const carriesAudio = item.type === 'audio' || (item.type === 'video' && !item.embeddedAudioMuted)
  if (!carriesAudio) return null
  return {
    itemId: item.id,
    trackId,
    startFrame: window?.startFrame ?? item.from,
    endFrame: window?.endFrame ?? item.from + item.durationInFrames,
    duckDb: ducking.duckOthersDb,
    attackFrames: (ducking.attackSec ?? DUCKING_DEFAULT_ATTACK_SEC) * fps,
    releaseFrames: (ducking.releaseSec ?? DUCKING_DEFAULT_RELEASE_SEC) * fps,
    ...(ducking.targetTrackIds ? { targetTrackIds: ducking.targetTrackIds } : {}),
  }
}

/**
 * Collect duck sources nested inside a pre-composition, in PARENT timeline frames.
 *
 * The mix expands nested composition audio, so a source living one level down is
 * audible; scanning only the root tracks would leave it audible but not ducking,
 * making the same arrangement sound different at root level and inside a
 * pre-comp. The window mapping is shared with `appendCompositionAudioSegments`
 * so the two cannot disagree about where a nested item sits.
 */
function collectNestedDuckingSources(
  compositionItem: CompositionItem | (AudioItem & { compositionId: string }),
  rootTrackId: string,
  fps: number,
  visited: ReadonlySet<string>,
): DuckingSource[] {
  if (visited.has(compositionItem.compositionId)) return []
  const subComp = useCompositionsStore.getState().getComposition(compositionItem.compositionId)
  if (!subComp) return []

  const wrapper = resolveCompositionWrapper(compositionItem, fps)
  const nestedVisited = new Set(visited)
  nestedVisited.add(compositionItem.compositionId)

  const sources: DuckingSource[] = []
  for (const subItem of subComp.items) {
    const subTrack = subComp.tracks.find((candidate) => candidate.id === subItem.trackId)
    // Only `muted` silences a nested track — the expansion above ignores `visible`,
    // so excluding hidden tracks here would leave audible sources not ducking.
    if (subTrack?.muted === true) continue

    const window = mapNestedItemWindow(subItem, wrapper, fps)
    if (!window) continue

    if (subItem.type === 'composition' || isCompositionAudioItem(subItem)) {
      // A composition-backed AudioItem can carry `audioDucking` of its own, and it
      // is audible in its own right — collect it as well as descending.
      const wrapperSource = duckingSourceFromItem(
        subItem as DuckSourceCandidate,
        rootTrackId,
        fps,
        { startFrame: window.effectiveStart, endFrame: window.effectiveEnd },
      )
      if (wrapperSource) sources.push(wrapperSource)
      sources.push(
        ...collectNestedDuckingSources(
          buildNestedWrapper(subItem, window, wrapper),
          rootTrackId,
          fps,
          nestedVisited,
        ),
      )
      continue
    }

    // Nested sources belong to the ROOT track: that is the track their audio is
    // mixed onto, so it is also what "never duck yourself" must compare against.
    const source = duckingSourceFromItem(subItem as DuckSourceCandidate, rootTrackId, fps, {
      startFrame: window.effectiveStart,
      endFrame: window.effectiveEnd,
    })
    if (source) sources.push(source)
  }
  return sources
}

/** Collect duck-source windows from composition items carrying `audioDucking`. */
export function collectDuckingSources(
  composition: CompositionInputProps,
  fps: number,
): DuckingSource[] {
  return composition.tracks
    .filter((track) => track.visible !== false && track.muted !== true)
    .flatMap((track) =>
      (track.items ?? []).flatMap((item) => {
        // The item's own `audioDucking` counts even when it is a composition
        // wrapper — it is audible in its own right — so collect it either way
        // and additionally descend when it wraps a pre-comp.
        const own = duckingSourceFromItem(item as DuckSourceCandidate, track.id, fps)
        const sources = own ? [own] : []
        if (item.type === 'composition' || isCompositionAudioItem(item)) {
          sources.push(
            ...collectNestedDuckingSources(
              item as CompositionItem | (AudioItem & { compositionId: string }),
              track.id,
              fps,
              new Set<string>(),
            ),
          )
        }
        return sources
      }),
    )
}

/** Piecewise duck gain of one source at a timeline frame, in dB (0 = no duck). */
function duckingSourceGainDb(frame: number, source: DuckingSource): number {
  if (frame < source.startFrame || frame > source.endFrame + source.releaseFrames) return 0
  if (frame < source.startFrame + source.attackFrames) {
    const progress = (frame - source.startFrame) / source.attackFrames
    return source.duckDb * progress
  }
  if (frame <= source.endFrame) return source.duckDb
  const progress = (frame - source.endFrame) / source.releaseFrames
  return source.duckDb * (1 - progress)
}

/**
 * Multiply the ducking envelope into one channel of a target segment.
 * `segmentStartFrame` is the absolute timeline frame of `samples[0]` (same
 * mapping as `applyAnimatedVolume`). The source item never ducks itself;
 * overlapping sources take the deepest (minimum dB) gain.
 */
export function applyDucking(
  samples: Float32Array,
  sources: readonly DuckingSource[],
  segment: { itemId: string; trackId: string },
  segmentStartFrame: number,
  fps: number,
  sampleRate: number,
): Float32Array {
  const spanFrames = (samples.length / sampleRate) * fps
  const applicable = sources.filter(
    (source) =>
      source.itemId !== segment.itemId &&
      (!source.targetTrackIds || source.targetTrackIds.includes(segment.trackId)) &&
      source.startFrame < segmentStartFrame + spanFrames &&
      source.endFrame + source.releaseFrames > segmentStartFrame,
  )
  if (applicable.length === 0) return samples

  const output = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const frame = segmentStartFrame + (i / sampleRate) * fps
    let db = 0
    for (const source of applicable) {
      const sourceDb = duckingSourceGainDb(frame, source)
      if (sourceDb < db) db = sourceDb
    }
    output[i] = db === 0 ? samples[i]! : samples[i]! * dbToGain(db)
  }
  return output
}
