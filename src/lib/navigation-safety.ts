const INTERNAL_PATH_BASE = 'https://pika.internal'

export function isSafeInternalPath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const path = value.trim()
  if (!path.startsWith('/') || path.startsWith('//')) return false

  try {
    return new URL(path, INTERNAL_PATH_BASE).origin === INTERNAL_PATH_BASE
  } catch {
    return false
  }
}
