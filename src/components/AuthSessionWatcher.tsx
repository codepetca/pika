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

export function AuthSessionWatcher({
  expectedUserId,
  expectedRole,
  intervalMs = DEFAULT_INTERVAL_MS,
}: AuthSessionWatcherProps) {
  useEffect(() => {
    let cancelled = false
    let checking = false

    async function checkSession() {
      if (checking || cancelled) return
      checking = true

      try {
        // Bypass fetchJSONWithCache so account and cookie changes are observed immediately.
        const response = await fetch('/api/auth/me', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))

        if (!cancelled && response.status === 401) {
          redirectToLoginForReauth()
          return
        }

        if (!cancelled && response.ok && !sessionMatchesExpectedUser(data.user, expectedUserId, expectedRole)) {
          redirectToLoginForReauth(undefined, SESSION_CHANGED_REASON)
        }
      } catch {
        // Network hiccups should not log users out. The next focus/timer check will retry.
      } finally {
        checking = false
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
      if (document.visibilityState === 'visible') {
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
