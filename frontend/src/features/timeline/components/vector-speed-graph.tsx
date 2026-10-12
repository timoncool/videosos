import { useEffect, useRef, useState } from 'react'
import { Gauge, RotateCcw } from 'lucide-react'
import { sampleVectorSpeedGraph } from '@/features/timeline/deps/keyframes'
import type {
  TemporalEase,
  TemporalEaseHandle,
  VectorAnimatableProperty,
  VectorKeyframe,
} from '@/types/keyframe'

const GRAPH_WIDTH = 1000
const GRAPH_HEIGHT = 360
const GRAPH_PADDING_X = 28
const GRAPH_PADDING_Y = 24
const DEFAULT_INFLUENCE = 100 / 3

function vectorDistance(left: VectorKeyframe, right: VectorKeyframe): number {
  return Math.hypot(right.value.x - left.value.x, right.value.y - left.value.y)
}

function averageSegmentSpeed(
  left: VectorKeyframe | undefined,
  right: VectorKeyframe | undefined,
  fps: number,
): number {
  if (!left || !right || right.frame <= left.frame) return 0
  return vectorDistance(left, right) / ((right.frame - left.frame) / Math.max(1, fps))
}

function NumberField({
  label,
  value,
  suffix,
  disabled,
  onCommit,
}: {
  label: string
  value: number
  suffix: string
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(() => value.toFixed(1))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(value.toFixed(1))
  }, [value])

  const commit = () => {
    const parsed = Number(draft)
    if (Number.isFinite(parsed)) onCommit(parsed)
    else setDraft(value.toFixed(1))
  }

  return (
    <label className="flex h-6 min-w-[122px] items-center rounded border border-border/60 bg-background/80 px-1.5 text-[9px]">
      <span className="mr-1 shrink-0 text-muted-foreground">{label}</span>
      <input
        ref={inputRef}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-right font-mono text-[10px] tabular-nums outline-none disabled:opacity-40"
        disabled={disabled}
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(value.toFixed(1))
            event.currentTarget.blur()
          }
        }}
      />
      <span className="ml-0.5 shrink-0 text-muted-foreground">{suffix}</span>
    </label>
  )
}

export function VectorSpeedGraph({
  property,
  label,
  keyframes,
  currentKeyframeId,
  fps,
  resetLabel,
  onTemporalEaseCommit,
  onSelectKeyframe,
}: {
  property: VectorAnimatableProperty
  label: string
  keyframes: VectorKeyframe[]
  currentKeyframeId?: string
  fps: number
  resetLabel: string
  onTemporalEaseCommit: (keyframeId: string, temporalEase: TemporalEase | undefined) => void
  onSelectKeyframe?: (keyframe: VectorKeyframe) => void
}) {
  const currentIndex = Math.max(
    0,
    keyframes.findIndex((keyframe) => keyframe.id === currentKeyframeId),
  )
  const current = keyframes[currentIndex]

  if (keyframes.length < 2 || !current) {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.05),transparent_48%)]"
        data-testid="vector-speed-graph"
      >
        <div className="max-w-sm text-center">
          <Gauge className="mx-auto mb-2 h-5 w-5 text-muted-foreground/60" />
          <div className="text-xs font-medium text-foreground">{label}</div>
          <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Add at least two keyframes to shape velocity and influence over time.
          </div>
        </div>
      </div>
    )
  }

  const previous = keyframes[currentIndex - 1]
  const next = keyframes[currentIndex + 1]
  const incomingFallback = averageSegmentSpeed(previous, current, fps)
  const outgoingFallback = averageSegmentSpeed(current, next, fps)
  const incoming: TemporalEaseHandle = current.temporalEase?.in ?? {
    speed: incomingFallback,
    influence: DEFAULT_INFLUENCE,
  }
  const outgoing: TemporalEaseHandle = current.temporalEase?.out ?? {
    speed: outgoingFallback,
    influence: DEFAULT_INFLUENCE,
  }

  const samples = sampleVectorSpeedGraph(property, keyframes, fps)
  const firstFrame = keyframes[0]!.frame
  const lastFrame = keyframes.at(-1)!.frame
  const frameRange = Math.max(1, lastFrame - firstFrame)
  const maxSpeed = Math.max(
    1,
    incoming.speed,
    outgoing.speed,
    ...samples.map((sample) => sample.speed),
  )
  const xForFrame = (frame: number) =>
    GRAPH_PADDING_X + ((frame - firstFrame) / frameRange) * (GRAPH_WIDTH - GRAPH_PADDING_X * 2)
  const yForSpeed = (speed: number) =>
    GRAPH_HEIGHT -
    GRAPH_PADDING_Y -
    (Math.max(0, speed) / maxSpeed) * (GRAPH_HEIGHT - GRAPH_PADDING_Y * 2)
  const speedPath = samples
    .map(
      (sample, index) =>
        `${index === 0 ? 'M' : 'L'} ${xForFrame(sample.frame)} ${yForSpeed(sample.speed)}`,
    )
    .join(' ')
  const currentX = xForFrame(current.frame)
  const incomingHandleX = previous
    ? currentX - (currentX - xForFrame(previous.frame)) * (incoming.influence / 100)
    : currentX
  const outgoingHandleX = next
    ? currentX + (xForFrame(next.frame) - currentX) * (outgoing.influence / 100)
    : currentX

  const updateHandle = (side: 'in' | 'out', field: keyof TemporalEaseHandle, value: number) => {
    const fallback = side === 'in' ? incoming : outgoing
    const nextHandle = {
      ...fallback,
      [field]: field === 'influence' ? Math.max(0, Math.min(100, value)) : Math.max(0, value),
    }
    onTemporalEaseCommit(current.id, { ...current.temporalEase, [side]: nextHandle })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/20" data-testid="vector-speed-graph">
      <div className="flex min-h-9 flex-wrap items-center gap-1 border-b border-border/60 bg-background/75 px-2 py-1">
        <div className="mr-2 flex min-w-24 items-center gap-1.5 text-[10px] font-medium text-foreground">
          <Gauge className="h-3 w-3 text-sky-400" />
          {label}
          <span className="text-muted-foreground">· {current.frame}f</span>
        </div>
        <NumberField
          label="In speed"
          value={incoming.speed}
          suffix="/s"
          disabled={!previous}
          onCommit={(value) => updateHandle('in', 'speed', value)}
        />
        <NumberField
          label="In influence"
          value={incoming.influence}
          suffix="%"
          disabled={!previous}
          onCommit={(value) => updateHandle('in', 'influence', value)}
        />
        <NumberField
          label="Out speed"
          value={outgoing.speed}
          suffix="/s"
          disabled={!next}
          onCommit={(value) => updateHandle('out', 'speed', value)}
        />
        <NumberField
          label="Out influence"
          value={outgoing.influence}
          suffix="%"
          disabled={!next}
          onCommit={(value) => updateHandle('out', 'influence', value)}
        />
        <button
          type="button"
          aria-label={resetLabel}
          className="flex h-6 w-6 items-center justify-center rounded border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.97] disabled:opacity-40"
          disabled={!current.temporalEase}
          title={resetLabel}
          onClick={() => onTemporalEaseCommit(current.id, undefined)}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-950/45">
        <svg
          aria-label={`${label} speed graph`}
          className="h-full w-full"
          preserveAspectRatio="none"
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = GRAPH_PADDING_Y + ratio * (GRAPH_HEIGHT - GRAPH_PADDING_Y * 2)
            return (
              <line
                key={ratio}
                x1={GRAPH_PADDING_X}
                x2={GRAPH_WIDTH - GRAPH_PADDING_X}
                y1={y}
                y2={y}
                stroke="rgba(148, 163, 184, 0.12)"
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
          {keyframes.map((keyframe) => (
            <line
              key={`grid:${keyframe.id}`}
              x1={xForFrame(keyframe.frame)}
              x2={xForFrame(keyframe.frame)}
              y1={GRAPH_PADDING_Y}
              y2={GRAPH_HEIGHT - GRAPH_PADDING_Y}
              stroke="rgba(148, 163, 184, 0.12)"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={`${speedPath} L ${xForFrame(lastFrame)} ${GRAPH_HEIGHT - GRAPH_PADDING_Y} L ${xForFrame(firstFrame)} ${GRAPH_HEIGHT - GRAPH_PADDING_Y} Z`}
            fill="rgba(56, 189, 248, 0.08)"
          />
          <path
            d={speedPath}
            fill="none"
            stroke="rgb(56 189 248)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={currentX}
            x2={currentX}
            y1={GRAPH_PADDING_Y}
            y2={GRAPH_HEIGHT - GRAPH_PADDING_Y}
            stroke="rgba(250, 204, 21, 0.75)"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          {previous && (
            <>
              <line
                x1={incomingHandleX}
                x2={currentX}
                y1={yForSpeed(incoming.speed)}
                y2={yForSpeed(incoming.speed)}
                stroke="rgb(250 204 21)"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={incomingHandleX}
                cy={yForSpeed(incoming.speed)}
                r={4}
                fill="rgb(250 204 21)"
              />
            </>
          )}
          {next && (
            <>
              <line
                x1={currentX}
                x2={outgoingHandleX}
                y1={yForSpeed(outgoing.speed)}
                y2={yForSpeed(outgoing.speed)}
                stroke="rgb(250 204 21)"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={outgoingHandleX}
                cy={yForSpeed(outgoing.speed)}
                r={4}
                fill="rgb(250 204 21)"
              />
            </>
          )}
          {keyframes.map((keyframe) => {
            const nearest = samples.reduce((best, sample) =>
              Math.abs(sample.frame - keyframe.frame) < Math.abs(best.frame - keyframe.frame)
                ? sample
                : best,
            )
            const selected = keyframe.id === current.id
            return (
              <circle
                key={keyframe.id}
                cx={xForFrame(keyframe.frame)}
                cy={yForSpeed(nearest.speed)}
                r={selected ? 5 : 4}
                fill={selected ? 'rgb(250 204 21)' : 'rgb(226 232 240)'}
                stroke="rgb(15 23 42)"
                strokeWidth={2}
                className="cursor-pointer"
                onClick={() => onSelectKeyframe?.(keyframe)}
              />
            )
          })}
        </svg>
        <div className="pointer-events-none absolute bottom-1 left-2 text-[9px] text-muted-foreground">
          0 {property === 'scale' ? '%/s' : 'px/s'}
        </div>
        <div className="pointer-events-none absolute left-2 top-1 text-[9px] text-muted-foreground">
          {maxSpeed.toFixed(1)} {property === 'scale' ? '%/s' : 'px/s'}
        </div>
      </div>
    </div>
  )
}
