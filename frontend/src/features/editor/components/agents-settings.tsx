import { AgentPanel } from '../deps/studio'
import { AgentBudget } from '../deps/generate'

/** Settings, Agents: how to connect one (as in the studios) and what agents may spend a day. */
export default function AgentsSettings() {
  return (
    <div className="space-y-3">
      <AgentPanel />
      <AgentBudget />
    </div>
  )
}
