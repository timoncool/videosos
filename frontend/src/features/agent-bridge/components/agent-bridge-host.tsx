import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { i18n } from '@/i18n'
import { isDesktop } from '@/infrastructure/desktop'
import { toast } from 'sonner'
import { AGENT_ACTION, startBridge } from '../services/bridge'
import { registerEditorCommands } from '../services/editor-commands'

let registered = false

/** The server writes its own messages (errors, the update window) in the language the window shows. */
function reportLanguage(language: string): void {
  void isDesktop().then((desktop) => {
    if (!desktop) return
    fetch('/api/ui-language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language }),
    }).catch((error: unknown) => console.error('[ERROR] the window language did not reach VideoSOS:', error))
  })
}

/**
 * Connects this window to VideoSOS's MCP server and shows the person every action an agent takes in it,
 * as a short notice ("Agent: timeline edit").
 */
export function AgentBridgeHost() {
  const { t } = useTranslation()
  useEffect(() => {
    if (!registered) {
      registered = true
      registerEditorCommands()
      reportLanguage(i18n.language)
      i18n.on('languageChanged', reportLanguage)
    }
    startBridge()
    const show = (event: Event) => {
      const { command } = (event as CustomEvent<{ command: string }>).detail
      toast(t('agent.action', { action: t(`agent.commands.${command}`, { defaultValue: command.replace(/_/g, ' ') }) }), { duration: 2500 })
    }
    window.addEventListener(AGENT_ACTION, show)
    return () => window.removeEventListener(AGENT_ACTION, show)
  }, [t])
  return null
}
