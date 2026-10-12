/**
 * Memoized timeline (keyframe-grid) cells for the dopesheet.
 *
 * These render the heavy, *frame-independent* part of each row — ticks,
 * keyframe diamonds, transition-blocked regions and drag-preview ghosts. They
 * are split out of the main editor so that moving the playhead (which only
 * changes the property-column controls and the playhead line) does not force a
 * full re-render of every keyframe button. All props are referentially stable
 * across scrubs, so `React.memo` skips these subtrees entirely while scrubbing.
 */
import { memo } from 'react'
import type { CSSProperties, MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/ui/cn'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import type { BlockedFrameRange } from '../../utils/transition-region'
import type { ProceduralBand } from '@/features/keyframes/utils/procedural-preview'
import { getKeyframeGroupLabel } from '@/features/keyframes/utils/property-i18n'
import { getDisplayedGroupFrameGroups } from './sheet-preview-frame-groups'
import type { DopesheetPropertyGroupStructure } from './dopesheet-helpers'
import type { KeyframeMeta } from './dopesheet-types'
import { KEYFRAME_DIAMOND_SIDE_PX, KEYFRAME_EDGE_INSET } from './layout'
import { SegmentEasingPopover, type SegmentEasingChange } from './segment-easing-popover'
import { buildSegmentSpans } from './segment-spans'

type FrameGroup = DopesheetPropertyGroupStructure['frameGroups'][number]
type StructureRow = { property: AnimatableProperty; keyframes: Keyframe[] }

function getTimelineGridLineStyle(
  ticks: number[],
  frameToX: (frame: number) => number,
): CSSProperties {
  const positions = ticks.map((frame) => Math.round(frameToX(frame)))
  const left = positions[0] ?? 0
  return {
    left,
    boxShadow: positions
      .slice(1)
      .map((position) => `${position - left}px 0 currentColor`)
      .join(', '),
  }
}

interface ConnectorSegment {
  key: string
  fromKeyframeId: string
  toKeyframeId: string
  fromFrame: number
  toFrame: number
  left: number
  width: number
  /** True when the value is held across the span (no interpolation). */
  held: boolean
}

/**
 * Build the horizontal segments drawn between consecutive keyframes. A segment
 * communicates that a property is *animating* across that span; a `held`
 * segment (the `from` keyframe uses `hold` easing) is dashed to show the value
 * is parked until the next keyframe.
 */
function buildConnectorSegments(
  points: Array<{ id: string; frame: number; x: number; held: boolean }>,
): ConnectorSegment[] {
  const sorted = [...points].sort((a, b) => a.frame - b.frame)
  return sorted.flatMap((point, index) => {
    const next = sorted[index + 1]
    if (!next) return []
    const left = Math.min(point.x, next.x)
    const width = Math.abs(next.x - point.x)
    if (width <= 0) return []
    return [
      {
        key: point.id,
        fromKeyframeId: point.id,
        toKeyframeId: next.id,
        fromFrame: point.frame,
        toFrame: next.frame,
        left,
        width,
        held: point.held,
      },
    ]
  })
}

function KeyframeConnectors({
  itemId,
  segments,
}: {
  itemId: string
  segments: ConnectorSegment[]
}) {
  return segments.map((segment) => (
    <div
      key={segment.key}
      data-testid="keyframe-connector"
      data-motion-item-id={itemId}
      data-motion-connector-from-keyframe-id={segment.fromKeyframeId}
      data-motion-connector-to-keyframe-id={segment.toKeyframeId}
      data-dopesheet-from-frame={segment.fromFrame}
      data-dopesheet-to-frame={segment.toFrame}
      className={cn(
        'pointer-events-none absolute z-0 -translate-y-1/2',
        segment.held ? 'border-t border-dashed border-neutral-500/50' : 'h-px bg-neutral-400/50',
      )}
      style={{ left: segment.left, width: segment.width, top: '50%' }}
    />
  ))
}

// Hatched fill marks a span as generated/procedural (distinct from solid
// connector lines and diamonds).
const PROCEDURAL_HATCH =
  'repeating-linear-gradient(45deg, rgba(56,189,248,0.25) 0 2px, transparent 2px 5px)'

/**
 * A non-keyframe band marking that a property is driven by a procedural motion
 * generator over a frame range. Sky-tinted to match the timeline Waves cue.
 */
function ProceduralBandView({
  band,
  frameToX,
  title,
}: {
  band: ProceduralBand
  frameToX: (frame: number) => number
  title: string
}) {
  const left = frameToX(band.fromFrame)
  const width = Math.max(3, frameToX(band.toFrame) - left)
  return (
    <div
      data-testid={`procedural-band-${band.property}`}
      data-from-frame={band.fromFrame}
      data-to-frame={band.toFrame}
      data-dopesheet-from-frame={band.fromFrame}
      data-dopesheet-to-frame={band.toFrame}
      data-dopesheet-min-width={3}
      className="pointer-events-none absolute top-1/2 z-0 h-2 -translate-y-1/2 overflow-hidden rounded-sm border border-sky-400/40 bg-sky-400/10"
      style={{ left, width, backgroundImage: PROCEDURAL_HATCH }}
      title={title}
    />
  )
}

interface GroupTimelineCellProps {
  groupId: string
  groupLabel: string
  expanded: boolean
  /** Stable, frame-independent grouped keyframes. */
  frameGroups: FrameGroup[]
  /** Stable structural rows (used for drag-preview frame remapping). */
  rows: StructureRow[]
  ticks: number[]
  axisWidth: number
  frameToX: (frame: number) => number
  gridFrameToX?: (frame: number) => number
  getRenderedKeyframeX: (frame: number) => number | null
  selectedKeyframeIds: Set<string>
  disabled: boolean
  isPropertyLocked: (property: AnimatableProperty) => boolean
  onGroupKeyframePointerDown: (
    frameGroup: FrameGroup,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void
  onBackgroundPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  sheetPreviewFrames: Record<string, number> | null
  sheetPreviewDuplicateKeyframeIds: string[] | null
}

export const GroupTimelineCell = memo(function GroupTimelineCell({
  groupId,
  groupLabel,
  expanded,
  frameGroups,
  rows,
  ticks,
  axisWidth,
  frameToX,
  gridFrameToX = frameToX,
  getRenderedKeyframeX,
  selectedKeyframeIds,
  disabled,
  isPropertyLocked,
  onGroupKeyframePointerDown,
  onBackgroundPointerDown,
  sheetPreviewFrames,
  sheetPreviewDuplicateKeyframeIds,
}: GroupTimelineCellProps) {
  const { t } = useTranslation()
  const displayedFrameGroups = getDisplayedGroupFrameGroups({
    group: { rows, frameGroups },
    sheetPreviewFrames,
    sheetPreviewDuplicateKeyframeIds,
  })
  const renderedFrameGroups = sheetPreviewDuplicateKeyframeIds ? frameGroups : displayedFrameGroups

  return (
    <div
      className="relative h-full border-l border-border/60 bg-muted/20 overflow-hidden"
      onPointerDown={onBackgroundPointerDown}
    >
      <div
        data-motion-viewport-surface
        data-motion-viewport-edge-inset={KEYFRAME_EDGE_INSET}
        data-motion-viewport-axis-width={axisWidth}
        className="absolute inset-0"
      >
        <div
          aria-hidden
          data-motion-grid-frames={ticks.join(',')}
          className="pointer-events-none absolute inset-y-0 w-px bg-current text-border/30"
          style={getTimelineGridLineStyle(ticks, gridFrameToX)}
        />

        <div data-motion-span-drag-visual className="absolute inset-0">
          {!expanded &&
            renderedFrameGroups.map((frameGroup) => {
              const renderedX = getRenderedKeyframeX(frameGroup.frame) ?? frameToX(frameGroup.frame)

              const movableEntries = frameGroup.keyframes.filter(
                ({ property }) => !isPropertyLocked(property),
              )
              const isSelected = movableEntries.some(({ keyframe }) =>
                selectedKeyframeIds.has(keyframe.id),
              )

              return (
                <button
                  key={`${groupId}-${frameGroup.frame}`}
                  type="button"
                  data-testid={`group-keyframe-${groupId}-${frameGroup.frame}`}
                  data-dopesheet-frame={frameGroup.frame}
                  className={cn(
                    'group absolute z-10 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center',
                    movableEntries.length > 0 && 'cursor-grab active:cursor-grabbing',
                    movableEntries.length === 0 && 'cursor-not-allowed opacity-50',
                  )}
                  style={{
                    left: renderedX,
                    top: '50%',
                  }}
                  disabled={movableEntries.length === 0 || disabled}
                  onPointerDown={(event) => onGroupKeyframePointerDown(frameGroup, event)}
                  onClick={(event) => event.stopPropagation()}
                  title={t('timeline.keyframeEditor.keyframeMarker.groupLabel', {
                    group: getKeyframeGroupLabel(t, groupId, groupLabel),
                    frame: frameGroup.frame,
                  })}
                  aria-label={t('timeline.keyframeEditor.keyframeMarker.groupLabel', {
                    group: getKeyframeGroupLabel(t, groupId, groupLabel),
                    frame: frameGroup.frame,
                  })}
                >
                  <span
                    className={cn(
                      'pointer-events-none block rotate-45 border transition-colors',
                      isSelected
                        ? 'border-blue-100 bg-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.45)]'
                        : 'border-transparent bg-neutral-200 group-hover:bg-white',
                    )}
                    style={{
                      width: KEYFRAME_DIAMOND_SIDE_PX,
                      height: KEYFRAME_DIAMOND_SIDE_PX,
                    }}
                  />
                </button>
              )
            })}
          {!expanded &&
            sheetPreviewDuplicateKeyframeIds &&
            displayedFrameGroups.map((frameGroup) => {
              const renderedX = getRenderedKeyframeX(frameGroup.frame) ?? frameToX(frameGroup.frame)

              return (
                <div
                  key={`preview-${groupId}-${frameGroup.frame}`}
                  data-dopesheet-frame={frameGroup.frame}
                  className="absolute z-20 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center pointer-events-none"
                  style={{
                    left: renderedX,
                    top: '50%',
                  }}
                >
                  <span
                    className="block rotate-45 border border-primary/70 bg-primary/70 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]"
                    style={{
                      width: KEYFRAME_DIAMOND_SIDE_PX,
                      height: KEYFRAME_DIAMOND_SIDE_PX,
                    }}
                  />
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
})

interface PropertyTimelineCellProps {
  itemId: string
  property: AnimatableProperty
  /** Stable, frame-independent sorted keyframes for this property. */
  keyframes: Keyframe[]
  locked: boolean
  ticks: number[]
  axisWidth: number
  frameToX: (frame: number) => number
  gridFrameToX?: (frame: number) => number
  getRenderedKeyframeX: (frame: number) => number | null
  renderedKeyframeXById: Map<string, number>
  transitionBlockedRanges: BlockedFrameRange[]
  /** Procedural generator band for this property (when not keyframed). */
  proceduralBand?: ProceduralBand
  selectedKeyframeIds: Set<string>
  disabled: boolean
  onRowPointerDown: (
    property: AnimatableProperty,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void
  onKeyframePointerDown: (
    property: AnimatableProperty,
    keyframeId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void
  onSegmentEasingChange?: SegmentEasingChange
  onSegmentDragStart?: () => void
  onSegmentDragEnd?: () => void
  setKeyframeButtonRef: (keyframeId: string, node: HTMLButtonElement | null) => void
  keyframeMetaByIdRef: MutableRefObject<Map<string, KeyframeMeta>>
  sheetPreviewFrames: Record<string, number> | null
  sheetPreviewDuplicateKeyframeIds: string[] | null
}

export const PropertyTimelineCell = memo(function PropertyTimelineCell({
  itemId,
  property,
  keyframes,
  locked,
  ticks,
  axisWidth,
  frameToX,
  gridFrameToX = frameToX,
  getRenderedKeyframeX,
  renderedKeyframeXById,
  transitionBlockedRanges,
  proceduralBand,
  selectedKeyframeIds,
  disabled,
  onRowPointerDown,
  onKeyframePointerDown,
  onSegmentEasingChange,
  onSegmentDragStart,
  onSegmentDragEnd,
  setKeyframeButtonRef,
  keyframeMetaByIdRef,
  sheetPreviewFrames,
  sheetPreviewDuplicateKeyframeIds,
}: PropertyTimelineCellProps) {
  const { t } = useTranslation()

  // During a plain (non-duplicate) drag preview, place this row's keyframes — and
  // the connectors and easing bands between them — at their previewed frames, so
  // the whole row tracks a master/keyframe drag in realtime instead of only the
  // diamonds moving. Duplicate-drag keeps the originals put (the ghost overlay
  // below shows the moved copies), matching the group cell's behaviour.
  const previewFrames = sheetPreviewDuplicateKeyframeIds ? null : sheetPreviewFrames
  const displayedFrame = (keyframe: Keyframe) => previewFrames?.[keyframe.id] ?? keyframe.frame
  const xForKeyframe = (keyframe: Keyframe): number | null => {
    const previewFrame = previewFrames?.[keyframe.id]
    if (previewFrame !== undefined) {
      return getRenderedKeyframeX(previewFrame) ?? frameToX(previewFrame)
    }
    return renderedKeyframeXById.get(keyframe.id) ?? frameToX(keyframe.frame)
  }
  const xForSegmentKeyframe = (keyframe: Keyframe): number => frameToX(displayedFrame(keyframe))

  const connectorSegments = buildConnectorSegments(
    keyframes.map((keyframe) => ({
      id: keyframe.id,
      frame: displayedFrame(keyframe),
      x: xForSegmentKeyframe(keyframe),
      held: keyframe.easing === 'hold',
    })),
  )

  // Clickable easing spans between consecutive keyframes (skipped while locked or
  // during a duplicate-drag preview, which owns pointer interaction on this row).
  const segmentSpans =
    onSegmentEasingChange && !locked && !disabled && !sheetPreviewDuplicateKeyframeIds
      ? buildSegmentSpans(
          keyframes.map((keyframe) => ({
            from: keyframe,
            frame: displayedFrame(keyframe),
            x: xForSegmentKeyframe(keyframe),
          })),
        )
      : []

  return (
    <div
      className="relative h-full border-l border-border/60 overflow-hidden"
      onPointerDown={(event) => onRowPointerDown(property, event)}
    >
      <div
        data-motion-viewport-surface
        data-motion-viewport-edge-inset={KEYFRAME_EDGE_INSET}
        data-motion-viewport-axis-width={axisWidth}
        className="absolute inset-0"
      >
        <div
          aria-hidden
          data-motion-grid-frames={ticks.join(',')}
          className="pointer-events-none absolute inset-y-0 w-px bg-current text-border/30"
          style={getTimelineGridLineStyle(ticks, gridFrameToX)}
        />

        {transitionBlockedRanges.map((range, index) => (
          <div
            key={`${property}-${index}-${range.start}-${range.end}`}
            data-dopesheet-from-frame={range.start}
            data-dopesheet-to-frame={range.end}
            className="absolute inset-y-0 bg-destructive/10 border-x border-destructive/20 pointer-events-none"
            style={{
              left: frameToX(range.start),
              width: frameToX(range.end) - frameToX(range.start),
            }}
          />
        ))}

        <div data-motion-span-drag-visual className="absolute inset-0">
          {proceduralBand && (
            <ProceduralBandView
              band={proceduralBand}
              frameToX={frameToX}
              title={t('timeline.keyframeEditor.proceduralBand')}
            />
          )}

          <KeyframeConnectors itemId={itemId} segments={connectorSegments} />

          {onSegmentEasingChange &&
            segmentSpans.map((span) => (
              <SegmentEasingPopover
                key={`seg-${span.from.id}`}
                left={span.left}
                width={span.width}
                fromFrame={span.fromFrame}
                toFrame={span.toFrame}
                refs={[{ itemId, property, keyframeId: span.from.id }]}
                easing={span.from.easing}
                easingConfig={span.from.easingConfig}
                held={span.from.easing === 'hold'}
                onChange={onSegmentEasingChange}
                onDragStart={onSegmentDragStart}
                onDragEnd={onSegmentDragEnd}
              />
            ))}

          {keyframes.map((keyframe) => {
            const renderedX = xForKeyframe(keyframe)
            if (renderedX === null) return null
            const selected = selectedKeyframeIds.has(keyframe.id)
            return (
              <button
                key={keyframe.id}
                ref={(node) => setKeyframeButtonRef(keyframe.id, node)}
                type="button"
                data-testid={`row-keyframe-${property}-${keyframe.id}`}
                data-motion-item-id={itemId}
                data-motion-keyframe-id={keyframe.id}
                data-dopesheet-frame={displayedFrame(keyframe)}
                className={cn(
                  'group absolute z-10 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center',
                  !locked && 'cursor-grab active:cursor-grabbing',
                  locked && 'cursor-not-allowed opacity-50',
                )}
                style={{
                  left: renderedX,
                  top: '50%',
                }}
                disabled={locked || disabled}
                onPointerDown={(event) => onKeyframePointerDown(property, keyframe.id, event)}
                onClick={(event) => event.stopPropagation()}
                title={
                  locked
                    ? t('timeline.keyframeEditor.keyframeMarker.locked', {
                        frame: keyframe.frame,
                      })
                    : t('timeline.keyframeEditor.keyframeMarker.rowLabel', {
                        frame: keyframe.frame,
                      })
                }
                aria-label={
                  locked
                    ? t('timeline.keyframeEditor.keyframeMarker.locked', {
                        frame: keyframe.frame,
                      })
                    : t('timeline.keyframeEditor.keyframeMarker.rowLabel', {
                        frame: keyframe.frame,
                      })
                }
              >
                <span
                  className={cn(
                    'pointer-events-none block rotate-45 border transition-colors group-data-[marquee-selected=true]:!border-blue-100 group-data-[marquee-selected=true]:!bg-blue-500 group-data-[marquee-selected=true]:!shadow-[0_0_0_1px_rgba(59,130,246,0.45)] group-data-[marquee-selected=false]:!border-transparent group-data-[marquee-selected=false]:!bg-neutral-200 group-data-[marquee-selected=false]:!shadow-none',
                    selected
                      ? 'border-blue-100 bg-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.45)]'
                      : 'border-transparent bg-neutral-200 group-hover:bg-white',
                  )}
                  style={{
                    width: KEYFRAME_DIAMOND_SIDE_PX,
                    height: KEYFRAME_DIAMOND_SIDE_PX,
                  }}
                />
              </button>
            )
          })}
          {sheetPreviewDuplicateKeyframeIds?.flatMap((keyframeId) => {
            const meta = keyframeMetaByIdRef.current.get(keyframeId)
            if (!meta || meta.property !== property) {
              return []
            }

            const previewFrame = sheetPreviewFrames?.[keyframeId]
            if (previewFrame === undefined) {
              return []
            }

            const renderedX = getRenderedKeyframeX(previewFrame) ?? frameToX(previewFrame)

            return [
              <div
                key={`preview-${property}-${keyframeId}`}
                data-dopesheet-frame={previewFrame}
                className="absolute z-20 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center pointer-events-none"
                style={{
                  left: renderedX,
                  top: '50%',
                }}
              >
                <span
                  className="block rotate-45 border border-primary/70 bg-primary/70 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]"
                  style={{
                    width: KEYFRAME_DIAMOND_SIDE_PX,
                    height: KEYFRAME_DIAMOND_SIDE_PX,
                  }}
                />
              </div>,
            ]
          })}
        </div>
      </div>
    </div>
  )
})
