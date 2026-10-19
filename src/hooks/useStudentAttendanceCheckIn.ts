'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { studentAttendanceCheckInViewSchema, type StudentAttendanceCheckInView } from '@/lib/validations/student-attendance'
import { fetchStudentAttendanceStatus, invalidateStudentAttendanceStatus, preserveAuthoritativeStudentAttendanceConfirmation } from '@/lib/student-attendance-client'
import { anchorAttendanceConfirmation, attendanceConfirmationNow, isCurrentAttendanceConfirmation, matchRefreshedAttendanceConfirmation, type AttendanceConfirmationClock, type CurrentAttendanceConfirmation } from '@/lib/student-attendance-confirmation'

type ViewState =
  | { kind: 'loading'; verifying?: boolean }
  | { kind: 'result'; result: StudentAttendanceCheckInView }
  | { kind: 'unavailable'; verifying?: boolean }

const expiredResult: StudentAttendanceCheckInView = {
  state: 'closed', title: 'Scan today’s attendance QR',
  description: 'This page no longer confirms attendance for today. Scan the current classroom QR to check in.',
}

export function useStudentAttendanceCheckIn({ entryToken, canCheckIn, mode }: {
  entryToken: string
  canCheckIn: boolean
  mode: 'occurrence' | 'classroom'
}) {
  const [view, setView] = useState<ViewState>({ kind: 'loading' })
  const attemptIdRef = useRef<string | null>(null)
  const generation = useRef(0)
  const confirmation = useRef<CurrentAttendanceConfirmation | null>(null)
  const clock = useRef<AttendanceConfirmationClock | null>(null)
  const reading = useRef(false)

  const acceptConfirmation = useCallback((next: CurrentAttendanceConfirmation, requestElapsedMs: number) => {
    const anchor = anchorAttendanceConfirmation(next.serverNow, requestElapsedMs)
    if (!isCurrentAttendanceConfirmation(next, attendanceConfirmationNow(anchor))) {
      confirmation.current = null
      clock.current = null
      setView({ kind: 'result', result: expiredResult })
      return
    }
    confirmation.current = next
    clock.current = anchor
    setView(document.visibilityState === 'hidden'
      ? { kind: 'loading', verifying: true }
      : { kind: 'result', result: next })
  }, [])

  const verify = useCallback(async () => {
    const previous = confirmation.current
    if (!previous || reading.current || document.visibilityState === 'hidden') return
    reading.current = true
    const request = ++generation.current
    const startedAt = anchorAttendanceConfirmation(new Date().toISOString())
    setView({ kind: 'loading', verifying: true })
    try {
      const status = await fetchStudentAttendanceStatus(previous.studentId, { forceNetwork: true })
      if (request !== generation.current) return
      const next = matchRefreshedAttendanceConfirmation(previous, status)
      if (next) acceptConfirmation(next, attendanceConfirmationNow(startedAt) - startedAt.serverMs)
      else {
        confirmation.current = null
        clock.current = null
        setView({ kind: 'result', result: expiredResult })
      }
    } catch {
      if (request === generation.current) setView({ kind: 'unavailable', verifying: true })
    } finally {
      if (request === generation.current) reading.current = false
    }
  }, [acceptConfirmation])

  const checkIn = useCallback(async (signal?: AbortSignal) => {
    if (!canCheckIn) return
    const request = ++generation.current
    const startedAt = anchorAttendanceConfirmation(new Date().toISOString())
    attemptIdRef.current ??= crypto.randomUUID()
    setView({ kind: 'loading' })
    try {
      const response = await fetch(mode === 'classroom'
        ? '/api/student/attendance/classroom-check-in'
        : '/api/student/attendance/check-in', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'classroom'
          ? { classroomQrToken: entryToken, attemptId: attemptIdRef.current }
          : { entryToken, attemptId: attemptIdRef.current }),
        cache: 'no-store', signal,
      })
      const parsed = studentAttendanceCheckInViewSchema.safeParse(await response.json())
      if (request !== generation.current) return
      if (!response.ok || !parsed.success) throw new Error('unavailable')
      attemptIdRef.current = null
      if (parsed.data.state === 'checked_in' || parsed.data.state === 'already_checked_in') {
        if (!isCurrentAttendanceConfirmation(parsed.data)) {
          setView({ kind: 'result', result: expiredResult })
          return
        }
        preserveAuthoritativeStudentAttendanceConfirmation({
          studentId: parsed.data.studentId, classroomId: parsed.data.classroomId,
          occurrenceBinding: parsed.data.occurrenceBinding, attendanceStatus: parsed.data.attendanceStatus,
          confirmedAt: parsed.data.recordedAt, classDate: parsed.data.classDate,
        })
        invalidateStudentAttendanceStatus(parsed.data.studentId)
        acceptConfirmation(parsed.data, attendanceConfirmationNow(startedAt) - startedAt.serverMs)
      } else setView({ kind: 'result', result: parsed.data })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (request === generation.current) setView({ kind: 'unavailable' })
    }
  }, [acceptConfirmation, canCheckIn, entryToken, mode])

  useEffect(() => {
    const controller = new AbortController()
    confirmation.current = null
    clock.current = null
    reading.current = false
    if (canCheckIn) void checkIn(controller.signal)
    else setView({ kind: 'result', result: {
      state: 'needs_staff', title: 'This check-in is for students',
      description: 'Sign in with a student account or ask the teacher for help.',
    } })
    return () => { controller.abort(); generation.current += 1 }
  }, [canCheckIn, checkIn])

  useEffect(() => {
    const suspend = () => {
      if (!confirmation.current) return
      generation.current += 1
      reading.current = false
      setView({ kind: 'loading', verifying: true })
    }
    const resume = () => { void verify() }
    const visibility = () => { if (document.visibilityState === 'hidden') suspend(); else resume() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', suspend)
    window.addEventListener('pageshow', resume)
    window.addEventListener('focus', resume)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', suspend)
      window.removeEventListener('pageshow', resume)
      window.removeEventListener('focus', resume)
    }
  }, [verify])

  useEffect(() => {
    const current = confirmation.current
    const anchor = clock.current
    if (!current || !anchor) return
    let timer: number
    const expire = () => {
      const remaining = Date.parse(current.validUntil) - attendanceConfirmationNow(anchor)
      if (remaining > 0) {
        timer = window.setTimeout(expire, Math.min(remaining, 2_147_483_647))
        return
      }
      generation.current += 1
      confirmation.current = null
      clock.current = null
      reading.current = false
      setView({ kind: 'result', result: expiredResult })
    }
    expire()
    return () => window.clearTimeout(timer)
  }, [view])

  return { view, retry: () => view.kind === 'unavailable' && view.verifying ? verify() : checkIn() }
}
