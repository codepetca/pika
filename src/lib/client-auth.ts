'use client'

import { navigateTo } from '@/lib/client-navigation'
import type { UserRole } from '@/types'

export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please log in again before continuing.'

export function isAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403
}

export function buildLoginRedirectPath(currentPath?: string): string {
  const path =
    currentPath ??
    (typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '/classrooms')

  const safePath = path.startsWith('/') && !path.startsWith('//') ? path : '/classrooms'
  return `/login?next=${encodeURIComponent(safePath)}`
}

export function redirectToLoginForReauth(currentPath?: string): void {
  if (typeof window === 'undefined') return
  navigateTo(buildLoginRedirectPath(currentPath))
}

export function sessionMatchesExpectedRole(
  user: { role?: UserRole | null } | null | undefined,
  expectedRole?: UserRole,
): boolean {
  if (!user) return false
  return !expectedRole || user.role === expectedRole
}
