import { z } from 'zod'

const projectRefSchema = z.string().regex(/^[a-z0-9]{20}$/)

export function verifyHostedSupabaseApiOrigin(
  supabaseUrl: string,
  expectedProjectRef: string,
): string {
  const projectRef = projectRefSchema.parse(expectedProjectRef)
  const parsed = new URL(z.url().parse(supabaseUrl))
  const expectedOrigin = `https://${projectRef}.supabase.co`
  if (
    parsed.origin !== expectedOrigin ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('Supabase inventory target does not match the expected project ref')
  }
  return expectedOrigin
}

function fetchInputUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return input
  return new URL(input.url)
}

export function createTargetBoundFetch(
  expectedOrigin: string,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const origin = new URL(expectedOrigin).origin
  return async (input, init) => {
    if (fetchInputUrl(input).origin !== origin) {
      throw new Error('Supabase request escaped the validated project origin')
    }
    const response = await fetchImpl(input, { ...init, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Supabase request redirect was rejected')
    }
    return response
  }
}

export function verifyHostedSupabaseDatabaseUrl(
  databaseUrl: string,
  expectedProjectRef: string,
): string {
  const projectRef = projectRefSchema.parse(expectedProjectRef)
  const parsed = new URL(databaseUrl)
  const username = decodeURIComponent(parsed.username)
  const isDirect =
    parsed.hostname === `db.${projectRef}.supabase.co` &&
    username === 'postgres' &&
    (parsed.port === '' || parsed.port === '5432')
  const isPooler =
    parsed.hostname.endsWith('.pooler.supabase.com') &&
    username === `postgres.${projectRef}` &&
    (parsed.port === '5432' || parsed.port === '6543')
  const queryParameters = [...parsed.searchParams.entries()]
  const sslMode = queryParameters.length === 1 && queryParameters[0][0] === 'sslmode'
    ? queryParameters[0][1]
    : null
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    (!isDirect && !isPooler) ||
    parsed.password === '' ||
    parsed.pathname !== '/postgres' ||
    parsed.hash !== '' ||
    !['require', 'verify-ca', 'verify-full'].includes(sslMode || '')
  ) {
    throw new Error('Supabase database target does not match the expected project ref')
  }
  return projectRef
}

export type PsqlConnectionEnvironment = {
  PGHOST: string
  PGPORT: string
  PGUSER: string
  PGPASSWORD: string
  PGDATABASE: string
  PGSSLMODE: string
}

function psqlEnvironment(parsed: URL, sslMode: string): PsqlConnectionEnvironment {
  return {
    PGHOST: parsed.hostname === '[::1]' ? '::1' : parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGSSLMODE: sslMode,
  }
}

export function hostedSupabasePsqlEnvironment(
  databaseUrl: string,
  expectedProjectRef: string,
): PsqlConnectionEnvironment {
  verifyHostedSupabaseDatabaseUrl(databaseUrl, expectedProjectRef)
  const parsed = new URL(databaseUrl)
  return psqlEnvironment(parsed, parsed.searchParams.get('sslmode')!)
}

export function localSupabasePsqlEnvironment(databaseUrl: string): PsqlConnectionEnvironment {
  const parsed = new URL(databaseUrl)
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !loopbackHosts.has(parsed.hostname) ||
    parsed.username === '' ||
    parsed.password === '' ||
    parsed.pathname !== '/postgres' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('Local schema audit requires an exact loopback database URL')
  }
  return psqlEnvironment(parsed, 'disable')
}
