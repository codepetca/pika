import { getSafeInternalPath } from '@/lib/navigation-safety'

export const PIKA_REQUEST_PATH_HEADER = 'x-pika-request-path'

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
