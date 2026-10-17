import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestResultsReader } from '@/lib/test-results-reader'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const response = (revision: number) => ({ ok: true, json: async () => ({ revision }) })

describe('workspace Test results reads', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('shares only inflight reads within one workspace and never caches fulfilled revisions', async () => {
    const pending = deferred<ReturnType<typeof response>>()
    const fetch = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(response(2))
    vi.stubGlobal('fetch', fetch)
    const reader = createTestResultsReader()
    const roster = reader.read('/test/results')
    const inspector = reader.read('/test/results')
    expect(inspector).toBe(roster)
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/test/results', { cache: 'no-store' })
    pending.resolve(response(1))
    expect(await inspector).toEqual({ ok: true, data: { revision: 1 } })
    expect(await reader.read('/test/results')).toEqual({ ok: true, data: { revision: 2 } })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'failure'])('queues fresh post-mutation reads after older %s without joining their revision', async (outcome) => {
    const pending = deferred<ReturnType<typeof response>>()
    const fetch = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(response(4))
    vi.stubGlobal('fetch', fetch)
    const reader = createTestResultsReader()
    const oldGeneration = reader.generation('/test/results')
    const old = reader.read('/test/results').catch(() => null)
    reader.invalidate('/test/results')
    const fresh = reader.read('/test/results')
    expect(reader.read('/test/results')).toBe(fresh)
    expect(reader.generation('/test/results')).not.toBe(oldGeneration)
    expect(fetch).toHaveBeenCalledTimes(1)
    if (outcome === 'success') pending.resolve(response(3))
    else pending.reject(new Error('Current transaction conflict'))
    await old
    expect(await fresh).toEqual({ ok: true, data: { revision: 4 } })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('isolates mounted workspaces and propagates current failures without retry', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('Transaction conflict'))
    vi.stubGlobal('fetch', fetch)
    const first = createTestResultsReader()
    const second = createTestResultsReader()
    await expect(first.read('/test/results')).rejects.toThrow('Transaction conflict')
    await expect(second.read('/test/results')).rejects.toThrow('Transaction conflict')
    expect(fetch).toHaveBeenCalledTimes(2)
    fetch.mockResolvedValue(response(5))
    expect(await first.read('/test/results')).toEqual({ ok: true, data: { revision: 5 } })
  })
})
