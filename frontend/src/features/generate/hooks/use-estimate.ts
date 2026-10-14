import { useEffect, useState } from 'react'
import { generateApi, type Estimate, type Provider } from '../services/generate-api'

/** The price of a run before it runs, asked of the server a moment after the form settles. */
export function useEstimate(
  provider: Provider | undefined,
  id: string | undefined,
  values: Record<string, unknown>,
  repeat: number,
) {
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify([provider, id, values, repeat])
  useEffect(() => {
    if (!provider || !id) return
    let cancelled = false
    const timer = setTimeout(() => {
      generateApi
        .estimate(provider, id, values, repeat)
        .then((answer) => {
          if (cancelled) return
          setEstimate(answer)
          setError(null)
        })
        .catch((reason: unknown) => {
          if (cancelled) return
          setEstimate(null)
          setError(reason instanceof Error ? reason.message : String(reason))
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return { estimate, error }
}
