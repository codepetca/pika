function isPalFlagEnabled(): boolean {
  return process.env.PAL_ENABLED?.trim().toLowerCase() === 'true'
}

export function isPalEnabled(): boolean {
  if (!isPalFlagEnabled()) return false
  requirePalEnvironment()
  return true
}

export function requirePalPseudonymSecret(): string {
  const secret = process.env.PAL_PSEUDONYM_SECRET?.trim()
  if (!secret) {
    throw new Error('PAL_PSEUDONYM_SECRET is not configured')
  }
  if (secret.length < 32) {
    throw new Error('PAL_PSEUDONYM_SECRET must be at least 32 characters')
  }
  return secret
}

function parsePalOrigin(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('PAL_API_URL must be an absolute URL')
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('PAL_API_URL must contain only an origin')
  }

  if (url.protocol === 'https:') return url.origin

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  if (
    url.protocol === 'http:' &&
    process.env.NODE_ENV !== 'production' &&
    loopbackHosts.has(url.hostname)
  ) {
    return url.origin
  }

  throw new Error(
    'PAL_API_URL must use HTTPS (HTTP is allowed only for loopback development)',
  )
}

export function requirePalEnvironment(): {
  apiUrl: string
  integrationSecret: string
  pseudonymSecret: string
} {
  const apiUrl = process.env.PAL_API_URL?.trim()
  const integrationSecret = process.env.PAL_INTEGRATION_SECRET?.trim()
  const pseudonymSecret = process.env.PAL_PSEUDONYM_SECRET?.trim()

  if (!apiUrl || !integrationSecret || !pseudonymSecret) {
    throw new Error(
      'PAL_ENABLED requires PAL_API_URL, PAL_INTEGRATION_SECRET, and PAL_PSEUDONYM_SECRET',
    )
  }
  if (integrationSecret.length < 32 || pseudonymSecret.length < 32) {
    throw new Error(
      'PAL_INTEGRATION_SECRET and PAL_PSEUDONYM_SECRET must each be at least 32 characters',
    )
  }
  if (integrationSecret === pseudonymSecret) {
    throw new Error(
      'PAL_INTEGRATION_SECRET and PAL_PSEUDONYM_SECRET must be distinct',
    )
  }

  return {
    apiUrl: parsePalOrigin(apiUrl),
    integrationSecret,
    pseudonymSecret,
  }
}

export function getPalApiUrl(): string | null {
  if (!isPalFlagEnabled()) return null

  try {
    const { apiUrl } = requirePalEnvironment()
    return apiUrl
  } catch (error) {
    // Widget configuration must not make the authenticated academic shell fail.
    console.error('Pal widget is unavailable because its server configuration is invalid:', error)
    return null
  }
}
