import { useProjectStore } from '../deps/editor'
import { useGenerateChoices, useGenerateSync } from '../hooks/use-generate-sync'

/**
 * Keeps the open project's generations in step with the server for as long as the window lives, whether or
 * not the Generate tab was ever opened: results an agent starts are imported and placed all the same. The
 * panel's choices are read once from the server here.
 */
export function GenerateSyncHost() {
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  useGenerateChoices()
  useGenerateSync(projectId)
  return null
}
