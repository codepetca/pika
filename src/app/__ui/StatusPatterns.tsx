'use client'

import { useState } from 'react'
import {
  ATTENDANCE_STATUS_LABELS,
  AttendanceStatusControl,
  AttendanceStatusSortChip,
  SORTABLE_ATTENDANCE_STATUSES,
} from '@/app/classrooms/[classroomId]/TeacherAttendanceControls'
import {
  AssessmentStatusIndicator,
  getAssignmentWorkStatusDisplay,
  getTestGradingWorkStatusDisplay,
} from '@/components/AssessmentStatusIndicator'
import type { TeacherAttendanceStatus } from '@/lib/teacher-attendance'
import {
  Button, Card, DataTable, DataTableBody, DataTableCell,
  DataTableHead, DataTableHeaderCell, DataTableRow,
} from '@/ui'

type Mark = (typeof SORTABLE_ATTENDANCE_STATUSES)[number]
type SampleRow = { name: string; status: TeacherAttendanceStatus }

const SAMPLE_ROWS: SampleRow[] = [
  { name: 'Alex', status: 'present' },
  { name: 'Blair', status: 'late' },
  { name: 'Casey', status: 'absent' },
  { name: 'Drew', status: 'present' },
  { name: 'Ellis', status: 'unmarked' },
]

const ASSIGNMENT_STATES = [
  { status: 'not_started', meaning: 'No work started.' },
  { status: 'in_progress', meaning: 'Work started but not submitted.' },
  { status: 'submitted_on_time', meaning: 'Student submitted work.' },
  { status: 'graded', meaning: 'Graded but not yet returned.' },
  { status: 'returned', meaning: 'Results released to the student.' },
  { status: 'resubmitted', meaning: 'Submitted again after return.' },
] as const

const TEST_STATES = ['closed', 'submitted', 'returned'] as const

export function StatusPatterns() {
  const [rows, setRows] = useState(SAMPLE_ROWS)
  const [sortStatus, setSortStatus] = useState<Mark | null>(null)
  const sortedRows = [...rows].sort((a, b) =>
    Number(b.status === sortStatus) - Number(a.status === sortStatus)
    || a.name.localeCompare(b.name),
  )

  return (
    <section id="status-colors" aria-label="Status colors and count chips" className="scroll-mt-6 space-y-4" data-testid="status-pattern-examples">
      <div>
        <h3 className="font-semibold">Status colors &amp; count chips</h3>
        <p className="mt-1 text-sm text-text-muted">Number-only chips. Hover or focus for the status and count.</p>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card tone="panel" padding="md">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold">Attendance</h4>
            <Button size="sm" variant="subtle" onClick={() => { setRows(SAMPLE_ROWS); setSortStatus(null) }}>Reset example</Button>
          </div>
          <p className="mt-1 text-xs text-text-muted">Present: green · Late: yellow · Absent: red</p>
          <div className="mt-3" data-testid="attendance-chip-example">
            <DataTable density="tight">
              <caption className="sr-only">Sample attendance</caption>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell density="tight">Student</DataTableHeaderCell>
                  <DataTableHeaderCell density="tight" aria-sort={sortStatus ? 'other' : 'none'} className="!p-0">
                    <div role="group" aria-label="Sort sample attendance by status" className="flex items-center">
                      {SORTABLE_ATTENDANCE_STATUSES.map((status) => (
                        <AttendanceStatusSortChip
                          key={status}
                          status={status}
                          count={rows.filter((row) => row.status === status).length}
                          active={sortStatus === status}
                          onClick={() => setSortStatus(status)}
                        />
                      ))}
                    </div>
                  </DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {sortedRows.map((row) => (
                  <DataTableRow key={row.name}>
                    <DataTableCell density="tight">
                      <span>{row.name}</span>
                      <span className="sr-only">: {ATTENDANCE_STATUS_LABELS[row.status]}</span>
                    </DataTableCell>
                    <DataTableCell density="tight" className="!p-0">
                      <AttendanceStatusControl
                        studentName={row.name}
                        status={row.status}
                        disabled={false}
                        onChange={(status) => setRows((current) => current.map((item) => item.name === row.name ? { ...item, status } : item))}
                      />
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </div>
          <p className="mt-3 text-xs text-text-muted" role="status">
            {sortStatus ? `${ATTENDANCE_STATUS_LABELS[sortStatus]} first · all 5 sample students remain visible.` : 'Select a count to sort. Change a row to update the counts.'}
          </p>
          <p className="mt-2 text-xs text-text-muted">Unmarked has no selected circle or count chip. Sample data only—nothing is saved.</p>
        </Card>
        <Card tone="panel" padding="md">
          <h4 className="text-sm font-semibold">Classwork &amp; Tests</h4>
          <p className="mt-1 text-xs text-text-muted">Existing status colors and labels; each workflow keeps its meaning.</p>
          <h5 className="mt-4 text-xs font-semibold text-text-muted">Classwork</h5>
          <dl className="mt-2 divide-y divide-border">
            {ASSIGNMENT_STATES.map(({ status, meaning }) => {
              const display = getAssignmentWorkStatusDisplay(status)
              return (
                <div key={status} className="grid grid-cols-2 gap-3 py-2 text-sm">
                  <dt><AssessmentStatusIndicator display={display} /></dt>
                  <dd className="text-text-muted">{meaning}</dd>
                </div>
              )
            })}
          </dl>
          <h5 className="mt-4 text-xs font-semibold text-text-muted">Test grading</h5>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">
            {TEST_STATES.map((status) => {
              const display = getTestGradingWorkStatusDisplay(status)
              return <AssessmentStatusIndicator key={status} display={display} />
            })}
          </div>
          <p className="mt-4 text-xs text-text-muted">Submit, Grade, and Return are actions. Submitted, Graded, and Returned are states. Classwork and Tests use the Reply icon for Return and Returned. Use Submitted for a student hand-in, rather than the ambiguous Sent.</p>
          <p className="mt-2 text-xs text-text-muted">A student’s Checked in confirmation is separate from the teacher’s Present/Late/Absent mark.</p>
        </Card>
      </div>
    </section>
  )
}
