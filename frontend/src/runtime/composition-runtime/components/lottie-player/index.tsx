import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AbsoluteFill, useSequenceContext } from '@/runtime/composition-runtime/deps/player'
import { useVideoConfig } from '../../hooks/use-player-compat'
import {
  LottieRenderer,
  mapTimelineFrameToLottieFrame,
} from '@/infrastructure/lottie/lottie-frame-provider'
import { resolveLottieRenderSpec } from '@/infrastructure/lottie/lottie-text'
import type { LottieItem } from '@/types/timeline'

interface LottiePlayerProps {
  item: LottieItem
}

/**
 * Renders a Lottie animation synced to the timeline frame.
 *
 * dotlottie-web renders the requested frame synchronously into the canvas, so
 * (unlike the GIF player) there is no frame pre-extraction — we just seek on
 * every `localFrame` change. The canvas is sized to the animation's native
 * resolution and CSS-stretched; the surrounding ItemVisualWrapper handles fit.
 */
export const LottiePlayer: React.FC<LottiePlayerProps> = ({ item }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<LottieRenderer | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const sequenceContext = useSequenceContext()
  const localFrame = sequenceContext?.localFrame ?? 0
  const { fps } = useVideoConfig()

  // Serialize the render inputs so the renderer only rebuilds when the selected
  // animation/theme or text/color edits change.
  const overridesKey = useMemo(
    () =>
      JSON.stringify({
        a: item.animationId ?? null,
        m: item.themeId ?? null,
        t: item.textOverrides ?? null,
        c: item.colorOverrides ?? null,
        s: item.slotOverrides ?? null,
      }),
    [item.animationId, item.themeId, item.textOverrides, item.colorOverrides, item.slotOverrides],
  )

  // (Re)create the renderer when the source (or text overrides) change.
  // autoResize lets dotlottie size its render target to the displayed canvas.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !item.src) return

    setLoaded(false)
    setFailed(false)

    let cancelled = false
    let renderer: LottieRenderer | null = null

    void (async () => {
      // Resolve the selected animation/theme + text/color edits before render;
      // `data` is null when nothing needs patching (load `src` directly).
      const spec = await resolveLottieRenderSpec(item.src, item)
      if (cancelled) return
      renderer = new LottieRenderer({
        canvas,
        autoResize: true,
        themeData: spec.themeData ?? undefined,
        slots: spec.slots ?? undefined,
        ...(spec.data ? { data: spec.data } : { src: item.src }),
      })
      rendererRef.current = renderer
      await renderer.ready
      if (cancelled) return
      if (renderer.isLoaded) setLoaded(true)
      else setFailed(true)
    })()

    return () => {
      cancelled = true
      renderer?.destroy()
      rendererRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overridesKey stands in for item.textOverrides
  }, [item.src, overridesKey])

  // Seek to the frame for the current timeline position.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !loaded) return
    const lottieFrame = mapTimelineFrameToLottieFrame({
      localFrame,
      projectFps: fps,
      speed: item.speed ?? 1,
      totalFrames: item.totalFrames,
      frameRate: item.frameRate,
      loop: item.loop ?? true,
      reversed: item.reversed,
      loopMode: item.loopMode,
      segmentStart: item.segmentStart,
      segmentEnd: item.segmentEnd,
    })
    renderer.renderFrame(lottieFrame)
  }, [
    localFrame,
    loaded,
    fps,
    item.speed,
    item.totalFrames,
    item.frameRate,
    item.loop,
    item.reversed,
    item.loopMode,
    item.segmentStart,
    item.segmentEnd,
  ])

  if (failed) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: '#ff6b6b', fontSize: 14 }}>Lottie load failed</span>
      </AbsoluteFill>
    )
  }

  return (
    <AbsoluteFill>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </AbsoluteFill>
  )
}
