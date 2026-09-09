import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Real fetch redirect semantics, with every request confined to synthetic loopback servers. */
export async function withRedirectCanary(
  status: number,
  expectedUrl: string,
  exercise: (canary: { fetchImpl: typeof fetch; sourceRequests: () => number; targetRequests: () => number }) => Promise<void>,
): Promise<void> {
  const nativeFetch = globalThis.fetch
  let sourceRequests = 0
  let targetRequests = 0
  const target = createServer((request, response) => {
    targetRequests++
    request.resume()
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
  })
  const targetUrl = await listen(target)
  const source = createServer((request, response) => {
    sourceRequests++
    request.resume()
    response.writeHead(status, { Location: `${targetUrl}/unexpected` }).end()
  })
  try {
    const sourceUrl = await listen(source)
    await exercise({
      fetchImpl: async (url, init) => {
        if (String(url) !== expectedUrl) throw new Error('Unexpected canary destination')
        return nativeFetch(sourceUrl, init)
      },
      sourceRequests: () => sourceRequests,
      targetRequests: () => targetRequests,
    })
  } finally {
    await Promise.all([close(source), close(target)])
  }
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
