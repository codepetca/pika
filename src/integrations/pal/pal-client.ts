import { createPalHttpClient, type PalClient } from '@codepet/pal-widget'

const MAX_READ_TOKEN_LIFETIME_MS = 10 * 60 * 1000
const CLOCK_SKEW_ALLOWANCE_MS = 30 * 1000

interface PalReadTokenResponse {
  token: string
  expires_at: string
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

export async function getPalReadToken(
  signal?: AbortSignal,
  options: {
    fetchImplementation?: typeof fetch
    now?: () => number
  } = {},
): Promise<string> {
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
  return body.token
}

export function createPikaPalClient(
  apiBaseUrl: string,
  options: {
    fetchImplementation?: typeof fetch
    now?: () => number
  } = {},
): PalClient {
  return createPalHttpClient({
    apiBaseUrl,
    fetchImplementation: options.fetchImplementation,
    getAccessToken: (signal) => getPalReadToken(signal, options),
  })
}
