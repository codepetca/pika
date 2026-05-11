'use client'

import type { ReactNode, Ref } from 'react'
import { AssignmentArtifactsCell } from '@/components/AssignmentArtifactsCell'
import {
  AssessmentStatusIndicator,
  getAssignmentWorkStatusDisplay,
  type AssessmentWorkStatusDisplay,
} from '@/components/AssessmentStatusIndicator'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
  KeyboardNavigableTable,
  SortableHeaderCell,
  TableCard,
} from '@/components/DataTable'
import { Spinner } from '@/components/Spinner'
import { Tooltip } from '@/ui'
import {
  hasDraftSavedGrade,
} from '@/lib/assignments'
import type { AssignmentStatus } from '@/types'
import type { AssignmentArtifact } from '@/lib/assignment-artifacts'
import type { SortDirection } from '@/lib/table-sort'

export interface TeacherAssignmentStudentRow {
  student_id: string
  student_email: string
  student_first_name: string | null
  student_last_name: string | null
  status: AssignmentStatus
  student_updated_at?: string | null
  artifacts: AssignmentArtifact[]
  doc: {
    is_submitted?: boolean | null
    submitted_at?: string | null
    updated_at?: string | null
    score_completion?: number | null
    score_thinking?: number | null
    score_workflow?: number | null
    graded_at?: string | null
    returned_at?: string | null
    teacher_cleared_at?: string | null
    feedback_returned_at?: string | null
  } | null
}

interface TeacherAssignmentStudentTableProps {
  rows: TeacherAssignmentStudentRow[]
  selectedStudentId: string | null
  onSelectStudent: (studentId: string) => void
  onDeselectStudent: () => void
  tableRef?: Ref<HTMLDivElement>
  selectedIds: Set<string>
  onToggleSelect: (studentId: string) => void
  onToggleSelectAll: () => void
  allSelected: boolean
  sortColumn: 'first' | 'last' | 'status'
  sortDirection: SortDirection
  onToggleSort: (column: 'first' | 'last' | 'status') => void
  dueAtMs: number
  density: 'tight' | 'compact'
  loading: boolean
  error: string
  emptyMessage?: string
  busyOverlay?: ReactNode
}

function getRowClassName(isSelected: boolean): string {
  if (isSelected) {
    return 'cursor-pointer border-l-2 border-l-primary bg-surface-selected shadow-sm'
  }
  return 'cursor-pointer hover:bg-surface-hover'
}

function StatusIcon({ display }: { display: AssessmentWorkStatusDisplay }) {
  const icon = <AssessmentStatusIndicator display={display} showLabel={false} />

  if (display.shortLabel) {
    return (
      <span
        className={[
          'inline-flex items-center gap-1 rounded-badge px-1.5 py-0.5 text-[11px] font-semibold leading-none',
          display.chipClassName,
        ].filter(Boolean).join(' ')}
        data-testid="assignment-status-resubmitted-chip"
      >
        {icon}
        <span>{display.shortLabel}</span>
      </span>
    )
  }

  return icon
}

export function TeacherAssignmentStudentTable({
  rows,
  selectedStudentId,
  onSelectStudent,
  onDeselectStudent,
  tableRef,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  sortColumn,
  sortDirection,
  onToggleSort,
  dueAtMs,
  density,
  loading,
  error,
  emptyMessage = 'No students enrolled',
  busyOverlay,
}: TeacherAssignmentStudentTableProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <KeyboardNavigableTable
        ref={tableRef}
        rowKeys={rows.map((student) => student.student_id)}
        selectedKey={selectedStudentId}
        onSelectKey={onSelectStudent}
        onDeselect={onDeselectStudent}
      >
        <TableCard chrome="flush">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-danger">
              {error}
            </div>
          ) : (
            <div className="relative">
              {busyOverlay}
              <DataTable density={density}>
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell className="w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={onToggleSelectAll}
                        onClick={(event) => event.stopPropagation()}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        aria-label="Select all students"
                      />
                    </DataTableHeaderCell>
                    <SortableHeaderCell
                      label="First Name"
                      isActive={sortColumn === 'first'}
                      direction={sortDirection}
                      onClick={() => onToggleSort('first')}
                      className="w-[7rem]"
                    />
                    <SortableHeaderCell
                      label="Last Name"
                      isActive={sortColumn === 'last'}
                      direction={sortDirection}
                      onClick={() => onToggleSort('last')}
                      className="w-[7rem]"
                    />
                    <SortableHeaderCell
                      label="Status"
                      isActive={sortColumn === 'status'}
                      direction={sortDirection}
                      onClick={() => onToggleSort('status')}
                      className="w-[5.75rem]"
                    />
                    <DataTableHeaderCell className="w-[4.75rem]">Grade</DataTableHeaderCell>
                    <DataTableHeaderCell className="w-[11rem]">Artifacts</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {rows.map((student) => {
                    const isSelected = selectedStudentId === student.student_id
                    const totalScore =
                      student.doc?.score_completion != null &&
                      student.doc?.score_thinking != null &&
                      student.doc?.score_workflow != null
                        ? student.doc.score_completion + student.doc.score_thinking + student.doc.score_workflow
                        : null
                    const hasDraftGrade = hasDraftSavedGrade(student.doc ? {
                      graded_at: student.doc.graded_at ?? null,
                      score_completion: student.doc.score_completion ?? null,
                      score_thinking: student.doc.score_thinking ?? null,
                      score_workflow: student.doc.score_workflow ?? null,
                    } : null)
                    const wasLate = !!(
                      student.doc?.submitted_at &&
                      dueAtMs &&
                      new Date(student.doc.submitted_at).getTime() > dueAtMs
                    )
                    const statusDisplay = getAssignmentWorkStatusDisplay(student.status, {
                      wasLate,
                      hasDraftGrade,
                    })
                    const statusLabel = statusDisplay.label

                    return (
                      <DataTableRow
                        key={student.student_id}
                        className={getRowClassName(isSelected)}
                        onClick={() => onSelectStudent(student.student_id)}
                      >
                        <DataTableCell>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(student.student_id)}
                            onChange={() => onToggleSelect(student.student_id)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                            aria-label={`Select ${student.student_first_name ?? ''} ${student.student_last_name ?? ''}`}
                          />
                        </DataTableCell>
                        <DataTableCell className="w-[7rem] max-w-[7rem] truncate">
                          {student.student_first_name ? (
                            <Tooltip content={`${student.student_first_name} ${student.student_last_name ?? ''}`}>
                              <span>{student.student_first_name}</span>
                            </Tooltip>
                          ) : '—'}
                        </DataTableCell>
                        <DataTableCell className="w-[7rem] max-w-[7rem] truncate">
                          {student.student_last_name ? (
                            <Tooltip content={student.student_last_name}>
                              <span>{student.student_last_name}</span>
                            </Tooltip>
                          ) : '—'}
                        </DataTableCell>
                        <DataTableCell className="w-[5.75rem]">
                          <Tooltip content={statusLabel}>
                            <span className="inline-flex" role="img" aria-label={statusLabel}>
                              <StatusIcon display={statusDisplay} />
                            </span>
                          </Tooltip>
                        </DataTableCell>
                        <DataTableCell className="w-[4.75rem] whitespace-nowrap text-text-muted">
                          {totalScore !== null ? `${Math.round((totalScore / 30) * 100)}` : '—'}
                        </DataTableCell>
                        <DataTableCell className="w-[11rem] max-w-[11rem] align-top">
                          <AssignmentArtifactsCell
                            artifacts={student.artifacts || []}
                            isCompact={density === 'tight'}
                          />
                        </DataTableCell>
                      </DataTableRow>
                    )
                  })}
                  {rows.length === 0 && (
                    <EmptyStateRow colSpan={6} message={emptyMessage} />
                  )}
                </DataTableBody>
              </DataTable>
            </div>
          )}
        </TableCard>
      </KeyboardNavigableTable>
    </div>
  )
}
