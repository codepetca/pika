import { z } from 'zod'

import { requirePalEnvironment } from '@/lib/server/pal-config'
import { pseudonymizePalRef } from '@/lib/server/pal-events'

const palReadTokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().datetime({ offset: true }),
}).strip()

export const PAL_READ_TOKEN_MAX_TTL_MS = 10 * 60 * 1_000
const PAL_READ_TOKEN_CLOCK_SKEW_MS = 30 * 1_000
const PAL_READ_TOKEN_REFRESH_BUFFER_MS = 30 * 1_000
const PAL_READ_TOKEN_CACHE_MAX_LEARNERS = 1_000

export interface PalReadToken {
  token: string
  expires_at: string
}

export async function mintPalReadToken(input: {
  studentId: string
  fetchImpl?: typeof fetch
  now?: Date
}): Promise<PalReadToken> {
  const { apiUrl, integrationSecret, pseudonymSecret } = requirePalEnvironment()
  const learnerId = pseudonymizePalRef(
    'learner',
    input.studentId,
    pseudonymSecret,
  )
  const response = await (input.fetchImpl ?? fetch)(
    `${apiUrl}/api/v1/integration/read-token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${integrationSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ learner_id: learnerId }),
      signal: AbortSignal.timeout(5_000),
    },
  )

  if (!response.ok) {
    throw new Error(`Pal read-token endpoint returned HTTP ${response.status}`)
  }
  const token = palReadTokenResponseSchema.parse(await response.json())
  const nowMs = (input.now ?? new Date()).getTime()
  const expiresAtMs = Date.parse(token.expires_at)

  if (expiresAtMs <= nowMs) {
    throw new Error('Pal returned an expired read token')
  }
  if (expiresAtMs - nowMs > PAL_READ_TOKEN_MAX_TTL_MS + PAL_READ_TOKEN_CLOCK_SKEW_MS) {
    throw new Error('Pal returned a read token beyond Pika’s maximum TTL')
  }

  return token
}

/**
 * Reuse one learner-scoped token per server instance until its refresh window.
 * This also coalesces concurrent requests so a browser-cache bypass cannot fan
 * out privileged Pal mint calls for the same authenticated learner.
 */
export function createPalReadTokenBroker(options: {
  mint?: (input: { studentId: string }) => Promise<PalReadToken>
  now?: () => number
  maxCachedLearners?: number
} = {}) {
  const mint = options.mint ?? mintPalReadToken
  const now = options.now ?? Date.now
  const maxCachedLearners = options.maxCachedLearners
    ?? PAL_READ_TOKEN_CACHE_MAX_LEARNERS
  const cachedTokens = new Map<string, PalReadToken>()
  const inFlightMints = new Map<string, Promise<PalReadToken>>()

  return async ({ studentId }: { studentId: string }): Promise<PalReadToken> => {
    const cached = cachedTokens.get(studentId)
    if (
      cached
      && Date.parse(cached.expires_at) - PAL_READ_TOKEN_REFRESH_BUFFER_MS > now()
    ) {
      // Refresh insertion order so the bounded cache evicts the least-recently
      // used learner first.
      cachedTokens.delete(studentId)
      cachedTokens.set(studentId, cached)
      return cached
    }
    cachedTokens.delete(studentId)

    const existingMint = inFlightMints.get(studentId)
    if (existingMint) return existingMint

    const nextMint = mint({ studentId })
      .then((token) => {
        if (
          Date.parse(token.expires_at) - PAL_READ_TOKEN_REFRESH_BUFFER_MS
          > now()
        ) {
          cachedTokens.set(studentId, token)
          while (cachedTokens.size > maxCachedLearners) {
            const oldestLearner = cachedTokens.keys().next().value
            if (oldestLearner === undefined) break
            cachedTokens.delete(oldestLearner)
          }
        }
        return token
      })
      .finally(() => {
        if (inFlightMints.get(studentId) === nextMint) {
          inFlightMints.delete(studentId)
        }
      })
    inFlightMints.set(studentId, nextMint)
    return nextMint
  }
}

export const getPalReadTokenForStudent = createPalReadTokenBroker()
