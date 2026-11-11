import { useCallback, useEffect, useState } from 'react'
import { generateApi, onGenerateEvent, type LocalStatus } from '../services/generate-api'

/** Generation on this computer as the server tells it, read again whenever it changes. */
export function useLocalStatus() {
  const [status, setStatus] = useState<LocalStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    generateApi.localStatus().then(
      (next) => {
        setStatus(next)
        setError(null)
      },
      (problem: unknown) => setError(problem instanceof Error ? problem.message : String(problem)),
    )
  }, [])
  useEffect(() => {
    reload()
    return onGenerateEvent((event) => {
      if (event.kind === 'local' || event.kind === 'settings') reload()
    })
  }, [reload])
  return { status, error, reload, setStatus }
}
