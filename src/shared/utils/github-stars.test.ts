import { describe, expect, it, vi } from 'vite-plus/test'
import {
  GITHUB_STARS_CACHE_TTL_MS,
  isGitHubStarsCacheFresh,
  readGitHubStarsCache,
  refreshGitHubStarCount,
} from './github-stars'

function createStorage(initialValue: string | null = null) {
  let value = initialValue
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue
    }),
  }
}

describe('GitHub stars cache', () => {
  it('reads a valid cached count and rejects malformed entries', () => {
    const valid = createStorage(JSON.stringify({ stars: 1234, fetchedAt: 10_000 }))
    expect(readGitHubStarsCache(valid)).toEqual({ stars: 1234, fetchedAt: 10_000 })

    const malformed = createStorage(JSON.stringify({ stars: -1, fetchedAt: 10_000 }))
    expect(readGitHubStarsCache(malformed)).toBeNull()
  })

  it('treats cached values as fresh for one hour', () => {
    const entry = { stars: 42, fetchedAt: 10_000 }
    expect(isGitHubStarsCacheFresh(entry, 10_000 + GITHUB_STARS_CACHE_TTL_MS - 1)).toBe(true)
    expect(isGitHubStarsCacheFresh(entry, 10_000 + GITHUB_STARS_CACHE_TTL_MS)).toBe(false)
  })

  it('fetches the current count and stores it with the fetch time', async () => {
    const storage = createStorage()
    const fetchImpl = vi.fn(async () =>
      Response.json({ stargazers_count: 987 }, { status: 200 }),
    ) as unknown as typeof fetch

    await expect(refreshGitHubStarCount(storage, fetchImpl, 25_000)).resolves.toBe(987)
    expect(storage.setItem).toHaveBeenCalledWith(
      'freecut.githubStars.v1',
      JSON.stringify({ stars: 987, fetchedAt: 25_000 }),
    )
  })

  it('returns null without overwriting the cache when GitHub is unavailable', async () => {
    const storage = createStorage(JSON.stringify({ stars: 500, fetchedAt: 10_000 }))
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 429 }),
    ) as unknown as typeof fetch

    await expect(refreshGitHubStarCount(storage, fetchImpl, 25_000)).resolves.toBeNull()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(readGitHubStarsCache(storage)?.stars).toBe(500)
  })
})
