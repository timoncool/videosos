import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Cpu, Download, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatBytes } from '@/shared/utils/format-utils'
import { generateApi, type LocalModelState, type LocalStatus } from '../services/generate-api'
import { useLocalStatus } from '../hooks/use-local-status'

const DEVICES: LocalStatus['device'][] = ['auto', 'cuda', 'vulkan', 'cpu']

function InstallProgress({ status, what }: { status: LocalStatus; what: string }) {
  const { t } = useTranslation()
  const install = status.install
  if (install.what !== what) return null
  if (install.installing) {
    const share = install.total > 0 ? Math.min(1, install.downloaded / install.total) : 0
    return (
      <div className="space-y-1">
        <div className="h-1.5 overflow-hidden rounded bg-secondary">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${share * 100}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {t('generate.local.downloading', {
            done: formatBytes(install.downloaded),
            total: formatBytes(install.total),
            file: install.current ?? '',
          })}
        </p>
      </div>
    )
  }
  return install.error ? <p className="text-[11px] text-destructive">{install.error}</p> : null
}

function useInstall(onStatus: (status: LocalStatus) => void) {
  const [problem, setProblem] = useState<string | null>(null)
  const install = (what: string) => {
    setProblem(null)
    generateApi.localInstall(what).then(
      (answer) => onStatus(answer.status),
      (error: unknown) => setProblem(error instanceof Error ? error.message : String(error)),
    )
  }
  return { install, problem }
}

/** In the generation panel, for a local model not downloaded yet: what it takes and the download. */
export function LocalModelPrompt({ modelId }: { modelId: string }) {
  const { t } = useTranslation()
  const { status, error, setStatus } = useLocalStatus()
  const { install, problem } = useInstall(setStatus)
  const model = status?.models.find((each) => each.id === modelId)
  if (!status || !model || model.installed) {
    return error ? <p className="text-xs text-destructive">{error}</p> : null
  }
  const engineMissing = !status.device_in_use
  return (
    <div className="space-y-2 rounded-md border border-border bg-secondary/40 p-3 text-xs">
      <p>
        {t('generate.local.notDownloaded', {
          model: model.name,
          size: formatBytes(model.download_bytes),
        })}
        {engineMissing && ` ${t('generate.local.engineToo')}`}
      </p>
      <InstallProgress status={status} what={model.id} />
      {!(status.install.installing && status.install.what === model.id) && (
        <Button
          size="sm"
          className="h-8"
          onClick={() => install(model.id)}
          disabled={status.install.installing}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          {t('generate.local.download', { size: formatBytes(model.download_bytes) })}
        </Button>
      )}
      {problem && <p className="text-destructive">{problem}</p>}
    </div>
  )
}

function ModelRow({
  status,
  model,
  onStatus,
}: {
  status: LocalStatus
  model: LocalModelState
  onStatus: (status: LocalStatus) => void
}) {
  const { t } = useTranslation()
  const { install, problem } = useInstall(onStatus)
  const [removing, setRemoving] = useState(false)
  const busy = status.install.installing && status.install.what === model.id
  const remove = () => {
    setRemoving(true)
    generateApi
      .localRemove(model.id)
      .then(onStatus)
      .finally(() => setRemoving(false))
  }
  return (
    <div
      className="space-y-1.5 rounded-lg border border-border p-3"
      data-testid={`local-model-${model.id}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="whitespace-nowrap text-sm font-medium">{model.name}</span>
        <span className="whitespace-nowrap text-[11px] text-muted-foreground">
          {t(`generate.local.task.${model.task}`)} · {formatBytes(model.size_bytes)}
        </span>
        <span
          className={
            model.installed
              ? 'ml-auto whitespace-nowrap text-[11px] text-emerald-400'
              : 'ml-auto whitespace-nowrap text-[11px] text-muted-foreground'
          }
        >
          {model.installed ? t('generate.local.installed') : t('generate.local.notInstalled')}
        </span>
      </div>
      {model.presets.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          {t('generate.local.accelerators', {
            list: model.presets.map((preset) => preset.label).join(' · '),
          })}
        </p>
      )}
      <InstallProgress status={status} what={model.id} />
      <div className="flex gap-1.5">
        {!model.installed && !busy && (
          <Button
            size="sm"
            className="h-8"
            onClick={() => install(model.id)}
            disabled={status.install.installing}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t('generate.local.download', { size: formatBytes(model.download_bytes) })}
          </Button>
        )}
        {model.installed && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground"
            onClick={remove}
            disabled={removing}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {t('generate.local.remove')}
          </Button>
        )}
      </div>
      {problem && <p className="text-[11px] text-destructive">{problem}</p>}
    </div>
  )
}

/** Settings, Local models: the device, the engine builds and the models this computer runs itself. */
export function LocalModelsSettings() {
  const { t } = useTranslation()
  const { status, error, setStatus } = useLocalStatus()
  const { install, problem } = useInstall(setStatus)
  if (!status) {
    return error ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : (
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    )
  }
  if (!status.supported) {
    return <p className="text-xs text-muted-foreground">{t('generate.local.unsupported')}</p>
  }
  const inUse = status.device_in_use
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('generate.local.intro')}</p>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="local-device" className="text-sm font-medium">
            {t('generate.local.device')}
          </Label>
          <Select
            value={status.device}
            onValueChange={(value) =>
              void generateApi.localDevice(value as LocalStatus['device']).then(setStatus)
            }
          >
            <SelectTrigger id="local-device" className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEVICES.map((device) => (
                <SelectItem key={device} value={device}>
                  {t(`generate.local.devices.${device}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Cpu className="h-3.5 w-3.5" />
          {inUse
            ? t('generate.local.inUse', {
                device: t(`generate.local.devices.${inUse}`),
                gpu: status.gpu || '—',
              })
            : t('generate.local.noEngine', {
                device: t(`generate.local.devices.${status.recommended}`),
              })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {status.engines.map((engine) => (
            <span key={engine.device} className="inline-flex items-center gap-1.5">
              {engine.installed ? (
                <span className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-emerald-400">
                  {t(`generate.local.devices.${engine.device}`)}
                  <Check className="h-3 w-3" />
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={status.install.installing}
                  onClick={() => install(`engine-${engine.device}`)}
                >
                  {t('generate.local.engine', {
                    device: t(`generate.local.devices.${engine.device}`),
                    size: formatBytes(engine.download_bytes),
                  })}
                </Button>
              )}
            </span>
          ))}
        </div>
        {status.engines.map((engine) => (
          <InstallProgress key={engine.device} status={status} what={`engine-${engine.device}`} />
        ))}
        {problem && <p className="text-[11px] text-destructive">{problem}</p>}
        {status.loaded && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px] text-muted-foreground"
            onClick={() =>
              void generateApi.localUnload().then((answer) => setStatus(answer.status))
            }
          >
            {t('generate.local.unload', {
              model:
                status.models.find((each) => each.id === status.loaded?.model)?.name ??
                status.loaded.model,
            })}
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {status.models.map((model) => (
          <ModelRow key={model.id} status={status} model={model} onStatus={setStatus} />
        ))}
      </div>

      <div className="space-y-1.5 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">{t('generate.local.studios')}</p>
        <p className="text-[11px] text-muted-foreground">{t('generate.local.studiosHint')}</p>
        <ul className="space-y-1">
          {status.studios.map((studio) => (
            <li key={studio.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
              <span className="whitespace-nowrap">{studio.name}</span>
              <span
                className={
                  studio.running
                    ? 'ml-auto whitespace-nowrap text-[11px] text-emerald-400'
                    : 'ml-auto whitespace-nowrap text-[11px] text-muted-foreground'
                }
              >
                {studio.running ? t('generate.local.studioRunning') : t('generate.local.studioOff')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
