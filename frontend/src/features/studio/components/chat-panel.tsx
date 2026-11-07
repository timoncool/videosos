import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Check,
  CircleAlert,
  KeyRound,
  Loader2,
  Send,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/shared/ui/cn'
import { hubInline } from '../services/hub-inline'
import { openSettings } from '../services/settings-nav'
import {
  chatModels,
  sendChat,
  stopChat,
  useChatStore,
  type ChatEntry,
  type ChatModel,
} from '../services/chat'

const SUGGESTIONS = ['what', 'picture', 'cut', 'captions'] as const

function usd(amount: number): string {
  if (amount === 0) return '$0'
  return amount >= 0.01 ? `$${amount.toFixed(2)}` : `$${amount.toFixed(4)}`
}

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/

/** An answer's markdown as a chat shows it: paragraphs with their line breaks, bullet and numbered lists. */
function AnswerText({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-xs leading-relaxed text-foreground">
      {text
        .split(/\n\s*\n/)
        .filter((block) => block.trim())
        .map((block, b) => {
          const lines = block.split('\n').filter((line) => line.trim())
          if (lines.every((line) => LIST_ITEM.test(line))) {
            const ordered = /^\s*\d/.test(lines[0] ?? '')
            const List = ordered ? 'ol' : 'ul'
            return (
              <List
                key={b}
                className={cn('space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc')}
              >
                {lines.map((line, l) => (
                  <li key={l}>{hubInline(line.replace(LIST_ITEM, ''), `${b}-${l}`)}</li>
                ))}
              </List>
            )
          }
          return (
            <p key={b}>
              {lines.map((line, l) => (
                <span key={l}>
                  {l > 0 && <br />}
                  {hubInline(line, `${b}-${l}`)}
                </span>
              ))}
            </p>
          )
        })}
    </div>
  )
}

function ToolChip({ tool }: { tool: ChatEntry['tools'][number] }) {
  const { t } = useTranslation()
  return (
    <li
      className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2 py-1 text-[11px]"
      title={tool.summary || undefined}
    >
      {tool.state === 'running' ? (
        <Loader2
          className="h-3 w-3 shrink-0 animate-spin text-[var(--color-accent)]"
          aria-label={t('chat.toolRunning')}
        />
      ) : tool.state === 'ok' ? (
        <Check
          className="h-3 w-3 shrink-0 text-[var(--color-accent)]"
          aria-label={t('chat.toolDone')}
        />
      ) : (
        <CircleAlert
          className="h-3 w-3 shrink-0 text-destructive"
          aria-label={t('chat.toolFailed')}
        />
      )}
      <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="font-mono">{tool.name}</span>
    </li>
  )
}

/**
 * The chat with the assistant, as Bulka's chat tab: it works VideoSOS with the tools an agent has over MCP, on
 * the OpenRouter key, and the person sees each step; the conversation, the model and its cost stay in the window.
 */
export function ChatPanel({
  projectId,
  hasKey,
  assistant,
}: {
  projectId: string | null
  hasKey: boolean
  assistant: 'openrouter' | 'agent'
}) {
  const byAgent = assistant === 'agent'
  const { t, i18n } = useTranslation()
  const entries = useChatStore((state) => state.entries)
  const model = useChatStore((state) => state.model)
  const cost = useChatStore((state) => state.cost)
  const busy = useChatStore((state) => state.busy)
  const [models, setModels] = useState<ChatModel[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatModels().then(
      (answer) => {
        setModels(answer.models)
        const current = useChatStore.getState().model
        if ((!current || !answer.models.some((each) => each.id === current)) && answer.default)
          useChatStore.getState().setModel(answer.default)
      },
      (error: unknown) => setModelsError(error instanceof Error ? error.message : String(error)),
    )
  }, [])

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [entries])

  const send = (text: string) => {
    if (!text.trim() || busy) return
    setDraft('')
    void sendChat(text, projectId, i18n.language)
  }

  if (!hasKey && !byAgent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground">
        <Bot className="h-8 w-8 text-[var(--color-accent)]" aria-hidden />
        <p className="leading-relaxed">{t('chat.needsKey')}</p>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => openSettings('providers')}>
          <KeyRound className="h-3.5 w-3.5" />
          {t('chat.openKeys')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {byAgent ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
            <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden />
            <span className="truncate">{t('chat.byAgent')}</span>
          </span>
        ) : (
          <>
            <Select
              value={model}
              onValueChange={(value) => useChatStore.getState().setModel(value)}
            >
              <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label={t('chat.model')}>
                <SelectValue placeholder={t('chat.model')} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {models.map((each) => (
                  <SelectItem key={each.id} value={each.id} className="text-xs">
                    {each.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span
              className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
              title={t('chat.costHint')}
            >
              {usd(cost)}
            </span>
          </>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          disabled={busy || entries.length === 0}
          onClick={() => useChatStore.getState().clear()}
          title={t('chat.clear')}
          aria-label={t('chat.clear')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {modelsError && <p className="px-3 pt-2 text-[11px] text-destructive">{modelsError}</p>}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {entries.length === 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(byAgent ? 'chat.introAgent' : 'chat.intro')}
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => send(t(`chat.suggestions.${key}`))}
                  className="rounded-md border border-border bg-secondary/30 px-2.5 py-1.5 text-left text-xs hover:border-[var(--color-accent)]/60"
                >
                  {t(`chat.suggestions.${key}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.map((entry) =>
          entry.role === 'user' ? (
            <div
              key={entry.id}
              className="ml-6 rounded-lg bg-[var(--color-accent)]/15 px-3 py-2 text-xs leading-relaxed text-foreground"
            >
              {entry.text}
            </div>
          ) : (
            <div key={entry.id} className="space-y-1.5">
              {entry.tools.length > 0 && (
                <ul className="space-y-1" aria-label={t('chat.tools')}>
                  {entry.tools.map((tool) => (
                    <ToolChip key={tool.id} tool={tool} />
                  ))}
                </ul>
              )}
              {entry.text && <AnswerText text={entry.text} />}
              {!entry.text &&
                !entry.error &&
                busy &&
                entry === entries[entries.length - 1] &&
                entry.tools.every((tool) => tool.state !== 'running') && (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin text-[var(--color-accent)]"
                    aria-label={t('chat.thinking')}
                  />
                )}
              {entry.error && (
                <p role="alert" className="flex gap-1 break-words text-[11px] text-destructive">
                  <CircleAlert className="mt-px h-3 w-3 shrink-0" />
                  {entry.error}
                </p>
              )}
            </div>
          ),
        )}
        <div ref={end} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          send(draft)
        }}
        className="border-t border-border p-2"
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send(draft)
              }
            }}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            rows={2}
            className="max-h-40 min-h-[52px] flex-1 resize-none bg-secondary/30 text-xs"
          />
          {busy ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0"
              onClick={stopChat}
              title={t('chat.stop')}
              aria-label={t('chat.stop')}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={!draft.trim() || (!model && !byAgent)}
              title={t('chat.send')}
              aria-label={t('chat.send')}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <p className={cn('mt-1 text-[11px] text-muted-foreground')}>{t('chat.footnote')}</p>
      </form>
    </div>
  )
}
