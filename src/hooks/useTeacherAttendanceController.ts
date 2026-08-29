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

type AttendanceConfirmationOutcome = 'confirmed' | 'failed' | 'pending'
type AttendancePollOutcome = AttendanceConfirmationOutcome | 'cancelled'

interface PendingConfirmationBase {
  id: string
  viewKey: string
  generation: number
  successText: string
  failureText: string
}

type PendingAttendanceConfirmation =
  | (PendingConfirmationBase & {
      kind: 'session'
      expectedState: 'open' | 'closed'
      previousRevision: number | null
    })
  | (PendingConfirmationBase & {
      kind: 'marks'
      studentIds: string[]
      status: 'automatic' | TeacherAttendanceMark
      previousRecords: Record<string, {
        status: TeacherAttendanceStatus
        revision: number | null
      }>
      clearSelectionAfter: boolean
    })
  | (PendingConfirmationBase & {
      kind: 'check-ins'
      studentIds: string[]
      clearSelectionAfter: boolean
    })

function confirmationOutcome(
  confirmation: PendingAttendanceConfirmation,
  next: TeacherAttendanceView,
): AttendanceConfirmationOutcome {
  if (confirmation.kind === 'session') {
    if (
      next.session.state === confirmation.expectedState
      && next.session.revision !== confirmation.previousRevision
    ) return 'confirmed'
    if (next.sync.state === 'pending') return 'pending'
    return next.session.commandFailed ? 'failed' : 'pending'
  }

  if (confirmation.kind === 'check-ins') {
    const students = confirmation.studentIds.map((studentId) =>
      next.students.find((student) => student.studentId === studentId)
    )
    if (students.every((student) => student?.hasQrCheckIn === false)) return 'confirmed'
    if (students.some((student) => student?.pendingCommand)) return 'pending'
    return students.some((student) => student?.commandFailed) ? 'failed' : 'pending'
  }

  const confirmed = confirmation.studentIds.every((studentId) => {
    const student = next.students.find((candidate) => candidate.studentId === studentId)
    const previous = confirmation.previousRecords[studentId]
    return Boolean(
      student
      && (confirmation.status === 'automatic'
        ? !student.hasManualOverride
        : student.status === confirmation.status)
      && (confirmation.status === 'automatic'
        || previous?.status === confirmation.status
        || student.revision !== previous?.revision)
      && !student.pendingCommand
    )
  })
  return confirmed ? 'confirmed' : 'pending'
}

interface UseTeacherAttendanceControllerOptions {
  classroom: Classroom
  selectedDate: string
  enabled: boolean
  isActive: boolean
  visibleStudentIds?: string[]
}

export function useTeacherAttendanceController({
  classroom,
  selectedDate,
  enabled,
  isActive,
  visibleStudentIds,
}: UseTeacherAttendanceControllerOptions) {
  const { showMessage } = useAppMessage()
  const [view, setView] = useState<TeacherAttendanceView | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [activeCommand, setActiveCommand] = useState<string | null>(null)
  const [localPendingStudentIds, setLocalPendingStudentIds] = useState<Set<string>>(new Set())
  const [localSessionPending, setLocalSessionPending] = useState(false)
  const [pendingConfirmations, setPendingConfirmations] = useState<PendingAttendanceConfirmation[]>([])
  const [qrOpen, setQrOpen] = useState(false)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState('')
  const [qrPresentation, setQrPresentation] = useState<TeacherAttendanceQrPresentation | null>(null)
  const [attendanceHoursOpen, setAttendanceHoursOpen] = useState(false)
  const requestSequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const currentViewKey = `${classroom.id}:${selectedDate}`
  const currentScopeKey = `${currentViewKey}:${enabled ? 'enabled' : 'disabled'}:${isActive ? 'active' : 'inactive'}`
  const currentViewKeyRef = useRef(currentViewKey)
  const currentScopeKeyRef = useRef(currentScopeKey)
  const viewGenerationRef = useRef(0)
  const activeCommandRequestRef = useRef<string | null>(null)
  const localPendingStudentIdsRef = useRef<Set<string>>(new Set())
  const localSessionPendingRef = useRef(false)
  currentViewKeyRef.current = currentViewKey
  if (currentScopeKeyRef.current !== currentScopeKey) {
    currentScopeKeyRef.current = currentScopeKey
    viewGenerationRef.current += 1
  }

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
      activeCommandRequestRef.current = null
      viewGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    requestSequenceRef.current += 1
    setView(null)
    setError('')
    activeCommandRequestRef.current = null
    setActiveCommand(null)
    localPendingStudentIdsRef.current = new Set()
    setLocalPendingStudentIds(new Set())
    localSessionPendingRef.current = false
    setLocalSessionPending(false)
    setPendingConfirmations([])
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
  const visibleStudentIdSet = useMemo(
    () => visibleStudentIds ? new Set(visibleStudentIds) : null,
    [visibleStudentIds],
  )
  const selectableStudentIds = useMemo(
    () => students
      .filter((student) => (
        !student.pendingCommand
        && (!visibleStudentIdSet || visibleStudentIdSet.has(student.studentId))
      ))
      .map((student) => student.studentId),
    [students, visibleStudentIdSet],
  )
  const selectableStudentIdSet = useMemo(
    () => new Set(selectableStudentIds),
    [selectableStudentIds],
  )
  const {
    selectedIds: tableSelectedIds,
    toggleSelect: toggleTableSelect,
    toggleSelectAll,
    allSelected,
    clearSelection,
  } = useTableSelection(selectableStudentIds)
  const selectedIds = useMemo(
    () => new Set([...tableSelectedIds].filter((studentId) => selectableStudentIdSet.has(studentId))),
    [selectableStudentIdSet, tableSelectedIds],
  )
  const selectedCount = selectedIds.size
  const someSelected = selectedCount > 0 && !allSelected
  const toggleSelect = useCallback((studentId: string) => {
    if (selectableStudentIdSet.has(studentId)) toggleTableSelect(studentId)
  }, [selectableStudentIdSet, toggleTableSelect])

  useEffect(() => {
    clearSelection()
  }, [classroom.id, clearSelection, enabled, selectedDate])

  const isArchived = Boolean(classroom.archived_at)
  const sessionState = view?.session.state ?? 'not_scheduled'
  const sessionPending = localSessionPending || Boolean(view?.session.pendingCommand)
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

  const addLocalPendingStudents = useCallback((studentIds: string[]) => {
    const next = new Set(localPendingStudentIdsRef.current)
    studentIds.forEach((studentId) => next.add(studentId))
    localPendingStudentIdsRef.current = next
    setLocalPendingStudentIds(next)
  }, [])

  const clearLocalPendingStudents = useCallback((studentIds: string[]) => {
    const next = new Set(localPendingStudentIdsRef.current)
    studentIds.forEach((studentId) => next.delete(studentId))
    localPendingStudentIdsRef.current = next
    setLocalPendingStudentIds(next)
  }, [])

  const setLocalSessionPendingState = useCallback((pending: boolean) => {
    localSessionPendingRef.current = pending
    setLocalSessionPending(pending)
  }, [])

  const pollForConfirmation = useCallback(async (
    viewKey: string,
    generation: number,
    getOutcome: (next: TeacherAttendanceView) => AttendanceConfirmationOutcome,
  ): Promise<AttendancePollOutcome> => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) await wait(750)
      if (
        !mountedRef.current
        || currentViewKeyRef.current !== viewKey
        || viewGenerationRef.current !== generation
      ) return 'cancelled'
      try {
        const next = await readView()
        if (
          !mountedRef.current
          || currentViewKeyRef.current !== viewKey
          || viewGenerationRef.current !== generation
        ) return 'cancelled'
        setView(next)
        const outcome = getOutcome(next)
        if (outcome !== 'pending') return outcome
      } catch {
        // Keep the last confirmed projection visible and retry within this bounded window.
      }
    }
    return viewGenerationRef.current === generation ? 'pending' : 'cancelled'
  }, [readView])

  useEffect(() => {
    if (!enabled || !isActive || pendingConfirmations.length === 0) return
    const viewKey = currentViewKeyRef.current
    const generation = viewGenerationRef.current
    const confirmations = pendingConfirmations.filter((confirmation) =>
      confirmation.viewKey === viewKey && confirmation.generation === generation
    )
    if (confirmations.length === 0) return

    let cancelled = false
    let timer: number | undefined

    const scheduleRevalidation = () => {
      timer = window.setTimeout(async () => {
        if (
          cancelled
          || !mountedRef.current
          || currentViewKeyRef.current !== viewKey
          || viewGenerationRef.current !== generation
        ) return
        try {
          const next = await readView()
          if (
            cancelled
            || !mountedRef.current
            || currentViewKeyRef.current !== viewKey
            || viewGenerationRef.current !== generation
          ) return
          setView(next)

          const resolved = confirmations
            .map((confirmation) => ({
              confirmation,
              outcome: confirmationOutcome(confirmation, next),
            }))
            .filter((result) => result.outcome !== 'pending')
          if (resolved.length === 0) {
            scheduleRevalidation()
            return
          }

          const resolvedIds = new Set(resolved.map(({ confirmation }) => confirmation.id))
          setPendingConfirmations((current) =>
            current.filter((confirmation) => !resolvedIds.has(confirmation.id))
          )
          const studentIds = resolved.flatMap(({ confirmation }) =>
            confirmation.kind === 'session' ? [] : confirmation.studentIds
          )
          if (studentIds.length > 0) clearLocalPendingStudents(studentIds)
          if (resolved.some(({ confirmation, outcome }) =>
            outcome === 'confirmed'
            && confirmation.kind !== 'session'
            && confirmation.clearSelectionAfter
          )) clearSelection()
          if (resolved.some(({ confirmation }) => confirmation.kind === 'session')) {
            setLocalSessionPendingState(false)
          }

          for (const { confirmation, outcome } of resolved) {
            showMessage({
              text: outcome === 'confirmed' ? confirmation.successText : confirmation.failureText,
              tone: outcome === 'confirmed' ? 'info' : 'warning',
            })
          }
        } catch {
          if (!cancelled) scheduleRevalidation()
        }
      }, 3_000)
    }

    scheduleRevalidation()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [
    clearLocalPendingStudents,
    clearSelection,
    enabled,
    isActive,
    pendingConfirmations,
    readView,
    setLocalSessionPendingState,
    showMessage,
  ])

  const submitSessionCommand = useCallback(async (command: TeacherAttendanceSessionCommand) => {
    if (
      !view
      || activeCommandRequestRef.current
      || localSessionPendingRef.current
      || view.session.pendingCommand
      || view.classroomId !== classroom.id
      || view.classDate !== selectedDate
    ) return
    const commandViewKey = currentViewKeyRef.current
    const commandGeneration = viewGenerationRef.current
    const expectedState = command === 'open' ? 'open' : 'closed'
    const requestId = createRequestId()
    const confirmation: PendingAttendanceConfirmation = {
      id: requestId,
      kind: 'session',
      viewKey: commandViewKey,
      generation: commandGeneration,
      expectedState,
      previousRevision: view.session.revision,
      successText: command === 'open' ? 'Attendance opened' : 'Attendance closed',
      failureText: command === 'open'
        ? 'Attendance could not be opened'
        : 'Attendance could not be closed',
    }
    activeCommandRequestRef.current = requestId
    setActiveCommand(`session:${command}`)
    setLocalSessionPendingState(true)
    try {
      await fetchJSON('/api/teacher/attendance/session', {
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroom.id,
            date: selectedDate,
            request_id: requestId,
            command,
          }),
        },
        errorMessage: 'Attendance is temporarily unavailable',
      })
      const outcome = await pollForConfirmation(
        commandViewKey,
        commandGeneration,
        (next) => confirmationOutcome(confirmation, next),
      )
      if (outcome === 'confirmed') {
        setLocalSessionPendingState(false)
        showMessage({ text: confirmation.successText, tone: 'info' })
      } else if (outcome === 'failed') {
        setLocalSessionPendingState(false)
        showMessage({ text: confirmation.failureText, tone: 'warning' })
      } else if (outcome === 'pending') {
        setPendingConfirmations((current) => [...current, confirmation])
        showMessage({ text: 'Update sent; waiting for attendance confirmation', tone: 'info' })
      }
    } catch (commandError) {
      if (
        currentViewKeyRef.current === commandViewKey
        && viewGenerationRef.current === commandGeneration
      ) {
        setLocalSessionPendingState(false)
        showMessage({
          text: commandError instanceof Error ? commandError.message : 'Attendance is temporarily unavailable',
          tone: 'warning',
        })
      }
    } finally {
      if (activeCommandRequestRef.current === requestId) {
        activeCommandRequestRef.current = null
        setActiveCommand(null)
      }
    }
  }, [
    classroom.id,
    pollForConfirmation,
    selectedDate,
    setLocalSessionPendingState,
    showMessage,
    view,
  ])

  const submitMarks = useCallback(async (
    ids: string[],
    status: 'automatic' | TeacherAttendanceMark,
    options?: { successText?: string; clearSelectionAfter?: boolean },
  ) => {
    if (
      !view
      || activeCommandRequestRef.current
      || ids.length === 0
      || ids.some((studentId) => !studentsById.has(studentId))
      || Boolean(
        visibleStudentIdSet
        && ids.some((studentId) => !visibleStudentIdSet.has(studentId))
      )
      || ids.some((studentId) => localPendingStudentIdsRef.current.has(studentId))
      || ids.some((studentId) =>
        view.students.some((student) => student.studentId === studentId && student.pendingCommand)
      )
      || view.classroomId !== classroom.id
      || view.classDate !== selectedDate
    ) return
    const commandViewKey = currentViewKeyRef.current
    const commandGeneration = viewGenerationRef.current
    const idSet = new Set(ids)
    const previousRecords = Object.fromEntries(
      view.students
        .filter((student) => idSet.has(student.studentId))
        .map((student) => [student.studentId, {
          status: student.status,
          revision: student.revision,
        }]),
    )
    const requestId = createRequestId()
    const confirmation: PendingAttendanceConfirmation = {
      id: requestId,
      kind: 'marks',
      viewKey: commandViewKey,
      generation: commandGeneration,
      studentIds: ids,
      status,
      previousRecords,
      clearSelectionAfter: options?.clearSelectionAfter ?? false,
      successText: options?.successText ?? (status === 'automatic'
        ? `Automatic status restored for ${ids.length} ${ids.length === 1 ? 'student' : 'students'}`
        : `${ids.length} ${ids.length === 1 ? 'student' : 'students'} marked ${STATUS_LABELS[status].toLowerCase()}`),
      failureText: 'Attendance update could not be completed',
    }
    activeCommandRequestRef.current = requestId
    setActiveCommand(`marks:${status}`)
    addLocalPendingStudents(ids)
    try {
      await fetchJSON('/api/teacher/attendance/marks', {
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroom.id,
            date: selectedDate,
            request_id: requestId,
            marks: ids.map((studentId) => ({
              student_id: studentId,
              status,
              reason_code: 'staff_correction',
            })),
          }),
        },
        errorMessage: 'Attendance is temporarily unavailable',
      })
      const outcome = await pollForConfirmation(
        commandViewKey,
        commandGeneration,
        (next) => confirmationOutcome(confirmation, next),
      )
      if (outcome === 'confirmed') {
        clearLocalPendingStudents(ids)
        if (options?.clearSelectionAfter) clearSelection()
        showMessage({ text: confirmation.successText, tone: 'info' })
      } else if (outcome === 'pending') {
        setPendingConfirmations((current) => [...current, confirmation])
        showMessage({ text: 'Update sent; waiting for attendance confirmation', tone: 'info' })
      }
    } catch (commandError) {
      if (
        currentViewKeyRef.current === commandViewKey
        && viewGenerationRef.current === commandGeneration
      ) {
        clearLocalPendingStudents(ids)
        showMessage({
          text: commandError instanceof Error ? commandError.message : 'Attendance is temporarily unavailable',
          tone: 'warning',
        })
      }
    } finally {
      if (activeCommandRequestRef.current === requestId) {
        activeCommandRequestRef.current = null
        setActiveCommand(null)
      }
    }
  }, [
    addLocalPendingStudents,
    classroom.id,
    clearLocalPendingStudents,
    clearSelection,
    pollForConfirmation,
    selectedDate,
    showMessage,
    studentsById,
    view,
    visibleStudentIdSet,
  ])

  const resetCheckIns = useCallback(async (studentIds: string[]) => {
    if (
      !view
      || activeCommandRequestRef.current
      || studentIds.length === 0
      || studentIds.some((studentId) => !studentsById.has(studentId))
      || Boolean(
        visibleStudentIdSet
        && studentIds.some((studentId) => !visibleStudentIdSet.has(studentId))
      )
      || studentIds.some((studentId) => localPendingStudentIdsRef.current.has(studentId))
      || studentIds.some((studentId) =>
        view.students.some((student) => student.studentId === studentId && student.pendingCommand)
      )
      || view.classroomId !== classroom.id
      || view.classDate !== selectedDate
    ) return
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
    const commandGeneration = viewGenerationRef.current
    const requestId = createRequestId()
    const confirmation: PendingAttendanceConfirmation = {
      id: requestId,
      kind: 'check-ins',
      viewKey: commandViewKey,
      generation: commandGeneration,
      studentIds: ids,
      clearSelectionAfter: true,
      successText: `${ids.length} ${ids.length === 1 ? 'QR check-in' : 'QR check-ins'} removed`,
      failureText: 'QR check-ins could not be removed',
    }
    activeCommandRequestRef.current = requestId
    setActiveCommand('check-ins:reset')
    addLocalPendingStudents(ids)
    try {
      await fetchJSON('/api/teacher/attendance/check-ins', {
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroom.id,
            date: selectedDate,
            request_id: requestId,
            student_ids: ids,
          }),
        },
        errorMessage: 'QR check-ins could not be removed',
      })
      const outcome = await pollForConfirmation(
        commandViewKey,
        commandGeneration,
        (next) => confirmationOutcome(confirmation, next),
      )
      if (outcome === 'confirmed') {
        clearLocalPendingStudents(ids)
        clearSelection()
        showMessage({ text: confirmation.successText, tone: 'info' })
      } else if (outcome === 'failed') {
        clearLocalPendingStudents(ids)
        showMessage({ text: confirmation.failureText, tone: 'warning' })
      } else if (outcome === 'pending') {
        setPendingConfirmations((current) => [...current, confirmation])
        showMessage({ text: 'Removal sent; waiting for confirmation', tone: 'info' })
      }
    } catch (commandError) {
      if (
        currentViewKeyRef.current === commandViewKey
        && viewGenerationRef.current === commandGeneration
      ) {
        clearLocalPendingStudents(ids)
        showMessage({
          text: commandError instanceof Error ? commandError.message : 'QR check-ins could not be removed',
          tone: 'warning',
        })
      }
    } finally {
      if (activeCommandRequestRef.current === requestId) {
        activeCommandRequestRef.current = null
        setActiveCommand(null)
      }
    }
  }, [
    addLocalPendingStudents,
    classroom.id,
    clearLocalPendingStudents,
    clearSelection,
    pollForConfirmation,
    selectedDate,
    showMessage,
    studentsById,
    view,
    visibleStudentIdSet,
  ])

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
    : sessionPending || view?.sync.state === 'pending'
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
    sessionPending,
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
