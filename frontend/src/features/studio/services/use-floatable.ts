import { useCallback, useEffect, useRef, useState } from 'react'

export type Floatable = {
  floating: boolean
  pos: { x: number; y: number }
  pop: () => void
  dock: () => void
  dragging: boolean
  onDragStart: (e: React.PointerEvent) => void
}

// Keeps the panel inside the window: a saved position from a smaller window must not hide it off screen.
function clampPos(p: { x: number; y: number }): { x: number; y: number } {
  const vw = window.innerWidth || 1280
  const vh = window.innerHeight || 800
  const x = Math.round(Math.max(4, Math.min(vw - 60, Number.isFinite(p.x) ? p.x : vw - 360)))
  const y = Math.round(Math.max(4, Math.min(vh - 40, Number.isFinite(p.y) ? p.y : 64)))
  return { x, y }
}

// Docked in the toolbar or floating anywhere in the window; the position and the mode live in localStorage.
export function useFloatable(key: string, initial: { x: number; y: number }): Floatable {
  const [floating, setFloating] = useState<boolean>(
    () => localStorage.getItem(`fl:${key}:on`) === '1',
  )
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const s = localStorage.getItem(`fl:${key}:pos`)
      if (s) return clampPos(JSON.parse(s))
    } catch {
      /* a broken saved position falls back to the initial one */
    }
    return clampPos(initial)
  })
  const [dragging, setDragging] = useState(false)
  const off = useRef({ x: 0, y: 0 })

  useEffect(() => {
    localStorage.setItem(`fl:${key}:on`, floating ? '1' : '0')
  }, [key, floating])
  useEffect(() => {
    localStorage.setItem(`fl:${key}:pos`, JSON.stringify(pos))
  }, [key, pos])
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      off.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
      setDragging(true)
      e.preventDefault()
    },
    [pos],
  )

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const x = Math.max(4, Math.min(window.innerWidth - 60, e.clientX - off.current.x))
      const y = Math.max(4, Math.min(window.innerHeight - 40, e.clientY - off.current.y))
      setPos({ x, y })
    }
    const up = () => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging])

  return {
    floating,
    pos,
    dragging,
    pop: () => {
      setPos((p) => clampPos(p))
      setFloating(true)
    },
    dock: () => setFloating(false),
    onDragStart,
  }
}

// The toolbar slot docked panels are portalled into.
export function dockSlot(): HTMLElement | null {
  return typeof document !== 'undefined' ? document.getElementById('dock-slot') : null
}
