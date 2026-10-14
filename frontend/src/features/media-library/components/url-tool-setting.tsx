import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { UrlError, urlApi } from '../services/url-api'
import { useUrlFetchStore } from '../stores/url-fetch-store'

function useToolActions() {
  const [error, setError] = useState<string | null>(null)
  const fail = (problem: unknown) => setError(problem instanceof UrlError ? `${problem.code}: ${problem.detail}` : String(problem))
  const install = () => void urlApi.install().then((answer) => useUrlFetchStore.getState().setTool(answer.status), fail)
  const update = () => void urlApi.update().then((answer) => useUrlFetchStore.getState().setTool(answer.status), fail)
  return { error, install, update }
}

/**
 * The link tool in the settings, as Dub Studio shows it under its models: Update while it works, Install while
 * it is missing; below, the yt-dlp version at work, the latest on GitHub, when it was looked for and any failure.
 */
export function UrlToolSetting() {
  const { t, i18n } = useTranslation()
  const tool = useUrlFetchStore((state) => state.tool)
  const { error, install, update } = useToolActions()
  if (!tool) return null
  if (!tool.supported) return <span className="text-[11px] text-[var(--color-muted)]">{t('media.url.unsupported')}</span>
  const { ytdlp } = tool
  const checked = ytdlp.checked_at > 0 ? new Date(ytdlp.checked_at * 1000).toLocaleString(i18n.language) : null
  const problem = ytdlp.last_error ?? tool.install.error ?? error
  return (
    <div className="flex flex-col items-end gap-1">
      {tool.ready ? (
        <Button variant="outline" size="sm" className="h-8 min-w-28 gap-1.5" disabled={ytdlp.updating} onClick={update}>
          {ytdlp.updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {ytdlp.updating ? t('media.url.updating') : t('media.url.tool.update')}
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="h-8 min-w-28 gap-1.5" disabled={tool.install.installing} onClick={install}>
          {tool.install.installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {tool.install.installing ? t('media.url.tool.installing') : t('media.url.install')}
        </Button>
      )}
      <span className="max-w-56 text-right text-[11px] leading-snug text-[var(--color-muted)]">
        {tool.ready ? `${t('media.url.tool.version', { version: ytdlp.version })} · ${ytdlp.updated ? t('media.url.tool.fromUpdate') : t('media.url.tool.pinned')}` : null}
        {tool.ready && ytdlp.latest ? `, ${t('media.url.tool.latest', { version: ytdlp.latest })}` : null}
        {tool.ready && checked ? <span className="block">{t('media.url.tool.checked', { when: checked })}</span> : null}
      </span>
      {problem && <span className="max-w-56 break-words text-right text-[11px] text-[var(--color-warn)]">{problem}</span>}
    </div>
  )
}
