'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { Button, Card, FormField, Input } from '@/ui'
import { invalidateStudentClassrooms } from '@/lib/student-classrooms-client'

type JoinView =
  | { kind: 'loading' }
  | {
    kind: 'success'
    title: 'You joined this classroom' | 'You’re already in this classroom'
    classroomId: string
    classroomTitle: string
  }
  | { kind: 'profile' }
  | { kind: 'error'; title: string; description: string }

export default function JoinClassroomPage() {
  const { push } = useRouter()
  const params = useParams()
  const code = String(params.code || '')
  const [view, setView] = useState<JoinView>({ kind: 'loading' })
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profileSubmitting, setProfileSubmitting] = useState(false)

  const joinClassroom = useCallback(async (profile?: {
    firstName: string
    lastName: string
    studentNumber?: string
  }) => {
    if (profile) {
      setProfileSubmitting(true)
      setProfileError('')
    } else {
      setView({ kind: 'loading' })
    }
    try {
      const isLegacyClassroomId =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(code.trim())
      const response = await fetch('/api/student/classrooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isLegacyClassroomId
          ? { classroomId: code.trim(), ...(profile || {}) }
          : { classCode: code, ...(profile || {}) }),
      })
      if (response.status === 401) {
        push(`/login?next=${encodeURIComponent(`/join/${code}`)}`)
        return
      }

      const data = await response.json()
      if (response.ok && data?.classroom?.id && data?.classroom?.title) {
        invalidateStudentClassrooms()
        setView({
          kind: 'success',
          title: data.alreadyEnrolled
            ? 'You’re already in this classroom'
            : 'You joined this classroom',
          classroomId: data.classroom.id,
          classroomTitle: data.classroom.title,
        })
        return
      }
      if (data?.code === 'profile_required') {
        setView({ kind: 'profile' })
        return
      }
      if (data?.code === 'not_on_roster') {
        setView({
          kind: 'error',
          title: 'You’re not on this class roster',
          description: 'Check that you used the classroom link from your teacher and signed in with your school account.',
        })
        return
      }
      if (data?.code === 'roster_ambiguous' || data?.code === 'roster_binding_conflict') {
        setView({
          kind: 'error',
          title: 'We couldn’t match your school account',
          description: 'Your account could not be matched safely to one roster entry. Ask your teacher for help.',
        })
        return
      }
      if (data?.code === 'enrollment_closed') {
        setView({
          kind: 'error',
          title: 'Joining this classroom is closed',
          description: 'Ask your teacher when classroom joining will be available.',
        })
        return
      }
      throw new Error('unavailable')
    } catch {
      if (profile) {
        setProfileError('We couldn’t complete the join. It is safe to try again.')
      } else {
        setView({
          kind: 'error',
          title: 'We couldn’t complete the join',
          description: 'It is safe to try again. If this keeps happening, ask your teacher for help.',
        })
      }
    } finally {
      if (profile) setProfileSubmitting(false)
    }
  }, [code, push])

  useEffect(() => {
    void joinClassroom()
  }, [joinClassroom])

  function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedFirstName = firstName.trim()
    const trimmedLastName = lastName.trim()
    if (!trimmedFirstName || !trimmedLastName) {
      setProfileError('First name and last name are required.')
      return
    }
    void joinClassroom({
      firstName: trimmedFirstName,
      lastName: trimmedLastName,
      studentNumber: studentNumber.trim() || undefined,
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <Card className="w-full max-w-md p-6 text-center sm:p-8">
        <p className="text-sm font-semibold text-primary">Join this classroom</p>
        {view.kind === 'loading' ? (
          <div className="py-10" role="status" aria-live="polite">
            <Spinner size="lg" />
            <h1 className="mt-5 text-xl font-semibold text-text-default">Checking the class roster…</h1>
            <p className="mt-2 text-sm text-text-muted">Keep this page open while we match your account.</p>
          </div>
        ) : view.kind === 'success' ? (
          <div className="pt-6" role="status" aria-live="polite">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold text-text-default">{view.title}</h1>
            <p className="mt-2 text-sm text-text-muted">{view.classroomTitle}</p>
            <Button className="mt-6 w-full" onClick={() => push(`/classrooms/${view.classroomId}?tab=today`)}>
              Open classroom
            </Button>
          </div>
        ) : view.kind === 'profile' ? (
          <form className="pt-6 text-left" onSubmit={submitProfile}>
            <h1 className="text-xl font-semibold text-text-default">Tell your teacher who you are</h1>
            <p className="mt-2 text-sm text-text-muted">
              This classroom allows students who are not already on the roster to join.
            </p>
            <div className="mt-6 space-y-4">
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
              {profileError ? (
                <div className="rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
                  {profileError}
                </div>
              ) : null}
              <Button type="submit" className="w-full" disabled={profileSubmitting}>
                {profileSubmitting ? 'Joining…' : 'Join classroom'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="pt-6" role="alert">
            <AlertCircle className="mx-auto h-12 w-12 text-warning" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold text-text-default">{view.title}</h1>
            <p className="mt-2 text-sm text-text-muted">{view.description}</p>
            <Button className="mt-6 w-full" variant="secondary" onClick={() => void joinClassroom()}>
              Try again
            </Button>
          </div>
        )}
      </Card>
    </main>
  )
}
