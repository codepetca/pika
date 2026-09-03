import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GradebookStudentPanel } from '@/components/gradebook/GradebookStudentPanel'
import { GradebookTable, type GradebookTableProps } from '@/components/gradebook/GradebookTable'
import { GradebookToolbar } from '@/components/gradebook/GradebookToolbar'
import { DEFAULT_GRADEBOOK_PREFERENCES } from '@/lib/gradebook-editor'
import { TooltipProvider } from '@/ui'
import type { GradebookStudentSummary } from '@/types'

const student: GradebookStudentSummary = {
  student_id: 's1', student_email: 'demo@example.com', student_number: null,
  student_first_name: 'Demo', student_last_name: 'Student', final_percent: null,
  assignments_earned: null, assignments_possible: null, assignments_percent: null,
  tests_earned: null, tests_possible: null, tests_percent: null,
}

function makeTableProps(overrides: Partial<GradebookTableProps> = {}): GradebookTableProps {
  return {
    students: [student], columns: [], displayMode: 'percent', summaryKind: 'average',
    lastNameFirst: false, showStudentIds: false, showWeights: false, keepKeyColumnsVisible: true,
    columnWidths: { first_name: 96, last_name: 96, id: 80, final: 80 }, onColumnWidthChange: vi.fn(),
    weightDrafts: {}, savingKeys: new Set(), isReadOnly: false, onWeightDraftChange: vi.fn(), onWeightCommit: vi.fn(), onAssessmentOpen: vi.fn(),
    selectedIds: new Set(), allSelected: false, someSelected: false, toggleSelect: vi.fn(), toggleSelectAll: vi.fn(),
    selectedStudentId: null, onStudentSelect: vi.fn(), onStudentDeselect: vi.fn(), sortColumn: 'last_name', sortDirection: 'asc', onSort: vi.fn(),
    ...overrides,
  }
}

describe('Gradebook surface owners', () => {
  it('names the student inspector and provides a working close control', () => {
    const onClose = vi.fn()
    render(<TooltipProvider><GradebookStudentPanel student={student} columns={[]} displayMode="percent" onClose={onClose} /></TooltipProvider>)
    expect(screen.getByRole('region', { name: 'Demo Student assessment details' })).toHaveTextContent('No assessments yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Close student details' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps segmented keyboard controls and menu semantics in the toolbar', () => {
    const onChange = vi.fn()
    render(<TooltipProvider><GradebookToolbar preferences={DEFAULT_GRADEBOOK_PREFERENCES} onChange={onChange} selectedCount={1} isReadOnly={false} onEditCategories={vi.fn()} onCopyEmails={vi.fn()} onExport={vi.fn()} /></TooltipProvider>)
    fireEvent.keyDown(screen.getByRole('button', { name: '%' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith({ scoreDisplayMode: 'raw' })
    expect(screen.getByRole('button', { name: 'x/y' })).toHaveFocus()
    const dots = [...screen.getByRole('button', { name: 'Gradebook more actions' }).querySelectorAll('circle')]
    expect(dots).toHaveLength(3)
    expect(new Set(dots.map((dot) => dot.getAttribute('cx'))).size).toBe(1)
    expect(new Set(dots.map((dot) => dot.getAttribute('cy'))).size).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: '1 selected' }))
    expect(within(screen.getByRole('menu', { name: 'Student actions' })).getByRole('menuitem', { name: 'Copy email 2' })).toBeDisabled()
  })

  it('keeps empty assessment space and keyboard student selection in the matrix', () => {
    const onStudentSelect = vi.fn()
    const props = makeTableProps({ onStudentSelect })
    render(<TooltipProvider><GradebookTable {...props} /></TooltipProvider>)
    expect(screen.getByRole('columnheader', { name: 'Assessments' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('region', { name: 'Gradebook students' }), { key: 'Home' })
    expect(onStudentSelect).toHaveBeenCalledWith(student)
  })

  it('shows only the assessment title in header tooltips', async () => {
    const user = userEvent.setup()
    const props = makeTableProps({
      columns: [{
        assessment_id: 'a1', assessment_type: 'assignment', code: 'A1', title: 'Essay',
        possible: 10, weight: 10, include_in_final: true, category_name: 'Term',
      }],
    })
    render(<TooltipProvider><GradebookTable {...props} /></TooltipProvider>)
    await user.hover(screen.getByRole('button', { name: 'Edit A1: Essay' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Essay$/)
  })
})
