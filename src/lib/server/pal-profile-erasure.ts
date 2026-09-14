import { z } from 'zod'
import { requirePalEnvironment } from '@/lib/server/pal-config'

const operationId = z.string().uuid().regex(/^[0-9a-f-]{36}$/)
const learnerId = z.string().regex(/^pika-membership-v1-[0-9a-f]{32}$/)
const instant = z.string().datetime().regex(/Z$/)
const identitySchema = z.object({
  operation_id: operationId,
  learner_id: learnerId,
}).strict()
export const palErasureBindingSchema = z.union([
  identitySchema,
  identitySchema.extend({ schema_version: z.literal(2), policy: z.literal('pika-live-v1') }).strict(),
])
export type PalErasureBinding = z.infer<typeof palErasureBindingSchema>
const strictReceiptSchema = identitySchema.extend({
  schema_version: z.literal(1),
  status: z.enum(['pending', 'completed']),
  begun_at: instant,
  completed_at: instant.nullable(),
}).strict().refine(value => (value.status === 'completed') === (value.completed_at !== null))
  .refine(value => value.completed_at === null || Date.parse(value.completed_at) >= Date.parse(value.begun_at))
const canonicalInstant = z.string().datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
const liveReceiptSchema = identitySchema.extend({
  schema_version: z.literal(2), policy: z.literal('pika-live-v1'),
  status: z.enum(['pending', 'completed']), begun_at: canonicalInstant,
  completed_at: canonicalInstant.nullable(), historical_backups: z.literal('excluded'),
  backup_retention: z.literal('not_attested'),
}).strict().refine(value => (value.status === 'completed') === (value.completed_at !== null))
  .refine(value => value.completed_at === null || Date.parse(value.completed_at) >= Date.parse(value.begun_at))
export const palErasureReceiptSchema = z.union([strictReceiptSchema, liveReceiptSchema])
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
  const expected = palErasureBindingSchema.safeParse(binding)
  if (!expected.success) return null
  const parsed = palErasureReceiptSchema.safeParse(value)
  if (!parsed.success || parsed.data.operation_id !== binding.operation_id
    || parsed.data.learner_id !== binding.learner_id
    || parsed.data.schema_version !== ('schema_version' in expected.data ? 2 : 1)) return null
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
      headers: { Authorization: `Bearer ${config.integrationSecret}`, 'Content-Type': 'application/json',
        ...(action === 'status' && 'schema_version' in parsed.data ? { 'Pal-Erasure-Policy': 'pika-live-v1' } : {}),
      },
      ...(action === 'begin' ? { body: JSON.stringify(parsed.data) } : {}),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) {
      throw new PalErasureError('remote_rejected', [404, 408, 429].includes(response.status) || response.status >= 500, response.status)
    }
    const text = await response.text()
    if (text.length > 4_096) throw new PalErasureError('invalid_receipt', true, response.status)
    try { body = JSON.parse(text) as unknown } catch { body = null }
  } catch (error) {
    if (error instanceof PalErasureError) throw error
    throw new PalErasureError('network_error', true)
  }
  const receipt = parsePalErasureReceipt(body, parsed.data)
  // A 202 can establish pending state only. GET has a single success status.
  // Unproven replies remain retryable with the same durable operation binding.
  if (!receipt || (response.status !== 200 && !(action === 'begin' && response.status === 202 && receipt.status === 'pending')))
    throw new PalErasureError('invalid_receipt', true, response.status)
  return receipt
}
