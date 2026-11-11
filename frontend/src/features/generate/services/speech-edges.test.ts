import { describe, expect, it } from 'vite-plus/test'
import { speechEdges } from './speech-edges'

const RATE = 24_000

function silence(seconds: number): number[] {
  return new Array(Math.round(seconds * RATE)).fill(0)
}

function tone(seconds: number, amplitude: number): number[] {
  return Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE))
}

describe('speechEdges', () => {
  it('finds the silence at both ends and keeps 60 ms past the speech', () => {
    const samples = Float32Array.from([...silence(0.5), ...tone(1, 0.5), ...silence(0.8)])
    const edges = speechEdges(samples, RATE)
    expect(edges.leadSeconds).toBeCloseTo(0.44, 3)
    expect(edges.tailSeconds).toBeCloseTo(0.74, 3)
  })

  it('keeps a quiet final consonant inside the 60 ms past the speech', () => {
    const quiet = 10 ** (-55 / 20)
    const samples = Float32Array.from([...silence(0.5), ...tone(1, 0.5), ...tone(0.04, quiet), ...silence(0.8)])
    expect(speechEdges(samples, RATE).tailSeconds).toBeCloseTo(0.78, 3)
  })

  it('leaves a clip with no speech and one with no silence as they are', () => {
    expect(speechEdges(Float32Array.from(silence(1)), RATE)).toEqual({ leadSeconds: 0, tailSeconds: 0 })
    expect(speechEdges(Float32Array.from(tone(1, 0.5)), RATE)).toEqual({ leadSeconds: 0, tailSeconds: 0 })
  })
})
