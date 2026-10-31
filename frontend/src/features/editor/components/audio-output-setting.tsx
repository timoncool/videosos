import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  listAudioOutputs,
  useAudioOutputStore,
  type AudioOutputDevice,
} from '@/shared/state/audio-output-store'

const DEFAULT = 'default-output'

/**
 * The sound output of the preview, as Bulka's audio device choice: the list is read when it is opened (the
 * browser names devices only to a page allowed the microphone once), the choice is kept.
 */
export function AudioOutputSetting() {
  const { t } = useTranslation()
  const deviceId = useAudioOutputStore((state) => state.deviceId)
  const label = useAudioOutputStore((state) => state.label)
  const error = useAudioOutputStore((state) => state.error)
  const [devices, setDevices] = useState<AudioOutputDevice[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const openedByPerson = useRef(false)
  const noteOpener = (event: { isTrusted: boolean }) => {
    openedByPerson.current = event.isTrusted
  }
  const read = (open: boolean) => {
    if (!open || (devices && devices.every((device) => device.named))) return
    listAudioOutputs({ names: openedByPerson.current }).then(setDevices, (problem: unknown) =>
      setListError(problem instanceof Error ? problem.message : String(problem)),
    )
  }
  const shown = devices ?? (deviceId ? [{ id: deviceId, label, named: true }] : [])
  return (
    <div className="flex flex-col items-end gap-1">
      <Select
        value={deviceId || DEFAULT}
        onOpenChange={read}
        onValueChange={(value) => {
          const device = shown.find((each) => each.id === value)
          useAudioOutputStore.getState().choose(value === DEFAULT ? '' : value, device?.label ?? '')
        }}
      >
        <SelectTrigger
          className="h-8 w-56 text-xs"
          aria-label={t('settings.general.audioOutput')}
          onPointerDown={noteOpener}
          onKeyDown={noteOpener}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT} className="text-xs">
            {t('settings.general.audioOutputDefault')}
          </SelectItem>
          {shown.map((device) => (
            <SelectItem key={device.id} value={device.id} className="text-xs">
              {device.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(listError || error) && (
        <span className="max-w-56 break-words text-right text-[11px] text-[var(--color-warn)]">
          {listError ?? error}
        </span>
      )}
    </div>
  )
}
