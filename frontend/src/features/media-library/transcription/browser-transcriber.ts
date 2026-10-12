import { Bridge } from './lib/bridge'
import type {
  TranscriptSegment,
  TranscribeOptions,
  TranscribeProgress,
  TranscribeRuntimeInfo,
  WhisperModel,
} from './types'
import type { MediaTranscriptQuantization } from '@/types/storage'
import { localInferenceRuntimeRegistry } from '@/shared/state/local-inference'
import { LOCAL_INFERENCE_UNLOADED_MESSAGE } from '@/shared/state/local-inference'
import {
  formatWhisperRuntimeModelLabel,
  estimateWhisperRuntimeBytes,
  formatParakeetRuntimeModelLabel,
  estimateParakeetRuntimeBytes,
} from './runtime-estimates'
import {
  resolveTranscriptionEngine,
  type ResolvedTranscriptionEngine,
} from './transcription-engine'
import { DEFAULT_WHISPER_MODEL } from '@/shared/utils/whisper-settings'
import { usePlaybackStore } from '@/shared/state/playback'

export class BrowserTranscriber {
  private readonly defaultOptions: TranscribeOptions

  constructor(options: TranscribeOptions = {}) {
    this.defaultOptions = options
  }

  transcribe(file: File, runtimeOptions: TranscribeOptions = {}): TranscribeStream {
    return new TranscribeStream(file, {
      ...this.defaultOptions,
      ...runtimeOptions,
    })
  }
}

export class TranscribeStream implements AsyncIterable<TranscriptSegment> {
  private readonly file: File
  private readonly options: TranscribeOptions
  private readonly resolved: ResolvedTranscriptionEngine
  private readonly runtimeId: string
  private readonly queue: TranscriptSegment[] = []
  private doneFlag = false
  private error: Error | undefined
  private notify: (() => void) | null = null
  private bridge: Bridge | null = null
  private started = false
  private runtimeRegistered = false
  /**
   * Latched once the model finishes loading. Audio decode runs on its own worker concurrently
   * with the model transfer, so `decoding` events arrive interleaved with `downloading` ones.
   * Deriving the runtime state from whichever event landed last made the status pill oscillate
   * between "Loading" and "Active" for the whole download.
   */
  private modelReady = false
  private unsubscribePlayback: (() => void) | null = null
  private idleResumeTimer: ReturnType<typeof setTimeout> | null = null
  private workerPaused = false

  constructor(file: File, options: TranscribeOptions = {}) {
    this.file = file
    this.options = options
    const requestedModel = (options.model as WhisperModel | undefined) ?? DEFAULT_WHISPER_MODEL
    this.resolved = resolveTranscriptionEngine(requestedModel, options.language)
    this.runtimeId = `${this.resolved.engine}-${crypto.randomUUID()}`
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<TranscriptSegment> {
    await this.startBridge()

    while (true) {
      if (this.queue.length > 0) {
        const next = this.queue.shift()
        if (next) {
          yield next
        }
      } else if (this.error) {
        throw this.error
      } else if (this.doneFlag) {
        return
      } else {
        await new Promise<void>((resolve) => {
          this.notify = resolve
        })
      }
    }
  }

  async collect(): Promise<TranscriptSegment[]> {
    const segments: TranscriptSegment[] = []
    for await (const segment of this) {
      segments.push(segment)
    }
    return segments
  }

  cancel(message = LOCAL_INFERENCE_UNLOADED_MESSAGE): void {
    this.bridge?.terminate()
    this.queue.length = 0
    this.error = new Error(message)
    this.unregisterRuntime()
    this.stopPlaybackWatcher()
    this.wakeUp()
  }

  private startPlaybackWatcher(): void {
    if (this.unsubscribePlayback) return
    if (!this.bridge) return

    const IDLE_RESUME_MS = 400

    const pauseWorker = () => {
      if (this.idleResumeTimer !== null) {
        clearTimeout(this.idleResumeTimer)
        this.idleResumeTimer = null
      }
      if (this.workerPaused) return
      this.workerPaused = true
      this.bridge?.setPaused(true)
    }

    const scheduleResume = () => {
      if (this.idleResumeTimer !== null) {
        clearTimeout(this.idleResumeTimer)
      }
      this.idleResumeTimer = setTimeout(() => {
        this.idleResumeTimer = null
        // Only stay paused while actually playing; otherwise always resume. Re-check on the
        // next tick instead of giving up, so the worker can never get stuck paused.
        if (usePlaybackStore.getState().isPlaying) {
          scheduleResume()
          return
        }
        this.workerPaused = false
        this.bridge?.setPaused(false)
      }, IDLE_RESUME_MS)
    }

    // Pause transcription only during genuinely active playback or scrubbing (the playhead
    // actually moving). A *parked* preview frame is not a reason to pause — treating it as
    // one (and never rescheduling a resume) would suspend the worker forever, which is why
    // captions generated from the UI hung while a static frame was previewed.
    const initial = usePlaybackStore.getState()
    if (initial.isPlaying) {
      pauseWorker()
      scheduleResume()
    }

    this.unsubscribePlayback = usePlaybackStore.subscribe((state, prev) => {
      const frameMoved = state.currentFrameEpoch !== prev.currentFrameEpoch

      if (state.isPlaying || frameMoved) {
        pauseWorker()
        scheduleResume()
        return
      }

      if (prev.isPlaying && !state.isPlaying) {
        scheduleResume()
      }
    })
  }

  private stopPlaybackWatcher(): void {
    this.unsubscribePlayback?.()
    this.unsubscribePlayback = null
    if (this.idleResumeTimer !== null) {
      clearTimeout(this.idleResumeTimer)
      this.idleResumeTimer = null
    }
    this.workerPaused = false
  }

  private async startBridge(): Promise<void> {
    if (this.started) {
      return
    }

    this.started = true
    this.registerRuntime()
    this.bridge = new Bridge({
      onSegment: (segment: TranscriptSegment) => {
        this.queue.push(segment)
        this.options.onSegment?.(segment)
        this.wakeUp()
      },
      onProgress: (event: TranscribeProgress) => {
        this.updateRuntimeFromProgress(event)
        this.options.onProgress?.(event)
      },
      onRuntimeInfo: (info: TranscribeRuntimeInfo) => {
        this.updateRuntime(info)
        this.options.onRuntimeInfo?.(info)
      },
      onDone: () => {
        this.doneFlag = true
        this.unregisterRuntime()
        this.stopPlaybackWatcher()
        this.wakeUp()
      },
      onError: (message: string) => {
        this.error = new Error(message)
        this.unregisterRuntime()
        this.stopPlaybackWatcher()
        this.wakeUp()
      },
    })

    try {
      await this.bridge.start(
        this.file,
        this.resolved.model,
        this.options.language,
        this.options.quantization,
        this.resolved.engine,
      )
      this.startPlaybackWatcher()
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error))
      this.unregisterRuntime()
      this.stopPlaybackWatcher()
      this.wakeUp()
    }
  }

  private registerRuntime(): void {
    if (this.runtimeRegistered) {
      return
    }

    this.runtimeRegistered = true
    const now = Date.now()
    const isParakeet = this.resolved.engine === 'parakeet'
    const quantization =
      (this.options.quantization as MediaTranscriptQuantization | undefined) ?? 'hybrid'

    localInferenceRuntimeRegistry.registerRuntime(
      {
        id: this.runtimeId,
        feature: isParakeet ? 'parakeet' : 'whisper',
        featureLabel: isParakeet ? 'Parakeet' : 'Whisper',
        modelKey: this.resolved.model,
        modelLabel: isParakeet
          ? formatParakeetRuntimeModelLabel('webgpu')
          : formatWhisperRuntimeModelLabel(this.resolved.model, quantization),
        backend: 'unknown',
        state: 'loading',
        estimatedBytes: isParakeet
          ? estimateParakeetRuntimeBytes('webgpu')
          : estimateWhisperRuntimeBytes(this.resolved.model, quantization),
        activeJobs: 1,
        loadedAt: now,
        lastUsedAt: now,
        unloadable: true,
      },
      {
        unload: () => {
          this.cancel()
        },
      },
    )
  }

  private unregisterRuntime(): void {
    if (!this.runtimeRegistered) {
      return
    }

    this.runtimeRegistered = false
    localInferenceRuntimeRegistry.unregisterRuntime(this.runtimeId)
  }

  private updateRuntime(info: TranscribeRuntimeInfo): void {
    if (!this.runtimeRegistered) {
      return
    }

    localInferenceRuntimeRegistry.updateRuntime(this.runtimeId, {
      ...(info.backend ? { backend: info.backend } : {}),
      ...(info.estimatedBytes ? { estimatedBytes: info.estimatedBytes } : {}),
      lastUsedAt: Date.now(),
    })
  }

  private updateRuntimeFromProgress(event: TranscribeProgress): void {
    if (!this.runtimeRegistered) {
      return
    }

    // Ready once the model's own track completes, or once inference actually begins. A
    // `decoding` event proves nothing about the model — it comes from the other worker.
    if (event.stage === 'transcribing' || (event.stage === 'preparing' && event.progress >= 1)) {
      this.modelReady = true
    }

    if (this.modelReady) {
      localInferenceRuntimeRegistry.updateRuntime(this.runtimeId, {
        state: 'running',
        lastUsedAt: Date.now(),
      })
      return
    }

    localInferenceRuntimeRegistry.updateRuntime(this.runtimeId, {
      state: 'loading',
      // A `decoding` event says nothing about the model, so it must not clear the phase.
      ...(event.stage === 'downloading' || event.stage === 'preparing'
        ? { loadingPhase: event.stage }
        : {}),
      // Prefer the transfer's real content-length over the compiled-in estimate.
      ...(event.stage === 'downloading' && event.totalBytes
        ? { estimatedBytes: event.totalBytes }
        : {}),
      ...(event.stage === 'downloading' && event.receivedBytes != null
        ? { loadedBytes: event.receivedBytes }
        : {}),
      ...(event.stage === 'downloading' ? { loadingFromCache: event.fromCache === true } : {}),
      lastUsedAt: Date.now(),
    })
  }

  private wakeUp(): void {
    const resolver = this.notify
    this.notify = null
    resolver?.()
  }
}
