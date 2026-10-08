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
  it('accepts zero but rejects a blank weight', () => {
    const save = vi.fn()
    render(<GradebookItemEditor isOpen item={null} categories={[]} onClose={vi.fn()} onSave={save} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Assessment title' }), { target: { value: 'Practice' } })
    const weight = screen.getByRole('spinbutton', { name: 'Category weight' })
    fireEvent.change(weight, { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Add other assessment' })).toBeDisabled()
    fireEvent.change(weight, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add other assessment' }))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ gradebook_weight: 0 }))
  })
  it('proposes the selected category weight and validates details without a return action', () => {
    const categories = [{ id: 'term', name: 'Term', percentage: 100, default_assessment_weight: 25, is_default: false, position: 0 }]
    render(<GradebookItemEditor isOpen item={item} categories={categories} onClose={vi.fn()} onSave={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Return marks' })).not.toBeInTheDocument()
    expect(screen.getByText('Marks are visible to students as soon as you save them.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'term' } })
    expect(screen.getByRole('spinbutton', { name: 'Category weight' })).toHaveValue(25)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Points possible' }), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: 'Save item' })).toBeDisabled()
  })
  it('requires deliberate confirmation to delete entered marks', () => {
    const remove = vi.fn()
    render(<GradebookItemEditor isOpen item={item} categories={[]} onClose={vi.fn()} onSave={vi.fn()} onDelete={remove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }))
    const deleteDialog = screen.getByRole('dialog', { name: 'Delete item?' })
    expect(deleteDialog).toHaveTextContent('Attendance – Term 1')
    expect(deleteDialog).toHaveTextContent('permanently')
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete item' }))
    expect(remove).toHaveBeenCalledOnce()
  })
})
