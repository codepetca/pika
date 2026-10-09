'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, Clock3 } from 'lucide-react'
import { Button, Card, buttonVariants } from '@/ui'
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
  mode = 'occurrence',
  classroomName,
}: {
  entryToken: string
  canCheckIn: boolean
  mode?: 'occurrence' | 'classroom'
  classroomName?: string
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
  const retryRegionRef = useRef<HTMLDivElement>(null)

  const checkIn = useCallback(async (signal?: AbortSignal) => {
    if (!canCheckIn) return
    attemptIdRef.current ??= crypto.randomUUID()
    setView({ kind: 'loading' })
    try {
      const response = await fetch(mode === 'classroom'
        ? '/api/student/attendance/classroom-check-in'
        : '/api/student/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'classroom'
          ? { classroomQrToken: entryToken, attemptId: attemptIdRef.current }
          : { entryToken, attemptId: attemptIdRef.current }),
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
          parsed.data.studentId
          && parsed.data.classroomId
          && parsed.data.attendanceStatus
          && parsed.data.occurrenceBinding
        ) {
          preserveAuthoritativeStudentAttendanceConfirmation({
            studentId: parsed.data.studentId,
            classroomId: parsed.data.classroomId,
            occurrenceBinding: parsed.data.occurrenceBinding,
            attendanceStatus: parsed.data.attendanceStatus,
            ...(parsed.data.recordedAt ? { confirmedAt: parsed.data.recordedAt } : {}),
          })
        }
        invalidateStudentAttendanceStatus(parsed.data.studentId)
      }
      setView({ kind: 'result', result: parsed.data })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setView({ kind: 'unavailable' })
    }
  }, [canCheckIn, entryToken, mode])

  useEffect(() => {
    const controller = new AbortController()
    void checkIn(controller.signal)
    return () => controller.abort()
  }, [checkIn])

  const result = view.kind === 'result' ? view.result : null
  const positive = result?.state === 'checked_in' || result?.state === 'already_checked_in'
  const Icon = positive ? CheckCircle2 : result?.state === 'closed' ? Clock3 : AlertCircle
  const returnedClassroomName = result && 'classroomName' in result ? result.classroomName : undefined

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <Card className="flex min-h-96 w-full max-w-md flex-col justify-center p-6 text-center sm:p-8">
        <div
          ref={retryRegionRef}
          role="region"
          aria-label="Attendance check-in"
          tabIndex={-1}
          className="flex flex-col outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-offset-foundation focus-visible:ring-offset-surface"
        >
          <p className="break-words text-xl font-semibold text-primary">
            {returnedClassroomName || classroomName || 'Pika attendance'}
          </p>
          {view.kind === 'loading' ? (
            <div className="py-10" role="status" aria-live="polite">
              <Spinner size="lg" />
              <h1 className="mt-5 text-xl font-semibold text-text-default">Checking you in…</h1>
              <p className="mt-2 text-sm text-text-muted">Keep this page open for the result.</p>
            </div>
          ) : view.kind === 'unavailable' ? (
            <div className="pt-6" role="alert">
              <AlertCircle className="mx-auto h-12 w-12 text-warning" aria-hidden="true" />
              <h1 className="mt-4 text-xl font-semibold text-text-default">Not checked-in</h1>
              <Button className="mt-6 w-full" onClick={() => {
                retryRegionRef.current?.focus({ preventScroll: true })
                void checkIn()
              }}>Try again</Button>
            </div>
          ) : result ? (
            <div className="pt-6" role={positive ? 'status' : 'alert'} aria-live="polite">
              <Icon
                className={`mx-auto h-12 w-12 ${positive ? 'text-success' : 'text-warning'}`}
                aria-hidden="true"
              />
              <h1 className="mt-4 text-xl font-semibold text-text-default">{result.title}</h1>
              {!positive && result.description ? (
                <p className="mt-2 text-sm text-text-muted">{result.description}</p>
              ) : null}
              {result.recordedAt ? (
                <time className="mt-2 block text-xl text-text-muted" dateTime={result.recordedAt}>
                  {new Date(result.recordedAt).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'America/Toronto',
                  })}
                </time>
              ) : null}
            </div>
          ) : null}
          <Link
            className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'mt-8' })}
            href={positive && result?.classroomId
              ? `/classrooms/${result.classroomId}?tab=today`
              : '/classrooms'}
          >
            {positive && result?.classroomId ? 'Back to classroom' : 'Back to classrooms'}
          </Link>
        </div>
      </Card>
    </main>
  )
}
