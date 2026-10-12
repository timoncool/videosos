// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { QueuedStereoBufferSource } from './soundtouch-preview-source'

function makeStereoChunk(startFrame: number, left: number[], right: number[]) {
  return {
    startFrame,
    frameCount: Math.min(left.length, right.length),
    leftChannel: new Float32Array(left),
    rightChannel: new Float32Array(right),
  }
}

describe('QueuedStereoBufferSource', () => {
  it('extracts continuously across appended chunks', () => {
    const source = new QueuedStereoBufferSource()
    source.append(makeStereoChunk(4, [1, 2], [11, 12]))
    source.append(makeStereoChunk(6, [3, 4, 5], [13, 14, 15]))

    const target = new Float32Array(10)
    const frames = source.extract(target, 5, 4)

    expect(frames).toBe(5)
    expect(Array.from(target)).toEqual([1, 11, 2, 12, 3, 13, 4, 14, 5, 15])
  })

  it('prefers the newest chunk for overlapping coverage and drops fully covered old chunks', () => {
    const source = new QueuedStereoBufferSource()
    source.append(makeStereoChunk(4, [1, 2, 3], [11, 12, 13]))
    source.append(makeStereoChunk(0, [7, 8, 9, 10, 11, 12, 13], [17, 18, 19, 20, 21, 22, 23]))

    const target = new Float32Array(6)
    const frames = source.extract(target, 3, 4)

    expect(frames).toBe(3)
    expect(Array.from(target)).toEqual([11, 21, 12, 22, 13, 23])
  })

  it('stops at gaps and resumes cleanly after clear', () => {
    const source = new QueuedStereoBufferSource()
    source.append(makeStereoChunk(10, [1, 2], [11, 12]))

    const gapTarget = new Float32Array(4)
    expect(source.extract(gapTarget, 2, 8)).toBe(0)

    source.clear()
    source.append(makeStereoChunk(0, [5, 6], [15, 16]))

    const target = new Float32Array(4)
    expect(source.extract(target, 2, 0)).toBe(2)
    expect(Array.from(target)).toEqual([5, 15, 6, 16])
  })

  it('extracts backwards from the newest reverse seek anchor', () => {
    const source = new QueuedStereoBufferSource()
    source.append(makeStereoChunk(4, [1, 2, 3, 4, 5], [11, 12, 13, 14, 15]))
    source.setReadDirection(-1, 8)

    const first = new Float32Array(6)
    expect(source.extract(first, 3, 0)).toBe(3)
    expect(Array.from(first)).toEqual([5, 15, 4, 14, 3, 13])

    const second = new Float32Array(4)
    expect(source.extract(second, 2, 3)).toBe(2)
    expect(Array.from(second)).toEqual([2, 12, 1, 11])
  })

  it('returns to forward extraction after a reverse seek', () => {
    const source = new QueuedStereoBufferSource()
    source.append(makeStereoChunk(0, [1, 2, 3], [11, 12, 13]))
    source.setReadDirection(-1, 2)
    source.setReadDirection(1)

    const target = new Float32Array(4)
    expect(source.extract(target, 2, 1)).toBe(2)
    expect(Array.from(target)).toEqual([2, 12, 3, 13])
  })
})
