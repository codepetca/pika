import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchJSONWithCache,
  invalidateCachedJSON,
  invalidateCachedJSONMatching,
} from '@/lib/request-cache'

const TEST_PREFIX = 'request-cache-test:'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('request cache', () => {
  afterEach(() => {
    invalidateCachedJSONMatching(TEST_PREFIX)
  })

  it('returns cached values within the TTL', async () => {
    const key = `${TEST_PREFIX}ttl`
    const fetcher = vi.fn(async () => ({ version: 1 }))

    await expect(fetchJSONWithCache(key, fetcher, 60_000)).resolves.toEqual({ version: 1 })
    await expect(fetchJSONWithCache(key, fetcher, 60_000)).resolves.toEqual({ version: 1 })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('deduplicates in-flight fetches for the same key', async () => {
    const key = `${TEST_PREFIX}pending`
    const pending = deferred<{ version: number }>()
    const fetcher = vi.fn(() => pending.promise)
    const skippedFetcher = vi.fn(async () => ({ version: 2 }))

    const first = fetchJSONWithCache(key, fetcher, 60_000)
    const second = fetchJSONWithCache(key, skippedFetcher, 60_000)

    pending.resolve({ version: 1 })

    await expect(first).resolves.toEqual({ version: 1 })
    await expect(second).resolves.toEqual({ version: 1 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(skippedFetcher).not.toHaveBeenCalled()
  })

  it('does not cache a stale in-flight value after direct invalidation', async () => {
    const key = `${TEST_PREFIX}direct-invalidate`
    const stale = deferred<{ version: number }>()
    const staleFetcher = vi.fn(() => stale.promise)
    const freshFetcher = vi.fn(async () => ({ version: 2 }))

    const staleRead = fetchJSONWithCache(key, staleFetcher, 60_000)
    invalidateCachedJSON(key)

    stale.resolve({ version: 1 })
    await expect(staleRead).resolves.toEqual({ version: 1 })
    await expect(fetchJSONWithCache(key, freshFetcher, 60_000)).resolves.toEqual({ version: 2 })

    expect(freshFetcher).toHaveBeenCalledTimes(1)
  })

  it('does not cache a stale in-flight value after prefix invalidation', async () => {
    const key = `${TEST_PREFIX}prefix:item`
    const stale = deferred<{ version: number }>()
    const staleFetcher = vi.fn(() => stale.promise)
    const freshFetcher = vi.fn(async () => ({ version: 2 }))

    const staleRead = fetchJSONWithCache(key, staleFetcher, 60_000)
    invalidateCachedJSONMatching(`${TEST_PREFIX}prefix:`)

    stale.resolve({ version: 1 })
    await expect(staleRead).resolves.toEqual({ version: 1 })
    await expect(fetchJSONWithCache(key, freshFetcher, 60_000)).resolves.toEqual({ version: 2 })

    expect(freshFetcher).toHaveBeenCalledTimes(1)
  })

  it('does not let an invalidated rejection delete a newer cached value', async () => {
    const key = `${TEST_PREFIX}stale-rejection`
    const stale = deferred<{ version: number }>()
    const staleFetcher = vi.fn(() => stale.promise)
    const freshFetcher = vi.fn(async () => ({ version: 2 }))
    const fallbackFetcher = vi.fn(async () => ({ version: 3 }))

    const staleRead = fetchJSONWithCache(key, staleFetcher, 60_000).catch((error) => error)
    invalidateCachedJSON(key)

    await expect(fetchJSONWithCache(key, freshFetcher, 60_000)).resolves.toEqual({ version: 2 })

    stale.reject(new Error('stale request failed'))
    await expect(staleRead).resolves.toBeInstanceOf(Error)
    await expect(fetchJSONWithCache(key, fallbackFetcher, 60_000)).resolves.toEqual({ version: 2 })

    expect(freshFetcher).toHaveBeenCalledTimes(1)
    expect(fallbackFetcher).not.toHaveBeenCalled()
  })
})
