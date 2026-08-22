'use client'

import { navigateTo } from '@/lib/client-navigation'
import type { UserRole } from '@/types'
import { buildLoginRedirectPath as buildLoginRedirectPathFromPath } from '@/lib/auth-redirect'
import { getSafeInternalPath } from '@/lib/navigation-safety'

export { getSafeInternalPath } from '@/lib/navigation-safety'

export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please log in again before continuing.'
export const SESSION_EXPIRED_REASON = 'session-expired'
export const SESSION_CHANGED_MESSAGE = 'Your signed-in account changed. Please log in again before continuing.'
export const SESSION_CHANGED_REASON = 'session-changed'

export function buildLoginRedirectPath(
  currentPath?: string,
  reason = SESSION_EXPIRED_REASON,
): string {
  const path =
    currentPath ??
    (typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '/classrooms')

  return buildLoginRedirectPathFromPath(path, reason)
}

export function redirectToLoginForReauth(
  currentPath?: string,
  reason = SESSION_EXPIRED_REASON,
): void {
  if (typeof window === 'undefined') return
  navigateTo(buildLoginRedirectPath(currentPath, reason))
}

export function sessionMatchesExpectedUser(
  user: { id?: string | null; role?: UserRole | null } | null | undefined,
  expectedUserId?: string,
  expectedRole?: UserRole,
): boolean {
  if (!user) return false
  if (expectedUserId && user.id !== expectedUserId) return false
  return !expectedRole || user.role === expectedRole
}
