'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { ClassroomSidebar } from '@/components/ClassroomSidebar'
import { Spinner } from '@/components/Spinner'
import { TeacherClassroomView } from './TeacherClassroomView'
import { StudentTodayTab } from './StudentTodayTab'
import { StudentHistoryTab } from './StudentHistoryTab'
import { StudentAssignmentsTab } from './StudentAssignmentsTab'
import { TeacherAttendanceTab } from './TeacherAttendanceTab'
import { TeacherLogsTab } from './TeacherLogsTab'
import { TeacherRosterTab } from './TeacherRosterTab'
import { TeacherCalendarTab } from './TeacherCalendarTab'
import { TeacherSettingsTab } from './TeacherSettingsTab'
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
          const classroomRes = await fetch(`/api/teacher/classrooms`)
          const classroomData = await classroomRes.json()
          setTeacherClassrooms(classroomData.classrooms || [])
          const found = classroomData.classrooms?.find((c: Classroom) => c.id === classroomId)

          if (!found) {
            setError('Classroom not found')
            return
          }
          setClassroom(found)
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

  const defaultTab = isTeacher ? 'attendance' : 'today'
  const validTabs = isTeacher
    ? (['attendance', 'logs', 'assignments', 'roster', 'calendar', 'settings'] as const)
    : (['today', 'history', 'assignments'] as const)

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
      <div className="flex min-h-[calc(100vh-3rem)]">
        <ClassroomSidebar
          classroomId={classroom.id}
          role={user.role}
          activeTab={activeTab}
          isMobileOpen={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
        />

        <div className="flex-1 min-w-0 px-4 py-3">
          <div className="max-w-7xl mx-auto">
            {isTeacher ? (
              <>
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
                {activeTab === 'calendar' && (
                  <TeacherCalendarTab classroom={classroom} />
                )}
                {activeTab === 'settings' && (
                  <TeacherSettingsTab classroom={classroom} />
                )}
              </>
            ) : (
              <>
                {activeTab === 'today' && <StudentTodayTab classroom={classroom} />}
                {activeTab === 'history' && <StudentHistoryTab classroom={classroom} />}
                {activeTab === 'assignments' && <StudentAssignmentsTab classroom={classroom} />}
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
