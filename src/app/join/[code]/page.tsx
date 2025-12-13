'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Spinner } from '@/components/Spinner'

export default function JoinClassroomPage() {
  const router = useRouter()
  const params = useParams()
  const code = params.code as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function joinClassroom() {
      try {
        // Try to join by code or ID
        const response = await fetch('/api/student/classrooms/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classCode: code,
            classroomId: code, // Try both in case it's a UUID
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to join classroom')
        }

        // Redirect to student dashboard with the new classroom selected
        router.push(`/classrooms/${data.classroom.id}?tab=today`)
      } catch (err: any) {
        console.error('Join error:', err)
        setError(err.message || 'An error occurred')
        setLoading(false)
      }
    }

    joinClassroom()
  }, [code, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-gray-600">Joining classroom...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-red-600 text-5xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Unable to Join
          </h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => router.push('/login')}
            className="text-blue-600 hover:underline"
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  return null
}
