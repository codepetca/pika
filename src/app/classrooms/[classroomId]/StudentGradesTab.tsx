'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { StudentGradesView } from '@/components/gradebook/StudentGradesView'
import { fetchJSONWithCache } from '@/lib/request-cache'
import type { StudentGradesResponse } from '@/lib/student-grades'
import type { Classroom } from '@/types'
import { Button, PageState, RefreshingIndicator } from '@/ui'

export function StudentGradesTab({ classroom, isActive = true }: { classroom: Classroom; isActive?: boolean }) {
  const [grades, setGrades] = useState<StudentGradesResponse | null>(null)
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)
  const classroomIdRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    classroomIdRef.current = classroom.id
    return () => {
      if (classroomIdRef.current === classroom.id) classroomIdRef.current = null
    }
  }, [classroom.id])

  const loadGrades = useCallback(async (preserveSnapshot = false) => {
    const classroomId = classroom.id
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError('')
    try {
      const data = await fetchJSONWithCache<StudentGradesResponse>(
        `student-grades:${classroomId}`,
        async () => {
          const response = await fetch(`/api/student/classrooms/${classroomId}/grades`)
          const json = await response.json()
          if (!response.ok) throw new Error(json.error || 'Failed to load grades')
          return json
        },
        30_000,
      )
      if (requestIdRef.current !== requestId || classroomIdRef.current !== classroomId) return
      setGrades(data)
      setLoadedClassroomId(classroomId)
    } catch (caught) {
      if (requestIdRef.current !== requestId || classroomIdRef.current !== classroomId) return
      if (!preserveSnapshot) {
        setGrades(null)
        setLoadedClassroomId(null)
      }
      setError(caught instanceof Error ? caught.message : 'Failed to load grades')
    } finally {
      if (requestIdRef.current === requestId && classroomIdRef.current === classroomId) setLoading(false)
    }
  }, [classroom.id])

  useEffect(() => {
    requestIdRef.current += 1
    setGrades(null)
    setLoadedClassroomId(null)
    setError('')
    setLoading(false)
    if (isActive) void loadGrades()
  }, [classroom.id, isActive, loadGrades])

  const hasSnapshot = loadedClassroomId === classroom.id && grades !== null
  if (!hasSnapshot) {
    return (
      <PageState
        kind={loading || !error ? 'loading' : 'error'}
        title={loading || !error ? 'Loading grades' : 'Grades unavailable'}
        description={loading || !error ? 'Loading your returned work.' : error}
        action={error ? <Button variant="secondary" size="sm" onClick={() => { void loadGrades() }}>Retry</Button> : undefined}
        compact
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3">
      {loading ? <RefreshingIndicator label="Refreshing grades" /> : null}
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
          <span>Grades could not be refreshed. Showing the last returned grades.</span>
          <Button variant="secondary" size="sm" onClick={() => { void loadGrades(true) }}>Retry</Button>
        </div>
      ) : null}
      <StudentGradesView grades={grades} />
    </div>
  )
}
