import { ApiError } from '@/lib/api-error'

type CacheEntry = {
  value?: unknown
  expiresAt: number
  pending?: Promise<unknown>
}

const cache = new Map<string, CacheEntry>()
type CacheReadToken = { key: string; valid: boolean }
const activeReadTokens = new Map<string, Set<CacheReadToken>>()

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

  if (response.ok) {
    return await response.json() as T
  }

  const payload = await response.json().catch(() => null) as unknown

  throw new ApiError(response.status, readPayloadError(payload) || options.errorMessage || 'Request failed')
}

/** Read only an unexpired complete value; in-flight requests are not treated as a snapshot. */
export function peekCachedJSON<T>(key: string): T | undefined {
  const entry = cache.get(key)
  return entry?.value !== undefined && entry.expiresAt > Date.now() ? entry.value as T : undefined
}

/** Join an existing in-flight full read without starting a second request. */
export function peekPendingCachedJSON<T>(key: string): Promise<T> | undefined {
  return cache.get(key)?.pending as Promise<T> | undefined
}

/** Tokens exist only while a read is active and are invalidated with their key. */
export function beginCachedJSONRead(key: string): CacheReadToken {
  const token = { key, valid: true }
  const tokens = activeReadTokens.get(key) ?? new Set<CacheReadToken>()
  tokens.add(token)
  activeReadTokens.set(key, tokens)
  return token
}

export function endCachedJSONRead(token: CacheReadToken): void {
  token.valid = false
  const tokens = activeReadTokens.get(token.key)
  tokens?.delete(token)
  if (tokens?.size === 0) activeReadTokens.delete(token.key)
}

/** Preserve newer or invalidated state when seeding a completed response. */
export function primeCachedJSON<T>(key: string, value: T, ttlMs: number, token: CacheReadToken): void {
  if (!token.valid || token.key !== key) return
  const current = cache.get(key)
  if (current?.pending || (current?.value !== undefined && current.expiresAt > Date.now())) return
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

export async function fetchJSONWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 15_000,
): Promise<T> {
  const now = Date.now()
  // Opportunistic expiry keeps historical unique keys from surviving active use.
  // Pending requests remain available for deduplication until they settle.
  for (const [cachedKey, entry] of cache) {
    if (!entry.pending && entry.expiresAt <= now) cache.delete(cachedKey)
  }
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
        if (ttlMs <= 0) {
          cache.delete(key)
        } else {
          cache.set(key, {
            value,
            expiresAt: Date.now() + ttlMs,
          })
        }
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
  const tokens = activeReadTokens.get(key)
  if (tokens) {
    for (const token of tokens) token.valid = false
    activeReadTokens.delete(key)
  }
  cache.delete(key)
}

export function invalidateCachedJSONMatching(prefix: string) {
  for (const key of new Set([...cache.keys(), ...activeReadTokens.keys()])) {
    if (key.startsWith(prefix)) invalidateCachedJSON(key)
  }
}
