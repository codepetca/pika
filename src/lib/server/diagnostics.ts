import { randomUUID } from 'node:crypto'

// Add events deliberately. Do not accept free-form context, messages, URLs or IDs.
const EVENTS = [
  'api.unexpected', 'auth.session', 'auth.rate_limit', 'auth.signup',
  'auth.reset', 'auth.verify', 'auth.email', 'journal.summary',
  'journal.query', 'journal.feedback',
] as const
export type DiagnosticEvent = typeof EVENTS[number]
type Category = 'database' | 'timeout' | 'unexpected'

const DATABASE_CODES = new Set(['23505', '23503', '23502', '42501', '40001', '40P01', 'PGRST116', 'PGRST204', 'PGRST205'])

function ownValue(error: unknown, key: string): unknown {
  if (!error || typeof error !== 'object') return undefined
  try {
    // Never invoke getters, toJSON/toString, traverse causes, or retain the error.
    return Object.getOwnPropertyDescriptor(error, key)?.value
  } catch {
    return undefined
  }
}

function categoryFor(error: unknown): Category {
  const name = ownValue(error, 'name')
  const code = ownValue(error, 'code')
  if (name === 'AbortError' || name === 'TimeoutError' || code === 'ETIMEDOUT' || code === '57014') return 'timeout'
  if (typeof code === 'string' && DATABASE_CODES.has(code)) return 'database'
  return 'unexpected'
}

/** Content-free diagnostic. The random reference is generated here, never from a request. */
export function logServerError(event: DiagnosticEvent, error?: unknown): string {
  const diagnosticId = randomUUID()
  console.error('[pika-diagnostic]', {
    event: EVENTS.includes(event) ? event : 'unknown',
    category: categoryFor(error),
    diagnosticId,
  })
  return diagnosticId
}
