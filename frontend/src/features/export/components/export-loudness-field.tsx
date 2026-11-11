/**
 * Loudness of the exported mix: left exactly as mixed unless the user picks a target, and then the field says what the
 * normalisation does to the sound.
 */

import { useTranslation } from 'react-i18next'
import type { Dispatch, SetStateAction } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ExportSettings } from '@/types/export'

const TARGETS = [
  { id: 'stream', lufs: -14 },
  { id: 'podcast', lufs: -16 },
  { id: 'broadcast', lufs: -23 },
] as const

export interface ExportLoudnessFieldProps {
  settings: ExportSettings
  setSettings: Dispatch<SetStateAction<ExportSettings>>
}

export function ExportLoudnessField({ settings, setSettings }: ExportLoudnessFieldProps) {
  const { t } = useTranslation()
  const lufs = settings.loudnessLufs
  const selected = TARGETS.find((target) => target.lufs === lufs)?.id ?? 'off'

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="export-loudness" className="text-sm font-medium">
          {t('export.settings.loudness')}
        </Label>
        <Select
          value={selected}
          onValueChange={(value) =>
            setSettings((previous) => ({
              ...previous,
              loudnessLufs: TARGETS.find((target) => target.id === value)?.lufs,
            }))
          }
        >
          <SelectTrigger id="export-loudness" className="w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{t('export.settings.loudnessOption.off')}</SelectItem>
            {TARGETS.map((target) => (
              <SelectItem key={target.id} value={target.id}>
                {t(`export.settings.loudnessOption.${target.id}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        {lufs === undefined
          ? t('export.settings.loudnessDescription.off')
          : t('export.settings.loudnessDescription.on', { lufs: `−${Math.abs(lufs)}` })}
      </p>
    </div>
  )
}
