'use client'

import { type CSSProperties, type ReactNode, type Ref } from 'react'
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
  ResizableHeaderCell,
  SortableHeaderCell,
  TableCard,
  TableSelectionCell,
  TableSelectionHeaderCell,
  Tooltip,
} from '@/ui'
import { useTableColumnWidths } from '@/hooks/useTableColumnWidths'
import { Spinner } from '@/components/Spinner'
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
  someSelected: boolean
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

type ResizableColumnKey = 'first' | 'last' | 'status' | 'grade'

const COLUMN_LIMITS: Record<ResizableColumnKey, { defaultWidth: number; min: number; max: number }> = {
  first: { defaultWidth: 72, min: 58, max: 160 },
  last: { defaultWidth: 72, min: 58, max: 160 },
  status: { defaultWidth: 78, min: 70, max: 110 },
  grade: { defaultWidth: 62, min: 56, max: 88 },
}

const getAssignmentStudentRowId = (studentId: string) => `assignment-student-row-${studentId}`

function getRowClassName(isSelected: boolean): string {
  if (isSelected) {
    return 'cursor-pointer border-l-2 border-l-primary bg-surface-selected shadow-sm'
  }
  return 'cursor-pointer hover:bg-surface-hover'
}

function getColumnStyle(width: number): CSSProperties {
  return { width: `${width}px`, maxWidth: `${width}px` }
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
  someSelected,
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
  const { columnWidths, setColumnWidth } = useTableColumnWidths({
    storageKey: 'teacher-assignment-students:v1',
    columns: COLUMN_LIMITS,
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <KeyboardNavigableTable
        ariaLabel="Assignment students"
        ref={tableRef}
        rowKeys={rows.map((student) => student.student_id)}
        selectedKey={selectedStudentId}
        onSelectKey={onSelectStudent}
        onDeselect={onDeselectStudent}
        getRowId={getAssignmentStudentRowId}
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
              <DataTable density={density} className="table-fixed">
                <colgroup>
                  <col style={{ width: '40px' }} />
                  <col style={{ width: `${columnWidths.first}px` }} />
                  <col style={{ width: `${columnWidths.last}px` }} />
                  <col style={{ width: `${columnWidths.status}px` }} />
                  <col style={{ width: `${columnWidths.grade}px` }} />
                  <col />
                </colgroup>
                <DataTableHead>
                  <DataTableRow>
                    <TableSelectionHeaderCell
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={onToggleSelectAll}
                      ariaLabel="Select all students"
                    />
                    <SortableHeaderCell
                      label="First"
                      isActive={sortColumn === 'first'}
                      direction={sortDirection}
                      onClick={() => onToggleSort('first')}
                      density={density}
                      buttonClassName="!py-2 !pl-1.5 !pr-4"
                      resize={{
                        value: columnWidths.first,
                        min: COLUMN_LIMITS.first.min,
                        max: COLUMN_LIMITS.first.max,
                        onChange: (width) => setColumnWidth('first', width),
                      }}
                    />
                    <SortableHeaderCell
                      label="Last"
                      isActive={sortColumn === 'last'}
                      direction={sortDirection}
                      onClick={() => onToggleSort('last')}
                      density={density}
                      buttonClassName="!py-2 !pl-1.5 !pr-4"
                      resize={{
                        value: columnWidths.last,
                        min: COLUMN_LIMITS.last.min,
                        max: COLUMN_LIMITS.last.max,
                        onChange: (width) => setColumnWidth('last', width),
                      }}
                    />
                    <SortableHeaderCell
                      label="Status"
                      isActive={sortColumn === 'status'}
                      direction={sortDirection}
                      onClick={() => onToggleSort('status')}
                      density={density}
                      align="center"
                      buttonClassName="!py-2 !pl-1.5 !pr-4"
                      resize={{
                        value: columnWidths.status,
                        min: COLUMN_LIMITS.status.min,
                        max: COLUMN_LIMITS.status.max,
                        onChange: (width) => setColumnWidth('status', width),
                      }}
                    />
                    <ResizableHeaderCell
                      label="Grade"
                      align="center"
                      className="!py-2 !pl-1.5 !pr-3"
                      resize={{
                        value: columnWidths.grade,
                        min: COLUMN_LIMITS.grade.min,
                        max: COLUMN_LIMITS.grade.max,
                        onChange: (width) => setColumnWidth('grade', width),
                      }}
                    />
                    <DataTableHeaderCell className="whitespace-nowrap !px-1.5 !py-2">
                      <span className="block truncate">Artifacts</span>
                    </DataTableHeaderCell>
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
                        id={getAssignmentStudentRowId(student.student_id)}
                        aria-selected={isSelected}
                        tabIndex={-1}
                        className={getRowClassName(isSelected)}
                        onClick={() => onSelectStudent(student.student_id)}
                      >
                        <TableSelectionCell
                          checked={selectedIds.has(student.student_id)}
                          onChange={() => onToggleSelect(student.student_id)}
                          ariaLabel={`Select ${student.student_first_name ?? ''} ${student.student_last_name ?? ''}`}
                        />
                        <DataTableCell className="truncate !px-1.5" style={getColumnStyle(columnWidths.first)}>
                          {student.student_first_name ? (
                            <Tooltip content={`${student.student_first_name} ${student.student_last_name ?? ''}`}>
                              <span className="block truncate">{student.student_first_name}</span>
                            </Tooltip>
                          ) : '—'}
                        </DataTableCell>
                        <DataTableCell className="truncate !px-1.5" style={getColumnStyle(columnWidths.last)}>
                          {student.student_last_name ? (
                            <Tooltip content={student.student_last_name}>
                              <span className="block truncate">{student.student_last_name}</span>
                            </Tooltip>
                          ) : '—'}
                        </DataTableCell>
                        <DataTableCell align="center" className="!px-1" style={getColumnStyle(columnWidths.status)}>
                          <Tooltip content={statusLabel}>
                            <span className="inline-flex" role="img" aria-label={statusLabel}>
                              <StatusIcon display={statusDisplay} />
                            </span>
                          </Tooltip>
                        </DataTableCell>
                        <DataTableCell align="center" className="whitespace-nowrap !px-1.5 text-text-muted" style={getColumnStyle(columnWidths.grade)}>
                          {totalScore !== null ? `${Math.round((totalScore / 30) * 100)}` : '—'}
                        </DataTableCell>
                        <DataTableCell className="align-top !px-1.5">
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
