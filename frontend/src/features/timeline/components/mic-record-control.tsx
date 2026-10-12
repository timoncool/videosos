import { useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Mic,
  Square,
  Pause,
  Play,
  X,
  Loader2,
  Check,
  ChevronDown,
  Headphones,
  Minus,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { useMicRecordingStore, isMicRecordingActive } from '@/shared/state/mic-recording-store'
import {
  startMicRecording,
  stopMicRecording,
  pauseMicRecording,
  resumeMicRecording,
  cancelMicRecording,
  refreshMicDevices,
  startMicMonitor,
  stopMicMonitor,
  cancelPendingMicRecording,
  isMicRecordingSupported,
} from '../services/mic-recording-controller'

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

/** Live input-level meter — subscribes only to `level` so the toolbar body doesn't re-render. */
const MicLevelMeter = memo(function MicLevelMeter() {
  const level = useMicRecordingStore((s) => s.level)
  // Gentle perceptual curve so quiet speech is still visible.
  const width = Math.min(100, Math.round(Math.pow(level, 0.6) * 130))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-[width] duration-75"
        style={{
          width: `${width}%`,
          backgroundColor: width > 85 ? 'var(--color-destructive)' : 'var(--color-primary)',
        }}
      />
    </div>
  )
})

/** Elapsed-time readout — subscribes only to `elapsedMs`. */
const MicElapsed = memo(function MicElapsed() {
  const elapsedMs = useMicRecordingStore((s) => s.elapsedMs)
  return (
    <span className="min-w-[3.25rem] text-center font-mono text-xs tabular-nums text-foreground">
      {formatElapsed(elapsedMs)}
    </span>
  )
})

/** A menu row that toggles a boolean preference without closing the menu. */
function MicToggleRow({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault()
        onToggle(!checked)
      }}
    >
      <span className="flex-1">{label}</span>
      {checked && <Check className="h-3.5 w-3.5" />}
    </DropdownMenuItem>
  )
}

const MicDevicePicker = memo(function MicDevicePicker({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const devices = useMicRecordingStore((s) => s.devices)
  const selectedDeviceId = useMicRecordingStore((s) => s.selectedDeviceId)
  const setSelectedDeviceId = useMicRecordingStore((s) => s.setSelectedDeviceId)
  const noiseSuppression = useMicRecordingStore((s) => s.noiseSuppression)
  const autoGainControl = useMicRecordingStore((s) => s.autoGainControl)
  const muteWhileRecording = useMicRecordingStore((s) => s.muteWhileRecording)
  const syncOffsetMs = useMicRecordingStore((s) => s.syncOffsetMs)
  const setNoiseSuppression = useMicRecordingStore((s) => s.setNoiseSuppression)
  const setAutoGainControl = useMicRecordingStore((s) => s.setAutoGainControl)
  const setMuteWhileRecording = useMicRecordingStore((s) => s.setMuteWhileRecording)
  const setSyncOffsetMs = useMicRecordingStore((s) => s.setSyncOffsetMs)

  // Re-opening the picker re-reads the (possibly changed) device selection, so
  // restart the monitor when a toggle that affects the stream changes.
  const handleDeviceChange = (deviceId: string | null) => {
    setSelectedDeviceId(deviceId)
    stopMicMonitor()
    void startMicMonitor()
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          void refreshMicDevices()
          void startMicMonitor()
        } else {
          stopMicMonitor()
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          style={{ width: 20, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }}
          disabled={disabled}
          aria-label={t('recording.chooseDevice')}
          data-tooltip={t('recording.chooseDevice')}
        >
          <ChevronDown className="h-3 w-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel>{t('recording.microphone')}</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            handleDeviceChange(null)
          }}
        >
          <span className="flex-1">{t('recording.systemDefault')}</span>
          {selectedDeviceId === null && <Check className="h-3.5 w-3.5" />}
        </DropdownMenuItem>
        {devices.map((device) => (
          <DropdownMenuItem
            key={device.deviceId}
            onSelect={(event) => {
              event.preventDefault()
              handleDeviceChange(device.deviceId)
            }}
          >
            <span className="flex-1 truncate">{device.label}</span>
            {selectedDeviceId === device.deviceId && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}

        <div className="px-2 py-1.5">
          <MicLevelMeter />
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('recording.settings')}</DropdownMenuLabel>
        <MicToggleRow
          label={t('recording.noiseSuppression')}
          checked={noiseSuppression}
          onToggle={setNoiseSuppression}
        />
        <MicToggleRow
          label={t('recording.autoGain')}
          checked={autoGainControl}
          onToggle={setAutoGainControl}
        />
        <MicToggleRow
          label={t('recording.muteWhileRecording')}
          checked={muteWhileRecording}
          onToggle={setMuteWhileRecording}
        />

        <div className="flex items-center justify-between px-2 py-1.5 text-sm">
          <span>{t('recording.syncOffset')}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setSyncOffsetMs(syncOffsetMs - 10)}
              aria-label={t('recording.syncOffsetEarlier')}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="min-w-[3.5rem] text-center font-mono text-xs tabular-nums">
              {syncOffsetMs > 0 ? `+${syncOffsetMs}` : syncOffsetMs} ms
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setSyncOffsetMs(syncOffsetMs + 10)}
              aria-label={t('recording.syncOffsetLater')}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
          <Headphones className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('recording.headphonesHint')}</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

/**
 * Timeline-toolbar microphone control. Records a live voiceover synced to the
 * playhead: pressing record starts playback and lays the finished take onto a
 * new audio track. See `mic-recording-controller.ts`.
 */
export const MicRecordControl = memo(function MicRecordControl() {
  const { t } = useTranslation()
  const status = useMicRecordingStore((s) => s.status)
  const error = useMicRecordingStore((s) => s.error)
  const setError = useMicRecordingStore((s) => s.setError)

  // Populate device labels once on mount (real names appear after first grant).
  // On unmount (e.g. leaving the editor / switching projects) tear down any live
  // take or monitor so the mic stream never stays hot in the background.
  useEffect(() => {
    void refreshMicDevices()
    return () => {
      const status = useMicRecordingStore.getState().status
      if (isMicRecordingActive(status)) {
        cancelMicRecording()
      } else if (status === 'requesting') {
        // A permission prompt / getUserMedia is still pending — cancel it so the
        // mic doesn't go live and start the transport after we've unmounted.
        cancelPendingMicRecording()
      } else {
        stopMicMonitor()
      }
    }
  }, [])

  // Surface controller errors as a toast, then clear so they don't re-fire.
  useEffect(() => {
    if (!error) return
    toast.error(error)
    setError(null)
  }, [error, setError])

  if (!isMicRecordingSupported()) {
    return null
  }

  const btnSize = {
    width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
    height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
  } as const

  const active = isMicRecordingActive(status)
  const isRecording = status === 'recording'
  const isPaused = status === 'paused'
  const isFinalizing = status === 'finalizing'
  const isRequesting = status === 'requesting'

  if (!active && !isFinalizing) {
    // Idle: record button + device picker.
    return (
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          disabled={isRequesting}
          onClick={() => void startMicRecording()}
          aria-label={t('recording.record')}
          data-tooltip={t('recording.recordTooltip')}
        >
          {isRequesting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Mic className="h-3.5 w-3.5" style={{ color: 'var(--color-destructive)' }} />
          )}
        </Button>
        <MicDevicePicker disabled={isRequesting} />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-1.5 py-0.5">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${isRecording ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: 'var(--color-destructive)' }}
        aria-hidden="true"
      />
      <MicElapsed />

      {isFinalizing ? (
        <span className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('recording.saving')}
        </span>
      ) : (
        <>
          <div className="w-10">
            <MicLevelMeter />
          </div>
          <Button
            variant="ghost"
            size="icon"
            style={btnSize}
            onClick={() => (isPaused ? resumeMicRecording() : pauseMicRecording())}
            aria-label={isPaused ? t('recording.resume') : t('recording.pause')}
            data-tooltip={isPaused ? t('recording.resume') : t('recording.pause')}
          >
            {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            style={btnSize}
            onClick={() => void stopMicRecording()}
            aria-label={t('recording.stop')}
            data-tooltip={t('recording.stopTooltip')}
          >
            <Square className="h-3.5 w-3.5" style={{ color: 'var(--color-destructive)' }} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            style={btnSize}
            onClick={cancelMicRecording}
            aria-label={t('recording.cancel')}
            data-tooltip={t('recording.cancelTooltip')}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  )
})
