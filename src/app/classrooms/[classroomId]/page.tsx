'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { Spinner } from '@/components/Spinner'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
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
  const [showCreateModal, setShowCreateModal] = useState(false)

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
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => router.back()}
              className="text-blue-600 hover:text-blue-700"
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

  const teacherTabs = [
    { id: 'attendance', label: 'Attendance' },
    { id: 'logs', label: 'Logs' },
    { id: 'assignments', label: 'Assignments' },
    { id: 'roster', label: 'Roster' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'settings', label: 'Settings' },
  ] as const

  const studentTabs = [
    { id: 'today', label: 'Today' },
    { id: 'history', label: 'History' },
    { id: 'assignments', label: 'Assignments' },
  ] as const

  const defaultTab = isTeacher ? 'attendance' : 'today'
  const activeTab = (tab || defaultTab) as string

  function setTab(nextTab: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', nextTab)
    router.replace(url.pathname + url.search)
  }

  function switchClassroom(nextId: string) {
    const nextTab = isTeacher ? activeTab : 'today'
    router.push(`/classrooms/${nextId}?tab=${encodeURIComponent(nextTab)}`)
  }

  return (
    <AppShell
      user={user}
      classrooms={isTeacher ? teacherClassrooms.map(c => ({
        id: c.id,
        title: c.title,
        code: c.class_code
      })) : undefined}
      currentClassroomId={classroom.id}
    >
      {/* Compact tab navigation */}
      <div className="border-b border-gray-200 -mx-4 px-4 mb-4">
        <div className="flex gap-4">
          {(isTeacher ? teacherTabs : studentTabs).map(t => {
            const isActive = activeTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`py-2 text-sm font-medium border-b-2 transition ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Action button for teachers */}
      {isTeacher && (
        <div className="flex justify-end mb-3">
          <button
            type="button"
            className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 font-medium"
            onClick={() => setShowCreateModal(true)}
          >
            + New classroom
          </button>
        </div>
      )}

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

      {isTeacher && (
        <CreateClassroomModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={(created) => {
            setShowCreateModal(false)
            router.push(`/classrooms/${created.id}?tab=attendance`)
          }}
        />
      )}
    </AppShell>
  )
}
