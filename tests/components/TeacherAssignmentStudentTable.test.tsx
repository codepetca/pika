import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  TeacherAssignmentStudentTable,
  type TeacherAssignmentStudentRow,
} from '@/components/assignment-workspace/TeacherAssignmentStudentTable'

vi.mock('@/components/AssignmentArtifactsCell', () => ({
  AssignmentArtifactsCell: () => <span>Artifacts</span>,
}))

vi.mock('@/ui', async () => {
  const actual = await vi.importActual<typeof import('@/ui')>('@/ui')
  return {
    ...actual,
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  }
})

const row: TeacherAssignmentStudentRow = {
  student_id: 'student-1',
  student_email: 'student-1@example.com',
  student_first_name: 'Ada',
  student_last_name: 'Lovelace',
  status: 'submitted_on_time',
  student_updated_at: '2026-04-10T12:00:00Z',
  artifacts: [],
  doc: {
    submitted_at: '2026-04-10T12:00:00Z',
    updated_at: '2026-04-10T12:00:00Z',
    score_completion: 8,
    score_thinking: 9,
    score_workflow: 10,
    graded_at: '2026-04-11T12:00:00Z',
    returned_at: null,
    feedback_returned_at: null,
  },
}

describe('TeacherAssignmentStudentTable', () => {
  it('renders assignment student rows with selection, sort, grade, and artifact cells', () => {
    render(
      <TeacherAssignmentStudentTable
        rows={[row]}
        selectedStudentId="student-1"
        onSelectStudent={vi.fn()}
        onDeselectStudent={vi.fn()}
        selectedIds={new Set(['student-1'])}
        onToggleSelect={vi.fn()}
        onToggleSelectAll={vi.fn()}
        allSelected
        sortColumn="last"
        sortDirection="asc"
        onToggleSort={vi.fn()}
        dueAtMs={new Date('2026-04-20T12:00:00Z').getTime()}
        density="compact"
        loading={false}
        error=""
      />,
    )

    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Lovelace')).toBeInTheDocument()
    expect(screen.getByText('90')).toBeInTheDocument()
    expect(screen.getAllByText('Artifacts')).toHaveLength(2)
    expect(screen.getByRole('checkbox', { name: 'Select all students' })).toBeChecked()
  })

  it('keeps row selection and batch selection as separate behaviors', () => {
    const onSelectStudent = vi.fn()
    const onToggleSelect = vi.fn()

    render(
      <TeacherAssignmentStudentTable
        rows={[row]}
        selectedStudentId={null}
        onSelectStudent={onSelectStudent}
        onDeselectStudent={vi.fn()}
        selectedIds={new Set()}
        onToggleSelect={onToggleSelect}
        onToggleSelectAll={vi.fn()}
        allSelected={false}
        sortColumn="last"
        sortDirection="asc"
        onToggleSort={vi.fn()}
        dueAtMs={new Date('2026-04-20T12:00:00Z').getTime()}
        density="compact"
        loading={false}
        error=""
      />,
    )

    fireEvent.click(screen.getByText('Ada'))
    expect(onSelectStudent).toHaveBeenCalledWith('student-1')

    onSelectStudent.mockClear()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    expect(onToggleSelect).toHaveBeenCalledWith('student-1')
    expect(onSelectStudent).not.toHaveBeenCalled()
  })
})
