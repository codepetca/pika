'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Spinner } from '@/components/Spinner'
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

  useEffect(() => {
    if (!user) return
    if (user.role !== 'student') return
    router.replace(`/classrooms/${classroomId}?tab=assignments&assignmentId=${assignmentId}&view=edit`)
  }, [assignmentId, classroomId, router, user])

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

  if (user.role === 'student') {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <TeacherAssignmentDetail classroomId={classroomId} assignmentId={assignmentId} />
    </div>
  )
}
