import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { usePropertyFilters } from './use-property-filters'

const groups = [
  { id: 'transform', label: 'Transform', properties: ['x'] as const },
  {
    id: 'effects',
    label: 'Effects',
    properties: ['effect:gpu-exposure:fx-1:exposure'] as const,
  },
]

describe('usePropertyFilters', () => {
  it('uses a workspace-provided initial group selection without locking the menu', async () => {
    const { result } = renderHook(() =>
      usePropertyFilters({
        allPropertyGroups: groups.map((group) => ({ ...group, properties: [...group.properties] })),
        availableProperties: ['x', 'effect:gpu-exposure:fx-1:exposure'],
        initialVisibleGroupIds: ['effects'],
      }),
    )

    await waitFor(() =>
      expect(result.current.visibleGroups).toEqual({ transform: false, effects: true }),
    )

    result.current.toggleVisibleGroup('transform')
    await waitFor(() => expect(result.current.visibleGroups.transform).toBe(true))
  })
})
