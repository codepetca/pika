'use client'

import { useCallback, useEffect, useState } from 'react'
import { DESKTOP_BREAKPOINT } from '@/lib/layout-config'
import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'
import type { GradebookClassSummary, GradebookStudentDetail, GradebookStudentSummary } from '@/types'

interface UseGradebookDataOptions {
  classroomId: string
  isTeacher: boolean
  activeTab: string
  openRight: () => void
  setRightSidebarOpen: (open: boolean) => void
}

export interface UseGradebookDataReturn {
  selectedGradebookStudent: GradebookStudentSummary | null
  gradebookStudentDetail: GradebookStudentDetail | null
  gradebookClassSummary: GradebookClassSummary | null
  gradebookStudentDetailLoading: boolean
  gradebookStudentDetailError: string
  handleSelectGradebookStudent: (student: GradebookStudentSummary | null) => void
  handleGradebookClassSummaryChange: (summary: GradebookClassSummary | null) => void
}

/**
 * Manages gradebook data loading for the teacher gradebook tab.
 *
 * Extracted from ClassroomPageClient to isolate the student-detail fetch concern.
 *
 * @example
 * ```tsx
 * const gradebook = useGradebookData({
 *   classroomId: classroom.id,
 *   isTeacher,
 *   activeTab,
 *   openRight,
 *   setRightSidebarOpen,
 * })
 * ```
 */
export function useGradebookData({
  classroomId,
  isTeacher,
  activeTab,
  openRight,
  setRightSidebarOpen,
}: UseGradebookDataOptions): UseGradebookDataReturn {
  const [selectedGradebookStudent, setSelectedGradebookStudent] =
    useState<GradebookStudentSummary | null>(null)
  const [gradebookStudentDetail, setGradebookStudentDetail] =
    useState<GradebookStudentDetail | null>(null)
  const [gradebookClassSummary, setGradebookClassSummary] =
    useState<GradebookClassSummary | null>(null)
  const [gradebookStudentDetailLoading, setGradebookStudentDetailLoading] = useState(false)
  const [gradebookStudentDetailError, setGradebookStudentDetailError] = useState('')
  const [detailRefreshToken, setDetailRefreshToken] = useState(0)

  const handleSelectGradebookStudent = useCallback(
    (student: GradebookStudentSummary | null) => {
      setSelectedGradebookStudent(student)
    },
    []
  )

  const handleGradebookClassSummaryChange = useCallback((summary: GradebookClassSummary | null) => {
    setGradebookClassSummary(summary)
    invalidateCachedJSONMatching(`gradebook:${classroomId}:`)
    setDetailRefreshToken((previous) => previous + 1)
  }, [classroomId])

  // Clear all gradebook state when navigating away from the gradebook tab
  useEffect(() => {
    if (activeTab !== 'gradebook') {
      setSelectedGradebookStudent(null)
      setGradebookStudentDetail(null)
      setGradebookClassSummary(null)
      setGradebookStudentDetailError('')
      setGradebookStudentDetailLoading(false)
    }
  }, [activeTab])

  // Load student detail when a student is selected in the gradebook tab
  useEffect(() => {
    if (!isTeacher || activeTab !== 'gradebook' || !selectedGradebookStudent) return
    const selectedStudentId = selectedGradebookStudent.student_id

    if (window.innerWidth < DESKTOP_BREAKPOINT) {
      openRight()
    } else {
      setRightSidebarOpen(true)
    }

    let cancelled = false

    async function loadStudentDetail() {
      setGradebookStudentDetailLoading(true)
      setGradebookStudentDetailError('')
      try {
        const cacheKey = `gradebook:${classroomId}:${selectedStudentId}`
        const data = await fetchJSONWithCache(
          cacheKey,
          async () => {
            const response = await fetch(
              `/api/teacher/gradebook?classroom_id=${classroomId}&student_id=${selectedStudentId}`
            )
            const json = await response.json()
            if (!response.ok) throw new Error(json.error || 'Failed to load gradebook details')
            return json
          },
          60_000, // 60s TTL — gradebook details are stable within a session
        )

        if (!cancelled) {
          setGradebookStudentDetail((data.selected_student as GradebookStudentDetail | null) || null)
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setGradebookStudentDetail(null)
          setGradebookStudentDetailError(
            err instanceof Error ? err.message : 'Failed to load gradebook details'
          )
        }
      } finally {
        if (!cancelled) {
          setGradebookStudentDetailLoading(false)
        }
      }
    }

    loadStudentDetail()
    return () => {
      cancelled = true
    }
  }, [
    isTeacher,
    activeTab,
    selectedGradebookStudent,
    classroomId,
    setRightSidebarOpen,
    openRight,
    detailRefreshToken,
  ])

  return {
    selectedGradebookStudent,
    gradebookStudentDetail,
    gradebookClassSummary,
    gradebookStudentDetailLoading,
    gradebookStudentDetailError,
    handleSelectGradebookStudent,
    handleGradebookClassSummaryChange,
  }
}
