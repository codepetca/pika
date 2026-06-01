'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Spinner } from '@/components/Spinner'
import { Button, FormField, Input } from '@/ui'

export default function JoinClassroomPage() {
  const router = useRouter()
  const params = useParams()
  const code = params.code as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [needsProfile, setNeedsProfile] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [profileSubmitting, setProfileSubmitting] = useState(false)

  async function joinClassroom(profile?: { firstName: string; lastName: string; studentNumber?: string }) {
    try {
      const trimmedCode = String(code || '').trim()
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          trimmedCode
        )

      const response = await fetch('/api/student/classrooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classCode: trimmedCode,
          ...(isUuid ? { classroomId: trimmedCode } : {}),
          ...(profile || {}),
        }),
      })

      if (response.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/join/${trimmedCode}`)}`)
        return
      }

      const data = await response.json()

      if (!response.ok) {
        if (data?.code === 'profile_required') {
          setNeedsProfile(true)
          setError('')
          setLoading(false)
          return
        }
        if (data?.code === 'enrollment_closed') {
          throw new Error('Enrollment is closed. Ask your teacher to enable enrollment in Settings.')
        }
        if (data?.code === 'not_on_roster') {
          throw new Error('Your email is not on the roster. Use the email your teacher added, or ask your teacher to add you.')
        }
        throw new Error(data?.error || 'Unable to join. Check your code and email, or ask your teacher to add you.')
      }

      router.push(`/classrooms/${data.classroom.id}?tab=today`)
    } catch (err: any) {
      console.error('Join error:', err)
      setError(err.message || 'An error occurred')
      setLoading(false)
    }
  }

  useEffect(() => {
    joinClassroom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, router])

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedFirstName = firstName.trim()
    const trimmedLastName = lastName.trim()

    if (!trimmedFirstName || !trimmedLastName) {
      setError('First name and last name are required.')
      return
    }

    setProfileSubmitting(true)
    setError('')
    await joinClassroom({
      firstName: trimmedFirstName,
      lastName: trimmedLastName,
      studentNumber: studentNumber.trim() || undefined,
    })
    setProfileSubmitting(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-text-muted">Joining classroom...</p>
        </div>
      </div>
    )
  }

  if (needsProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-4">
        <form
          onSubmit={submitProfile}
          className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg"
        >
          <div className="mb-5">
            <h1 className="text-2xl font-bold text-text-default">Join classroom</h1>
            <p className="mt-2 text-sm text-text-muted">
              Enter the name your teacher will recognize.
            </p>
          </div>

          <div className="space-y-4">
            <FormField label="First name">
              <Input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoComplete="given-name"
                disabled={profileSubmitting}
                required
              />
            </FormField>

            <FormField label="Last name">
              <Input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                autoComplete="family-name"
                disabled={profileSubmitting}
                required
              />
            </FormField>

            <FormField label="Student number or lab ID (optional)">
              <Input
                value={studentNumber}
                onChange={(event) => setStudentNumber(event.target.value)}
                autoComplete="off"
                disabled={profileSubmitting}
              />
            </FormField>

            {error ? (
              <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
                {error}
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={profileSubmitting}>
              {profileSubmitting ? 'Joining...' : 'Join'}
            </Button>
          </div>
        </form>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 text-center shadow-lg">
          <h1 className="mb-2 text-2xl font-bold text-text-default">
            Unable to Join
          </h1>
          <p className="mb-6 text-text-muted">{error}</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/join')}
          >
            Try a different code
          </Button>
        </div>
      </div>
    )
  }

  return null
}
