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

/** Text as a text item at the playhead, five seconds long. */
export function placeTextAtPlayhead(text: string): unknown {
  syncCanvas()
  const fps = useProjectStore.getState().currentProject?.metadata?.fps ?? 30
  const from = usePlaybackStore.getState().currentFrame
  return applyOp({ op: 'addText', text, from, durationInFrames: Math.round(fps * 5) })
}
