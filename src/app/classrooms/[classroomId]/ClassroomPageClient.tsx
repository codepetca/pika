'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { TeacherClassroomView, TeacherAssignmentsMarkdownSidebar, type AssignmentViewMode } from './TeacherClassroomView'
import { assignmentsToMarkdown, markdownToAssignments } from '@/lib/assignment-markdown'
import { StudentTodayTab } from './StudentTodayTab'
import { StudentAssignmentsTab } from './StudentAssignmentsTab'
import { TeacherAttendanceTab } from './TeacherAttendanceTab'
import { TeacherRosterTab } from './TeacherRosterTab'
import { TeacherSettingsTab } from './TeacherSettingsTab'
import { TeacherLessonCalendarTab, TeacherLessonCalendarSidebar, CalendarSidebarState } from './TeacherLessonCalendarTab'
import { StudentLessonCalendarTab } from './StudentLessonCalendarTab'
import { TeacherResourcesTab } from './TeacherResourcesTab'
import { StudentResourcesTab } from './StudentResourcesTab'
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
import { getRouteKeyFromTab } from '@/lib/layout-config'
import { RichTextViewer } from '@/components/editor'
import { TeacherStudentWorkPanel } from '@/components/TeacherStudentWorkPanel'
import { Spinner } from '@/components/Spinner'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { TEACHER_ASSIGNMENTS_UPDATED_EVENT } from '@/lib/events'
import type { Classroom, Entry, LessonPlan, TiptapContent, SelectedStudentInfo, Assignment } from '@/types'

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
    ? (['attendance', 'assignments', 'calendar', 'resources', 'roster', 'settings'] as const)
    : (['today', 'assignments', 'calendar', 'resources'] as const)

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
  const { openLeft } = useMobileDrawer()
  const { setWidth: setRightSidebarWidth, isOpen: isRightSidebarOpen, setOpen: setRightSidebarOpen } = useRightSidebar()
  const isTeacher = user.role === 'teacher'

  // State for selected student log (teacher attendance tab)
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null)
  const [selectedStudentName, setSelectedStudentName] = useState<string>('')

  // State for selected assignment instructions (assignments tab)
  const [selectedAssignment, setSelectedAssignment] = useState<SelectedAssignmentInstructions | null>(null)

  // State for selected student (teacher assignments tab - viewing student work)
  const [selectedStudent, setSelectedStudent] = useState<SelectedStudentInfo | null>(null)

  // State for today's lesson plan (student today tab)
  const [todayLessonPlan, setTodayLessonPlan] = useState<LessonPlan | null>(null)

  // State for calendar sidebar (teacher calendar tab)
  const [calendarSidebarState, setCalendarSidebarState] = useState<CalendarSidebarState | null>(null)

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

  const handleSelectEntry = useCallback((entry: Entry | null, studentName: string) => {
    setSelectedEntry(entry)
    setSelectedStudentName(studentName)
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
      loadAssignmentsMarkdown()
    } else if (!isRightSidebarOpen && wasOpen) {
      setIsMarkdownMode(false)
    }
  }, [isRightSidebarOpen, isTeacher, activeTab, assignmentViewMode, loadAssignmentsMarkdown])

  // Refresh markdown when assignments are updated
  useEffect(() => {
    if (!isTeacher || activeTab !== 'assignments' || !isMarkdownMode) return

    const handleAssignmentsUpdated = () => {
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
      setRightSidebarWidth('70%')
    } else if (isTeacher && activeTab === 'assignments') {
      setRightSidebarWidth('40%')
    }
  }, [isTeacher, activeTab, selectedStudent, setRightSidebarWidth])

  useEffect(() => {
    if (activeTab === 'roster') {
      setRightSidebarOpen(false)
    }
  }, [activeTab, setRightSidebarOpen])

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
                  classroom={classroom}
                  onSelectEntry={handleSelectEntry}
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
                  onSelectAssignment={handleSelectAssignment}
                />
              )}
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
              : isTeacher && activeTab === 'assignments' && selectedStudent
              ? selectedStudent.assignmentTitle
              : activeTab === 'assignments'
              ? (selectedAssignment?.title || 'Instructions')
              : activeTab === 'today'
              ? "Today's Plan"
              : (selectedStudentName || 'Student Log')
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
                  className="px-2 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
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
          ) : isTeacher && activeTab === 'attendance' ? (
            <div className="p-4">
              {selectedEntry ? (
                <p className="text-sm text-text-default whitespace-pre-wrap">
                  {selectedEntry.text}
                </p>
              ) : (
                <p className="text-sm text-text-muted">
                  Select a student to view their log.
                </p>
              )}
            </div>
          ) : isTeacher && activeTab === 'assignments' && selectedStudent ? (
            <TeacherStudentWorkPanel
              assignmentId={selectedStudent.assignmentId}
              studentId={selectedStudent.studentId}
            />
          ) : activeTab === 'assignments' ? (
            <div className="p-4">
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
