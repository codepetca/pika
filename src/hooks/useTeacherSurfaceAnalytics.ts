'use client'

import { useEffect, useRef } from 'react'
import { captureTeacherEvent } from '@/lib/analytics/client'

const SURFACES = ['daily', 'gradebook', 'assignments', 'tests', 'blueprint', 'calendar',
  'resources', 'announcements', 'roster', 'settings'] as const

/** Scope is local transition ownership only. Never include it in telemetry. */
export function useTeacherSurfaceAnalytics({ role, surface, scope }: {
  role: string
  surface: string
  scope: string
}) {
  const lastView = useRef<{ surface: string; scope: string } | null>(null)
  useEffect(() => {
    const semanticSurface = SURFACES.find((value) => value === surface)
    if (role !== 'teacher' || !semanticSurface) {
      lastView.current = null
      return
    }
    const observe = () => {
      if (document.visibilityState !== 'visible') {
        lastView.current = null
        return
      }
      if (lastView.current?.surface === semanticSurface && lastView.current.scope === scope) return
      lastView.current = { surface: semanticSurface, scope }
      captureTeacherEvent({ name: 'teacher_surface_viewed', properties: { surface: semanticSurface } })
    }
    observe()
    document.addEventListener('visibilitychange', observe)
    return () => document.removeEventListener('visibilitychange', observe)
  }, [role, surface, scope])
}
