'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, Clock3 } from 'lucide-react'
import { Button, Card } from '@/ui'
import { Spinner } from '@/components/Spinner'
import {
  studentAttendanceCheckInViewSchema,
  type StudentAttendanceCheckInView,
} from '@/lib/validations/student-attendance'
import {
  invalidateStudentAttendanceStatus,
  preserveAuthoritativeStudentAttendanceConfirmation,
} from '@/lib/student-attendance-client'

type ViewState =
  | { kind: 'loading' }
  | { kind: 'result'; result: StudentAttendanceCheckInView }
  | { kind: 'unavailable' }

export function StudentAttendanceCheckIn({
  entryToken,
  canCheckIn,
  studentId,
}: {
  entryToken: string
  canCheckIn: boolean
  studentId?: string
}) {
  const [view, setView] = useState<ViewState>(() => canCheckIn
    ? { kind: 'loading' }
    : {
        kind: 'result',
        result: {
          state: 'needs_staff',
          title: 'This check-in is for students',
          description: 'Sign in with a student account or ask the teacher for help.',
        },
      })
  const attemptIdRef = useRef<string | null>(null)

  const checkIn = useCallback(async (signal?: AbortSignal) => {
    if (!canCheckIn) return
    attemptIdRef.current ??= crypto.randomUUID()
    setView({ kind: 'loading' })
    try {
      const response = await fetch('/api/student/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryToken, attemptId: attemptIdRef.current }),
        cache: 'no-store',
        signal,
      })
      const body = await response.json() as unknown
      const parsed = studentAttendanceCheckInViewSchema.safeParse(body)
      if (!response.ok || !parsed.success) throw new Error('unavailable')
      attemptIdRef.current = null
      if (
        parsed.data.state === 'checked_in'
        || parsed.data.state === 'already_checked_in'
      ) {
        if (
          studentId
          && parsed.data.classroomId
          && parsed.data.attendanceStatus
        ) {
          preserveAuthoritativeStudentAttendanceConfirmation({
            studentId,
            classroomId: parsed.data.classroomId,
            attendanceStatus: parsed.data.attendanceStatus,
            ...(parsed.data.recordedAt ? { confirmedAt: parsed.data.recordedAt } : {}),
          })
        }
        invalidateStudentAttendanceStatus(studentId)
      }
      setView({ kind: 'result', result: parsed.data })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setView({ kind: 'unavailable' })
    }
  }, [canCheckIn, entryToken, studentId])

  useEffect(() => {
    const controller = new AbortController()
    void checkIn(controller.signal)
    return () => controller.abort()
  }, [checkIn])

  const result = view.kind === 'result' ? view.result : null
  const positive = result?.state === 'checked_in' || result?.state === 'already_checked_in'
  const Icon = positive ? CheckCircle2 : result?.state === 'closed' ? Clock3 : AlertCircle

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <Card className="w-full max-w-md p-6 text-center sm:p-8">
        <p className="text-sm font-semibold text-primary">Pika attendance</p>
        {view.kind === 'loading' ? (
          <div className="py-10" role="status" aria-live="polite">
            <Spinner size="lg" />
            <h1 className="mt-5 text-xl font-semibold text-text-default">Checking you in…</h1>
            <p className="mt-2 text-sm text-text-muted">Keep this page open for the result.</p>
          </div>
        ) : view.kind === 'unavailable' ? (
          <div className="pt-6" role="alert">
            <AlertCircle className="mx-auto h-12 w-12 text-warning" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold text-text-default">We could not confirm check-in</h1>
            <p className="mt-2 text-sm text-text-muted">
              It is safe to retry. Do not assume attendance was recorded until this page confirms it.
            </p>
            <Button className="mt-6 w-full" onClick={() => void checkIn()}>Try again</Button>
          </div>
        ) : result ? (
          <div className="pt-6" role={positive ? 'status' : 'alert'} aria-live="polite">
            <Icon
              className={`mx-auto h-12 w-12 ${positive ? 'text-success' : 'text-warning'}`}
              aria-hidden="true"
            />
            <h1 className="mt-4 text-xl font-semibold text-text-default">{result.title}</h1>
            <p className="mt-2 text-sm text-text-muted">{result.description}</p>
            {result.recordedAt ? (
              <p className="mt-3 text-xs text-text-muted">
                Confirmed {new Date(result.recordedAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: 'America/Toronto',
                  timeZoneName: 'short',
                })}
              </p>
            ) : null}
          </div>
        ) : null}
        <Link
          className="mt-8 inline-block text-sm font-medium text-primary hover:underline"
          href={positive && result?.classroomId
            ? `/classrooms/${result.classroomId}?tab=today`
            : '/classrooms'}
        >
          {positive && result?.classroomId ? 'Back to classroom' : 'Back to classrooms'}
        </Link>
      </Card>
    </main>
  )
}
