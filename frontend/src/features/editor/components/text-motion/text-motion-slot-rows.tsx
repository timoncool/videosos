import { memo, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { TextItem } from '@/types/timeline'
import type {
  TextMotionEffect,
  TextMotionEffectBase,
  TextMotionOrder,
  TextMotionSlot,
  TextMotionUnit,
} from '@/types/text-motion'
import {
  createTextMotionEffect,
  getTextMotionPreset,
  TEXT_MOTION_IN_PRESETS,
  TEXT_MOTION_LOOP_PRESETS,
  TEXT_MOTION_OUT_PRESETS,
  type TextMotionPreset,
} from '@/shared/typography/text-motion'
import { cn } from '@/shared/ui/cn'
import { PropertyGroupHeader, SliderInput } from '@/shared/ui/property-controls'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  applyTextMotionEffect,
  beginTextMotionEdit,
  commitTextMotionEdit,
  removeTextMotionEffect,
  updateTextMotionLive,
} from '@/features/editor/deps/timeline-store'
import { matchesAnimationPresetQuery } from '../animate-workspace/animation-preset-filter'

const SLOTS: readonly TextMotionSlot[] = ['in', 'out', 'loop']

const PRESETS_BY_SLOT: Record<TextMotionSlot, readonly TextMotionPreset[]> = {
  in: TEXT_MOTION_IN_PRESETS,
  out: TEXT_MOTION_OUT_PRESETS,
  loop: TEXT_MOTION_LOOP_PRESETS,
}

const ORDER_OPTIONS: readonly TextMotionOrder[] = ['forward', 'backward', 'center', 'random']
const UNIT_OPTIONS: readonly TextMotionUnit[] = ['character', 'word', 'line', 'whole-clip']

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

interface TextMotionSlotRowProps {
  slot: TextMotionSlot
  presets: readonly TextMotionPreset[]
  /** Active effect for this slot on the first selected text item, if any. */
  effect: TextMotionEffect | undefined
  onApply: (slot: TextMotionSlot, preset: TextMotionPreset) => void
  onRemove: (slot: TextMotionSlot) => void
  onLiveEdit: (slot: TextMotionSlot, partial: Partial<TextMotionEffectBase>) => void
  onCommitEdit: (slot: TextMotionSlot, partial: Partial<TextMotionEffectBase>) => void
  showHeading: boolean
  t: TranslateFn
}

/**
 * One motion slot (In / Out / Loop): a chip grid of that slot's presets plus,
 * when a preset is active, its parameter controls. Clicking a chip applies the
 * preset with catalog defaults (replacing whatever occupied the slot);
 * clicking the active chip (or its ✕) removes it — CapCut-style toggle. The
 * sliders tune the LIVE effect on the clip via the begin/live/commit gesture
 * pattern (one undo per drag), mirroring ContinuousMotionRow.
 */
const TextMotionSlotRow = memo(function TextMotionSlotRow({
  slot,
  presets,
  effect,
  onApply,
  onRemove,
  onLiveEdit,
  onCommitEdit,
  showHeading,
  t,
}: TextMotionSlotRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {showHeading ? (
        <PropertyGroupHeader>{t(`textMotion.slots.${slot}`)}</PropertyGroupHeader>
      ) : null}
      <div className="grid grid-cols-4 gap-1">
        {presets.map((preset) => {
          const label = t(preset.labelKey)
          const isActive = effect?.presetId === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={isActive}
              aria-label={isActive ? t('textMotion.removePreset', { name: label }) : label}
              title={label}
              onClick={() => (isActive ? onRemove(slot) : onApply(slot, preset))}
              className={cn(
                'relative truncate rounded-md border px-1 py-1.5 text-[10px] leading-tight',
                isActive
                  ? 'border-primary/60 bg-secondary/40 pr-4 text-foreground'
                  : 'border-border/60 text-muted-foreground hover:border-border hover:bg-secondary/40 hover:text-foreground',
              )}
            >
              {label}
              {isActive && (
                <X className="absolute right-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-muted-foreground" />
              )}
            </button>
          )
        })}
      </div>

      {effect && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-secondary/20 p-2">
          <SliderInput
            label={t('textMotion.duration')}
            value={effect.durationFrames}
            min={1}
            max={90}
            step={1}
            formatValue={(v) => `${Math.round(v)}f`}
            onChange={(v) => onCommitEdit(slot, { durationFrames: Math.round(v) })}
            onLiveChange={(v) => onLiveEdit(slot, { durationFrames: Math.round(v) })}
          />
          <SliderInput
            label={t('textMotion.stagger')}
            value={effect.staggerFrames}
            min={0}
            max={30}
            step={1}
            formatValue={(v) => `${Math.round(v)}f`}
            onChange={(v) => onCommitEdit(slot, { staggerFrames: Math.round(v) })}
            onLiveChange={(v) => onLiveEdit(slot, { staggerFrames: Math.round(v) })}
          />
          <SliderInput
            label={t('textMotion.intensity')}
            value={effect.intensity}
            min={0}
            max={2}
            step={0.05}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => onCommitEdit(slot, { intensity: v })}
            onLiveChange={(v) => onLiveEdit(slot, { intensity: v })}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">{t('textMotion.unit')}</span>
            <Select
              value={effect.unit ?? getTextMotionPreset(effect.presetId).unit}
              onValueChange={(value) => onCommitEdit(slot, { unit: value as TextMotionUnit })}
            >
              <SelectTrigger className="h-6 w-32 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((unit) => (
                  <SelectItem key={unit} value={unit} className="text-xs">
                    {t(`textMotion.units.${unit}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">{t('textMotion.order')}</span>
            <Select
              value={effect.order}
              onValueChange={(value) => onCommitEdit(slot, { order: value as TextMotionOrder })}
            >
              <SelectTrigger className="h-6 w-32 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_OPTIONS.map((order) => (
                  <SelectItem key={order} value={order} className="text-xs">
                    {t(`textMotion.orders.${order}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  )
})

interface TextMotionSlotRowsProps {
  /** Selected text items (callers filter the selection to `type === 'text'`). */
  items: TextItem[]
  /** Optional preset-browser query used by the Motion library. */
  query?: string
  /** Limit the shared catalog to specific intent slots. */
  slots?: readonly TextMotionSlot[]
  /** Hide the repeated In/Out/Loop label when the parent stage already names it. */
  showSlotHeading?: boolean
  /** Let embedded intent stages defer the no-results message to the library. */
  showEmptyState?: boolean
}

/**
 * The three motion-text slot rows (In / Out / Loop) — the single shared
 * implementation behind both the text properties panel and the Animate
 * workspace Text stage. Reads the active effects off the FIRST selected text
 * item (panel convention for mixed selections) and writes to every selected
 * text item through the undoable text-motion actions.
 */
export const TextMotionSlotRows = memo(function TextMotionSlotRows({
  items,
  query = '',
  slots = SLOTS,
  showSlotHeading = true,
  showEmptyState = true,
}: TextMotionSlotRowsProps) {
  const { t } = useTranslation()
  const itemIds = useMemo(() => items.map((item) => item.id), [items])
  const firstSpec = items[0]?.textMotion
  const filteredPresetsBySlot = useMemo(() => {
    const filterSlot = (slot: TextMotionSlot) =>
      PRESETS_BY_SLOT[slot].filter(
        (preset) =>
          firstSpec?.[slot]?.presetId === preset.id ||
          matchesAnimationPresetQuery(t(preset.labelKey), query),
      )

    return {
      in: filterSlot('in'),
      out: filterSlot('out'),
      loop: filterSlot('loop'),
    }
  }, [firstSpec, query, t])
  const visiblePresetCount = slots.reduce(
    (count, slot) => count + filteredPresetsBySlot[slot].length,
    0,
  )

  // One coalesced undo per slider drag: snapshot on the first live change,
  // commit on release. A direct commit (select change, typed value) snapshots
  // and commits in one shot. Gestures never overlap, so a single ref suffices.
  const editRef = useRef<ReturnType<typeof beginTextMotionEdit> | null>(null)

  const handleApply = useCallback(
    (slot: TextMotionSlot, preset: TextMotionPreset) => {
      applyTextMotionEffect(itemIds, slot, createTextMotionEffect(preset.id))
    },
    [itemIds],
  )

  const handleRemove = useCallback(
    (slot: TextMotionSlot) => {
      removeTextMotionEffect(itemIds, slot)
    },
    [itemIds],
  )

  const handleLiveEdit = useCallback(
    (slot: TextMotionSlot, partial: Partial<TextMotionEffectBase>) => {
      if (!editRef.current) editRef.current = beginTextMotionEdit()
      updateTextMotionLive(itemIds, slot, partial)
    },
    [itemIds],
  )

  const handleCommitEdit = useCallback(
    (slot: TextMotionSlot, partial: Partial<TextMotionEffectBase>) => {
      const before = editRef.current ?? beginTextMotionEdit()
      editRef.current = null
      updateTextMotionLive(itemIds, slot, partial)
      commitTextMotionEdit(before, { slot, itemIds })
    },
    [itemIds],
  )

  if (items.length === 0) return null

  if (visiblePresetCount === 0 && showEmptyState) {
    return (
      <p className="py-3 text-center text-xs text-muted-foreground" role="status">
        {t('editor.animatePresets.noMatches')}
      </p>
    )
  }
  if (visiblePresetCount === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {slots.map((slot) =>
        filteredPresetsBySlot[slot].length > 0 ? (
          <TextMotionSlotRow
            key={slot}
            slot={slot}
            presets={filteredPresetsBySlot[slot]}
            effect={firstSpec?.[slot]}
            onApply={handleApply}
            onRemove={handleRemove}
            onLiveEdit={handleLiveEdit}
            onCommitEdit={handleCommitEdit}
            showHeading={showSlotHeading}
            t={t}
          />
        ) : null,
      )}
    </div>
  )
})
