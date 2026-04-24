import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuizModal } from '@/components/QuizModal'
import { createMockQuiz } from '../helpers/mocks'

describe('QuizModal', () => {
  it('uses test-specific title copy when creating a test', () => {
    render(
      <QuizModal
        isOpen={true}
        classroomId="classroom-1"
        assessmentType="test"
        apiBasePath="/api/teacher/tests"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: 'New Test' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter test title')).toBeInTheDocument()
  })

  it('keeps quiz-specific title copy when editing a quiz', () => {
    render(
      <QuizModal
        isOpen={true}
        classroomId="classroom-1"
        quiz={createMockQuiz({ assessment_type: 'quiz', title: 'Vocabulary Quiz' })}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: 'Edit Quiz' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Vocabulary Quiz')).toHaveAttribute(
      'placeholder',
      'Enter quiz title'
    )
  })
})
