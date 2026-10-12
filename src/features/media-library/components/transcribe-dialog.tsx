import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Square } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Combobox } from '@/components/ui/combobox'
import { cn } from '@/shared/ui/cn'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSettingsStore } from '@/features/media-library/deps/settings-contract'
import { getMediaTranscriptionModelOptions } from '../transcription/registry'
import {
  isParakeetModel,
  PARAKEET_SUPPORTED_LANGUAGES,
} from '../transcription/transcription-engine'
import {
  getWhisperLanguageSelectValue,
  getWhisperLanguageSettingValue,
  normalizeSelectableWhisperModel,
  WHISPER_AUTO_LANGUAGE_VALUE,
  WHISPER_LANGUAGE_OPTIONS,
  WHISPER_QUANTIZATION_OPTIONS,
} from '@/shared/utils/whisper-settings'
import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage'

export interface TranscribeDialogValues {
  model: MediaTranscriptModel
  quantization: MediaTranscriptQuantization
  language: string
}

interface TranscribeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileName: string
  hasTranscript: boolean
  isRunning: boolean
  /** Progress within the current stage, not across the whole job. */
  progressPercent: number | null
  /** Set while a stage reports no progress (ONNX graph compile) — render a moving bar, not a stalled one. */
  progressIndeterminate?: boolean
  progressLabel: string
  /** Secondary line: a byte counter while downloading, prose while compiling. */
  progressDetail?: string | null
  errorMessage?: string | null
  onStart: (values: TranscribeDialogValues) => void
  onCancel: () => void
}

export function TranscribeDialog({
  open,
  onOpenChange,
  fileName,
  hasTranscript,
  isRunning,
  progressPercent,
  progressIndeterminate = false,
  progressLabel,
  progressDetail = null,
  errorMessage,
  onStart,
  onCancel,
}: TranscribeDialogProps) {
  const { t } = useTranslation()
  const defaultModel = useSettingsStore((s) => s.defaultWhisperModel)
  const defaultQuantization = useSettingsStore((s) => s.defaultWhisperQuantization)
  const defaultLanguage = useSettingsStore((s) => s.defaultWhisperLanguage)
  const clearMediaSkimPreview = useEditorStore((s) => s.clearMediaSkimPreview)
  const clearCompoundClipSkimPreview = useEditorStore((s) => s.clearCompoundClipSkimPreview)
  const beginTranscriptionDialog = useEditorStore((s) => s.beginTranscriptionDialog)
  const endTranscriptionDialog = useEditorStore((s) => s.endTranscriptionDialog)

  const modelOptions = useMemo(() => getMediaTranscriptionModelOptions(), [])

  const [model, setModel] = useState<MediaTranscriptModel>(() =>
    normalizeSelectableWhisperModel(defaultModel),
  )
  const [quantization, setQuantization] = useState<MediaTranscriptQuantization>(defaultQuantization)
  const [languageValue, setLanguageValue] = useState<string>(() =>
    getWhisperLanguageSelectValue(defaultLanguage),
  )

  useEffect(() => {
    if (!open) return
    const nextModel = normalizeSelectableWhisperModel(defaultModel)
    setModel(nextModel)
    setQuantization(defaultQuantization)
    setLanguageValue(
      isParakeetModel(nextModel)
        ? WHISPER_AUTO_LANGUAGE_VALUE
        : getWhisperLanguageSelectValue(defaultLanguage),
    )
  }, [open, defaultLanguage, defaultModel, defaultQuantization])

  useEffect(() => {
    if (!open) return
    beginTranscriptionDialog()
    clearMediaSkimPreview()
    clearCompoundClipSkimPreview()
    usePlaybackStore.getState().setPreviewFrame(null)
    usePlaybackStore.getState().pause()

    return () => {
      endTranscriptionDialog()
    }
  }, [
    beginTranscriptionDialog,
    clearCompoundClipSkimPreview,
    clearMediaSkimPreview,
    endTranscriptionDialog,
    open,
  ])

  const handleStart = () => {
    onStart({
      model,
      quantization,
      language: isParakeetModel(model)
        ? getWhisperLanguageSettingValue(WHISPER_AUTO_LANGUAGE_VALUE)
        : getWhisperLanguageSettingValue(languageValue),
    })
  }

  const handleModelChange = (value: string) => {
    const nextModel = value as MediaTranscriptModel
    setModel(nextModel)
    if (isParakeetModel(nextModel)) {
      // Parakeet detects its supported languages itself and does not accept a language hint.
      // Clear a previous Whisper-only choice so the visible model always matches the engine used.
      setLanguageValue(WHISPER_AUTO_LANGUAGE_VALUE)
    }
  }

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (isRunning && !nextOpen) {
        return
      }
      onOpenChange(nextOpen)
    },
    [isRunning, onOpenChange],
  )

  const title = hasTranscript
    ? t('media.transcribe.refreshTitle')
    : t('media.transcribe.generateTitle')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        className="sm:max-w-md"
        hideCloseButton={isRunning}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (isRunning) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="transcribe-model" className="text-sm">
              {t('media.transcribe.model')}
            </Label>
            <Select value={model} onValueChange={handleModelChange} disabled={isRunning}>
              <SelectTrigger id="transcribe-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isParakeetModel(model) && (
            <div className="space-y-1.5">
              <Label htmlFor="transcribe-quantization" className="text-sm">
                {t('media.transcribe.quantization')}
              </Label>
              <Select
                value={quantization}
                onValueChange={(value) => setQuantization(value as MediaTranscriptQuantization)}
                disabled={isRunning}
              >
                <SelectTrigger id="transcribe-quantization">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WHISPER_QUANTIZATION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isParakeetModel(model) ? (
            <div className="space-y-1.5">
              <Label className="text-sm">{t('media.transcribe.language')}</Label>
              <div className="rounded-md border border-border bg-secondary/35 px-3 py-2.5">
                <div className="text-sm font-medium">{t('media.transcribe.autoDetect')}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t('media.transcribe.parakeetAutoDetects', {
                    count: PARAKEET_SUPPORTED_LANGUAGES.size,
                  })}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {t('media.transcribe.parakeetChooseWhisper')}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="transcribe-language" className="text-sm">
                {t('media.transcribe.language')}
              </Label>
              <Combobox
                id="transcribe-language"
                value={languageValue}
                onValueChange={setLanguageValue}
                options={WHISPER_LANGUAGE_OPTIONS}
                placeholder={t('media.transcribe.autoDetect')}
                searchPlaceholder={t('media.transcribe.searchLanguages')}
                emptyMessage={t('media.transcribe.noLanguages')}
                disabled={isRunning}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('media.transcribe.whisperLanguageHint')}
              </p>
            </div>
          )}

          {errorMessage && !isRunning && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {errorMessage}
            </div>
          )}

          {isRunning && (
            <div className="space-y-1.5 rounded-md border border-border bg-secondary/40 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="truncate">{progressLabel}</span>
                {!progressIndeterminate && progressPercent !== null && (
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                    {progressPercent}%
                  </span>
                )}
              </div>
              {(progressIndeterminate || progressPercent !== null) && (
                <div
                  role="progressbar"
                  aria-label={t('media.transcribe.progressAria')}
                  aria-valuemin={progressIndeterminate ? undefined : 0}
                  aria-valuemax={progressIndeterminate ? undefined : 100}
                  aria-valuenow={progressIndeterminate ? undefined : (progressPercent ?? undefined)}
                  className="h-1 overflow-hidden rounded-full bg-secondary"
                >
                  <div
                    className={cn(
                      'h-full rounded-full bg-blue-500 transition-all duration-300',
                      progressIndeterminate && 'w-1/3 animate-pulse',
                    )}
                    style={
                      progressIndeterminate || progressPercent === null
                        ? undefined
                        : { width: `${progressPercent}%` }
                    }
                  />
                </div>
              )}
              {progressDetail && (
                <div className="text-xs text-muted-foreground tabular-nums">{progressDetail}</div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {isRunning ? (
            <Button variant="destructive" onClick={onCancel}>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              {t('media.transcribe.stop')}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleStart}>{t('media.transcribe.start')}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
