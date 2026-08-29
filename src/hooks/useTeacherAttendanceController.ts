'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTableSelection } from '@/hooks/useTableSelection'
import { fetchJSON } from '@/lib/request-cache'
import type {
  TeacherAttendanceQrPresentation,
  TeacherAttendanceStatus,
  TeacherAttendanceView,
} from '@/lib/teacher-attendance'
import type { Classroom } from '@/types'
import { useAppMessage } from '@/ui'

export type TeacherAttendanceMark = Exclude<TeacherAttendanceStatus, 'unmarked'>
export type TeacherAttendanceSessionCommand = 'open' | 'close'

const STATUS_LABELS: Record<TeacherAttendanceStatus, string> = {
  unmarked: 'Unmarked',
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
}

const SESSION_LABELS: Record<TeacherAttendanceView['session']['state'], string> = {
  not_scheduled: 'Not scheduled',
  scheduled: 'Scheduled',
  open: 'Open',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

function attendanceUrl(classroomId: string, classDate: string) {
  const params = new URLSearchParams({ classroom_id: classroomId, date: classDate })
  return `/api/teacher/attendance/session?${params.toString()}`
}

function attendanceQrUrl(classroomId: string, classDate: string) {
  const params = new URLSearchParams({ classroom_id: classroomId, date: classDate })
  return `/api/teacher/attendance/qr?${params.toString()}`
}

export function formatTeacherAttendanceTime(instant: string | null) {
  if (!instant) return null
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(instant))
}

function attendanceWindow(view: TeacherAttendanceView) {
  const opensAt = formatTeacherAttendanceTime(view.session.opensAt)
  const closesAt = formatTeacherAttendanceTime(view.session.closesAt)
  if (!opensAt || !closesAt) return null
  return `${opensAt} - ${closesAt}`
}

function createRequestId() {
  return crypto.randomUUID()
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

interface UseTeacherAttendanceControllerOptions {
  classroom: Classroom
  selectedDate: string
  enabled: boolean
  isActive: boolean
}

export function useTeacherAttendanceController({
  classroom,
  selectedDate,
  enabled,
  isActive,
}: UseTeacherAttendanceControllerOptions) {
  const { showMessage } = useAppMessage()
  const [view, setView] = useState<TeacherAttendanceView | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [activeCommand, setActiveCommand] = useState<string | null>(null)
  const [localPendingStudentIds, setLocalPendingStudentIds] = useState<Set<string>>(new Set())
  const [localSessionPending, setLocalSessionPending] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState('')
  const [qrPresentation, setQrPresentation] = useState<TeacherAttendanceQrPresentation | null>(null)
  const [attendanceHoursOpen, setAttendanceHoursOpen] = useState(false)
  const requestSequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const currentViewKeyRef = useRef(`${classroom.id}:${selectedDate}`)
  currentViewKeyRef.current = `${classroom.id}:${selectedDate}`

  const readView = useCallback(async () => {
    return await fetchJSON<TeacherAttendanceView>(attendanceUrl(classroom.id, selectedDate), {
      errorMessage: 'Attendance is temporarily unavailable',
    })
  }, [classroom.id, selectedDate])

  const loadView = useCallback(async (background = false) => {
    if (!enabled || !selectedDate) return null
    const sequence = ++requestSequenceRef.current
    if (background) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const next = await readView()
      if (!mountedRef.current || sequence !== requestSequenceRef.current) return null
      setView(next)
      return next
    } catch (loadError) {
      if (!mountedRef.current || sequence !== requestSequenceRef.current) return null
      setError(loadError instanceof Error ? loadError.message : 'Attendance is temporarily unavailable')
      return null
    } finally {
      if (mountedRef.current && sequence === requestSequenceRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [enabled, readView, selectedDate])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    requestSequenceRef.current += 1
    setView(null)
    setError('')
    setLocalPendingStudentIds(new Set())
    setLocalSessionPending(false)
    setQrOpen(false)
    setQrLoading(false)
    setQrError('')
    setQrPresentation(null)
    setAttendanceHoursOpen(false)
    if (enabled && isActive && selectedDate) void loadView()
  }, [classroom.id, enabled, isActive, loadView, selectedDate])

  useEffect(() => {
    if (!qrPresentation) return
    const expiresAt = Date.parse(qrPresentation.expiresAt)
    let timer: number | undefined

    const expireWhenDue = () => {
      const remaining = expiresAt - Date.now()
      if (remaining > 0) {
        timer = window.setTimeout(expireWhenDue, Math.min(remaining, 2_147_483_647))
        return
      }
      setQrPresentation(null)
      setQrError('This QR code has expired')
    }

    expireWhenDue()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [qrPresentation])

  const students = useMemo(() => view?.students ?? [], [view?.students])
  const studentsById = useMemo(
    () => new Map(students.map((student) => [student.studentId, student])),
    [students],
  )
  const selectableStudentIds = useMemo(
    () => students.filter((student) => !student.pendingCommand).map((student) => student.studentId),
    [students],
  )
  const {
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    allSelected,
    someSelected,
    clearSelection,
    selectedCount,
  } = useTableSelection(selectableStudentIds)

  useEffect(() => {
    clearSelection()
  }, [classroom.id, clearSelection, enabled, selectedDate])

  const isArchived = Boolean(classroom.archived_at)
  const sessionState = view?.session.state ?? 'not_scheduled'
  const attendanceReady = enabled && view?.integration === 'ready'
  const canMark = Boolean(
    attendanceReady &&
    (sessionState === 'open' || sessionState === 'closed') &&
    !isArchived,
  )
  const pendingStudentIds = useMemo(() => {
    const ids = new Set(localPendingStudentIds)
    for (const student of students) {
      if (student.pendingCommand) ids.add(student.studentId)
    }
    return ids
  }, [localPendingStudentIds, students])
  const selectedHasPendingStudent = useMemo(
    () => [...selectedIds].some((studentId) => pendingStudentIds.has(studentId)),
    [pendingStudentIds, selectedIds],
  )
  const failedStudentCount = useMemo(
    () => students.filter((student) => student.commandFailed).length,
    [students],
  )

  const pollForConfirmation = useCallback(async (
    viewKey: string,
    isConfirmed: (next: TeacherAttendanceView) => boolean,
  ) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) await wait(750)
      if (!mountedRef.current || currentViewKeyRef.current !== viewKey) return false
      try {
        const next = await readView()
        if (!mountedRef.current || currentViewKeyRef.current !== viewKey) return false
        setView(next)
        if (isConfirmed(next)) return true
      } catch {
        // Keep the last confirmed projection visible and retry within this bounded window.
      }
    }
    return false
  }, [readView])

  const submitSessionCommand = useCallback(async (command: TeacherAttendanceSessionCommand) => {
    if (!view || activeCommand) return
    const commandViewKey = currentViewKeyRef.current
    const expectedState = command === 'open' ? 'open' : 'closed'
    const previousRevision = view.session.revision
    setActiveCommand(`session:${command}`)
    setLocalSessionPending(true)
    try {
      await fetchJSON('/api/teacher/attendance/session', {
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroom.id,
            date: selectedDate,
            request_id: createRequestId(),
            command,
          }),
        },
        errorMessage: 'Attendance is temporarily unavailable',
      })
      const confirmed = await pollForConfirmation(commandViewKey, (next) => (
        next.session.state === expectedState && next.session.revision !== previousRevision
      ))
      if (confirmed) {
        setLocalSessionPending(false)
        showMessage({ text: command === 'open' ? 'Attendance opened' : 'Attendance closed', tone: 'info' })
      } else {
        showMessage({ text: 'Update sent; waiting for attendance confirmation', tone: 'info' })
      }
    } catch (commandError) {
      setLocalSessionPending(false)
      showMessage({
        text: commandError instanceof Error ? commandError.message : 'Attendance is temporarily unavailable',
        tone: 'warning',
      })
    } finally {
      setActiveCommand(null)
    }
  }, [activeCommand, classroom.id, pollForConfirmation, selectedDate, showMessage, view])

  const submitMarks = useCallback(async (
    ids: string[],
    status: 'automatic' | TeacherAttendanceMark,
    options?: { successText?: string; clearSelectionAfter?: boolean },
  ) => {
    if (!view || activeCommand || ids.length === 0) return
    const commandViewKey = currentViewKeyRef.current
    const idSet = new Set(ids)
    const previousRecords = new Map(
      view.students
        .filter((student) => idSet.has(student.studentId))
        .map((student) => [student.studentId, {
          status: student.status,
          revision: student.revision,
        }]),
    )
    setActiveCommand(`marks:${status}`)
    setLocalPendingStudentIds((current) => new Set([...current, ...ids]))
    try {
      await fetchJSON('/api/teacher/attendance/marks', {
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroom.id,
            date: selectedDate,
            request_id: createRequestId(),
            marks: ids.map((studentId) => ({
              student_id: studentId,
              status,
              reason_code: 'staff_correction',
            })),
          }),
        },
        errorMessage: 'Attendance is temporarily unavailable',
      })
      const confirmed = await pollForConfirmation(commandViewKey, (next) => ids.every((studentId) => {
        const student = next.students.find((candidate) => candidate.studentId === studentId)
        const previous = previousRecords.get(studentId)
        return Boolean(
          student &&
          (status === 'automatic' ? !student.hasManualOverride : student.status === status) &&
          (status === 'automatic' || previous?.status === status || student.revision !== previous?.revision) &&
          !student.pendingCommand
        )
      }))
      if (confirmed) {
        setLocalPendingStudentIds((current) => {
          const next = new Set(current)
          ids.forEach((studentId) => next.delete(studentId))
          return next
        })
        if (options?.clearSelectionAfter) clearSelection()
        showMessage({
          text: options?.successText ?? (status === 'automatic'
            ? `Automatic status restored for ${ids.length} ${ids.length === 1 ? 'student' : 'students'}`
            : `${ids.length} ${ids.length === 1 ? 'student' : 'students'} marked ${STATUS_LABELS[status].toLowerCase()}`),
          tone: 'info',
        })
      } else {
        showMessage({ text: 'Update sent; waiting for attendance confirmation', tone: 'info' })
      }
    } catch (commandError) {
      setLocalPendingStudentIds((current) => {
        const next = new Set(current)
        ids.forEach((studentId) => next.delete(studentId))
        return next
      })
      showMessage({
        text: commandError instanceof Error ? commandError.message : 'Attendance is temporarily unavailable',
        tone: 'warning',
      })
    } finally {
      setActiveCommand(null)
    }
  }, [activeCommand, classroom.id, clearSelection, pollForConfirmation, selectedDate, showMessage, view])

  const resetCheckIns = useCallback(async (studentIds: string[]) => {
    if (!view || activeCommand || studentIds.length === 0) return
    const ids = studentIds.filter((studentId) =>
      view.students.some((student) => student.studentId === studentId && student.hasQrCheckIn)
    )
    if (ids.length === 0) {
      showMessage({ text: 'No selected students have a QR check-in', tone: 'info' })
      return
    }
    if (!window.confirm(
      `Remove ${ids.length} ${ids.length === 1 ? 'QR check-in' : 'QR check-ins'}? The audit history will be kept, and students may scan again while QR check-in is open.`
    )) return
    const commandViewKey = currentViewKeyRef.current
    setActiveCommand('check-ins:reset')
    setLocalPendingStudentIds((current) => new Set([...current, ...ids]))
    try {
      await fetchJSON('/api/teacher/attendance/check-ins', {
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroom.id,
            date: selectedDate,
            request_id: createRequestId(),
            student_ids: ids,
          }),
        },
        errorMessage: 'QR check-ins could not be removed',
      })
      const confirmed = await pollForConfirmation(commandViewKey, (next) => ids.every((studentId) =>
        next.students.find((student) => student.studentId === studentId)?.hasQrCheckIn === false
      ))
      if (confirmed) {
        setLocalPendingStudentIds((current) => {
          const next = new Set(current)
          ids.forEach((studentId) => next.delete(studentId))
          return next
        })
        clearSelection()
        showMessage({ text: `${ids.length} ${ids.length === 1 ? 'QR check-in' : 'QR check-ins'} removed`, tone: 'info' })
      } else {
        showMessage({ text: 'Removal sent; waiting for confirmation', tone: 'info' })
      }
    } catch (commandError) {
      setLocalPendingStudentIds((current) => {
        const next = new Set(current)
        ids.forEach((studentId) => next.delete(studentId))
        return next
      })
      showMessage({
        text: commandError instanceof Error ? commandError.message : 'QR check-ins could not be removed',
        tone: 'warning',
      })
    } finally {
      setActiveCommand(null)
    }
  }, [activeCommand, classroom.id, clearSelection, pollForConfirmation, selectedDate, showMessage, view])

  const loadQrPresentation = useCallback(async () => {
    if (qrLoading || sessionState !== 'open') return
    const requestViewKey = currentViewKeyRef.current
    setQrLoading(true)
    setQrError('')
    setQrPresentation(null)
    try {
      const presentation = await fetchJSON<TeacherAttendanceQrPresentation>(
        attendanceQrUrl(classroom.id, selectedDate),
        { errorMessage: 'Attendance QR is temporarily unavailable' },
      )
      const entryUrl = new URL(presentation.entryPath, window.location.origin)
      const expiresAt = Date.parse(presentation.expiresAt)
      if (
        currentViewKeyRef.current !== requestViewKey ||
        entryUrl.origin !== window.location.origin ||
        !/^\/attendance\/check-in\/[A-Za-z0-9_-]{80,768}$/.test(entryUrl.pathname) ||
        entryUrl.search ||
        entryUrl.hash ||
        !Number.isInteger(presentation.revision) ||
        presentation.revision < 1 ||
        !Number.isFinite(expiresAt)
      ) {
        throw new Error('Attendance QR is temporarily unavailable')
      }
      if (expiresAt <= Date.now()) throw new Error('This QR code has expired')
      setQrPresentation(presentation)
    } catch (loadError) {
      if (currentViewKeyRef.current === requestViewKey) {
        setQrError(loadError instanceof Error ? loadError.message : 'Attendance QR is temporarily unavailable')
      }
    } finally {
      if (currentViewKeyRef.current === requestViewKey) setQrLoading(false)
    }
  }, [classroom.id, qrLoading, selectedDate, sessionState])

  const openQrPresentation = useCallback(() => {
    setQrOpen(true)
    void loadQrPresentation()
  }, [loadQrPresentation])

  const copyQrLink = useCallback(async () => {
    if (!qrPresentation) return
    try {
      const entryUrl = new URL(qrPresentation.entryPath, window.location.origin).toString()
      await navigator.clipboard.writeText(entryUrl)
      showMessage({ text: 'Attendance link copied', tone: 'success' })
    } catch {
      showMessage({ text: 'Could not copy attendance link', tone: 'warning' })
    }
  }, [qrPresentation, showMessage])

  const sessionAction = attendanceReady && !isArchived
    ? sessionState === 'scheduled'
      ? { command: 'open' as const, label: 'Open QR check-in' }
      : sessionState === 'open'
        ? { command: 'close' as const, label: 'Stop QR check-in' }
        : null
    : null
  const windowLabel = attendanceReady && view ? attendanceWindow(view) : null
  const hasUnconfirmedView = attendanceReady && Boolean(
    view?.sync.state === 'stale' || view?.sync.state === 'unavailable'
  )
  const sessionContextLabel = hasUnconfirmedView
    ? 'Last confirmed'
    : localSessionPending || view?.sync.state === 'pending'
      ? 'Updating…'
      : SESSION_LABELS[sessionState]

  return {
    view,
    students,
    studentsById,
    loading,
    refreshing,
    error,
    activeCommand,
    localSessionPending,
    attendanceReady,
    canMark,
    sessionState,
    sessionAction,
    windowLabel,
    hasUnconfirmedView,
    sessionContextLabel,
    pendingStudentIds,
    failedStudentCount,
    selectedIds,
    selectedCount,
    selectedHasPendingStudent,
    allSelected,
    someSelected,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    loadView,
    submitSessionCommand,
    submitMarks,
    resetCheckIns,
    qrOpen,
    setQrOpen,
    qrLoading,
    qrError,
    qrPresentation,
    loadQrPresentation,
    openQrPresentation,
    copyQrLink,
    attendanceHoursOpen,
    setAttendanceHoursOpen,
  }
}
