'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { ClassroomSidebar } from '@/components/ClassroomSidebar'
import { Spinner } from '@/components/Spinner'
import { TeacherClassroomView } from './TeacherClassroomView'
import { StudentTodayTab } from './StudentTodayTab'
import { StudentAssignmentsTab } from './StudentAssignmentsTab'
import { TeacherAttendanceTab } from './TeacherAttendanceTab'
import { TeacherLogsTab } from './TeacherLogsTab'
import { TeacherRosterTab } from './TeacherRosterTab'
import { TeacherSettingsTab } from './TeacherSettingsTab'
import { StudentNotificationsProvider } from '@/components/StudentNotificationsProvider'
import type { Classroom } from '@/types'

interface UserInfo {
  id: string
  email: string
  role: 'student' | 'teacher'
}

export default function ClassroomPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const classroomId = params.classroomId as string

  const [classroom, setClassroom] = useState<Classroom | null>(null)
  const [user, setUser] = useState<UserInfo | null>(null)
  const [teacherClassrooms, setTeacherClassrooms] = useState<Classroom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

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
    ? (['attendance', 'logs', 'assignments', 'roster', 'settings'] as const)
    : (['today', 'assignments'] as const)

  const activeTab = validTabs.includes(tab as any) ? (tab as string) : defaultTab

  return (
    <AppShell
      user={user}
      classrooms={isTeacher ? teacherClassrooms.map(c => ({
        id: c.id,
        title: c.title,
        code: c.class_code
      })) : [{
        id: classroom.id,
        title: classroom.title,
        code: classroom.class_code
      }]}
      currentClassroomId={classroom.id}
      currentTab={activeTab}
      onOpenSidebar={() => setIsMobileSidebarOpen(true)}
      mainClassName="max-w-none px-0 py-0"
    >
      {isTeacher ? (
        <div className="flex min-h-[calc(100vh-3rem)]">
          <ClassroomSidebar
            classroomId={classroom.id}
            role={user.role}
            activeTab={activeTab}
            isReadOnly={isArchived}
            isMobileOpen={isMobileSidebarOpen}
            onCloseMobile={() => setIsMobileSidebarOpen(false)}
          />

          <div className="flex-1 min-w-0 min-h-0 px-4 py-3">
            <div className="max-w-7xl mx-auto h-full flex flex-col min-h-0">
              {isArchived && (
                <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                  This classroom is archived. You can view content, but changes are disabled until it is restored.
                </div>
              )}
              {activeTab === 'attendance' && (
                <TeacherAttendanceTab classroom={classroom} />
              )}
              {activeTab === 'logs' && (
                <TeacherLogsTab classroom={classroom} />
              )}
              {activeTab === 'assignments' && (
                <TeacherClassroomView classroom={classroom} />
              )}
              {activeTab === 'roster' && (
                <TeacherRosterTab classroom={classroom} />
              )}
              {activeTab === 'settings' && (
                <TeacherSettingsTab classroom={classroom} />
              )}
            </div>
          </div>
        </div>
      ) : (
        <StudentNotificationsProvider classroomId={classroom.id}>
          <div className="flex min-h-[calc(100vh-3rem)]">
            <ClassroomSidebar
              classroomId={classroom.id}
              role={user.role}
              activeTab={activeTab}
              isReadOnly={false}
              isMobileOpen={isMobileSidebarOpen}
              onCloseMobile={() => setIsMobileSidebarOpen(false)}
            />

            <div className="flex-1 min-w-0 min-h-0 px-4 py-3">
              <div className="max-w-7xl mx-auto h-full flex flex-col min-h-0">
                {activeTab === 'today' && <StudentTodayTab classroom={classroom} />}
                {activeTab === 'assignments' && <StudentAssignmentsTab classroom={classroom} />}
              </div>
            </div>
          </div>
        </StudentNotificationsProvider>
      )}
    </AppShell>
  )
}
