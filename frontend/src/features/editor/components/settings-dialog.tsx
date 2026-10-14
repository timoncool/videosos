import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { TFunction } from 'i18next'
import type { MediaMetadata } from '@/types/storage'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import {
  RotateCcw,
  Trash2,
  Loader2,
  Check,
  ImagePlus,
  Film,
  TriangleAlert,
  Settings2,
  Rows3,
  HardDrive,
  Sparkles,
  Play,
  KeyRound,
  Bot,
  Globe,
  ShieldCheck,
  Info,
  X,
  Languages,
  Save,
  Timer,
  Undo2,
  Volume2,
  Volume1,
  Music,
  ScanText,
  Captions,
  Magnet,
  AudioWaveform,
  Images,
  Eraser,
  Link2,
  Speaker,
} from 'lucide-react'
import {
  LocalInferenceUnloadControl,
  LocalModelCacheControl,
  useSettingsStore,
  CAPTIONING_INTERVAL_BOUNDS,
  DEFAULT_CAPTIONING_INTERVAL_SECONDS,
  resolveCaptioningIntervalSec,
  type CaptioningIntervalUnit,
} from '@/features/editor/deps/settings'
import {
  useMediaLibraryStore,
  getSharedProxyKey,
  importProxyService,
  importMediaLibraryService,
  importThumbnailGenerator,
  UrlToolSetting,
} from '@/features/editor/deps/media-library'
import {
  importGifFrameCache,
  importFilmstripCache,
  importWaveformCache,
} from '@/features/editor/deps/timeline-cache'
import { clearPreviewAudioCache } from '@/features/editor/deps/composition-runtime'
import { CAPTION_STYLE_PRESETS } from '@/shared/typography/caption-style-presets'
import * as SelectPrimitive from '@radix-ui/react-select'
import { useUiSoundStore } from '@/shared/state/ui-sound-store'
import { emitUiSound, previewUiSound } from '@/shared/ui/ui-sound'
import { VOICE_OPTIONS, type VoiceName } from '@/infrastructure/audio/ui-sound'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createLogger } from '@/shared/logging/logger'
import { cn } from '@/shared/ui/cn'
import { LanguageSwitcher } from '@/shared/ui/language-switcher'
import { SettingRow, SettingsTable } from '../deps/studio'
import { AudioOutputSetting } from './audio-output-setting'

const log = createLogger('SettingsDialog')


const LazyProvidersSettings = lazy(() =>
  import('../deps/generate').then((m) => ({ default: m.ProvidersSettings })),
)
const LazyAgentsSection = lazy(() => import('./agents-settings'))
const LazyNetworkSection = lazy(() => import('../deps/studio').then((m) => ({ default: m.NetworkSection })))
const LazyPrivacySection = lazy(() => import('../deps/studio').then((m) => ({ default: m.PrivacySection })))
const LazyAboutSection = lazy(() => import('../deps/studio').then((m) => ({ default: m.AboutSection })))

const SETTINGS_SECTIONS = [
  { id: 'providers', labelKey: 'settings.sections.providers', icon: KeyRound },
  { id: 'agents', labelKey: 'settings.sections.agents', icon: Bot },
  { id: 'general', labelKey: 'settings.sections.general', icon: Settings2 },
  { id: 'timeline', labelKey: 'settings.sections.timeline', icon: Rows3 },
  { id: 'ai', labelKey: 'settings.sections.ai', icon: Sparkles },
  { id: 'storage', labelKey: 'settings.sections.storage', icon: HardDrive },
  { id: 'network', labelKey: 'settings.sections.network', icon: Globe },
  { id: 'privacy', labelKey: 'settings.sections.privacy', icon: ShieldCheck },
  { id: 'about', labelKey: 'settings.sections.about', icon: Info },
] as const

const ESTIMATE_REFERENCE_DURATION_SEC = 60
const ESTIMATE_REFERENCE_FPS = 30

function formatCaptionEstimate(t: TFunction, unit: CaptioningIntervalUnit, value: number): string {
  const intervalSec = resolveCaptioningIntervalSec(unit, value, ESTIMATE_REFERENCE_FPS)
  if (intervalSec <= 0) {
    return t('settings.ai.enterIntervalAboveZero')
  }
  const sceneCount = Math.max(1, Math.round(ESTIMATE_REFERENCE_DURATION_SEC / intervalSec))
  return t('settings.ai.captionEstimate', {
    sceneCount,
    scenes: t('settings.ai.scene', { count: sceneCount }),
    fps: ESTIMATE_REFERENCE_FPS,
  })
}

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

const SECTION_LABEL = Object.fromEntries(SETTINGS_SECTIONS.map((section) => [section.id, section.labelKey])) as Record<SettingsSectionId, string>

/** The sections whose settings are the editor's own and go back to their defaults with Reset. */
const RESETTABLE = new Set<SettingsSectionId>(['general', 'timeline', 'ai', 'storage'])

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The section to show on opening, and the block of it to scroll to. */
  target?: { section: SettingsSectionId; part: string | null } | null
}

interface BatchActionResult {
  total: number
  succeeded: number
  failed: number
  failedItems: string[]
}

interface ActionFeedback {
  tone: 'success' | 'error'
  message: string
}

type BatchActionId = 'clearCache' | 'regenerateThumbnails' | 'deleteProxies'

const BATCH_ACTION_LABEL_KEYS = {
  clearCache: 'settings.feedback.actionClearCache',
  regenerateThumbnails: 'settings.feedback.actionRegenerateThumbnails',
  deleteProxies: 'settings.feedback.actionDeleteProxies',
} as const satisfies Record<BatchActionId, string>

function formatFailedItems(t: TFunction, items: string[]): string {
  if (items.length === 0) return ''
  if (items.length <= 2) return items.join(', ')
  return t('settings.feedback.moreItems', {
    items: items.slice(0, 2).join(', '),
    count: items.length - 2,
  })
}

function createBatchResult(total: number, failedItems: string[]): BatchActionResult {
  return {
    total,
    succeeded: Math.max(0, total - failedItems.length),
    failed: failedItems.length,
    failedItems,
  }
}

function getBatchOutcomeFeedback(
  t: TFunction,
  action: BatchActionId,
  result: BatchActionResult,
): ActionFeedback {
  const actionLabel = t(BATCH_ACTION_LABEL_KEYS[action])

  if (result.total === 0) {
    return { tone: 'success', message: t('settings.feedback.noMediaNeededUpdating') }
  }

  if (result.failed === 0) {
    return {
      tone: 'success',
      message: t('settings.feedback.completedForItems', {
        count: result.succeeded,
        action: actionLabel,
      }),
    }
  }

  const failedLabel = formatFailedItems(t, result.failedItems)

  if (result.succeeded === 0) {
    return {
      tone: 'error',
      message: t('settings.feedback.couldntProcessItems', {
        count: result.failed,
        action: actionLabel,
        detail: failedLabel ? `: ${failedLabel}` : '.',
      }),
    }
  }

  return {
    tone: 'error',
    message: t('settings.feedback.partialOutcome', {
      action: actionLabel,
      succeeded: result.succeeded,
      total: result.total,
      failed: failedLabel,
    }),
  }
}

function showBatchOutcomeToast(
  t: TFunction,
  titles: { success: string; partial: string; failure: string },
  result: BatchActionResult,
): void {
  if (result.total === 0) {
    toast.success(titles.success, { description: t('settings.feedback.noMediaNeededUpdating') })
    return
  }

  if (result.failed === 0) {
    toast.success(titles.success, {
      description: t('settings.toasts.itemsUpdated', { count: result.succeeded }),
    })
    return
  }

  const description =
    result.succeeded === 0
      ? formatFailedItems(t, result.failedItems)
      : t('settings.toasts.itemsUpdatedFailed', {
          count: result.succeeded,
          failed: formatFailedItems(t, result.failedItems),
        })

  toast.error(result.succeeded === 0 ? titles.failure : titles.partial, { description })
}

/**
 * Clear regenerable cache data for the current project's media only.
 * Clears filmstrips, waveforms, GIF frames, and decoded audio
 * scoped to the given media IDs.
 *
 * Does NOT clear thumbnails (not auto-regenerated) or proxies (separate action).
 */
async function clearProjectCaches(
  mediaItems: Array<Pick<MediaMetadata, 'id' | 'fileName'>>,
): Promise<BatchActionResult> {
  if (mediaItems.length === 0) return createBatchResult(0, [])

  const [
    { deleteWaveform, deleteGifFrames, deleteDecodedPreviewAudio },
    { deletePreviewAudioConform },
    { gifFrameCache },
    { filmstripCache },
    { waveformCache },
  ] = await Promise.all([
    import('@/infrastructure/storage'),
    import('@/features/editor/deps/composition-runtime'),
    importGifFrameCache(),
    importFilmstripCache(),
    importWaveformCache(),
  ])

  // Clear in-memory preview audio cache (not keyed per-media, so clear all)
  clearPreviewAudioCache()

  const failedItems: string[] = []

  await Promise.all(
    mediaItems.map(async ({ id, fileName }) => {
      const results = await Promise.allSettled([
        deleteWaveform(id),
        deleteGifFrames(id),
        deleteDecodedPreviewAudio(id),
        deletePreviewAudioConform(id, { clearMetadata: true }),
        gifFrameCache.clearMedia(id),
        filmstripCache.clearMedia(id),
        waveformCache.clearMedia(id),
      ])

      const failures = results.filter((result) => result.status === 'rejected')
      if (failures.length > 0) {
        log.warn('Failed to fully clear project cache for media item', {
          mediaId: id,
          fileName,
          failures: failures.map((result) => String(result.reason)),
        })
        failedItems.push(fileName)
      }
    }),
  )

  const result = createBatchResult(mediaItems.length, failedItems)
  log.info(`Cleared caches for ${result.succeeded}/${result.total} media items`)
  return result
}

/** Delete all proxy videos for the given media items and clear their store status. */
async function clearProjectProxies(mediaItems: MediaMetadata[]): Promise<BatchActionResult> {
  if (mediaItems.length === 0) return createBatchResult(0, [])

  const { proxyService } = await importProxyService()
  const failedItems: string[] = []

  await Promise.all(
    mediaItems.map(async (media) => {
      try {
        await proxyService.deleteProxy(media.id, getSharedProxyKey(media))
        useMediaLibraryStore.getState().clearProxyStatus(media.id)
        proxyService.clearProxyKey(media.id)
      } catch (error) {
        log.warn('Failed to clear proxy for media item', {
          mediaId: media.id,
          fileName: media.fileName,
          error,
        })
        failedItems.push(media.fileName)
      }
    }),
  )

  const result = createBatchResult(mediaItems.length, failedItems)
  log.info(`Cleared proxies for ${result.succeeded}/${result.total} media items`)
  return result
}

/**
 * Regenerate thumbnails for all media in the current project.
 * Fetches each media file, generates a new thumbnail, and saves it to workspace storage.
 */
async function regenerateProjectThumbnails(
  mediaItems: Array<{ id: string; fileName: string; mimeType: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchActionResult> {
  if (mediaItems.length === 0) return createBatchResult(0, [])

  const [{ mediaLibraryService }, { generateThumbnail }, { saveThumbnail, updateMedia }] =
    await Promise.all([
      importMediaLibraryService(),
      importThumbnailGenerator(),
      import('@/infrastructure/storage'),
    ])

  let succeeded = 0
  const failedItems: string[] = []

  for (const media of mediaItems) {
    try {
      const blob = await mediaLibraryService.getMediaFile(media.id)
      if (!blob) continue

      // generateThumbnail expects a File (needs .name for extension-based mime detection)
      const file = new File([blob], media.fileName, { type: media.mimeType })
      const thumbnailBlob = await generateThumbnail(file)

      const thumbnailId = crypto.randomUUID()
      await saveThumbnail({
        id: thumbnailId,
        mediaId: media.id,
        blob: thumbnailBlob,
        timestamp: 1,
        width: 320,
        height: 180,
      })

      // Update the media record so the new thumbnailId propagates to the store
      await updateMedia(media.id, { thumbnailId })

      // Clear the in-memory blob URL cache so UI picks up the new thumbnail
      mediaLibraryService.clearThumbnailCache(media.id)
      succeeded++
    } catch (err) {
      log.warn(`Failed to regenerate thumbnail for ${media.fileName}:`, err)
      failedItems.push(media.fileName)
    }
    onProgress?.(succeeded + failedItems.length, mediaItems.length)
  }

  // Reload store so MediaCards see the updated thumbnailId and re-fetch
  await useMediaLibraryStore.getState().loadMediaItems()

  const result = createBatchResult(mediaItems.length, failedItems)
  log.info(`Regenerated ${result.succeeded}/${result.total} thumbnails`)
  return result
}

export function SettingsDialog({ open, onOpenChange, target }: SettingsDialogProps) {
  const { t } = useTranslation()
  const snapEnabled = useSettingsStore((s) => s.snapEnabled)
  const showWaveforms = useSettingsStore((s) => s.showWaveforms)
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips)
  const enableFilmstripExtraction = useSettingsStore((s) => s.enableFilmstripExtraction)
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval)
  const maxUndoHistory = useSettingsStore((s) => s.maxUndoHistory)
  const captioningIntervalUnit = useSettingsStore((s) => s.captioningIntervalUnit)
  const captioningIntervalValue = useSettingsStore((s) => s.captioningIntervalValue)
  const defaultCaptionStylePresetId = useSettingsStore((s) => s.defaultCaptionStylePresetId)
  const setSetting = useSettingsStore((s) => s.setSetting)
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults)
  const uiSoundsEnabled = useUiSoundStore((s) => s.enabled)
  const uiSoundVolume = useUiSoundStore((s) => s.volume)
  const uiSoundVoice = useUiSoundStore((s) => s.voice)
  const setUiSoundEnabled = useUiSoundStore((s) => s.setEnabled)
  const setUiSoundVolume = useUiSoundStore((s) => s.setVolume)
  const setUiSoundVoice = useUiSoundStore((s) => s.setVoice)

  const intervalBounds = CAPTIONING_INTERVAL_BOUNDS[captioningIntervalUnit]
  const intervalInputStep = captioningIntervalUnit === 'seconds' ? 0.5 : 1
  const intervalUnitLabel =
    captioningIntervalUnit === 'seconds' ? t('settings.ai.unitSec') : t('settings.ai.unitFrames')

  const mediaItems = useMediaLibraryStore((s) => s.mediaItems)
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus)

  const [activeSection, setActiveSection] = useState<SettingsSectionId>('providers')
  useEffect(() => {
    if (!open || !target) return
    setActiveSection(target.section)
    if (!target.part) return
    const part = target.part
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(`[data-settings-part="${CSS.escape(part)}"]`)?.scrollIntoView({ block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, target])

  const reduceMotion = useReducedMotion()
  const contentRef = useRef<HTMLDivElement>(null)

  const [clearState, setClearState] = useState<'idle' | 'clearing' | 'done' | 'partial'>('idle')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [regenState, setRegenState] = useState<'idle' | 'working' | 'done' | 'partial'>('idle')
  const [regenProgress, setRegenProgress] = useState('')
  const [proxyState, setProxyState] = useState<'idle' | 'clearing' | 'done' | 'partial'>('idle')
  const [proxyGenerateState, setProxyGenerateState] = useState<'idle' | 'queueing' | 'done'>('idle')
  const [clearFeedback, setClearFeedback] = useState<ActionFeedback | null>(null)
  const [regenFeedback, setRegenFeedback] = useState<ActionFeedback | null>(null)
  const [proxyFeedback, setProxyFeedback] = useState<ActionFeedback | null>(null)

  const handleClearCache = useCallback(async () => {
    setClearState('clearing')
    try {
      const items = mediaItems.map((m) => ({ id: m.id, fileName: m.fileName }))
      const result = await clearProjectCaches(items)
      const feedback = getBatchOutcomeFeedback(t, 'clearCache', result)
      setClearFeedback(feedback)
      setClearState(result.failed === 0 ? 'done' : 'partial')
      showBatchOutcomeToast(
        t,
        {
          success: t('settings.toasts.projectCacheCleared'),
          partial: t('settings.toasts.projectCachePartiallyCleared'),
          failure: t('settings.toasts.projectCacheNotCleared'),
        },
        result,
      )
      setTimeout(() => setClearState('idle'), 2000)
    } catch (err) {
      log.error('Failed to clear caches', err)
      setClearFeedback({ tone: 'error', message: t('settings.feedback.couldntClearCache') })
      toast.error(t('settings.toasts.failedToClearCache'))
      setClearState('idle')
    }
  }, [mediaItems, t])

  const handleRegenThumbnails = useCallback(async () => {
    setRegenState('working')
    setRegenProgress('0/' + mediaItems.length)
    try {
      const items = mediaItems.map((m) => ({
        id: m.id,
        fileName: m.fileName,
        mimeType: m.mimeType,
      }))
      const result = await regenerateProjectThumbnails(items, (done, total) => {
        setRegenProgress(`${done}/${total}`)
      })
      const feedback = getBatchOutcomeFeedback(t, 'regenerateThumbnails', result)
      setRegenFeedback(feedback)
      setRegenState(result.failed === 0 ? 'done' : 'partial')
      showBatchOutcomeToast(
        t,
        {
          success: t('settings.toasts.thumbnailsRegenerated'),
          partial: t('settings.toasts.thumbnailsPartiallyRegenerated'),
          failure: t('settings.toasts.thumbnailsNotRegenerated'),
        },
        result,
      )
      setTimeout(() => {
        setRegenState('idle')
        setRegenProgress('')
      }, 2000)
    } catch (err) {
      log.error('Failed to regenerate thumbnails', err)
      setRegenFeedback({
        tone: 'error',
        message: t('settings.feedback.couldntRegenerateThumbnails'),
      })
      toast.error(t('settings.toasts.failedToRegenerateThumbnails'))
      setRegenState('idle')
      setRegenProgress('')
    }
  }, [mediaItems, t])

  const handleClearProxies = useCallback(async () => {
    setProxyState('clearing')
    try {
      const result = await clearProjectProxies(mediaItems)
      const feedback = getBatchOutcomeFeedback(t, 'deleteProxies', result)
      setProxyFeedback(feedback)
      setProxyState(result.failed === 0 ? 'done' : 'partial')
      showBatchOutcomeToast(
        t,
        {
          success: t('settings.toasts.proxiesDeleted'),
          partial: t('settings.toasts.proxiesPartiallyDeleted'),
          failure: t('settings.toasts.proxiesNotDeleted'),
        },
        result,
      )
      setTimeout(() => setProxyState('idle'), 2000)
    } catch (err) {
      log.error('Failed to clear proxies', err)
      setProxyFeedback({ tone: 'error', message: t('settings.feedback.couldntDeleteProxies') })
      toast.error(t('settings.toasts.failedToDeleteProxies'))
      setProxyState('idle')
    }
  }, [mediaItems, t])

  const handleGenerateMissingProxies = useCallback(async () => {
    setProxyGenerateState('queueing')

    try {
      const [{ proxyService }, { mediaLibraryService }] = await Promise.all([
        importProxyService(),
        importMediaLibraryService(),
      ])

      const queuedItems = mediaItems.filter((media) => {
        if (!proxyService.canGenerateProxy(media.mimeType)) {
          return false
        }

        const sharedProxyKey = getSharedProxyKey(media)
        if (proxyService.hasProxy(media.id, sharedProxyKey)) {
          return false
        }

        const status = useMediaLibraryStore.getState().proxyStatus.get(media.id)
        return status !== 'ready' && status !== 'generating'
      })

      queuedItems.forEach((media) => {
        const sharedProxyKey = getSharedProxyKey(media)
        proxyService.setProxyKey(media.id, sharedProxyKey)
        proxyService.generateProxy(
          media.id,
          media.storageType === 'opfs' && media.opfsPath
            ? { kind: 'opfs', path: media.opfsPath, mimeType: media.mimeType }
            : () => mediaLibraryService.getMediaFile(media.id),
          media.width,
          media.height,
          sharedProxyKey,
          { priority: 'background' },
        )
      })

      setProxyGenerateState('done')
      setTimeout(() => setProxyGenerateState('idle'), 2000)
    } catch (err) {
      log.error('Failed to queue missing proxies', err)
      setProxyGenerateState('idle')
    }
  }, [mediaItems])

  const missingProjectProxyCount = mediaItems.filter(
    (media) =>
      media.mimeType.startsWith('video/') &&
      proxyStatus.get(media.id) !== 'ready' &&
      proxyStatus.get(media.id) !== 'generating',
  ).length
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The studios' settings window (Dub Studio's SettingsModal): sections with a hint on the left, the open
          section's title and hint on top, its content scrolling between them, Done at the bottom. */}
      <DialogContent hideCloseButton className="flex h-[min(88vh,760px)] w-[min(94vw,900px)] max-w-none gap-0 overflow-hidden rounded-xl p-0 glass-panel">
        <nav aria-label={t('settings.title')} className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--color-border)] p-3 sm:flex">
          <h2 className="px-2 pb-2 pt-1 text-[15px] font-semibold">{t('settings.title')}</h2>
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon
            const current = activeSection === section.id
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 motion-reduce:transition-none',
                  current
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-text)] shadow-[inset_2px_0_0_var(--color-accent)]'
                    : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]',
                )}
              >
                <Icon className={cn('mt-0.5 h-[15px] w-[15px] shrink-0', current && 'text-[var(--color-accent)]')} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{t(section.labelKey)}</span>
                  <span className="block truncate text-[11px] text-[var(--color-muted)]">{t(`${section.labelKey}Hint`)}</span>
                </span>
              </button>
            )
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
            <div className="min-w-0">
              <DialogTitle className="truncate text-[15px] font-semibold">{t(SECTION_LABEL[activeSection])}</DialogTitle>
              <DialogDescription className="truncate text-[12px] text-[var(--color-muted)]">{t(`${SECTION_LABEL[activeSection]}Hint`)}</DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={t('common.close')}
              title={t('common.close')}
              className="shrink-0 rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)] px-3 py-2 sm:hidden">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                aria-current={activeSection === section.id ? 'page' : undefined}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium',
                  activeSection === section.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]'
                    : 'border-[var(--color-border)] text-[var(--color-muted)]',
                )}
              >
                {t(section.labelKey)}
              </button>
            ))}
          </div>

          <div ref={contentRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={activeSection}
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.12 }}
                  >
                    {activeSection === 'providers' && (
                      <Suspense fallback={null}>
                        <LazyProvidersSettings />
                      </Suspense>
                    )}

                    {activeSection === 'agents' && (
                      <Suspense fallback={null}>
                        <LazyAgentsSection />
                      </Suspense>
                    )}

                    {activeSection === 'network' && (
                      <Suspense fallback={null}>
                        <LazyNetworkSection />
                      </Suspense>
                    )}

                    {activeSection === 'privacy' && (
                      <Suspense fallback={null}>
                        <LazyPrivacySection />
                      </Suspense>
                    )}

                    {activeSection === 'about' && (
                      <Suspense fallback={null}>
                        <LazyAboutSection />
                      </Suspense>
                    )}

                    {activeSection === 'general' && (
                      <SettingsTable>
                        <SettingRow icon={Languages} label={t('settings.general.language')} hint={t('settings.general.languageHint')}>
                          <LanguageSwitcher size="sm" align="end" side="left" />
                        </SettingRow>
                        <SettingRow icon={Speaker} label={t('settings.general.audioOutput')} hint={t('settings.general.audioOutputHint')}>
                          <AudioOutputSetting />
                        </SettingRow>
                        <SettingRow icon={Save} label={t('settings.general.autoSave')} hint={t('settings.general.autoSaveHint')}>
                          <Switch
                            aria-label={t('settings.general.autoSave')}
                            checked={autoSaveInterval > 0}
                            onCheckedChange={(v) => setSetting('autoSaveInterval', v ? 5 : 0)}
                          />
                        </SettingRow>
                        {autoSaveInterval > 0 && (
                          <SettingRow icon={Timer} label={t('settings.general.interval')}>
                            <Slider
                              aria-label={t('settings.general.interval')}
                              className="w-32"
                              value={[autoSaveInterval]}
                              onValueChange={([v]) => setSetting('autoSaveInterval', v || 5)}
                              min={5}
                              max={30}
                              step={5}
                            />
                            <span className="tabnum w-14 text-right text-[12px] text-[var(--color-muted)]">
                              {t('settings.general.intervalMinutes', { count: autoSaveInterval })}
                            </span>
                          </SettingRow>
                        )}
                        <SettingRow icon={Undo2} label={t('settings.general.undoHistoryDepth')} hint={t('settings.general.undoHistoryDepthHint')}>
                          <Slider
                            aria-label={t('settings.general.undoHistoryDepth')}
                            className="w-32"
                            value={[maxUndoHistory]}
                            onValueChange={([v]) => setSetting('maxUndoHistory', v || 10)}
                            min={10}
                            max={200}
                            step={10}
                          />
                          <span className="tabnum w-14 text-right text-[12px] text-[var(--color-muted)]">{maxUndoHistory}</span>
                        </SettingRow>
                        <SettingRow icon={Volume2} label={t('settings.general.uiSounds')} hint={t('settings.general.uiSoundsHint')}>
                          <Switch
                            aria-label={t('settings.general.uiSounds')}
                            checked={uiSoundsEnabled}
                            onCheckedChange={(v) => {
                              setUiSoundEnabled(v)
                              if (v) emitUiSound('confirm')
                            }}
                          />
                        </SettingRow>
                        {uiSoundsEnabled && (
                          <SettingRow icon={Volume1} label={t('settings.general.uiSoundVolume')}>
                            <Slider
                              aria-label={t('settings.general.uiSoundVolume')}
                              className="w-32"
                              value={[uiSoundVolume]}
                              onValueChange={([v]) => {
                                setUiSoundVolume(v ?? 0.6)
                                emitUiSound('select')
                              }}
                              min={0}
                              max={1}
                              step={0.05}
                            />
                            <span className="tabnum w-14 text-right text-[12px] text-[var(--color-muted)]">{Math.round(uiSoundVolume * 100)}%</span>
                          </SettingRow>
                        )}
                        {uiSoundsEnabled && (
                          <SettingRow icon={Music} label={t('settings.general.uiSoundVoice')}>
                            <Select
                              value={uiSoundVoice}
                              onValueChange={(value) => {
                                setUiSoundVoice(value as VoiceName)
                                emitUiSound('confirm')
                              }}
                            >
                              <SelectTrigger className="h-8 w-32" aria-label={t('settings.general.uiSoundVoice')}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {VOICE_OPTIONS.map((option) => (
                                  <SelectPrimitive.Item
                                    key={option.value}
                                    value={option.value}
                                    className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                                  >
                                    <SelectPrimitive.ItemText>
                                      <span className={option.value === uiSoundVoice ? 'font-medium text-primary' : undefined}>{option.label}</span>
                                    </SelectPrimitive.ItemText>
                                  </SelectPrimitive.Item>
                                ))}
                              </SelectContent>
                            </Select>
                            <button
                              type="button"
                              aria-label={t('settings.general.uiSoundPreview')}
                              title={t('settings.general.uiSoundPreview')}
                              onClick={() => previewUiSound(uiSoundVoice)}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          </SettingRow>
                        )}
                      </SettingsTable>
                    )}

                    {activeSection === 'ai' && (
                      <SettingsTable>
                        <SettingRow
                          icon={ScanText}
                          label={t('settings.ai.captionSampleInterval')}
                          hint={t('settings.ai.captionSampleIntervalDescription')}
                          below={
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5" role="group" aria-label={t('settings.ai.captionSampleInterval')}>
                                  {(['seconds', 'frames'] as const).map((unit) => (
                                    <button
                                      key={unit}
                                      type="button"
                                      aria-pressed={captioningIntervalUnit === unit}
                                      onClick={() => setSetting('captioningIntervalUnit', unit)}
                                      className={cn(
                                        'rounded px-2.5 py-1 text-xs transition-colors',
                                        captioningIntervalUnit === unit
                                          ? 'bg-primary/15 text-primary'
                                          : 'text-muted-foreground hover:text-foreground',
                                      )}
                                    >
                                      {unit === 'seconds' ? t('settings.ai.seconds') : t('settings.ai.frames')}
                                    </button>
                                  ))}
                                </div>
                                <Input
                                  aria-label={t('settings.ai.captionSampleInterval')}
                                  type="number"
                                  inputMode="decimal"
                                  className="h-8 w-24"
                                  min={intervalBounds.min}
                                  max={intervalBounds.max}
                                  step={intervalInputStep}
                                  value={captioningIntervalValue}
                                  onChange={(event) => {
                                    const parsed = Number(event.target.value)
                                    if (Number.isFinite(parsed)) {
                                      setSetting('captioningIntervalValue', parsed)
                                    }
                                  }}
                                />
                                <span className="text-xs text-muted-foreground">{intervalUnitLabel}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2 text-xs text-muted-foreground"
                                  onClick={() => {
                                    setSetting('captioningIntervalUnit', 'seconds')
                                    setSetting('captioningIntervalValue', DEFAULT_CAPTIONING_INTERVAL_SECONDS)
                                  }}
                                  disabled={
                                    captioningIntervalUnit === 'seconds' &&
                                    captioningIntervalValue === DEFAULT_CAPTIONING_INTERVAL_SECONDS
                                  }
                                >
                                  {t('common.reset')}
                                </Button>
                              </div>
                              <p className="text-[11px] leading-snug text-[var(--color-muted)]">
                                {t('settings.ai.captionIntervalHint', {
                                  estimate: formatCaptionEstimate(t, captioningIntervalUnit, captioningIntervalValue),
                                })}
                              </p>
                            </div>
                          }
                        />
                        <SettingRow
                          icon={Captions}
                          label={t('settings.ai.defaultCaptionStyle')}
                          hint={t('settings.ai.defaultCaptionStyleDescription')}
                          below={
                            <div className="flex flex-wrap gap-1.5">
                              {CAPTION_STYLE_PRESETS.map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  title={t(preset.hintKey)}
                                  aria-pressed={defaultCaptionStylePresetId === preset.id}
                                  onClick={() => setSetting('defaultCaptionStylePresetId', preset.id)}
                                  className={cn(
                                    'rounded-md border px-2.5 py-1 text-xs transition-colors',
                                    defaultCaptionStylePresetId === preset.id
                                      ? 'border-primary bg-primary/15 text-primary'
                                      : 'border-[var(--color-border)] text-muted-foreground hover:text-foreground',
                                  )}
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          }
                        />
                      </SettingsTable>
                    )}

                    {activeSection === 'timeline' && (
                      <SettingsTable>
                        <SettingRow icon={Magnet} label={t('settings.timeline.snapByDefault')} hint={t('settings.timeline.snapByDefaultDescription')}>
                          <Switch
                            aria-label={t('settings.timeline.snapByDefault')}
                            checked={snapEnabled}
                            onCheckedChange={(v) => setSetting('snapEnabled', v)}
                          />
                        </SettingRow>
                        <SettingRow icon={AudioWaveform} label={t('settings.timeline.showWaveforms')} hint={t('settings.timeline.showWaveformsHint')}>
                          <Switch
                            aria-label={t('settings.timeline.showWaveforms')}
                            checked={showWaveforms}
                            onCheckedChange={(v) => setSetting('showWaveforms', v)}
                          />
                        </SettingRow>
                        <SettingRow icon={Film} label={t('settings.timeline.showFilmstrips')} hint={t('settings.timeline.showFilmstripsHint')}>
                          <Switch
                            aria-label={t('settings.timeline.showFilmstrips')}
                            checked={showFilmstrips}
                            onCheckedChange={(v) => setSetting('showFilmstrips', v)}
                          />
                        </SettingRow>
                        <SettingRow icon={Images} label={t('settings.timeline.enableFilmstripExtraction')} hint={t('settings.timeline.enableFilmstripExtractionDescription')}>
                          <Switch
                            aria-label={t('settings.timeline.enableFilmstripExtraction')}
                            checked={enableFilmstripExtraction}
                            onCheckedChange={(v) => setSetting('enableFilmstripExtraction', v)}
                          />
                        </SettingRow>
                      </SettingsTable>
                    )}

                    {activeSection === 'storage' && (
                      <div className="space-y-4">
                        <SettingsTable>
                          <SettingRow icon={Link2} label={t('media.url.tool.label')} hint={t('media.url.tool.hint')}>
                            <UrlToolSetting />
                          </SettingRow>
                          <SettingRow icon={Film} label={t('settings.storage.generateMissingProxies')} hint={t('settings.storage.generateMissingProxiesDescription')}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 min-w-28 gap-1.5"
                              onClick={handleGenerateMissingProxies}
                              disabled={proxyGenerateState !== 'idle' || missingProjectProxyCount === 0}
                            >
                              {proxyGenerateState === 'queueing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              {proxyGenerateState === 'done' && <Check className="w-3.5 h-3.5" />}
                              {proxyGenerateState === 'queueing'
                                ? t('common.queueing')
                                : proxyGenerateState === 'done'
                                  ? t('settings.storage.queued')
                                  : missingProjectProxyCount > 0
                                    ? t('settings.storage.generateWithCount', { count: missingProjectProxyCount })
                                    : t('settings.storage.upToDate')}
                            </Button>
                          </SettingRow>
                          <SettingRow
                            icon={Eraser}
                            label={t('settings.storage.clearProjectCache')}
                            hint={t('settings.storage.clearProjectCacheDescription')}
                            below={clearFeedback && <p className={cn('text-[11px]', clearFeedback.tone === 'error' ? 'text-[var(--color-warn)]' : 'text-[var(--color-muted)]')}>{clearFeedback.message}</p>}
                          >
                            <Button variant="outline" size="sm" className="h-8 min-w-28 gap-1.5" onClick={() => setShowClearConfirm(true)} disabled={clearState !== 'idle'}>
                              {clearState === 'clearing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              {clearState === 'done' && <Check className="w-3.5 h-3.5" />}
                              {clearState === 'partial' && <TriangleAlert className="w-3.5 h-3.5" />}
                              {clearState === 'clearing'
                                ? t('common.clearing')
                                : clearState === 'done'
                                  ? t('settings.storage.cleared')
                                  : clearState === 'partial'
                                    ? t('common.partial')
                                    : t('settings.storage.clear')}
                            </Button>
                          </SettingRow>
                          <SettingRow
                            icon={ImagePlus}
                            label={t('settings.storage.regenerateThumbnails')}
                            hint={t('settings.storage.regenerateThumbnailsDescription')}
                            below={regenFeedback && <p className={cn('text-[11px]', regenFeedback.tone === 'error' ? 'text-[var(--color-warn)]' : 'text-[var(--color-muted)]')}>{regenFeedback.message}</p>}
                          >
                            <Button variant="outline" size="sm" className="h-8 min-w-28 gap-1.5" onClick={handleRegenThumbnails} disabled={regenState !== 'idle'}>
                              {regenState === 'working' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              {regenState === 'done' && <Check className="w-3.5 h-3.5" />}
                              {regenState === 'partial' && <TriangleAlert className="w-3.5 h-3.5" />}
                              {regenState === 'working'
                                ? regenProgress
                                : regenState === 'done'
                                  ? t('common.done')
                                  : regenState === 'partial'
                                    ? t('common.partial')
                                    : t('settings.storage.regenerate')}
                            </Button>
                          </SettingRow>
                          <SettingRow
                            icon={Trash2}
                            label={t('settings.storage.deleteProxies')}
                            hint={t('settings.storage.deleteProxiesDescription')}
                            below={proxyFeedback && <p className={cn('text-[11px]', proxyFeedback.tone === 'error' ? 'text-[var(--color-warn)]' : 'text-[var(--color-muted)]')}>{proxyFeedback.message}</p>}
                          >
                            <Button variant="outline" size="sm" className="h-8 min-w-28 gap-1.5" onClick={handleClearProxies} disabled={proxyState !== 'idle'}>
                              {proxyState === 'clearing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              {proxyState === 'done' && <Check className="w-3.5 h-3.5" />}
                              {proxyState === 'partial' && <TriangleAlert className="w-3.5 h-3.5" />}
                              {proxyState === 'clearing'
                                ? t('common.deleting')
                                : proxyState === 'done'
                                  ? t('settings.storage.deleted')
                                  : proxyState === 'partial'
                                    ? t('common.partial')
                                    : t('common.delete')}
                            </Button>
                          </SettingRow>
                        </SettingsTable>
                        <section className="space-y-2">
                          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{t('settings.storage.localAi')}</h4>
                          <p className="text-[12px] text-[var(--color-muted)]">{t('settings.storage.localAiDescription')}</p>
                          <SettingsTable>
                            <LocalInferenceUnloadControl className="px-3 py-2.5" labelClassName="text-[13px] font-medium" descriptionClassName="text-[11px] leading-snug" />
                          </SettingsTable>
                          <LocalModelCacheControl />
                        </section>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-5 py-3">
            {RESETTABLE.has(activeSection) ? (
              <Button variant="ghost" size="sm" onClick={resetToDefaults} className="h-8 gap-1.5 text-[var(--color-muted)]">
                <RotateCcw className="h-3.5 w-3.5" />
                {t('common.reset')}
              </Button>
            ) : (
              <span />
            )}
            <Button size="sm" onClick={() => onOpenChange(false)} className="h-8 px-5 font-semibold">
              {t('settings.done')}
            </Button>
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.storage.clearCacheConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.storage.clearCacheConfirmDescription', { count: mediaItems.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleClearCache()
              }}
            >
              {t('settings.storage.clearCache')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
