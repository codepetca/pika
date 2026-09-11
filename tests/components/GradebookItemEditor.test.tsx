import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GradebookItemEditor } from '@/components/gradebook/GradebookItemEditor'
import type { GradebookAssessmentColumn } from '@/types'

const item: GradebookAssessmentColumn = { assessment_id: 'item-1', assessment_type: 'item', code: 'I1', title: 'Attendance – Term 1', possible: 20, weight: 10, include_in_final: true, category_id: null, scored_count: 2, returned_count: 0 }

describe('GradebookItemEditor', () => {
  it('creates with explicit points, inclusion and category weight', () => {
    const save = vi.fn()
    render(<GradebookItemEditor isOpen item={null} categories={[]} onClose={vi.fn()} onSave={save} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Assessment title' }), { target: { value: 'Attendance – Term 1' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Points possible' }), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add other assessment' }))
    expect(save).toHaveBeenCalledWith({ title: 'Attendance – Term 1', points_possible: 20, gradebook_category_id: null, gradebook_weight: 10, include_in_final: true })
  })
  it('proposes the selected category weight and requires saved details before returning marks', () => {
    const categories = [{ id: 'term', name: 'Term', percentage: 100, default_assessment_weight: 25, is_default: false, position: 0 }]
    render(<GradebookItemEditor isOpen item={item} categories={categories} onClose={vi.fn()} onSave={vi.fn()} onReturnMarks={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Return marks' })).toBeEnabled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'term' } })
    expect(screen.getByRole('spinbutton', { name: 'Category weight' })).toHaveValue(25)
    expect(screen.getByRole('button', { name: 'Return marks' })).toBeDisabled()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Points possible' }), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: 'Save item' })).toBeDisabled()
  })
  it('requires deliberate confirmation to release or delete entered marks', () => {
    const remove = vi.fn()
    const returnMarks = vi.fn()
    render(<GradebookItemEditor isOpen item={item} categories={[]} onClose={vi.fn()} onSave={vi.fn()} onDelete={remove} onReturnMarks={returnMarks} />)
    fireEvent.click(screen.getByRole('button', { name: 'Return marks' }))
    expect(returnMarks).not.toHaveBeenCalled()
    const confirm = screen.getByRole('dialog', { name: 'Return marks?' })
    expect(confirm).toHaveTextContent('currently entered marks')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Return marks' }))
    expect(returnMarks).toHaveBeenCalledOnce()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }))
    const deleteDialog = screen.getByRole('dialog', { name: 'Delete item?' })
    expect(deleteDialog).toHaveTextContent('Attendance – Term 1')
    expect(deleteDialog).toHaveTextContent('permanently')
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete item' }))
    expect(remove).toHaveBeenCalledOnce()
  })
})
