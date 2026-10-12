import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { applyEasingConfig } from '@/shared/utils/easing'
import {
  DEFAULT_SPRING_PARAMS,
  type BezierControlPoints,
  type EasingConfig,
  type EasingType,
  type SpringParameters,
} from '@/types/keyframe'

import { effectiveBezier } from './easings-dev-presets'

/**
 * The easing editor, adapted from easings.dev: a curve canvas on the left, and
 * parameter slider+number rows plus a `Duration` row and a moving-dot Position
 * Preview on the right. For a cubic-bezier easing the rows are `x1 / y1 / x2 /
 * y2`; for a spring they are `tension / friction / mass`. Both the canvas and
 * the preview evaluate the real `EasingConfig`, so a spring shows its actual
 * bounce (not the linear diagonal a spring collapses to as a bezier).
 *
 * `Duration` drives only the preview playback (it is not stored on the keyframe
 * — a segment's real duration is the gap between its two keyframes).
 */

type BezierKey = keyof BezierControlPoints

const BEZIER_INPUT_KEYS = ['x1', 'y1', 'x2', 'y2'] as const
const SPRING_INPUT_KEYS = ['tension', 'friction', 'mass'] as const
type SpringKey = (typeof SPRING_INPUT_KEYS)[number]

// Spring params are user-facing words (unlike the bezier x1/y1 math notation),
// so they're translated. Fallbacks keep the labels working before locales load.
const SPRING_LABEL: Record<SpringKey, { key: string; fallback: string }> = {
  tension: { key: 'timeline.keyframeEditor.springTension', fallback: 'Tension' },
  friction: { key: 'timeline.keyframeEditor.springFriction', fallback: 'Friction' },
  mass: { key: 'timeline.keyframeEditor.springMass', fallback: 'Mass' },
}

// Canvas geometry (px). Vertical headroom shows overshoot/anticipation.
const SIZE = 176
const PAD = 16
const PLOT = SIZE - PAD * 2
const Y_MIN = -0.7
const Y_MAX = 1.7

const xToPx = (x: number) => PAD + x * PLOT
const yToPx = (y: number) => PAD + ((Y_MAX - y) / (Y_MAX - Y_MIN)) * PLOT

const FIELD_RANGE: Record<BezierKey, { min: number; max: number }> = {
  x1: { min: 0, max: 1 },
  y1: { min: -1, max: 2 },
  x2: { min: 0, max: 1 },
  y2: { min: -1, max: 2 },
}

// Ranges wide enough for every catalog spring (e.g. tension up to 1000, mass up
// to 10). Clamps live here so the editor stays self-contained, mirroring the
// bezier `FIELD_RANGE` above. `decimals` keeps the readout faithful to fractional
// preset values (e.g. Bob's friction 2.3) rather than rounding them away.
const SPRING_FIELD_RANGE: Record<
  SpringKey,
  { min: number; max: number; step: number; decimals: number }
> = {
  tension: { min: 1, max: 1000, step: 1, decimals: 1 },
  friction: { min: 1, max: 100, step: 1, decimals: 1 },
  mass: { min: 0.1, max: 10, step: 0.1, decimals: 2 },
}

function clampField(key: BezierKey, value: number): number {
  const { min, max } = FIELD_RANGE[key]
  return Math.max(min, Math.min(max, value))
}

function clampSpringField(key: SpringKey, value: number): number {
  const { min, max } = SPRING_FIELD_RANGE[key]
  return Math.max(min, Math.min(max, value))
}

// Preview playback duration for a spring, derived from its physics like
// easing.dev (which exposes no duration control). The oscillator's decay
// envelope e^(-(c/2m)t) settles to ~1% at t = ln(100)·2m/c, so it depends only
// on mass + friction (damping), not tension — a stiffer spring oscillates
// faster but its settle envelope is unchanged. Matches easing.dev's computed
// transition-duration (mass 0.3 / friction 18 → 153ms; mass 4 / friction 80 → 460ms).
const BEZIER_PREVIEW_DURATION = 1
function springPreviewDuration({ mass, friction }: SpringParameters): number {
  const decay = friction / (2 * mass)
  const seconds = decay > 0 ? Math.log(100) / decay : BEZIER_PREVIEW_DURATION
  return Math.max(0.15, Math.min(4, seconds))
}

function curvePath(config: EasingConfig): string {
  // For a cubic-bezier, trace the true parametric control-point curve so the
  // handles' shape reads correctly. Everything else (springs) has no bezier
  // form — sample the eased value against uniform time instead.
  if (config.type === 'cubic-bezier' && config.bezier) {
    const { x1, y1, x2, y2 } = config.bezier
    const steps = 48
    let d = `M ${xToPx(0)} ${yToPx(0)}`
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const mt = 1 - t
      const x = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t
      const y = 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t
      d += ` L ${xToPx(x)} ${yToPx(y)}`
    }
    return d
  }

  const steps = 64
  let d = `M ${xToPx(0)} ${yToPx(applyEasingConfig(0, config))}`
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    d += ` L ${xToPx(t)} ${yToPx(applyEasingConfig(t, config))}`
  }
  return d
}

interface EasingCurveEditorProps {
  /** The segment's easing type (drives whether bezier or spring rows show). */
  easing: EasingType
  /** The segment's easing config (spring params / bezier points). */
  config: EasingConfig | undefined
  /** `commit` is false for live slider drag, true for discrete edits. */
  onChangeBezier: (bezier: BezierControlPoints, commit: boolean) => void
  /** `commit` is false for live slider drag, true for discrete edits. */
  onChangeSpring: (spring: SpringParameters, commit: boolean) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

export function EasingCurveEditor({
  easing,
  config,
  onChangeBezier,
  onChangeSpring,
  onDragStart,
  onDragEnd,
}: EasingCurveEditorProps) {
  const { t } = useTranslation()
  const [duration, setDuration] = useState(BEZIER_PREVIEW_DURATION)

  const isSpring = easing === 'spring'
  const bezier = effectiveBezier(easing, config)
  const spring = config?.type === 'spring' && config.spring ? config.spring : DEFAULT_SPRING_PARAMS
  const previewConfig: EasingConfig = isSpring
    ? { type: 'spring', spring }
    : { type: 'cubic-bezier', bezier }
  // Two UIs, like easing.dev: springs preview at their derived settling time
  // (no control); bezier easings get a manual Duration slider.
  const previewDuration = isSpring ? springPreviewDuration(spring) : duration

  const setBezierField = useCallback(
    (key: BezierKey, raw: number, commit: boolean) => {
      onChangeBezier({ ...bezier, [key]: clampField(key, raw) }, commit)
    },
    [onChangeBezier, bezier],
  )

  const setSpringField = useCallback(
    (key: SpringKey, raw: number, commit: boolean) => {
      onChangeSpring({ ...spring, [key]: clampSpringField(key, raw) }, commit)
    },
    [onChangeSpring, spring],
  )

  // Drag a bezier control point (P1 from the start, P2 from the end) on the
  // canvas; clamps match the slider ranges (x∈[0,1], y∈[-1,2]).
  const setBezierPoint = useCallback(
    (point: 'p1' | 'p2', x: number, y: number, commit: boolean) => {
      const next =
        point === 'p1'
          ? { ...bezier, x1: clampField('x1', x), y1: clampField('y1', y) }
          : { ...bezier, x2: clampField('x2', x), y2: clampField('y2', y) }
      onChangeBezier(next, commit)
    },
    [onChangeBezier, bezier],
  )

  return (
    <div className="flex items-stretch gap-3">
      {/* Square canvas, capped so the sliders keep a usable width; centered
          vertically against the taller controls column. */}
      <div className="aspect-square w-[190px] shrink-0 self-center">
        <CurveCanvas
          config={previewConfig}
          editableBezier={isSpring ? undefined : bezier}
          onBezierPointChange={isSpring ? undefined : setBezierPoint}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {isSpring
          ? SPRING_INPUT_KEYS.map((key) => (
              <SliderRow
                key={key}
                label={t(SPRING_LABEL[key].key, { defaultValue: SPRING_LABEL[key].fallback })}
                value={spring[key]}
                min={SPRING_FIELD_RANGE[key].min}
                max={SPRING_FIELD_RANGE[key].max}
                step={SPRING_FIELD_RANGE[key].step}
                decimals={SPRING_FIELD_RANGE[key].decimals}
                onLive={(v) => setSpringField(key, v, false)}
                onCommit={(v) => setSpringField(key, v, true)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))
          : BEZIER_INPUT_KEYS.map((key) => (
              <SliderRow
                key={key}
                label={key}
                value={bezier[key]}
                min={FIELD_RANGE[key].min}
                max={FIELD_RANGE[key].max}
                step={0.01}
                onLive={(v) => setBezierField(key, v, false)}
                onCommit={(v) => setBezierField(key, v, true)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))}
        {!isSpring && (
          // Bezier-only manual Duration (springs derive it) — easing.dev range.
          <SliderRow
            label={t('timeline.keyframeEditor.duration', { defaultValue: 'Duration' })}
            value={duration}
            min={0.1}
            max={2}
            step={0.05}
            decimals={2}
            onLive={setDuration}
            onCommit={setDuration}
          />
        )}
        <PositionPreview config={previewConfig} duration={previewDuration} />
      </div>
    </div>
  )
}

function CurveCanvas({
  config,
  editableBezier,
  onBezierPointChange,
  onDragStart,
  onDragEnd,
}: {
  config: EasingConfig
  editableBezier?: BezierControlPoints
  onBezierPointChange?: (point: 'p1' | 'p2', x: number, y: number, commit: boolean) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<'p1' | 'p2' | null>(null)

  // While a handle is held, track the pointer on the window (not just the SVG)
  // so the drag survives leaving the canvas; convert client px → bezier coords.
  useEffect(() => {
    if (!drag || !onBezierPointChange) return
    const toBezier = (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return null
      const vx = ((clientX - rect.left) / rect.width) * SIZE
      const vy = ((clientY - rect.top) / rect.height) * SIZE
      return { x: (vx - PAD) / PLOT, y: Y_MAX - ((vy - PAD) / PLOT) * (Y_MAX - Y_MIN) }
    }
    const move = (e: PointerEvent) => {
      const b = toBezier(e.clientX, e.clientY)
      if (b) onBezierPointChange(drag, b.x, b.y, false)
    }
    const up = (e: PointerEvent) => {
      const b = toBezier(e.clientX, e.clientY)
      if (b) onBezierPointChange(drag, b.x, b.y, true)
      setDrag(null)
      onDragEnd?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    // Treat cancellation (e.g. touch interruption) like release so the drag
    // state clears and onDragEnd always fires exactly once.
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, onBezierPointChange, onDragEnd])

  const startDrag = (point: 'p1' | 'p2') => (e: ReactPointerEvent<SVGElement>) => {
    e.preventDefault()
    onDragStart?.()
    setDrag(point)
  }

  const dots: string[] = []
  for (let gx = 0; gx <= 8; gx++) {
    for (let gy = 0; gy <= 8; gy++) {
      dots.push(`${PAD + (gx / 8) * PLOT},${PAD + (gy / 8) * PLOT}`)
    }
  }

  const handles =
    editableBezier && onBezierPointChange
      ? ([
          { key: 'p1' as const, hx: editableBezier.x1, hy: editableBezier.y1, ax: 0, ay: 0 },
          { key: 'p2' as const, hx: editableBezier.x2, hy: editableBezier.y2, ax: 1, ay: 1 },
        ] as const)
      : []

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="block h-full w-full touch-none rounded-md border border-border/60 bg-black/40"
      aria-hidden
    >
      {dots.map((d) => {
        const [cx, cy] = d.split(',')
        return <circle key={d} cx={cx} cy={cy} r={0.7} className="fill-white/15" />
      })}
      <line
        x1={xToPx(0)}
        y1={yToPx(0)}
        x2={xToPx(1)}
        y2={yToPx(1)}
        className="stroke-white/10"
        strokeWidth={1}
      />
      <path
        d={curvePath(config)}
        className="fill-none stroke-white"
        strokeWidth={2}
        pointerEvents="none"
      />
      {/* Draggable cubic-bezier control handles + tangent lines (bezier only). */}
      {handles.map((h) => (
        <line
          key={`t-${h.key}`}
          x1={xToPx(h.ax)}
          y1={yToPx(h.ay)}
          x2={xToPx(h.hx)}
          y2={yToPx(h.hy)}
          className="stroke-blue-500"
          strokeWidth={1}
          pointerEvents="none"
        />
      ))}
      <circle cx={xToPx(0)} cy={yToPx(0)} r={2.5} className="fill-white/70" pointerEvents="none" />
      <circle cx={xToPx(1)} cy={yToPx(1)} r={2.5} className="fill-white/70" pointerEvents="none" />
      {handles.map((h) => (
        <g key={`h-${h.key}`} className="cursor-grab" onPointerDown={startDrag(h.key)}>
          {/* Larger transparent hit target for easier grabbing. */}
          <circle cx={xToPx(h.hx)} cy={yToPx(h.hy)} r={9} fill="transparent" />
          <circle
            cx={xToPx(h.hx)}
            cy={yToPx(h.hy)}
            r={drag === h.key ? 5 : 4}
            className="fill-blue-500"
          />
        </g>
      ))}
    </svg>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  decimals = 2,
  onLive,
  onCommit,
  onDragStart,
  onDragEnd,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  decimals?: number
  onLive: (value: number) => void
  onCommit: (value: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  // True only between a slider pointerdown and its release, so keyboard-driven
  // changes (which have no drag lifecycle) can be committed discretely instead.
  const pointerDraggingRef = useRef(false)

  const commitDraft = useCallback(() => {
    if (draft === null) return
    const parsed = Number(draft)
    setDraft(null)
    if (Number.isFinite(parsed)) onCommit(parsed)
  }, [draft, onCommit])

  return (
    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="w-14 shrink-0">{label}</span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onPointerDown={() => {
          pointerDraggingRef.current = true
          onDragStart?.()
        }}
        onValueChange={(values) => {
          const next = values[0] ?? value
          // Pointer drags stream live (committed on release); keyboard/other
          // discrete changes have no drag lifecycle, so commit immediately.
          if (pointerDraggingRef.current) onLive(next)
          else onCommit(next)
        }}
        onValueCommit={() => {
          if (pointerDraggingRef.current) {
            pointerDraggingRef.current = false
            onDragEnd?.()
          }
        }}
        className="min-w-0 flex-1"
        aria-label={label}
      />
      <Input
        autoComplete="off"
        data-bwignore="true"
        value={draft ?? value.toFixed(decimals)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitDraft()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
        className="h-6 w-14 shrink-0 px-1.5 text-center text-[11px] tabular-nums"
        inputMode="decimal"
      />
    </label>
  )
}

// The preview drives one normalized value (0→1, with overshoot) through the
// easing; each mode just maps it to a different property so the curve can be
// felt the way it will be used (travel / grow / fade).
type PreviewMode = 'position' | 'scale' | 'rotate' | 'opacity'
const PREVIEW_MODES: Array<{ mode: PreviewMode; labelKey: string; defaultValue: string }> = [
  {
    mode: 'position',
    labelKey: 'timeline.keyframeEditor.previewPosition',
    defaultValue: 'Position',
  },
  { mode: 'scale', labelKey: 'timeline.keyframeEditor.previewScale', defaultValue: 'Scale' },
  { mode: 'rotate', labelKey: 'timeline.keyframeEditor.previewRotate', defaultValue: 'Rotate' },
  { mode: 'opacity', labelKey: 'timeline.keyframeEditor.previewOpacity', defaultValue: 'Opacity' },
]

function PositionPreview({ config, duration }: { config: EasingConfig; duration: number }) {
  const { t } = useTranslation()
  const [playing, setPlaying] = useState(true)
  const [mode, setMode] = useState<PreviewMode>('position')
  const [pos, setPos] = useState(0)
  const configRef = useRef(config)
  configRef.current = config
  const durationRef = useRef(duration)
  durationRef.current = duration

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const start = performance.now()
    // Mirror ping-pong, matching easing.dev: the dot eases out (overshooting the
    // far end), then eases *back* — the return leg is the easing flipped in both
    // time and value (`1 - ease(p)`), so a spring overshoots past the start too.
    // No explicit end-hold: a spring's own flat settle tail provides the dwell,
    // and mirroring keeps velocity continuous through the turnaround (an added
    // freeze reads as a stall). A plain forward-then-teleport loop looks janky.
    const tick = (now: number) => {
      const dur = Math.max(0.05, durationRef.current)
      const cfg = configRef.current
      const phase = ((now - start) / 1000) % (2 * dur)
      const value =
        phase < dur
          ? applyEasingConfig(phase / dur, cfg) // ease out
          : 1 - applyEasingConfig((phase - dur) / dur, cfg) // ease back (mirror)
      setPos(value)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const active = PREVIEW_MODES.find((m) => m.mode === mode)
  const activeName = active ? t(active.labelKey, { defaultValue: active.defaultValue }) : ''

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-0.5 rounded hover:text-foreground">
            {activeName} {t('timeline.keyframeEditor.preview', { defaultValue: 'Preview' })}
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[7rem]">
            {PREVIEW_MODES.map((m) => (
              <DropdownMenuItem key={m.mode} onSelect={() => setMode(m.mode)}>
                {t(m.labelKey, { defaultValue: m.defaultValue })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="rounded px-1 hover:text-foreground"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing
            ? t('timeline.keyframeEditor.pause', { defaultValue: 'Pause' })
            : t('timeline.keyframeEditor.play', { defaultValue: 'Play' })}
        </button>
      </div>
      <div className="relative flex h-20 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-black/40">
        {mode === 'position' ? (
          <>
            <div className="absolute inset-x-3 top-1/2 border-t border-dashed border-white/20" />
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-orange-400"
              // pos 0→1 spans the full dashed track (dot center hits each end);
              // clamp keeps small spring overshoot inside the box instead of clipping.
              style={{
                left: `clamp(0px, calc(12px + (100% - 24px) * ${pos} - 7px), calc(100% - 14px))`,
              }}
            />
          </>
        ) : mode === 'rotate' ? (
          // Rounded square + orientation pip so the spin is actually visible.
          <div
            className="relative size-9 rounded-[5px] bg-orange-400"
            style={{ transform: `rotate(${pos * 180}deg)` }}
          >
            <span className="absolute left-1/2 top-1 size-1.5 -translate-x-1/2 rounded-full bg-black/40" />
          </div>
        ) : (
          <div
            className="size-9 rounded-full bg-orange-400"
            style={
              mode === 'scale'
                ? { transform: `scale(${Math.max(0, pos)})` }
                : { opacity: Math.max(0, Math.min(1, pos)) }
            }
          />
        )}
      </div>
    </div>
  )
}
