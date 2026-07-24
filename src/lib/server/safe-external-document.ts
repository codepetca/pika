import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { ApiError } from '@/lib/api-handler'

const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 15_000
const FETCH_TIMEOUT_ERROR = 'Source document fetch timed out'

export interface ResolvedExternalAddress {
  address: string
  family: 4 | 6
}

export interface ExternalDocumentResponse {
  body: Buffer
  finalUrl: string
  headers: Headers
  status: number
}

export interface PinnedResponse {
  body: Buffer
  headers: Headers
  status: number
}

export interface SafeExternalDocumentDependencies {
  request?: (
    url: URL,
    address: ResolvedExternalAddress,
    maxBytes: number,
  ) => Promise<PinnedResponse>
  resolve?: (hostname: string) => Promise<ResolvedExternalAddress[]>
  timeoutMs?: number
}

const blockedAddresses = new BlockList()

for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv4')
}

for (const [address, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv6')
}
blockedAddresses.addAddress('::', 'ipv6')
blockedAddresses.addAddress('::1', 'ipv6')

function isBlockedAddress(address: ResolvedExternalAddress): boolean {
  if (address.family === 6 && address.address.toLowerCase().startsWith('::ffff:')) {
    return true
  }
  return blockedAddresses.check(address.address, address.family === 4 ? 'ipv4' : 'ipv6')
}

function parseExternalUrl(value: string, base?: URL): URL {
  let url: URL
  try {
    url = base ? new URL(value, base) : new URL(value)
  } catch {
    throw new ApiError(400, 'Invalid source document URL')
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new ApiError(400, 'Invalid source document URL')
  }
  return url
}

async function defaultResolve(hostname: string): Promise<ResolvedExternalAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true })
  return addresses
    .filter((address): address is ResolvedExternalAddress => (
      address.family === 4 || address.family === 6
    ))
    .map(({ address, family }) => ({ address, family }))
}

async function resolveSafeAddress(
  url: URL,
  resolve: (hostname: string) => Promise<ResolvedExternalAddress[]>,
): Promise<ResolvedExternalAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literalFamily = isIP(hostname)
  let addresses: ResolvedExternalAddress[]

  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily as 4 | 6 }]
      : await resolve(hostname)
  } catch {
    throw new ApiError(400, 'Failed to resolve source document')
  }

  if (addresses.length === 0) {
    throw new ApiError(400, 'Failed to resolve source document')
  }
  if (addresses.some(isBlockedAddress)) {
    throw new ApiError(400, 'Source document address is not allowed')
  }
  return addresses[0]
}

function headersFromIncoming(headers: Record<string, string | string[] | undefined>): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item)
    } else if (value !== undefined) {
      result.set(name, value)
    }
  }
  return result
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function runWithinDeadline<T>(
  deadlineMs: number,
  operation: (remainingMs: number) => Promise<T>,
): Promise<T> {
  const remainingMs = Math.floor(deadlineMs - Date.now())
  if (remainingMs <= 0) {
    throw new ApiError(400, FETCH_TIMEOUT_ERROR)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(remainingMs),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ApiError(400, FETCH_TIMEOUT_ERROR)),
          remainingMs,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function requestPinnedExternalDocument(
  url: URL,
  address: ResolvedExternalAddress,
  maxBytes: number,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<PinnedResponse> {
  return await new Promise<PinnedResponse>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        const callbackAll = callback as unknown as (
          error: null,
          addresses: ResolvedExternalAddress[],
        ) => void
        callbackAll(null, [address])
        return
      }
      const callbackOne = callback as unknown as (
        error: null,
        resolvedAddress: string,
        family: 4 | 6,
      ) => void
      callbackOne(null, address.address, address.family)
    }
    const request = transport(url, {
      headers: {
        'User-Agent': 'PikaLinkSnapshot/1.0',
      },
      lookup,
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    }, (response) => {
      const status = response.statusCode || 0
      const headers = headersFromIncoming(response.headers)
      if (isRedirect(status)) {
        response.destroy()
        resolve({
          body: Buffer.alloc(0),
          headers,
          status,
        })
        return
      }

      const contentLength = Number(headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        response.destroy()
        reject(new ApiError(400, 'Document is too large to sync'))
        return
      }

      const chunks: Buffer[] = []
      let bytesRead = 0
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytesRead += buffer.byteLength
        if (bytesRead > maxBytes) {
          response.destroy(new ApiError(400, 'Document is too large to sync'))
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => {
        resolve({
          body: Buffer.concat(chunks),
          headers,
          status,
        })
      })
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

export async function fetchSafeExternalDocument(
  sourceUrl: string,
  maxBytes: number,
  dependencies: SafeExternalDocumentDependencies = {},
): Promise<ExternalDocumentResponse> {
  const resolve = dependencies.resolve || defaultResolve
  const deadlineMs = Date.now() + (dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS)
  let currentUrl = parseExternalUrl(sourceUrl)

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const address = await runWithinDeadline(
      deadlineMs,
      () => resolveSafeAddress(currentUrl, resolve),
    )
    let response: PinnedResponse
    try {
      response = await runWithinDeadline(deadlineMs, (remainingMs) => (
        dependencies.request
          ? dependencies.request(currentUrl, address, maxBytes)
          : requestPinnedExternalDocument(
              currentUrl,
              address,
              maxBytes,
              remainingMs,
            )
      ))
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(400, 'Failed to fetch source document')
    }

    if (!isRedirect(response.status)) {
      return {
        ...response,
        finalUrl: currentUrl.toString(),
      }
    }

    const location = response.headers.get('location')
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new ApiError(400, 'Too many source document redirects')
    }
    currentUrl = parseExternalUrl(location, currentUrl)
  }

  throw new ApiError(400, 'Too many source document redirects')
}
