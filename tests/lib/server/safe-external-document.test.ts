import { describe, expect, it, vi } from 'vitest'
import {
  fetchSafeExternalDocument,
  type ResolvedExternalAddress,
} from '@/lib/server/safe-external-document'

const publicAddress: ResolvedExternalAddress = {
  address: '93.184.216.34',
  family: 4,
}

function response(status: number, headers: Record<string, string> = {}) {
  return {
    body: Buffer.from('document'),
    headers: new Headers(headers),
    status,
  }
}

describe('fetchSafeExternalDocument', () => {
  it.each([
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/admin',
    'http://[64:ff9b::7f00:1]/admin',
    'http://[::ffff:8.8.8.8]/admin',
  ])('rejects private literal target %s before requesting it', async (url) => {
    const request = vi.fn()

    await expect(
      fetchSafeExternalDocument(url, 1024, { request }),
    ).rejects.toThrow('Source document address is not allowed')

    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a hostname when any resolved address is private', async () => {
    const request = vi.fn()
    const resolve = vi.fn(async () => [
      publicAddress,
      { address: '10.0.0.4', family: 4 as const },
    ])

    await expect(
      fetchSafeExternalDocument('https://example.com/document', 1024, {
        request,
        resolve,
      }),
    ).rejects.toThrow('Source document address is not allowed')

    expect(request).not.toHaveBeenCalled()
  })

  it('pins the validated DNS address into the outbound request', async () => {
    const request = vi.fn(async () => response(200))

    const result = await fetchSafeExternalDocument(
      'https://example.com/document',
      1024,
      {
        request,
        resolve: vi.fn(async () => [publicAddress]),
      },
    )

    expect(request).toHaveBeenCalledWith(
      new URL('https://example.com/document'),
      publicAddress,
      1024,
    )
    expect(result.finalUrl).toBe('https://example.com/document')
  })

  it('revalidates redirects and rejects a public-to-private redirect', async () => {
    const request = vi.fn(async () => response(302, {
      location: 'http://169.254.169.254/latest/meta-data',
    }))

    await expect(
      fetchSafeExternalDocument('https://example.com/document', 1024, {
        request,
        resolve: vi.fn(async () => [publicAddress]),
      }),
    ).rejects.toThrow('Source document address is not allowed')

    expect(request).toHaveBeenCalledTimes(1)
  })

  it('revalidates redirected hostnames before issuing the next request', async () => {
    const request = vi.fn(async () => response(302, {
      location: 'https://private.example/document',
    }))
    const resolve = vi.fn(async (hostname: string) => (
      hostname === 'example.com'
        ? [publicAddress]
        : [{ address: '192.168.1.5', family: 4 as const }]
    ))

    await expect(
      fetchSafeExternalDocument('https://example.com/document', 1024, {
        request,
        resolve,
      }),
    ).rejects.toThrow('Source document address is not allowed')

    expect(request).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith('private.example')
  })
})
