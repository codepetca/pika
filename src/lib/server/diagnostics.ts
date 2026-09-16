import { randomUUID } from 'node:crypto'

// Add events deliberately. Do not accept free-form context, messages, URLs or IDs.
const EVENTS = [
  'api.unexpected', 'auth.session', 'auth.rate_limit', 'auth.signup',
  'auth.reset', 'auth.verify', 'auth.email', 'journal.summary',
  'journal.query', 'journal.feedback',
  'test.submit',
  'test.submit_result',
  'test.submit_history',
  'test.save',
  'test.save_result',
  'test.save_history',
  'test.finalize',
  'test.history_attempt',
  'test.history_responses',
  'test.history_availability',
  'test.history_read',
  'gradebook.categories',
  'gradebook.enrollments',
  'gradebook.profiles',
  'gradebook.assignments',
  'gradebook.documents',
  'gradebook.tests',
  'gradebook.overrides',
  'gradebook.questions',
  'gradebook.responses',
  'gradebook.attempts',
  'gradebook.category_validation',
  'gradebook.weight_save',
  'gradebook.override_enrollment',
  'gradebook.override_assessment',
  'gradebook.override_save',
  'gradebook.override_undo',
  'gradebook.categories_save',
  'grading.test_enrollment',
  'grading.assignment_enrollment',
  'grading.assignment_document',
  'grading.test_run_reference_cache',
  'grading.suggestion_enrollment',
  'grading.suggestion_reference_cache',
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
