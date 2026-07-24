import { createServer, type Server } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchSafeExternalDocument,
  requestPinnedExternalDocument,
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

async function withHttpServer(
  handler: Parameters<typeof createServer>[0],
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server: Server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Failed to bind test HTTP server')
  }

  try {
    await run(address.port)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('fetchSafeExternalDocument', () => {
  it.each([
    'http://127.0.0.1/admin',
    'http://2130706433/admin',
    'http://0x7f000001/admin',
    'http://0177.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/admin',
    'http://[64:ff9b::7f00:1]/admin',
    'http://[::ffff:8.8.8.8]/admin',
    'http://[2002:7f00:1::]/admin',
    'http://[2001:0000:4136:e378:8000:63bf:3fff:fdd2]/admin',
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

  it('rejects redirect chains beyond the bounded limit', async () => {
    const request = vi.fn(async () => response(302, { location: '/next' }))

    await expect(
      fetchSafeExternalDocument('https://example.com/document', 1024, {
        request,
        resolve: vi.fn(async () => [publicAddress]),
      }),
    ).rejects.toThrow('Too many source document redirects')

    expect(request).toHaveBeenCalledTimes(6)
  })
})

describe('requestPinnedExternalDocument transport', () => {
  const loopback: ResolvedExternalAddress = {
    address: '127.0.0.1',
    family: 4,
  }

  it('uses the validated address for the actual socket lookup', async () => {
    await withHttpServer((_request, response) => {
      response.end('pinned transport')
    }, async (port) => {
      const result = await requestPinnedExternalDocument(
        new URL(`http://does-not-resolve.invalid:${port}/document`),
        loopback,
        1024,
        1000,
      )

      expect(result.status).toBe(200)
      expect(result.body.toString()).toBe('pinned transport')
    })
  })

  it('rejects an oversized declared content length', async () => {
    await withHttpServer((_request, response) => {
      response.writeHead(200, { 'Content-Length': '2048' })
      response.end('small body')
    }, async (port) => {
      await expect(
        requestPinnedExternalDocument(
          new URL(`http://public.invalid:${port}/document`),
          loopback,
          1024,
          1000,
        ),
      ).rejects.toThrow('Document is too large to sync')
    })
  })

  it('rejects a streamed body after it crosses the byte cap', async () => {
    await withHttpServer((_request, response) => {
      response.writeHead(200)
      response.write(Buffer.alloc(700))
      response.end(Buffer.alloc(700))
    }, async (port) => {
      await expect(
        requestPinnedExternalDocument(
          new URL(`http://public.invalid:${port}/document`),
          loopback,
          1024,
          1000,
        ),
      ).rejects.toThrow('Document is too large to sync')
    })
  })

  it('times out while waiting for response headers', async () => {
    await withHttpServer((_request, response) => {
      setTimeout(() => response.end('late'), 100)
    }, async (port) => {
      await expect(
        requestPinnedExternalDocument(
          new URL(`http://public.invalid:${port}/document`),
          loopback,
          1024,
          20,
        ),
      ).rejects.toThrow()
    })
  })

  it('times out while streaming a stalled response body', async () => {
    await withHttpServer((_request, response) => {
      response.writeHead(200)
      response.write('partial')
      setTimeout(() => response.end('late'), 100)
    }, async (port) => {
      await expect(
        requestPinnedExternalDocument(
          new URL(`http://public.invalid:${port}/document`),
          loopback,
          1024,
          20,
        ),
      ).rejects.toThrow()
    })
  })
})
