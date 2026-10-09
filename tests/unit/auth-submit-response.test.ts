import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAuthSubmit, readAuthSubmitResponse } from '@/lib/auth-submit-response'
afterEach(() => vi.unstubAllGlobals())
describe('auth submit boundary failures', () => {
  it('does not convert aborts or unrelated fetch exceptions', async () => {
    for (const error of [new DOMException('Cancelled', 'AbortError'), new Error('Unrelated failure')]) {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
      await expect(fetchAuthSubmit('/api/auth/login', { method: 'POST' })).rejects.toBe(error)
    }
  })
  it('does not convert body aborts or unrelated reader exceptions', async () => {
    for (const error of [new DOMException('Cancelled', 'AbortError'), new TypeError('Body unavailable')]) {
      await expect(readAuthSubmitResponse({ json: async () => { throw error } } as Response)).rejects.toBe(error)
    }
  })
  it('preserves valid response data and passes request options unchanged', async () => {
    const data = { error: 'Server validation', handoffToken: 'synthetic' }
    const response = { json: async () => data } as Response
    const options = { method: 'POST', body: 'synthetic' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    expect(await fetchAuthSubmit('/api/auth/signup', options)).toBe(response)
    expect(fetch).toHaveBeenCalledWith('/api/auth/signup', options)
    expect(await readAuthSubmitResponse(response)).toBe(data)
  })
})
