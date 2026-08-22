const INTERNAL_PATH_BASE = 'https://pika.internal'

export function getSafeInternalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /%5c/i.test(path)) {
    return null
  }

  try {
    const url = new URL(path, INTERNAL_PATH_BASE)
    if (url.origin !== INTERNAL_PATH_BASE || url.pathname.startsWith('//')) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function isSafeInternalPath(value: unknown): value is string {
  return getSafeInternalPath(value) !== null
}
