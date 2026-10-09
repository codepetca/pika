'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'
import { captureTeacherEvent } from '@/lib/analytics/client'
import { MAX_DURATION_MS, type TeacherSurface, type FailureCategory } from '@/lib/analytics/events'

function now() {
  try { return performance.now() } catch { return 0 }
}

/** Measures observed list-read resolution, not full DOM paint or backend query time. */
export function useTeacherSurfaceReadAnalytics({ surface, isActive, scope }: {
  surface: TeacherSurface
  isActive: boolean
  scope: string
}) {
  const ownerRef = useRef<{ surface: TeacherSurface; scope: string } | null>(null)
  useLayoutEffect(() => {
    const owner = isActive ? { surface, scope } : null
    ownerRef.current = owner
    return () => { if (ownerRef.current === owner) ownerRef.current = null }
  }, [surface, isActive, scope])

  return useCallback(() => {
    const owner = document.visibilityState === 'visible' ? ownerRef.current : null
    const startedAt = now()
    let finished = false
    const finish = (failure?: FailureCategory) => {
      if (finished) return
      finished = true
      if (!owner || ownerRef.current !== owner || document.visibilityState !== 'visible') return
      try {
        if (failure) captureTeacherEvent({ name: 'teacher_surface_failed', properties: { surface: owner.surface, failure_category: failure } })
        else captureTeacherEvent({ name: 'teacher_surface_ready', properties: {
          surface: owner.surface, duration_ms: Math.min(MAX_DURATION_MS, Math.max(0, now() - startedAt)),
        } })
      } catch {
        // Diagnostic transport must not affect the teacher's usable snapshot.
      }
    }
    return { ready: () => finish(), failed: (category: FailureCategory = 'persistence') => finish(category) }
  }, [])
}
