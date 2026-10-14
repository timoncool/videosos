import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import { api, type McpStatus } from '../services/studio-api'

// The MCP server for whoever connects an agent: whether one is connected, the address and what to paste into
// Claude Code or another client. The server runs with the program.
const SERVER_NAME = 'videosos'

function CopyField({
  label,
  value,
  multiline,
}: {
  label: string
  value: string
  multiline?: boolean
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--color-muted)]">{label}</span>
        <button
          type="button"
          onClick={() =>
            void copy().catch((error: Error) => console.error('[ERROR] copy failed:', error))
          }
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[var(--color-border)] text-[11px] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? t('agent.copied') : t('agent.copy')}
        </button>
      </div>
      <pre
        className={`overflow-x-auto rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] px-2 py-1.5 mono text-[11px] ${multiline ? 'whitespace-pre' : 'whitespace-nowrap'}`}
      >
        {value}
      </pre>
    </div>
  )
}

export default function AgentPanel() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .mcpStatus()
        .then((body) => {
          if (!alive) return
          setStatus(body)
          setFailed(null)
        })
        .catch((error: Error) => {
          if (alive) setFailed(error.message)
        })
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const url = api.mcpUrl()
  const config = JSON.stringify(
    { mcpServers: { [SERVER_NAME]: { type: 'streamable-http', url } } },
    null,
    2,
  )
  const dot = (on: boolean) => (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${on ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-muted)]'}`}
    />
  )

  return (
    <div className="w-full min-w-0">
      <div className="px-2.5 py-2 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] space-y-2.5">
        <p className="text-[12px] leading-5 text-[var(--color-text)]">{t('agent.intro')}</p>
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center gap-2">
            {dot(Boolean(status?.agent_connected))}
            {status?.agent_last_call
              ? t('agent.lastCall', {
                  call: status.agent_last_call,
                  seconds: status.agent_seconds_ago ?? 0,
                })
              : t('agent.none')}
          </div>
          {status?.window_open !== undefined && (
            <div className="flex items-center gap-2">
              {dot(status.window_open)}
              {status.window_open ? t('agent.windowOn') : t('agent.windowOff')}
            </div>
          )}
          {failed && (
            <div className="text-[var(--color-warn)]">
              {t('agent.failed')}: {failed}
            </div>
          )}
        </div>
        <CopyField label={t('agent.address')} value={url} />
        <CopyField
          label="Claude Code"
          value={`claude mcp add --transport http ${SERVER_NAME} ${url}`}
        />
        <CopyField label={t('agent.config')} value={config} multiline />
      </div>
    </div>
  )
}
