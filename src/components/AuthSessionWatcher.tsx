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
    let activityGeneration = 0
    let checkingGeneration = -1
    let lastStartedGeneration = -1
    let lastStartedAt = Number.NEGATIVE_INFINITY

    async function checkSession(fromFocusEvent = false) {
      if (cancelled || document.visibilityState === 'hidden') return
      if (!fromFocusEvent && !document.hasFocus()) return
      if (checkingGeneration === activityGeneration) return
      const now = performance.now()
      if (
        lastStartedGeneration === activityGeneration
        && now - lastStartedAt < Math.min(EVENT_BURST_MS, intervalMs / 2)
      ) return
      checkingGeneration = activityGeneration
      lastStartedGeneration = activityGeneration
      lastStartedAt = now
      const requestGeneration = activityGeneration

      try {
        // Keep watcher checks independent of list identity batches so focus and
        // account changes never join an older request.
        const response = await fetch('/api/auth/me', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))

        if (!cancelled && requestGeneration === activityGeneration && response.status === 401) {
          redirectToLoginForReauth()
          return
        }

        if (!cancelled && requestGeneration === activityGeneration && response.ok && !sessionMatchesExpectedUser(data.user, expectedUserId, expectedRole)) {
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
      // The event is authoritative even if document.hasFocus() lags behind it.
      void checkSession(true)
    }
    const handleBlur = () => {
      activityGeneration += 1
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        activityGeneration += 1
      } else {
        void checkSession()
      }
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      activityGeneration += 1
      window.clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [expectedRole, expectedUserId, intervalMs])

  return null
}
