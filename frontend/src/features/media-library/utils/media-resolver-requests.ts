/**
 * In-flight media resolution bookkeeping.
 *
 * Split into a dependency-free leaf module so shell-reachable callers (the
 * projects route cleanup) can clear it without pulling the media-library
 * store/proxy graph into the initial bundle.
 *
 * Pending requests prevent concurrent OPFS access to the same file — this
 * prevents multiple sync access handle creation for the same OPFS file.
 */
export const pendingMediaRequests = new Map<string, Promise<string>>()

/**
 * Drop in-flight request bookkeeping. In-flight promises still settle on
 * their own; this only makes future callers start a fresh request instead of
 * joining a potentially hung one.
 */
export function clearPendingMediaRequests(): void {
  pendingMediaRequests.clear()
}
