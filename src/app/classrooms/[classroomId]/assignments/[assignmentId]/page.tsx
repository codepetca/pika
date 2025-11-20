'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Spinner } from '@/components/Spinner'
import { StudentAssignmentEditor } from './StudentAssignmentEditor'
import { TeacherAssignmentDetail } from './TeacherAssignmentDetail'

interface UserInfo {
  id: string
  email: string
  role: 'student' | 'teacher'
}

export default function AssignmentPage() {
  const params = useParams()
  const router = useRouter()
  const classroomId = params.classroomId as string
  const assignmentId = params.assignmentId as string

  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me')
        if (!res.ok) {
          router.push('/login')
          return
        }
        const data = await res.json()
        setUser(data.user)
      } catch (err) {
        console.error('Error loading user:', err)
        router.push('/login')
      } finally {
        setLoading(false)
      }
    }

    loadUser()
  }, [router])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {user.role === 'teacher' ? (
        <TeacherAssignmentDetail
          classroomId={classroomId}
          assignmentId={assignmentId}
        />
      ) : (
        <StudentAssignmentEditor
          classroomId={classroomId}
          assignmentId={assignmentId}
        />
      )}
    </div>
  )
}
