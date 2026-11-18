'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import type { TestAiGradingRunSummary } from '@/types'

export type TestGradingBatchSummary = {
  message?: string
  skipped_unanswered_count?: number
  skipped_already_graded_count?: number
  skipped_student_count?: number
}

type Actions = {
  onStart: () => void
  onRun: (run: TestAiGradingRunSummary, started: boolean, preserveSelection: boolean) => void
  onNoop: (summary: TestGradingBatchSummary, preserveSelection: boolean, isCurrent: () => boolean) => void | Promise<void>
  onError: (message: string) => void
}

/** Starts one test grading batch; durable run polling remains with the existing run owner. */
export function useTestGradingBatchController({ classroomId, testId, mode = 'existing', ...actions }: Actions & {
  classroomId: string
  testId: string | null
  mode?: string
}) {
  const owner = JSON.stringify([classroomId, testId, mode])
  const [runningOwner, setRunningOwner] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  const currentActions = useRef(actions)
  currentActions.current = actions

  useLayoutEffect(() => {
    setRunningOwner(null)
    return () => {
      const previous = active.current
      active.current = null
      previous?.abort()
    }
  }, [owner])

  async function start(gradeScope: 'ungraded' | 'all', studentIds: string[], options?: { preserveSelection?: boolean }) {
    if (!testId || studentIds.length === 0 || active.current) return
    const controller = new AbortController()
    active.current = controller
    const isCurrent = () => active.current === controller
    const preserveSelection = options?.preserveSelection ?? false
    setRunningOwner(owner)
    currentActions.current.onStart()
    try {
      const response = await fetch(`/api/teacher/tests/${testId}/auto-grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: studentIds, grade_scope: gradeScope }),
        signal: controller.signal,
      })
      const data = await response.json()
      if (!isCurrent()) return
      if (response.status === 202 && data.run) {
        currentActions.current.onRun(data.run as TestAiGradingRunSummary, true, preserveSelection)
        return
      }
      if (response.status === 409 && data.run) {
        currentActions.current.onRun(data.run as TestAiGradingRunSummary, false, preserveSelection)
        throw new Error(data.error || 'Another grading run is already active')
      }
      if (!response.ok) throw new Error(data.error || 'Auto-grade failed')
      await currentActions.current.onNoop((data.summary ?? {}) as TestGradingBatchSummary, preserveSelection, isCurrent)
    } catch (error) {
      if (isCurrent()) currentActions.current.onError(error instanceof Error ? error.message : 'Auto-grade failed')
    } finally {
      if (isCurrent()) {
        active.current = null
        setRunningOwner(null)
      }
    }
  }

  return { running: runningOwner === owner, start }
}
