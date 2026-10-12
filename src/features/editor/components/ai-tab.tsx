import { memo } from 'react'
import { AiPanel } from './ai-panel'

/**
 * Container for the AI sidebar tab. The on-device assistant (agent that edits
 * the timeline) is hidden for now while it's still in progress — only the
 * generation tools (TTS / music) are exposed. To restore the agent, bring back
 * the segmented Assistant/Generate switcher and render `AgentChatPanel`.
 */
export const AiTab = memo(function AiTab() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <AiPanel />
      </div>
    </div>
  )
})
