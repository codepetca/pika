'use client'

import { useEffect } from 'react'
import {
  redirectToLoginForReauth,
  SESSION_CHANGED_REASON,
  sessionMatchesExpectedUser,
} from '@/lib/client-auth'
import type { UserRole } from '@/types'

type AuthSessionWatcherProps = {
  expectedUserId?: string
  expectedRole?: UserRole
  intervalMs?: number
}

const DEFAULT_INTERVAL_MS = 60_000
const EVENT_BURST_MS = 750

export function AuthSessionWatcher({
  expectedUserId,
  expectedRole,
  intervalMs = DEFAULT_INTERVAL_MS,
}: AuthSessionWatcherProps) {
  useEffect(() => {
    let cancelled = false
    let visibilityGeneration = 0
    let checkingGeneration = -1
    let lastStartedGeneration = -1
    let lastStartedAt = Number.NEGATIVE_INFINITY

    async function checkSession() {
      if (cancelled || document.visibilityState === 'hidden') return
      if (checkingGeneration === visibilityGeneration) return
      const now = performance.now()
      if (
        lastStartedGeneration === visibilityGeneration
        && now - lastStartedAt < Math.min(EVENT_BURST_MS, intervalMs / 2)
      ) return
      checkingGeneration = visibilityGeneration
      lastStartedGeneration = visibilityGeneration
      lastStartedAt = now
      const requestGeneration = visibilityGeneration

      try {
        // Bypass fetchJSONWithCache so account and cookie changes are observed immediately.
        const response = await fetch('/api/auth/me', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))

        if (!cancelled && requestGeneration === visibilityGeneration && response.status === 401) {
          redirectToLoginForReauth()
          return
        }

        if (!cancelled && requestGeneration === visibilityGeneration && response.ok && !sessionMatchesExpectedUser(data.user, expectedUserId, expectedRole)) {
          redirectToLoginForReauth(undefined, SESSION_CHANGED_REASON)
        }
      } catch {
        // Network hiccups should not log users out. The next focus/timer check will retry.
      } finally {
        if (checkingGeneration === requestGeneration) checkingGeneration = -1
      }
    }

    void checkSession()

    const interval = window.setInterval(() => {
      void checkSession()
    }, intervalMs)

    const handleFocus = () => {
      void checkSession()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        visibilityGeneration += 1
      } else {
        void checkSession()
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [expectedRole, expectedUserId, intervalMs])

  return null
}
