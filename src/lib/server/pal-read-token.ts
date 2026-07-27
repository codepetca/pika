import { z } from 'zod'

import { requirePalEnvironment } from '@/lib/server/pal-config'
import { pseudonymizePalRef } from '@/lib/server/pal-events'

const palReadTokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().datetime({ offset: true }),
}).strip()

export const PAL_READ_TOKEN_MAX_TTL_MS = 10 * 60 * 1_000
const PAL_READ_TOKEN_CLOCK_SKEW_MS = 30 * 1_000

export async function mintPalReadToken(input: {
  studentId: string
  fetchImpl?: typeof fetch
  now?: Date
}) {
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
