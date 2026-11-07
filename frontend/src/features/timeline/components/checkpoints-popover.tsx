import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Bot, History, Loader2, MapPin, RotateCcw, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useProjectStore } from '../deps/projects'
import { keepCheckpoint, listCheckpoints, restoreCheckpoint, type CheckpointSummary } from '../services/checkpoints'

const ICONS = { agent: Bot, restore: Undo2, asked: MapPin }

/**
 * The project's checkpoints beside undo and redo, as WeftCut shows its agent's: one before each agent's edit,
 * one before each going back, and the ones made here on purpose; any of them brings the timeline back.
 */
export function CheckpointsPopover({ style }: { style?: React.CSSProperties }) {
  const { t, i18n } = useTranslation()
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<CheckpointSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const load = () => {
    if (!projectId) return
    setError(null)
    listCheckpoints(projectId).then(setList, (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
  }
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' })
  const run = (key: string, work: () => Promise<unknown>, done: string) => {
    setBusy(key)
    work()
      .then(() => {
        toast.success(done)
        load()
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => setBusy(null))
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) load()
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" style={style} disabled={!projectId} aria-label={t('timeline.checkpoints.title')} data-tooltip={t('timeline.checkpoints.title')}>
          <History className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-2">
        <p className="px-1 text-xs font-medium">{t('timeline.checkpoints.title')}</p>
        <p className="px-1 text-[11px] text-muted-foreground">{t('timeline.checkpoints.hint')}</p>
        {error && <p className="break-words rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">{error}</p>}
        {list === null && !error && <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />}
        {list?.length === 0 && <p className="px-1 py-1 text-[11px] text-muted-foreground">{t('timeline.checkpoints.empty')}</p>}
        {list && list.length > 0 && (
          <ul className="max-h-64 space-y-0.5 overflow-y-auto" aria-label={t('timeline.checkpoints.title')}>
            {list.map((checkpoint) => {
              const Icon = ICONS[checkpoint.reason]
              const what = checkpoint.label || t(`timeline.checkpoints.reason.${checkpoint.reason}`, { count: checkpoint.edits ?? 0 })
              return (
                <li key={checkpoint.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-secondary/60">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs" title={what}>{what}</span>
                    <span className="block text-[11px] tabular-nums text-muted-foreground">{time.format(checkpoint.created)}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-1.5 text-[11px]"
                    disabled={busy !== null}
                    onClick={() => run(checkpoint.id, () => restoreCheckpoint(checkpoint.id), t('timeline.checkpoints.restored', { time: time.format(checkpoint.created) }))}
                  >
                    {busy === checkpoint.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                    {t('timeline.checkpoints.restore')}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        <form
          className="flex items-center gap-1.5 border-t border-border pt-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!projectId) return
            run('new', () => keepCheckpoint(projectId, 'asked', label.trim() ? { label: label.trim() } : {}), t('timeline.checkpoints.kept'))
            setLabel('')
          }}
        >
          <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t('timeline.checkpoints.label')} aria-label={t('timeline.checkpoints.label')} className="h-7 flex-1 text-xs" />
          <Button type="submit" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy !== null}>
            <MapPin className="h-3 w-3" />
            {t('timeline.checkpoints.keep')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
