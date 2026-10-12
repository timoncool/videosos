// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  getLocalInferenceSummary,
  isLocalInferenceCancellationError,
  LOCAL_INFERENCE_UNLOADED_MESSAGE,
  type LocalInferenceRuntimeRecord,
} from './types'

function createRuntime(
  overrides: Partial<LocalInferenceRuntimeRecord> = {},
): LocalInferenceRuntimeRecord {
  return {
    id: 'runtime-1',
    feature: 'whisper',
    featureLabel: 'Whisper',
    modelKey: 'whisper-tiny',
    modelLabel: 'Tiny',
    backend: 'webgpu',
    state: 'ready',
    estimatedBytes: 256 * 1024 * 1024,
    activeJobs: 0,
    loadedAt: 1000,
    lastUsedAt: 1000,
    unloadable: true,
    ...overrides,
  }
}

describe('local-inference types', () => {
  it('returns null when there are no runtimes', () => {
    expect(getLocalInferenceSummary({})).toBeNull()
  })

  it('summarizes a single runtime', () => {
    const summary = getLocalInferenceSummary({
      'runtime-1': createRuntime(),
    })

    expect(summary).toEqual({
      totalRuntimes: 1,
      totalEstimatedBytes: 256 * 1024 * 1024,
      activeJobs: 0,
      state: 'ready',
      loadingPhase: null,
      loadingFromCache: false,
      loadedBytes: 0,
      backendLabel: 'WEBGPU',
      primaryLabel: 'Whisper Tiny',
      unloadableCount: 1,
    })
  })

  it('aggregates multiple runtimes and prioritizes active states', () => {
    const summary = getLocalInferenceSummary({
      'runtime-1': createRuntime({
        state: 'loading',
        activeJobs: 1,
      }),
      'runtime-2': createRuntime({
        id: 'runtime-2',
        modelKey: 'whisper-small',
        modelLabel: 'Small',
        backend: 'wasm',
        state: 'running',
        estimatedBytes: 512 * 1024 * 1024,
        activeJobs: 2,
        unloadable: false,
      }),
      'runtime-3': createRuntime({
        id: 'runtime-3',
        backend: 'unknown',
        state: 'error',
        estimatedBytes: undefined,
      }),
    })

    expect(summary).toEqual({
      totalRuntimes: 3,
      totalEstimatedBytes: 768 * 1024 * 1024,
      activeJobs: 3,
      state: 'running',
      // A runtime is still loading, but the summary state is 'running', so there is no
      // loading phase to report.
      loadingPhase: null,
      loadingFromCache: false,
      loadedBytes: 0,
      backendLabel: 'Mixed',
      primaryLabel: '3 Local Models',
      unloadableCount: 2,
    })
  })

  // "Loading" covers both a multi-minute weight download and a ~20 s graph compile. The pill
  // names whichever is running, and a download outranks a compile because it is the long pole.
  it('reports the loading phase, preferring an in-flight download', () => {
    const downloading = getLocalInferenceSummary({
      'runtime-1': createRuntime({ state: 'loading', loadingPhase: 'preparing' }),
      'runtime-2': createRuntime({
        id: 'runtime-2',
        state: 'loading',
        loadingPhase: 'downloading',
        loadedBytes: 100,
      }),
    })
    expect(downloading?.loadingPhase).toBe('downloading')
    expect(downloading?.loadedBytes).toBe(100)

    const preparing = getLocalInferenceSummary({
      'runtime-1': createRuntime({ state: 'loading', loadingPhase: 'preparing' }),
    })
    expect(preparing?.loadingPhase).toBe('preparing')
  })

  // A cache read streams bytes and takes seconds, so it looks like a download from the inside.
  // Calling it one would tell the user they are waiting on the network when they are not.
  it('only calls a fetch a cache read when nothing touches the network', () => {
    const cached = getLocalInferenceSummary({
      'runtime-1': createRuntime({
        state: 'loading',
        loadingPhase: 'downloading',
        loadingFromCache: true,
      }),
    })
    expect(cached?.loadingFromCache).toBe(true)

    const mixed = getLocalInferenceSummary({
      'runtime-1': createRuntime({
        state: 'loading',
        loadingPhase: 'downloading',
        loadingFromCache: true,
      }),
      'runtime-2': createRuntime({
        id: 'runtime-2',
        state: 'loading',
        loadingPhase: 'downloading',
        loadingFromCache: false,
      }),
    })
    expect(mixed?.loadingFromCache).toBe(false)
  })

  it('never claims a cache read while compiling rather than fetching', () => {
    const summary = getLocalInferenceSummary({
      'runtime-1': createRuntime({ state: 'loading', loadingPhase: 'preparing' }),
    })

    expect(summary?.loadingPhase).toBe('preparing')
    expect(summary?.loadingFromCache).toBe(false)
  })

  it('reports no loading phase once a runtime is past loading', () => {
    const summary = getLocalInferenceSummary({
      'runtime-1': createRuntime({ state: 'running', loadingPhase: 'downloading' }),
    })

    expect(summary?.loadingPhase).toBeNull()
  })

  it('detects unload cancellations', () => {
    expect(isLocalInferenceCancellationError(new Error(LOCAL_INFERENCE_UNLOADED_MESSAGE))).toBe(
      true,
    )
    expect(isLocalInferenceCancellationError(new Error('Something else'))).toBe(false)
    expect(isLocalInferenceCancellationError('Local inference unloaded')).toBe(false)
  })
})
