import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GradebookScoreDialog } from '@/components/gradebook/GradebookScoreDialog'

describe('GradebookScoreDialog original marks', () => {
  it('offers maximum-change behavior and validates a positive maximum', () => {
    const onSave = vi.fn()
    render(<GradebookScoreDialog isOpen student={null} target={{ kind: 'maximum', title: 'Essay', value: 100 }} isSaving={false} onClose={vi.fn()} onSave={onSave} />)
    const input = screen.getByRole('spinbutton', { name: 'Max mark' })
    fireEvent.change(input, { target: { value: '0' } })
    expect(screen.getByRole('button', { name: 'Save max mark' })).toBeDisabled()
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Existing marks' }), { target: { value: 'preserve_percentages' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save max mark' }))
    expect(onSave).toHaveBeenCalledWith(50, 'preserve_percentages')
  })

  it('opens fractional scaled marks as valid tenths and saves the explicit edited value', () => {
    const onSave = vi.fn()
    render(<GradebookScoreDialog isOpen student={null} target={{ kind: 'assessment', title: 'Essay', value: 16.6833, possible: 33.3, isOverride: true }} isSaving={false} onClose={vi.fn()} onSave={onSave} />)
    expect(screen.getByRole('spinbutton', { name: 'Mark earned' })).toHaveValue(16.7)
    expect(screen.getByRole('button', { name: 'Save mark' })).toBeEnabled()
    expect(screen.queryByText('Enter zero or a positive number in increments of 0.1.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save mark' }))
    expect(onSave).toHaveBeenCalledWith(16.7)
  })

  it('clears an original zero without presenting an override undo action', () => {
    const onClear = vi.fn(), onUndo = vi.fn()
    render(<GradebookScoreDialog isOpen student={null} target={{ kind: 'item', title: 'Attendance', value: 0, possible: 20 }} isSaving={false} onClose={vi.fn()} onSave={vi.fn()} onClear={onClear} onUndo={onUndo} />)
    expect(screen.queryByRole('button', { name: 'Undo override' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear mark' }))
    expect(onClear).toHaveBeenCalledOnce()
    expect(onUndo).not.toHaveBeenCalled()
  })
  it('keeps the points warning and disables clearing during a save', () => {
    render(<GradebookScoreDialog isOpen student={null} target={{ kind: 'item', title: 'Attendance', value: 25, possible: 20 }} isSaving onClose={vi.fn()} onSave={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('5 points over the total of 20')
    expect(screen.getByRole('button', { name: 'Clear mark' })).toBeDisabled()
  })
})
