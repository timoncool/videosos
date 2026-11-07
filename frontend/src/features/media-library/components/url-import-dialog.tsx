import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AudioLines, Cookie, Download, Film, Link2, Loader2, Play, RefreshCw, Settings, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/shared/ui/cn'
import { openSettings } from '../deps/studio'
import { UrlError, urlApi, type UrlFetch, type UrlProbe, type UrlQuality } from '../services/url-api'
import { useUrlFetchStore } from '../stores/url-fetch-store'

// codes that cookies.txt of a signed-in browser, the network settings, a new yt-dlp or another quality cure
const COOKIE_CODES = new Set(['login_required', 'age_restricted', 'private', 'members_only', 'cookies_invalid'])
const NETWORK_CODES = new Set(['geo_blocked', 'proxy', 'network', 'rate_limited'])
const QUALITY_CODES = new Set(['no_audio', 'format_unavailable'])
const COOKIES_LIMIT = 1024 * 1024

type Failure = { code: string; detail: string }

const failureOf = (error: unknown): Failure =>
  error instanceof UrlError ? { code: error.code, detail: error.detail } : { code: 'generic', detail: error instanceof Error ? error.message : String(error) }

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

function bytes(value: number, language: string): string {
  const [unit, size] = value >= 1e9 ? ['gigabyte', value / 1e9] : value >= 1e6 ? ['megabyte', value / 1e6] : ['kilobyte', value / 1e3]
  return new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: size < 10 ? 1 : 0 }).format(size)
}

interface UrlImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string | null
  /** A direct link to a file, imported by the window itself without the link tool. */
  onDirect: (url: string) => Promise<void>
}

/**
 * A video by its link, as Dub Studio's link field takes one: the link is checked (the video's title, length and
 * the qualities worth asking for), downloaded in the background with its progress, and lands in the project's
 * media library. Until the link tool is installed the dialog offers it, and a direct file link can still be taken
 * as a file.
 */
export function UrlImportDialog({ open, onOpenChange, projectId, onDirect }: UrlImportDialogProps) {
  const { t, i18n } = useTranslation()
  const tool = useUrlFetchStore((state) => state.tool)
  const allFetches = useUrlFetchStore((state) => state.fetches)
  const fetches = useMemo(() => allFetches.filter((fetch) => fetch.project_id === projectId).slice(0, 5), [allFetches, projectId])
  const [url, setUrl] = useState('')
  const [cookies, setCookies] = useState<{ name: string; text: string } | null>(null)
  const [probing, setProbing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [direct, setDirect] = useState(false)
  const [probe, setProbe] = useState<UrlProbe | null>(null)
  const [quality, setQuality] = useState<UrlQuality>('best')
  const [failure, setFailure] = useState<Failure | null>(null)

  useEffect(() => {
    if (open) void urlApi.tool().then(useUrlFetchStore.getState().setTool, (error: unknown) => setFailure(failureOf(error)))
  }, [open])

  const errorText = (code: string) => t(`media.url.err.${code}`, { defaultValue: t('media.url.err.generic') })
  const qualityLabel = (q: UrlQuality) => (q === 'best' ? t('media.url.qBest') : q === 'audio' ? t('media.url.qAudio') : t('media.url.qHeight', { h: q }))
  const phaseText = (fetch: UrlFetch) =>
    fetch.status === 'downloading'
      ? t(`media.url.phase.${fetch.phase}`)
      : fetch.status === 'interrupted'
        ? t('media.url.interrupted')
        : fetch.status === 'failed'
          ? errorText(fetch.error_code ?? 'generic')
          : fetch.status === 'cancelled'
            ? t('media.url.cancelled')
            : fetch.imported.length > 0
              ? t('media.url.inLibrary')
              : t('media.url.phase.done')

  const check = async (typed?: string) => {
    const link = (typed ?? url).trim()
    if (!link || probing) return
    setProbing(true)
    setFailure(null)
    setProbe(null)
    try {
      const found = await urlApi.probe(link, cookies?.text ?? null)
      setProbe(found)
      setQuality(found.qualities.includes('1080') ? '1080' : (found.qualities[0] ?? 'best'))
    } catch (error) {
      setFailure(failureOf(error))
    } finally {
      setProbing(false)
    }
  }

  const start = async () => {
    if (!probe || !projectId || starting) return
    setFailure(null)
    setStarting(true)
    try {
      useUrlFetchStore.getState().upsert(await urlApi.start({ url: probe.url || url.trim(), quality, project_id: projectId, cookies_text: cookies?.text ?? null }))
      setProbe(null)
      setUrl('')
    } catch (error) {
      setFailure(failureOf(error))
    } finally {
      setStarting(false)
    }
  }

  const act = (run: () => Promise<UrlFetch>) => {
    setFailure(null)
    run().then(useUrlFetchStore.getState().upsert, (error: unknown) => setFailure(failureOf(error)))
  }

  const forget = (fetch: UrlFetch) => {
    urlApi.forget(fetch.id).then(() => useUrlFetchStore.getState().remove(fetch.id), (error: unknown) => setFailure(failureOf(error)))
  }

  // after an error cookies.txt cures: the failed download goes and the link is checked again with the file
  const recheck = (fetch?: UrlFetch) => {
    if (!fetch) {
      void check()
      return
    }
    urlApi.forget(fetch.id).then(() => {
      useUrlFetchStore.getState().remove(fetch.id)
      setUrl(fetch.url)
      void check(fetch.url)
    }, (error: unknown) => setFailure(failureOf(error)))
  }

  const pickCookies = (file: File | undefined) => {
    if (!file) return
    if (file.size > COOKIES_LIMIT) {
      setFailure({ code: 'cookies_invalid', detail: file.name })
      return
    }
    file.text().then((text) => setCookies({ name: file.name, text }), (error: unknown) => setFailure(failureOf(error)))
  }

  const takeDirect = async () => {
    setDirect(true)
    setFailure(null)
    try {
      await onDirect(url.trim())
      setUrl('')
    } catch (error) {
      setFailure(failureOf(error))
    } finally {
      setDirect(false)
    }
  }

  const actions = (code: string, fetch?: UrlFetch) => (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {COOKIE_CODES.has(code) && (
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => recheck(fetch)} disabled={!cookies} title={cookies ? undefined : t('media.url.cookiesTip')}>
          <RefreshCw className="h-3 w-3" />
          {t('media.url.checkAgain')}
        </Button>
      )}
      {NETWORK_CODES.has(code) && (
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => openSettings('network')}>
          <Settings className="h-3 w-3" />
          {t('media.url.openNetwork')}
        </Button>
      )}
      {QUALITY_CODES.has(code) && (
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => recheck(fetch)}>
          <RefreshCw className="h-3 w-3" />
          {t('media.url.pickQuality')}
        </Button>
      )}
      {code === 'outdated' && (
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={tool?.ytdlp.updating} onClick={() => void urlApi.update().then((answer) => useUrlFetchStore.getState().setTool(answer.status), (error: unknown) => setFailure(failureOf(error)))}>
          {tool?.ytdlp.updating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {tool?.ytdlp.updating ? t('media.url.updating') : t('media.url.updateTool')}
        </Button>
      )}
    </div>
  )

  const failureBox = (shown: Failure) => (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2">
      <p className="text-xs text-destructive">{errorText(shown.code)}</p>
      {shown.detail && <p className="mt-0.5 break-words font-mono text-[11px] text-muted-foreground">{shown.detail}</p>}
      {actions(shown.code)}
    </div>
  )

  const installing = tool?.install.installing === true
  const installPct = tool && tool.install.total > 0 ? Math.min(100, (tool.install.downloaded / tool.install.total) * 100) : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('media.url.title')}</DialogTitle>
          <DialogDescription>{t('media.url.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (tool?.ready) void check()
            }}
            className="flex items-center gap-2"
          >
            <Link2 className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
            <Input
              autoFocus
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t('media.url.placeholder')}
              aria-label={t('media.url.placeholder')}
              spellCheck={false}
              className="h-8 flex-1 text-sm"
            />
            {tool?.ready && (
              <Button type="submit" size="sm" variant="outline" className="h-8 gap-1.5" disabled={!url.trim() || probing}>
                {probing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {probing ? t('media.url.checking') : t('media.url.check')}
              </Button>
            )}
          </form>

          {tool?.ready && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <label title={t('media.url.cookiesTip')} className={cn('inline-flex cursor-pointer items-center gap-1 transition-colors', cookies ? 'text-[var(--color-accent)]' : 'text-muted-foreground hover:text-foreground')}>
                <Cookie className="h-3 w-3" aria-hidden />
                <span className="max-w-[260px] truncate">{cookies ? cookies.name : t('media.url.cookiesPick')}</span>
                <input
                  type="file"
                  accept=".txt,text/plain"
                  className="hidden"
                  onChange={(event) => {
                    pickCookies(event.target.files?.[0])
                    event.currentTarget.value = ''
                  }}
                />
              </label>
              {cookies && (
                <button type="button" onClick={() => setCookies(null)} title={t('media.url.cookiesClear')} aria-label={t('media.url.cookiesClear')} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          {tool && !tool.supported && <p className="text-xs text-muted-foreground">{t('media.url.unsupported')}</p>}

          {tool && tool.supported && !tool.ready && (
            <div className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
              <p className="leading-snug">{t(tool.missing.includes('ffmpeg') ? 'media.url.toolMissing' : 'media.url.toolMissingYtdlp', { size: bytes(tool.download_bytes, i18n.language) })}</p>
              {installing ? (
                <div className="mt-2 space-y-1" aria-live="polite">
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(installPct)}>
                    <div className="h-full bg-[var(--color-accent)] transition-[width] duration-300" style={{ width: `${installPct}%` }} />
                  </div>
                  <p className="font-mono text-[11px] tabular-nums">
                    {t('media.url.progress', { done: bytes(tool.install.downloaded, i18n.language), total: bytes(tool.install.total, i18n.language) })}
                    {tool.install.current ? ` · ${tool.install.current}` : ''}
                  </p>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void urlApi.install().then((answer) => useUrlFetchStore.getState().setTool(answer.status), (error: unknown) => setFailure(failureOf(error)))}>
                    <Download className="h-3.5 w-3.5" />
                    {t('media.url.install')}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!url.trim() || direct || !projectId} onClick={() => void takeDirect()} title={t('media.url.directHint')}>
                    {direct && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t('media.url.direct')}
                  </Button>
                </div>
              )}
              {tool.install.error && <p className="mt-1.5 break-words text-destructive">{tool.install.error}</p>}
            </div>
          )}

          {failure && failureBox(failure)}

          {probe && (
            <div className="space-y-2.5">
              <div className="flex gap-3">
                <div className="grid h-16 w-28 shrink-0 place-items-center overflow-hidden rounded-md bg-black/40 text-muted-foreground">
                  {probe.thumbnail_data ? <img src={probe.thumbnail_data} alt="" className="h-full w-full object-cover" /> : probe.has_video ? <Film className="h-5 w-5" /> : <AudioLines className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words text-sm font-medium leading-snug" title={probe.title}>
                    {probe.title}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {[probe.uploader, probe.duration != null ? clock(probe.duration) : null, probe.extractor].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
                  {t('media.url.quality')}
                  <Select value={quality} onValueChange={(value) => setQuality(value as UrlQuality)}>
                    <SelectTrigger className="h-8 text-xs" aria-label={t('media.url.quality')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {probe.qualities.map((q) => (
                        <SelectItem key={q} value={q} className="text-xs">
                          {qualityLabel(q)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <Button className="h-8 flex-1 gap-2" onClick={() => void start()} disabled={starting || !projectId}>
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {t('media.url.download')}
                  {quality === 'best' && probe.expected_bytes ? <span className="font-normal opacity-80">≈ {bytes(probe.expected_bytes, i18n.language)}</span> : null}
                </Button>
              </div>
            </div>
          )}

          {fetches.length > 0 && (
            <ul className="space-y-2" aria-label={t('media.url.downloads')}>
              {fetches.map((fetch) => {
                const running = fetch.status === 'downloading'
                const pct = fetch.total ? Math.min(100, (fetch.downloaded / fetch.total) * 100) : null
                return (
                  <li key={fetch.id} className="rounded-md border border-border bg-secondary/30 px-3 py-2" aria-live="polite">
                    <div className="flex items-center gap-2">
                      {running && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-accent)]" />}
                      <span className={cn('min-w-0 flex-1 truncate text-xs font-medium', fetch.status === 'failed' && 'text-destructive')}>{phaseText(fetch)}</span>
                      {running ? (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => act(() => urlApi.cancel(fetch.id))}>
                          {t('media.url.cancel')}
                        </Button>
                      ) : (
                        (fetch.status === 'interrupted' || (fetch.status === 'failed' && !QUALITY_CODES.has(fetch.error_code ?? ''))) && (
                          <Button size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => act(() => urlApi.resume(fetch.id))}>
                            <Play className="h-3 w-3" />
                            {fetch.status === 'failed' ? t('media.url.retry') : t('media.url.resume')}
                          </Button>
                        )
                      )}
                      {!running && (
                        <button type="button" onClick={() => forget(fetch)} title={t('media.url.dismiss')} aria-label={t('media.url.dismiss')} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={fetch.url}>
                      {fetch.title ?? fetch.url}
                    </p>
                    {running && pct != null && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                        <div className="h-full bg-[var(--color-accent)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {running && fetch.downloaded > 0 && (
                      <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] tabular-nums text-muted-foreground">
                        <span>{fetch.total ? t('media.url.progress', { done: bytes(fetch.downloaded, i18n.language), total: bytes(fetch.total, i18n.language) }) : bytes(fetch.downloaded, i18n.language)}</span>
                        {fetch.speed_bps > 0 && <span>{t('media.url.speed', { speed: bytes(fetch.speed_bps, i18n.language) })}</span>}
                        {fetch.eta_s != null && fetch.eta_s > 0 && <span>{t('media.url.eta', { time: clock(fetch.eta_s) })}</span>}
                      </p>
                    )}
                    {fetch.status === 'failed' && fetch.error && <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">{fetch.error}</p>}
                    {fetch.status === 'failed' && fetch.error_code && actions(fetch.error_code, fetch)}
                  </li>
                )
              })}
            </ul>
          )}

          {(probe || fetches.length > 0) && <p className="text-[11px] leading-snug text-muted-foreground">{t('media.url.rights')}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
