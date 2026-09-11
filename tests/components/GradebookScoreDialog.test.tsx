import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GradebookScoreDialog } from '@/components/gradebook/GradebookScoreDialog'

describe('GradebookScoreDialog original marks', () => {
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
