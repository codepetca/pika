import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StudentQuizForm } from '@/components/StudentQuizForm'
import { createMockQuizQuestion } from '../helpers/mocks'

describe('StudentQuizForm preview mode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('simulates submit without saving data', async () => {
    const onSubmitted = vi.fn()

    render(
      <StudentQuizForm
        quizId="test-preview-id"
        questions={[
          createMockQuizQuestion({
            id: 'q1',
            question_text: 'Which option is correct?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
        assessmentType="test"
        previewMode
        onSubmitted={onSubmitted}
      />
    )

    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simulate Submit' }))

    await waitFor(() => {
      expect(screen.getByText('Preview mode only. Submission was not saved.')).toBeInTheDocument()
    })

    expect(global.fetch).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
  })

  it('flags and unfags a question', async () => {
    const onSubmitted = vi.fn()

    render(
      <StudentQuizForm
        quizId="test-flag-id"
        questions={[
          createMockQuizQuestion({
            id: 'q1',
            question_text: 'Which option is correct?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
        assessmentType="test"
        previewMode
        onSubmitted={onSubmitted}
      />
    )

    // Initially, the star should be hidden (unflagged)
    const starIcon = screen.getByText('Q1')
    expect(starIcon.closest('[data-question-title-id="q1"]')).toBeInTheDocument()

    // Click on the question title to flag it
    fireEvent.click(starIcon.closest('[data-question-title-id="q1"]')!)

    // The star counter button should now be visible
    const counterButton = screen.getByRole('button', { name: /★ 1/ })
    expect(counterButton).toBeInTheDocument()
    expect(counterButton).not.toBeDisabled()

    // Click on the star counter to navigate to the flagged question
    fireEvent.click(counterButton)

    // Click on the question title again to unflag it
    fireEvent.click(starIcon.closest('[data-question-title-id="q1"]')!)

    // The star counter button should now be hidden
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /★/ })).not.toBeInTheDocument()
    })
  })

  it('shows warning when submitting with flagged questions', async () => {
    const onSubmitted = vi.fn()

    render(
      <StudentQuizForm
        quizId="test-warning-id"
        questions={[
          createMockQuizQuestion({
            id: 'q1',
            question_text: 'Which option is correct?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
        assessmentType="test"
        previewMode
        onSubmitted={onSubmitted}
      />
    )

    // Select an option to enable submit
    fireEvent.click(screen.getByText('A'))

    // Flag the question
    const starIcon = screen.getByText('Q1')
    fireEvent.click(starIcon.closest('[data-question-title-id="q1"]')!)

    // Try to submit
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    // Should see warning about flagged questions
    await waitFor(() => {
      expect(screen.getByText(/You have 1 question flagged/)).toBeInTheDocument()
    })
  })
})
