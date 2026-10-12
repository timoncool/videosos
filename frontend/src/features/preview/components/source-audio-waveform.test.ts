import { describe, expect, it } from 'vite-plus/test'
import {
  getSourceWaveformSeekTime,
  sampleSourceWaveformAmplitudes,
} from './source-audio-waveform-utils'

describe('source audio waveform sampling', () => {
  it('samples mono peaks across the full source duration', () => {
    const amplitudes = sampleSourceWaveformAmplitudes({
      peaks: new Float32Array([0, 0.25, 0.5, 1]),
      sampleRate: 1,
      stereo: false,
      durationSeconds: 4,
      width: 4,
      maxPeak: 1,
    })

    expect([...amplitudes]).toEqual([0, 0.25, 0.5, 1])
  })

  it('mixes stereo peaks by taking the louder channel for each source sample', () => {
    const amplitudes = sampleSourceWaveformAmplitudes({
      peaks: new Float32Array([0.1, 0.4, 0.8, 0.2]),
      sampleRate: 1,
      stereo: true,
      durationSeconds: 2,
      width: 2,
      maxPeak: 1,
    })

    expect(amplitudes[0]).toBeCloseTo(0.4)
    expect(amplitudes[1]).toBeCloseTo(0.8)
  })

  it('samples a zoomed source time window', () => {
    const amplitudes = sampleSourceWaveformAmplitudes({
      peaks: new Float32Array([0, 0.2, 0.4, 0.6, 0.8, 1]),
      sampleRate: 1,
      stereo: false,
      durationSeconds: 6,
      startTimeSeconds: 2,
      endTimeSeconds: 5,
      width: 3,
      maxPeak: 1,
    })

    expect(amplitudes[0]).toBeCloseTo(0.4)
    expect(amplitudes[1]).toBeCloseTo(0.6)
    expect(amplitudes[2]).toBeCloseTo(0.8)
  })

  it('returns zero amplitudes when waveform metadata is unusable', () => {
    const amplitudes = sampleSourceWaveformAmplitudes({
      peaks: new Float32Array([1, 1]),
      sampleRate: 0,
      stereo: false,
      durationSeconds: 2,
      width: 3,
      maxPeak: 1,
    })

    expect([...amplitudes]).toEqual([0, 0, 0])
  })

  it('maps overview pointer positions across the full source duration', () => {
    const time = getSourceWaveformSeekTime({
      clientX: 25,
      clientY: 10,
      rect: { left: 0, top: 0, width: 100, height: 200 },
      durationSeconds: 80,
      detailStartTimeSeconds: 30,
      detailEndTimeSeconds: 50,
      overviewHeight: 40,
    })

    expect(time).toBe(20)
  })

  it('maps detail pointer positions inside the zoom window', () => {
    const time = getSourceWaveformSeekTime({
      clientX: 75,
      clientY: 120,
      rect: { left: 0, top: 0, width: 100, height: 200 },
      durationSeconds: 80,
      detailStartTimeSeconds: 30,
      detailEndTimeSeconds: 50,
      overviewHeight: 40,
    })

    expect(time).toBe(45)
  })
})
