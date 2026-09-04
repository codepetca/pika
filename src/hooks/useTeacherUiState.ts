'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { readTeacherUiState, writeTeacherUiState } from '@/lib/teacher-ui-state-client'

/**
 * Reads and writes one teacher-scoped UI-state key (onboarding
 * dismissal/progress, or any future one-time guidance).
 *
 * `enabled` gates the fetch — pass `false` for students or while the
 * feature this key belongs to isn't relevant yet.
 */
export function useTeacherUiState<T extends object>(key: string, enabled: boolean) {
  const [value, setValue] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }
    let cancelled = false
    setIsLoading(true)
    readTeacherUiState<T>(key)
      .then((stored) => {
        if (!cancelled && mounted.current) setValue(stored)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled && mounted.current) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, key])

  const update = useCallback(
    async (next: T) => {
      setValue(next) // optimistic
      try {
        await writeTeacherUiState(key, next)
      } catch {
        // The next mount re-reads from the server; a lost write here just
        // means a coachmark or banner reappears once, not a stuck error state.
      }
    },
    [key],
  )

  return { value, isLoading, update }
}
