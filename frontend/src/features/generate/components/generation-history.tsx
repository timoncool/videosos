import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpDown, BarChart3, Columns2, Pause, Play, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  formatUsd,
  generateApi,
  PROVIDER_LABELS,
  TASKS,
  type Job,
  type Spend,
  type Task,
} from '../services/generate-api'
import { JobCard } from './job-card'

type StatusFilter = 'all' | 'done' | 'running' | 'failed'

/** The orders the history can be read in, as Dub Studio's project list has them. */
const ORDERS = ['newest', 'oldest', 'costliest', 'cheapest'] as const
type Order = (typeof ORDERS)[number]
const ORDER_KEY = 'videosos-history-order'

// the order is a view of this window, so it lives in the window's storage
function savedOrder(): Order {
  const saved = localStorage.getItem(ORDER_KEY)
  return ORDERS.find((order) => order === saved) ?? 'newest'
}

function price(job: Job): number {
  return job.cost ?? job.estimate ?? 0
}

const SORTERS: Record<Order, (a: Job, b: Job) => number> = {
  newest: (a, b) => b.created - a.created,
  oldest: (a, b) => a.created - b.created,
  costliest: (a, b) => price(b) - price(a) || b.created - a.created,
  cheapest: (a, b) => price(a) - price(b) || b.created - a.created,
}

const RUNNING = new Set(['queued', 'sending', 'running'])

function promptOf(job: Job): string {
  const found = Object.entries(job.values).find(([key]) => /prompt|^input$|^text$/i.test(key))?.[1]
  return typeof found === 'string' ? found : ''
}

/** What the project spent, by task, provider and model (as VideoSOS 1 showed it). */
function StatsDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [spend, setSpend] = useState<Spend | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    generateApi
      .spend(projectId)
      .then(setSpend)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
  }, [projectId])
  const row = (key: string, label: string, usd: number, jobs: number) => (
    <div key={key} className="flex items-baseline gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="tabnum text-muted-foreground">
        {t('settings.providers.jobs', { count: jobs })}
      </span>
      <span className="tabnum w-16 text-right">{formatUsd(usd)}</span>
    </div>
  )
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('generate.stats.title')}</DialogTitle>
        </DialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {spend && (
          <div className="space-y-4">
            <p className="text-sm">
              {t('generate.stats.total', {
                total: formatUsd(spend.total),
                today: formatUsd(spend.today),
              })}
            </p>
            {spend.total === 0 && (
              <p className="text-xs text-muted-foreground">{t('generate.stats.empty')}</p>
            )}
            {spend.tasks.length > 0 && (
              <section className="space-y-1">
                <h4 className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t('generate.stats.byTask')}
                </h4>
                {spend.tasks.map((each) =>
                  row(
                    each.task || 'other',
                    each.task ? t(`generate.tasks.${each.task}`) : t('generate.stats.other'),
                    each.usd,
                    each.jobs,
                  ),
                )}
              </section>
            )}
            {spend.providers.length > 0 && (
              <section className="space-y-1">
                <h4 className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t('generate.stats.byProvider')}
                </h4>
                {spend.providers.map((each) =>
                  row(each.provider, PROVIDER_LABELS[each.provider], each.usd, each.jobs),
                )}
              </section>
            )}
            {spend.models.length > 0 && (
              <section className="space-y-1">
                <h4 className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t('generate.stats.byModel')}
                </h4>
                {spend.models.map((each) =>
                  row(
                    `${each.provider}:${each.model}`,
                    `${each.model_name} · ${PROVIDER_LABELS[each.provider]}`,
                    each.usd,
                    each.jobs,
                  ),
                )}
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Two to four results side by side; videos play and stop together, from the same moment. */
function CompareDialog({ jobs, onClose }: { jobs: Job[]; onClose: () => void }) {
  const { t } = useTranslation()
  const videos = useRef<HTMLVideoElement[]>([])
  const [playing, setPlaying] = useState(false)
  const together = (play: boolean) => {
    const at = videos.current[0]?.currentTime ?? 0
    for (const video of videos.current) {
      video.currentTime = at
      if (play) void video.play()
      else video.pause()
    }
    setPlaying(play)
  }
  const hasVideo = jobs.some((job) => job.outputs[0]?.kind === 'video')
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(94vw,1400px)]">
        <DialogHeader>
          <DialogTitle>{t('generate.compare.title')}</DialogTitle>
        </DialogHeader>
        {hasVideo && (
          <Button
            size="sm"
            variant="outline"
            className="w-fit gap-1.5"
            onClick={() => together(!playing)}
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing ? t('generate.compare.pause') : t('generate.compare.play')}
          </Button>
        )}
        <div className="grid grid-cols-2 gap-3">
          {jobs.map((job, index) => {
            const output = job.outputs[0]
            if (!output) return null
            const url = generateApi.fileUrl(job.id, output.index)
            return (
              <figure key={job.id} className="space-y-1">
                {output.kind === 'image' && (
                  <img
                    src={url}
                    alt=""
                    className="max-h-[38vh] w-full rounded border border-border bg-black object-contain"
                  />
                )}
                {output.kind === 'video' && (
                  <video
                    ref={(element) => {
                      if (element) videos.current[index] = element
                    }}
                    src={url}
                    controls
                    muted={index > 0}
                    preload="metadata"
                    className="max-h-[38vh] w-full rounded border border-border bg-black"
                  />
                )}
                {output.kind === 'audio' && (
                  <audio src={url} controls preload="metadata" className="w-full" />
                )}
                {output.kind === 'text' && (
                  <p className="max-h-[38vh] overflow-y-auto whitespace-pre-wrap rounded border border-border p-2 text-xs">
                    {output.text}
                  </p>
                )}
                <figcaption className="text-[11px] text-muted-foreground">
                  {job.model_name} · {PROVIDER_LABELS[job.provider]}
                  {job.cost !== null && ` · ${formatUsd(job.cost)}`}
                </figcaption>
              </figure>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The project's generations: find one by its words or model, narrow by task and state, compare, see the spend. */
export function GenerationHistory({
  jobs,
  projectId,
  onReuse,
}: {
  jobs: Job[]
  projectId: string | null
  onReuse: (job: Job) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [task, setTask] = useState<Task | 'all'>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [picked, setPicked] = useState<string[]>([])
  const [stats, setStats] = useState(false)
  const [compare, setCompare] = useState(false)
  const [order, setOrder] = useState<Order>(savedOrder)
  const choose = (next: Order) => {
    setOrder(next)
    localStorage.setItem(ORDER_KEY, next)
  }

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return jobs
      .filter((job) => {
        if (task !== 'all' && job.task !== task) return false
        if (status === 'done' && job.status !== 'done') return false
        if (status === 'failed' && job.status !== 'failed' && job.status !== 'cancelled')
          return false
        if (status === 'running' && !RUNNING.has(job.status)) return false
        const haystack = `${promptOf(job)} ${job.model_name} ${job.model}`.toLowerCase()
        return words.every((word) => haystack.includes(word))
      })
      .sort(SORTERS[order])
  }, [jobs, query, task, status, order])

  const comparable = (job: Job) => job.status === 'done' && job.outputs.length > 0
  const pickedJobs = jobs.filter((job) => picked.includes(job.id))
  const select =
    'h-8 min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none'
  const icon = 'h-7 w-7 p-0 text-[var(--color-muted)] hover:text-[var(--color-text)]'

  return (
    <div className="space-y-2 p-3" data-testid="generate-history">
      <div className="flex items-center gap-1.5">
        <h3 className="mr-auto flex items-baseline gap-1.5 whitespace-nowrap text-[11px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
          {t('generate.historyTitle')}
          <span className="tabnum tracking-normal">{jobs.length}</span>
        </h3>
        {picked.length >= 2 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => setCompare(true)}
            data-testid="generate-compare"
          >
            <Columns2 className="h-3 w-3" />
            {t('generate.compare.button', { count: picked.length })}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className={icon}
              aria-label={t('generate.sort.label', { order: t(`generate.sort.${order}`) })}
              title={t('generate.sort.label', { order: t(`generate.sort.${order}`) })}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('generate.sort.title')}
            </DropdownMenuLabel>
            {ORDERS.map((each) => (
              <DropdownMenuCheckboxItem
                key={each}
                checked={each === order}
                onCheckedChange={() => choose(each)}
                className="text-xs"
              >
                {t(`generate.sort.${each}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {projectId && (
          <Button
            size="sm"
            variant="ghost"
            className={icon}
            onClick={() => setStats(true)}
            aria-label={t('generate.stats.button')}
            title={t('generate.stats.button')}
            data-testid="generate-stats"
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted)]" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('generate.filter.search')}
          aria-label={t('generate.filter.search')}
          className="h-8 pl-8 text-[12px]"
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          value={task}
          onChange={(event) => setTask(event.target.value as Task | 'all')}
          className={select}
          aria-label={t('generate.filter.task')}
        >
          <option value="all">{t('generate.filter.allTasks')}</option>
          {TASKS.map((each) => (
            <option key={each} value={each}>
              {t(`generate.tasks.${each}`)}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          className={select}
          aria-label={t('generate.filter.status')}
        >
          <option value="all">{t('generate.filter.allStates')}</option>
          <option value="done">{t('generate.status.done')}</option>
          <option value="running">{t('generate.status.running')}</option>
          <option value="failed">{t('generate.status.failed')}</option>
        </select>
      </div>
      {shown.length === 0 && (
        <p className="text-[11px] text-muted-foreground">{t('generate.filter.nothing')}</p>
      )}
      {shown.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          onReuse={onReuse}
          selected={picked.includes(job.id)}
          onSelect={
            comparable(job)
              ? (on) =>
                  setPicked((current) =>
                    on
                      ? [...current.filter((id) => id !== job.id), job.id].slice(-4)
                      : current.filter((id) => id !== job.id),
                  )
              : undefined
          }
        />
      ))}
      {stats && projectId && <StatsDialog projectId={projectId} onClose={() => setStats(false)} />}
      {compare && pickedJobs.length >= 2 && (
        <CompareDialog jobs={pickedJobs} onClose={() => setCompare(false)} />
      )}
    </div>
  )
}
