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
    students: [student], columns: [], displayMode: 'percent',
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

  it('toggles score display with one button and keeps menu semantics in the toolbar', () => {
    const onChange = vi.fn()
    render(<TooltipProvider><GradebookToolbar preferences={DEFAULT_GRADEBOOK_PREFERENCES} onChange={onChange} selectedCount={1} isReadOnly={false} classAverage="84.6%" classMedian="86%" mobileStudentOptions={[{ value: 's1', label: 'Demo Student' }]} mobileStudentId="s1" onMobileStudentChange={vi.fn()} onEditCategories={vi.fn()} onCopyEmails={vi.fn()} onExport={vi.fn()} /></TooltipProvider>)
    expect(screen.getByLabelText('Class Average 84.6% · Median 86%')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Class summary' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Score display: %. Switch to x/y' }))
    expect(onChange).toHaveBeenCalledWith({ scoreDisplayMode: 'raw' })
    expect(screen.getByRole('combobox', { name: 'Student' })).toHaveValue('s1')
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

  it('opens mark editing and marks an override with an undo symbol while retaining its grade-band color', () => {
    const onScoreOpen = vi.fn()
    const column = {
      assessment_id: 'a1', assessment_type: 'assignment' as const, code: 'A1', title: 'Essay',
      possible: 10, weight: 10, include_in_final: true, category_name: 'Term',
    }
    const studentWithManualMark: GradebookStudentSummary = {
      ...student,
      assessment_scores: [{
        assessment_id: 'a1', assessment_type: 'assignment', earned: 8, possible: 10,
        percent: 80, is_graded: true, is_manual_override: true,
      }],
    }
    render(<TooltipProvider><GradebookTable {...makeTableProps({ students: [studentWithManualMark], columns: [column], onScoreOpen })} /></TooltipProvider>)

    const manualMark = screen.getByRole('button', { name: 'Edit Demo Student mark for Essay: 80%, overridden' })
    expect(manualMark).not.toHaveClass('text-primary')
    expect(manualMark.querySelector('svg')).toHaveClass('text-primary', 'h-3', 'w-3')
    expect(manualMark.querySelector('span:last-child')).toHaveClass('text-text-default')
    fireEvent.click(manualMark.querySelector('svg')!)
    expect(onScoreOpen).toHaveBeenCalledWith(studentWithManualMark, column)
    expect(screen.queryByRole('button', { name: /Undo override for Demo Student/ })).not.toBeInTheDocument()
  })

  it('opens final mark editing and preserves final grade color with an override symbol', () => {
    const onFinalScoreOpen = vi.fn()
    const overriddenStudent: GradebookStudentSummary = {
      ...student,
      final_percent: 49,
      is_final_override: true,
    }
    render(<TooltipProvider><GradebookTable {...makeTableProps({ students: [overriddenStudent], onFinalScoreOpen })} /></TooltipProvider>)

    const finalMark = screen.getByRole('button', { name: 'Edit Demo Student final mark: 49.0%, overridden' })
    expect(finalMark.querySelector('svg')).toHaveClass('text-primary', 'h-3', 'w-3')
    expect(finalMark.querySelector('span:last-child')).toHaveClass('text-danger')
    fireEvent.click(finalMark)
    expect(onFinalScoreOpen).toHaveBeenCalledWith(overriddenStudent)
  })

  it('colors final marks at the same grade-band boundaries as assessment marks', () => {
    const students: GradebookStudentSummary[] = [
      { ...student, student_id: 'red', student_first_name: 'Red', final_percent: 49 },
      { ...student, student_id: 'amber', student_first_name: 'Amber', final_percent: 50 },
      { ...student, student_id: 'default', student_first_name: 'Default', final_percent: 70 },
    ]
    render(<TooltipProvider><GradebookTable {...makeTableProps({ students, onFinalScoreOpen: vi.fn() })} /></TooltipProvider>)

    expect(screen.getByRole('button', { name: 'Edit Red Student final mark: 49.0%' }).querySelector('span')).toHaveClass('text-danger')
    expect(screen.getByRole('button', { name: 'Edit Amber Student final mark: 50.0%' }).querySelector('span')).toHaveClass('text-warning')
    expect(screen.getByRole('button', { name: 'Edit Default Student final mark: 70.0%' }).querySelector('span')).toHaveClass('text-text-default')
  })

  it('colors scores by grade range', () => {
    const columns = [
      { assessment_id: 'a1', assessment_type: 'assignment' as const, code: 'A1', title: 'Failing', possible: 10, weight: 10, include_in_final: true, category_name: 'Term' },
      { assessment_id: 'a2', assessment_type: 'assignment' as const, code: 'A2', title: 'Approaching', possible: 10, weight: 10, include_in_final: true, category_name: 'Term' },
      { assessment_id: 'a3', assessment_type: 'assignment' as const, code: 'A3', title: 'Meeting', possible: 10, weight: 10, include_in_final: true, category_name: 'Term' },
    ]
    const scoredStudent: GradebookStudentSummary = {
      ...student,
      assessment_scores: [
        { assessment_id: 'a1', assessment_type: 'assignment', earned: 4.9, possible: 10, percent: 49, is_graded: true },
        { assessment_id: 'a2', assessment_type: 'assignment', earned: 5, possible: 10, percent: 50, is_graded: true },
        { assessment_id: 'a3', assessment_type: 'assignment', earned: 7, possible: 10, percent: 70, is_graded: true },
      ],
    }
    render(<TooltipProvider><GradebookTable {...makeTableProps({ students: [scoredStudent], columns })} /></TooltipProvider>)

    expect(screen.getByRole('button', { name: 'Edit Demo Student mark for Failing: 49%' }).querySelector('span')).toHaveClass('text-danger')
    expect(screen.getByRole('button', { name: 'Edit Demo Student mark for Approaching: 50%' }).querySelector('span')).toHaveClass('text-warning')
    expect(screen.getByRole('button', { name: 'Edit Demo Student mark for Meeting: 70%' }).querySelector('span')).toHaveClass('text-text-default')
  })

  it('opens the assessment dialog from its Category cell', () => {
    const onAssessmentOpen = vi.fn()
    const column = {
      assessment_id: 'a1', assessment_type: 'assignment' as const, code: 'A1', title: 'Essay',
      possible: 10, weight: 10, include_in_final: true, category_name: 'Term',
    }
    render(<TooltipProvider><GradebookTable {...makeTableProps({ columns: [column], showWeights: true, onAssessmentOpen })} /></TooltipProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Edit category for A1: Essay' }))
    expect(onAssessmentOpen).toHaveBeenCalledWith(column)
  })

  it('shows Undo all overrides only in More actions while overrides exist', () => {
    const onUndoManualChanges = vi.fn()
    render(<TooltipProvider><GradebookToolbar preferences={DEFAULT_GRADEBOOK_PREFERENCES} onChange={vi.fn()} selectedCount={0} isReadOnly={false} hasManualChanges onUndoManualChanges={onUndoManualChanges} onEditCategories={vi.fn()} onCopyEmails={vi.fn()} onExport={vi.fn()} /></TooltipProvider>)
    expect(screen.queryByRole('button', { name: 'Undo all overrides' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Gradebook more actions' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Gradebook more actions' })).getByRole('menuitem', { name: 'Undo all overrides' }))
    expect(onUndoManualChanges).toHaveBeenCalledOnce()
  })
})
