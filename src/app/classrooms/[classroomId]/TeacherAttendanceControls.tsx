'use client'

import { ChevronDown } from 'lucide-react'
import { Button, SegmentedControl, Tooltip, cn } from '@/ui'
import type { TeacherAttendanceStatus } from '@/lib/teacher-attendance'
import type { TeacherAttendanceMark } from '@/hooks/useTeacherAttendanceController'

export const ATTENDANCE_STATUS_LABELS: Record<TeacherAttendanceStatus, string> = {
  unmarked: 'Unmarked',
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
}

export const SORTABLE_ATTENDANCE_STATUSES: TeacherAttendanceMark[] = [
  'present',
  'late',
  'absent',
]

const STATUS_CHIP_CLASSES: Record<TeacherAttendanceMark, string> = {
  present: 'bg-attendance-present text-attendance-present-text',
  late: 'bg-attendance-late text-attendance-late-text',
  absent: 'bg-attendance-absent text-attendance-absent-text',
}

export const ATTENDANCE_STATUS_DOT_CLASSES: Record<TeacherAttendanceMark, string> = {
  present: 'bg-attendance-present',
  late: 'bg-attendance-late',
  absent: 'bg-attendance-absent',
}

const STATUS_BUTTON_CLASSES: Record<TeacherAttendanceMark, string> = {
  present: 'bg-transparent hover:bg-transparent after:bg-attendance-present',
  late: 'bg-transparent hover:bg-transparent after:bg-attendance-late',
  absent: 'bg-transparent hover:bg-transparent after:bg-attendance-absent',
}

export function AttendanceMarkButton({
  studentName,
  status,
  active,
  disabled,
  onClick,
}: {
  studentName: string
  status: TeacherAttendanceMark
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  const label = ATTENDANCE_STATUS_LABELS[status]
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          "relative h-11 w-11 rounded-full p-0 after:pointer-events-none after:absolute after:h-5 after:w-5 after:rounded-full after:content-['']",
          STATUS_BUTTON_CLASSES[status],
          active
            ? 'after:opacity-100 after:ring-2 after:ring-primary after:ring-offset-1 after:ring-offset-surface-2 after:shadow-sm'
            : 'after:opacity-[0.12] hover:after:opacity-40',
        )}
        aria-label={`Mark ${studentName} ${label.toLowerCase()}`}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
      />
    </Tooltip>
  )
}

export function AttendanceStatusSortChip({
  status,
  count,
  active,
  onClick,
  tooltipContent,
  showSortIndicator = false,
}: {
  status: TeacherAttendanceMark
  count: number
  active: boolean
  onClick: () => void
  tooltipContent?: string
  showSortIndicator?: boolean
}) {
  const label = ATTENDANCE_STATUS_LABELS[status]
  const studentLabel = count === 1 ? 'student' : 'students'

  return (
    <Tooltip content={tooltipContent ?? `${count} ${studentLabel} ${label.toLowerCase()}. Sort ${label.toLowerCase()} first`}>
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
            'inline-flex h-5 w-7 items-center justify-center rounded-badge px-0 text-xs font-semibold tabular-nums',
            showSortIndicator && 'relative',
            STATUS_CHIP_CLASSES[status],
            active && 'ring-foundation ring-focus ring-offset-2 ring-offset-surface',
          )}
        >
          {count}
          {showSortIndicator ? (
            <ChevronDown
              className={cn(
                'absolute right-0.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2',
                active ? 'text-current' : 'opacity-0',
              )}
              aria-hidden="true"
            />
          ) : null}
        </span>
      </Button>
    </Tooltip>
  )
}

export function AttendanceStatusControl({
  studentName,
  status,
  disabled,
  onChange,
}: {
  studentName: string
  status: TeacherAttendanceStatus
  disabled: boolean
  onChange: (status: TeacherAttendanceMark) => void
}) {
  return (
    <SegmentedControl<TeacherAttendanceStatus>
      ariaLabel={`Attendance status for ${studentName}`}
      value={status}
      iconOnly
      className="gap-0 bg-transparent p-0"
      options={SORTABLE_ATTENDANCE_STATUSES.map((optionStatus) => ({
        value: optionStatus,
        label: ATTENDANCE_STATUS_LABELS[optionStatus],
        disabled,
        className: cn(
          "relative h-11 w-11 min-h-11 min-w-11 rounded-full after:pointer-events-none after:absolute after:h-5 after:w-5 after:rounded-full after:content-['']",
          STATUS_BUTTON_CLASSES[optionStatus],
        ),
        activeClassName: 'after:opacity-100 after:ring-2 after:ring-primary after:ring-offset-1 after:ring-offset-surface-2 after:shadow-sm',
        inactiveClassName: 'after:opacity-[0.12] hover:after:opacity-40',
      }))}
      onChange={(nextStatus) => {
        if (nextStatus !== 'unmarked') onChange(nextStatus)
      }}
    />
  )
}
