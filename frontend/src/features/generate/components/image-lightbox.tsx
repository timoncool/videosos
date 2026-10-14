import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Minus, Plus, X } from 'lucide-react'

/**
 * One image, as large as the screen allows, as the music studios show a cover: the wheel zooms, dragging pans,
 * double-click returns it to fitting the window, and Escape closes.
 */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragging = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === '+' || event.key === '=') setScale((value) => Math.min(8, value * 1.25))
      if (event.key === '-') setScale((value) => Math.max(0.2, value / 1.25))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  // over the whole window: the panel it is opened from is transformed, which would hold a fixed element inside it
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || t('generate.zoom.title')}
      className="fixed inset-0 z-[90] flex flex-col bg-black/90 backdrop-blur-sm"
      onWheel={(event) => setScale((value) => Math.min(8, Math.max(0.2, value * (event.deltaY < 0 ? 1.12 : 1 / 1.12))))}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white/80">
        <span className="truncate text-sm">{alt}</span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t('generate.zoom.out')} title={t('generate.zoom.out')} onClick={() => setScale((value) => Math.max(0.2, value / 1.25))} className="rounded-lg p-2 hover:bg-white/10"><Minus size={16} /></button>
          <button type="button" aria-label={t('generate.zoom.fit')} title={t('generate.zoom.fit')} onClick={reset} className="tabnum rounded-lg px-3 py-2 text-xs hover:bg-white/10">{Math.round(scale * 100)}%</button>
          <button type="button" aria-label={t('generate.zoom.in')} title={t('generate.zoom.in')} onClick={() => setScale((value) => Math.min(8, value * 1.25))} className="rounded-lg p-2 hover:bg-white/10"><Plus size={16} /></button>
          <button type="button" aria-label={t('generate.zoom.close')} title={t('generate.zoom.close')} onClick={onClose} className="ml-1 rounded-lg p-2 hover:bg-white/10"><X size={18} /></button>
        </div>
      </div>
      <div
        className="flex flex-1 items-center justify-center overflow-hidden"
        onPointerDown={(event) => {
          dragging.current = { x: event.clientX - offset.x, y: event.clientY - offset.y }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return
          setOffset({ x: event.clientX - dragging.current.x, y: event.clientY - dragging.current.y })
        }}
        onPointerUp={() => {
          dragging.current = null
        }}
        onDoubleClick={reset}
        onClick={(event) => {
          if (event.target === event.currentTarget && scale === 1) onClose()
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-[85vh] max-w-[92vw] select-none rounded-lg shadow-2xl"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, cursor: scale > 1 ? 'grab' : 'zoom-in' }}
        />
      </div>
    </div>,
    document.body,
  )
}
