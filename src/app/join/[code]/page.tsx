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
        const trimmedCode = String(code || '').trim()
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            trimmedCode
          )

        // Try to join by code or ID
        const response = await fetch('/api/student/classrooms/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classCode: trimmedCode,
            ...(isUuid ? { classroomId: trimmedCode } : {}),
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          if (data?.code === 'enrollment_closed') {
            throw new Error('Enrollment is closed. Ask your teacher to enable enrollment in Settings.')
          }
          if (data?.code === 'not_on_roster') {
            throw new Error('Your email is not on the roster. Make sure you are signed in with your board email and ask your teacher to add you.')
          }
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
            onClick={() => router.push('/join')}
            className="text-blue-600 hover:underline"
          >
            Try a different code
          </button>
        </div>
      </div>
    )
  }

  return null
}
