const MANAGED_STORAGE_BUCKETS = new Set([
  'assignment-artifacts',
  'submission-images',
  'test-documents',
])
const STORAGE_ACCESS_MODES = new Set(['public', 'sign', 'authenticated'])
const MAX_PATH_DECODE_ROUNDS = 3

function configuredSupabaseOrigin(configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!configuredUrl) return null
  try {
    return new URL(configuredUrl).origin
  } catch {
    return null
  }
}

function decodeStoragePath(pathname: string): string | null {
  let decoded = pathname
  for (let round = 0; round < MAX_PATH_DECODE_ROUNDS; round += 1) {
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      return null
    }
    if (next === decoded) return decoded
    decoded = next
  }

  try {
    return decodeURIComponent(decoded) === decoded ? decoded : null
  } catch {
    return null
  }
}

function isManagedStoragePath(pathname: string): boolean {
  const decoded = decodeStoragePath(pathname)
  if (decoded === null) return true
  const segments = decoded.split('/').filter(Boolean)
  return segments.length >= 6
    && segments[0]?.toLowerCase() === 'storage'
    && segments[1]?.toLowerCase() === 'v1'
    && segments[2]?.toLowerCase() === 'object'
    && STORAGE_ACCESS_MODES.has(segments[3]?.toLowerCase())
    && MANAGED_STORAGE_BUCKETS.has(segments[4]?.toLowerCase())
    && Boolean(segments[5])
}

export function isPikaManagedStorageUrl(
  value: string,
  configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  const origin = configuredSupabaseOrigin(configuredUrl)
  if (!origin) return false
  try {
    const parsed = new URL(value, origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.origin === origin
      && isManagedStoragePath(parsed.pathname)
  } catch {
    return false
  }
}

export function containsPikaManagedStorageUrl(
  markdown: string,
  configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  const candidates = markdown.match(/(?:https?:)?\/\/[^\s<>"')\]]+|\/storage\/v1\/object\/[^\s<>"')\]]+/gi) || []
  return candidates.some((candidate) => isPikaManagedStorageUrl(candidate, configuredUrl))
}
