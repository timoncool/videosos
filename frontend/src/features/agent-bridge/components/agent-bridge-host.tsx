import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AGENT_ACTION, startBridge } from '../services/bridge'
import { registerEditorCommands } from '../services/editor-commands'

let registered = false

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
