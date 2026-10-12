// @vitest-environment node

import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache'

interface Entry {
  sizeBytes: number
  lastAccessed: number
  value: string
}

function makeEntry(value: string, sizeBytes: number): Entry {
  return { value, sizeBytes, lastAccessed: Date.now() }
}

describe('SizedAccessedMemoryCache', () => {
  it('stores and retrieves entries', () => {
    const cache = new SizedAccessedMemoryCache<Entry>(100)
    cache.add('a', makeEntry('A', 10))
    expect(cache.get('a')?.value).toBe('A')
    expect(cache.get('missing')).toBeNull()
  })

  it('evicts the least-recently-accessed entry when over budget', async () => {
    const cache = new SizedAccessedMemoryCache<Entry>(100)
    cache.add('a', makeEntry('A', 40))
    cache.add('b', makeEntry('B', 40))

    // Touch 'a' so 'b' becomes the least-recently-accessed. lastAccessed uses
    // Date.now(), so advance the clock to guarantee a distinct timestamp.
    await new Promise((resolve) => setTimeout(resolve, 2))
    cache.get('a')

    // Adding 'c' (40) pushes total to 120 > 100 → evict LRU ('b').
    cache.add('c', makeEntry('C', 40))

    expect(cache.get('a')?.value).toBe('A')
    expect(cache.get('c')?.value).toBe('C')
    expect(cache.get('b')).toBeNull()
  })

  it('replaces an existing key without double-counting its size', () => {
    const cache = new SizedAccessedMemoryCache<Entry>(100)
    cache.add('a', makeEntry('A', 30))
    cache.add('b', makeEntry('B', 30))
    // Re-add 'a' with a larger size; 'b' should survive (30 + 60 = 90 <= 100).
    cache.add('a', makeEntry('A2', 60))

    expect(cache.get('a')?.value).toBe('A2')
    expect(cache.get('b')?.value).toBe('B')
  })

  it('retains an entry larger than the whole budget instead of dropping it', () => {
    // Regression: oversized items used to be silently rejected, so a long
    // clip's waveform was never cached and reloaded (skeleton flash) on every
    // remount. They must now be stored.
    const cache = new SizedAccessedMemoryCache<Entry>(100)
    cache.add('small', makeEntry('S', 50))
    cache.add('huge', makeEntry('H', 250))

    expect(cache.get('huge')?.value).toBe('H')
    // Adding the oversized entry evicts everything else to make room.
    expect(cache.get('small')).toBeNull()
  })

  it('reclaims an oversized entry on the next add', () => {
    const cache = new SizedAccessedMemoryCache<Entry>(100)
    cache.add('huge', makeEntry('H', 250))
    expect(cache.get('huge')?.value).toBe('H')

    // The next add evicts the oversized entry to get back toward budget.
    cache.add('normal', makeEntry('N', 40))
    expect(cache.get('normal')?.value).toBe('N')
    expect(cache.get('huge')).toBeNull()
  })

  it('frees space on delete so later adds are not over-evicted', () => {
    const cache = new SizedAccessedMemoryCache<Entry>(100)
    cache.add('a', makeEntry('A', 60))
    cache.delete('a')
    cache.add('b', makeEntry('B', 60))
    cache.add('c', makeEntry('C', 40))

    // a was deleted (freeing 60), so b (60) + c (40) = 100 both fit.
    expect(cache.get('b')?.value).toBe('B')
    expect(cache.get('c')?.value).toBe('C')
  })

  it('clear() empties the cache and resets accounting', () => {
    const cache = new SizedAccessedMemoryCache<Entry>(100)
    cache.add('a', makeEntry('A', 60))
    cache.clear()
    expect(cache.get('a')).toBeNull()
    // Accounting reset: a fresh 80-byte entry plus another 20 both fit (100).
    cache.add('b', makeEntry('B', 80))
    cache.add('c', makeEntry('C', 20))
    expect(cache.get('b')?.value).toBe('B')
    expect(cache.get('c')?.value).toBe('C')
  })
})
