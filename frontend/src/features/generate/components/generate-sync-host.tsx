import { useProjectStore } from '../deps/editor'
import { useGenerateSync } from '../hooks/use-generate-sync'

/**
 * Keeps the open project's generations in step with the server for as long as the window lives, whether or
 * not the Generate tab was ever opened: results an agent starts are imported and placed all the same.
 */
export function GenerateSyncHost() {
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  useGenerateSync(projectId)
  return null
}
