'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { StudentGradesView } from '@/components/gradebook/StudentGradesView'
import { ApiError } from '@/lib/api-error'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'
import type { StudentGradesResponse } from '@/lib/student-grades'
import type { Classroom } from '@/types'
import { Button, PageState, RefreshingIndicator } from '@/ui'

export type StudentGradesReadHandle = {
  classroomId: string
  prefetch: () => void
}

export const StudentGradesTab = forwardRef<StudentGradesReadHandle, { classroom: Classroom; isActive?: boolean }>(function StudentGradesTab({ classroom, isActive = true }, readRef) {
  const [grades, setGrades] = useState<StudentGradesResponse | null>(null)
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)
  const classroomIdRef = useRef<string | null>(null)
  const wasActiveRef = useRef(false)
  const pendingRef = useRef(false)
  const gradesRegionRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    classroomIdRef.current = classroom.id
    requestIdRef.current += 1
    wasActiveRef.current = false
    pendingRef.current = false
    setGrades(null)
    setLoadedClassroomId(null)
    setError('')
    setLoading(false)
    return () => {
      requestIdRef.current += 1
      classroomIdRef.current = null
    }
  }, [classroom.id])

  const loadGrades = useCallback(async () => {
    const classroomId = classroom.id
    if (classroomIdRef.current !== classroomId) return
    const requestId = ++requestIdRef.current
    pendingRef.current = true
    setLoading(true)
    setError('')
    try {
      const data = await fetchJSONWithCache<StudentGradesResponse>(
        `student-grades:${classroomId}`,
        async () => {
          const response = await fetch(`/api/student/classrooms/${classroomId}/grades`)
          if (!response.ok) {
            const json = await response.json().catch(() => null)
            throw new ApiError(response.status, typeof json?.error === 'string' && json.error.trim() ? json.error : 'Failed to load grades')
          }
          return response.json()
        },
        30_000,
      )
      if (requestIdRef.current !== requestId || classroomIdRef.current !== classroomId) return
      setGrades(data)
      setLoadedClassroomId(classroomId)
    } catch (caught) {
      if (requestIdRef.current !== requestId || classroomIdRef.current !== classroomId) return
      if (caught instanceof ApiError && [401, 403, 404].includes(caught.statusCode)) {
        setGrades(null)
        setLoadedClassroomId(null)
      }
      setError(caught instanceof Error ? caught.message : 'Failed to load grades')
    } finally {
      if (requestIdRef.current === requestId && classroomIdRef.current === classroomId) {
        pendingRef.current = false
        setLoading(false)
      }
    }
  }, [classroom.id])

  // Mounted Grades owns intent reads too: a settled rejection must retire its
  // snapshot while the retained workspace is inactive.
  useImperativeHandle(readRef, () => ({
    classroomId: classroom.id,
    prefetch: () => { void loadGrades() },
  }), [classroom.id, loadGrades])

  useEffect(() => {
    if (isActive && !wasActiveRef.current) void loadGrades()
    wasActiveRef.current = isActive
  }, [isActive, loadGrades])

  const retryLoadGrades = useCallback(() => {
    if (pendingRef.current) return
    gradesRegionRef.current?.focus({ preventScroll: true })
    invalidateCachedJSON(`student-grades:${classroom.id}`)
    void loadGrades()
  }, [classroom.id, loadGrades])

  const hasSnapshot = loadedClassroomId === classroom.id && grades !== null
  return (
    <div
      ref={gradesRegionRef}
      role="region"
      aria-label="Grades"
      aria-busy={loading}
      tabIndex={-1}
      className="outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-offset-foundation focus-visible:ring-offset-surface"
    >
      {!hasSnapshot ? (
        <PageState
          kind={loading || !error ? 'loading' : 'error'}
          title={loading || !error ? 'Loading grades' : 'Grades unavailable'}
          description={loading || !error ? 'Loading your returned work.' : error}
          action={error && !loading ? <Button variant="secondary" size="sm" onClick={retryLoadGrades}>Retry</Button> : undefined}
          compact
        />
      ) : (
        <div className="mx-auto w-full max-w-4xl space-y-3">
          {loading && isActive ? <RefreshingIndicator label="Refreshing grades" /> : null}
          {error ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              <span>Grades could not be refreshed. Showing the last returned grades.</span>
              <Button variant="secondary" size="sm" onClick={retryLoadGrades}>Retry</Button>
            </div>
          ) : null}
          <StudentGradesView grades={grades} />
        </div>
      )}
    </div>
  )
})
