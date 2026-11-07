import { useGenerateStore } from '../deps/generate'
import { useProjectStore } from '../deps/projects'
import { ChatPanel } from '../deps/studio'

/** The chat of the left sidebar: the open project, who answers and whether the OpenRouter key is there. */
export function ChatTab() {
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  const hasKey = useGenerateStore((state) => state.keys.openrouter === true)
  const assistant = useGenerateStore((state) => state.assistant)
  return <ChatPanel projectId={projectId} hasKey={hasKey} assistant={assistant} />
}
