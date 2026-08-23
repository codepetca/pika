'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ScanLine } from 'lucide-react'

import { fetchStudentAttendanceStatus } from '@/lib/student-attendance-client'
import type {
  StudentAttendanceClassroomState,
  StudentAttendanceStatusView,
} from '@/lib/validations/student-attendance'

const MIN_REFRESH_DELAY_MS = 1_000
const MAX_REFRESH_DELAY_MS = 24 * 60 * 60 * 1_000
const FAILED_REFRESH_RETRY_MS = 15_000

function formatTorontoTime(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Toronto',
    timeZoneName: 'short',
  }).format(new Date(value))
}

export function resolveVisibleStudentAttendanceState(
  state: StudentAttendanceClassroomState | undefined,
  now = new Date(),
): StudentAttendanceClassroomState | null {
  if (!state) return null
  if (
    state.state === 'open'
    && state.closesAt
    && now.getTime() >= Date.parse(state.closesAt)
  ) return null
  if (
    state.state === 'confirmed'
    && state.validUntil
    && now.getTime() >= Date.parse(state.validUntil)
  ) return null
  return state.state === 'open' || state.state === 'confirmed' ? state : null
}

export function useStudentAttendanceStatusView(studentId?: string) {
  const [view, setView] = useState<StudentAttendanceStatusView | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [refreshCycle, setRefreshCycle] = useState(0)
  const mountedRef = useRef(true)
  const activeStudentIdRef = useRef(studentId)
  const handledBoundaryTimesRef = useRef(new Set<number>())

  const load = useCallback(async (isRefresh: boolean) => {
    if (!studentId) return
    if (isRefresh) setRefreshing(true)
    try {
      const next = await fetchStudentAttendanceStatus(studentId, { forceNetwork: isRefresh })
      if (mountedRef.current && activeStudentIdRef.current === studentId) setView(next)
    } catch {
      // Keep the last safe snapshot. A failed attendance read must not become
      // an empty state or an unearned confirmation.
    } finally {
      if (mountedRef.current && activeStudentIdRef.current === studentId) {
        setRefreshing(false)
        if (isRefresh) setRefreshCycle((cycle) => cycle + 1)
      }
    }
  }, [studentId])

  useEffect(() => {
    mountedRef.current = true
    activeStudentIdRef.current = studentId
    handledBoundaryTimesRef.current.clear()
    setView(null)
    setNowMs(Date.now())
    if (studentId) void load(false)
    return () => { mountedRef.current = false }
  }, [load, studentId])

  useEffect(() => {
    if (!view) return
    const nextRefreshTime = view.nextRefreshAt ? Date.parse(view.nextRefreshAt) : Number.NaN
    const localBoundaryTimes = view.classrooms.flatMap((state) => {
      const boundary = state.state === 'open'
        ? state.closesAt
        : state.state === 'confirmed' ? state.validUntil : null
      if (!boundary) return []
      const boundaryTime = Date.parse(boundary)
      return Number.isFinite(boundaryTime) ? [boundaryTime] : []
    })
    if (
      Number.isFinite(nextRefreshTime)
      && localBoundaryTimes.includes(nextRefreshTime)
      && !handledBoundaryTimesRef.current.has(nextRefreshTime)
    ) return
    const targetTime = Number.isFinite(nextRefreshTime)
      ? nextRefreshTime
      : Number.POSITIVE_INFINITY
    if (!Number.isFinite(targetTime)) return
    const timeUntilTarget = targetTime - Date.now()
    const delay = timeUntilTarget <= 0
      ? FAILED_REFRESH_RETRY_MS
      : Math.min(MAX_REFRESH_DELAY_MS, Math.max(MIN_REFRESH_DELAY_MS, timeUntilTarget))
    const timer = window.setTimeout(() => {
      setNowMs(Date.now())
      void load(true)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [load, refreshCycle, view])

  useEffect(() => {
    if (!view) return
    const nextUnhandledBoundary = view.classrooms.reduce((earliest, state) => {
      const boundary = state.state === 'open'
        ? state.closesAt
        : state.state === 'confirmed' ? state.validUntil : null
      if (!boundary) return earliest
      const boundaryTime = Date.parse(boundary)
      if (
        !Number.isFinite(boundaryTime)
        || handledBoundaryTimesRef.current.has(boundaryTime)
      ) {
        return earliest
      }
      return Math.min(earliest, boundaryTime)
    }, Number.POSITIVE_INFINITY)
    if (!Number.isFinite(nextUnhandledBoundary)) return
    const remaining = Math.max(0, nextUnhandledBoundary - Date.now())
    const timer = window.setTimeout(() => {
      setNowMs(Date.now())
      if (Date.now() < nextUnhandledBoundary) return
      handledBoundaryTimesRef.current.add(nextUnhandledBoundary)
      void load(true)
    }, Math.min(MAX_REFRESH_DELAY_MS, remaining))
    return () => window.clearTimeout(timer)
  }, [load, nowMs, refreshCycle, view])

  return { view, refreshing, now: new Date(nowMs) }
}

export function StudentAttendanceStatus({
  state: rawState,
  refreshing = false,
  now,
  variant,
}: {
  state: StudentAttendanceClassroomState | undefined
  refreshing?: boolean
  now?: Date
  variant: 'index' | 'banner'
}) {

  const state = useMemo(
    () => resolveVisibleStudentAttendanceState(rawState, now),
    [now, rawState],
  )
  if (!state) return null

  const confirmed = state.state === 'confirmed'
  const statusLabel = confirmed
    ? state.attendanceStatus === 'late' ? 'Late' : 'Present'
    : null
  const timeLabel = confirmed && state.confirmedAt
    ? formatTorontoTime(state.confirmedAt)
    : null
  const Icon = confirmed ? CheckCircle2 : ScanLine

  if (variant === 'index') {
    return (
      <div
        className={`mt-3 flex items-center gap-2 text-sm font-medium ${confirmed ? 'text-success' : 'text-primary'}`}
        role="status"
        aria-live="polite"
        aria-busy={refreshing}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {confirmed
            ? `Checked in · ${statusLabel}${timeLabel ? ` · ${timeLabel}` : ''}`
            : 'Attendance check-in is open · Scan your teacher’s QR'}
        </span>
      </div>
    )
  }

  return (
    <section
      className={`flex items-start gap-3 rounded-card border px-4 py-3 ${confirmed ? 'border-success bg-success-bg' : 'border-primary bg-surface-accent'}`}
      role="status"
      aria-live="polite"
      aria-busy={refreshing}
      data-testid="student-attendance-status"
    >
      <Icon
        className={`mt-0.5 h-5 w-5 shrink-0 ${confirmed ? 'text-success' : 'text-primary'}`}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${confirmed ? 'text-success' : 'text-text-default'}`}>
          {confirmed ? `Checked in — ${statusLabel}` : 'Attendance check-in is open'}
        </p>
        <p className="mt-0.5 text-sm text-text-muted">
          {confirmed
            ? timeLabel ? `Confirmed at ${timeLabel}.` : 'Your attendance is confirmed.'
            : 'Scan the QR shown by your teacher.'}
        </p>
      </div>
    </section>
  )
}
