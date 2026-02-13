'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { TeacherClassroomView, TeacherAssignmentsMarkdownSidebar, type AssignmentViewMode } from './TeacherClassroomView'
import { assignmentsToMarkdown, markdownToAssignments } from '@/lib/assignment-markdown'
import { StudentTodayTab } from './StudentTodayTab'
import { StudentAssignmentsTab } from './StudentAssignmentsTab'
import { TeacherAttendanceTab, type TeacherAttendanceTabHandle } from './TeacherAttendanceTab'
import { TeacherRosterTab } from './TeacherRosterTab'
import { TeacherGradebookTab } from './TeacherGradebookTab'
import { TeacherSettingsTab } from './TeacherSettingsTab'
import { TeacherLessonCalendarTab, TeacherLessonCalendarSidebar, CalendarSidebarState } from './TeacherLessonCalendarTab'
import { StudentLessonCalendarTab } from './StudentLessonCalendarTab'
import { TeacherResourcesTab } from './TeacherResourcesTab'
import { StudentResourcesTab } from './StudentResourcesTab'
import { TeacherQuizzesTab } from './TeacherQuizzesTab'
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
import { TeacherStudentWorkPanel } from '@/components/TeacherStudentWorkPanel'
import { Spinner } from '@/components/Spinner'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { TEACHER_ASSIGNMENTS_UPDATED_EVENT, TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { QuizDetailPanel } from '@/components/QuizDetailPanel'
import { StudentLogHistory } from '@/components/StudentLogHistory'
import { LogSummary } from './LogSummary'
import type {
  Classroom,
  Entry,
  LessonPlan,
  TiptapContent,
  SelectedStudentInfo,
  Assignment,
  QuizWithStats,
  GradebookStudentSummary,
  GradebookStudentDetail,
  GradebookClassSummary,
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
}

function formatTorontoDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
  })
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function formatPercent1(value: number | null): string {
  if (value == null) return '—'
  return `${value.toFixed(1)} %`
}

export function ClassroomPageClient({
  classroom,
  user,
  teacherClassrooms,
  initialTab,
}: ClassroomPageClientProps) {
  const searchParams = useSearchParams()
  const { leftSidebarExpanded } = useLayoutInitialState()

  const isTeacher = user.role === 'teacher'
  const isArchived = isTeacher && !!classroom.archived_at

  // Determine active tab from URL or default
  const tab = searchParams.get('tab') ?? initialTab
  const defaultTab = isTeacher ? 'attendance' : 'today'
  const validTabs = isTeacher
    ? (['attendance', 'gradebook', 'assignments', 'quizzes', 'calendar', 'resources', 'roster', 'settings'] as const)
    : (['today', 'assignments', 'quizzes', 'calendar', 'resources'] as const)

  const activeTab = (validTabs as readonly string[]).includes(tab ?? '') ? (tab as string) : defaultTab

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
}: {
  classroom: Classroom
  user: UserInfo
  teacherClassrooms: Classroom[]
  activeTab: string
  isArchived: boolean
}) {
  const { openLeft, openRight } = useMobileDrawer()
  const { setWidth: setRightSidebarWidth, isOpen: isRightSidebarOpen, setOpen: setRightSidebarOpen } = useRightSidebar()
  const isTeacher = user.role === 'teacher'

  // State for attendance date (teacher attendance tab)
  const [attendanceDate, setAttendanceDate] = useState<string>('')
  const attendanceTabRef = useRef<TeacherAttendanceTabHandle>(null)

  // State for selected student log (teacher attendance tab)
  const [selectedStudentName, setSelectedStudentName] = useState<string>('')
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)

  // State for selected assignment instructions (assignments tab)
  const [selectedAssignment, setSelectedAssignment] = useState<SelectedAssignmentInstructions | null>(null)

  // State for selected student (teacher assignments tab - viewing student work)
  const [selectedStudent, setSelectedStudent] = useState<SelectedStudentInfo | null>(null)

  // State for today's lesson plan (student today tab)
  const [todayLessonPlan, setTodayLessonPlan] = useState<LessonPlan | null>(null)

  // State for calendar sidebar (teacher calendar tab)
  const [calendarSidebarState, setCalendarSidebarState] = useState<CalendarSidebarState | null>(null)

  // State for selected quiz (teacher quizzes tab)
  const [selectedQuiz, setSelectedQuiz] = useState<QuizWithStats | null>(null)
  const [selectedGradebookStudent, setSelectedGradebookStudent] = useState<GradebookStudentSummary | null>(null)
  const [gradebookStudentDetail, setGradebookStudentDetail] = useState<GradebookStudentDetail | null>(null)
  const [gradebookClassSummary, setGradebookClassSummary] = useState<GradebookClassSummary | null>(null)
  const [gradebookStudentDetailLoading, setGradebookStudentDetailLoading] = useState(false)
  const [gradebookStudentDetailError, setGradebookStudentDetailError] = useState('')

  const handleSelectQuiz = useCallback((quiz: QuizWithStats | null) => {
    setSelectedQuiz(quiz)
  }, [])

  const handleQuizUpdate = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, { detail: { classroomId: classroom.id } })
    )
  }, [classroom.id])

  const handleSelectGradebookStudent = useCallback((student: GradebookStudentSummary | null) => {
    setSelectedGradebookStudent(student)
  }, [])

  // State for markdown mode (teacher assignments tab - summary view only)
  const [assignmentViewMode, setAssignmentViewMode] = useState<AssignmentViewMode>('summary')
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
  const prevViewModeRef = useRef<AssignmentViewMode>('summary')
  const abortControllerRef = useRef<AbortController | null>(null)
  const markdownStaleRef = useRef(true) // Start stale so first open loads

  const handleSelectEntry = useCallback((_entry: Entry | null, studentName: string, studentId: string | null) => {
    setSelectedStudentName(studentName)
    setSelectedStudentId(studentId)
  }, [])

  const handleSummaryStudentClick = useCallback((studentName: string) => {
    attendanceTabRef.current?.selectStudentByName(studentName)
  }, [])

  const handleSelectAssignment = useCallback((assignment: SelectedAssignmentInstructions | null) => {
    setSelectedAssignment(assignment)
  }, [])

  const handleSelectStudent = useCallback((student: SelectedStudentInfo | null) => {
    setSelectedStudent(student)
  }, [])

  const handleSetLessonPlan = useCallback((plan: LessonPlan | null) => {
    setTodayLessonPlan(plan)
  }, [])

  const handleViewModeChange = useCallback((mode: AssignmentViewMode) => {
    setAssignmentViewMode(mode)
    if (mode === 'assignment') {
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
    abortControllerRef.current = new AbortController()

    setMarkdownError(null)
    setMarkdownWarning(null)
    setWarningsAcknowledged(false)
    setMarkdownLoading(true)

    try {
      const res = await fetch(`/api/teacher/assignments?classroom_id=${classroom.id}`, {
        signal: abortControllerRef.current.signal,
      })
      const data = await res.json()
      const assignments = (data.assignments || []) as Assignment[]
      setAssignmentsCache(assignments)

      const result = assignmentsToMarkdown(assignments)
      setMarkdownContent(result.markdown)
      setHasRichContent(result.hasRichContent)
      setIsMarkdownMode(true)
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

  // Detect sidebar open/close and view mode transitions for assignments tab
  useEffect(() => {
    const wasOpen = prevSidebarOpenRef.current
    const wasViewMode = prevViewModeRef.current
    prevSidebarOpenRef.current = isRightSidebarOpen
    prevViewModeRef.current = assignmentViewMode

    if (!isTeacher || activeTab !== 'assignments') return

    const sidebarJustOpened = isRightSidebarOpen && !wasOpen
    const returnedToSummary = assignmentViewMode === 'summary' && wasViewMode === 'assignment'

    if (assignmentViewMode === 'summary' && (sidebarJustOpened || (returnedToSummary && isRightSidebarOpen))) {
      if (markdownStaleRef.current) {
        loadAssignmentsMarkdown()
      } else {
        // Reuse cached markdown when returning from assignment detail.
        setIsMarkdownMode(true)
      }
    } else if (!isRightSidebarOpen && wasOpen) {
      setIsMarkdownMode(false)
    }
  }, [isRightSidebarOpen, isTeacher, activeTab, assignmentViewMode, loadAssignmentsMarkdown])

  // Refresh markdown when assignments are updated
  useEffect(() => {
    if (!isTeacher || activeTab !== 'assignments' || !isMarkdownMode) return

    const handleAssignmentsUpdated = () => {
      markdownStaleRef.current = true
      loadAssignmentsMarkdown()
    }

    window.addEventListener(TEACHER_ASSIGNMENTS_UPDATED_EVENT, handleAssignmentsUpdated)
    return () => {
      window.removeEventListener(TEACHER_ASSIGNMENTS_UPDATED_EVENT, handleAssignmentsUpdated)
    }
  }, [isTeacher, activeTab, isMarkdownMode, loadAssignmentsMarkdown])

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
    if (isTeacher && activeTab === 'assignments' && selectedStudent) {
      setRightSidebarWidth('75%')
    } else if (isTeacher && activeTab === 'assignments') {
      setRightSidebarWidth('50%')
    } else if (isTeacher && activeTab === 'quizzes') {
      setRightSidebarWidth('50%')
    } else if (isTeacher && activeTab === 'gradebook') {
      setRightSidebarWidth(420)
    }
  }, [isTeacher, activeTab, selectedStudent, setRightSidebarWidth])

  useEffect(() => {
    if (activeTab === 'roster') {
      setRightSidebarOpen(false)
    }
  }, [activeTab, setRightSidebarOpen])

  useEffect(() => {
    if (activeTab !== 'gradebook') {
      setSelectedGradebookStudent(null)
      setGradebookStudentDetail(null)
      setGradebookClassSummary(null)
      setGradebookStudentDetailError('')
      setGradebookStudentDetailLoading(false)
    }
  }, [activeTab])

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
        const response = await fetch(
          `/api/teacher/gradebook?classroom_id=${classroom.id}&student_id=${selectedStudentId}`
        )
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load gradebook details')
        }

        if (!cancelled) {
          setGradebookStudentDetail((data.selected_student as GradebookStudentDetail | null) || null)
        }
      } catch (err: any) {
        if (!cancelled) {
          setGradebookStudentDetail(null)
          setGradebookStudentDetailError(err.message || 'Failed to load gradebook details')
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
  }, [isTeacher, activeTab, selectedGradebookStudent, classroom.id, setRightSidebarOpen, openRight])

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
      onOpenSidebar={openLeft}
      mainClassName="max-w-none px-0 py-0"
    >
      <ThreePanelShell>
        <LeftSidebar>
          <NavItems
            classroomId={classroom.id}
            role={user.role}
            activeTab={activeTab}
            isReadOnly={isArchived}
          />
        </LeftSidebar>

        <MainContent>
          {isArchived && (
            <div className="mb-3 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
              This classroom is archived. You can view content, but changes are
              disabled until it is restored.
            </div>
          )}

          {isTeacher ? (
            <>
              {activeTab === 'attendance' && (
                <TeacherAttendanceTab
                  ref={attendanceTabRef}
                  classroom={classroom}
                  onSelectEntry={handleSelectEntry}
                  onDateChange={setAttendanceDate}
                />
              )}
              {activeTab === 'gradebook' && (
                <TeacherGradebookTab
                  classroom={classroom}
                  selectedStudentId={selectedGradebookStudent?.student_id ?? null}
                  onSelectStudent={handleSelectGradebookStudent}
                  onClassSummaryChange={setGradebookClassSummary}
                />
              )}
              {activeTab === 'assignments' && (
                <TeacherClassroomView
                  classroom={classroom}
                  onSelectAssignment={handleSelectAssignment}
                  onSelectStudent={handleSelectStudent}
                  onViewModeChange={handleViewModeChange}
                />
              )}
              {activeTab === 'quizzes' && (
                <TeacherQuizzesTab
                  classroom={classroom}
                  onSelectQuiz={handleSelectQuiz}
                />
              )}
              {activeTab === 'calendar' && (
                <TeacherLessonCalendarTab
                  classroom={classroom}
                  onSidebarStateChange={setCalendarSidebarState}
                />
              )}
              {activeTab === 'resources' && <TeacherResourcesTab classroom={classroom} />}
              {activeTab === 'roster' && <TeacherRosterTab classroom={classroom} />}
              {activeTab === 'settings' && <TeacherSettingsTab classroom={classroom} />}
            </>
          ) : (
            <>
              {activeTab === 'today' && (
                <StudentTodayTab
                  classroom={classroom}
                  onLessonPlanLoad={handleSetLessonPlan}
                />
              )}
              {activeTab === 'assignments' && (
                <StudentAssignmentsTab
                  classroom={classroom}
                />
              )}
              {activeTab === 'quizzes' && <StudentQuizzesTab classroom={classroom} />}
              {activeTab === 'calendar' && <StudentLessonCalendarTab classroom={classroom} />}
              {activeTab === 'resources' && <StudentResourcesTab classroom={classroom} />}
            </>
          )}
        </MainContent>

        <RightSidebar
          title={
            isTeacher && activeTab === 'assignments' && isMarkdownMode
              ? 'Assignments'
              : isTeacher && activeTab === 'calendar' && calendarSidebarState
              ? 'Calendar'
              : isTeacher && activeTab === 'gradebook'
              ? selectedGradebookStudent
                ? `${selectedGradebookStudent.student_first_name || ''} ${selectedGradebookStudent.student_last_name || ''}`.trim() || selectedGradebookStudent.student_email
                : 'Gradebook'
              : isTeacher && activeTab === 'quizzes'
              ? ''
              : isTeacher && activeTab === 'assignments' && selectedStudent
              ? selectedStudent.assignmentTitle
              : activeTab === 'assignments'
              ? (selectedAssignment?.title || 'Instructions')
              : activeTab === 'today'
              ? "Today's Plan"
              : (selectedStudentName || 'Log Summary')
          }
          headerActions={
            isTeacher && activeTab === 'assignments' && isMarkdownMode ? (
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
            ) : isTeacher && activeTab === 'assignments' && selectedStudent ? (
              <>
                <button
                  type="button"
                  onClick={selectedStudent.onGoPrev}
                  disabled={!selectedStudent.canGoPrev}
                  className="p-1.5 rounded-md border border-border text-text-muted hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Previous student"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={selectedStudent.onGoNext}
                  disabled={!selectedStudent.canGoNext}
                  className="p-1.5 rounded-md border border-border text-text-muted hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Next student"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            ) : undefined
          }
        >
          {isTeacher && activeTab === 'assignments' && isMarkdownMode ? (
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
          ) : isTeacher && activeTab === 'quizzes' && selectedQuiz ? (
            <QuizDetailPanel
              quiz={selectedQuiz}
              classroomId={classroom.id}
              onQuizUpdate={handleQuizUpdate}
            />
          ) : isTeacher && activeTab === 'quizzes' ? (
            <div className="p-4">
              <p className="text-sm text-text-muted">
                Select a quiz to view details.
              </p>
            </div>
          ) : isTeacher && activeTab === 'gradebook' && selectedGradebookStudent ? (
            <div className="space-y-4 p-4">
              {gradebookStudentDetailError && (
                <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
                  {gradebookStudentDetailError}
                </div>
              )}
              {gradebookStudentDetailLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : (
                <>
                  <div className="rounded-md border border-border bg-surface-2 p-3">
                    <div className="text-xs text-text-muted">Overall</div>
                    <div className="mt-1 text-lg font-semibold text-text-default">
                      {formatPercent1(gradebookStudentDetail?.final_percent ?? null)}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-text-default">Assignments</h3>
                    {gradebookStudentDetail?.assignments?.length ? (
                      <div className="mt-2 space-y-2">
                        {gradebookStudentDetail.assignments.map((item) => (
                          <div
                            key={item.assignment_id}
                            className={[
                              'rounded-md border px-3 py-2',
                              item.is_draft ? 'border-border-strong bg-surface-2' : 'border-border bg-surface',
                            ].join(' ')}
                          >
                            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm text-text-default">{item.title}</div>
                                <div className="text-xs text-text-muted">
                                  {`Due ${formatTorontoDateShort(item.due_at)}${item.is_draft ? ' . Draft' : ''}`}
                                  {!item.is_graded ? ` . No grade (${formatPoints(item.possible)} pts)` : ''}
                                </div>
                              </div>
                              <div className="text-right text-sm font-semibold tabular-nums text-text-default">
                                {item.is_graded && item.earned != null
                                  ? `${formatPoints(item.earned)}/${formatPoints(item.possible)}`
                                  : '—'}
                              </div>
                              <div className="text-right text-sm font-semibold tabular-nums text-text-default">
                                {item.is_graded && item.percent != null ? `${item.percent.toFixed(1)}%` : '—'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-text-muted">No assignments yet.</p>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-text-default">Quizzes</h3>
                    {gradebookStudentDetail?.quizzes?.length ? (
                      <div className="mt-2 space-y-2">
                        {gradebookStudentDetail.quizzes.map((item) => (
                          <div key={item.quiz_id} className="rounded-md border border-border px-3 py-2">
                            <div className="text-sm text-text-default">{item.title}</div>
                            <div className="text-xs text-text-muted">
                              <span className="font-semibold text-text-default">
                                {formatPoints(item.earned)}/{formatPoints(item.possible)}
                              </span>
                              {' . '}
                              <span className="font-semibold text-text-default">{formatPercent1(item.percent)}</span>
                              {item.is_manual_override ? ' • Manual override' : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-text-muted">No scored quizzes yet.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : isTeacher && activeTab === 'gradebook' ? (
            <div className="space-y-4 p-4">
              <div className="rounded-md border border-border bg-surface-2 p-3">
                <div className="text-xs text-text-muted">Class final average</div>
                <div className="mt-1 text-lg font-semibold text-text-default">
                  {formatPercent1(gradebookClassSummary?.average_final_percent ?? null)}
                </div>
                <div className="text-xs text-text-muted">
                  {gradebookClassSummary?.students_with_final ?? 0} / {gradebookClassSummary?.total_students ?? 0} students with final grade
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-text-default">Assignments</h3>
                {gradebookClassSummary?.assignments?.length ? (
                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      <div />
                      <div className="text-right">Avg</div>
                      <div className="text-right">Med</div>
                      <div className="text-right">#</div>
                    </div>
                    {gradebookClassSummary.assignments.map((item) => (
                      <div
                        key={item.assignment_id}
                        className={[
                          'rounded-md border px-3 py-2',
                          item.is_draft ? 'border-border-strong bg-surface-2' : 'border-border bg-surface',
                        ].join(' ')}
                      >
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm text-text-default">{item.title}</div>
                            <div className="text-xs text-text-muted">
                              {`Due ${formatTorontoDateShort(item.due_at)}${item.is_draft ? ' . Draft' : ''}`}
                            </div>
                          </div>
                          <div className="text-right text-sm font-semibold tabular-nums text-text-default">
                            {item.average_percent != null ? item.average_percent.toFixed(1) : '—'}
                          </div>
                          <div className="text-right text-sm font-semibold tabular-nums text-text-default">
                            {item.median_percent != null ? item.median_percent.toFixed(1) : '—'}
                          </div>
                          <div className="text-right text-sm font-semibold tabular-nums text-text-default">
                            {item.graded_count}/{gradebookClassSummary.total_students}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-text-muted">No assignments yet.</p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-text-default">Quizzes</h3>
                {gradebookClassSummary?.quizzes?.length ? (
                  <div className="mt-2 space-y-2">
                    {gradebookClassSummary.quizzes.map((item) => (
                      <div key={item.quiz_id} className="rounded-md border border-border px-3 py-2">
                        <div className="text-sm text-text-default">{item.title}</div>
                        <div className="text-xs text-text-muted">
                          {item.status || 'unknown'} • {item.average_percent != null
                            ? `Avg ${formatPercent1(item.average_percent)} • Scored ${item.scored_count}/${gradebookClassSummary.total_students}`
                            : `No scored responses • Scored ${item.scored_count}/${gradebookClassSummary.total_students}`}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-text-muted">No quizzes yet.</p>
                )}
              </div>
            </div>
          ) : isTeacher && activeTab === 'attendance' && selectedStudentId ? (
            <StudentLogHistory
              studentId={selectedStudentId}
              classroomId={classroom.id}
            />
          ) : isTeacher && activeTab === 'attendance' ? (
            <LogSummary classroomId={classroom.id} date={attendanceDate} onStudentClick={handleSummaryStudentClick} />
          ) : isTeacher && activeTab === 'assignments' && selectedStudent ? (
            <TeacherStudentWorkPanel
              assignmentId={selectedStudent.assignmentId}
              studentId={selectedStudent.studentId}
            />
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
