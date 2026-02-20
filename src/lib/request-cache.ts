type CacheEntry = {
  value?: unknown
  expiresAt: number
  pending?: Promise<unknown>
}

const cache = new Map<string, CacheEntry>()

export async function fetchJSONWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 15_000,
): Promise<T> {
  const now = Date.now()
  const current = cache.get(key)

  if (current?.value !== undefined && current.expiresAt > now) {
    return current.value as T
  }

  if (current?.pending) {
    return current.pending as Promise<T>
  }

  const pending = fetcher()
    .then((value) => {
      cache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
      })
      return value
    })
    .catch((error) => {
      cache.delete(key)
      throw error
    })

  cache.set(key, {
    expiresAt: now + ttlMs,
    pending,
  })

  return pending
}

export function prefetchJSON<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 15_000,
) {
  void fetchJSONWithCache(key, fetcher, ttlMs).catch(() => undefined)
}

export function invalidateCachedJSON(key: string) {
  cache.delete(key)
}
