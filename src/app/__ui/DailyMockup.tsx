'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Clock3, MoreVertical, QrCode, RotateCcw } from 'lucide-react'
import {
  ATTENDANCE_STATUS_DOT_CLASSES,
  ATTENDANCE_STATUS_LABELS,
  AttendanceStatusSortChip,
  SORTABLE_ATTENDANCE_STATUSES,
} from '@/app/classrooms/[classroomId]/TeacherAttendanceControls'
import { DateNavigator } from '@/components/DateNavigator'
import {
  TeacherWorkSurfaceIconMenuButton,
  type TeacherWorkSurfaceActionItem,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherWorkSurfaceTableFrame } from '@/components/teacher-work-surface/TeacherWorkSurfaceTableFrame'
import { addDaysToDateString, getPastRelativeDateLabel } from '@/lib/date-string'
import {
  ATTENDANCE_SESSION_TOO_LONG_MESSAGE,
  MAX_ATTENDANCE_SESSION_MINUTES,
  attendanceSessionDurationMinutes,
} from '@/lib/attendance-session-duration'
import type { TeacherAttendanceStatus } from '@/lib/teacher-attendance'
import {
  Button,
  Card,
  ContentDialog,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  FormField,
  IconButton,
  Input,
  SegmentedControl,
  SortableHeaderCell,
  TableSelectionCheckbox,
  Tooltip,
  cn,
} from '@/ui'

const REFERENCE_TODAY = '2026-09-16'

const DAILY_STUDENTS = [
  { id: 'maya', first: 'Maya', last: 'Chen', checkIn: '8:52 AM', log: 'Compared shade and sunlight plots.', automaticStatus: 'present' as const, status: 'present' as const },
  { id: 'noah', first: 'Noah', last: 'Williams', checkIn: '9:07 AM', log: 'Recorded soil moisture and insects.', automaticStatus: 'present' as const, status: 'late' as const },
  { id: 'sana', first: 'Sana', last: 'Patel', checkIn: null, log: null, automaticStatus: 'unmarked' as const, status: 'absent' as const },
  { id: 'theo', first: 'Theo', last: 'Martin', checkIn: '8:48 AM', log: 'Mapped the edge of the pond habitat.', automaticStatus: 'present' as const, status: 'present' as const },
]

type DailyStudentId = (typeof DAILY_STUDENTS)[number]['id']
type SortKey = 'first' | 'last'
type AttendanceMark = (typeof SORTABLE_ATTENDANCE_STATUSES)[number]
type AttendanceTime = { startsAt: string; endsAt: string }
export type DailyAttendanceMode = 'qr' | 'manual'
type ManualAttendanceMode = 'log' | 'manual'

const STICKY_ATTENDANCE_OFFSETS: Record<AttendanceMark, string> = {
  present: 'right-attendance-three',
  late: 'right-attendance-two',
  absent: 'right-attendance-one',
}

function initialStudentRecord<T>(getValue: (student: (typeof DAILY_STUDENTS)[number]) => T) {
  return Object.fromEntries(DAILY_STUDENTS.map((student) => [student.id, getValue(student)])) as Record<DailyStudentId, T>
}

function attendanceTimeDate(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(2000, 0, 1, hours, minutes)
}

function clampMinutes(value: number, maximum: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), maximum)
}

function formatAttendanceTime(time: string, compact = false) {
  const value = attendanceTimeDate(time)
  return format(value, compact && value.getMinutes() === 0 ? 'h' : compact ? 'h:mm' : 'h:mm a')
}

function formatAttendanceRange(time: AttendanceTime, compact = false) {
  if (compact) return `${formatAttendanceTime(time.startsAt, true)}–${formatAttendanceTime(time.endsAt, true)}`
  const startsAt = attendanceTimeDate(time.startsAt)
  const endsAt = attendanceTimeDate(time.endsAt)
  return format(startsAt, 'a') === format(endsAt, 'a')
    ? `${format(startsAt, 'h:mm')} - ${format(endsAt, 'h:mm a')}`
    : `${format(startsAt, 'h:mm a')} - ${format(endsAt, 'h:mm a')}`
}

function AttendanceMarkButton({
  studentName,
  mark,
  active,
  onClick,
}: {
  studentName: string
  mark: AttendanceMark
  active: boolean
  onClick: () => void
}) {
  const label = ATTENDANCE_STATUS_LABELS[mark]

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="h-11 w-11 rounded-full p-0 hover:bg-transparent"
      aria-label={`Mark ${studentName} ${label.toLowerCase()}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-5 w-5 rounded-full transition-opacity',
          ATTENDANCE_STATUS_DOT_CLASSES[mark],
          active
            ? 'opacity-100 ring-2 ring-primary ring-offset-1 ring-offset-surface-2 shadow-sm'
            : 'opacity-[0.12] hover:opacity-40',
        )}
      />
    </Button>
  )
}

export function DailyMockup({
  attendanceMode = 'qr',
  onPrototypeAction,
}: {
  attendanceMode?: DailyAttendanceMode
  onPrototypeAction: (action: string) => void
}) {
  const hasQrCheckIn = attendanceMode === 'qr'
  const [date, setDate] = useState('2026-09-16')
  const [showRelativeDate, setShowRelativeDate] = useState(true)
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(true)
  const [manualAttendanceMode, setManualAttendanceMode] = useState<ManualAttendanceMode>('manual')
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false)
  const [isTimeDialogOpen, setIsTimeDialogOpen] = useState(false)
  const [attendanceTime, setAttendanceTime] = useState<AttendanceTime | null>({ startsAt: '09:00', endsAt: '10:00' })
  const [draftStartsAt, setDraftStartsAt] = useState('09:00')
  const [draftEndsAt, setDraftEndsAt] = useState('10:00')
  const [entryOpensMinutesBefore, setEntryOpensMinutesBefore] = useState(10)
  const [presentGraceMinutes, setPresentGraceMinutes] = useState(5)
  const [entryClosesMinutesBeforeEnd, setEntryClosesMinutesBeforeEnd] = useState(0)
  const [absentMinutesBeforeEnd, setAbsentMinutesBeforeEnd] = useState(0)
  const [sessionEndDay, setSessionEndDay] = useState<'same' | 'next'>('same')
  const [opensAutomatically, setOpensAutomatically] = useState(true)
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'last', direction: 'asc' })
  const [statusSort, setStatusSort] = useState<AttendanceMark | null>(null)
  const [automaticStatuses, setAutomaticStatuses] = useState<Record<DailyStudentId, TeacherAttendanceStatus>>(() => (
    initialStudentRecord((student) => (
      hasQrCheckIn ? student.automaticStatus : manualAttendanceMode === 'log' && student.log ? 'present' : 'unmarked'
    ))
  ))
  const [statuses, setStatuses] = useState<Record<DailyStudentId, TeacherAttendanceStatus>>(() => (
    initialStudentRecord((student) => student.status)
  ))
  const [manualChanges, setManualChanges] = useState<Record<DailyStudentId, boolean>>(() => (
    initialStudentRecord((student) => student.status !== (
      hasQrCheckIn ? student.automaticStatus : manualAttendanceMode === 'log' && student.log ? 'present' : 'unmarked'
    ))
  ))
  const [checkIns, setCheckIns] = useState<Record<DailyStudentId, string | null>>(() => (
    initialStudentRecord((student) => student.checkIn)
  ))
  const attendanceDuration = attendanceSessionDurationMinutes(
    draftStartsAt,
    draftEndsAt,
    sessionEndDay === 'next' ? 1 : 0,
  ) ?? 0
  const timingRuleMaxMinutes = Math.min(
    MAX_ATTENDANCE_SESSION_MINUTES,
    Math.max(0, attendanceDuration),
  )
  const attendanceTimeValidationError = !draftStartsAt || !draftEndsAt
    ? 'Choose both session times.'
    : attendanceDuration <= 0
      ? 'Session end must be after session start.'
      : attendanceDuration > MAX_ATTENDANCE_SESSION_MINUTES
        ? ATTENDANCE_SESSION_TOO_LONG_MESSAGE
        : ''

  useEffect(() => {
    setPresentGraceMinutes((current) => clampMinutes(current, timingRuleMaxMinutes))
    setEntryClosesMinutesBeforeEnd((current) => clampMinutes(current, timingRuleMaxMinutes))
    setAbsentMinutesBeforeEnd((current) => clampMinutes(current, timingRuleMaxMinutes))
  }, [timingRuleMaxMinutes])

  const students = useMemo(() => [...DAILY_STUDENTS].sort((a, b) => {
    if (statusSort) {
      const statusDifference = Number(statuses[b.id] === statusSort) - Number(statuses[a.id] === statusSort)
      if (statusDifference !== 0) return statusDifference
    }
    const direction = sort.direction === 'asc' ? 1 : -1
    return direction * a[sort.key].localeCompare(b[sort.key])
  }), [sort, statuses, statusSort])
  const statusCounts = useMemo(() => Object.values(statuses).reduce((counts, status) => {
    if (status !== 'unmarked') counts[status] += 1
    return counts
  }, { present: 0, late: 0, absent: 0 }), [statuses])

  const toggleSort = (key: SortKey) => {
    setStatusSort(null)
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }
  const markStudent = (studentId: DailyStudentId, status: AttendanceMark) => {
    setStatuses((current) => ({ ...current, [studentId]: status }))
    setManualChanges((current) => ({ ...current, [studentId]: true }))
  }
  const undoStudent = (studentId: DailyStudentId) => {
    setStatuses((current) => ({ ...current, [studentId]: automaticStatuses[studentId] }))
    setManualChanges((current) => ({ ...current, [studentId]: false }))
    onPrototypeAction('Revert manual attendance change')
  }
  const markAll = (status: AttendanceMark) => {
    setStatuses(initialStudentRecord(() => status))
    setManualChanges(initialStudentRecord(() => true))
    setIsBatchDialogOpen(false)
    onPrototypeAction(`Mark all students ${status}`)
  }
  const revertManualChanges = () => {
    setStatuses({ ...automaticStatuses })
    setManualChanges(initialStudentRecord(() => false))
    setIsBatchDialogOpen(false)
    onPrototypeAction('Revert all manual attendance changes')
  }
  const clearQrCheckIns = () => {
    const clearedAutomaticStatuses = initialStudentRecord<TeacherAttendanceStatus>(() => 'unmarked')
    setCheckIns(initialStudentRecord(() => null))
    setAutomaticStatuses(clearedAutomaticStatuses)
    setStatuses((current) => initialStudentRecord((student) => (
      manualChanges[student.id] ? current[student.id] : 'unmarked'
    )))
    setIsBatchDialogOpen(false)
    onPrototypeAction('Clear QR check-ins')
  }
  const selectManualAttendanceMode = (mode: ManualAttendanceMode) => {
    const nextAutomaticStatuses = initialStudentRecord<TeacherAttendanceStatus>((student) => (
      mode === 'log'
        ? student.log ? 'present' : 'unmarked'
        : 'unmarked'
    ))
    setManualAttendanceMode(mode)
    setAutomaticStatuses(nextAutomaticStatuses)
    setStatuses(initialStudentRecord((student) => student.status))
    setManualChanges(initialStudentRecord((student) => student.status !== nextAutomaticStatuses[student.id]))
    onPrototypeAction(mode === 'log' ? 'Turn on attendance from log' : 'Turn off attendance from log')
  }
  const openTimeDialog = () => {
    setDraftStartsAt(attendanceTime?.startsAt ?? '09:00')
    setDraftEndsAt(attendanceTime?.endsAt ?? '10:00')
    setIsTimeDialogOpen(true)
  }
  const saveAttendanceTime = () => {
    if (attendanceTimeValidationError) return
    setAttendanceTime({ startsAt: draftStartsAt, endsAt: draftEndsAt })
    setIsTimeDialogOpen(false)
    onPrototypeAction('Save attendance time')
  }
  const clearAttendanceTime = () => {
    setAttendanceTime(null)
    setIsTimeDialogOpen(false)
    onPrototypeAction('Clear attendance time')
  }

  const moreActions: TeacherWorkSurfaceActionItem[] = [
    ...(hasQrCheckIn ? [{
      id: 'attendance-open',
      label: isAttendanceOpen ? 'Close attendance' : 'Open attendance',
      description: isAttendanceOpen ? 'Stop accepting QR check-ins' : 'Allow QR check-ins for this date',
      checked: isAttendanceOpen,
      checkedRole: 'menuitemcheckbox',
      onSelect: () => {
        setIsAttendanceOpen((current) => !current)
        onPrototypeAction(isAttendanceOpen ? 'Close attendance' : 'Open attendance')
      },
    } satisfies TeacherWorkSurfaceActionItem] : []),
    {
      id: 'edit-time',
      label: 'Edit time',
      icon: <Clock3 className="h-4 w-4" aria-hidden="true" />,
      onSelect: openTimeDialog,
    },
    ...(!hasQrCheckIn ? [
      {
        id: 'attendance-from-log',
        label: 'Attendance from log',
        description: 'A completed log marks the student Present',
        checked: manualAttendanceMode === 'log',
        checkedRole: 'menuitemcheckbox' as const,
        dividerBefore: true,
        onSelect: () => selectManualAttendanceMode(manualAttendanceMode === 'log' ? 'manual' : 'log'),
      },
    ] : []),
    {
      id: 'mark-all',
      label: 'Edit attendance',
      dividerBefore: true,
      onSelect: () => setIsBatchDialogOpen(true),
    },
    {
      id: 'relative-date',
      label: showRelativeDate ? 'Hide relative date' : 'Show relative date',
      checked: showRelativeDate,
      checkedRole: 'menuitemcheckbox',
      onSelect: () => setShowRelativeDate((current) => !current),
    },
    {
      id: 'markdown',
      label: 'Edit all logs in Markdown',
      dividerBefore: true,
      onSelect: () => onPrototypeAction('Edit Daily logs in Markdown'),
    },
  ]

  const actionBar = (
    <TeacherWorkSurfaceContextBar
      ariaLabel="Daily mockup controls"
      primary={(
        <div className="flex min-w-0 items-center gap-1">
          <DateNavigator
            joined
            label={format(parseISO(date), 'EEE MMM d')}
            subtitle={showRelativeDate ? getPastRelativeDateLabel(date, REFERENCE_TODAY) : null}
            reserveSubtitleSpace={showRelativeDate}
            onPrev={() => setDate((current) => addDaysToDateString(current, -1))}
            onNext={() => setDate((current) => addDaysToDateString(current, 1))}
            onLabelClick={() => setDate(REFERENCE_TODAY)}
            labelAriaLabel="Return to reference Daily date"
            prevAriaLabel="Previous Daily date"
            nextAriaLabel="Next Daily date"
            labelClassName="min-w-20 px-1.5 sm:min-w-28 sm:px-3"
          />
          <div
            role="group"
            aria-label={hasQrCheckIn ? 'Attendance time and QR check-in' : 'Attendance time'}
            className="inline-flex shrink-0 overflow-hidden rounded-control border border-border-strong bg-surface"
          >
            {hasQrCheckIn ? (
              <IconButton
                label="Show QR"
                tooltip={isAttendanceOpen ? 'Show QR' : 'QR unavailable until attendance is open'}
                icon={QrCode}
                variant="primary"
                size="sm"
                className="h-11 w-11 rounded-none border-0"
                disabled={!isAttendanceOpen}
                onClick={() => onPrototypeAction('Show attendance QR')}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={attendanceTime
                ? hasQrCheckIn
                  ? `Edit attendance time, attendance ${isAttendanceOpen ? 'open' : 'closed'}, ${formatAttendanceRange(attendanceTime)}`
                  : `Edit attendance time, manual attendance, ${formatAttendanceRange(attendanceTime)}`
                : hasQrCheckIn
                  ? `Set attendance time, attendance ${isAttendanceOpen ? 'open' : 'closed'}`
                  : 'Set attendance time, manual attendance'}
              onClick={openTimeDialog}
              className={cn(
                'min-h-control rounded-none border-0 px-2 text-xs font-medium sm:px-3 sm:text-sm',
                hasQrCheckIn && 'border-l border-border-strong',
                hasQrCheckIn && isAttendanceOpen
                  ? 'bg-success-bg text-success hover:bg-success-bg-muted'
                  : 'bg-surface text-text-muted',
              )}
            >
              <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
              {attendanceTime ? (
                hasQrCheckIn ? (
                  <>
                    <span className="sm:hidden">{formatAttendanceRange(attendanceTime, true)}</span>
                    <span className="hidden sm:inline">{formatAttendanceRange(attendanceTime)}</span>
                  </>
                ) : <span>{formatAttendanceRange(attendanceTime)}</span>
              ) : null}
            </Button>
          </div>
        </div>
      )}
      actions={(
        <TeacherWorkSurfaceIconMenuButton
          ariaLabel="More actions"
          tooltip="More actions"
          icon={<MoreVertical className="h-4 w-4" aria-hidden="true" />}
          items={moreActions}
          menuAriaLabel="Daily more actions"
          menuAlign="end"
        />
      )}
    />
  )

  return (
    <div className="space-y-3" data-testid="daily-mockup">
      <TeacherWorkSurfaceShell
        state="workspace"
        primary={actionBar}
        summary={null}
        workspaceFrame="standalone"
        workspaceFrameClassName="min-h-96 rounded-none border-0 bg-page"
        workspace={(
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <TeacherWorkSurfaceTableFrame className="max-h-80 border border-border">
              <DataTable density="tight" className="w-full table-fixed">
                <colgroup>
                  <col className="w-24" />
                  <col className="w-28" />
                  {hasQrCheckIn ? <col className="w-24" /> : null}
                  <col />
                  <col className="w-11" />
                  <col className="w-11" />
                  <col className="w-11" />
                  <col className="w-11" />
                </colgroup>
                <DataTableHead sticky className="bg-surface-3">
                  <DataTableRow>
                    <SortableHeaderCell label="First" isActive={sort.key === 'first'} direction={sort.direction} onClick={() => toggleSort('first')} density="tight" />
                    <SortableHeaderCell label="Last" isActive={sort.key === 'last'} direction={sort.direction} onClick={() => toggleSort('last')} density="tight" />
                    {hasQrCheckIn ? (
                      <DataTableHeaderCell density="tight" align="center" aria-label="Time of scan">
                        <Tooltip content="Time of scan">
                          <span className="inline-flex items-center justify-center" aria-hidden="true">
                            <Clock3 className="h-4 w-4" />
                          </span>
                        </Tooltip>
                      </DataTableHeaderCell>
                    ) : null}
                    <DataTableHeaderCell density="tight">Log</DataTableHeaderCell>
                    {SORTABLE_ATTENDANCE_STATUSES.map((status) => (
                      <DataTableHeaderCell
                        key={status}
                        density="tight"
                        className={cn(
                          'sticky z-sticky-table !p-0 bg-surface-3 text-center',
                          STICKY_ATTENDANCE_OFFSETS[status],
                        )}
                      >
                        <span className="sr-only">{ATTENDANCE_STATUS_LABELS[status]}</span>
                        <AttendanceStatusSortChip
                          status={status}
                          count={statusCounts[status]}
                          active={statusSort === status}
                          tooltipContent={`${statusCounts[status]} ${ATTENDANCE_STATUS_LABELS[status]}`}
                          showSortIndicator
                          onClick={() => {
                            setStatusSort(status)
                            onPrototypeAction(`Sort ${status} first`)
                          }}
                        />
                      </DataTableHeaderCell>
                    ))}
                    <DataTableHeaderCell density="tight" className="sticky right-0 z-sticky-table !p-0 bg-surface-3"><span className="sr-only">Undo manual change</span></DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {students.map((student) => (
                    <DataTableRow key={student.id} className="group hover:bg-surface-hover">
                      <DataTableCell density="tight">{student.first}</DataTableCell>
                      <DataTableCell density="tight">{student.last}</DataTableCell>
                      {hasQrCheckIn ? (
                        <DataTableCell density="tight" className="text-text-muted">{checkIns[student.id] ?? <span aria-label="No QR check-in">—</span>}</DataTableCell>
                      ) : null}
                      <DataTableCell density="tight"><span className="block truncate text-text-muted">{student.log ?? '—'}</span></DataTableCell>
                      {SORTABLE_ATTENDANCE_STATUSES.map((status) => (
                        <DataTableCell
                          key={status}
                          density="tight"
                          className={cn(
                            'sticky z-sticky-table !p-0 bg-surface text-center group-hover:bg-surface-hover',
                            STICKY_ATTENDANCE_OFFSETS[status],
                          )}
                        >
                          <AttendanceMarkButton
                            studentName={`${student.first} ${student.last}`}
                            mark={status}
                            active={statuses[student.id] === status}
                            onClick={() => markStudent(student.id, status)}
                          />
                        </DataTableCell>
                      ))}
                      <DataTableCell density="tight" className="sticky right-0 z-sticky-table !p-0 bg-surface text-center group-hover:bg-surface-hover">
                        {manualChanges[student.id] ? (
                          <IconButton
                            label={`Undo manual change for ${student.first} ${student.last}`}
                            tooltip="Undo manual change"
                            icon={RotateCcw}
                            variant="ghost"
                            size="xs"
                            className="h-11 w-11"
                            onClick={() => undoStudent(student.id)}
                          />
                        ) : null}
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </TeacherWorkSurfaceTableFrame>
            <Card tone="panel" padding="sm">
              <h4 className="text-sm font-semibold">Class Log Summary</h4>
              <p className="mt-1 text-sm text-text-muted">3 complete · 1 incomplete · Habitat observations focused on moisture, shade, and pond edges.</p>
            </Card>
          </div>
        )}
      />
      <p className="text-xs leading-5 text-text-muted">
        {hasQrCheckIn
          ? 'Daily centers the date and equal-height joined QR/time control. Session and class-wide attendance commands stay in More actions; per-student manual changes are reversible in the table.'
          : manualAttendanceMode === 'log'
            ? 'Attendance from log automatically marks students Present when they complete a log that day. Manual overrides can be reverted from the row.'
            : 'With Attendance from log off, the optional time stays passive and attendance changes only when a teacher marks it.'}
      </p>

      <ContentDialog
        isOpen={isBatchDialogOpen}
        onClose={() => setIsBatchDialogOpen(false)}
        title="Edit attendance"
        subtitle={format(parseISO(date), 'EEEE, MMMM d')}
        maxWidth="max-w-md"
        showFooterClose={false}
      >
        <div className="space-y-2">
          {SORTABLE_ATTENDANCE_STATUSES.map((status) => (
            <Button key={status} type="button" variant="secondary" className="w-full justify-start" onClick={() => markAll(status)}>
              <span className={cn('h-3 w-3 shrink-0 rounded-full', ATTENDANCE_STATUS_DOT_CLASSES[status])} aria-hidden="true" />
              Mark all {status}
            </Button>
          ))}
          <Button type="button" variant="secondary" className="w-full justify-start" onClick={revertManualChanges}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Revert manual changes
          </Button>
          {hasQrCheckIn ? (
            <Button type="button" variant="danger" className="w-full justify-start" onClick={clearQrCheckIns}>
              <QrCode className="h-4 w-4" aria-hidden="true" />
              Clear QR check-ins
            </Button>
          ) : null}
        </div>
      </ContentDialog>

      <ContentDialog
        isOpen={isTimeDialogOpen}
        onClose={() => setIsTimeDialogOpen(false)}
        title="Attendance time"
        subtitle={format(parseISO(date), 'EEEE, MMMM d')}
        maxWidth={hasQrCheckIn ? 'max-w-lg' : 'max-w-sm'}
        showFooterClose={false}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            saveAttendanceTime()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Starts">
              <Input type="time" value={draftStartsAt} onChange={(event) => setDraftStartsAt(event.target.value)} />
            </FormField>
            <FormField label="Ends" error={attendanceTimeValidationError || undefined}>
              <Input type="time" value={draftEndsAt} onChange={(event) => setDraftEndsAt(event.target.value)} />
            </FormField>
          </div>
          {hasQrCheckIn ? (
            <div className="space-y-4">
              <div className="rounded-control border border-border bg-surface-2 p-3">
                <p className="text-sm font-semibold text-text-default">Timing rules</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <FormField label="QR opens before start (min)">
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      value={entryOpensMinutesBefore}
                      onChange={(event) => setEntryOpensMinutesBefore(clampMinutes(Number(event.target.value), 120))}
                    />
                  </FormField>
                  <FormField label="Grace period before late (min)">
                    <Input
                      type="number"
                      min={0}
                      max={timingRuleMaxMinutes}
                      value={presentGraceMinutes}
                      onChange={(event) => setPresentGraceMinutes(clampMinutes(Number(event.target.value), timingRuleMaxMinutes))}
                    />
                  </FormField>
                  <FormField label="QR closes before end (min)">
                    <Input
                      type="number"
                      min={0}
                      max={timingRuleMaxMinutes}
                      value={entryClosesMinutesBeforeEnd}
                      onChange={(event) => setEntryClosesMinutesBeforeEnd(clampMinutes(Number(event.target.value), timingRuleMaxMinutes))}
                    />
                  </FormField>
                  <FormField label="Absent before end (min)">
                    <Input
                      type="number"
                      min={0}
                      max={timingRuleMaxMinutes}
                      value={absentMinutesBeforeEnd}
                      onChange={(event) => setAbsentMinutesBeforeEnd(clampMinutes(Number(event.target.value), timingRuleMaxMinutes))}
                    />
                  </FormField>
                </div>
              </div>
              <FormField label="Session end day">
                <SegmentedControl
                  ariaLabel="Session end day"
                  value={sessionEndDay}
                  onChange={setSessionEndDay}
                  className="grid w-full grid-cols-2"
                  options={[
                    { value: 'same', label: 'Same class day', tooltip: 'Class end on the same day', className: 'w-full' },
                    { value: 'next', label: 'Next day', tooltip: 'Class ends the next day after midnight', className: 'w-full' },
                  ]}
                />
              </FormField>
              <label className="flex min-h-control cursor-pointer items-center gap-3 rounded-control border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-text-default">
                <TableSelectionCheckbox
                  checked={opensAutomatically}
                  ariaLabel="Open and close QR attendance automatically"
                  onChange={setOpensAutomatically}
                />
                <span>Open and close QR attendance automatically</span>
              </label>
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-2 sm:flex sm:justify-end">
            <Button type="button" variant="ghost" size="sm" className="w-full sm:w-auto" onClick={clearAttendanceTime}>Clear time</Button>
            <Button type="button" variant="secondary" size="sm" className="w-full sm:w-auto" onClick={() => setIsTimeDialogOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" className="w-full sm:w-auto" disabled={Boolean(attendanceTimeValidationError)}>Save time</Button>
          </div>
        </form>
      </ContentDialog>
    </div>
  )
}
