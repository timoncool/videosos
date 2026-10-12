/**
 * Motion-text actions — apply/update/remove per-slot text animations on text
 * items. The spec lives on the timeline item (`TextItem.textMotion`, see
 * src/types/text-motion.ts), so these wrap `_updateItem` in a single undo
 * block, mirroring motion-modifier-actions.ts. Applying a slot replaces any
 * existing effect in that slot (apply == set, not stack).
 */

import type {
  TextMotionEffect,
  TextMotionEffectBase,
  TextMotionSlot,
  TextMotionSpec,
} from '@/types/text-motion'
import {
  TEXT_MOTION_IN_PRESET_IDS,
  TEXT_MOTION_LOOP_PRESET_IDS,
  TEXT_MOTION_OUT_PRESET_IDS,
} from '@/shared/typography/text-motion/text-motion-preset-ids'
import { useItemsStore } from '../items-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { captureSnapshot } from '../commands/snapshot'
import type { TimelineSnapshot } from '../commands/types'
import { execute } from './shared'
import { createLogger, createOperationId } from '@/shared/logging/logger'

// Function declaration (not a module-scope const) to avoid temporal dead zone
// errors in production chunk ordering — see CLAUDE.md gotchas / shared.ts.
function getLog() {
  return createLogger('TextMotionActions')
}

const SLOT_PRESET_IDS: Record<TextMotionSlot, readonly string[]> = {
  in: TEXT_MOTION_IN_PRESET_IDS,
  out: TEXT_MOTION_OUT_PRESET_IDS,
  loop: TEXT_MOTION_LOOP_PRESET_IDS,
}

/**
 * Guard against a slot/effect mismatch — `TextMotionEffect` is a per-slot
 * presetId union, so a `loop` preset written into the `in` slot would be
 * silently invalid data (and dropped by the load sanitizer).
 */
function effectMatchesSlot(slot: TextMotionSlot, effect: TextMotionEffect): boolean {
  return SLOT_PRESET_IDS[slot].includes(effect.presetId)
}

function withSlotEffect(
  existing: TextMotionSpec | undefined,
  slot: TextMotionSlot,
  effect: TextMotionEffect,
): TextMotionSpec {
  return { ...existing, [slot]: effect } as TextMotionSpec
}

/** Remove one slot; an empty spec collapses to `undefined` (field cleared). */
function withoutSlotEffect(
  existing: TextMotionSpec | undefined,
  slot: TextMotionSlot,
): TextMotionSpec | undefined {
  if (!existing) return undefined
  const next: TextMotionSpec = { ...existing }
  delete next[slot]
  if (!next.in && !next.out && !next.loop) return undefined
  return next
}

/**
 * Set a slot's effect on every text item in the selection (single undo
 * entry). Non-text items are skipped. Returns the number of items updated.
 */
export function applyTextMotionEffect(
  itemIds: string[],
  slot: TextMotionSlot,
  effect: TextMotionEffect,
): number {
  if (itemIds.length === 0) return 0
  if (!effectMatchesSlot(slot, effect)) {
    getLog().warn(`applyTextMotionEffect: preset '${effect.presetId}' is not a '${slot}' preset`)
    return 0
  }

  const event = getLog().startEvent('applyTextMotionEffect', createOperationId())
  event.merge({ requested: itemIds.length, slot, presetId: effect.presetId })

  try {
    const updated = execute(
      'APPLY_TEXT_MOTION',
      () => {
        const store = useItemsStore.getState()
        let count = 0
        for (const itemId of itemIds) {
          const item = store.itemById[itemId]
          if (!item || item.type !== 'text') continue
          store._updateItem(itemId, {
            textMotion: withSlotEffect(item.textMotion, slot, effect),
          })
          count += 1
        }
        if (count > 0) {
          useTimelineSettingsStore.getState().markDirty()
        }
        return count
      },
      { count: itemIds.length, slot },
    )
    event.success({ updated })
    return updated
  } catch (error) {
    event.failure(error)
    throw error
  }
}

/**
 * Live (no-undo) partial update of a slot's parameters — for panel slider
 * drags. Each call mutates the store directly so the preview tracks the drag;
 * undo is added once at the end of the gesture via
 * {@link commitTextMotionEdit}. Items without the slot are skipped (there is
 * nothing to partially update).
 */
export function updateTextMotionLive(
  itemIds: string[],
  slot: TextMotionSlot,
  partial: Partial<TextMotionEffectBase>,
): void {
  if (itemIds.length === 0) return
  const store = useItemsStore.getState()
  for (const itemId of itemIds) {
    const item = store.itemById[itemId]
    if (!item || item.type !== 'text') continue
    const current = item.textMotion?.[slot]
    if (!current) continue
    store._updateItem(itemId, {
      textMotion: withSlotEffect(item.textMotion, slot, { ...current, ...partial }),
    })
  }
}

/** Snapshot before a live text-motion edit gesture (drag start). */
export function beginTextMotionEdit(): TimelineSnapshot {
  return captureSnapshot()
}

/**
 * Close a live text-motion edit gesture: record a single undo entry spanning
 * the whole drag (against the pre-drag `before` snapshot) and mark the
 * project dirty.
 */
export function commitTextMotionEdit(
  before: TimelineSnapshot,
  meta?: { slot?: TextMotionSlot; itemIds?: string[] },
): void {
  // Thread the gesture's slot + edited items into the command payload so the
  // undo entry carries context (and `ids` feeds the count in its label).
  const payload: Record<string, unknown> = {}
  if (meta?.slot) payload.slot = meta.slot
  if (meta?.itemIds && meta.itemIds.length > 0) payload.ids = meta.itemIds
  useTimelineCommandStore.getState().addUndoEntry({ type: 'UPDATE_TEXT_MOTION', payload }, before)
  useTimelineSettingsStore.getState().markDirty()
}

/**
 * Remove a slot's effect from every listed item (single undo entry). When the
 * last slot is removed, `textMotion` collapses to `undefined`. Returns the
 * number of items that actually had the slot removed.
 */
export function removeTextMotionEffect(itemIds: string[], slot: TextMotionSlot): number {
  if (itemIds.length === 0) return 0

  return execute(
    'REMOVE_TEXT_MOTION',
    () => {
      const store = useItemsStore.getState()
      let updated = 0
      for (const itemId of itemIds) {
        const item = store.itemById[itemId]
        if (!item || item.type !== 'text' || !item.textMotion?.[slot]) continue
        store._updateItem(itemId, {
          textMotion: withoutSlotEffect(item.textMotion, slot),
        })
        updated += 1
      }
      if (updated > 0) {
        useTimelineSettingsStore.getState().markDirty()
      }
      return updated
    },
    { count: itemIds.length, slot },
  )
}
