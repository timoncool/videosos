import { useTranslation } from 'react-i18next'
import { Bot, Check, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProposalStore } from '../services/proposals'

/** The agent's proposed edit in the corner of the window, with what will change, Accept and Decline. */
export function ProposalCard() {
  const { t } = useTranslation()
  const proposal = useProposalStore((state) => state.proposal)
  if (!proposal) return null
  const decide = useProposalStore.getState().decide
  return (
    <div
      role="alertdialog"
      aria-labelledby="agent-proposal-title"
      className="fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)] space-y-2 rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] p-3 text-[var(--color-text)] shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <p id="agent-proposal-title" className="flex items-center gap-2 text-sm font-semibold">
        <Bot className="size-4 text-[var(--color-accent)]" aria-hidden />
        {t('agent.proposal.title')}
      </p>
      <ol className="max-h-48 list-decimal space-y-0.5 overflow-y-auto pl-5 text-xs">
        {proposal.lines.map((line, index) => (
          <li key={index}>{t(`agent.proposal.op.${line.key}`, line.values)}</li>
        ))}
      </ol>
      {proposal.problem && (
        <p className="flex gap-1.5 text-[11px] text-destructive">
          <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
          {t('agent.proposal.problem', { count: proposal.wouldApply, reason: proposal.problem })}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">{t('agent.proposal.hint')}</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => decide(false)}>
          <X className="size-3.5" />
          {t('agent.proposal.decline')}
        </Button>
        <Button size="sm" className="h-8 gap-1" onClick={() => decide(true)}>
          <Check className="size-3.5" />
          {t('agent.proposal.accept')}
        </Button>
      </div>
    </div>
  )
}
