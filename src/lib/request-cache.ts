type CacheEntry = {
  value?: unknown
  expiresAt: number
  pending?: Promise<unknown>
}

const cache = new Map<string, CacheEntry>()

type FetchJSONOptions = {
  init?: RequestInit
  errorMessage?: string
}

type FetchCachedJSONOptions = FetchJSONOptions & {
  ttlMs?: number
}

function readPayloadError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const error = (payload as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? error : null
}

export async function fetchJSON<T>(
  input: RequestInfo | URL,
  options: FetchJSONOptions = {},
): Promise<T> {
  const response = await fetch(input, options.init)
  const payload = await response.json().catch(() => null) as unknown

  if (!response.ok) {
    throw new Error(readPayloadError(payload) || options.errorMessage || 'Request failed')
  }

  return payload as T
}

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

  let pending: Promise<T>
  pending = fetcher()
    .then((value) => {
      if (cache.get(key)?.pending === pending) {
        cache.set(key, {
          value,
          expiresAt: Date.now() + ttlMs,
        })
      }
      return value
    })
    .catch((error) => {
      if (cache.get(key)?.pending === pending) {
        cache.delete(key)
      }
      throw error
    })

  cache.set(key, {
    expiresAt: now + ttlMs,
    pending,
  })

  return pending
}

export function fetchCachedJSON<T>(
  key: string,
  input: RequestInfo | URL,
  options: FetchCachedJSONOptions = {},
): Promise<T> {
  const { ttlMs = 15_000, ...fetchOptions } = options
  return fetchJSONWithCache(
    key,
    () => fetchJSON<T>(input, fetchOptions),
    ttlMs,
  )
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

export function invalidateCachedJSONMatching(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key)
    }
  }
}
