import { getSafeInternalPath } from '@/lib/navigation-safety'

export const PIKA_REQUEST_PATH_HEADER = 'x-pika-request-path'

type AuthContinuationPath = '/login' | '/signup' | '/verify-signup' | '/create-password'

export function buildAuthContinuationPath(
  path: AuthContinuationPath,
  input: { email?: string | null; next?: unknown } = {},
): string {
  const searchParams = new URLSearchParams()
  if (input.email) searchParams.set('email', input.email)
  const next = getSafeInternalPath(input.next)
  if (next) searchParams.set('next', next)
  const query = searchParams.toString()
  return query ? `${path}?${query}` : path
}

export function getRequestPath(url: URL): string {
  return `${url.pathname}${url.search}`
}

export function buildLoginRedirectPath(currentPath: string, reason?: string): string {
  const searchParams = new URLSearchParams({
    next: getSafeInternalPath(currentPath) ?? '/classrooms',
  })
  if (reason) searchParams.set('reason', reason)
  return `/login?${searchParams.toString()}`
}
