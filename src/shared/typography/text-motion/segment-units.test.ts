// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { segmentTextUnits } from './segment-units'

describe('segmentTextUnits', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('character unit', () => {
    it('gives each non-space character its own unit and skips whitespace', () => {
      const result = segmentTextUnits(['Hi yo'], 'character')
      expect(result.lineUnitIndices).toEqual([[0, 1, null, 2, 3]])
      expect(result.unitCount).toBe(4)
    })

    it('numbers units globally across lines', () => {
      const result = segmentTextUnits(['ab', 'cd'], 'character')
      expect(result.lineUnitIndices).toEqual([
        [0, 1],
        [2, 3],
      ])
      expect(result.unitCount).toBe(4)
    })

    it('treats astral code points as single characters', () => {
      // The GPU layout iterates code points (for..of), so the parallel array
      // must count the surrogate pair as one entry.
      const result = segmentTextUnits(['a\u{1F389}b'], 'character')
      expect(result.lineUnitIndices).toEqual([[0, 1, 2]])
      expect(result.unitCount).toBe(3)
    })
  })

  describe('word unit', () => {
    it('splits on words and marks separating whitespace as null', () => {
      const result = segmentTextUnits(['Hello world'], 'word')
      expect(result.lineUnitIndices).toEqual([[0, 0, 0, 0, 0, null, 1, 1, 1, 1, 1]])
      expect(result.unitCount).toBe(2)
    })

    it('attaches punctuation to the adjacent word instead of dropping it', () => {
      const result = segmentTextUnits(['Hello, world!'], 'word')
      expect(result.lineUnitIndices).toEqual([[0, 0, 0, 0, 0, 0, null, 1, 1, 1, 1, 1, 1]])
      expect(result.unitCount).toBe(2)
    })

    it('attaches leading punctuation to the following word', () => {
      const result = segmentTextUnits(['¡Hola!'], 'word')
      expect(result.lineUnitIndices).toEqual([[0, 0, 0, 0, 0, 0]])
      expect(result.unitCount).toBe(1)
    })

    it('makes a punctuation-only line a single unit', () => {
      const result = segmentTextUnits(['...'], 'word')
      expect(result.lineUnitIndices).toEqual([[0, 0, 0]])
      expect(result.unitCount).toBe(1)
    })

    it('segments CJK text without spaces via Intl.Segmenter', () => {
      const result = segmentTextUnits(['你好世界'], 'word')
      expect(result.lineUnitIndices).toEqual([[0, 0, 1, 1]])
      expect(result.unitCount).toBe(2)
    })

    it('numbers word units globally across lines', () => {
      const result = segmentTextUnits(['hello world', 'foo'], 'word')
      expect(result.lineUnitIndices).toEqual([
        [0, 0, 0, 0, 0, null, 1, 1, 1, 1, 1],
        [2, 2, 2],
      ])
      expect(result.unitCount).toBe(3)
    })

    it('yields no units for a whitespace-only line', () => {
      const result = segmentTextUnits(['  '], 'word')
      expect(result.lineUnitIndices).toEqual([[null, null]])
      expect(result.unitCount).toBe(0)
    })

    it('falls back to whitespace splitting when Intl.Segmenter is unavailable', () => {
      vi.stubGlobal('Intl', { Segmenter: undefined })
      const result = segmentTextUnits(['Hello, world!'], 'word')
      expect(result.lineUnitIndices).toEqual([[0, 0, 0, 0, 0, 0, null, 1, 1, 1, 1, 1, 1]])
      expect(result.unitCount).toBe(2)
    })
  })

  describe('line unit', () => {
    it('gives every character of a line the line index (whitespace included)', () => {
      const result = segmentTextUnits(['ab', '', 'c d'], 'line')
      expect(result.lineUnitIndices).toEqual([[0, 0], [], [2, 2, 2]])
      expect(result.unitCount).toBe(3)
    })
  })

  describe('whole-clip unit', () => {
    it('puts every non-space code point in unit 0 across all lines', () => {
      const result = segmentTextUnits(['ab', 'c d'], 'whole-clip')
      expect(result.lineUnitIndices).toEqual([
        [0, 0],
        [0, null, 0],
      ])
      expect(result.unitCount).toBe(1)
    })

    it('is a single unit even for multi-word multi-line text', () => {
      const result = segmentTextUnits(['Hello world', 'again'], 'whole-clip')
      expect(result.unitCount).toBe(1)
      expect(result.lineUnitIndices[0]).toEqual([0, 0, 0, 0, 0, null, 0, 0, 0, 0, 0])
    })
  })

  it('handles empty input', () => {
    const result = segmentTextUnits([], 'character')
    expect(result.lineUnitIndices).toEqual([])
    expect(result.unitCount).toBe(0)
  })
})
