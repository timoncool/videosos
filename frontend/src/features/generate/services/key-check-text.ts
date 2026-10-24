import type { TFunction } from 'i18next'
import { formatUsd, type KeyCheck } from './generate-api'

/** What a key check tells the person: whether the key works, and the money the provider tells of. */
export function keyCheckText(t: TFunction, answer: KeyCheck): string {
  if (!answer.ok) return answer.error ?? t('generate.keys.failed')
  const parts = [
    typeof answer.balance === 'number'
      ? t('generate.keys.okBalance', { balance: formatUsd(answer.balance) })
      : t('generate.keys.ok'),
  ]
  if (typeof answer.spent === 'number') {
    parts.push(t('generate.keys.spent', { spent: formatUsd(answer.spent) }))
  }
  if (answer.balance_admin_only === true) parts.push(t('generate.keys.balanceAdminOnly'))
  return parts.join(' ')
}
