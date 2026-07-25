import { z } from 'zod'

import { requirePalEnvironment } from '@/lib/server/pal-config'
import { pseudonymizePalRef } from '@/lib/server/pal-events'

const palReadTokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().datetime({ offset: true }),
}).strip()

export async function mintPalReadToken(input: {
  studentId: string
  fetchImpl?: typeof fetch
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
  return palReadTokenResponseSchema.parse(await response.json())
}
