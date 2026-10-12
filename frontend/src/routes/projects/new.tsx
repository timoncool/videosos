import { createFileRoute } from '@tanstack/react-router'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('NewProject')

export const Route = createFileRoute('/projects/new')({
  // Route stays eager (beforeLoad cannot live in a lazy file); the form UI
  // and its react-hook-form/zod stack live in projects/new.lazy.tsx.
  beforeLoad: async () => {
    try {
      const { useProjectStore } = await import('@/features/projects/stores/project-store')
      const { loadProjects } = useProjectStore.getState()
      await loadProjects()
    } catch (err) {
      logger.warn('Failed to pre-load projects in beforeLoad:', err)
    }
  },
})
