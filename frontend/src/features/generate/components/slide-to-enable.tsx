import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { ChevronsRight, Square } from 'lucide-react'

/** Past this share of the way the slide counts; short of it the knob goes back. */
const COMMIT_AT = 0.9

interface SlideToEnableProps {
  on: boolean
  onChange: (on: boolean) => void
  /** What the track says while off: the slide it asks for. */
  offLabel: string
  /** What the button that switches it off again says. */
  stop: ReactNode
  title?: string
}

/**
 * A mode that is risky to start and safe to stop, as in YuE2 Studio: starting takes a slide of the knob to the far
 * end, so a stray click cannot set it going; once on, the same place is a plain button that stops it. The keyboard
 * starts it with the right arrow, End, Enter or Space on the knob, the way without dragging WCAG 2.5.7 asks for.
 */
export function SlideToEnable({ on, onChange, offLabel, stop, title }: SlideToEnableProps) {
  const track = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLButtonElement>(null)
  const stopButton = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ startX: number; travel: number } | null>(null)
  const [pulled, setPulled] = useState<number | null>(null)
  const keepFocus = useRef(false)

  useEffect(() => {
    if (!keepFocus.current) return
    keepFocus.current = false
    ;(on ? stopButton.current : knob.current)?.focus()
  }, [on])

  const change = (next: boolean) => {
    keepFocus.current =
      document.activeElement === knob.current || document.activeElement === stopButton.current
    onChange(next)
  }

  if (on) {
    return (
      <button
        ref={stopButton}
        type="button"
        role="switch"
        aria-checked
        onClick={() => change(false)}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-destructive px-3 text-xs font-semibold text-destructive-foreground shadow-sm transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Square className="h-3.5 w-3.5 shrink-0" fill="currentColor" />
        {stop}
      </button>
    )
  }

  const reach = (clientX: number) => {
    const slide = drag.current
    return slide ? Math.min(slide.travel, Math.max(0, clientX - slide.startX)) : 0
  }

  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !track.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      startX: event.clientX,
      travel: track.current.clientWidth - event.currentTarget.offsetWidth - 4,
    }
    setPulled(0)
  }

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current) setPulled(reach(event.clientX))
  }

  const release = (event: PointerEvent<HTMLButtonElement>) => {
    const slide = drag.current
    if (!slide) return
    const reached = reach(event.clientX)
    drag.current = null
    setPulled(null)
    if (slide.travel > 0 && reached >= slide.travel * COMMIT_AT) change(true)
  }

  const cancel = () => {
    drag.current = null
    setPulled(null)
  }

  // a pointer click does nothing: starting takes the slide; a click the keyboard made has no click count
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) change(true)
  }

  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'End') {
      event.preventDefault()
      change(true)
    }
  }

  const sliding = pulled !== null
  return (
    <div
      ref={track}
      title={title}
      className="relative h-9 w-full select-none overflow-hidden rounded-md border border-border bg-secondary/40 text-[11px] text-muted-foreground"
    >
      {sliding && (
        <div
          className="absolute inset-y-0 left-0 rounded-md bg-destructive/20"
          style={{ width: pulled + 34 }}
        />
      )}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-10 text-center font-medium">
        {offLabel}
      </span>
      <button
        ref={knob}
        type="button"
        role="switch"
        aria-checked={false}
        aria-label={offLabel}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onClick={click}
        onKeyDown={key}
        className={`absolute left-0.5 top-0.5 flex h-7 w-8 cursor-grab touch-none items-center justify-center rounded bg-background text-muted-foreground shadow-sm active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-destructive ${sliding ? '' : 'transition-transform duration-200'}`}
        style={sliding ? { transform: `translateX(${pulled}px)` } : undefined}
      >
        <ChevronsRight className="h-4 w-4" />
      </button>
    </div>
  )
}
