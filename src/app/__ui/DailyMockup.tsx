'use client'

import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronDown, Clock3, MoreVertical, QrCode, UserRoundCheck } from 'lucide-react'
import {
  AttendanceStatusControl,
  AttendanceStatusSortChip,
  SORTABLE_ATTENDANCE_STATUSES,
} from '@/app/classrooms/[classroomId]/TeacherAttendanceControls'
import { DateNavigator } from '@/components/DateNavigator'
import {
  TeacherWorkSurfaceIconMenuButton,
  TeacherWorkSurfaceMenuButton,
  type TeacherWorkSurfaceActionItem,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherWorkSurfaceTableFrame } from '@/components/teacher-work-surface/TeacherWorkSurfaceTableFrame'
import { addDaysToDateString, getPastRelativeDateLabel } from '@/lib/date-string'
import type { TeacherAttendanceStatus } from '@/lib/teacher-attendance'
import {
  Button,
  Card,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  SortableHeaderCell,
  TableSelectionCell,
  TableSelectionHeaderCell,
} from '@/ui'

const REFERENCE_TODAY = '2026-09-16'

const DAILY_STUDENTS = [
  { id: 'maya', first: 'Maya', last: 'Chen', checkIn: '8:52 AM', log: 'Compared shade and sunlight plots.', status: 'present' as const },
  { id: 'noah', first: 'Noah', last: 'Williams', checkIn: '9:07 AM', log: 'Recorded soil moisture and insects.', status: 'late' as const },
  { id: 'sana', first: 'Sana', last: 'Patel', checkIn: null, log: null, status: 'absent' as const },
  { id: 'theo', first: 'Theo', last: 'Martin', checkIn: '8:48 AM', log: 'Mapped the edge of the pond habitat.', status: 'present' as const },
]

type DailyStudentId = (typeof DAILY_STUDENTS)[number]['id']
type SortKey = 'first' | 'last'

export function DailyMockup({ onPrototypeAction }: { onPrototypeAction: (action: string) => void }) {
  const [date, setDate] = useState('2026-09-16')
  const [showRelativeDate, setShowRelativeDate] = useState(true)
  const [selected, setSelected] = useState<DailyStudentId[]>([])
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'last', direction: 'asc' })
  const [statuses, setStatuses] = useState<Record<DailyStudentId, TeacherAttendanceStatus>>(() => (
    Object.fromEntries(DAILY_STUDENTS.map((student) => [student.id, student.status])) as Record<DailyStudentId, TeacherAttendanceStatus>
  ))

  const students = useMemo(() => [...DAILY_STUDENTS].sort((a, b) => {
    const direction = sort.direction === 'asc' ? 1 : -1
    return direction * a[sort.key].localeCompare(b[sort.key])
  }), [sort])
  const statusCounts = useMemo(() => Object.values(statuses).reduce((counts, status) => {
    if (status !== 'unmarked') counts[status] += 1
    return counts
  }, { present: 0, late: 0, absent: 0 }), [statuses])

  const setAllSelected = (checked: boolean) => setSelected(checked ? students.map((student) => student.id) : [])
  const toggleSelected = (id: DailyStudentId) => setSelected((current) => (
    current.includes(id) ? current.filter((studentId) => studentId !== id) : [...current, id]
  ))
  const markSelected = (status: 'present' | 'late' | 'absent') => {
    setStatuses((current) => ({
      ...current,
      ...Object.fromEntries(selected.map((studentId) => [studentId, status])),
    }))
    onPrototypeAction(`Mark ${selected.length} ${status}`)
  }
  const toggleSort = (key: SortKey) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
  }))

  const selectedActions: TeacherWorkSurfaceActionItem[] = SORTABLE_ATTENDANCE_STATUSES.map((status) => ({
    id: status,
    label: `Mark ${status}`,
    onSelect: () => markSelected(status),
  }))
  const moreActions: TeacherWorkSurfaceActionItem[] = [
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
    {
      id: 'hours',
      label: 'Attendance hours: 9:00–10:00 AM',
      icon: <Clock3 className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onPrototypeAction('Edit attendance hours'),
    },
  ]

  const actionBar = (
    <TeacherWorkSurfaceContextBar
      ariaLabel="Daily mockup controls"
      context={<span className="hidden truncate sm:inline">9:00–10:00 AM</span>}
      primary={(
        <div className="flex min-w-0 items-center gap-1">
          <DateNavigator
            joined
            label={format(parseISO(date), 'EEE MMM d')}
            subtitle={showRelativeDate ? getPastRelativeDateLabel(date, REFERENCE_TODAY) : null}
            reserveSubtitleSpace
            onPrev={() => setDate((current) => addDaysToDateString(current, -1))}
            onNext={() => setDate((current) => addDaysToDateString(current, 1))}
            onLabelClick={() => setDate(REFERENCE_TODAY)}
            labelAriaLabel="Return to reference Daily date"
            prevAriaLabel="Previous Daily date"
            nextAriaLabel="Next Daily date"
            labelClassName="min-w-24 px-2 sm:min-w-28 sm:px-3"
          />
          <Button
            type="button"
            size="sm"
            variant="primary"
            className="h-9 w-9 px-0"
            aria-label="Show attendance QR"
            onClick={() => onPrototypeAction('Show attendance QR')}
          >
            <QrCode className="h-4 w-4" aria-hidden="true" />
          </Button>
          <TeacherWorkSurfaceMenuButton
            label={(
              <span className="inline-flex items-center gap-1.5">
                <span className="hidden sm:inline">{selected.length ? `${selected.length} selected` : 'Student actions'}</span>
                <span className="sm:hidden" aria-hidden="true">{selected.length || <UserRoundCheck className="h-4 w-4" />}</span>
                <ChevronDown className="hidden h-4 w-4 sm:block" aria-hidden="true" />
              </span>
            )}
            items={selectedActions}
            variant="secondary"
            size="sm"
            disabled={selected.length === 0}
            menuAriaLabel="Selected student attendance actions"
            menuAlign="center"
            buttonProps={{
              'aria-label': selected.length ? `Student actions for ${selected.length} selected` : 'Student actions (select students to enable)',
            }}
          />
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
              <DataTable density="tight" className="min-w-max table-fixed">
                <colgroup><col className="w-10" /><col className="w-28" /><col className="w-32" /><col className="w-28" /><col /><col className="w-40" /></colgroup>
                <DataTableHead sticky className="bg-surface-3">
                  <DataTableRow>
                    <TableSelectionHeaderCell
                      checked={selected.length === students.length}
                      indeterminate={selected.length > 0 && selected.length < students.length}
                      onChange={setAllSelected}
                      ariaLabel="Select all Daily students"
                    />
                    <SortableHeaderCell label="First" isActive={sort.key === 'first'} direction={sort.direction} onClick={() => toggleSort('first')} density="tight" />
                    <SortableHeaderCell label="Last" isActive={sort.key === 'last'} direction={sort.direction} onClick={() => toggleSort('last')} density="tight" />
                    <DataTableHeaderCell density="tight">Check-in</DataTableHeaderCell>
                    <DataTableHeaderCell density="tight">Log</DataTableHeaderCell>
                    <DataTableHeaderCell density="tight" className="!p-0">
                      <span role="group" aria-label="Sort Daily attendance by status" className="flex min-h-control items-center px-1">
                        {SORTABLE_ATTENDANCE_STATUSES.map((status) => (
                          <AttendanceStatusSortChip key={status} status={status} count={statusCounts[status]} active={false} onClick={() => onPrototypeAction(`Sort ${status} first`)} />
                        ))}
                      </span>
                    </DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {students.map((student) => {
                    const hasLog = Boolean(student.log)
                    return (
                      <DataTableRow key={student.id} aria-selected={selected.includes(student.id)} className={selected.includes(student.id) ? 'bg-info-bg' : 'hover:bg-surface-hover'}>
                        <TableSelectionCell checked={selected.includes(student.id)} onChange={() => toggleSelected(student.id)} ariaLabel={`Select ${student.first} ${student.last}`} />
                        <DataTableCell density="tight">{student.first}</DataTableCell>
                        <DataTableCell density="tight">{student.last}</DataTableCell>
                        <DataTableCell density="tight" className="text-text-muted">{student.checkIn ?? <span className="sr-only">No QR check-in</span>}</DataTableCell>
                        <DataTableCell density="tight">
                          <span className="flex min-w-0 items-center gap-2">
                            <span aria-label={hasLog ? 'Complete' : 'Incomplete'} className={`h-3 w-3 shrink-0 rounded-full ${hasLog ? 'bg-success-solid' : 'bg-danger-solid'}`} />
                            <span className="truncate text-text-muted">{student.log ?? '—'}</span>
                          </span>
                        </DataTableCell>
                        <DataTableCell density="tight" className="!py-0">
                          <AttendanceStatusControl
                            studentName={`${student.first} ${student.last}`}
                            status={statuses[student.id]}
                            disabled={false}
                            onChange={(status) => setStatuses((current) => ({ ...current, [student.id]: status }))}
                          />
                        </DataTableCell>
                      </DataTableRow>
                    )
                  })}
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
      <p className="text-xs leading-5 text-text-muted">Daily keeps its date, QR and attendance commands in the established action bar. The table combines log completion, check-in evidence and teacher-owned attendance status without live data.</p>
    </div>
  )
}
