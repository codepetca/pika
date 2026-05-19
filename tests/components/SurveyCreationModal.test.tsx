import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    expect(screen.getByPlaceholderText('Enter survey title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Show class results to students')).toBeInTheDocument()
    expect(screen.getByLabelText('Allow students to update answers while open')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('!max-w-2xl')
  })
})
