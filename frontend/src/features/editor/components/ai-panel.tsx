import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  ChevronDown,
  Download,
  ListPlus,
  Loader2,
  Pause,
  Play,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { useMediaPlaybackControls } from '@/shared/media/use-media-playback-controls'
import {
  getStoredTtsEngine,
  setStoredTtsEngine,
  type StoredTtsEngine,
} from '@/shared/utils/tts-settings'
import { SliderInput } from '@/shared/ui/property-controls'
import { cn } from '@/shared/ui/cn'
import { i18n } from '@/i18n'
import {
  importMediaLibraryService,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library'
import { usePlaybackStore } from '@/shared/state/playback'
import type { MediaMetadata } from '@/types/storage'
import {
  MOSS_TTS_VOICE_OPTIONS,
  getMossTtsVoiceOption,
  mossTtsService,
  type MossTtsVoice,
} from '../services/moss-tts-service'
import {
  SUPERTONIC_TTS_EXPRESSIVE_TAG_OPTIONS,
  SUPERTONIC_TTS_LANGUAGE_OPTIONS,
  SUPERTONIC_TTS_VOICE_OPTIONS,
  supertonicTtsService,
  type SupertonicTtsLanguageSelection,
  type SupertonicTtsVoice,
} from '../services/supertonic-tts-service'
import { insertGeneratedAudioOnNewTrack } from '../utils/insert-generated-audio'
import { getLanguageDisplayName, insertTextAtCursor } from '../utils/tts-ui-helpers'

interface AudioGeneration {
  id: string
  file: File
  objectUrl: string
  byteSize: number
  duration: number
  textSnippet: string
  voice: string
  model: string
  summary: string
  details: string
  tags: string[]
  /** null = unsaved, string = saved media ID */
  savedMediaId: string | null
  saving: boolean
}

type Generation = AudioGeneration

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const MiniAudioPlayer = memo(function MiniAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isSeeking, setIsSeeking] = useState(false)
  const isSeekingRef = useRef(false)
  isSeekingRef.current = isSeeking

  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onTimeUpdate = () => {
      if (!isSeekingRef.current) setCurrentTime(el.currentTime)
    }
    const onLoaded = () => setDuration(el.duration)
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('timeupdate', onTimeUpdate)
    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('ended', onEnded)

    return () => {
      el.pause()
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('timeupdate', onTimeUpdate)
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('ended', onEnded)
    }
  }, [])

  const { togglePlay, seekToPercent } = useMediaPlaybackControls(audioRef, duration, setCurrentTime)

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/30 px-1.5 py-1">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm glow-primary-sm transition-colors hover:bg-primary/90"
        onClick={togglePlay}
        aria-label={isPlaying ? i18n.t('preview.player.pause') : i18n.t('preview.player.play')}
      >
        {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-px" />}
      </button>
      <Slider
        value={[progressPercent]}
        onValueChange={(values) => {
          setIsSeeking(true)
          seekToPercent(values)
        }}
        onValueCommit={() => setIsSeeking(false)}
        max={100}
        step={0.1}
        className="min-w-0 flex-1"
        aria-label={i18n.t('editor.tts.seek')}
      />
      <span className="shrink-0 select-none font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatTime(currentTime)}
        <span className="text-muted-foreground/40"> / </span>
        {formatTime(duration)}
      </span>
    </div>
  )
})

export const AiPanel = memo(function AiPanel() {
  const { t } = useTranslation()
  const currentProjectId = useMediaLibraryStore((state) => state.currentProjectId)
  const loadMediaItems = useMediaLibraryStore((state) => state.loadMediaItems)
  const selectMedia = useMediaLibraryStore((state) => state.selectMedia)
  const showNotification = useMediaLibraryStore((state) => state.showNotification)

  const [ttsText, setTtsText] = useState(() => t('editor.aiPanel.defaultTtsPrompt'))
  const [ttsEngine, setTtsEngine] = useState<StoredTtsEngine>(() => getStoredTtsEngine())
  const [ttsMossVoice, setTtsMossVoice] = useState<MossTtsVoice>('Xiaoyu')
  const [ttsSupertonicVoice, setTtsSupertonicVoice] = useState<SupertonicTtsVoice>('M3')
  const [ttsSupertonicLanguage, setTtsSupertonicLanguage] =
    useState<SupertonicTtsLanguageSelection>('auto')
  const [ttsSpeed, setTtsSpeed] = useState(1)
  const [isTtsGenerating, setIsTtsGenerating] = useState(false)
  const [ttsProgress, setTtsProgress] = useState<string | null>(null)
  const [ttsError, setTtsError] = useState<string | null>(null)
  const [ttsGenerations, setTtsGenerations] = useState<AudioGeneration[]>([])
  const [ttsSectionOpen, setTtsSectionOpen] = useState(true)

  const ttsTextareaRef = useRef<HTMLTextAreaElement>(null)
  const generationUrlsRef = useRef<Set<string>>(new Set())

  // Revoke all blob URLs on unmount
  useEffect(() => {
    const urls = generationUrlsRef.current
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  useEffect(() => {
    setStoredTtsEngine(ttsEngine)
  }, [ttsEngine])

  const isMossSupported = mossTtsService.isSupported()
  const isSupertonicSupported = supertonicTtsService.isSupported()
  const supportsNativeTtsSpeed = ttsEngine === 'supertonic'
  const ttsSpeedMin = ttsEngine === 'supertonic' ? 0.8 : 0.5
  const ttsSpeedMax = ttsEngine === 'supertonic' ? 1.3 : 2

  useEffect(() => {
    setTtsSpeed((current) => Math.min(ttsSpeedMax, Math.max(ttsSpeedMin, current)))
  }, [ttsSpeedMax, ttsSpeedMin])

  const effectiveTtsSpeed = supportsNativeTtsSpeed ? ttsSpeed : 1
  const isTtsSupported = ttsEngine === 'moss' ? isMossSupported : isSupertonicSupported
  const trimmedTtsText = ttsText.trim()

  const totalTtsBytes = useMemo(
    () => ttsGenerations.reduce((sum, generation) => sum + generation.byteSize, 0),
    [ttsGenerations],
  )

  const anyTtsSaving = ttsGenerations.some((generation) => generation.saving)
  const text = ttsText
  const setText = setTtsText
  const voice = ttsEngine === 'moss' ? ttsMossVoice : ttsSupertonicVoice
  const speed = ttsSpeed
  const setSpeed = setTtsSpeed
  const isGenerating = isTtsGenerating
  const progress = ttsProgress
  const error = ttsError
  const generations = ttsGenerations
  const totalBytes = totalTtsBytes
  const anySaving = anyTtsSaving
  const trimmedText = trimmedTtsText
  const currentTtsBackendLabel = ttsEngine === 'moss' ? 'CPU' : 'WebGPU/WASM'
  const currentTtsRuntimeLabel = ttsEngine === 'moss' ? 'MOSS Nano' : 'Supertonic 3'

  // --- actions ---

  const handleTtsGenerate = useCallback(async () => {
    if (!currentProjectId) {
      setTtsError(t('editor.tts.errors.openProject'))
      return
    }
    if (!trimmedTtsText) {
      setTtsError(t('editor.tts.errors.enterText'))
      return
    }
    if (!isTtsSupported) {
      setTtsError(
        ttsEngine === 'moss'
          ? t('editor.tts.errors.mossUnsupported')
          : t('editor.tts.errors.supertonicUnsupported', {
              defaultValue:
                'This browser cannot run the local Supertonic TTS runtime. Try a recent Chrome or Edge browser.',
            }),
      )
      return
    }

    setTtsError(null)
    setIsTtsGenerating(true)
    setTtsProgress(t('editor.tts.progressPreparing'))

    try {
      const result =
        ttsEngine === 'moss'
          ? await mossTtsService.generateSpeechFile({
              text: trimmedTtsText,
              voice: ttsMossVoice,
              speed: effectiveTtsSpeed,
              onProgress: setTtsProgress,
            })
          : await supertonicTtsService.generateSpeechFile({
              text: trimmedTtsText,
              voice: ttsSupertonicVoice,
              language: ttsSupertonicLanguage,
              speed: effectiveTtsSpeed,
              onProgress: setTtsProgress,
            })

      const { blob, file, duration } = result

      const objectUrl = URL.createObjectURL(blob)
      generationUrlsRef.current.add(objectUrl)
      const voiceLabel =
        ttsEngine === 'moss'
          ? getMossTtsVoiceOption(ttsMossVoice).label
          : (SUPERTONIC_TTS_VOICE_OPTIONS.find((option) => option.value === ttsSupertonicVoice)
              ?.label ?? ttsSupertonicVoice)
      const modelLabel = ttsEngine === 'moss' ? 'Multilingual Nano' : 'Supertonic 3'
      const engineTags =
        ttsEngine === 'moss'
          ? ['ai-generated', 'moss-tts', 'tts-engine:moss', `moss-voice:${ttsMossVoice}`]
          : [
              'ai-generated',
              'supertonic-tts',
              'tts-engine:supertonic',
              `supertonic-voice:${ttsSupertonicVoice}`,
            ]

      const generation: AudioGeneration = {
        id: crypto.randomUUID(),
        file,
        objectUrl,
        byteSize: blob.size,
        duration,
        textSnippet: trimmedTtsText,
        voice: voiceLabel,
        model: modelLabel,
        summary: trimmedTtsText,
        details: `${voiceLabel} / ${modelLabel} / ${duration > 0 ? `${duration.toFixed(1)}s` : '-'} / ${formatBytes(blob.size)}`,
        tags: engineTags,
        savedMediaId: null,
        saving: false,
      }

      setTtsGenerations((prev) => [generation, ...prev])
      setTtsProgress(null)
    } catch (generationError) {
      setTtsError(
        generationError instanceof Error
          ? generationError.message
          : t('editor.tts.errors.generateFailed'),
      )
      setTtsProgress(null)
    } finally {
      setIsTtsGenerating(false)
    }
  }, [
    currentProjectId,
    effectiveTtsSpeed,
    isTtsSupported,
    trimmedTtsText,
    ttsEngine,
    ttsMossVoice,
    ttsSupertonicLanguage,
    ttsSupertonicVoice,
    t,
  ])

  const updateGenerationInList = useCallback(
    (
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      id: string,
      patch: Partial<AudioGeneration>,
    ) => {
      setGenerations((prev) =>
        prev.map((generation) => (generation.id === id ? { ...generation, ...patch } : generation)),
      )
    },
    [],
  )

  const saveGeneration = useCallback(
    async (
      generation: AudioGeneration,
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      setError: Dispatch<SetStateAction<string | null>>,
    ): Promise<MediaMetadata | null> => {
      if (!currentProjectId) return null
      updateGenerationInList(setGenerations, generation.id, { saving: true })

      try {
        const { mediaLibraryService } = await importMediaLibraryService()
        const media = await mediaLibraryService.importGeneratedAudio(
          generation.file,
          currentProjectId,
          {
            tags: generation.tags,
          },
        )

        await loadMediaItems()
        selectMedia([media.id])
        // Remove from tracked URLs so unmount cleanup won't revoke a URL
        // that may be referenced by a timeline item's src
        generationUrlsRef.current.delete(generation.objectUrl)
        updateGenerationInList(setGenerations, generation.id, {
          saving: false,
          savedMediaId: media.id,
        })
        return media
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : t('editor.aiPanel.errors.saveAudioFailed'),
        )
        updateGenerationInList(setGenerations, generation.id, { saving: false })
        return null
      }
    },
    [currentProjectId, loadMediaItems, selectMedia, t, updateGenerationInList],
  )

  const handleSave = useCallback(
    async (
      generation: AudioGeneration,
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      setError: Dispatch<SetStateAction<string | null>>,
    ) => {
      const media = await saveGeneration(generation, setGenerations, setError)
      if (media) {
        showNotification({
          type: 'success',
          message: t('editor.aiPanel.notifications.savedToLibrary', {
            fileName: media.fileName,
          }),
        })
      }
    },
    [saveGeneration, showNotification, t],
  )

  const handleSaveAndInsert = useCallback(
    async (
      generation: AudioGeneration,
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      setError: Dispatch<SetStateAction<string | null>>,
    ) => {
      // Saving is asynchronous, so capture the user's intended insertion point
      // when they click rather than after the media import finishes.
      const insertionFrame = usePlaybackStore.getState().currentFrame
      const media = await saveGeneration(generation, setGenerations, setError)
      if (!media) return

      const inserted = insertGeneratedAudioOnNewTrack(media, generation.objectUrl, insertionFrame)
      showNotification({
        type: inserted ? 'success' : 'warning',
        message: inserted
          ? t('editor.aiPanel.notifications.savedAndAdded', { fileName: media.fileName })
          : t('editor.tts.notifications.savedNoTrack', { fileName: media.fileName }),
      })
    },
    [saveGeneration, showNotification, t],
  )

  const removeGenerationFromList = useCallback(
    (setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>, id: string) => {
      setGenerations((prev) => {
        const generation = prev.find((entry) => entry.id === id)
        if (generation) {
          // Only revoke the blob URL if it has not been saved; saved items may
          // have their blob URL referenced by a timeline audio item's `src`.
          if (!generation.savedMediaId) {
            URL.revokeObjectURL(generation.objectUrl)
            generationUrlsRef.current.delete(generation.objectUrl)
          }
        }
        return prev.filter((entry) => entry.id !== id)
      })
    },
    [],
  )

  const clearGenerationList = useCallback(
    (setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>) => {
      // Only revoke blob URLs for unsaved generations; saved ones may be
      // referenced by timeline items.
      setGenerations((prev) => {
        for (const generation of prev) {
          if (!generation.savedMediaId) {
            URL.revokeObjectURL(generation.objectUrl)
            generationUrlsRef.current.delete(generation.objectUrl)
          }
        }
        return []
      })
    },
    [],
  )

  const handleSaveTtsGeneration = useCallback(
    (generation: AudioGeneration) => handleSave(generation, setTtsGenerations, setTtsError),
    [handleSave],
  )
  const handleSaveAndInsertTtsGeneration = useCallback(
    (generation: AudioGeneration) =>
      handleSaveAndInsert(generation, setTtsGenerations, setTtsError),
    [handleSaveAndInsert],
  )
  const handleGenerate = handleTtsGenerate
  const handleClearAll = () => clearGenerationList(setTtsGenerations)
  const handleRemoveGeneration = (id: string) => removeGenerationFromList(setTtsGenerations, id)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="space-y-3">
        <Collapsible open={ttsSectionOpen} onOpenChange={setTtsSectionOpen}>
          <div className="-mx-3 -mt-3 bg-secondary/50 px-3 py-2">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                aria-label={
                  ttsSectionOpen
                    ? t('editor.aiPanel.collapseTextToSpeech')
                    : t('editor.aiPanel.expandTextToSpeech')
                }
              >
                <h2 className="text-sm font-medium">{t('editor.aiPanel.textToSpeech')}</h2>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    ttsSectionOpen && 'rotate-180',
                  )}
                />
              </button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="space-y-4 pt-3">
            {!isTtsSupported && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                {ttsEngine === 'moss'
                  ? t('editor.tts.mossUnsupported')
                  : t('editor.tts.supertonicUnsupported', {
                      defaultValue:
                        'This browser cannot run the local Supertonic TTS runtime. Try a recent Chrome or Edge browser.',
                    })}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ai-tts-text">{t('editor.tts.text')}</Label>
              <Textarea
                ref={ttsTextareaRef}
                id="ai-tts-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t('editor.tts.textPlaceholder')}
                className="min-h-24 resize-y bg-secondary/30 text-sm"
                disabled={isGenerating}
              />
              {ttsEngine === 'supertonic' && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {t('editor.tts.expressiveTags', { defaultValue: 'Expressive tags' })}
                  </span>
                  {SUPERTONIC_TTS_EXPRESSIVE_TAG_OPTIONS.map((tag) => (
                    <Button
                      key={tag.value}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2 text-[11px]"
                      onClick={() =>
                        insertTextAtCursor({
                          input: ttsTextareaRef.current,
                          insertText: tag.value,
                          setText,
                          text,
                        })
                      }
                      disabled={isGenerating}
                    >
                      {tag.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t('editor.tts.engine')}</Label>
                <Select
                  value={ttsEngine}
                  onValueChange={(value) => setTtsEngine(value as StoredTtsEngine)}
                  disabled={isGenerating}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="moss" className="text-xs">
                      {t('editor.tts.mossOption')}
                    </SelectItem>
                    <SelectItem value="supertonic" className="text-xs">
                      {t('editor.tts.supertonicOption', {
                        defaultValue: 'Supertonic 3 (31 languages, local ONNX)',
                      })}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('editor.tts.voice')}</Label>
                  <Select
                    value={voice}
                    onValueChange={(value) => {
                      if (ttsEngine === 'moss') {
                        setTtsMossVoice(value as MossTtsVoice)
                      } else {
                        setTtsSupertonicVoice(value as SupertonicTtsVoice)
                      }
                    }}
                    disabled={isGenerating}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {(ttsEngine === 'moss' ? MOSS_TTS_VOICE_OPTIONS : SUPERTONIC_TTS_VOICE_OPTIONS).map((option) => (
                        <SelectItem key={option.value} value={option.value} className="text-xs">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {ttsEngine === 'supertonic' && (
                  <div className="space-y-1.5">
                    <Label>{t('editor.tts.language', { defaultValue: 'Language' })}</Label>
                    <Select
                      value={ttsSupertonicLanguage}
                      onValueChange={(value) =>
                        setTtsSupertonicLanguage(value as SupertonicTtsLanguageSelection)
                      }
                      disabled={isGenerating}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {SUPERTONIC_TTS_LANGUAGE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value} className="text-xs">
                            {getLanguageDisplayName(
                              option.value,
                              option.label,
                              i18n.language,
                              t('editor.tts.autoDetectLanguage', {
                                defaultValue: 'Auto detect',
                              }),
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {supportsNativeTtsSpeed && (
                <SliderInput
                  label={t('editor.tts.speed')}
                  value={speed}
                  onChange={setSpeed}
                  min={ttsSpeedMin}
                  max={ttsSpeedMax}
                  step={0.05}
                  unit="x"
                  disabled={isGenerating}
                />
              )}
              <Button
                size="sm"
                onClick={() => {
                  void handleGenerate()
                }}
                disabled={isGenerating || !trimmedText || !currentProjectId || !isTtsSupported}
                className="h-7 shrink-0 gap-1.5"
              >
                {isGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <WandSparkles className="h-3.5 w-3.5" />
                )}
                {isGenerating ? t('editor.tts.generating') : t('editor.tts.generate')}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('editor.aiPanel.runsLocally', {
                runtime: currentTtsRuntimeLabel,
                backend: currentTtsBackendLabel,
              })}
            </p>

            {progress && (
              <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                {progress}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            )}

            {generations.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('editor.aiPanel.history', {
                      count: generations.length,
                      size: formatBytes(totalBytes),
                    })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                    onClick={handleClearAll}
                    disabled={anySaving}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('editor.aiPanel.clearAll')}
                  </Button>
                </div>

                <div className="space-y-2">
                  {generations.map((gen) => (
                    <GenerationRow
                      key={gen.id}
                      generation={gen}
                      onSave={handleSaveTtsGeneration}
                      onSaveAndInsert={handleSaveAndInsertTtsGeneration}
                      onRemove={handleRemoveGeneration}
                    />
                  ))}
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

      </div>
    </div>
  )
})

// --- Row component ---

const GenerationRow = memo(function GenerationRow({
  generation: gen,
  onSave,
  onSaveAndInsert,
  onRemove,
}: {
  generation: Generation
  onSave: (gen: Generation) => Promise<void>
  onSaveAndInsert: (gen: Generation) => Promise<void>
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  const saved = gen.savedMediaId !== null

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        saved ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-border bg-secondary/20'
      }`}
    >
      {/* Meta row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="line-clamp-3 text-xs leading-relaxed" title={gen.textSnippet}>
            {gen.textSnippet}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {gen.voice} / {gen.model} / {gen.duration > 0 ? `${gen.duration.toFixed(1)}s` : '-'} /{' '}
            {formatBytes(gen.byteSize)}
          </p>
        </div>
        {!gen.saving && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onRemove(gen.id)}
            aria-label={t('editor.aiPanel.remove')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Audio player */}
      <MiniAudioPlayer src={gen.objectUrl} />

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        {saved ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            {t('editor.aiPanel.saved')}
          </span>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => {
                void onSaveAndInsert(gen)
              }}
              disabled={gen.saving}
            >
              {gen.saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ListPlus className="h-3 w-3" />
              )}
              {gen.saving ? t('editor.aiPanel.saving') : t('editor.aiPanel.saveAndInsert')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => {
                void onSave(gen)
              }}
              disabled={gen.saving}
            >
              <Download className="h-3 w-3" />
              {t('editor.aiPanel.saveToLibrary')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
})
