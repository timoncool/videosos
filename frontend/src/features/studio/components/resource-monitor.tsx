import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Move, PictureInPicture2, Minimize2 } from 'lucide-react'
import { api, type HwSnapshot } from '../services/studio-api'
import { useFloatable, dockSlot } from '../services/use-floatable'

const gb = (n: number) => n / 1024 ** 3

function heat(pct: number): string {
  if (pct >= 90) return 'var(--color-danger, #ef4444)'
  if (pct >= 70) return 'var(--color-warn, #f59e0b)'
  return 'var(--color-accent, #22d3ee)'
}

/// A glowing dot coloured by load, shared by the docked chip and the floating panel.
function Dot({ pct }: { pct: number }) {
  const c = heat(pct)
  return (
    <span
      className="w-1.5 h-1.5 rounded-full"
      style={{ background: c, boxShadow: `0 0 8px ${c}` }}
    />
  )
}

function Bar({ label, pct, right }: { label: string; pct: number; right: string }) {
  const p = Math.max(0, Math.min(100, pct))
  const c = heat(p)
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] mb-1">
        <span className="text-[var(--color-muted)]">{label}</span>
        <span className="mono tabular-nums text-[var(--color-fg,#e5e7eb)]">{right}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${p}%`, background: c, boxShadow: `0 0 8px ${c}` }}
        />
      </div>
    </div>
  )
}

export default function ResourceMonitor() {
  const { t } = useTranslation()
  const unitGb = t('units.gb')
  const fmtGb = (n: number) => `${gb(n).toFixed(1)} ${unitGb}`
  const [hw, setHw] = useState<HwSnapshot | null>(null)
  const [ok, setOk] = useState(true)
  const [, force] = useState(0)
  const fl = useFloatable('monitor', { x: window.innerWidth - 268, y: 64 })
  const timer = useRef<number | null>(null)

  useEffect(() => {
    force((n) => n + 1)
  }, [])
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const s = await api.hwSnapshot()
        if (alive) {
          setHw(s)
          setOk(true)
        }
      } catch {
        if (alive) setOk(false)
      }
    }
    poll()
    timer.current = window.setInterval(poll, 1000)
    return () => {
      alive = false
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [])

  if (!ok || !hw || (!hw.gpuName && hw.totalRam === 0)) return null

  const vramPct = hw.totalVram ? (hw.usedVram / hw.totalVram) * 100 : 0
  const ramPct = hw.totalRam ? (hw.usedRam / hw.totalRam) * 100 : 0
  const powerPct = hw.powerLimit ? (hw.powerDraw / hw.powerLimit) * 100 : 0
  const hasGpu = !!hw.gpuName
  const lead = hasGpu ? hw.gpuUtilization : ramPct

  if (!fl.floating) {
    const slot = dockSlot()
    if (!slot) return null
    return createPortal(
      <button
        onClick={fl.pop}
        title={t('monitor.popOut')}
        className="inline-flex shrink-0 whitespace-nowrap items-center gap-2 px-2.5 h-8 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
      >
        <Dot pct={lead} />
        {hasGpu && (
          <span className="mono text-[11px] tabular-nums">{Math.round(hw.gpuUtilization)}%</span>
        )}
        <span className="mono text-[11px] text-[var(--color-muted)] tabular-nums hidden md:inline">
          {hasGpu ? `${fmtGb(hw.usedVram)}/${fmtGb(hw.totalVram)}` : `RAM ${Math.round(ramPct)}%`}
        </span>
        <PictureInPicture2 size={13} className="text-[var(--color-muted)]" />
      </button>,
      slot,
    )
  }

  return (
    <div className="fixed z-50 select-none w-[248px]" style={{ left: fl.pos.x, top: fl.pos.y }}>
      <div className="rounded-xl border border-white/10 bg-[var(--color-panel,rgba(18,20,26,0.94))] backdrop-blur-md shadow-[0_10px_36px_rgba(0,0,0,0.5)] overflow-hidden">
        <div
          onPointerDown={fl.onDragStart}
          className={`flex items-center gap-2 px-3 py-2 ${fl.dragging ? 'cursor-grabbing' : 'cursor-grab'} border-b border-white/5`}
        >
          <Move size={12} className="text-[var(--color-muted)]" />
          <Dot pct={lead} />
          <span className="text-[12px] font-semibold truncate flex-1">
            {hasGpu ? hw.gpuName.replace(/NVIDIA GeForce /i, '') : t('monitor.title')}
          </span>
          {hasGpu && (
            <span className="mono text-[11px] text-[var(--color-muted)]">
              {Math.round(hw.temperature)}°
            </span>
          )}
          <button
            onClick={fl.dock}
            title={t('float.dock')}
            className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <Minimize2 size={13} />
          </button>
        </div>
        <div className="px-3 pb-3 pt-2 space-y-2.5">
          {hasGpu && (
            <>
              <Bar
                label="GPU"
                pct={hw.gpuUtilization}
                right={`${Math.round(hw.gpuUtilization)}%`}
              />
              <Bar
                label="VRAM"
                pct={vramPct}
                right={`${fmtGb(hw.usedVram)} / ${fmtGb(hw.totalVram)}`}
              />
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--color-muted)]">{t('monitor.power')}</span>
                <span className="mono tabular-nums">
                  {Math.round(hw.powerDraw)} / {Math.round(hw.powerLimit)} {t('units.watt')}
                </span>
              </div>
              <div className="h-1 rounded-full bg-white/8 overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.min(100, powerPct)}%`, background: heat(powerPct) }}
                />
              </div>
            </>
          )}
          <Bar label="RAM" pct={ramPct} right={`${fmtGb(hw.usedRam)} / ${fmtGb(hw.totalRam)}`} />
          <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)]">
            <span>{t('monitor.process')}</span>
            <span className="mono tabular-nums">{fmtGb(hw.processRam)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
