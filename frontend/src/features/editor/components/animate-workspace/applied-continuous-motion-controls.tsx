import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Settings2, Trash2, WandSparkles, Waves } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { TimelineItem } from '@/types/timeline'
import type {
  MotionModifierChannel,
  MotionModifierChannelGains,
  MotionModifierType,
} from '@/types/motion'
import type { CanvasSettings } from '@/types/transform'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { MotionBakeConfirmationDialog } from '@/shared/ui/motion-bake-confirmation-dialog'
import { SliderInput } from '@/shared/ui/property-controls'
import {
  applyMotionModifierToItems,
  bakeMotionToKeyframes,
  beginMotionModifierEdit,
  commitMotionModifierEdit,
  removeAudioPulseFromItems,
  removeMotionLayerFromItems,
  removeMotionModifierFromItems,
  updateMotionModifiersLive,
  useKeyframesStore,
} from '@/features/editor/deps/timeline-store'
import { getSourceDimensions, resolveTransform } from '@/features/editor/deps/composition-runtime'
import {
  buildBakeMotionPlan,
  getMotionModifierSettings,
  MOTION_MODULATORS,
  updateMotionModifierSettings,
  type MotionModulator,
} from '@/features/editor/deps/keyframes'

interface ModifierEditSettings {
  intensityScale?: number
  durationScale?: number
  channelGains?: MotionModifierChannelGains
}

interface AppliedContinuousMotionControlsProps {
  items: TimelineItem[]
  canvas: CanvasSettings
  /** Rows slot directly into Motion's existing Applied summary. */
  variant?: 'panel' | 'rows'
  showBakeAction?: boolean
}

function AppliedMotionRow({
  label,
  detail,
  removeLabel,
  onRemove,
}: {
  label: string
  detail: string
  removeLabel: string
  onRemove: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-background/50 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-foreground">{label}</div>
        <div className="truncate text-[10px] text-muted-foreground">{detail}</div>
      </div>
      <button
        type="button"
        aria-label={removeLabel}
        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        onClick={onRemove}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}

const AppliedModifierRow = memo(function AppliedModifierRow({
  modulator,
  settings,
  onLiveEdit,
  onCommitEdit,
  onRemove,
}: {
  modulator: MotionModulator
  settings: ReturnType<typeof getMotionModifierSettings>
  onLiveEdit: (settings: ModifierEditSettings) => void
  onCommitEdit: (settings: ModifierEditSettings) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const label = t(`editor.motionGenerator.modulators.${modulator.labelKey}`)
  const channelGain = (channel: MotionModifierChannel) => settings.channelGains[channel] ?? 1

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-background/50 px-2 py-1.5">
      <Waves className="h-3.5 w-3.5 shrink-0 text-sky-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-foreground">{label}</div>
        <div className="truncate text-[10px] text-muted-foreground">
          {t('editor.animateStages.scopeLayer')} · {t('editor.animateStages.liveBadge')}
        </div>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${t('editor.motionGenerator.title')}: ${label}`}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-56 space-y-2 p-2">
          <div className="text-[11px] font-medium text-foreground">{label}</div>
          <div className="flex flex-col gap-1.5">
            <SliderInput
              label={t('editor.motionGenerator.intensity')}
              value={settings.intensityScale}
              min={0}
              max={2}
              step={0.05}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) => onCommitEdit({ intensityScale: value })}
              onLiveChange={(value) => onLiveEdit({ intensityScale: value })}
            />
            <SliderInput
              label={t('editor.motionGenerator.duration')}
              value={settings.durationScale}
              min={0.25}
              max={3}
              step={0.05}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) => onCommitEdit({ durationScale: value })}
              onLiveChange={(value) => onLiveEdit({ durationScale: value })}
            />
          </div>
          <Separator />
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t('timeline.keyframeEditor.parameters')}
            </div>
            {modulator.properties.map((property) => (
              <SliderInput
                key={property}
                label={t(`keyframes.properties.${property}`)}
                value={channelGain(property)}
                min={0}
                max={2}
                step={0.05}
                formatValue={(value) => `${Math.round(value * 100)}%`}
                onChange={(value) => onCommitEdit({ channelGains: { [property]: value } })}
                onLiveChange={(value) => onLiveEdit({ channelGains: { [property]: value } })}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('editor.motionGenerator.removeAction')}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  )
})

/**
 * Shared access to live whole-layer motion. Edit uses the compact panel for
 * legacy/current timeline clips; Motion embeds the same rows in its Applied
 * summary so both surfaces edit the exact same modifier records.
 */
export const AppliedContinuousMotionControls = memo(function AppliedContinuousMotionControls({
  items,
  canvas,
  variant = 'panel',
  showBakeAction = false,
}: AppliedContinuousMotionControlsProps) {
  const { t } = useTranslation()
  const keyframesByItemId = useKeyframesStore((state) => state.keyframesByItemId)
  const [bakeDialogOpen, setBakeDialogOpen] = useState(false)
  const modifierEditRef = useRef<ReturnType<typeof beginMotionModifierEdit> | null>(null)
  const itemIds = useMemo(() => items.map((item) => item.id), [items])
  const activeModulators = useMemo(
    () =>
      MOTION_MODULATORS.filter((modulator) =>
        items.some((item) =>
          item.motionModifiers?.some(
            (modifier) => modifier.type === modulator.id && modifier.enabled,
          ),
        ),
      ),
    [items],
  )
  const settingsByType = useMemo(() => {
    const settings = new Map<MotionModifierType, ReturnType<typeof getMotionModifierSettings>>()
    for (const item of items) {
      for (const modifier of item.motionModifiers ?? []) {
        if (modifier.enabled && !settings.has(modifier.type)) {
          settings.set(modifier.type, getMotionModifierSettings(modifier))
        }
      }
    }
    return settings
  }, [items])
  const activeMotionLayers = useMemo(() => {
    const layers = new Map<string, NonNullable<TimelineItem['motionLayers']>[number]>()
    for (const item of items) {
      for (const layer of item.motionLayers ?? []) {
        if (layer.enabled && !layers.has(layer.id)) layers.set(layer.id, layer)
      }
    }
    return [...layers.values()]
  }, [items])
  const hasAudioPulse = useMemo(
    () => items.some((item) => item.effects?.some((effect) => effect.audioPulse?.enabled)),
    [items],
  )
  const hasBakeableMotion =
    activeModulators.length > 0 || activeMotionLayers.length > 0 || hasAudioPulse

  const buildAssignments = useCallback(
    (type: MotionModifierType, settings: ModifierEditSettings) =>
      items.flatMap((item) => {
        const existing = item.motionModifiers?.find(
          (modifier) => modifier.type === type && modifier.enabled,
        )
        return existing
          ? [{ itemId: item.id, modifier: updateMotionModifierSettings(existing, settings) }]
          : []
      }),
    [items],
  )

  const handleLiveEdit = useCallback(
    (type: MotionModifierType, settings: ModifierEditSettings) => {
      const assignments = buildAssignments(type, settings)
      if (assignments.length === 0) return
      if (!modifierEditRef.current) modifierEditRef.current = beginMotionModifierEdit()
      updateMotionModifiersLive(assignments)
    },
    [buildAssignments],
  )

  const handleCommitEdit = useCallback(
    (type: MotionModifierType, settings: ModifierEditSettings) => {
      const assignments = buildAssignments(type, settings)
      if (assignments.length === 0) return
      if (modifierEditRef.current) {
        updateMotionModifiersLive(assignments)
        commitMotionModifierEdit(modifierEditRef.current, {
          type,
          itemIds: assignments.map((assignment) => assignment.itemId),
        })
        modifierEditRef.current = null
      } else {
        applyMotionModifierToItems(assignments)
      }
    },
    [buildAssignments],
  )

  const handleRemoveModulator = useCallback(
    (modulator: MotionModulator) => {
      removeMotionModifierFromItems(itemIds, modulator.id)
      toast.success(
        t('editor.motionGenerator.modulatorRemoved', {
          name: t(`editor.motionGenerator.modulators.${modulator.labelKey}`),
        }),
      )
    },
    [itemIds, t],
  )

  const handleBakeMotion = useCallback(() => {
    const plan = buildBakeMotionPlan({
      items,
      keyframesByItemId,
      fps: canvas.fps,
      frameWidth: canvas.width,
      frameHeight: canvas.height,
      resolveBase: (item) => resolveTransform(item, canvas, getSourceDimensions(item)),
    })
    if (plan.length === 0) {
      toast.warning(t('editor.motionGenerator.bakeNoMotion'))
      return
    }
    const baked = bakeMotionToKeyframes(plan)
    setBakeDialogOpen(false)
    toast.success(t('editor.motionGenerator.motionBaked', { count: baked }))
  }, [canvas, items, keyframesByItemId, t])

  if (!hasBakeableMotion) return null

  const rows = (
    <>
      {activeModulators.map((modulator) => {
        const settings = settingsByType.get(modulator.id)
        if (!settings) return null
        return (
          <AppliedModifierRow
            key={modulator.id}
            modulator={modulator}
            settings={settings}
            onLiveEdit={(next) => handleLiveEdit(modulator.id, next)}
            onCommitEdit={(next) => handleCommitEdit(modulator.id, next)}
            onRemove={() => handleRemoveModulator(modulator)}
          />
        )
      })}
      {activeMotionLayers.map((layer) => (
        <AppliedMotionRow
          key={layer.id}
          label={layer.name}
          detail={`${t('editor.animateStages.additiveLayer')} · ${t('editor.animateStages.liveBadge')}`}
          removeLabel={t('editor.animateStages.removeMotionLayer', { name: layer.name })}
          onRemove={() => removeMotionLayerFromItems(itemIds, layer.id)}
        />
      ))}
      {hasAudioPulse ? (
        <AppliedMotionRow
          label={t('editor.animateStages.audioPulseChip')}
          detail={t('editor.animateStages.liveBadge')}
          removeLabel={t('editor.animateStages.removeAudioPulse')}
          onRemove={() => removeAudioPulseFromItems(itemIds)}
        />
      ) : null}
    </>
  )

  if (variant === 'rows') return rows

  return (
    <>
      <section
        data-testid="applied-continuous-motion-controls"
        className="flex flex-col gap-2 rounded-md border border-border/60 bg-secondary/20 p-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t('editor.animateStages.appliedTitle')}
          </span>
          <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-medium text-sky-400">
            {t('editor.animateStages.liveBadge')}
          </span>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground/70">
          {t('editor.animateStages.continuousHint')}
        </p>
        <div className="flex flex-col gap-1">{rows}</div>
        {showBakeAction ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full justify-start gap-1.5 px-2 text-[11px]"
            onClick={() => setBakeDialogOpen(true)}
          >
            <WandSparkles className="h-3.5 w-3.5" />
            {t('editor.motionGenerator.bakeToKeyframes')}
          </Button>
        ) : null}
      </section>
      <MotionBakeConfirmationDialog
        open={bakeDialogOpen}
        onOpenChange={setBakeDialogOpen}
        onConfirm={handleBakeMotion}
      />
    </>
  )
})
