const MANAGED_STORAGE_BUCKETS = new Set([
  'assignment-artifacts',
  'submission-images',
  'test-documents',
])
const STORAGE_ACCESS_MODES = new Set(['public', 'sign', 'authenticated'])
const MAX_PATH_DECODE_ROUNDS = 3

type OriginIdentity = {
  protocol: string
  hostname: string
  port: string
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/[.\u3002\uff0e\uff61]+$/u, '')
}

function originIdentity(url: URL): OriginIdentity {
  const defaultPort = url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : ''
  return {
    protocol: url.protocol,
    hostname: normalizeHostname(url.hostname),
    port: url.port || defaultPort,
  }
}

function configuredSupabaseOrigin(
  configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): { url: URL; identity: OriginIdentity } | null {
  if (!configuredUrl) return null
  try {
    const url = new URL(configuredUrl)
    return { url, identity: originIdentity(url) }
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
  if (
    segments[0]?.toLowerCase() !== 'storage'
    || segments[1]?.toLowerCase() !== 'v1'
  ) return false

  const route = segments[2]?.toLowerCase()
  const isObjectRoute = route === 'object'
  const isImageRenderRoute = route === 'render' && segments[3]?.toLowerCase() === 'image'
  const modeIndex = isObjectRoute ? 3 : isImageRenderRoute ? 4 : -1
  if (modeIndex < 0) return false
  return STORAGE_ACCESS_MODES.has(segments[modeIndex]?.toLowerCase())
    && MANAGED_STORAGE_BUCKETS.has(segments[modeIndex + 1]?.toLowerCase())
    && Boolean(segments[modeIndex + 2])
}

export function isPikaManagedStorageUrl(
  value: string,
  configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  const configuredOrigin = configuredSupabaseOrigin(configuredUrl)
  if (!configuredOrigin) return false
  try {
    const parsed = new URL(value, configuredOrigin.url)
    const parsedOrigin = originIdentity(parsed)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsedOrigin.protocol === configuredOrigin.identity.protocol
      && parsedOrigin.hostname === configuredOrigin.identity.hostname
      && parsedOrigin.port === configuredOrigin.identity.port
      && isManagedStoragePath(parsed.pathname)
  } catch {
    return false
  }
}

export function containsPikaManagedStorageUrl(
  markdown: string,
  configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  const candidates = markdown.match(/(?:https?:)?\/\/[^\s<>"')\]]+|\/[^\s<>"')\]]+/gi) || []
  return candidates.some((candidate) => isPikaManagedStorageUrl(candidate, configuredUrl))
}
