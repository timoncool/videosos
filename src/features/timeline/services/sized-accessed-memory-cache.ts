type SizedAccessedEntry = {
  sizeBytes: number
  lastAccessed: number
}

export class SizedAccessedMemoryCache<TEntry extends SizedAccessedEntry> {
  private entries = new Map<string, TEntry>()
  private currentSizeBytes = 0

  constructor(private readonly maxSizeBytes: number) {}

  get(key: string): TEntry | null {
    const entry = this.entries.get(key)
    if (!entry) {
      return null
    }

    entry.lastAccessed = Date.now()
    return entry
  }

  add(key: string, entry: TEntry): void {
    const existing = this.entries.get(key)
    if (existing) {
      this.currentSizeBytes -= existing.sizeBytes
      this.entries.delete(key)
    }

    // Evict LRU entries until the new entry fits (or the cache is empty).
    // An entry larger than the whole budget is still stored once everything
    // else has been evicted, temporarily exceeding maxSizeBytes; it is
    // reclaimed on the next add. We intentionally do NOT reject oversized
    // entries: this cache holds waveform peaks, and a single long clip's
    // full-resolution peaks can exceed the budget. Dropping them meant such a
    // clip was never cached and reloaded (with a skeleton flash) on every
    // remount — e.g. when dragged to another track.
    while (this.currentSizeBytes + entry.sizeBytes > this.maxSizeBytes && this.entries.size > 0) {
      this.evictOldest()
    }

    this.entries.set(key, entry)
    this.currentSizeBytes += entry.sizeBytes
  }

  delete(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) {
      return
    }

    this.currentSizeBytes -= entry.sizeBytes
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
    this.currentSizeBytes = 0
  }

  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.entries) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.delete(oldestKey)
    }
  }
}
