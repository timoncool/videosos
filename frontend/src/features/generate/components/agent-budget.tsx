import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { generateApi } from '../services/generate-api'

/**
 * What agents may spend per day through MCP (past it the server refuses their generations), and whether their
 * timeline edits wait for the person to accept them.
 */
export function AgentBudget() {
  const { t } = useTranslation()
  const [budget, setBudget] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmEdits, setConfirmEdits] = useState(false)

  useEffect(() => {
    generateApi
      .settings()
      .then((settings) => {
        setBudget(settings.agent_daily_budget_usd === null ? '' : String(settings.agent_daily_budget_usd))
        setConfirmEdits(settings.agent_confirm_edits)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [])

  const save = async () => {
    const trimmed = budget.trim().replace(',', '.')
    const value = trimmed === '' ? null : Number(trimmed)
    if (value !== null && !Number.isFinite(value)) return setError(t('settings.providers.badBudget'))
    try {
      await generateApi.storeSettings({ agent_daily_budget_usd: value })
      setError(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3" data-testid="agent-budget">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">{t('settings.providers.budget')}</Label>
        <Input value={budget} onChange={(event) => setBudget(event.target.value)} placeholder={t('settings.providers.noLimit')} className="h-7 w-24 text-xs" />
        <Button size="sm" className="h-7" onClick={() => void save()}>
          {saved ? <Check className="h-3.5 w-3.5" /> : t('generate.keys.save')}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t('settings.providers.agentHint')}</p>
      <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
        <Label htmlFor="agent-confirm-edits" className="text-xs">
          {t('settings.providers.confirmEdits')}
          <span className="block text-[11px] font-normal text-muted-foreground">{t('settings.providers.confirmEditsHint')}</span>
        </Label>
        <Switch
          id="agent-confirm-edits"
          checked={confirmEdits}
          onCheckedChange={(checked) => {
            setConfirmEdits(checked)
            generateApi.storeSettings({ agent_confirm_edits: checked }).then(
              (settings) => setConfirmEdits(settings.agent_confirm_edits),
              (reason: unknown) => {
                setConfirmEdits(!checked)
                setError(reason instanceof Error ? reason.message : String(reason))
              },
            )
          }}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
