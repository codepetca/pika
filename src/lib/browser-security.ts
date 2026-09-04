export interface BrowserSecurityEnvironment {
  isDevelopment: boolean
  supabaseUrl?: string
  palApiUrl?: string
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function configuredBrowserOrigin(
  rawUrl: string | undefined,
  isDevelopment: boolean,
): string | null {
  if (!rawUrl?.trim()) return null

  try {
    const url = new URL(rawUrl.trim())
    if (url.username || url.password) return null
    if (url.protocol === 'https:') return url.origin
    if (
      isDevelopment
      && url.protocol === 'http:'
      && LOOPBACK_HOSTS.has(url.hostname)
    ) {
      return url.origin
    }
  } catch {
    // Invalid optional configuration must not weaken or invalidate the policy.
  }

  return null
}

function uniqueSources(sources: Array<string | null>): string {
  return Array.from(new Set(sources.filter((source): source is string => Boolean(source))))
    .join(' ')
}

/**
 * Build the enforced browser policy around the exact runtime integrations that
 * can be reached from client code. The nonce keeps executable inline code off
 * the allowlist while still supporting Next.js hydration.
 */
export function createContentSecurityPolicy(
  nonce: string,
  environment: BrowserSecurityEnvironment,
): string {
  const supabaseOrigin = configuredBrowserOrigin(
    environment.supabaseUrl,
    environment.isDevelopment,
  )
  const palOrigin = configuredBrowserOrigin(
    environment.palApiUrl,
    environment.isDevelopment,
  )
  const connectSources = uniqueSources([
    "'self'",
    supabaseOrigin,
    palOrigin,
    environment.isDevelopment ? 'ws:' : null,
  ])
  const imageSources = uniqueSources([
    "'self'",
    'data:',
    'blob:',
    'https:',
    environment.isDevelopment ? 'http:' : null,
  ])
  const frameSources = uniqueSources([
    "'self'",
    'https:',
    environment.isDevelopment ? 'http:' : null,
  ])

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${environment.isDevelopment ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src ${imageSources}`,
    `connect-src ${connectSources}`,
    `frame-src ${frameSources}`,
    "frame-ancestors 'self'",
    "worker-src 'self' blob:",
    "media-src 'self' blob: https:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

export function createCspNonce(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

export function getBrowserSecurityEnvironment(): BrowserSecurityEnvironment {
  return {
    isDevelopment: process.env.NODE_ENV === 'development',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    palApiUrl: process.env.PAL_API_URL,
  }
}
