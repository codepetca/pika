import { createPalHttpClient, type PalClient } from '@codepet/pal-widget'

const MAX_READ_TOKEN_LIFETIME_MS = 10 * 60 * 1000
const CLOCK_SKEW_ALLOWANCE_MS = 30 * 1000
const READ_TOKEN_REFRESH_BUFFER_MS = 30 * 1000

interface PalReadTokenResponse {
  token: string
  expires_at: string
}

interface CachedPalReadToken {
  token: string
  expiresAtMs: number
}

function parseReadTokenResponse(value: unknown, now: number): PalReadTokenResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('Pal token response was invalid')
  }

  const { token, expires_at: expiresAt } = value as Record<string, unknown>
  if (
    typeof token !== 'string'
    || token.length === 0
    || token.length > 8192
    || typeof expiresAt !== 'string'
  ) {
    throw new Error('Pal token response was invalid')
  }

  const expiresAtMs = Date.parse(expiresAt)
  if (
    !Number.isFinite(expiresAtMs)
    || expiresAtMs <= now
    || expiresAtMs > now + MAX_READ_TOKEN_LIFETIME_MS + CLOCK_SKEW_ALLOWANCE_MS
  ) {
    throw new Error('Pal token expiry was invalid')
  }

  return { token, expires_at: expiresAt }
}

async function requestPalReadToken(
  signal?: AbortSignal,
  options: {
    fetchImplementation?: typeof fetch
    now?: () => number
  } = {},
): Promise<CachedPalReadToken> {
  const fetchImplementation = options.fetchImplementation ?? fetch
  const response = await fetchImplementation('/api/student/pal/read-token', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Pal token request failed with HTTP ${response.status}`)
  }

  const body = parseReadTokenResponse(
    await response.json(),
    options.now?.() ?? Date.now(),
  )
  return {
    token: body.token,
    expiresAtMs: Date.parse(body.expires_at),
  }
}

export function createPalReadTokenProvider(
  options: {
    fetchImplementation?: typeof fetch
    now?: () => number
  } = {},
): (signal?: AbortSignal) => Promise<string> {
  let cachedToken: CachedPalReadToken | null = null

  return async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const now = options.now?.() ?? Date.now()
    if (
      cachedToken
      && cachedToken.expiresAtMs - READ_TOKEN_REFRESH_BUFFER_MS > now
    ) {
      return cachedToken.token
    }

    const nextToken = await requestPalReadToken(signal, options)
    signal?.throwIfAborted()
    cachedToken = nextToken
    return nextToken.token
  }
}

export async function getPalReadToken(
  signal?: AbortSignal,
  options: {
    fetchImplementation?: typeof fetch
    now?: () => number
  } = {},
): Promise<string> {
  return createPalReadTokenProvider(options)(signal)
}

export function createPikaPalClient(
  apiBaseUrl: string,
  options: {
    fetchImplementation?: typeof fetch
    now?: () => number
  } = {},
): PalClient {
  const fetchImplementation = options.fetchImplementation ?? fetch
  const getAccessToken = createPalReadTokenProvider(options)

  return createPalHttpClient({
    apiBaseUrl,
    fetchImplementation: (input, init) => fetchImplementation(input, {
      ...init,
      cache: 'no-store',
    }),
    getAccessToken,
  })
}
