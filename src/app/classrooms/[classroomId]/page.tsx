'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { Spinner } from '@/components/Spinner'
import { TeacherClassroomView } from './TeacherClassroomView'
import { StudentTodayTab } from './StudentTodayTab'
import { StudentAssignmentsTab } from './StudentAssignmentsTab'
import { TeacherAttendanceTab } from './TeacherAttendanceTab'
import { TeacherRosterTab } from './TeacherRosterTab'
import { TeacherSettingsTab } from './TeacherSettingsTab'
import { TeacherLessonCalendarTab } from './TeacherLessonCalendarTab'
import { StudentLessonCalendarTab } from './StudentLessonCalendarTab'
import { StudentNotificationsProvider } from '@/components/StudentNotificationsProvider'
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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Classroom, Entry, LessonPlan, TiptapContent, SelectedStudentInfo } from '@/types'

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

export default function ClassroomPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const classroomId = params.classroomId as string
  const { leftSidebarExpanded } = useLayoutInitialState()

  const [classroom, setClassroom] = useState<Classroom | null>(null)
  const [user, setUser] = useState<UserInfo | null>(null)
  const [teacherClassrooms, setTeacherClassrooms] = useState<Classroom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadData() {
      try {
        // Get current user
        const userRes = await fetch('/api/auth/me')
        if (!userRes.ok) {
          router.push('/login')
          return
        }
        const userData = await userRes.json()
        setUser(userData.user)

        // Load classroom based on role
        if (userData.user.role === 'teacher') {
          const [classroomsRes, classroomRes] = await Promise.all([
            fetch('/api/teacher/classrooms'),
            fetch(`/api/teacher/classrooms/${classroomId}`),
          ])

          if (!classroomRes.ok) {
            setError('Classroom not found')
            return
          }

          const classroomData = await classroomRes.json()
          const classroomsData = await classroomsRes.json().catch(() => ({ classrooms: [] }))
          const activeClassrooms = (classroomsData.classrooms || []) as Classroom[]
          const currentClassroom = classroomData.classroom as Classroom

          setClassroom(currentClassroom)
          if (currentClassroom.archived_at) {
            setTeacherClassrooms([currentClassroom])
          } else {
            setTeacherClassrooms(activeClassrooms)
          }
        } else {
          const classroomRes = await fetch(`/api/student/classrooms/${classroomId}`)
          if (!classroomRes.ok) {
            setError('Classroom not found or not enrolled')
            return
          }
          const classroomData = await classroomRes.json()
          setClassroom(classroomData.classroom)
        }
      } catch (err) {
        console.error('Error loading classroom:', err)
        setError('Failed to load classroom')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [classroomId, router])

  if (loading) {
    return (
      <AppShell showHeader={false}>
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      </AppShell>
    )
  }

  if (error) {
    return (
      <AppShell showHeader={false}>
        <div className="max-w-md mx-auto mt-12">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
            <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
            <button
              onClick={() => router.back()}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
            >
              Go back
            </button>
          </div>
        </div>
      </AppShell>
    )
  }

  if (!classroom || !user) {
    return null
  }

  const tab = searchParams.get('tab')
  const isTeacher = user.role === 'teacher'
  const isArchived = isTeacher && !!classroom.archived_at

  const defaultTab = isTeacher ? 'attendance' : 'today'
  const validTabs = isTeacher
    ? (['attendance', 'assignments', 'calendar', 'roster', 'settings'] as const)
    : (['today', 'assignments', 'calendar'] as const)

  const activeTab = (validTabs as readonly string[]).includes(tab ?? '') ? (tab as string) : defaultTab

  // Determine route key for layout config
  const routeKey = getRouteKeyFromTab(activeTab, user.role)

  return (
    <ThreePanelProvider
      routeKey={routeKey}
      initialLeftExpanded={leftSidebarExpanded}
    >
      <ClassroomPageContent
        classroom={classroom}
        user={user}
        teacherClassrooms={teacherClassrooms}
        activeTab={activeTab}
        isArchived={isArchived}
      />
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

  // State for showing instructions panel instead of student work
  const [showInstructionsPanel, setShowInstructionsPanel] = useState(false)

  // State for today's lesson plan (student today tab)
  const [todayLessonPlan, setTodayLessonPlan] = useState<LessonPlan | null>(null)

  const handleSelectEntry = useCallback((entry: Entry | null, studentName: string) => {
    setSelectedEntry(entry)
    setSelectedStudentName(studentName)
  }, [])

  const handleSelectAssignment = useCallback((assignment: SelectedAssignmentInstructions | null) => {
    setSelectedAssignment(assignment)
  }, [])

  const handleSelectStudent = useCallback((student: SelectedStudentInfo | null) => {
    setSelectedStudent(student)
    // Reset instructions panel when student selection changes
    setShowInstructionsPanel(false)
  }, [])

  const handleSetLessonPlan = useCallback((plan: LessonPlan | null) => {
    setTodayLessonPlan(plan)
  }, [])

  const handleToggleInstructions = useCallback(() => {
    if (selectedStudent && !showInstructionsPanel) {
      // Student is selected and showing student work → show instructions
      setShowInstructionsPanel(true)
      setRightSidebarOpen(true)
    } else if (showInstructionsPanel && isRightSidebarOpen) {
      // Instructions are showing and panel is open → close panel
      setRightSidebarOpen(false)
      setShowInstructionsPanel(false)
    } else {
      // Panel is closed or showing something else → open and show instructions
      setShowInstructionsPanel(true)
      setRightSidebarOpen(true)
    }
  }, [selectedStudent, showInstructionsPanel, isRightSidebarOpen, setRightSidebarOpen])

  // Change right sidebar width to 70% when viewing student work, 40% for instructions
  useEffect(() => {
    if (isTeacher && activeTab === 'assignments' && selectedStudent && !showInstructionsPanel) {
      setRightSidebarWidth('70%')
    } else if (isTeacher && activeTab === 'assignments') {
      setRightSidebarWidth('40%')
    }
  }, [isTeacher, activeTab, selectedStudent, showInstructionsPanel, setRightSidebarWidth])

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
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
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
                  showInstructionsPanel={showInstructionsPanel}
                  onToggleInstructions={handleToggleInstructions}
                />
              )}
              {activeTab === 'calendar' && <TeacherLessonCalendarTab classroom={classroom} />}
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
            </>
          )}
        </MainContent>

        <RightSidebar
          title={
            isTeacher && activeTab === 'assignments' && selectedStudent && showInstructionsPanel
              ? 'Instructions'
              : isTeacher && activeTab === 'assignments' && selectedStudent
              ? selectedStudent.assignmentTitle
              : activeTab === 'assignments'
              ? (selectedAssignment?.title || 'Instructions')
              : activeTab === 'today'
              ? "Today's Plan"
              : (selectedStudentName || 'Student Log')
          }
          headerActions={
            isTeacher && activeTab === 'assignments' && selectedStudent ? (
              <>
                <button
                  type="button"
                  onClick={selectedStudent.onGoPrev}
                  disabled={!selectedStudent.canGoPrev}
                  className="p-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Previous student"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={selectedStudent.onGoNext}
                  disabled={!selectedStudent.canGoNext}
                  className="p-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Next student"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            ) : undefined
          }
        >
          {isTeacher && activeTab === 'attendance' ? (
            <div className="p-4">
              {selectedEntry ? (
                <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                  {selectedEntry.text}
                </p>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Select a student to view their log.
                </p>
              )}
            </div>
          ) : isTeacher && activeTab === 'assignments' && selectedStudent && !showInstructionsPanel ? (
            <TeacherStudentWorkPanel
              assignmentId={selectedStudent.assignmentId}
              studentId={selectedStudent.studentId}
            />
          ) : activeTab === 'assignments' ? (
            <div className="p-4">
              {selectedAssignment ? (
                selectedAssignment.instructions ? (
                  typeof selectedAssignment.instructions === 'string' ? (
                    <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                      {selectedAssignment.instructions}
                    </p>
                  ) : (
                    <RichTextViewer content={selectedAssignment.instructions} />
                  )
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No instructions provided.
                  </p>
                )
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
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
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No lesson plan for today.
                </p>
              )}
            </div>
          ) : (
            <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
              Inspector panel content will be added in a future update.
            </div>
          )}
        </RightSidebar>
      </ThreePanelShell>
    </AppShell>
  )

  // Wrap with StudentNotificationsProvider for students
  if (!isTeacher) {
    return (
      <StudentNotificationsProvider classroomId={classroom.id}>
        {content}
      </StudentNotificationsProvider>
    )
  }

  return content
}
