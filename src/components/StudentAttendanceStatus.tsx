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
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Toronto',
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

export function useStudentAttendanceStatusView(studentId?: string, isActive = true) {
  const [view, setView] = useState<StudentAttendanceStatusView | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [refreshCycle, setRefreshCycle] = useState(0)
  const [retryWithoutView, setRetryWithoutView] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  )
  const documentVisibleRef = useRef(documentVisible)
  const isPollingActive = isActive && documentVisible
  const mountedRef = useRef(true)
  const isActiveRef = useRef(isActive)
  const activeStudentIdRef = useRef(studentId)
  const viewStudentIdRef = useRef<string | undefined>(undefined)
  const activityGenerationRef = useRef(0)
  const identityGenerationRef = useRef(0)
  const previousActivityRef = useRef(isPollingActive)
  const inFlightRef = useRef<{
    studentId: string
    activityGeneration: number
    identityGeneration: number
  } | null>(null)
  const loadRef = useRef<((isRefresh: boolean) => Promise<void>) | null>(null)
  const handledBoundaryTimesRef = useRef(new Set<number>())
  const serverClockRef = useRef<ServerClockAnchor | null>(null)
  isActiveRef.current = isActive

  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState !== 'hidden'
      const wasVisible = documentVisibleRef.current
      documentVisibleRef.current = visible
      setDocumentVisible(visible)
      if (!visible) {
        if (wasVisible) activityGenerationRef.current += 1
        previousActivityRef.current = false
      } else if (!wasVisible && isActiveRef.current) {
        previousActivityRef.current = true
        setNowMs(anchoredServerNow(serverClockRef.current))
        void loadRef.current?.(true)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  const currentServerNow = useCallback(
    () => anchoredServerNow(serverClockRef.current),
    [],
  )

  const load = useCallback(async (isRefresh: boolean) => {
    if (!studentId || !isActiveRef.current || document.visibilityState === 'hidden') return
    const activityGeneration = activityGenerationRef.current
    const identityGeneration = identityGenerationRef.current
    if (
      inFlightRef.current?.studentId === studentId
      && inFlightRef.current.activityGeneration === activityGeneration
      && inFlightRef.current.identityGeneration === identityGeneration
    ) return
    const request = { studentId, activityGeneration, identityGeneration }
    inFlightRef.current = request
    if (isRefresh) setRefreshing(true)
    try {
      const next = await fetchStudentAttendanceStatus(studentId, { forceNetwork: isRefresh })
      if (
        mountedRef.current
        && activeStudentIdRef.current === studentId
        && activityGenerationRef.current === activityGeneration
        && identityGenerationRef.current === identityGeneration
      ) {
        const serverEpochMs = Date.parse(next.serverNow)
        serverClockRef.current = { serverEpochMs, monotonicEpochMs: monotonicNow() }
        viewStudentIdRef.current = studentId
        setNowMs(serverEpochMs)
        setView(next)
        setRetryWithoutView(false)
      }
    } catch (error) {
      if (
        error instanceof StudentAttendanceIdentityMismatchError
        && mountedRef.current
        && activeStudentIdRef.current === studentId
        && activityGenerationRef.current === activityGeneration
        && identityGenerationRef.current === identityGeneration
      ) {
        serverClockRef.current = null
        viewStudentIdRef.current = undefined
        setView(null)
        setNowMs(Date.now())
        setRetryWithoutView(false)
      } else if (
        mountedRef.current
        && activeStudentIdRef.current === studentId
        && activityGenerationRef.current === activityGeneration
        && identityGenerationRef.current === identityGeneration
      ) {
        setRetryWithoutView(true)
      }
      // Keep the last safe snapshot. A failed attendance read must not become
      // an empty state or an unearned confirmation.
    } finally {
      if (inFlightRef.current === request) inFlightRef.current = null
      if (
        mountedRef.current
        && activeStudentIdRef.current === studentId
        && activityGenerationRef.current === activityGeneration
        && identityGenerationRef.current === identityGeneration
      ) {
        setRefreshing(false)
        if (isRefresh) setRefreshCycle((cycle) => cycle + 1)
      }
    }
  }, [studentId])
  loadRef.current = load

  useEffect(() => {
    mountedRef.current = true
    identityGenerationRef.current += 1
    activeStudentIdRef.current = studentId
    viewStudentIdRef.current = undefined
    handledBoundaryTimesRef.current.clear()
    serverClockRef.current = null
    setView(null)
    setNowMs(Date.now())
    setRetryWithoutView(false)
    if (studentId && isActiveRef.current && document.visibilityState !== 'hidden') void load(false)
    return () => { mountedRef.current = false }
  }, [load, studentId])

  useEffect(() => {
    if (!isPollingActive) {
      if (previousActivityRef.current) activityGenerationRef.current += 1
      previousActivityRef.current = false
      return
    }
    if (!previousActivityRef.current) {
      previousActivityRef.current = true
      setNowMs(currentServerNow())
      void load(true)
    }
  }, [currentServerNow, isPollingActive, load])

  useEffect(() => {
    if (!isPollingActive || !studentId || view || !retryWithoutView) return
    const timer = window.setTimeout(() => {
      void load(true)
    }, FAILED_REFRESH_RETRY_MS)
    return () => window.clearTimeout(timer)
  }, [isPollingActive, load, refreshCycle, retryWithoutView, studentId, view])

  useEffect(() => {
    if (!isPollingActive || !view) return
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
  }, [currentServerNow, isPollingActive, load, refreshCycle, view])

  useEffect(() => {
    if (!isPollingActive || !view) return
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
  }, [currentServerNow, isPollingActive, load, nowMs, refreshCycle, view])

  return {
    view: viewStudentIdRef.current === studentId ? view : null,
    refreshing,
    now: new Date(Math.max(nowMs, currentServerNow())),
  }
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
  const timeLabel = confirmed && state.confirmedAt
    ? formatTorontoTime(state.confirmedAt)
    : null
  const Icon = confirmed ? CheckCircle2 : ScanQrCode

  if (variant === 'index') {
    return (
      <div
        className={`absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-control ${confirmed ? 'bg-success-bg text-success' : 'bg-surface-accent text-primary shadow-sm ring-1 ring-primary/30'}`}
        role="status"
        aria-label={confirmed
          ? timeLabel ? `Checked in at ${timeLabel}` : 'Checked in'
          : 'Attendance check-in is open'}
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
      className={`flex items-center gap-3 rounded-card border px-4 py-3 ${confirmed ? 'border-success bg-success-bg' : 'border-primary bg-surface-accent shadow-sm ring-1 ring-primary/30'}`}
      role="status"
      aria-live="polite"
      aria-busy={refreshing}
      data-testid="student-attendance-status"
    >
      <Icon
        className={`${confirmed ? 'text-success' : 'text-primary'} h-5 w-5 shrink-0`}
        aria-hidden="true"
      />
      {confirmed ? (
        <p className="min-w-0 text-sm font-semibold text-success">
          {timeLabel ? `Checked in at ${timeLabel}` : 'Checked in'}
        </p>
      ) : (
        <p className="min-w-0 text-sm font-semibold text-text-default">
          Scan QR for Attendance
        </p>
      )}
    </section>
  )
}
