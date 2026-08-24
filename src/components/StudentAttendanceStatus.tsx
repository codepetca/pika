'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ScanQrCode } from 'lucide-react'

import {
  fetchStudentAttendanceStatus,
  StudentAttendanceIdentityMismatchError,
} from '@/lib/student-attendance-client'
import type {
  StudentAttendanceClassroomState,
  StudentAttendanceStatusView,
} from '@/lib/validations/student-attendance'

const MIN_REFRESH_DELAY_MS = 1_000
const MAX_REFRESH_DELAY_MS = 24 * 60 * 60 * 1_000
const FAILED_REFRESH_RETRY_MS = 15_000

type ServerClockAnchor = {
  serverEpochMs: number
  monotonicEpochMs: number
}

function monotonicNow(): number {
  return typeof performance === 'undefined' ? 0 : performance.now()
}

function anchoredServerNow(anchor: ServerClockAnchor | null): number {
  if (!anchor) return Date.now()
  return anchor.serverEpochMs + Math.max(0, monotonicNow() - anchor.monotonicEpochMs)
}

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
  const serverClockRef = useRef<ServerClockAnchor | null>(null)

  const currentServerNow = useCallback(
    () => anchoredServerNow(serverClockRef.current),
    [],
  )

  const load = useCallback(async (isRefresh: boolean) => {
    if (!studentId) return
    if (isRefresh) setRefreshing(true)
    try {
      const next = await fetchStudentAttendanceStatus(studentId, { forceNetwork: isRefresh })
      if (mountedRef.current && activeStudentIdRef.current === studentId) {
        const serverEpochMs = Date.parse(next.serverNow)
        serverClockRef.current = { serverEpochMs, monotonicEpochMs: monotonicNow() }
        setNowMs(serverEpochMs)
        setView(next)
      }
    } catch (error) {
      if (
        error instanceof StudentAttendanceIdentityMismatchError
        && mountedRef.current
        && activeStudentIdRef.current === studentId
      ) {
        serverClockRef.current = null
        setView(null)
        setNowMs(Date.now())
      }
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
    serverClockRef.current = null
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
    const timeUntilTarget = targetTime - currentServerNow()
    const delay = timeUntilTarget <= 0
      ? FAILED_REFRESH_RETRY_MS
      : Math.min(MAX_REFRESH_DELAY_MS, Math.max(MIN_REFRESH_DELAY_MS, timeUntilTarget))
    const timer = window.setTimeout(() => {
      setNowMs(currentServerNow())
      void load(true)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [currentServerNow, load, refreshCycle, view])

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
    const remaining = Math.max(0, nextUnhandledBoundary - currentServerNow())
    const timer = window.setTimeout(() => {
      const serverNow = currentServerNow()
      setNowMs(serverNow)
      if (serverNow < nextUnhandledBoundary) return
      handledBoundaryTimesRef.current.add(nextUnhandledBoundary)
      void load(true)
    }, Math.min(MAX_REFRESH_DELAY_MS, remaining))
    return () => window.clearTimeout(timer)
  }, [currentServerNow, load, nowMs, refreshCycle, view])

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
  const Icon = confirmed ? CheckCircle2 : ScanQrCode

  if (variant === 'index') {
    return (
      <div
        className={`absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-control ${confirmed ? 'bg-success-bg text-success' : 'bg-surface-accent text-primary shadow-sm ring-1 ring-primary/30'}`}
        role="status"
        aria-label={confirmed ? `Attendance confirmed: ${statusLabel}` : 'Attendance check-in is open'}
        aria-live="polite"
        aria-busy={refreshing}
        data-testid="student-attendance-index-status"
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
    )
  }

  return (
    <section
      className={`flex gap-3 rounded-card border px-4 py-3 ${confirmed ? 'items-start border-success bg-success-bg' : 'items-center border-primary bg-surface-accent shadow-sm ring-1 ring-primary/30'}`}
      role="status"
      aria-live="polite"
      aria-busy={refreshing}
      data-testid="student-attendance-status"
    >
      <Icon
        className={`${confirmed ? 'mt-0.5 text-success' : 'text-primary'} h-5 w-5 shrink-0`}
        aria-hidden="true"
      />
      {confirmed ? (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-success">
            {`Checked in — ${statusLabel}`}
          </p>
          <p className="mt-0.5 text-sm text-text-muted">
            {timeLabel ? `Confirmed at ${timeLabel}.` : 'Your attendance is confirmed.'}
          </p>
        </div>
      ) : (
        <p className="min-w-0 text-sm font-semibold text-text-default">
          Scan QR for Attendance
        </p>
      )}
    </section>
  )
}
