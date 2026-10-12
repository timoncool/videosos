/**
 * Environment facts worth attaching to a workspace storage failure.
 *
 * A NotSupportedError out of `FileSystemFileHandle.move()` cannot be
 * attributed from the error alone. Chromium has shipped move() for local
 * files since M111, and the spec still lets a user agent reject when the file
 * "does not correspond to a file on the underlying file system" — which points
 * at *where the folder lives* (a cloud-synced or network mount) rather than at
 * the browser. Nor does the brand settle it: Brave gates the whole File System
 * Access API behind a flag rather than move() specifically, so a Brave user who
 * reached this code has that flag on.
 *
 * None of that is recoverable after the fact, so capture it at the point of
 * failure. A pasted console log then separates "old Chromium fork" from
 * "OneDrive folder" from "Brave" without a round-trip to the reporter.
 */

/** Serializable — this is written straight into a log line. */
interface StorageEnvironment {
  /** Brave exposes `navigator.brave`; no other engine does. */
  brave: boolean
  /** Client Hints brand list, e.g. "Chromium 140; Google Chrome 140". */
  brands: string | null
  userAgent: string | null
}

type NavigatorWithHints = Navigator & {
  brave?: unknown
  userAgentData?: { brands?: Array<{ brand: string; version: string }> }
}

export function describeStorageEnvironment(): StorageEnvironment {
  if (typeof navigator === 'undefined') {
    return { brave: false, brands: null, userAgent: null }
  }
  const nav = navigator as NavigatorWithHints
  const brands = nav.userAgentData?.brands
  return {
    brave: 'brave' in nav,
    brands: brands?.map((entry) => `${entry.brand} ${entry.version}`).join('; ') ?? null,
    userAgent: nav.userAgent || null,
  }
}
