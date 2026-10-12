/**
 * Player.tsx - Main Player Component for FreeCut
 *
 * A customizable video player component inspired by Composition Player
 * with support for:
 * - Frame-accurate playback
 * - Custom controls
 * - Fullscreen mode
 * - Event emission for external integration
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useEffect,
} from 'react'
import {
  PlayerEmitterProvider,
  usePlayerEmitter,
  type PlayerEventTypes,
  type CallbackListener,
} from './event-emitter'
import { ClockBridgeProvider, useBridgedTimelinePlayback, useClock, useClockFrame } from './clock'
import { usePlayer } from './use-player'
import { VideoConfigProvider } from './video-config-context'
import { calculatePlayerContentLayout } from './player-layout'

// Types
interface PlayerProps {
  /** The component to render as video content */
  children: React.ReactNode

  /** Duration in frames */
  durationInFrames: number

  /** Frames per second */
  fps: number

  /** Initial frame to start at */
  initialFrame?: number

  /** Whether to loop playback */
  loop?: boolean

  /** Whether to show controls */
  controls?: boolean

  /** Whether to auto-play on mount */
  autoPlay?: boolean

  /** Whether to start muted */
  initiallyMuted?: boolean

  /** Playback rate (0.25 - 4) */
  playbackRate?: number

  /** Custom class name */
  className?: string

  /** Custom styles */
  style?: React.CSSProperties

  /** Width of the rendered composition */
  width?: number

  /** Height of the rendered composition */
  height?: number

  /** Explicit CSS layout rectangle to scale the composition into. */
  layoutSize?: { width: number; height: number }

  /** Callback when playback ends */
  onEnded?: () => void

  /** Callback when frame changes */
  onFrameChange?: (frame: number) => void

  /** Callback when play state changes */
  onPlayStateChange?: (isPlaying: boolean) => void
}

export interface PlayerRef {
  play: () => void
  pause: () => void
  toggle: () => void
  seekTo: (frame: number) => void
  getCurrentFrame: () => number
  isPlaying: () => boolean
  getPlaybackRate: () => number
  setPlaybackRate: (rate: number) => void
  addEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => void
  removeEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => void
}

/**
 * Default Play/Pause Button Component
 */
const DefaultPlayPauseButton: React.FC<{
  isPlaying: boolean
  onToggle: () => void
}> = ({ isPlaying, onToggle }) => {
  return (
    <button
      onClick={onToggle}
      className="p-2 rounded-full hover:bg-white/20 transition-colors"
      aria-label={isPlaying ? 'Pause' : 'Play'}
    >
      {isPlaying ? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
    </button>
  )
}

/**
 * Default Progress Bar Component
 */
const DefaultProgressBar: React.FC<{
  currentFrame: number
  durationInFrames: number
  seek: (frame: number) => void
}> = ({ currentFrame, durationInFrames, seek }) => {
  const progress = durationInFrames > 0 ? (currentFrame / durationInFrames) * 100 : 0
  const barRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const mouseMoveRef = useRef<((ev: MouseEvent) => void) | null>(null)
  const mouseUpRef = useRef<(() => void) | null>(null)

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const bar = barRef.current
      if (!bar) return
      const rect = bar.getBoundingClientRect()
      const x = clientX - rect.left
      const percentage = Math.max(0, Math.min(1, x / rect.width))
      const frame = Math.round(percentage * durationInFrames)
      seek(Math.max(0, Math.min(frame, durationInFrames - 1)))
    },
    [durationInFrames, seek],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      draggingRef.current = true
      seekFromEvent(e.clientX)

      const handleMouseMove = (ev: MouseEvent) => {
        if (draggingRef.current) {
          seekFromEvent(ev.clientX)
        }
      }

      const handleMouseUp = () => {
        draggingRef.current = false
        if (mouseMoveRef.current) {
          document.removeEventListener('mousemove', mouseMoveRef.current)
          mouseMoveRef.current = null
        }
        if (mouseUpRef.current) {
          document.removeEventListener('mouseup', mouseUpRef.current)
          mouseUpRef.current = null
        }
      }

      mouseMoveRef.current = handleMouseMove
      mouseUpRef.current = handleMouseUp
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [seekFromEvent],
  )

  // Clean up document listeners on unmount
  useEffect(() => {
    return () => {
      if (mouseMoveRef.current) {
        document.removeEventListener('mousemove', mouseMoveRef.current)
        mouseMoveRef.current = null
      }
      if (mouseUpRef.current) {
        document.removeEventListener('mouseup', mouseUpRef.current)
        mouseUpRef.current = null
      }
      draggingRef.current = false
    }
  }, [])

  return (
    <div
      ref={barRef}
      className="w-full h-2 bg-white/20 rounded cursor-pointer overflow-hidden"
      onMouseDown={handleMouseDown}
    >
      <div
        className="h-full bg-primary transition-none pointer-events-none"
        style={{ width: `${progress}%` }}
      />
    </div>
  )
}

/**
 * Default Controls Component
 */
const DefaultControls: React.FC<{
  isPlaying: boolean
  durationInFrames: number
  fps: number
  playbackRate: number
  isFullscreen: boolean
  onTogglePlay: () => void
  onSeek: (frame: number) => void
  onPlaybackRateChange: (rate: number) => void
  onToggleFullscreen: () => void
}> = ({
  isPlaying,
  durationInFrames,
  fps,
  playbackRate,
  isFullscreen,
  onTogglePlay,
  onSeek,
  onPlaybackRateChange,
  onToggleFullscreen,
}) => {
  // Subscribe the controls (not the whole player shell) to frame ticks.
  const currentFrame = useClockFrame()

  const formatTime = (frame: number) => {
    const seconds = frame / fps
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
      <div className="mb-3">
        <DefaultProgressBar
          currentFrame={currentFrame}
          durationInFrames={durationInFrames}
          seek={onSeek}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DefaultPlayPauseButton isPlaying={isPlaying} onToggle={onTogglePlay} />

          <span className="text-sm text-white ml-2">
            {formatTime(currentFrame)} / {formatTime(durationInFrames - 1)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={playbackRate}
            onChange={(event) => {
              onPlaybackRateChange(Number(event.target.value))
            }}
            className="bg-transparent text-sm text-white border border-white/30 rounded px-2 py-1"
            aria-label="Playback rate"
          >
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>

          <button
            onClick={onToggleFullscreen}
            className="p-2 rounded-full hover:bg-white/20 transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Inner Player Component
 */
const PlayerInner = forwardRef<PlayerRef, PlayerProps>(
  (
    {
      children,
      durationInFrames,
      fps,
      initialFrame = 0,
      loop = false,
      controls = true,
      autoPlay = false,
      initiallyMuted = false,
      playbackRate: initialPlaybackRate = 1,
      className,
      style,
      width = 1280,
      height = 720,
      layoutSize,
      onEnded,
      onFrameChange,
      onPlayStateChange,
    },
    ref,
  ) => {
    // Consume unused props to avoid lint warnings
    void initiallyMuted
    void initialPlaybackRate
    void onEnded

    // State
    const [isFullscreen, setIsFullscreen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const contentHostRef = useRef<HTMLDivElement>(null)
    const contentScaleRef = useRef<HTMLDivElement>(null)

    // Measure container size for scaling. Apply layout imperatively to avoid
    // re-rendering the entire composition tree on every resize step.
    const updateScaledLayout = useCallback(() => {
      const container = containerRef.current
      const contentHost = contentHostRef.current
      const contentScale = contentScaleRef.current
      if (!container || !contentHost || !contentScale) return

      const containerRect = container.getBoundingClientRect()
      const measuredWidth = containerRect.width || container.clientWidth
      const measuredHeight = containerRect.height || container.clientHeight
      const containerWidth = layoutSize?.width ?? measuredWidth
      const containerHeight = layoutSize?.height ?? measuredHeight
      const layout = calculatePlayerContentLayout(containerWidth, containerHeight, width, height)

      contentHost.style.width = `${layout.width}px`
      contentHost.style.height = `${layout.height}px`
      contentHost.style.marginLeft = `${-layout.width / 2}px`
      contentHost.style.marginTop = `${-layout.height / 2}px`

      contentScale.style.width = `${width}px`
      contentScale.style.height = `${height}px`
      contentScale.style.transform = `scale(${layout.scaleX}, ${layout.scaleY})`
    }, [height, layoutSize?.height, layoutSize?.width, width])

    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      let rafId: number | null = null
      const scheduleUpdate = () => {
        if (rafId !== null) return
        rafId = requestAnimationFrame(() => {
          rafId = null
          updateScaledLayout()
        })
      }

      const observer = new ResizeObserver(scheduleUpdate)
      observer.observe(container)

      // Initial measurement
      updateScaledLayout()

      return () => {
        observer.disconnect()
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
        }
      }
    }, [updateScaledLayout])

    // Get player methods
    const player = usePlayer(durationInFrames, { loop, onEnded })

    // Play transport state only — the frame stays out of this component's
    // render path so a clock tick cannot re-render the player shell.
    const { playing, playbackRate, setPlaybackRate } = useBridgedTimelinePlayback()
    const clock = useClock()
    const emitter = usePlayerEmitter()

    // Sync initial frame — ONCE on mount only. The Clock is already created with
    // `initialFrame` (see ClockBridgeProvider), so this is a belt-and-suspenders
    // catch for the rare case it started at 0. It must NOT depend on
    // `currentFrame`: doing so re-fires this seek every time the clock later
    // reaches frame 0 (e.g. pressing "Go To Start"), yanking the playhead back to
    // the stale mount-time `initialFrame`.
    const hasSyncedInitialFrameRef = useRef(false)
    useEffect(() => {
      if (hasSyncedInitialFrameRef.current) return
      hasSyncedInitialFrameRef.current = true
      if (initialFrame > 0 && player.getCurrentFrame() === 0) {
        player.seek(initialFrame)
      }
      // Mount-only: intentionally no reactive deps.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Sync autoPlay
    useEffect(() => {
      if (autoPlay && !playing) {
        player.play()
      }
    }, [autoPlay, playing, player])

    // Handle frame changes imperatively. Delivering them through a render
    // subscription would re-render the whole player shell per clock tick.
    useEffect(() => {
      onFrameChange?.(clock.currentFrame)
      return clock.onFrameChange((frame) => onFrameChange?.(frame))
    }, [clock, onFrameChange])

    // Handle play state changes
    useEffect(() => {
      onPlayStateChange?.(playing)
    }, [playing, onPlayStateChange])

    // Fullscreen handling
    const toggleFullscreen = useCallback(async () => {
      if (!containerRef.current) return

      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    }, [])

    // Listen for fullscreen changes
    useEffect(() => {
      const handleFullscreenChange = () => {
        setIsFullscreen(!!document.fullscreenElement)
      }

      document.addEventListener('fullscreenchange', handleFullscreenChange)
      return () => {
        document.removeEventListener('fullscreenchange', handleFullscreenChange)
      }
    }, [])

    // Expose imperative API
    useImperativeHandle(
      ref,
      () => ({
        play: () => player.play(),
        pause: () => player.pause(),
        toggle: () => player.toggle(),
        seekTo: (frame: number) => player.seek(frame),
        getCurrentFrame: () => player.getCurrentFrame(),
        isPlaying: () => player.isPlaying(),
        getPlaybackRate: () => player.getPlaybackRate(),
        setPlaybackRate: (rate: number) => player.setPlaybackRate(rate),
        addEventListener: (event, callback) => {
          emitter.addEventListener(event, callback)
        },
        removeEventListener: (event, callback) => {
          emitter.removeEventListener(event, callback)
        },
      }),
      [player, emitter],
    )

    return (
      <div
        ref={containerRef}
        className={`relative bg-black ${className || ''}`}
        style={{
          ...style,
          overflow: 'hidden',
        }}
        data-player-container
      >
        {/* Video content - canvas rendered at native size, scaled to fit via CSS */}
        <div
          ref={contentHostRef}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width,
            height,
            marginLeft: -width / 2,
            marginTop: -height / 2,
            overflow: 'hidden',
          }}
        >
          <div
            ref={contentScaleRef}
            style={{
              width,
              height,
              transform: 'scale(1)',
              transformOrigin: 'top left',
            }}
          >
            {children}
          </div>
        </div>

        {/* Controls overlay */}
        {controls && (
          <>
            {/* Click to play/pause overlay - behind controls */}
            <div className="absolute inset-0 cursor-pointer" onClick={() => player.toggle()} />

            {/* Controls - on top so scrubber/buttons receive clicks */}
            <DefaultControls
              isPlaying={playing}
              durationInFrames={durationInFrames}
              fps={fps}
              playbackRate={playbackRate}
              isFullscreen={isFullscreen}
              onTogglePlay={player.toggle}
              onSeek={player.seek}
              onPlaybackRateChange={setPlaybackRate}
              onToggleFullscreen={toggleFullscreen}
            />
          </>
        )}
      </div>
    )
  },
)

/**
 * Player Component - Main export
 *
 * Now uses the Clock system internally for timing control.
 * The ClockBridgeProvider maintains backwards compatibility with
 * existing code that uses useTimelineContext().
 */
const Player = forwardRef<PlayerRef, PlayerProps>((props, ref) => {
  const { durationInFrames, fps, initialFrame, initiallyMuted, playbackRate, loop, onEnded } = props

  return (
    <PlayerEmitterProvider>
      <ClockBridgeProvider
        fps={fps}
        durationInFrames={durationInFrames}
        initialFrame={initialFrame}
        initiallyMuted={initiallyMuted}
        initialPlaybackRate={playbackRate}
        loop={loop}
        onEnded={onEnded}
        onVolumeChange={() => {}}
      >
        <VideoConfigProvider
          fps={fps}
          width={props.width ?? 1280}
          height={props.height ?? 720}
          durationInFrames={durationInFrames}
        >
          <PlayerInner {...props} ref={ref} />
        </VideoConfigProvider>
      </ClockBridgeProvider>
    </PlayerEmitterProvider>
  )
})

Player.displayName = 'Player'

export const HeadlessPlayer = forwardRef<PlayerRef, Omit<PlayerProps, 'controls'>>((props, ref) => (
  <Player {...props} ref={ref} controls={false} />
))

HeadlessPlayer.displayName = 'HeadlessPlayer'
