import type { AnimatableProperty } from '@/types/keyframe'

/** Default standalone/Motion dopesheet column width. Edit supplies its linked
 * timeline column width explicitly so both time axes keep the same origin. */
export const PROPERTY_COLUMN_WIDTH = 248
/** Wider property column for the Motion surface (`spacious`), where coupled
 *  Vector2 fields need enough room for both values, units, and key controls. */
export const SPACIOUS_PROPERTY_COLUMN_WIDTH = 348
export const MIN_VISIBLE_FRAMES = 20
export const SNAP_THRESHOLD_PX = 8
export const GROUP_HEADER_HEIGHT = 22
export const ROW_HEIGHT = 30
export const RULER_HEIGHT = 22
export const ZOOM_IN_FACTOR = 0.8
export const ZOOM_OUT_FACTOR = 1.25
export const DRAG_THRESHOLD = 2
export const MARQUEE_SCROLL_EDGE_PX = 24
export const MARQUEE_SCROLL_MAX_SPEED = 16
export const EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY: Partial<Record<AnimatableProperty, boolean>> = {}
export const MINI_ICON_BUTTON_CLASS = 'h-5 w-5 flex-shrink-0 rounded-sm p-0 leading-none'
export const MINI_ICON_CLASS = 'h-[10px] w-[10px]'
export const GRAPH_VISIBLE_PROPERTIES_STORAGE_KEY = 'timeline:keyframeGraphVisibleProperties'
