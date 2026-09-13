import { createPalHttpClient, type PalClient } from '@codepet/pal-widget'

const MAX_READ_TOKEN_LIFETIME_MS = 10 * 60 * 1000
const CLOCK_SKEW_ALLOWANCE_MS = 30 * 1000
const READ_TOKEN_REFRESH_BUFFER_MS = 30 * 1000

export type PalMembershipScope = { classroomId: string; scopeKey: string }
type PalClientOptions = {
  fetchImplementation?: typeof fetch
  now?: () => number
  membership?: PalMembershipScope
  onRevoked?: () => void
}

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
  options: PalClientOptions = {},
): Promise<CachedPalReadToken> {
  const fetchImplementation = options.fetchImplementation ?? fetch
  const response = await fetchImplementation('/api/student/pal/read-token', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(options.membership ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.membership ? { body: JSON.stringify(options.membership) } : {}),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Pal token request failed with HTTP ${response.status}`)
  }

  const payload = await response.json()
  if (options.membership && payload?.scope_key !== options.membership.scopeKey) {
    options.onRevoked?.()
    throw new Error('Pal token response has the wrong membership scope')
  }
  const body = parseReadTokenResponse(
    payload,
    options.now?.() ?? Date.now(),
  )
  return {
    token: body.token,
    expiresAtMs: Date.parse(body.expires_at),
  }
}

export function createPalReadTokenProvider(
  options: PalClientOptions = {},
): ((signal?: AbortSignal) => Promise<string>) & { invalidate: () => void } {
  let cachedToken: CachedPalReadToken | null = null
  let generation = 0
  const observedSignals = new WeakSet<AbortSignal>()
  const invalidate = () => { cachedToken = null; generation += 1 }

  const getToken = async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (options.membership && signal && !observedSignals.has(signal)) {
      observedSignals.add(signal)
      signal.addEventListener('abort', invalidate, { once: true })
    }
    const now = options.now?.() ?? Date.now()
    if (
      // Membership requests re-authorize with Pika every time. The server's
      // scoped mint cache still avoids repeated provider token minting.
      !options.membership && cachedToken
      && cachedToken.expiresAtMs - READ_TOKEN_REFRESH_BUFFER_MS > now
    ) {
      return cachedToken.token
    }

    const requestedGeneration = generation
    const nextToken = await requestPalReadToken(signal, options)
    signal?.throwIfAborted()
    if (requestedGeneration !== generation) throw new Error('Pal token scope was invalidated')
    cachedToken = nextToken
    return nextToken.token
  }
  return Object.assign(getToken, { invalidate })
}

export async function getPalReadToken(
  signal?: AbortSignal,
  options: PalClientOptions = {},
): Promise<string> {
  return createPalReadTokenProvider(options)(signal)
}

export function createPikaPalClient(
  apiBaseUrl: string,
  options: PalClientOptions = {},
): PalClient {
  const fetchImplementation = options.fetchImplementation ?? fetch
  // Legacy learners retain their existing behavior. Membership clients have a
  // terminal lifetime: a denied request cannot repopulate token or widget state.
  const lifetime = new AbortController()
  let revoked = false
  const revoke = () => {
    if (revoked || !options.membership) return
    revoked = true
    getAccessToken.invalidate()
    lifetime.abort()
    options.onRevoked?.()
  }
  const guardedFetch: typeof fetch = async (input, init) => {
    init?.signal?.throwIfAborted()
    if (options.membership) lifetime.signal.throwIfAborted()
    const response = await fetchImplementation(input, { ...init, cache: 'no-store' })
    init?.signal?.throwIfAborted()
    if (options.membership) lifetime.signal.throwIfAborted()
    if ([401, 403, 404, 410].includes(response.status)) revoke()
    return response
  }
  const getAccessToken = createPalReadTokenProvider({ ...options, onRevoked: revoke,
    fetchImplementation: guardedFetch })

  const client = createPalHttpClient({
    apiBaseUrl,
    fetchImplementation: guardedFetch,
    getAccessToken,
  })
  if (!options.membership) return client

  async function request<T>(signal: AbortSignal | undefined, execute: (signal: AbortSignal) => Promise<T>) {
    if (revoked) throw new Error('Pal membership access ended')
    const current = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
    current.throwIfAborted()
    const result = await execute(current)
    current.throwIfAborted()
    return result
  }
  return {
    getSnapshot: signal => request(signal, current => client.getSnapshot(current)),
    markRewardSeen: (rewardId, signal) => request(signal, current => client.markRewardSeen(rewardId, current)),
    ...(client.setRewardLoadout ? { setRewardLoadout: ((slot, rewardId, signal) =>
      request(signal, current => client.setRewardLoadout!(slot, rewardId, current))) as NonNullable<PalClient['setRewardLoadout']> } : {}),
  }
}
