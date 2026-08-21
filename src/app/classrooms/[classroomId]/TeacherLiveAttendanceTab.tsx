'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import {
  Check,
  ClipboardCopy,
  Clock3,
  QrCode as QrCodeIcon,
  RefreshCw,
  UserRoundCheck,
  UserRoundX,
  X,
} from 'lucide-react'
import { CalendarDateNavigator } from '@/components/CalendarActionBar'
import { FloatingActionCluster } from '@/components/FloatingActionCluster'
import { CountBadge } from '@/components/StudentCountBadge'
import { TeacherWorkSurfaceActionBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionBar'
import { useTableSelection } from '@/hooks/useTableSelection'
import { fetchJSON } from '@/lib/request-cache'
import { getTodayInToronto } from '@/lib/timezone'
import type {
  TeacherAttendanceStatus,
  TeacherAttendanceQrPresentation,
  TeacherAttendanceView,
} from '@/lib/teacher-attendance'
import type { Classroom } from '@/types'
import {
  Button,
  ContentDialog,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
  PageActionBar,
  PageContent,
  PageLayout,
  PageState,
  QrCode,
  RefreshingIndicator,
  TableCard,
  TableSelectionCell,
  TableSelectionHeaderCell,
  Tooltip,
  cn,
  useAppMessage,
} from '@/ui'
import { AttendanceWindowDialog } from './AttendanceWindowDialog'

interface TeacherLiveAttendanceTabProps {
  classroom: Classroom
  isActive: boolean
}

type SessionCommand = 'open' | 'close'

const STATUS_LABELS: Record<TeacherAttendanceStatus, string> = {
  unmarked: 'Unmarked',
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
}

const STATUS_DOT_CLASSES: Record<TeacherAttendanceStatus, string> = {
  unmarked: 'bg-border-strong',
  present: 'bg-success-solid',
  late: 'bg-warning',
  absent: 'bg-danger-solid',
}

const SESSION_LABELS: Record<TeacherAttendanceView['session']['state'], string> = {
  not_scheduled: 'Not scheduled',
  scheduled: 'Scheduled',
  open: 'Open',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

const SESSION_TONE_CLASSES: Record<TeacherAttendanceView['session']['state'], string> = {
  not_scheduled: 'border-border bg-surface-2 text-text-muted',
  scheduled: 'border-info bg-info-bg text-text-default',
  open: 'border-success bg-success-bg text-success',
  closed: 'border-border bg-surface-2 text-text-muted',
  cancelled: 'border-danger bg-danger-bg text-danger',
}

function attendanceUrl(classroomId: string, classDate: string) {
  const params = new URLSearchParams({ classroom_id: classroomId, date: classDate })
  return `/api/teacher/attendance/session?${params.toString()}`
}

function attendanceQrUrl(classroomId: string, classDate: string) {
  const params = new URLSearchParams({ classroom_id: classroomId, date: classDate })
  return `/api/teacher/attendance/qr?${params.toString()}`
}

function nextDate(date: string, amount: number) {
  return format(addDays(parseISO(date), amount), 'yyyy-MM-dd')
}

function formatDay(date: string) {
  return format(parseISO(date), 'MMM d')
}

function formatFullDay(date: string) {
  return format(parseISO(date), 'EEEE, MMMM d')
}

function formatTime(instant: string | null) {
  if (!instant) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant))
}

function sessionWindow(view: TeacherAttendanceView) {
  const opensAt = formatTime(view.session.opensAt)
  const closesAt = formatTime(view.session.closesAt)
  if (!opensAt || !closesAt) return null
  return `${opensAt}–${closesAt}`
}

function sourceLabel(source: TeacherAttendanceView['students'][number]['source']) {
  if (source === 'student_qr') return 'QR check-in'
  if (source === 'staff') return 'Teacher'
  if (source === 'system') return 'Automatic'
  return null
}

function requestId() {
  return crypto.randomUUID()
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export function TeacherLiveAttendanceTab({
  classroom,
  isActive,
}: TeacherLiveAttendanceTabProps) {
  const { showMessage } = useAppMessage()
  const [selectedDate, setSelectedDate] = useState(getTodayInToronto)
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
  }, [readView])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setView(null)
    setError('')
    setLocalPendingStudentIds(new Set())
    setLocalSessionPending(false)
    setQrOpen(false)
    setQrLoading(false)
    setQrError('')
    setQrPresentation(null)
    setAttendanceHoursOpen(false)
    if (isActive) void loadView()
  }, [classroom.id, isActive, loadView, selectedDate])

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

  const students = useMemo(
    () => [...(view?.students ?? [])].sort((a, b) => (
      a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
    )),
    [view?.students],
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

  const counts = useMemo(() => {
    const result: Record<TeacherAttendanceStatus, number> = {
      unmarked: 0,
      present: 0,
      late: 0,
      absent: 0,
    }
    for (const student of students) result[student.status] += 1
    return result
  }, [students])

  const isArchived = Boolean(classroom.archived_at)
  const sessionState = view?.session.state ?? 'not_scheduled'
  const canMark = Boolean(
    view?.integration === 'ready' &&
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
  const failedStudentCount = useMemo(
    () => students.filter((student) => student.commandFailed).length,
    [students],
  )

  async function pollForConfirmation(
    viewKey: string,
    isConfirmed: (next: TeacherAttendanceView) => boolean,
  ) {
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
  }

  async function submitSessionCommand(command: SessionCommand) {
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
            request_id: requestId(),
            command,
          }),
        },
        errorMessage: 'Attendance is temporarily unavailable',
      })
      const confirmed = await pollForConfirmation(commandViewKey, (next) => (
        next.session.state === expectedState &&
        next.session.revision !== previousRevision
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
  }

  async function submitMarks(status: TeacherAttendanceStatus) {
    if (!view || activeCommand || selectedIds.size === 0) return
    const commandViewKey = currentViewKeyRef.current
    const ids = [...selectedIds]
    const previousRecords = new Map(
      view.students
        .filter((student) => selectedIds.has(student.studentId))
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
            request_id: requestId(),
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
          student.status === status &&
          (previous?.status === status || student.revision !== previous?.revision) &&
          !student.pendingCommand,
        )
      }))
      if (confirmed) {
        setLocalPendingStudentIds((current) => {
          const next = new Set(current)
          ids.forEach((studentId) => next.delete(studentId))
          return next
        })
        clearSelection()
        showMessage({ text: `${ids.length} ${ids.length === 1 ? 'student' : 'students'} marked ${STATUS_LABELS[status].toLowerCase()}`, tone: 'info' })
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
  }

  async function loadQrPresentation() {
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
        setQrError(
          loadError instanceof Error
            ? loadError.message
            : 'Attendance QR is temporarily unavailable',
        )
      }
    } finally {
      if (currentViewKeyRef.current === requestViewKey) setQrLoading(false)
    }
  }

  function openQrPresentation() {
    setQrOpen(true)
    void loadQrPresentation()
  }

  async function copyQrLink() {
    if (!qrPresentation) return
    try {
      const entryUrl = new URL(qrPresentation.entryPath, window.location.origin).toString()
      await navigator.clipboard.writeText(entryUrl)
      showMessage({ text: 'Attendance link copied', tone: 'success' })
    } catch {
      showMessage({ text: 'Could not copy attendance link', tone: 'warning' })
    }
  }

  const sessionAction = view?.integration === 'ready' && !isArchived
    ? sessionState === 'scheduled'
      ? { command: 'open' as const, label: 'Open attendance' }
      : sessionState === 'open'
        ? { command: 'close' as const, label: 'Close attendance' }
        : null
    : null

  const actionBar = (
    <TeacherWorkSurfaceActionBar
      label={(
        <CalendarDateNavigator
          label={formatDay(selectedDate)}
          onPrev={() => setSelectedDate((current) => nextDate(current, -1))}
          onNext={() => setSelectedDate((current) => nextDate(current, 1))}
          onLabelClick={() => setSelectedDate(getTodayInToronto())}
          labelAriaLabel="Go to today"
          prevAriaLabel="Previous day"
          nextAriaLabel="Next day"
          labelClassName="px-0"
        />
      )}
      center={sessionAction || sessionState === 'open' ? (
        <div className="flex items-center gap-1">
          {sessionState === 'open' ? (
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={Boolean(activeCommand) || localSessionPending}
              onClick={openQrPresentation}
            >
              <QrCodeIcon className="h-4 w-4" aria-hidden="true" /> Show QR
            </Button>
          ) : null}
          {sessionAction ? (
            <Button
              type="button"
              size="sm"
              variant={sessionAction.command === 'open' ? 'primary' : 'secondary'}
              loading={activeCommand === `session:${sessionAction.command}`}
              disabled={Boolean(activeCommand) || localSessionPending}
              onClick={() => void submitSessionCommand(sessionAction.command)}
            >
              {sessionAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
      centerPlacement="floating"
      centerClassName="top-24 sm:top-14"
      trailing={(
        <div className="flex items-center gap-1">
          {!isArchived ? (
            <Tooltip content="Attendance hours">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 w-9 px-0"
                aria-label="Attendance hours"
                disabled={Boolean(activeCommand)}
                onClick={() => setAttendanceHoursOpen(true)}
              >
                <Clock3 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content="Refresh attendance">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 w-9 px-0"
              aria-label="Refresh attendance"
              disabled={loading || refreshing || Boolean(activeCommand)}
              onClick={() => void loadView(true)}
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      )}
    />
  )

  let content
  if (loading && !view) {
    content = <PageState kind="loading" title="Loading attendance" compact />
  } else if (error && !view) {
    content = (
      <PageState
        kind="error"
        title="Attendance unavailable"
        description={error}
        compact
        action={<Button type="button" onClick={() => void loadView()}>Try again</Button>}
      />
    )
  } else if (!view) {
    content = null
  } else if (view.integration === 'disabled') {
    content = (
      <PageState
        kind="empty"
        title="Attendance is not enabled"
        description="This classroom is still using Daily while the attendance service is being connected."
        compact
      />
    )
  } else if (view.integration === 'not_configured') {
    content = (
      <PageState
        kind="empty"
        title="Attendance hours are not configured"
        description="Set an attendance window before automatic sessions can be scheduled."
        compact
      />
    )
  } else {
    const windowLabel = sessionWindow(view)
    content = (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {refreshing ? <RefreshingIndicator label="Refreshing attendance" /> : null}
        {error ? (
          <div role="alert" className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
            {error}. Showing the last confirmed attendance.
          </div>
        ) : null}
        {view.session.commandFailed || failedStudentCount > 0 ? (
          <div role="alert" className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
            {view.session.commandFailed
              ? 'A previous session update failed. Review the current state and try again.'
              : `${failedStudentCount} previous attendance ${failedStudentCount === 1 ? 'update' : 'updates'} failed. Select the affected ${failedStudentCount === 1 ? 'student' : 'students'} to try again.`}
          </div>
        ) : null}
        <section aria-label="Attendance session" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2">
          <span className={cn('inline-flex items-center rounded-badge border px-2 py-1 text-sm font-semibold', SESSION_TONE_CLASSES[sessionState])}>
            {SESSION_LABELS[sessionState]}
          </span>
          {windowLabel ? <span className="text-sm text-text-muted">{windowLabel}</span> : null}
          {localSessionPending || view.sync.state === 'pending' ? (
            <span className="text-sm text-text-muted">Waiting for confirmation…</span>
          ) : null}
          {view.session.commandFailed && !localSessionPending ? (
            <span className="text-sm text-warning">Previous session update failed</span>
          ) : null}
          {view.sync.state === 'stale' || view.sync.state === 'unavailable' ? (
            <span className="text-sm text-warning">Last confirmed attendance shown</span>
          ) : null}
          <span className="ml-auto flex flex-wrap items-center gap-1" aria-label={`${counts.present} present, ${counts.late} late, ${counts.absent} absent, ${counts.unmarked} unmarked`}>
            <CountBadge count={counts.present} tooltip={`${counts.present} present`} variant="success" />
            <CountBadge count={counts.late} tooltip={`${counts.late} late`} variant="neutral" />
            <CountBadge count={counts.absent} tooltip={`${counts.absent} absent`} variant="danger" />
            <CountBadge count={counts.unmarked} tooltip={`${counts.unmarked} unmarked`} variant="neutral" />
          </span>
        </section>

        <div className="min-h-48 flex-1 overflow-auto rounded-lg bg-surface">
          <TableCard chrome="flush">
            <DataTable density="compact">
              <caption className="sr-only">Student attendance for {formatFullDay(selectedDate)}</caption>
              <DataTableHead>
                <DataTableRow>
                  <TableSelectionHeaderCell
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleSelectAll}
                    ariaLabel="Select all students"
                    disabled={!canMark || Boolean(activeCommand) || selectableStudentIds.length === 0}
                  />
                  <DataTableHeaderCell>Student</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell className="hidden sm:table-cell">Source</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {students.map((student) => {
                  const pending = pendingStudentIds.has(student.studentId)
                  const selectable = canMark && !pending && !activeCommand
                  const selected = selectedIds.has(student.studentId)
                  const studentSource = sourceLabel(student.source)
                  return (
                    <DataTableRow
                      key={student.studentId}
                      aria-selected={selected}
                      className={cn(
                        'transition-colors',
                        selectable && 'cursor-pointer hover:bg-surface-hover',
                        selected && 'bg-info-bg hover:bg-info-bg-hover',
                      )}
                      onClick={() => {
                        if (selectable) toggleSelect(student.studentId)
                      }}
                    >
                      <TableSelectionCell
                        checked={selected}
                        onChange={() => toggleSelect(student.studentId)}
                        ariaLabel={`Select ${student.firstName} ${student.lastName}`}
                        disabled={!selectable}
                      />
                      <DataTableCell>
                        <span className="font-medium">{student.lastName}, {student.firstName}</span>
                      </DataTableCell>
                      <DataTableCell>
                        <span className="inline-flex items-center gap-2">
                          <span className={cn('h-2.5 w-2.5 rounded-full', STATUS_DOT_CLASSES[student.status])} aria-hidden="true" />
                          <span>{STATUS_LABELS[student.status]}</span>
                          {pending ? <span className="text-text-muted">Updating…</span> : null}
                          {!pending && student.commandFailed ? (
                            <span className="text-warning">Previous update failed</span>
                          ) : null}
                        </span>
                      </DataTableCell>
                      <DataTableCell className="hidden text-text-muted sm:table-cell">
                        {studentSource ?? '—'}
                      </DataTableCell>
                    </DataTableRow>
                  )
                })}
                {students.length === 0 ? (
                  <EmptyStateRow colSpan={4} message="No students enrolled" />
                ) : null}
              </DataTableBody>
            </DataTable>
          </TableCard>
        </div>

        {selectedCount > 0 ? (
          <FloatingActionCluster placement="bottom" className="flex flex-wrap items-center justify-center gap-1" role="toolbar" aria-label="Bulk attendance actions">
            <span className="px-2 text-sm font-semibold text-text-default">{selectedCount} selected</span>
            <Button type="button" size="sm" variant="success" disabled={Boolean(activeCommand)} loading={activeCommand === 'marks:present'} onClick={() => void submitMarks('present')}>
              <UserRoundCheck className="h-4 w-4" aria-hidden="true" /> Present
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={Boolean(activeCommand)} loading={activeCommand === 'marks:late'} onClick={() => void submitMarks('late')}>
              <Clock3 className="h-4 w-4" aria-hidden="true" /> Late
            </Button>
            <Button type="button" size="sm" variant="danger" disabled={Boolean(activeCommand)} loading={activeCommand === 'marks:absent'} onClick={() => void submitMarks('absent')}>
              <UserRoundX className="h-4 w-4" aria-hidden="true" /> Absent
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={Boolean(activeCommand)} loading={activeCommand === 'marks:unmarked'} onClick={() => void submitMarks('unmarked')}>
              <Check className="h-4 w-4" aria-hidden="true" /> Clear mark
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={Boolean(activeCommand)} onClick={clearSelection} aria-label="Clear selection">
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </FloatingActionCluster>
        ) : null}
      </div>
    )
  }

  const qrEntryUrl = qrPresentation
    ? new URL(qrPresentation.entryPath, window.location.origin).toString()
    : null

  return (
    <>
      <PageLayout className="flex h-full min-h-0 flex-col">
        <PageActionBar primary={actionBar} className="pb-14 sm:pb-2" />
        <PageContent className="flex min-h-0 flex-1 flex-col pb-24">
          {content}
        </PageContent>
      </PageLayout>
      <ContentDialog
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Attendance QR"
        subtitle={formatFullDay(selectedDate)}
        maxWidth="max-w-md"
      >
        {qrLoading ? (
          <PageState kind="loading" title="Loading QR code" compact />
        ) : qrError ? (
          <PageState
            kind="error"
            title="QR unavailable"
            description={qrError}
            compact
            action={<Button type="button" onClick={() => void loadQrPresentation()}>Try again</Button>}
          />
        ) : qrEntryUrl && qrPresentation ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <QrCode value={qrEntryUrl} label="Student attendance check-in QR code" />
            <div>
              <p className="font-medium text-text-default">Scan to check in through Pika</p>
              <p className="mt-1 text-sm text-text-muted">
                Available until {formatTime(qrPresentation.expiresAt)}
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={() => void copyQrLink()}>
              <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copy link
            </Button>
          </div>
        ) : null}
      </ContentDialog>
      <AttendanceWindowDialog
        classroomId={classroom.id}
        isOpen={attendanceHoursOpen}
        onClose={() => setAttendanceHoursOpen(false)}
        onSaved={() => void loadView(true)}
      />
    </>
  )
}
