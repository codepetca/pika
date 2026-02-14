'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { StudentWorldSnapshot } from '@/types'

type WorldOverlayContextValue = {
  snapshot: StudentWorldSnapshot | null
  loading: boolean
  error: string
  refresh: () => Promise<void>
  toggleOverlay: (enabled: boolean) => Promise<void>
  claimDaily: () => Promise<void>
}

const WorldOverlayContext = createContext<WorldOverlayContextValue | null>(null)

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function WorldOverlayProvider({
  classroomId,
  children,
}: {
  classroomId: string
  children: React.ReactNode
}) {
  const [snapshot, setSnapshot] = useState<StudentWorldSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setError('')
    const res = await fetch(`/api/student/classrooms/${classroomId}/world`, {
      method: 'GET',
      cache: 'no-store',
    })
    const data = await safeJson<StudentWorldSnapshot | { error: string }>(res)
    if (!res.ok) {
      setError((data as { error?: string } | null)?.error || 'Failed to load world state')
      return
    }
    setSnapshot(data as StudentWorldSnapshot)
  }, [classroomId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refresh()
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load world state')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    const interval = setInterval(() => {
      refresh().catch(() => {
        // best effort polling
      })
    }, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [refresh])

  const toggleOverlay = useCallback(async (enabled: boolean) => {
    const res = await fetch(`/api/student/classrooms/${classroomId}/world`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_overlay', enabled }),
    })
    if (!res.ok) {
      const data = await safeJson<{ error?: string }>(res)
      throw new Error(data?.error || 'Failed to update overlay preference')
    }
    setSnapshot((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        world: {
          ...prev.world,
          overlay_enabled: enabled,
        },
      }
    })
  }, [classroomId])

  const claimDaily = useCallback(async () => {
    const res = await fetch(`/api/student/classrooms/${classroomId}/world`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim_daily' }),
    })
    if (!res.ok) {
      const data = await safeJson<{ error?: string }>(res)
      throw new Error(data?.error || 'Failed to claim daily interaction')
    }
    await refresh()
  }, [classroomId, refresh])

  const value = useMemo<WorldOverlayContextValue>(() => ({
    snapshot,
    loading,
    error,
    refresh,
    toggleOverlay,
    claimDaily,
  }), [snapshot, loading, error, refresh, toggleOverlay, claimDaily])

  return (
    <WorldOverlayContext.Provider value={value}>
      {children}
    </WorldOverlayContext.Provider>
  )
}

export function useWorldOverlay() {
  const ctx = useContext(WorldOverlayContext)
  if (!ctx) {
    throw new Error('useWorldOverlay must be used within WorldOverlayProvider')
  }
  return ctx
}

