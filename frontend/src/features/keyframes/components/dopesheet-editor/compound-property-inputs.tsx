import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link2, Unlink2 } from 'lucide-react'
import { setPointerCaptureSafely } from './dopesheet-utils'
import { getScrubbedPropertyValue } from './property-value-scrub'

const AXIS_SCRUB_DRAG_THRESHOLD = 2

function AxisInput({
  axis,
  value,
  unit,
  propertyLabel,
  showAxisLabel,
  disabled,
  allowCreateOnBlur,
  onCommit,
  onScrubStart,
  onScrubPreview,
  onScrubEnd,
  onScrubCancel,
  scrubStep,
  decimals = 2,
}: {
  axis: 'x' | 'y'
  value: number
  unit: string
  propertyLabel: string
  showAxisLabel: boolean
  disabled: boolean
  allowCreateOnBlur: boolean
  onCommit: (value: number, options: { allowCreate: boolean }) => boolean | void
  onScrubStart?: () => void
  onScrubPreview?: (value: number) => void
  onScrubEnd?: (value: number) => void
  onScrubCancel?: () => void
  scrubStep?: number
  decimals?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const skipNextBlurCommitRef = useRef(false)
  const [draft, setDraft] = useState(() => value.toFixed(decimals))
  const scrubRef = useRef<{
    pointerId: number
    startX: number
    startValue: number
    lastValue: number
    didDrag: boolean
  } | null>(null)

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(value.toFixed(decimals))
  }, [decimals, value])

  const commit = (allowCreate: boolean) => {
    const parsed = Number(draft)
    if (Number.isFinite(parsed)) {
      const quantized = Number(parsed.toFixed(decimals))
      if (quantized !== value) {
        const applied = onCommit(quantized, { allowCreate })
        if (applied === false) setDraft(value.toFixed(decimals))
        else setDraft(quantized.toFixed(decimals))
      }
    } else setDraft(value.toFixed(decimals))
  }

  return (
    <label
      className={`flex h-5 min-w-0 flex-1 items-center bg-background/85 px-1 text-[9px] ${
        axis === 'y' ? 'border-l border-border/70' : ''
      }`}
    >
      {showAxisLabel ? (
        <span className="mr-1 text-muted-foreground">{axis.toUpperCase()}</span>
      ) : null}
      <input
        ref={inputRef}
        aria-label={`${propertyLabel} ${axis.toUpperCase()}`}
        // Timeline parameter fields are never credentials. Keep password-manager
        // overlays from rescanning this dense surface on every playback mutation.
        autoComplete="off"
        className="min-w-0 flex-1 cursor-ew-resize select-none bg-transparent text-right font-mono text-[9px] tabular-nums outline-none disabled:cursor-default disabled:opacity-50"
        data-bwignore="true"
        disabled={disabled}
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPointerDown={(event) => {
          if (event.button !== 0 || disabled) return
          const startValue = Number(draft)
          if (!Number.isFinite(startValue)) return
          scrubRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startValue,
            lastValue: startValue,
            didDrag: false,
          }
          setPointerCaptureSafely(event.currentTarget, event.pointerId)
        }}
        onPointerMove={(event) => {
          const scrub = scrubRef.current
          if (!scrub || scrub.pointerId !== event.pointerId) return
          const deltaX = event.clientX - scrub.startX
          if (!scrub.didDrag && Math.abs(deltaX) < AXIS_SCRUB_DRAG_THRESHOLD) return
          if (!scrub.didDrag) {
            scrub.didDrag = true
            onScrubStart?.()
          }
          event.preventDefault()
          const next = getScrubbedPropertyValue({
            startValue: scrub.startValue,
            deltaX,
            decimals,
            step: scrubStep,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
          })
          scrub.lastValue = next.value
          setDraft(next.display)
          onScrubPreview?.(next.value)
        }}
        onPointerUp={(event) => {
          const scrub = scrubRef.current
          if (!scrub || scrub.pointerId !== event.pointerId) return
          scrubRef.current = null
          if (!scrub.didDrag) return
          event.preventDefault()
          if (onScrubEnd) onScrubEnd(scrub.lastValue)
          else onCommit(scrub.lastValue, { allowCreate: true })
        }}
        onPointerCancel={(event) => {
          const scrub = scrubRef.current
          if (!scrub || scrub.pointerId !== event.pointerId) return
          scrubRef.current = null
          if (!scrub.didDrag) return
          event.preventDefault()
          setDraft(scrub.startValue.toFixed(decimals))
          onScrubCancel?.()
        }}
        onBlur={() => {
          if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false
            return
          }
          commit(allowCreateOnBlur)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            skipNextBlurCommitRef.current = true
            commit(true)
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            skipNextBlurCommitRef.current = true
            setDraft(value.toFixed(decimals))
            event.currentTarget.blur()
          }
        }}
      />
      <span className="ml-0.5 text-muted-foreground">{unit}</span>
    </label>
  )
}

export interface CompoundPropertyInputConfig {
  label: string
  value: { x: number; y: number }
  /**
   * Optional high-frequency presentation value. Each axis subscribes directly,
   * so a live canvas gesture can refresh these two inputs without re-rendering
   * the parent DopesheetEditor.
   */
  liveValueSource?: CompoundPropertyLiveValueSource
  preExpressionValue?: { x: number; y: number }
  unit: string
  /** Vector2 property exposed by the row's Property Link pick whip. */
  linkProperty?: import('@/types/keyframe').VectorAnimatableProperty
  /** Keeps axis semantics accessible while allowing compact Motion rows to omit visible X/Y. */
  showAxisLabels?: boolean
  linked?: boolean
  disabled?: boolean
  allowCreateOnBlur?: boolean
  axisLink?: {
    linked: boolean
    onChange: (linked: boolean) => void
  }
  onCommit: (axis: 'x' | 'y', value: number, options: { allowCreate: boolean }) => boolean | void
  onScrubStart?: (axis: 'x' | 'y') => void
  onScrubPreview?: (axis: 'x' | 'y', value: number) => void
  onScrubEnd?: (axis: 'x' | 'y', value: number) => void
  onScrubCancel?: (axis: 'x' | 'y') => void
  /** Value change per horizontal pixel. Defaults to the displayed precision. */
  scrubStep?: number
  /** Display and typed-value precision. Position uses 0 for whole pixels. */
  decimals?: number
}

export interface CompoundPropertyLiveValueSource {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => { x: number; y: number } | null
}

const subscribeToNoLiveValue = () => () => {}

function createCompoundAxisCallbacks(config: CompoundPropertyInputConfig, axis: 'x' | 'y') {
  return {
    onCommit: (value: number, options: { allowCreate: boolean }) =>
      config.onCommit(axis, value, options),
    onScrubStart: config.onScrubStart ? () => config.onScrubStart?.(axis) : undefined,
    onScrubPreview: config.onScrubPreview
      ? (value: number) => config.onScrubPreview?.(axis, value)
      : undefined,
    onScrubEnd: config.onScrubEnd ? (value: number) => config.onScrubEnd?.(axis, value) : undefined,
    onScrubCancel: config.onScrubCancel ? () => config.onScrubCancel?.(axis) : undefined,
  }
}

function CompoundAxisInput({
  axis,
  config,
}: {
  axis: 'x' | 'y'
  config: CompoundPropertyInputConfig
}) {
  const source = config.liveValueSource
  const getAxisSnapshot = useCallback(
    () => source?.getSnapshot()?.[axis] ?? config.value[axis],
    [axis, config.value, source],
  )
  const value = useSyncExternalStore(
    source?.subscribe ?? subscribeToNoLiveValue,
    getAxisSnapshot,
    getAxisSnapshot,
  )

  return (
    <AxisInput
      axis={axis}
      value={value}
      unit={config.unit}
      propertyLabel={config.label}
      showAxisLabel={config.showAxisLabels ?? true}
      disabled={config.disabled ?? false}
      allowCreateOnBlur={config.allowCreateOnBlur ?? false}
      {...createCompoundAxisCallbacks(config, axis)}
      scrubStep={config.scrubStep}
      decimals={config.decimals}
    />
  )
}

export function CompoundPropertyInputs({
  config,
  spacious = false,
}: {
  config: CompoundPropertyInputConfig
  spacious?: boolean
}) {
  return (
    <div
      className={`flex shrink-0 items-center overflow-hidden rounded-sm border border-border/70 ${
        spacious ? 'w-[192px]' : 'w-[132px]'
      } ${config.linked ? 'border-orange-500/50 text-orange-400' : ''}`}
      data-testid="compound-property-inputs"
    >
      {config.axisLink ? (
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center border-r border-border/70 text-muted-foreground hover:text-foreground"
          aria-label={
            config.axisLink.linked ? `Unlink ${config.label} axes` : `Link ${config.label} axes`
          }
          aria-pressed={config.axisLink.linked}
          onClick={() => config.axisLink?.onChange(!config.axisLink.linked)}
        >
          {config.axisLink.linked ? (
            <Link2 className="h-2.5 w-2.5" />
          ) : (
            <Unlink2 className="h-2.5 w-2.5" />
          )}
        </button>
      ) : spacious ? (
        <span
          aria-hidden="true"
          className="h-5 w-5 shrink-0 border-r border-border/70"
          data-testid="compound-property-axis-link-spacer"
        />
      ) : null}
      <CompoundAxisInput axis="x" config={config} />
      <CompoundAxisInput axis="y" config={config} />
    </div>
  )
}
