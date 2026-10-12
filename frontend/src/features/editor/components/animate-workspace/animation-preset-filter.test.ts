import { describe, expect, it } from 'vite-plus/test'
import {
  filterAnimationPresetCandidates,
  matchesAnimationPresetQuery,
} from './animation-preset-filter'

const CANDIDATES = [
  { item: 'fade-in', label: 'Fade In', compatible: true },
  { item: 'pop-in', label: 'Pop In', compatible: false },
  { item: 'fade-out', label: 'Fade Out', compatible: true },
]

describe('animation preset filtering', () => {
  it('matches labels without case sensitivity or surrounding whitespace', () => {
    expect(matchesAnimationPresetQuery('Fade In', '  FADE ')).toBe(true)
    expect(matchesAnimationPresetQuery('Pop In', 'fade')).toBe(false)
  })

  it('combines text search and compatibility filtering', () => {
    expect(filterAnimationPresetCandidates(CANDIDATES, 'in', true)).toEqual(['fade-in'])
    expect(filterAnimationPresetCandidates(CANDIDATES, '', false)).toEqual([
      'fade-in',
      'pop-in',
      'fade-out',
    ])
  })
})
