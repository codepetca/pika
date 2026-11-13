'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button, Card, buttonVariants } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { studentAttendanceCheckInViewSchema, type StudentAttendanceCheckInView } from '@/lib/validations/student-attendance'
import { isCurrentAttendanceConfirmation } from '@/lib/student-attendance-confirmation'
import { invalidateStudentAttendanceStatus, preserveAuthoritativeStudentAttendanceConfirmation } from '@/lib/student-attendance-client'

type View = { kind: 'choose' } | { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'result'; results: StudentAttendanceCheckInView[] | null }
export function RoomAttendanceCheckIn({ roomId, scanId, teacherMovePath }: {
  roomId: string
  scanId: string | null
  teacherMovePath?: string
}) {
  const [view, setView] = useState<View>(teacherMovePath ? { kind: 'choose' } : { kind: 'loading' })
  const attempt = useRef<string | null>(null)
  const run = useCallback(async (signal?: AbortSignal) => {
    if (!scanId) { setView({ kind: 'result', results: null }); return }
    attempt.current ??= crypto.randomUUID()
    setView({ kind: 'loading' })
    try {
      const response = await fetch('/api/student/attendance/room-check-in', { method: 'POST', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, scanId, attemptId: attempt.current }) })
      const body = await response.json()
      const parsed = body.results === null ? null : Array.isArray(body.results)
        ? body.results.map((value: unknown) => studentAttendanceCheckInViewSchema.parse(value)) : undefined
      if (!response.ok || parsed === undefined) throw new Error('unavailable')
      for (const result of parsed ?? []) {
        if (result.state === 'checked_in' || result.state === 'already_checked_in') {
          if (!isCurrentAttendanceConfirmation(result)) throw new Error('expired confirmation')
          preserveAuthoritativeStudentAttendanceConfirmation({ studentId: result.studentId, classroomId: result.classroomId,
            occurrenceBinding: result.occurrenceBinding, attendanceStatus: result.attendanceStatus,
            confirmedAt: result.recordedAt, classDate: result.classDate })
          invalidateStudentAttendanceStatus(result.studentId)
        }
      }
      setView({ kind: 'result', results: parsed })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setView({ kind: 'unavailable' })
    }
  }, [roomId, scanId])
  useEffect(() => {
    if (teacherMovePath) return
    const controller = new AbortController()
    void run(controller.signal)
    return () => controller.abort()
  }, [run, teacherMovePath])
  useEffect(() => {
    if (view.kind !== 'result' || !view.results?.some(result => result.state === 'checked_in' || result.state === 'already_checked_in')) return
    const suspend = () => setView({ kind: 'unavailable' })
    const visibility = () => { if (document.visibilityState === 'hidden') suspend() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', suspend)
    const expiries = view.results.flatMap(result => 'validUntil' in result && result.validUntil ? [Date.parse(result.validUntil)] : [])
    const timer = window.setTimeout(suspend, Math.max(0, Math.min(...expiries) - Date.now()))
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', suspend); window.clearTimeout(timer) }
  }, [view])
  return <main className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
    <Card className="flex min-h-96 w-full max-w-md flex-col justify-center p-6 text-center sm:p-8">
      <p className="text-xl font-semibold text-primary">Pika attendance</p>
      {view.kind === 'choose' ? <div className="space-y-3 pt-6">
        <h1 className="text-xl font-semibold text-text-default">Room attendance</h1>
        {teacherMovePath && <Link className={buttonVariants({ variant: 'secondary' })} href={teacherMovePath}>Manage room</Link>}
        {scanId && <Button onClick={() => void run()}>Check in as student</Button>}
      </div> : view.kind === 'loading' ? <div className="py-10" role="status"><Spinner size="lg" /><h1 className="mt-5 text-xl font-semibold text-text-default">Checking you in…</h1><p className="mt-2 text-sm text-text-muted">Keep this page open for the result.</p></div>
        : view.kind === 'unavailable' ? <div className="pt-6" role="alert"><AlertCircle className="mx-auto h-12 w-12 text-warning" aria-hidden="true" /><h1 className="mt-4 text-xl font-semibold text-text-default">Unable to confirm check-in</h1><Button className="mt-6 w-full" onClick={() => void run()}>Try again</Button></div>
        : !view.results?.length ? <div className="pt-6" role="alert"><AlertCircle className="mx-auto h-12 w-12 text-warning" aria-hidden="true" /><h1 className="mt-4 text-xl font-semibold text-text-default">Unable to check in</h1><p className="mt-2 text-sm text-text-muted">Scan the current room QR again, or ask your teacher for help.</p></div>
        : <div className="space-y-6 pt-6" aria-live="polite">{view.results.map((result, index) => {
          const positive = result.state === 'checked_in' || result.state === 'already_checked_in'
          const Icon = positive ? CheckCircle2 : AlertCircle
          return <div key={index}><Icon className={`mx-auto h-10 w-10 ${positive ? 'text-success' : 'text-warning'}`} aria-hidden="true" /><h1 className="mt-3 text-xl font-semibold text-text-default">{result.title}</h1>{'classroomName' in result && result.classroomName ? <p className="mt-2 text-sm text-text-muted">{result.classroomName}</p> : null}{!positive && result.description ? <p className="mt-2 text-sm text-text-muted">{result.description}</p> : null}</div>
        })}
        {view.results.some(result => result.state === 'needs_staff') &&
          <Button variant="secondary" onClick={() => void run()}>Try again</Button>}
        </div>}
      <Link className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'mt-8' })} href="/classrooms">Back to classrooms</Link>
    </Card>
  </main>
}
