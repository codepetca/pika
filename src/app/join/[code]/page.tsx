'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { Button, Card } from '@/ui'
import { invalidateStudentClassrooms } from '@/lib/student-classrooms-client'

type JoinView =
  | { kind: 'loading' }
  | {
    kind: 'success'
    title: 'You joined this classroom' | 'You’re already in this classroom'
    classroomId: string
    classroomTitle: string
  }
  | { kind: 'error'; title: string; description: string }

export default function JoinClassroomPage() {
  const { push } = useRouter()
  const params = useParams()
  const code = String(params.code || '').trim()
  const [view, setView] = useState<JoinView>({ kind: 'loading' })

  const joinClassroom = useCallback(async () => {
    setView({ kind: 'loading' })
    try {
      const response = await fetch('/api/student/classrooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classCode: code }),
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
      setView({
        kind: 'error',
        title: 'We couldn’t complete the join',
        description: 'It is safe to try again. If this keeps happening, ask your teacher for help.',
      })
    }
  }, [code, push])

  useEffect(() => {
    void joinClassroom()
  }, [joinClassroom])

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
