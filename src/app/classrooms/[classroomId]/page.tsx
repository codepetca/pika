'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Spinner } from '@/components/Spinner'
import { TeacherClassroomView } from './TeacherClassroomView'
import { StudentClassroomView } from './StudentClassroomView'
import type { Classroom } from '@/types'

interface UserInfo {
  id: string
  email: string
  role: 'student' | 'teacher'
}

export default function ClassroomPage() {
  const params = useParams()
  const router = useRouter()
  const classroomId = params.classroomId as string

  const [classroom, setClassroom] = useState<Classroom | null>(null)
  const [user, setUser] = useState<UserInfo | null>(null)
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
          const classroomRes = await fetch(`/api/teacher/classrooms`)
          const classroomData = await classroomRes.json()
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
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
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
    )
  }

  if (!classroom || !user) {
    return null
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {user.role === 'teacher' ? (
        <TeacherClassroomView classroom={classroom} />
      ) : (
        <StudentClassroomView classroom={classroom} />
      )}
    </div>
  )
}
