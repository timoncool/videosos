export const GITHUB_STARS_CACHE_TTL_MS = 60 * 60 * 1000

const GITHUB_REPOSITORY_API_URL = 'https://api.github.com/repos/walterlow/freecut'
const GITHUB_STARS_CACHE_KEY = 'freecut.githubStars.v1'

type StarCacheStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface GitHubStarsCacheEntry {
  stars: number
  fetchedAt: number
}

function getBrowserStorage(): StarCacheStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function parseStarCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

export function readGitHubStarsCache(
  storage: StarCacheStorage | null = getBrowserStorage(),
): GitHubStarsCacheEntry | null {
  if (!storage) return null

  try {
    const parsed = JSON.parse(storage.getItem(GITHUB_STARS_CACHE_KEY) ?? 'null') as unknown
    if (!parsed || typeof parsed !== 'object') return null

    const record = parsed as Record<string, unknown>
    const stars = parseStarCount(record.stars)
    const fetchedAt = record.fetchedAt
    if (stars === null || typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return null
    return { stars, fetchedAt }
  } catch {
    return null
  }
}

export function isGitHubStarsCacheFresh(entry: GitHubStarsCacheEntry, now = Date.now()): boolean {
  const age = now - entry.fetchedAt
  return age >= 0 && age < GITHUB_STARS_CACHE_TTL_MS
}

export async function refreshGitHubStarCount(
  storage: StarCacheStorage | null = getBrowserStorage(),
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<number | null> {
  try {
    const response = await fetchImpl(GITHUB_REPOSITORY_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
    })
    if (!response.ok) return null

    const payload = (await response.json()) as Record<string, unknown>
    const stars = parseStarCount(payload.stargazers_count)
    if (stars === null) return null

    try {
      storage?.setItem(GITHUB_STARS_CACHE_KEY, JSON.stringify({ stars, fetchedAt: now }))
    } catch {
      // Storage may be unavailable in private browsing; the live count is still useful.
    }
    return stars
  } catch {
    return null
  }
}
