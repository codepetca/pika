'use client'

import { navigateTo } from '@/lib/client-navigation'
import type { UserRole } from '@/types'

export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please log in again before continuing.'
export const SESSION_EXPIRED_REASON = 'session-expired'
export const SESSION_CHANGED_MESSAGE = 'Your signed-in account changed. Please log in again before continuing.'
export const SESSION_CHANGED_REASON = 'session-changed'

const INTERNAL_URL_BASE = 'https://pika.internal'

export function getSafeInternalPath(path: string | null | undefined): string | null {
  if (!path?.startsWith('/') || path.includes('\\') || /%5c/i.test(path)) return null

  try {
    const url = new URL(path, INTERNAL_URL_BASE)
    if (url.origin !== INTERNAL_URL_BASE) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function buildLoginRedirectPath(
  currentPath?: string,
  reason = SESSION_EXPIRED_REASON,
): string {
  const path =
    currentPath ??
    (typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '/classrooms')

  const safePath = getSafeInternalPath(path) ?? '/classrooms'
  const searchParams = new URLSearchParams({
    next: safePath,
    reason,
  })
  return `/login?${searchParams.toString()}`
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
