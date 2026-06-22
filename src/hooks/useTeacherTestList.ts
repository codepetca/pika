import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { TEACHER_TESTS_UPDATED_EVENT } from '@/lib/events'
import { fetchJSONWithCache } from '@/lib/request-cache'
import { readTestsFromPayload } from '@/lib/test-api-contract'
import { applyTestSummaryPatchToTest } from '@/lib/test-summary-patch'
import type { AssessmentEditorSummaryUpdate, TestAssessmentWithStats } from '@/types'

type TeacherTestListResponse = {
  tests?: TestAssessmentWithStats[]
  /** Legacy compatibility key retained by active Tests APIs during contract migration. */
  quizzes?: TestAssessmentWithStats[]
}

type UseTeacherTestListOptions = {
  classroomId: string
  selectedTestId: string | null
  selectedTestDraftSummary: AssessmentEditorSummaryUpdate | null
  apiBasePath?: string
}

export type UseTeacherTestListResult = {
  tests: TestAssessmentWithStats[]
  setTests: Dispatch<SetStateAction<TestAssessmentWithStats[]>>
  visibleTests: TestAssessmentWithStats[]
  loading: boolean
  loadTests: () => Promise<void>
}

export function useTeacherTestList({
  classroomId,
  selectedTestId,
  selectedTestDraftSummary,
  apiBasePath = '/api/teacher/tests',
}: UseTeacherTestListOptions): UseTeacherTestListResult {
  const latestRequestIdRef = useRef(0)
  const currentClassroomIdRef = useRef(classroomId)
  const selectedTestIdRef = useRef<string | null>(selectedTestId)
  const selectedTestDraftSummaryRef = useRef<AssessmentEditorSummaryUpdate | null>(selectedTestDraftSummary)

  const [tests, setTests] = useState<TestAssessmentWithStats[]>([])
  const [loadedTestsClassroomId, setLoadedTestsClassroomId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  currentClassroomIdRef.current = classroomId

  const hasCurrentTests = loadedTestsClassroomId === classroomId
  const visibleTests = useMemo(
    () => (hasCurrentTests ? tests : []),
    [hasCurrentTests, tests],
  )

  const loadTests = useCallback(async () => {
    const requestId = latestRequestIdRef.current + 1
    latestRequestIdRef.current = requestId
    const requestedClassroomId = classroomId
    const isCurrentRequest = () => (
      latestRequestIdRef.current === requestId &&
      currentClassroomIdRef.current === requestedClassroomId
    )

    setLoading(true)
    try {
      const query = new URLSearchParams({ classroom_id: requestedClassroomId })
      const data = await fetchJSONWithCache<TeacherTestListResponse>(
        `teacher-tests:${requestedClassroomId}`,
        async () => {
          const response = await fetch(`${apiBasePath}?${query.toString()}`)
          const payload = await response.json()
          if (!response.ok) throw new Error(payload.error || 'Failed to load tests')
          return payload
        },
        0,
      )
      if (!isCurrentRequest()) return

      const loadedTests = readTestsFromPayload<TestAssessmentWithStats>(data)
      const currentSelectedTestId = selectedTestIdRef.current
      const currentDraftSummary = selectedTestDraftSummaryRef.current
      setTests(
        currentSelectedTestId && currentDraftSummary
          ? loadedTests.map((test) =>
              test.id === currentSelectedTestId
                ? applyTestSummaryPatchToTest(test, currentDraftSummary)
                : test
            )
          : loadedTests,
      )
      setLoadedTestsClassroomId(requestedClassroomId)
    } catch (error) {
      if (!isCurrentRequest()) return
      console.error('Error loading tests:', error)
      setTests([])
      setLoadedTestsClassroomId(requestedClassroomId)
    } finally {
      if (isCurrentRequest()) {
        setLoading(false)
      }
    }
  }, [apiBasePath, classroomId])

  useEffect(() => {
    selectedTestIdRef.current = selectedTestId
  }, [selectedTestId])

  useEffect(() => {
    selectedTestDraftSummaryRef.current = selectedTestDraftSummary
  }, [selectedTestDraftSummary])

  useEffect(() => {
    void loadTests()
  }, [loadTests])

  useEffect(() => {
    function handleTestsUpdated(event: Event) {
      const detail = (event as CustomEvent<{ classroomId?: string }>).detail
      if (!detail || detail.classroomId !== classroomId) return
      void loadTests()
    }

    window.addEventListener(TEACHER_TESTS_UPDATED_EVENT, handleTestsUpdated)
    return () => window.removeEventListener(TEACHER_TESTS_UPDATED_EVENT, handleTestsUpdated)
  }, [classroomId, loadTests])

  return {
    tests,
    setTests,
    visibleTests,
    loading,
    loadTests,
  }
}
