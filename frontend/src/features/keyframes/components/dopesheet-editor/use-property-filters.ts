/**
 * Property filter hook.
 * Owns the dopesheet's filter state — group visibility, keyframed-only
 * mode, and per-property lock state — plus the normalization effects
 * that keep each map in sync with the current set of properties/groups,
 * and the mutators (toggle, group-set).
 *
 * Kept separate from useGroupExpansion because filtered rows depend on
 * this hook's output, and group-expanded state depends on those rows.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnimatableProperty } from '@/types/keyframe'
import type { PropertyAccordionGroup } from './property-groups'

interface UsePropertyFiltersOptions {
  allPropertyGroups: PropertyAccordionGroup[]
  availableProperties: AnimatableProperty[]
  initialVisibleGroupIds?: readonly string[]
}

export interface UsePropertyFiltersReturn {
  visibleGroups: Record<string, boolean>
  setVisibleGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  showKeyframedOnly: boolean
  setShowKeyframedOnly: React.Dispatch<React.SetStateAction<boolean>>
  lockedProperties: Partial<Record<AnimatableProperty, boolean>>
  toggleVisibleGroup: (groupId: string) => void
  isPropertyLocked: (property: AnimatableProperty) => boolean
  toggleLockedProperty: (property: AnimatableProperty) => void
  setGroupLocked: (properties: AnimatableProperty[], locked: boolean) => void
}

export function usePropertyFilters({
  allPropertyGroups,
  availableProperties,
  initialVisibleGroupIds,
}: UsePropertyFiltersOptions): UsePropertyFiltersReturn {
  const initialVisibleGroupIdsRef = useRef(
    initialVisibleGroupIds ? new Set(initialVisibleGroupIds) : null,
  )
  const [visibleGroups, setVisibleGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      allPropertyGroups.map((group) => [
        group.id,
        initialVisibleGroupIdsRef.current?.has(group.id) ?? true,
      ]),
    ),
  )
  const [showKeyframedOnly, setShowKeyframedOnly] = useState(false)
  const [lockedProperties, setLockedProperties] = useState<
    Partial<Record<AnimatableProperty, boolean>>
  >({})

  // Keep visibleGroups in sync with the actual set of groups
  useEffect(() => {
    const groupIds = new Set(allPropertyGroups.map((group) => group.id))

    setVisibleGroups((prev) => {
      const next = { ...prev }
      let changed = false

      for (const groupId of groupIds) {
        if (next[groupId] === undefined) {
          next[groupId] = initialVisibleGroupIdsRef.current?.has(groupId) ?? true
          changed = true
        }
      }

      for (const groupId of Object.keys(next)) {
        if (!groupIds.has(groupId)) {
          delete next[groupId]
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [allPropertyGroups])

  // Keep lockedProperties in sync with the actual set of properties
  useEffect(() => {
    const propertyIds = new Set(availableProperties)

    setLockedProperties((prev) => {
      const next = { ...prev }
      let changed = false

      for (const property of propertyIds) {
        if (next[property] === undefined) {
          next[property] = false
          changed = true
        }
      }

      for (const property of Object.keys(next) as AnimatableProperty[]) {
        if (!propertyIds.has(property)) {
          delete next[property]
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [availableProperties])

  const toggleVisibleGroup = useCallback((groupId: string) => {
    setVisibleGroups((prev) => ({
      ...prev,
      [groupId]: !(prev[groupId] ?? true),
    }))
  }, [])

  const isPropertyLocked = useCallback(
    (property: AnimatableProperty) => lockedProperties[property] ?? false,
    [lockedProperties],
  )

  const toggleLockedProperty = useCallback((property: AnimatableProperty) => {
    setLockedProperties((prev) => ({
      ...prev,
      [property]: !(prev[property] ?? false),
    }))
  }, [])

  const setGroupLocked = useCallback((properties: AnimatableProperty[], locked: boolean) => {
    setLockedProperties((prev) => ({
      ...prev,
      ...Object.fromEntries(properties.map((property) => [property, locked])),
    }))
  }, [])

  return {
    visibleGroups,
    setVisibleGroups,
    showKeyframedOnly,
    setShowKeyframedOnly,
    lockedProperties,
    toggleVisibleGroup,
    isPropertyLocked,
    toggleLockedProperty,
    setGroupLocked,
  }
}
