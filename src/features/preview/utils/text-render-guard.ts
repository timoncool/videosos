import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineTrack } from '@/types/timeline'

function hasVisibleText(track: TimelineTrack): boolean {
  if (!track.visible) return false

  // DOM/CSS is the at-rest reference renderer. Canvas 2D has subtly
  // different baseline metrics and downscale sampling even for plain text,
  // so keep every non-motion text item on the Player while scrubbing.
  return track.items.some((item) => item.type === 'text')
}

function hasVisibleMotionText(track: TimelineTrack): boolean {
  if (!track.visible) return false

  for (const item of track.items) {
    if (item.type !== 'text') continue

    // Motion-text clips animate per-glyph and can only render correctly via
    // the canvas/GPU preview path, so never prefer the Player while one is visible.
    const hasMotion =
      !!item.textMotion && !!(item.textMotion.in || item.textMotion.out || item.textMotion.loop)
    if (hasMotion) return true
  }

  return false
}

/**
 * Whether the preview should render via the DOM Player instead of the 2D-canvas
 * fast-scrub overlay while scrubbing, so text does not shift between the two
 * rasterizers. Even plain text differs subtly in baseline metrics and
 * downscale sampling between DOM/CSS and Canvas 2D.
 *
 * `_keyframes` is retained for call-site compatibility; it no longer affects
 * the result (animation used to gate this, but all static text can diverge).
 */
export function shouldPreferPlayerForStyledTextScrub(
  tracks: TimelineTrack[],
  _keyframes?: ItemKeyframes[],
): boolean {
  if (tracks.some(hasVisibleMotionText)) return false

  return tracks.some(hasVisibleText)
}
