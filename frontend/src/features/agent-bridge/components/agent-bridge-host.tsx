import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import { i18n } from '@/i18n'
import { isDesktop } from '@/infrastructure/desktop'
import { emitUiSound } from '@/shared/ui/ui-sound'
import { toast } from 'sonner'
import {
  AGENT_ACTION,
  bridgeError,
  registerBridgeCommand,
  startBridge,
  takeArgs,
  textArg,
} from '../services/bridge'
import { registerEditorCommands, type ShowProject } from '../services/editor-commands'
import { ProposalCard } from './proposal-card'

let registered = false

/** The server writes its own messages (errors, the update window) in the language the window shows. */
function reportLanguage(language: string): void {
  void isDesktop().then((desktop) => {
    if (!desktop) return
    fetch('/api/ui-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language }),
    }).catch((error: unknown) =>
      console.error('[ERROR] the window language did not reach VideoSOS:', error),
    )
  })
}

const TONES = ['info', 'success', 'error'] as const

/** A message from the agent to the person: shown as the window's own messages are, so the journal keeps it. */
function notify(args: Record<string, unknown>) {
  takeArgs('ui_notify', args, ['text', 'tone'])
  const text = (textArg('ui_notify', args, 'text') ?? '').trim()
  if (!text) throw bridgeError('missing', { command: 'ui_notify', field: 'text' })
  const tone = textArg('ui_notify', args, 'tone') ?? 'info'
  if (!(TONES as readonly string[]).includes(tone))
    throw bridgeError('bad_value', {
      command: 'ui_notify',
      field: 'tone',
      expected: TONES.join(', '),
    })
  if (tone === 'error') toast.error(text)
  else if (tone === 'success') toast.success(text)
  else toast.info(text)
  emitUiSound(tone === 'error' ? 'error' : tone === 'success' ? 'confirm' : 'select')
  return { text: 'Shown.' }
}

/**
 * Connects this window to VideoSOS's MCP server and captions every action an agent takes in it under the
 * top bar ("Agent: edits the timeline"), as Dub Studio does. The caption is not a message: the change itself
 * reaches the journal from the server.
 */
export function AgentBridgeHost({ showProject }: { showProject: ShowProject }) {
  const { t } = useTranslation()
  const [caption, setCaption] = useState<{ key: number; text: string } | null>(null)

  useEffect(() => {
    if (!registered) {
      registered = true
      registerEditorCommands(showProject)
      registerBridgeCommand('notify', notify)
      reportLanguage(i18n.language)
      i18n.on('languageChanged', reportLanguage)
    }
    startBridge()
    const show = (event: Event) => {
      const { command } = (event as CustomEvent<{ command: string }>).detail
      setCaption({
        key: Date.now(),
        text: t(`agent.commands.${command}`, { defaultValue: command.replace(/_/g, ' ') }),
      })
    }
    window.addEventListener(AGENT_ACTION, show)
    return () => window.removeEventListener(AGENT_ACTION, show)
  }, [t, showProject])

  useEffect(() => {
    if (!caption) return
    const timer = window.setTimeout(() => setCaption(null), 2600)
    return () => window.clearTimeout(timer)
  }, [caption])

  const slot = caption ? document.getElementById('agent-caption-slot') : null
  if (!caption || !slot) return <ProposalCard />
  return (
    <>
      <ProposalCard />
      {createPortal(
        <div
          key={caption.key}
          role="status"
          aria-live="polite"
          className="inline-flex max-w-[min(92vw,640px)] items-center gap-2 whitespace-nowrap rounded-full border border-[var(--color-accent)] bg-[var(--color-surface)] px-3.5 py-1.5 text-xs text-[var(--color-text)] shadow-xl animate-in fade-in zoom-in-95 duration-200"
        >
          <Bot className="size-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden />
          <span className="shrink-0 font-semibold">{t('agent.name')}</span>
          <span className="truncate">{caption.text}</span>
        </div>,
        slot,
      )}
    </>
  )
}
