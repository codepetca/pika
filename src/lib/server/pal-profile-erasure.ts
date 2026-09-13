import { z } from 'zod'
import { requirePalEnvironment } from '@/lib/server/pal-config'

const operationId = z.string().uuid().regex(/^[0-9a-f-]{36}$/)
const learnerId = z.string().regex(/^pika-membership-v1-[0-9a-f]{32}$/)
const instant = z.string().datetime().regex(/Z$/)
export const palErasureBindingSchema = z.object({
  operation_id: operationId,
  learner_id: learnerId,
}).strict()
export type PalErasureBinding = z.infer<typeof palErasureBindingSchema>
export const palErasureReceiptSchema = palErasureBindingSchema.extend({
  schema_version: z.literal(1),
  status: z.enum(['pending', 'completed']),
  begun_at: instant,
  completed_at: instant.nullable(),
}).strict().refine(value => (value.status === 'completed') === (value.completed_at !== null))
  .refine(value => value.completed_at === null || Date.parse(value.completed_at) >= Date.parse(value.begun_at))
export type PalErasureReceipt = z.infer<typeof palErasureReceiptSchema>

export class PalErasureError extends Error {
  constructor(readonly code: 'disabled' | 'configuration' | 'invalid_binding' | 'network_error'
    | 'remote_rejected' | 'invalid_receipt', readonly retryable: boolean, readonly status?: number) {
    super('Pal profile cleanup could not be verified')
    this.name = 'PalErasureError'
  }
}

/** A provider receipt proves only its saved binding, never complete Pika cleanup. */
export function parsePalErasureReceipt(value: unknown, binding: PalErasureBinding): PalErasureReceipt | null {
  const parsed = palErasureReceiptSchema.safeParse(value)
  if (!parsed.success || parsed.data.operation_id !== binding.operation_id
    || parsed.data.learner_id !== binding.learner_id) return null
  return parsed.data
}

/** Dormant server transport. The caller must durably bind and fence before invoking. */
export async function requestPalProfileErasure(
  action: 'begin' | 'status', binding: PalErasureBinding,
  options: { fetcher?: typeof fetch; binding?: { origin: string; integrationId: string } } = {},
): Promise<PalErasureReceipt> {
  if (process.env.PAL_PROFILE_ERASURE_ENABLED !== 'true') throw new PalErasureError('disabled', false)
  const parsed = palErasureBindingSchema.safeParse(binding)
  if (!parsed.success || !['begin', 'status'].includes(action)) throw new PalErasureError('invalid_binding', false)
  let config: ReturnType<typeof requirePalEnvironment>
  try { config = requirePalEnvironment() } catch { throw new PalErasureError('configuration', false) }
  if (options.binding && (config.apiUrl !== options.binding.origin
    || process.env.PAL_PROFILE_ERASURE_INTEGRATION_ID !== options.binding.integrationId)) {
    throw new PalErasureError('configuration', false)
  }
  const path = '/api/v1/integration/profile-erasures'
  let response: Response
  let body: unknown
  try {
    response = await (options.fetcher ?? fetch)(`${config.apiUrl}${path}${action === 'status' ? `/${parsed.data.operation_id}` : ''}`, {
      method: action === 'begin' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${config.integrationSecret}`, 'Content-Type': 'application/json' },
      ...(action === 'begin' ? { body: JSON.stringify(parsed.data) } : {}),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5_000),
    })
    const text = await response.text()
    if (text.length > 4_096) throw new PalErasureError('invalid_receipt', false)
    try { body = JSON.parse(text) as unknown } catch { body = null }
  } catch (error) {
    if (error instanceof PalErasureError) throw error
    throw new PalErasureError('network_error', true)
  }
  if (!response.ok) {
    throw new PalErasureError('remote_rejected', [408, 429].includes(response.status) || response.status >= 500, response.status)
  }
  const receipt = parsePalErasureReceipt(body, parsed.data)
  // A 202 can establish pending state only. GET has a single success status.
  if (!receipt || (response.status !== 200 && !(action === 'begin' && response.status === 202 && receipt.status === 'pending')))
    throw new PalErasureError('invalid_receipt', false, response.status)
  return receipt
}
