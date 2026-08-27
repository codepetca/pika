'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import {
  Check,
  ClipboardCopy,
  Clock3,
  DoorClosed,
  DoorOpen,
  QrCode as QrCodeIcon,
  RefreshCw,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react'
import { CalendarDateNavigator } from '@/components/CalendarActionBar'
import { TeacherSelectionBar } from '@/components/teacher-work-surface/TeacherSelectionBar'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import { TeacherWorkSurfaceTableFrame } from '@/components/teacher-work-surface/TeacherWorkSurfaceTableFrame'
import { useTableSelection } from '@/hooks/useTableSelection'
import { useTableColumnWidths } from '@/hooks/useTableColumnWidths'
import { fetchJSON } from '@/lib/request-cache'
import { applyDirection, compareByNameFields, compareNullableStrings, toggleSort } from '@/lib/table-sort'
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
  SortableHeaderCell,
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
type SortColumn = 'first_name' | 'last_name' | 'source' | 'status'
type StatusSort = Exclude<TeacherAttendanceStatus, 'unmarked'>
type ResizableColumn = 'first' | 'last' | 'source'

const COLUMN_LIMITS: Record<ResizableColumn, { defaultWidth: number; min: number; max: number }> = {
  first: { defaultWidth: 72, min: 60, max: 160 },
  last: { defaultWidth: 72, min: 60, max: 160 },
  source: { defaultWidth: 96, min: 72, max: 180 },
}

const STATUS_LABELS: Record<TeacherAttendanceStatus, string> = {
  unmarked: 'Unmarked',
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
}

const STATUS_DOT_CLASSES: Record<TeacherAttendanceStatus, string> = {
  unmarked: 'bg-attendance-unmarked',
  present: 'bg-attendance-present',
  late: 'bg-attendance-late',
  absent: 'bg-attendance-absent',
}

const STATUS_CHIP_CLASSES: Record<StatusSort, string> = {
  present: 'bg-attendance-present text-attendance-present-text',
  late: 'bg-attendance-late text-attendance-late-text',
  absent: 'bg-attendance-absent text-attendance-absent-text',
}

const SORTABLE_STATUSES: StatusSort[] = ['present', 'late', 'absent']

function AttendanceStatusSortChip({
  status,
  count,
  active,
  onClick,
}: {
  status: StatusSort
  count: number
  active: boolean
  onClick: () => void
}) {
  const label = STATUS_LABELS[status]
  const studentLabel = count === 1 ? 'student' : 'students'

  return (
    <Tooltip content={`${count} ${studentLabel} ${label.toLowerCase()}. Sort ${label.toLowerCase()} first`}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="rounded-badge px-0 py-0"
        aria-label={`Sort ${label} first, ${count} ${studentLabel}`}
        aria-pressed={active}
        onClick={onClick}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-6 min-w-6 items-center justify-center rounded-badge px-2 text-sm font-semibold',
            STATUS_CHIP_CLASSES[status],
            active && 'ring-foundation ring-focus ring-offset-2 ring-offset-surface',
          )}
        >
          {count}
        </span>
      </Button>
    </Tooltip>
  )
}

const SESSION_LABELS: Record<TeacherAttendanceView['session']['state'], string> = {
  not_scheduled: 'Not scheduled',
  scheduled: 'Scheduled',
  open: 'Open',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

const SESSION_DOT_CLASSES: Record<TeacherAttendanceView['session']['state'], string> = {
  not_scheduled: 'bg-border-strong',
  scheduled: 'bg-primary',
  open: 'bg-success-solid',
  closed: 'bg-border-strong',
  cancelled: 'bg-danger-solid',
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
  const [{ column: sortColumn, direction: sortDirection, status: sortStatus }, setSortState] = useState<{
    column: SortColumn
    direction: 'asc' | 'desc'
    status: StatusSort | null
  }>({ column: 'last_name', direction: 'asc', status: null })
  const { columnWidths, setColumnWidth } = useTableColumnWidths({
    storageKey: 'teacher-live-attendance:v1',
    columns: COLUMN_LIMITS,
  })
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

  const students = useMemo(() => view?.students ?? [], [view?.students])
  const rows = useMemo(() => [...students].sort((a, b) => {
    const compareNames = (
      column: 'first_name' | 'last_name' = 'last_name',
      direction: 'asc' | 'desc' = 'asc',
    ) => compareByNameFields(
      { firstName: a.firstName, lastName: a.lastName, id: a.studentId },
      { firstName: b.firstName, lastName: b.lastName, id: b.studentId },
      column,
      direction,
    )

    if (sortColumn === 'status') {
      if (!sortStatus) return compareNames()
      const statusRank = Number(b.status === sortStatus) - Number(a.status === sortStatus)
      return statusRank || compareNames()
    }
    if (sortColumn === 'source') {
      const sourceComparison = compareNullableStrings(sourceLabel(a.source), sourceLabel(b.source))
      return applyDirection(sourceComparison, sortDirection) || compareNames()
    }
    return compareNames(sortColumn, sortDirection)
  }), [sortColumn, sortDirection, sortStatus, students])
  const statusCounts = useMemo(() => {
    const counts: Record<StatusSort, number> = { present: 0, late: 0, absent: 0 }
    for (const student of students) {
      if (student.status !== 'unmarked') counts[student.status] += 1
    }
    return counts
  }, [students])
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

  function handleSort(column: Exclude<SortColumn, 'status'>) {
    setSortState((current) => ({ ...toggleSort(current, column), status: null }))
  }

  function handleStatusSort(status: StatusSort) {
    setSortState({ column: 'status', direction: 'asc', status })
  }

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

  const windowLabel = view?.integration === 'ready' ? sessionWindow(view) : null
  const hasUnconfirmedView = view?.integration === 'ready' && (
    view.sync.state === 'stale' || view.sync.state === 'unavailable'
  )
  const sessionContextLabel = hasUnconfirmedView
    ? 'Last confirmed'
    : localSessionPending || view?.sync.state === 'pending'
      ? 'Updating…'
      : SESSION_LABELS[sessionState]
  const actionBar = (
    <TeacherWorkSurfaceContextBar
      ariaLabel="Attendance controls and summary"
      testId="attendance-context-bar"
      context={view?.integration === 'ready' ? (
        <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              hasUnconfirmedView ? 'bg-warning' : SESSION_DOT_CLASSES[sessionState],
            )}
            aria-hidden="true"
          />
          <span className="truncate">{sessionContextLabel}</span>
          {hasUnconfirmedView ? (
            <span className="hidden truncate xl:inline">· {SESSION_LABELS[sessionState]}</span>
          ) : null}
          {windowLabel ? <span className="hidden truncate xl:inline">· {windowLabel}</span> : null}
          {localSessionPending || view.sync.state === 'pending' ? (
            <span className="hidden truncate xl:inline">· Waiting for confirmation</span>
          ) : null}
        </div>
      ) : null}
      primary={(
        <div className="flex items-center gap-1" data-testid="attendance-primary-control">
          <CalendarDateNavigator
            label={formatDay(selectedDate)}
            onPrev={() => setSelectedDate((current) => nextDate(current, -1))}
            onNext={() => setSelectedDate((current) => nextDate(current, 1))}
            onLabelClick={() => setSelectedDate(getTodayInToronto())}
            labelAriaLabel="Go to today"
            prevAriaLabel="Previous day"
            nextAriaLabel="Next day"
            labelClassName="px-1"
          />
          {sessionState === 'open' ? (
            <Tooltip content="Show QR">
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="h-9 w-9 px-0"
                aria-label="Show QR"
                disabled={Boolean(activeCommand) || localSessionPending}
                onClick={openQrPresentation}
              >
                <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Tooltip>
          ) : null}
          {sessionAction ? (
            <Tooltip content={sessionAction.label}>
              <Button
                type="button"
                size="sm"
                variant={sessionAction.command === 'open' ? 'primary' : 'secondary'}
                className="h-9 w-9 px-0"
                aria-label={sessionAction.label}
                loading={activeCommand === `session:${sessionAction.command}`}
                disabled={Boolean(activeCommand) || localSessionPending}
                onClick={() => void submitSessionCommand(sessionAction.command)}
              >
                {sessionAction.command === 'open' ? (
                  <DoorOpen className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <DoorClosed className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </Tooltip>
          ) : null}
        </div>
      )}
      actions={view?.integration === 'ready' ? (
        <div className="hidden items-center gap-1 sm:flex">
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
      ) : null}
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
        <TeacherWorkSurfaceTableFrame selectionActive={selectedCount > 0}>
          <DataTable density="tight" className="table-fixed">
            <caption className="sr-only">Student attendance for {formatFullDay(selectedDate)}</caption>
            <colgroup>
              <col className="w-10" />
              <col style={{ width: `${columnWidths.first}px` }} />
              <col style={{ width: `${columnWidths.last}px` }} />
              <col
                className="hidden md:table-column"
                style={{ width: `${columnWidths.source}px` }}
              />
              <col />
            </colgroup>
            <DataTableHead sticky>
              <DataTableRow>
                <TableSelectionHeaderCell
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleSelectAll}
                  ariaLabel="Select all students"
                  disabled={!canMark || Boolean(activeCommand) || selectableStudentIds.length === 0}
                />
                <SortableHeaderCell
                  label="First"
                  isActive={sortColumn === 'first_name'}
                  direction={sortDirection}
                  onClick={() => handleSort('first_name')}
                  buttonClassName="!pl-2 !pr-5"
                  resize={{
                    value: columnWidths.first,
                    min: COLUMN_LIMITS.first.min,
                    max: COLUMN_LIMITS.first.max,
                    onChange: (width) => setColumnWidth('first', width),
                  }}
                />
                <SortableHeaderCell
                  label="Last"
                  isActive={sortColumn === 'last_name'}
                  direction={sortDirection}
                  onClick={() => handleSort('last_name')}
                  buttonClassName="!pl-2 !pr-5"
                  resize={{
                    value: columnWidths.last,
                    min: COLUMN_LIMITS.last.min,
                    max: COLUMN_LIMITS.last.max,
                    onChange: (width) => setColumnWidth('last', width),
                  }}
                />
                <SortableHeaderCell
                  label="Source"
                  isActive={sortColumn === 'source'}
                  direction={sortDirection}
                  onClick={() => handleSort('source')}
                  buttonClassName="!pl-2 !pr-5"
                  className="hidden md:table-cell"
                  resize={{
                    value: columnWidths.source,
                    min: COLUMN_LIMITS.source.min,
                    max: COLUMN_LIMITS.source.max,
                    onChange: (width) => setColumnWidth('source', width),
                  }}
                />
                <DataTableHeaderCell
                  className="!p-0"
                  aria-sort={sortColumn === 'status' ? 'other' : 'none'}
                >
                  <div className="flex min-h-control items-center gap-0.5 px-1 sm:px-2">
                    <span className="hidden shrink-0 lg:inline">Status</span>
                    <span
                      role="group"
                      aria-label="Sort attendance by status"
                      className="flex min-w-0 items-center"
                    >
                      {SORTABLE_STATUSES.map((status) => (
                        <AttendanceStatusSortChip
                          key={status}
                          status={status}
                          count={statusCounts[status]}
                          active={sortColumn === 'status' && sortStatus === status}
                          onClick={() => handleStatusSort(status)}
                        />
                      ))}
                    </span>
                  </div>
                </DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {rows.map((student) => {
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
                    <DataTableCell className="min-w-0">
                      <span className="block truncate" title={student.firstName || undefined}>
                        {student.firstName || '—'}
                      </span>
                    </DataTableCell>
                    <DataTableCell className="min-w-0">
                      <span className="block truncate" title={student.lastName || undefined}>
                        {student.lastName || '—'}
                      </span>
                    </DataTableCell>
                    <DataTableCell className="hidden min-w-0 text-text-muted md:table-cell">
                      <span className="block truncate" title={studentSource ?? undefined}>
                        {studentSource ?? '—'}
                      </span>
                    </DataTableCell>
                    <DataTableCell>
                      <span className="inline-flex items-center gap-2">
                        <Tooltip content={STATUS_LABELS[student.status]}>
                          <span
                            aria-label={STATUS_LABELS[student.status]}
                            className={cn(
                              'inline-block h-3 w-3 shrink-0 rounded-full',
                              STATUS_DOT_CLASSES[student.status],
                            )}
                          />
                        </Tooltip>
                        {pending ? <span className="text-text-muted">Updating…</span> : null}
                        {!pending && student.commandFailed ? (
                          <span className="text-warning">Previous update failed</span>
                        ) : null}
                      </span>
                    </DataTableCell>
                  </DataTableRow>
                )
              })}
              {rows.length === 0 ? (
                <EmptyStateRow colSpan={5} message="No students enrolled" />
              ) : null}
            </DataTableBody>
          </DataTable>
        </TeacherWorkSurfaceTableFrame>

        <TeacherSelectionBar
          selectedCount={selectedCount}
          onClear={clearSelection}
          clearDisabled={Boolean(activeCommand)}
          ariaLabel="Bulk attendance actions"
        >
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
        </TeacherSelectionBar>
      </div>
    )
  }

  const qrEntryUrl = qrPresentation
    ? new URL(qrPresentation.entryPath, window.location.origin).toString()
    : null

  return (
    <>
      <PageLayout className="flex h-full min-h-0 flex-col">
        <PageActionBar primary={actionBar} className="pb-0" />
        <PageContent className="flex min-h-0 flex-1 flex-col pb-2 pt-1">
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
