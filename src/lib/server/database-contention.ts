const RETRYABLE_DATABASE_CONTENTION_CODES = new Set([
  '40001', // serialization failure or an explicit transaction retry
  '40P01', // deadlock detected
  '55000', // guarded lifecycle state changed
  '55P03', // lock not available
])

export function isRetryableDatabaseContention(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? error.code : undefined
  return typeof code === 'string' && RETRYABLE_DATABASE_CONTENTION_CODES.has(code)
}
