import { useEffect } from 'react'
import { createLogger } from '@/shared/logging/logger'
import { useGenerationPlacementsStore } from '@/shared/state/generation-placements-store'
import { useProjectStore } from '../deps/editor'
import { useGenerateChoices, useGenerateSync } from '../hooks/use-generate-sync'
import { useSegmentRequests } from '../hooks/use-segment-requests'
import { generateApi } from '../services/generate-api'
import { placementsOf } from '../services/placements'
import { modelKey, useGenerateStore } from '../stores/generate-store'

const logger = createLogger('GeneratePlacements')
const asked = new Set<string>()

/**
 * Keeps the open project's generations in step with the server for as long as the window lives, whether or
 * not the Generate tab was ever opened: results an agent starts are imported and placed all the same, and the
 * ones that will land on the timeline are drawn there while they run; a clip's part the timeline asks to make
 * again is cut and taken here. The panel's choices are read once from
 * the server here.
 */
export function GenerateSyncHost() {
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  const jobs = useGenerateStore((state) => state.jobs)
  const forms = useGenerateStore((state) => state.forms)
  useGenerateChoices()
  useGenerateSync(projectId)
  useSegmentRequests()
  useEffect(() => {
    const placements = placementsOf(jobs, projectId, forms)
    useGenerationPlacementsStore.getState().setPlacements(placements)
    for (const job of jobs) {
      const key = modelKey(job.provider, job.model)
      if (!placements.some((each) => each.id === job.id) || forms[key] || asked.has(key)) continue
      asked.add(key)
      generateApi.form(job.provider, job.model).then(
        (answer) => useGenerateStore.getState().setForm(answer.form),
        (error: unknown) =>
          logger.warn(
            `The form of ${key} did not come; its placeholder on the timeline takes the length of a picture`,
            error,
          ),
      )
    }
  }, [jobs, projectId, forms])
  return null
}
