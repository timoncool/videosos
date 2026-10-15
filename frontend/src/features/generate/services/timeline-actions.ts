/**
 * Putting results on the timeline of the open project through the same edit
 * operations the headless editor and the agent bridge run, so a placed clip
 * is an ordinary undoable edit.
 */

import { applyOp } from '@/headless/edit-ops'
import { asOneStep, requireItem, setEditCanvas } from '@/headless/edit-op-support'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useProjectStore } from '../deps/editor'
import type { SpeechEdges } from './speech-edges'

function syncCanvas(): void {
  const metadata = useProjectStore.getState().currentProject?.metadata
  setEditCanvas({
    width: metadata?.width ?? 1920,
    height: metadata?.height ?? 1080,
    fps: metadata?.fps ?? 30,
  })
}

/** A media item of the library as a clip at the playhead. */
export function placeMediaAtPlayhead(mediaId: string): unknown {
  syncCanvas()
  const from = usePlaybackStore.getState().currentFrame
  return applyOp({ op: 'addClip', mediaId, from })
}

/**
 * A media item of the library as a clip at a moment of the timeline, in seconds, on a track free there so it is
 * not pushed along; at the playhead without one.
 */
export function placeMediaAt(mediaId: string, seconds: number | null): unknown {
  if (seconds === null) return placeMediaAtPlayhead(mediaId)
  syncCanvas()
  const fps = useProjectStore.getState().currentProject?.metadata?.fps ?? 30
  const result = applyOp({
    op: 'addClip',
    mediaId,
    from: Math.round(seconds * fps),
    keepFrom: true,
  }) as { created?: Array<{ trackId: string }> }
  const trackId = result.created?.[0]?.trackId
  // the timeline scrolls its track list to the active track, so a clip on a new track at the top is in view
  if (trackId) useSelectionStore.getState().setActiveTrack(trackId)
  return result
}

/**
 * A voice-over placed as placeMediaAt places it, with the silence before and after its speech trimmed off the
 * clip, as Dub Studio's voice-overs are; the file keeps it, so pulling the edges back brings it again.
 */
export function placeSpeechAt(
  mediaId: string,
  seconds: number | null,
  edges: SpeechEdges,
): unknown {
  return asOneStep('PLACE_VOICE_OVER', () => placeTrimmed(mediaId, seconds, edges))
}

function placeTrimmed(mediaId: string, seconds: number | null, edges: SpeechEdges): unknown {
  const result = placeMediaAt(mediaId, seconds) as { created?: Array<{ id: string }> }
  const clip = result.created?.[0]
  if (!clip) return result
  const fps = useProjectStore.getState().currentProject?.metadata?.fps ?? 30
  const lead = Math.floor(edges.leadSeconds * fps)
  const tail = Math.floor(edges.tailSeconds * fps)
  const from = requireItem(clip.id).from
  if (lead > 0) {
    applyOp({ op: 'trimStart', id: clip.id, amount: lead })
    applyOp({ op: 'moveItem', id: clip.id, from })
  }
  if (tail > 0) applyOp({ op: 'trimEnd', id: clip.id, amount: -tail })
  return result
}

/** Another take of a clip's request in its place, as an ordinary undoable edit. */
export function replaceClipMedia(clipId: string, mediaId: string): unknown {
  syncCanvas()
  return applyOp({ op: 'replaceMedia', id: clipId, mediaId })
}

/** The playhead in seconds, where a run asked for now lands. */
export function playheadSeconds(): number {
  const fps = useProjectStore.getState().currentProject?.metadata?.fps ?? 30
  return usePlaybackStore.getState().currentFrame / fps
}

/** Text as a text item at the playhead, five seconds long. */
export function placeTextAtPlayhead(text: string): unknown {
  syncCanvas()
  const fps = useProjectStore.getState().currentProject?.metadata?.fps ?? 30
  const from = usePlaybackStore.getState().currentFrame
  return applyOp({ op: 'addText', text, from, durationInFrames: Math.round(fps * 5) })
}
