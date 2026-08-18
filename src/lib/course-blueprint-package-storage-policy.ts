const MANAGED_STORAGE_BUCKETS = new Set([
  'assignment-artifacts',
  'submission-images',
  'test-documents',
])
const STORAGE_ACCESS_MODES = new Set(['public', 'sign', 'authenticated'])
const MAX_PATH_DECODE_ROUNDS = 3
const MAX_FREEFORM_URL_CANDIDATES = 512
const MAX_FREEFORM_URL_SPAN_CHARS = 16_384

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

function isUrlCandidateBoundary(markdown: string, index: number): boolean {
  if (index === 0) return true
  const previous = markdown[index - 1]
  if (previous.trim() === '') return true
  const code = previous.charCodeAt(0)
  const isAsciiAlphaNumeric = (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
  return !isAsciiAlphaNumeric && !'%._~/-'.includes(previous)
}

function urlCandidatePrefixLength(markdown: string, lower: string, index: number): number {
  if (!isUrlCandidateBoundary(markdown, index)) return 0
  if (lower.startsWith('https://', index)) return 'https://'.length
  if (lower.startsWith('http://', index)) return 'http://'.length
  if (lower.startsWith('//', index) && markdown[index - 1] !== ':') return 2
  const followsHttpScheme = lower.slice(Math.max(0, index - 'https:'.length), index) === 'https:'
    || lower.slice(Math.max(0, index - 'http:'.length), index) === 'http:'
  if (followsHttpScheme) return 0
  if (lower.startsWith('%25252f', index)) return '%25252f'.length
  if (lower.startsWith('%252f', index)) return '%252f'.length
  if (lower.startsWith('%2f', index)) return '%2f'.length
  return lower[index] === '/' ? 1 : 0
}

export function containsPikaManagedStorageUrl(
  markdown: string,
  configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  const lower = markdown.toLowerCase()
  let candidateCount = 0

  for (let index = 0; index < markdown.length; index += 1) {
    const prefixLength = urlCandidatePrefixLength(markdown, lower, index)
    if (prefixLength === 0) continue

    let end = index + prefixLength
    while (end < markdown.length && markdown[end].trim() !== '') end += 1
    if (end - index > MAX_FREEFORM_URL_SPAN_CHARS) return true
    candidateCount += 1
    if (candidateCount > MAX_FREEFORM_URL_CANDIDATES) return true
    if (isPikaManagedStorageUrl(markdown.slice(index, end), configuredUrl)) return true
  }

  return false
}
