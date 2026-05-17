'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { AppShell } from '@/components/AppShell'
import { TeacherClassroomView, TeacherAssignmentsMarkdownEditor, type AssignmentViewMode } from './TeacherClassroomView'
import { assignmentsToMarkdown, markdownToAssignments } from '@/lib/assignment-markdown'
import { StudentTodayTab } from './StudentTodayTab'
import { StudentAssignmentsTab } from './StudentAssignmentsTab'
import { TeacherAttendanceTab } from './TeacherAttendanceTab'
import { TeacherRosterTab } from './TeacherRosterTab'
import { TeacherGradebookTab } from './TeacherGradebookTab'
import { TeacherSettingsTab } from './TeacherSettingsTab'
import { TeacherLessonCalendarTab, TeacherLessonCalendarSidebar, CalendarSidebarState } from './TeacherLessonCalendarTab'
import { StudentLessonCalendarTab } from './StudentLessonCalendarTab'
import { TeacherResourcesTab } from './TeacherResourcesTab'
import { StudentResourcesTab } from './StudentResourcesTab'
import { TeacherAnnouncementsTab } from './TeacherAnnouncementsTab'
import { StudentAnnouncementsTab } from './StudentAnnouncementsTab'
import { TeacherQuizzesTab } from './TeacherQuizzesTab'
import { TeacherTestsTab } from './TeacherTestsTab'
import { StudentQuizzesTab } from './StudentQuizzesTab'
import { StudentNotificationsProvider } from '@/components/StudentNotificationsProvider'
import { ClassDaysProvider, useClassDaysContext } from '@/hooks/useClassDays'
import { getMostRecentClassDayBefore } from '@/lib/class-days'
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
import { getRouteKeyFromTab } from '@/lib/layout-config'
import { RichTextViewer } from '@/components/editor'
import { Spinner } from '@/components/Spinner'
import {
  STUDENT_TEST_EXAM_MODE_CHANGE_EVENT,
  STUDENT_TEST_ROUTE_EXIT_ATTEMPT_EVENT,
  TEACHER_ASSIGNMENTS_UPDATED_EVENT,
  TEACHER_QUIZZES_UPDATED_EVENT,
} from '@/lib/events'
import { TeacherTestPreviewPage } from '@/components/TeacherTestPreviewPage'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import { Button, ConfirmDialog, DialogPanel, TabContentTransition } from '@/ui'
import { PageDensityProvider } from '@/components/PageLayout'
import { useMarkdownPreference } from '@/contexts/MarkdownPreferenceContext'
import { fetchJSONWithCache, invalidateCachedJSON, prefetchJSON } from '@/lib/request-cache'
import { markClassroomTabSwitchReady, markClassroomTabSwitchStart } from '@/lib/classroom-ux-metrics'
import { getTodayInToronto } from '@/lib/timezone'
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
        ? (['attendance', 'gradebook', 'assignments', 'quizzes', 'tests', 'calendar', 'resources', 'announcements', 'roster', 'settings'] as const)
        : (['today', 'assignments', 'quizzes', 'tests', 'calendar', 'resources', 'announcements'] as const),
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

function hasLessonPlanContent(plan: LessonPlan | null) {
  return Boolean(
    plan?.content &&
    plan.content.content &&
    plan.content.content.length > 0
  )
}

function getLastClassHeading(lastClassDate: string | null) {
  if (!lastClassDate) return 'Last class'

  const daysAgo = differenceInCalendarDays(
    parseISO(getTodayInToronto()),
    parseISO(lastClassDate)
  )

  return daysAgo === 1 ? 'Yesterday' : 'Last class'
}

function StudentTodayPlanSidebar({
  todayLessonPlan,
  lastClassLessonPlan,
  lastClassDate,
  lastClassLoading,
}: {
  todayLessonPlan: LessonPlan | null
  lastClassLessonPlan: LessonPlan | null
  lastClassDate: string | null
  lastClassLoading: boolean
}) {
  const viewerClassName = 'min-h-0 flex-1 overflow-y-auto [&_.simple-viewer-content_.tiptap.ProseMirror.simple-editor]:!p-0'
  const lastClassHeading = getLastClassHeading(lastClassDate)
  const missingLessonPlanLabel = lastClassHeading === 'Yesterday' ? 'yesterday' : 'last class'

  return (
    <div className="flex h-full min-h-0 flex-col divide-y divide-border">
      <section className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold text-text-default">Today</h3>
        {hasLessonPlanContent(todayLessonPlan) ? (
          <div className={viewerClassName}>
            <RichTextViewer content={todayLessonPlan!.content} chrome="flush" />
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            No lesson plan for today.
          </p>
        )}
      </section>

      <section className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-text-default">{lastClassHeading}</h3>
          {lastClassDate ? (
            <span className="text-xs text-text-muted">
              {format(parseISO(lastClassDate), 'EEE MMM d')}
            </span>
          ) : null}
        </div>
        {!lastClassDate ? (
          <p className="text-sm text-text-muted">
            No previous class day yet.
          </p>
        ) : lastClassLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : hasLessonPlanContent(lastClassLessonPlan) ? (
          <div className={viewerClassName}>
            <RichTextViewer content={lastClassLessonPlan!.content} chrome="flush" />
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            No lesson plan for {missingLessonPlanLabel}.
          </p>
        )}
      </section>
    </div>
  )
}

function StudentTodayWorkspace({
  classroom,
  todayLessonPlan,
  lastClassLessonPlan,
  lastClassDate,
  lastClassLoading,
  onLessonPlanLoad,
}: {
  classroom: Classroom
  todayLessonPlan: LessonPlan | null
  lastClassLessonPlan: LessonPlan | null
  lastClassDate: string | null
  lastClassLoading: boolean
  onLessonPlanLoad: (plan: LessonPlan | null) => void
}) {
  const [planPaneWidth, setPlanPaneWidth] = useState(34)

  return (
    <TeacherWorkspaceSplit
      className="flex-1 pt-2"
      splitVariant="gapped"
      primaryClassName="min-h-0"
      inspectorClassName="min-h-0 rounded-lg border border-border bg-surface"
      inspectorCollapsed={false}
      inspectorWidth={planPaneWidth}
      minInspectorPx={300}
      minPrimaryPx={480}
      minInspectorPercent={28}
      maxInspectorPercent={46}
      onInspectorWidthChange={setPlanPaneWidth}
      dividerLabel="Resize today and plan panes"
      primary={
        <StudentTodayTab
          classroom={classroom}
          layout="pane"
          onLessonPlanLoad={onLessonPlanLoad}
        />
      }
      inspector={
        <StudentTodayPlanSidebar
          todayLessonPlan={todayLessonPlan}
          lastClassLessonPlan={lastClassLessonPlan}
          lastClassDate={lastClassDate}
          lastClassLoading={lastClassLoading}
        />
      }
    />
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
  const { openLeft, close: closeMobileDrawer } = useMobileDrawer()
  const { setWidth: setRightSidebarWidth, isOpen: isRightSidebarOpen, setOpen: setRightSidebarOpen } = useRightSidebar()
  const { classDays } = useClassDaysContext()
  const { showMarkdown } = useMarkdownPreference()
  const isTeacher = user.role === 'teacher'
  const assignmentIdParam = searchParams.get('assignmentId')
  const materialIdParam = activeTab === 'assignments' ? searchParams.get('materialId') : null
  const surveyIdParam = activeTab === 'assignments' ? searchParams.get('surveyId') : null
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
  const [lastClassLessonPlan, setLastClassLessonPlan] = useState<LessonPlan | null>(null)
  const [lastClassLessonPlanDate, setLastClassLessonPlanDate] = useState<string | null>(null)
  const [lastClassLessonPlanLoading, setLastClassLessonPlanLoading] = useState(false)

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

  // State for markdown editing (teacher assignments tab - summary view only)
  const [assignmentViewMode, setAssignmentViewMode] = useState<AssignmentViewMode>('summary')
  const [assignmentEditMode, setAssignmentEditMode] = useState(false)
  const [isAssignmentMarkdownDialogOpen, setIsAssignmentMarkdownDialogOpen] = useState(false)
  const [markdownContent, setMarkdownContent] = useState('')
  const [markdownError, setMarkdownError] = useState<string | null>(null)
  const [markdownWarning, setMarkdownWarning] = useState<string | null>(null)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [markdownLoading, setMarkdownLoading] = useState(false)
  const [hasRichContent, setHasRichContent] = useState(false)
  const [assignmentsCache, setAssignmentsCache] = useState<Assignment[]>([])

  // Track previous states for detecting transitions
  const abortControllerRef = useRef<AbortController | null>(null)
  const markdownStaleRef = useRef(true) // Start stale so first open loads

  const handleSelectAssignment = useCallback((assignment: SelectedAssignmentInstructions | null) => {
    setSelectedAssignment(assignment)
  }, [])

  const handleSetLessonPlan = useCallback((plan: LessonPlan | null) => {
    setTodayLessonPlan(plan)
  }, [])

  useEffect(() => {
    if (isTeacher || activeTab !== 'today') return

    const todayDate = getTodayInToronto()
    const lastClassDate = getMostRecentClassDayBefore(classDays, todayDate)
    setLastClassLessonPlanDate(lastClassDate)

    if (!lastClassDate) {
      setLastClassLessonPlan(null)
      setLastClassLessonPlanLoading(false)
      return
    }

    let cancelled = false
    setLastClassLessonPlanLoading(true)
    fetchJSONWithCache<{ lesson_plans?: LessonPlan[]; lessonPlans?: LessonPlan[] }>(
      `student-today:last-class-plan:${classroom.id}:${lastClassDate}`,
      async () => {
        const response = await fetch(
          `/api/student/classrooms/${classroom.id}/lesson-plans?start=${lastClassDate}&end=${lastClassDate}`
        )
        if (!response.ok) throw new Error('Failed to load last class lesson plan')
        return response.json()
      },
      30_000
    )
      .then((data) => {
        if (cancelled) return
        const plans = data.lesson_plans || data.lessonPlans || []
        setLastClassLessonPlan(plans.find(plan => plan.date === lastClassDate) || null)
        setLastClassLessonPlanLoading(false)
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Error loading last class lesson plan:', error)
        setLastClassLessonPlan(null)
        setLastClassLessonPlanLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeTab, classDays, classroom.id, isTeacher])

  const handleViewModeChange = useCallback((mode: AssignmentViewMode) => {
    setAssignmentViewMode(mode)
    if (mode === 'assignment') {
      setAssignmentEditMode(false)
      setIsAssignmentMarkdownDialogOpen(false)
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
  }, [classroom.id])

  const closeAssignmentsMarkdownDialog = useCallback(() => {
    setIsAssignmentMarkdownDialogOpen(false)
  }, [])

  const openAssignmentsMarkdownDialog = useCallback(() => {
    if (!showMarkdown || assignmentViewMode !== 'summary') return

    setIsAssignmentMarkdownDialogOpen(true)
    if (markdownStaleRef.current || !markdownContent) {
      void loadAssignmentsMarkdown()
    }
  }, [
    assignmentViewMode,
    loadAssignmentsMarkdown,
    markdownContent,
    showMarkdown,
  ])

  const handleAssignmentsEditModeChange = useCallback((active: boolean) => {
    setAssignmentEditMode(active)
  }, [])

  useEffect(() => {
    if (!isTeacher || activeTab === 'assignments') return

    if (assignmentEditMode) {
      setAssignmentEditMode(false)
    }
    if (isAssignmentMarkdownDialogOpen) {
      setIsAssignmentMarkdownDialogOpen(false)
    }
    if (assignmentEditMode || isAssignmentMarkdownDialogOpen) {
      abortControllerRef.current?.abort()
    }
  }, [
    activeTab,
    assignmentEditMode,
    isAssignmentMarkdownDialogOpen,
    isTeacher,
  ])

  useEffect(() => {
    if (!isTeacher || activeTab !== 'assignments') return
    if (showMarkdown && assignmentViewMode === 'summary') return

    if (isAssignmentMarkdownDialogOpen) {
      setIsAssignmentMarkdownDialogOpen(false)
    }
    abortControllerRef.current?.abort()
  }, [
    activeTab,
    assignmentViewMode,
    isAssignmentMarkdownDialogOpen,
    isTeacher,
    showMarkdown,
  ])

  // Refresh markdown when assignments are updated
  useEffect(() => {
    if (!showMarkdown || !isTeacher || activeTab !== 'assignments' || assignmentViewMode !== 'summary' || !isAssignmentMarkdownDialogOpen) return

    const handleAssignmentsUpdated = () => {
      markdownStaleRef.current = true
      loadAssignmentsMarkdown()
    }

    window.addEventListener(TEACHER_ASSIGNMENTS_UPDATED_EVENT, handleAssignmentsUpdated)
    return () => {
      window.removeEventListener(TEACHER_ASSIGNMENTS_UPDATED_EVENT, handleAssignmentsUpdated)
    }
  }, [showMarkdown, isTeacher, activeTab, assignmentViewMode, isAssignmentMarkdownDialogOpen, loadAssignmentsMarkdown])

  const handleMarkdownContentChange = useCallback((content: string) => {
    setMarkdownContent(content)
    setMarkdownError(null)
    setMarkdownWarning(null)
    setWarningsAcknowledged(false)
  }, [])

  const handleMarkdownSave = useCallback(async (options?: { ignoreWarnings?: boolean }) => {
    setMarkdownError(null)
    setBulkSaving(true)

    try {
      const result = markdownToAssignments(markdownContent, assignmentsCache)

      if (result.errors.length > 0) {
        setMarkdownError(result.errors.join('\n'))
        setBulkSaving(false)
        return
      }

      if (result.warnings.length > 0 && !warningsAcknowledged && !options?.ignoreWarnings) {
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

      invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
      markdownStaleRef.current = true
      setIsAssignmentMarkdownDialogOpen(false)
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
  }, [markdownContent, assignmentsCache, classroom.id, warningsAcknowledged])

  useEffect(() => {
    if (isTeacher && activeTab === 'assignments') {
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
    setIsAssignmentMarkdownDialogOpen(false)
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
          prefetchJSON(
            `teacher-materials:${classroom.id}`,
            async () => {
              const response = await fetch(`/api/teacher/classrooms/${classroom.id}/materials`)
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
          prefetchJSON(
            `student-materials:${classroom.id}`,
            async () => {
              const response = await fetch(`/api/student/classrooms/${classroom.id}/materials`)
              if (!response.ok) throw new Error('Prefetch failed')
              return response.json()
            },
            20_000,
          )
        }
      }

      if (tab === 'announcements') {
        if (isTeacher) {
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
          prefetchTabData('announcements')
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
      prefetchTabData('announcements')
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
          params.delete('materialId')
          params.delete('surveyId')
          params.delete('assignmentStudentId')
        }
        if (tab !== 'settings') {
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
  const hasActiveTeacherSplitPanes =
    isTeacher &&
    (
      activeTab === 'attendance' ||
      activeTab === 'roster' ||
      (activeTab === 'gradebook' && gradebookSectionParam !== 'settings') ||
      (activeTab === 'assignments' && !!assignmentIdParam && !!assignmentStudentIdParam) ||
      (activeTab === 'tests' && !!testIdParam && testModeParam === 'grading' && !!testStudentIdParam)
    )
  const hasConstrainedWorkspace =
    hasActiveTeacherSplitPanes || (!isTeacher && activeTab === 'today')

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
      constrainToViewport={hasConstrainedWorkspace}
      examModeHeader={examHeaderData}
      pageTitle={undefined}
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
                        onOpenMarkdownEditor={openAssignmentsMarkdownDialog}
                        showMarkdownEditorOption={showMarkdown && assignmentViewMode === 'summary'}
                        isActive={activeTab === 'assignments'}
                        selectedAssignmentId={assignmentIdParam}
                        selectedMaterialId={materialIdParam}
                        selectedSurveyId={surveyIdParam}
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
                        onRequestTestPreview={setTeacherTestPreview}
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
                            params.delete('materialId')
                            params.delete('surveyId')
                          })
                        }
                        onNavigateToAnnouncements={() =>
                          navigateInClassroom((params) => {
                            params.set('tab', 'announcements')
                            params.delete('section')
                            params.delete('assignmentId')
                            params.delete('materialId')
                            params.delete('surveyId')
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
                  {mountedTabs.announcements && (
                    <TabContentTransition isActive={activeTab === 'announcements'}>
                      <TeacherAnnouncementsTab classroom={classroom} />
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
                      <StudentTodayWorkspace
                        classroom={classroom}
                        todayLessonPlan={todayLessonPlan}
                        lastClassLessonPlan={lastClassLessonPlan}
                        lastClassDate={lastClassLessonPlanDate}
                        lastClassLoading={lastClassLessonPlanLoading}
                        onLessonPlanLoad={handleSetLessonPlan}
                      />
                    </TabContentTransition>
                  )}
                  {mountedTabs.assignments && (
                    <TabContentTransition isActive={activeTab === 'assignments'}>
                      <StudentAssignmentsTab
                        classroom={classroom}
                        selectedAssignmentId={assignmentIdParam}
                        selectedMaterialId={materialIdParam}
                        selectedSurveyId={surveyIdParam}
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
                            params.delete('materialId')
                            params.delete('surveyId')
                          })
                        }
                        onNavigateToAnnouncements={() =>
                          navigateInClassroom((params) => {
                            params.set('tab', 'announcements')
                            params.delete('section')
                            params.delete('assignmentId')
                            params.delete('materialId')
                            params.delete('surveyId')
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
                  {mountedTabs.announcements && (
                    <TabContentTransition isActive={activeTab === 'announcements'}>
                      <StudentAnnouncementsTab classroom={classroom} />
                    </TabContentTransition>
                  )}
                </>
              )}
            </div>
          </PageDensityProvider>
        </MainContent>

        {!isTeacher && activeTab === 'today' ? null : (
        <RightSidebar
          hideDesktopHeader={false}
          minimalMobileHeader={false}
          title={
            isTeacher && activeTab === 'calendar' && calendarSidebarState
              ? 'Calendar'
              : isTeacher && isAssessmentTab
              ? ''
              : isTeacher && activeTab === 'assignments'
              ? ''
              : activeTab === 'assignments'
              ? (selectedAssignment?.title || 'Instructions')
              : 'Details'
          }
          headerActions={
            isTeacher && activeTab === 'calendar' && calendarSidebarState ? (
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
          {isTeacher && activeTab === 'calendar' && calendarSidebarState ? (
            <TeacherLessonCalendarSidebar {...calendarSidebarState} />
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
          ) : (
            <div className="p-4 text-sm text-text-muted">
              Inspector panel content will be added in a future update.
            </div>
          )}
        </RightSidebar>
        )}
      </ThreePanelShell>

      <DialogPanel
        isOpen={showMarkdown && isTeacher && activeTab === 'assignments' && isAssignmentMarkdownDialogOpen}
        onClose={() => {
          if (!bulkSaving) closeAssignmentsMarkdownDialog()
        }}
        maxWidth="max-w-5xl"
        className="h-[85vh] overflow-hidden p-0"
        viewportPaddingClassName="p-2 sm:p-4"
        ariaLabelledBy="assignments-markdown-dialog-title"
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="assignments-markdown-dialog-title" className="text-base font-semibold text-text-default">
              Edit Markdown
            </h2>
            <p className="truncate text-xs text-text-muted">Assignments</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={closeAssignmentsMarkdownDialog}
              disabled={bulkSaving}
            >
              Cancel
            </Button>
            {markdownWarning && !warningsAcknowledged ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  setWarningsAcknowledged(true)
                  void handleMarkdownSave({ ignoreWarnings: true })
                }}
                disabled={bulkSaving || markdownLoading}
              >
                {bulkSaving ? 'Saving...' : 'Save Anyway'}
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  void handleMarkdownSave()
                }}
                disabled={bulkSaving || markdownLoading}
              >
                {bulkSaving ? 'Saving...' : 'Save'}
              </Button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {markdownLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <TeacherAssignmentsMarkdownEditor
              markdownContent={markdownContent}
              markdownError={markdownError}
              markdownWarning={markdownWarning}
              hasRichContent={hasRichContent}
              bulkSaving={bulkSaving}
              onMarkdownChange={handleMarkdownContentChange}
              onSave={() => {
                void handleMarkdownSave()
              }}
            />
          )}
        </div>
      </DialogPanel>

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
