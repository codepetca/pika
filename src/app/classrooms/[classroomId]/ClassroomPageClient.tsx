'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { TeacherClassroomView, TeacherAssignmentsMarkdownSidebar, type AssignmentViewMode } from './TeacherClassroomView'
import { assignmentsToMarkdown, markdownToAssignments } from '@/lib/assignment-markdown'
import { StudentTodayTab } from './StudentTodayTab'
import { StudentAssignmentsTab } from './StudentAssignmentsTab'
import { TeacherAttendanceTab } from './TeacherAttendanceTab'
import { TeacherRosterTab } from './TeacherRosterTab'
import { TeacherGradebookTab } from './TeacherGradebookTab'
import { TeacherSettingsTab } from './TeacherSettingsTab'
import { TeacherLessonCalendarTab, TeacherLessonCalendarSidebar, CalendarSidebarState } from './TeacherLessonCalendarTab'
import { StudentLessonCalendarTab } from './StudentLessonCalendarTab'
import { TeacherClassResourcesSidebar } from './TeacherClassResourcesSidebar'
import { TeacherResourcesTab } from './TeacherResourcesTab'
import { StudentClassResourcesSidebar } from './StudentClassResourcesSidebar'
import { StudentResourcesTab } from './StudentResourcesTab'
import { TeacherQuizzesTab } from './TeacherQuizzesTab'
import { TeacherTestsTab } from './TeacherTestsTab'
import { StudentQuizzesTab } from './StudentQuizzesTab'
import { StudentNotificationsProvider } from '@/components/StudentNotificationsProvider'
import { ClassDaysProvider } from '@/hooks/useClassDays'
import {
  ThreePanelProvider,
  ThreePanelShell,
  LeftSidebar,
  RightSidebar,
  MainContent,
  NavItems,
  useLayoutInitialState,
  useMobileDrawer,
  useRightSidebar,
} from '@/components/layout'
import { DESKTOP_BREAKPOINT, getRouteKeyFromTab } from '@/lib/layout-config'
import { RichTextViewer } from '@/components/editor'
import { Spinner } from '@/components/Spinner'
import {
  STUDENT_TEST_EXAM_MODE_CHANGE_EVENT,
  STUDENT_TEST_ROUTE_EXIT_ATTEMPT_EVENT,
  TEACHER_ASSIGNMENTS_UPDATED_EVENT,
  TEACHER_QUIZZES_UPDATED_EVENT,
} from '@/lib/events'
import { TeacherTestPreviewPage } from '@/components/TeacherTestPreviewPage'
import { ConfirmDialog, TabContentTransition } from '@/ui'
import { PageDensityProvider } from '@/components/PageLayout'
import { useMarkdownPreference } from '@/contexts/MarkdownPreferenceContext'
import { fetchJSONWithCache, prefetchJSON } from '@/lib/request-cache'
import { markClassroomTabSwitchReady, markClassroomTabSwitchStart } from '@/lib/classroom-ux-metrics'
import type {
  Classroom,
  LessonPlan,
  TiptapContent,
  Assignment,
  QuizWithStats,
} from '@/types'

interface UserInfo {
  id: string
  email: string
  role: 'student' | 'teacher'
  first_name?: string | null
  last_name?: string | null
}

interface SelectedAssignmentInstructions {
  title: string
  instructions: TiptapContent | string | null
}

interface ClassroomPageClientProps {
  classroom: Classroom
  user: UserInfo
  teacherClassrooms: Classroom[]
  initialTab?: string
  initialSearchParams?: Record<string, string | undefined>
}

type UpdateSearchOptions = {
  replace?: boolean
}

type UpdateSearchParamsFn = (
  updater: (params: URLSearchParams) => void,
  options?: UpdateSearchOptions
) => void

interface StudentTestExamModeDetail {
  classroomId?: string
  active?: boolean
  testId?: string | null
  testTitle?: string | null
  exitsCount?: number
  awayTotalSeconds?: number
}

interface PendingExamNavigation {
  targetLabel: string
  source: string
  nextTab: string | null
  navigate: () => void
}

export function ClassroomPageClient({
  classroom,
  user,
  teacherClassrooms,
  initialTab,
  initialSearchParams,
}: ClassroomPageClientProps) {
  const { leftSidebarExpanded } = useLayoutInitialState()

  const isTeacher = user.role === 'teacher'
  const isArchived = isTeacher && !!classroom.archived_at
  const basePath = `/classrooms/${classroom.id}`
  const defaultTab = isTeacher ? 'attendance' : 'today'
  const validTabs = useMemo(
    () =>
      isTeacher
        ? (['attendance', 'gradebook', 'assignments', 'quizzes', 'tests', 'calendar', 'resources', 'roster', 'settings'] as const)
        : (['today', 'assignments', 'quizzes', 'tests', 'calendar', 'resources'] as const),
    [isTeacher]
  )

  const [queryString, setQueryString] = useState(() => {
    const initial = new URLSearchParams()
    for (const [key, value] of Object.entries(initialSearchParams || {})) {
      if (value) initial.set(key, value)
    }
    if (!initial.get('tab') && initialTab) {
      initial.set('tab', initialTab)
    }
    return initial.toString()
  })
  const queryStringRef = useRef(queryString)

  useEffect(() => {
    queryStringRef.current = queryString
  }, [queryString])

  useEffect(() => {
    const syncFromLocation = () => {
      const fromLocation = new URLSearchParams(window.location.search)
      setQueryString(fromLocation.toString())
    }
    syncFromLocation()
    window.addEventListener('popstate', syncFromLocation)
    return () => window.removeEventListener('popstate', syncFromLocation)
  }, [])

  const updateSearchParams = useCallback<UpdateSearchParamsFn>(
    (updater, options = {}) => {
      const params = new URLSearchParams(queryStringRef.current)
      updater(params)
      const next = params.toString()
      if (next === queryStringRef.current) return

      const nextUrl = next ? `${basePath}?${next}` : basePath
      const nextState = window.history.state ? { ...window.history.state } : {}
      if (options.replace) {
        window.history.replaceState(nextState, '', nextUrl)
      } else {
        window.history.pushState(nextState, '', nextUrl)
      }
      queryStringRef.current = next
      setQueryString(next)
    },
    [basePath]
  )

  const activeSearchParams = useMemo(() => new URLSearchParams(queryString), [queryString])
  const tab = activeSearchParams.get('tab')
  const activeTab = (validTabs as readonly string[]).includes(tab ?? '') ? (tab as string) : defaultTab

  useEffect(() => {
    if ((validTabs as readonly string[]).includes(tab ?? '')) return
    updateSearchParams((params) => {
      params.set('tab', defaultTab)
    }, { replace: true })
  }, [defaultTab, tab, updateSearchParams, validTabs])

  // Determine route key for layout config
  const routeKey = getRouteKeyFromTab(activeTab, user.role)

  return (
    <ThreePanelProvider
      routeKey={routeKey}
      initialLeftExpanded={leftSidebarExpanded}
    >
      <ClassDaysProvider classroomId={classroom.id}>
        <ClassroomPageContent
          classroom={classroom}
          user={user}
          teacherClassrooms={teacherClassrooms}
          activeTab={activeTab}
          isArchived={isArchived}
          searchParams={activeSearchParams}
          updateSearchParams={updateSearchParams}
        />
      </ClassDaysProvider>
    </ThreePanelProvider>
  )
}

// Separate component to access ThreePanelProvider context
function ClassroomPageContent({
  classroom,
  user,
  teacherClassrooms,
  activeTab,
  isArchived,
  searchParams,
  updateSearchParams,
}: {
  classroom: Classroom
  user: UserInfo
  teacherClassrooms: Classroom[]
  activeTab: string
  isArchived: boolean
  searchParams: URLSearchParams
  updateSearchParams: UpdateSearchParamsFn
}) {
  const { openLeft, openRight, close: closeMobileDrawer } = useMobileDrawer()
  const { setWidth: setRightSidebarWidth, isOpen: isRightSidebarOpen, setOpen: setRightSidebarOpen } = useRightSidebar()
  const { showMarkdown } = useMarkdownPreference()
  const isTeacher = user.role === 'teacher'
  const assignmentIdParam = searchParams.get('assignmentId')
  const assignmentStudentIdParam = searchParams.get('assignmentStudentId')
  const quizIdParam = activeTab === 'quizzes' ? searchParams.get('quizId') : null
  const testIdParam = activeTab === 'tests' ? searchParams.get('testId') : null
  const rawTestModeParam = searchParams.get('testMode')
  const testModeParam =
    activeTab === 'tests' && (rawTestModeParam === 'authoring' || rawTestModeParam === 'grading')
      ? rawTestModeParam
      : null
  const testStudentIdParam = activeTab === 'tests' ? searchParams.get('testStudentId') : null
  const sectionParam = searchParams.get('section')
  const gradebookSectionParam = searchParams.get('gradebookSection')
  const [mountedTabs, setMountedTabs] = useState<Record<string, boolean>>(() => ({
    [activeTab]: true,
  }))
  const lastTabIntentRef = useRef<Record<string, number>>({})
  const scrollPositionsRef = useRef<Record<string, number>>({})
  const prevActiveTabRef = useRef(activeTab)
  const [studentTestExamMode, setStudentTestExamMode] = useState<{
    active: boolean
    testId: string | null
    testTitle: string | null
    exitsCount: number
    awayTotalSeconds: number
  }>({
    active: false,
    testId: null,
    testTitle: null,
    exitsCount: 0,
    awayTotalSeconds: 0,
  })
  const hideLeftRailForExamMode = !isTeacher && activeTab === 'tests' && studentTestExamMode.active

  const logStudentTestRouteExitAttempt = useCallback((
    source: string,
    metadata?: Record<string, unknown>,
    options?: { dedupe?: boolean }
  ) => {
    if (isTeacher) return
    window.dispatchEvent(
      new CustomEvent(STUDENT_TEST_ROUTE_EXIT_ATTEMPT_EVENT, {
        detail: {
          classroomId: classroom.id,
          source,
          metadata: metadata || null,
          dedupe: options?.dedupe === true,
        },
      })
    )
  }, [classroom.id, isTeacher])

  const requestExamModeNavigation = useCallback((pending: PendingExamNavigation) => {
    const examModeActive =
      !isTeacher &&
      activeTab === 'tests' &&
      studentTestExamMode.active

    const leavingTestsRoute = pending.nextTab == null || pending.nextTab !== 'tests'
    if (!examModeActive || !leavingTestsRoute) {
      pending.navigate()
      return true
    }

    logStudentTestRouteExitAttempt(pending.source, {
      blocked: true,
      target: pending.targetLabel,
      next_tab: pending.nextTab,
    })
    return false
  }, [activeTab, isTeacher, logStudentTestRouteExitAttempt, studentTestExamMode.active])

  const navigateInClassroom = useCallback<UpdateSearchParamsFn>(
    (updater, options) => {
      const previewParams = new URLSearchParams(searchParams.toString())
      updater(previewParams)
      const nextTab = previewParams.get('tab') ?? activeTab

      requestExamModeNavigation({
        targetLabel: `${nextTab} tab`,
        source: 'tab_navigation',
        nextTab,
        navigate: () => {
          updateSearchParams((params) => {
            updater(params)
          }, options)
        },
      })
    },
    [activeTab, requestExamModeNavigation, searchParams, updateSearchParams]
  )

  useEffect(() => {
    if (!isTeacher || activeTab !== 'tests') return

    const hasInvalidMode =
      rawTestModeParam !== null && rawTestModeParam !== 'authoring' && rawTestModeParam !== 'grading'
    const hasDanglingMode = !testIdParam && rawTestModeParam !== null
    const hasDanglingStudent =
      testStudentIdParam !== null && (!testIdParam || testModeParam !== 'grading')

    if (!hasInvalidMode && !hasDanglingMode && !hasDanglingStudent) return

    navigateInClassroom((params) => {
      if (!testIdParam) {
        params.delete('testMode')
        params.delete('testStudentId')
        return
      }

      if (hasInvalidMode) {
        params.delete('testMode')
      }
      if (testModeParam !== 'grading') {
        params.delete('testStudentId')
      }
    }, { replace: true })
  }, [
    activeTab,
    isTeacher,
    navigateInClassroom,
    rawTestModeParam,
    testIdParam,
    testModeParam,
    testStudentIdParam,
  ])

  useEffect(() => {
    if (isTeacher) return

    const handleExamModeChange = (event: Event) => {
      const detail = (event as CustomEvent<StudentTestExamModeDetail>).detail
      if (detail?.classroomId && detail.classroomId !== classroom.id) return
      setStudentTestExamMode({
        active: detail?.active === true,
        testId: detail?.testId || null,
        testTitle: detail?.active === true ? (detail?.testTitle || null) : null,
        exitsCount: detail?.active === true ? Math.max(0, Number(detail?.exitsCount || 0)) : 0,
        awayTotalSeconds:
          detail?.active === true ? Math.max(0, Number(detail?.awayTotalSeconds || 0)) : 0,
      })
    }

    window.addEventListener(STUDENT_TEST_EXAM_MODE_CHANGE_EVENT, handleExamModeChange)
    return () => {
      window.removeEventListener(STUDENT_TEST_EXAM_MODE_CHANGE_EVENT, handleExamModeChange)
    }
  }, [classroom.id, isTeacher])

  useEffect(() => {
    if (!hideLeftRailForExamMode) return
    closeMobileDrawer()
  }, [closeMobileDrawer, hideLeftRailForExamMode])

  const handleHomeNavigationAttempt = useCallback((href: string) => {
    return requestExamModeNavigation({
      targetLabel: 'home',
      source: 'home_navigation',
      nextTab: null,
      navigate: () => {
        window.location.assign(href)
      },
    })
  }, [requestExamModeNavigation])

  const handleClassroomNavigationAttempt = useCallback((href: string) => {
    return requestExamModeNavigation({
      targetLabel: 'another classroom',
      source: 'classroom_switch',
      nextTab: null,
      navigate: () => {
        window.location.assign(href)
      },
    })
  }, [requestExamModeNavigation])

  useEffect(() => {
    setMountedTabs((previous) => {
      if (previous[activeTab]) return previous
      return { ...previous, [activeTab]: true }
    })
  }, [activeTab])

  useEffect(() => {
    const previousTab = prevActiveTabRef.current
    scrollPositionsRef.current[previousTab] = window.scrollY
    prevActiveTabRef.current = activeTab
    const nextScrollTop = scrollPositionsRef.current[activeTab] ?? 0
    window.scrollTo({ top: nextScrollTop, left: 0, behavior: 'auto' })
  }, [activeTab])

  // State for selected assignment instructions (assignments tab)
  const [selectedAssignment, setSelectedAssignment] = useState<SelectedAssignmentInstructions | null>(null)

  // State for today's lesson plan (student today tab)
  const [todayLessonPlan, setTodayLessonPlan] = useState<LessonPlan | null>(null)

  // State for calendar sidebar (teacher calendar tab)
  const [calendarSidebarState, setCalendarSidebarState] = useState<CalendarSidebarState | null>(null)

  // State for selected quiz (teacher quizzes tab)
  const [selectedQuiz, setSelectedQuiz] = useState<QuizWithStats | null>(null)
  const [pendingAssessmentDelete, setPendingAssessmentDelete] = useState<{
    quiz: QuizWithStats
    responsesCount: number
  } | null>(null)
  const [isDeletingAssessment, setIsDeletingAssessment] = useState(false)
  const [teacherTestPreview, setTeacherTestPreview] = useState<{
    testId: string
    title: string | null
  } | null>(null)
  const [testsTabClickToken, setTestsTabClickToken] = useState(0)

  const handleSelectQuiz = useCallback((quiz: QuizWithStats | null) => {
    setSelectedQuiz(quiz)
  }, [])

  useEffect(() => {
    if (activeTab === 'quizzes' || activeTab === 'tests') {
      setSelectedQuiz(null)
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'tests') {
      setTeacherTestPreview(null)
    }
  }, [activeTab])

  useEffect(() => {
    if (!teacherTestPreview) return
    if (!selectedQuiz) return
    if (selectedQuiz.id === teacherTestPreview.testId) return
    setTeacherTestPreview(null)
  }, [selectedQuiz, teacherTestPreview])

  // State for markdown mode (teacher assignments tab - summary view only)
  const [assignmentViewMode, setAssignmentViewMode] = useState<AssignmentViewMode>('summary')
  const [assignmentEditMode, setAssignmentEditMode] = useState(false)
  const [isMarkdownMode, setIsMarkdownMode] = useState(false)
  const [markdownContent, setMarkdownContent] = useState('')
  const [markdownError, setMarkdownError] = useState<string | null>(null)
  const [markdownWarning, setMarkdownWarning] = useState<string | null>(null)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [markdownLoading, setMarkdownLoading] = useState(false)
  const [hasRichContent, setHasRichContent] = useState(false)
  const [assignmentsCache, setAssignmentsCache] = useState<Assignment[]>([])

  // Track previous states for detecting transitions
  const prevSidebarOpenRef = useRef(false)
  const prevAssignmentMarkdownAutoOpenReadyRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const markdownStaleRef = useRef(true) // Start stale so first open loads

  const handleSelectAssignment = useCallback((assignment: SelectedAssignmentInstructions | null) => {
    setSelectedAssignment(assignment)
  }, [])

  const handleSetLessonPlan = useCallback((plan: LessonPlan | null) => {
    setTodayLessonPlan(plan)
  }, [])

  const handleViewModeChange = useCallback((mode: AssignmentViewMode) => {
    setAssignmentViewMode(mode)
    if (mode === 'assignment') {
      setAssignmentEditMode(false)
      setIsMarkdownMode(false)
      // Abort any in-flight markdown load to prevent it from re-enabling markdown mode
      abortControllerRef.current?.abort()
    }
  }, [])

  // Load assignments and generate markdown content
  const loadAssignmentsMarkdown = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setMarkdownError(null)
    setMarkdownWarning(null)
    setWarningsAcknowledged(false)
    setMarkdownLoading(true)
    setIsMarkdownMode(true)

    try {
      const data = await fetchJSONWithCache<{ assignments?: Assignment[] }>(
        `teacher-assignments:${classroom.id}`,
        async () => {
          const res = await fetch(`/api/teacher/assignments?classroom_id=${classroom.id}`, {
            signal: abortController.signal,
          })
          if (!res.ok) throw new Error('Failed to load assignments')
          return res.json()
        },
        20_000,
      )
      const assignments = (data.assignments || []) as Assignment[]
      setAssignmentsCache(assignments)

      const result = assignmentsToMarkdown(assignments)
      setMarkdownContent(result.markdown)
      setHasRichContent(result.hasRichContent)
      setRightSidebarWidth('50%')
      markdownStaleRef.current = false
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      console.error('Error fetching assignments:', err)
      setMarkdownError('Failed to load assignments')
    } finally {
      setMarkdownLoading(false)
    }
  }, [classroom.id, setRightSidebarWidth])

  const openAssignmentsMarkdownPanel = useCallback(() => {
    if (!showMarkdown) return

    setRightSidebarWidth('50%')
    setRightSidebarOpen(true)
    if (typeof window !== 'undefined' && window.innerWidth < DESKTOP_BREAKPOINT) {
      openRight()
    }

    if (markdownStaleRef.current || !isMarkdownMode) {
      loadAssignmentsMarkdown()
    } else {
      setIsMarkdownMode(true)
    }
  }, [
    isMarkdownMode,
    loadAssignmentsMarkdown,
    openRight,
    showMarkdown,
    setRightSidebarOpen,
    setRightSidebarWidth,
  ])

  const handleAssignmentsEditModeChange = useCallback((active: boolean) => {
    setAssignmentEditMode(active)
  }, [])

  const assignmentMarkdownAutoOpenReady =
    showMarkdown && isTeacher && activeTab === 'assignments' && assignmentEditMode && assignmentViewMode === 'summary'

  // Detect sidebar close for assignments tab. Markdown mode opens by default when summary edit mode starts.
  useEffect(() => {
    const wasOpen = prevSidebarOpenRef.current
    prevSidebarOpenRef.current = isRightSidebarOpen

    if (!isTeacher || activeTab !== 'assignments') return

    if (!showMarkdown || !assignmentEditMode || assignmentViewMode !== 'summary') {
      setIsMarkdownMode(false)
      return
    }

    if (!isRightSidebarOpen && wasOpen) {
      setIsMarkdownMode(false)
    }
  }, [isRightSidebarOpen, isTeacher, activeTab, assignmentEditMode, assignmentViewMode, showMarkdown])

  useEffect(() => {
    const wasReady = prevAssignmentMarkdownAutoOpenReadyRef.current
    prevAssignmentMarkdownAutoOpenReadyRef.current = assignmentMarkdownAutoOpenReady

    if (!assignmentMarkdownAutoOpenReady || wasReady) return
    openAssignmentsMarkdownPanel()
  }, [assignmentMarkdownAutoOpenReady, openAssignmentsMarkdownPanel])

  useEffect(() => {
    if (!isTeacher || activeTab === 'assignments') return

    if (assignmentEditMode) {
      setAssignmentEditMode(false)
    }
    if (isMarkdownMode) {
      setIsMarkdownMode(false)
    }
    if (assignmentEditMode || isMarkdownMode) {
      abortControllerRef.current?.abort()
    }
    if (isMarkdownMode && isRightSidebarOpen) {
      setRightSidebarOpen(false)
      closeMobileDrawer()
    }
  }, [
    activeTab,
    assignmentEditMode,
    closeMobileDrawer,
    isMarkdownMode,
    isRightSidebarOpen,
    isTeacher,
    setRightSidebarOpen,
  ])

  useEffect(() => {
    if (!isTeacher || activeTab !== 'assignments') return
    if (showMarkdown && assignmentEditMode && assignmentViewMode === 'summary') return

    if (isMarkdownMode) {
      setIsMarkdownMode(false)
    }
    abortControllerRef.current?.abort()
    if (isRightSidebarOpen) {
      setRightSidebarOpen(false)
      closeMobileDrawer()
    }
  }, [
    activeTab,
    assignmentEditMode,
    assignmentViewMode,
    closeMobileDrawer,
    isMarkdownMode,
    isRightSidebarOpen,
    isTeacher,
    showMarkdown,
    setRightSidebarOpen,
  ])

  // Refresh markdown when assignments are updated
  useEffect(() => {
    if (!showMarkdown || !isTeacher || activeTab !== 'assignments' || assignmentViewMode !== 'summary' || !assignmentEditMode || !isMarkdownMode) return

    const handleAssignmentsUpdated = () => {
      markdownStaleRef.current = true
      loadAssignmentsMarkdown()
    }

    window.addEventListener(TEACHER_ASSIGNMENTS_UPDATED_EVENT, handleAssignmentsUpdated)
    return () => {
      window.removeEventListener(TEACHER_ASSIGNMENTS_UPDATED_EVENT, handleAssignmentsUpdated)
    }
  }, [showMarkdown, isTeacher, activeTab, assignmentEditMode, assignmentViewMode, isMarkdownMode, loadAssignmentsMarkdown])

  const handleMarkdownContentChange = useCallback((content: string) => {
    setMarkdownContent(content)
    setMarkdownError(null)
    setMarkdownWarning(null)
    setWarningsAcknowledged(false)
  }, [])

  const handleMarkdownSave = useCallback(async () => {
    setMarkdownError(null)
    setBulkSaving(true)

    try {
      const result = markdownToAssignments(markdownContent, assignmentsCache)

      if (result.errors.length > 0) {
        setMarkdownError(result.errors.join('\n'))
        setBulkSaving(false)
        return
      }

      if (result.warnings.length > 0 && !warningsAcknowledged) {
        setMarkdownWarning(result.warnings.join('\n'))
        setBulkSaving(false)
        return
      }

      const res = await fetch('/api/teacher/assignments/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroom.id,
          assignments: result.assignments,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setMarkdownError(data.errors?.join('\n') || data.error || 'Failed to save')
        setBulkSaving(false)
        return
      }

      setIsMarkdownMode(false)
      setRightSidebarOpen(false)
      setMarkdownWarning(null)
      setWarningsAcknowledged(false)

      window.dispatchEvent(
        new CustomEvent(TEACHER_ASSIGNMENTS_UPDATED_EVENT, {
          detail: { classroomId: classroom.id },
        })
      )
    } catch (err) {
      console.error('Error saving assignments:', err)
      setMarkdownError('Failed to save assignments')
    } finally {
      setBulkSaving(false)
    }
  }, [markdownContent, assignmentsCache, classroom.id, setRightSidebarOpen, warningsAcknowledged])

  const handleAcknowledgeWarnings = useCallback(() => {
    setWarningsAcknowledged(true)
  }, [])

  useEffect(() => {
    if (isTeacher && activeTab === 'assignments') {
      setRightSidebarWidth('50%')
    } else if (activeTab === 'resources') {
      setRightSidebarWidth('50%')
    }
  }, [
    isTeacher,
    activeTab,
    setRightSidebarWidth,
  ])

  useEffect(() => {
    if (!isTeacher || activeTab !== 'assignments') return
    if (assignmentViewMode !== 'assignment') return
    setIsMarkdownMode(false)
    setRightSidebarOpen(false)
    closeMobileDrawer()
  }, [
    isTeacher,
    activeTab,
    assignmentViewMode,
    setRightSidebarOpen,
    closeMobileDrawer,
  ])

  useEffect(() => {
    if (activeTab === 'roster') {
      setRightSidebarOpen(false)
    }
  }, [activeTab, setRightSidebarOpen])

  const prefetchTabData = useCallback((tab: string) => {
    const now = Date.now()
    const lastIntentAt = lastTabIntentRef.current[tab] || 0
    if (now - lastIntentAt < 500) return
    lastTabIntentRef.current[tab] = now

    const runPrefetch = () => {
      if (tab === 'assignments') {
        if (isTeacher) {
          prefetchJSON(
            `teacher-assignments:${classroom.id}`,
            async () => {
              const response = await fetch(`/api/teacher/assignments?classroom_id=${classroom.id}`)
              if (!response.ok) throw new Error('Prefetch failed')
              return response.json()
            },
            20_000,
          )
        } else {
          prefetchJSON(
            `student-assignments:${classroom.id}`,
            async () => {
              const response = await fetch(`/api/student/assignments?classroom_id=${classroom.id}`)
              if (!response.ok) throw new Error('Prefetch failed')
              return response.json()
            },
            20_000,
          )
        }
      }

      if (tab === 'resources') {
        if (isTeacher) {
          prefetchJSON(
            `teacher-resources:${classroom.id}`,
            async () => {
              const response = await fetch(`/api/teacher/classrooms/${classroom.id}/resources`)
              if (!response.ok) throw new Error('Prefetch failed')
              return response.json()
            },
            20_000,
          )
          prefetchJSON(
            `teacher-announcements:${classroom.id}`,
            async () => {
              const response = await fetch(`/api/teacher/classrooms/${classroom.id}/announcements`)
              if (!response.ok) throw new Error('Prefetch failed')
              return response.json()
            },
            20_000,
          )
        } else {
          prefetchJSON(
            `student-resources:${classroom.id}`,
            async () => {
              const response = await fetch(`/api/student/classrooms/${classroom.id}/resources`)
              if (!response.ok) throw new Error('Prefetch failed')
              return response.json()
            },
            20_000,
          )
          prefetchJSON(
            `student-announcements:${classroom.id}`,
            async () => {
              const response = await fetch(`/api/student/classrooms/${classroom.id}/announcements`)
              if (!response.ok) throw new Error('Prefetch failed')
              return response.json()
            },
            20_000,
          )
        }
      }
    }

    runPrefetch()
  }, [classroom.id, isTeacher])

  useEffect(() => {
    const idleCallback = (window as any).requestIdleCallback as ((cb: () => void, opts?: { timeout: number }) => number) | undefined
    if (idleCallback) {
      const id = idleCallback(
        () => {
          prefetchTabData('assignments')
          prefetchTabData('resources')
        },
        { timeout: 1200 },
      )
      return () => {
        const cancelIdleCallback = (window as any).cancelIdleCallback as ((idleId: number) => void) | undefined
        cancelIdleCallback?.(id)
      }
    }

    const timer = window.setTimeout(() => {
      prefetchTabData('assignments')
      prefetchTabData('resources')
    }, 350)
    return () => window.clearTimeout(timer)
  }, [prefetchTabData])

  const handleTabChange = useCallback(
    (tab: string) => {
      if (tab === 'tests') {
        setTestsTabClickToken((prev) => prev + 1)
      }
      markClassroomTabSwitchStart(tab)
      navigateInClassroom((params) => {
        params.set('tab', tab)
        if (tab !== 'assignments') {
          params.delete('assignmentId')
          params.delete('assignmentStudentId')
        }
        if (tab !== 'resources' && tab !== 'settings') {
          params.delete('section')
        }
        if (tab !== 'tests' || activeTab === 'tests') {
          params.delete('testId')
          params.delete('testMode')
          params.delete('testStudentId')
        }
        if (tab !== 'quizzes' || activeTab === 'quizzes') {
          params.delete('quizId')
        }
      })
      window.requestAnimationFrame(() => {
        markClassroomTabSwitchReady(tab)
      })
    },
    [activeTab, navigateInClassroom]
  )

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      markClassroomTabSwitchReady(activeTab)
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [activeTab])

  const isAssessmentTab = activeTab === 'quizzes' || activeTab === 'tests'
  const assessmentLabel = activeTab === 'tests' ? 'test' : 'quiz'
  const assessmentApiBasePath = activeTab === 'tests' ? '/api/teacher/tests' : '/api/teacher/quizzes'
  const pendingAssessmentLabel = pendingAssessmentDelete?.quiz.assessment_type === 'test' ? 'test' : 'quiz'
  const examHeaderData = useMemo(() => {
    if (
      isTeacher ||
      activeTab !== 'tests' ||
      !studentTestExamMode.active ||
      !studentTestExamMode.testTitle
    ) {
      return null
    }

    return {
      testTitle: studentTestExamMode.testTitle,
      exitsCount: studentTestExamMode.exitsCount,
      awayTotalSeconds: studentTestExamMode.awayTotalSeconds,
    }
  }, [
    activeTab,
    isTeacher,
    studentTestExamMode.active,
    studentTestExamMode.awayTotalSeconds,
    studentTestExamMode.exitsCount,
    studentTestExamMode.testTitle,
  ])
  const pageDensity = isTeacher ? 'teacher' : 'student'
  const mainContentClassName =
    activeTab === 'calendar'
      ? 'px-0 pt-0 pb-0'
      : activeTab === 'tests'
        ? 'pb-0'
        : ''

  async function handleRequestAssessmentDelete() {
    if (!selectedQuiz) return

    try {
      const data = await fetchJSONWithCache<{ stats?: { responded?: number } }>(
        `teacher-assessment-results:${assessmentLabel}:${selectedQuiz.id}`,
        async () => {
          const res = await fetch(`${assessmentApiBasePath}/${selectedQuiz.id}/results`)
          if (!res.ok) throw new Error('Failed to load assessment results')
          return res.json()
        },
        0,
      )
      setPendingAssessmentDelete({
        quiz: selectedQuiz,
        responsesCount: Number(data?.stats?.responded || 0),
      })
    } catch {
      setPendingAssessmentDelete({
        quiz: selectedQuiz,
        responsesCount: Number(selectedQuiz.stats.responded || 0),
      })
    }
  }

  async function handleConfirmAssessmentDelete() {
    if (!pendingAssessmentDelete) return

    const deleteIsTest = pendingAssessmentDelete.quiz.assessment_type === 'test'
    const deleteApiBasePath = deleteIsTest ? '/api/teacher/tests' : '/api/teacher/quizzes'
    const deleteLabel = deleteIsTest ? 'test' : 'quiz'

    setIsDeletingAssessment(true)
    try {
      const res = await fetch(`${deleteApiBasePath}/${pendingAssessmentDelete.quiz.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `Failed to delete ${deleteLabel}`)
      }

      setSelectedQuiz(null)
      navigateInClassroom((params) => {
        if (deleteIsTest) {
          params.delete('testId')
          params.delete('testMode')
          params.delete('testStudentId')
        } else {
          params.delete('quizId')
        }
      }, { replace: true })
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
      )
      setPendingAssessmentDelete(null)
    } catch (error) {
      console.error(`Error deleting ${deleteLabel}:`, error)
    } finally {
      setIsDeletingAssessment(false)
    }
  }

  const content = (
    <AppShell
      user={user}
      classrooms={
        isTeacher
          ? teacherClassrooms.map((c) => ({
              id: c.id,
              title: c.title,
              code: c.class_code,
            }))
          : [
              {
                id: classroom.id,
                title: classroom.title,
                code: classroom.class_code,
              },
            ]
      }
      currentClassroomId={classroom.id}
      currentTab={activeTab}
      onOpenSidebar={hideLeftRailForExamMode ? undefined : openLeft}
      onNavigateHome={handleHomeNavigationAttempt}
      onNavigateClassroom={handleClassroomNavigationAttempt}
      mainClassName="max-w-none px-0 py-0"
      examModeHeader={examHeaderData}
    >
      <ThreePanelShell leftWidthOverride={hideLeftRailForExamMode ? 0 : undefined}>
        {hideLeftRailForExamMode ? (
          <div aria-hidden="true" className="hidden lg:block" />
        ) : (
          <LeftSidebar>
            <NavItems
              classroomId={classroom.id}
              role={user.role}
              activeTab={activeTab}
              onTabChange={handleTabChange}
              onTabIntent={prefetchTabData}
              updateSearchParams={navigateInClassroom}
            />
          </LeftSidebar>
        )}

        <MainContent density={pageDensity} className={mainContentClassName}>
          <PageDensityProvider density={pageDensity}>
            {isArchived && (
              <div className="mb-3 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
                This classroom is archived. You can view content, but changes are
                disabled until it is restored.
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col">
              {isTeacher ? (
                <>
                  {mountedTabs.attendance && (
                    <TabContentTransition isActive={activeTab === 'attendance'}>
                      <TeacherAttendanceTab
                        classroom={classroom}
                        isActive={activeTab === 'attendance'}
                      />
                    </TabContentTransition>
                  )}
                  {mountedTabs.gradebook && (
                    <TabContentTransition isActive={activeTab === 'gradebook'}>
                      <TeacherGradebookTab
                        classroom={classroom}
                        sectionParam={gradebookSectionParam}
                        onSectionChange={(section) =>
                          navigateInClassroom((params) => {
                            params.set('tab', 'gradebook')
                            params.set('gradebookSection', section)
                          })
                        }
                      />
                    </TabContentTransition>
                  )}
                  {mountedTabs.assignments && (
                    <TabContentTransition isActive={activeTab === 'assignments'}>
                      <TeacherClassroomView
                        classroom={classroom}
                        onSelectAssignment={handleSelectAssignment}
                        onViewModeChange={handleViewModeChange}
                        onEditModeChange={handleAssignmentsEditModeChange}
                        isActive={activeTab === 'assignments'}
                        selectedAssignmentId={assignmentIdParam}
                        selectedAssignmentStudentId={assignmentStudentIdParam}
                        updateSearchParams={navigateInClassroom}
                      />
                    </TabContentTransition>
                  )}
                  {mountedTabs.quizzes && (
                    <TabContentTransition isActive={activeTab === 'quizzes'}>
                      <TeacherQuizzesTab
                        classroom={classroom}
                        assessmentType="quiz"
                        selectedQuizId={quizIdParam}
                        updateSearchParams={navigateInClassroom}
                        onSelectQuiz={handleSelectQuiz}
                        onRequestDelete={() => {
                          void handleRequestAssessmentDelete()
                        }}
                      />
                    </TabContentTransition>
                  )}
                  {mountedTabs.tests && (
                    <TabContentTransition isActive={activeTab === 'tests'}>
                      <TeacherTestsTab
                        classroom={classroom}
                        testsTabClickToken={testsTabClickToken}
                        selectedTestId={testIdParam}
                        selectedTestMode={testModeParam}
                        selectedTestStudentId={testStudentIdParam}
                        updateSearchParams={navigateInClassroom}
                        onSelectTest={handleSelectQuiz}
                        onRequestDelete={() => {
                          void handleRequestAssessmentDelete()
                        }}
                      />
                    </TabContentTransition>
                  )}
                  {mountedTabs.calendar && (
                    <TabContentTransition isActive={activeTab === 'calendar'}>
                      <TeacherLessonCalendarTab
                        classroom={classroom}
                        onSidebarStateChange={setCalendarSidebarState}
                        onNavigateToAssignments={(assignmentId) =>
                          navigateInClassroom((params) => {
                            params.set('tab', 'assignments')
                            if (assignmentId) {
                              params.set('assignmentId', assignmentId)
                            } else {
                              params.delete('assignmentId')
                            }
                            params.delete('assignmentStudentId')
                          })
                        }
                        onNavigateToAnnouncements={() =>
                          navigateInClassroom((params) => {
                            params.set('tab', 'resources')
                            params.delete('section')
                            params.delete('assignmentId')
                            params.delete('assignmentStudentId')
                          })
                        }
                      />
                    </TabContentTransition>
                  )}
                  {mountedTabs.resources && (
                    <TabContentTransition isActive={activeTab === 'resources'}>
                      <TeacherResourcesTab classroom={classroom} />
                    </TabContentTransition>
                  )}
                  {mountedTabs.roster && (
                    <TabContentTransition isActive={activeTab === 'roster'}>
                      <TeacherRosterTab classroom={classroom} />
                    </TabContentTransition>
                  )}
                  {mountedTabs.settings && (
                    <TabContentTransition isActive={activeTab === 'settings'}>
                      <TeacherSettingsTab
                        classroom={classroom}
                        sectionParam={sectionParam}
                        onSectionChange={(section) =>
                          navigateInClassroom((params) => {
                            params.set('tab', 'settings')
                            params.set('section', section)
                          })
                        }
                      />
                    </TabContentTransition>
                  )}
                </>
              ) : (
                <>
                  {mountedTabs.today && (
                    <TabContentTransition isActive={activeTab === 'today'}>
                      <StudentTodayTab
                        classroom={classroom}
                        onLessonPlanLoad={handleSetLessonPlan}
                      />
                    </TabContentTransition>
                  )}
                  {mountedTabs.assignments && (
                    <TabContentTransition isActive={activeTab === 'assignments'}>
                      <StudentAssignmentsTab
                        classroom={classroom}
                        selectedAssignmentId={assignmentIdParam}
                        isActive={activeTab === 'assignments'}
                        updateSearchParams={navigateInClassroom}
                      />
                    </TabContentTransition>
                  )}
                  {mountedTabs.quizzes && (
                    <TabContentTransition isActive={activeTab === 'quizzes'}>
                      <StudentQuizzesTab classroom={classroom} assessmentType="quiz" isActive={activeTab === 'quizzes'} />
                    </TabContentTransition>
                  )}
                  {mountedTabs.tests && (
                    <TabContentTransition isActive={activeTab === 'tests'}>
                      <StudentQuizzesTab classroom={classroom} assessmentType="test" isActive={activeTab === 'tests'} />
                    </TabContentTransition>
                  )}
                  {mountedTabs.calendar && (
                    <TabContentTransition isActive={activeTab === 'calendar'}>
                      <StudentLessonCalendarTab
                        classroom={classroom}
                        onNavigateToAssignments={(assignmentId) =>
                          navigateInClassroom((params) => {
                            params.set('tab', 'assignments')
                            if (assignmentId) {
                              params.set('assignmentId', assignmentId)
                            } else {
                              params.delete('assignmentId')
                            }
                            params.delete('assignmentStudentId')
                          })
                        }
                        onNavigateToAnnouncements={() =>
                          navigateInClassroom((params) => {
                            params.set('tab', 'resources')
                            params.delete('section')
                            params.delete('assignmentId')
                          })
                        }
                      />
                    </TabContentTransition>
                  )}
                  {mountedTabs.resources && (
                    <TabContentTransition isActive={activeTab === 'resources'}>
                      <StudentResourcesTab classroom={classroom} />
                    </TabContentTransition>
                  )}
                </>
              )}
            </div>
          </PageDensityProvider>
        </MainContent>

        <RightSidebar
          hideDesktopHeader={activeTab === 'resources'}
          minimalMobileHeader={activeTab === 'resources'}
          title={
            showMarkdown && isTeacher && activeTab === 'assignments' && isMarkdownMode
              ? 'Assignments'
              : isTeacher && activeTab === 'calendar' && calendarSidebarState
              ? 'Calendar'
              : isTeacher && isAssessmentTab
              ? ''
              : isTeacher && activeTab === 'assignments'
              ? ''
              : activeTab === 'resources'
              ? 'Class Resources'
              : activeTab === 'assignments'
              ? (selectedAssignment?.title || 'Instructions')
              : activeTab === 'today'
              ? "Today's Plan"
              : 'Details'
          }
          headerActions={
            showMarkdown && isTeacher && activeTab === 'assignments' && isMarkdownMode ? (
              markdownWarning && !warningsAcknowledged ? (
                <button
                  type="button"
                  onClick={() => {
                    handleAcknowledgeWarnings()
                    setTimeout(handleMarkdownSave, 0)
                  }}
                  disabled={bulkSaving}
                  className="px-2 py-1 text-xs rounded bg-warning text-text-inverse hover:opacity-90 disabled:opacity-50"
                >
                  Save Anyway
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleMarkdownSave}
                  disabled={bulkSaving}
                  className="px-2 py-1 text-xs rounded bg-primary text-text-inverse hover:bg-primary-hover disabled:opacity-50"
                >
                  {bulkSaving ? 'Saving...' : 'Save'}
                </button>
              )
            ) : isTeacher && activeTab === 'calendar' && calendarSidebarState ? (
              <button
                type="button"
                onClick={calendarSidebarState.onSave}
                disabled={calendarSidebarState.bulkSaving}
                className="px-2 py-1 text-xs rounded bg-primary text-text-inverse hover:bg-primary-hover disabled:opacity-50"
              >
                {calendarSidebarState.bulkSaving ? 'Saving...' : 'Save'}
              </button>
            ) : undefined
          }
        >
          {showMarkdown && isTeacher && activeTab === 'assignments' && isMarkdownMode ? (
            markdownLoading ? (
              <div className="flex items-center justify-center h-32">
                <Spinner />
              </div>
            ) : (
              <TeacherAssignmentsMarkdownSidebar
                markdownContent={markdownContent}
                markdownError={markdownError}
                markdownWarning={markdownWarning}
                hasRichContent={hasRichContent}
                bulkSaving={bulkSaving}
                onMarkdownChange={handleMarkdownContentChange}
                onSave={handleMarkdownSave}
              />
            )
          ) : isTeacher && activeTab === 'calendar' && calendarSidebarState ? (
            <TeacherLessonCalendarSidebar {...calendarSidebarState} />
          ) : isTeacher && activeTab === 'resources' ? (
            <TeacherClassResourcesSidebar classroom={classroom} />
          ) : activeTab === 'resources' ? (
            <StudentClassResourcesSidebar classroom={classroom} />
          ) : isTeacher && isAssessmentTab ? (
            null
          ) : isTeacher && activeTab === 'assignments' ? (
            <div className="p-4">
              <p className="text-sm text-text-muted">Use the assignment workspace to review student work.</p>
            </div>
          ) : activeTab === 'assignments' ? (
            <div>
              {selectedAssignment ? (
                selectedAssignment.instructions ? (
                  typeof selectedAssignment.instructions === 'string' ? (
                    <p className="text-sm text-text-default whitespace-pre-wrap">
                      {selectedAssignment.instructions}
                    </p>
                  ) : (
                    <RichTextViewer content={selectedAssignment.instructions} />
                  )
                ) : (
                  <p className="text-sm text-text-muted">
                    No instructions provided.
                  </p>
                )
              ) : (
                <p className="text-sm text-text-muted">
                  Select an assignment to view instructions.
                </p>
              )}
            </div>
          ) : activeTab === 'today' ? (
            <div className="p-4">
              {todayLessonPlan?.content &&
              todayLessonPlan.content.content &&
              todayLessonPlan.content.content.length > 0 ? (
                <RichTextViewer content={todayLessonPlan.content} />
              ) : (
                <p className="text-sm text-text-muted">
                  No lesson plan for today.
                </p>
              )}
            </div>
          ) : (
            <div className="p-4 text-sm text-text-muted">
              Inspector panel content will be added in a future update.
            </div>
          )}
        </RightSidebar>
      </ThreePanelShell>

      <ConfirmDialog
        isOpen={!!pendingAssessmentDelete}
        title={`Delete ${pendingAssessmentLabel}?`}
        description={
          pendingAssessmentDelete && pendingAssessmentDelete.responsesCount > 0
            ? `This ${pendingAssessmentLabel} has ${pendingAssessmentDelete.responsesCount} response${pendingAssessmentDelete.responsesCount === 1 ? '' : 's'}. Deleting it will permanently remove all student responses.`
            : 'This action cannot be undone.'
        }
        confirmLabel={isDeletingAssessment ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        confirmVariant="danger"
        isConfirmDisabled={isDeletingAssessment}
        isCancelDisabled={isDeletingAssessment}
        onCancel={() => setPendingAssessmentDelete(null)}
        onConfirm={() => {
          void handleConfirmAssessmentDelete()
        }}
      />

      {isTeacher && activeTab === 'tests' && teacherTestPreview ? (
        <TeacherTestPreviewPage
          classroomId={classroom.id}
          testId={teacherTestPreview.testId}
          embedded
          listenForUpdates
          onClose={() => {
            setTeacherTestPreview(null)
          }}
        />
      ) : null}

    </AppShell>
  )

  if (!isTeacher) {
    return (
      <StudentNotificationsProvider classroomId={classroom.id}>
        {content}
      </StudentNotificationsProvider>
    )
  }

  return content
}
