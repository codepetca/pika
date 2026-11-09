import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SurveyCreationModal } from '@/components/surveys/SurveyCreationModal'

describe('SurveyCreationModal', () => {
  it('uses the shared creation modal chrome when creating a survey', () => {
    render(
      <SurveyCreationModal
        isOpen={true}
        classroomId="classroom-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: 'New Survey' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'New Survey' })).not.toHaveClass('sr-only')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter survey title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Show class results to students')).toBeInTheDocument()
    expect(screen.getByLabelText('Allow students to update answers while open')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('!max-w-2xl')
  })

  it('confirms before discarding changed input and lets the teacher keep editing', () => {
    const onClose = vi.fn()
    render(<SurveyCreationModal isOpen classroomId="classroom-1" onClose={onClose} onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Enter survey title'), { target: { value: 'Feedback' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close survey modal' }))
    expect(screen.getByRole('dialog', { name: 'Discard survey changes?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('Enter survey title')).toHaveValue('Feedback')
    fireEvent.click(screen.getByRole('button', { name: 'Close survey modal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes a pristine form immediately', () => {
    const onClose = vi.fn()
    render(<SurveyCreationModal isOpen classroomId="classroom-1" onClose={onClose} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close survey modal' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

})
