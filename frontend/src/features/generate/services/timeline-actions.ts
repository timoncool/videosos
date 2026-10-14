/**
 * Putting results on the timeline of the open project through the same edit
 * operations the headless editor and the agent bridge run, so a placed clip
 * is an ordinary undoable edit.
 */

import { applyOp } from '@/headless/edit-ops'
import { setEditCanvas } from '@/headless/edit-op-support'
import { usePlaybackStore } from '@/shared/state/playback'
import { useProjectStore } from '../deps/editor'

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
  return applyOp({ op: 'addClip', mediaId, from: Math.round(seconds * fps), keepFrom: true })
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
