// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { Chunker } from './chunker'
import type { PCMChunk } from '../types'

const SAMPLE_RATE = 16_000
const TOTAL_DURATION = 150

function makeSamples(seconds: number): Float32Array {
  return Float32Array.from({ length: SAMPLE_RATE * seconds }, (_, index) => index)
}

describe('Chunker', () => {
  // Chunker uses 120 s windows with a 2 s overlap (stride 118 s) so transformers.js
  // can batch ~4 internal 30 s windows per inference call.
  it('emits overlapping chunks to preserve words near chunk boundaries', () => {
    const chunks: PCMChunk[] = []
    const chunker = new Chunker((chunk) => chunks.push(chunk), TOTAL_DURATION)

    chunker.push(makeSamples(150))
    chunker.flush()

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ timestamp: 0, final: false })
    expect(chunks[0]?.samples.length).toBe(SAMPLE_RATE * 120)
    expect(chunks[1]).toMatchObject({ timestamp: 118, final: true })
    expect(chunks[1]?.samples.length).toBe(SAMPLE_RATE * 32)
    expect(chunks[1]?.samples[0]).toBe(chunks[0]?.samples[SAMPLE_RATE * 118])
  })

  it('does not emit a duplicate final overlap for exact chunk-length audio', () => {
    const chunks: PCMChunk[] = []
    const chunker = new Chunker((chunk) => chunks.push(chunk), TOTAL_DURATION)

    chunker.push(makeSamples(120))
    chunker.flush()

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ timestamp: 0, final: false })
    expect(chunks[0]?.samples.length).toBe(SAMPLE_RATE * 120)
    expect(chunks[1]).toMatchObject({ timestamp: 118, final: true })
    expect(chunks[1]?.samples.length).toBe(0)
  })

  it('emits short audio as a single final chunk', () => {
    const chunks: PCMChunk[] = []
    const chunker = new Chunker((chunk) => chunks.push(chunk), TOTAL_DURATION)

    chunker.push(makeSamples(4))
    chunker.flush()

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ timestamp: 0, final: true })
    expect(chunks[0]?.samples.length).toBe(SAMPLE_RATE * 4)
  })

  // The ASR workers see one chunk at a time; without the total duration they cannot report an
  // absolute position, so every chunk — including the empty terminator — must carry it.
  it('stamps every emitted chunk with the total duration', () => {
    const chunks: PCMChunk[] = []
    const chunker = new Chunker((chunk) => chunks.push(chunk), TOTAL_DURATION)

    chunker.push(makeSamples(120))
    chunker.flush()

    expect(chunks).toHaveLength(2)
    expect(chunks.every((chunk) => chunk.totalDuration === TOTAL_DURATION)).toBe(true)
    expect(chunks[1]?.samples.length).toBe(0)
  })
})
