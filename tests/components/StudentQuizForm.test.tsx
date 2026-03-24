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

    // Get the question title area
    const starIcon = screen.getByText('Q1')
    const titleArea = starIcon.closest('[data-question-title-id="q1"]')!

    // Initially, the question should not be flagged
    expect(titleArea).toBeInTheDocument()

    // Click on the question title to flag it
    fireEvent.click(titleArea)

    // Verify the flagged state persists by checking localStorage
    const flaggedQuestions = JSON.parse(localStorage.getItem('pika:flagged-questions:test-flag-id') || '[]')
    expect(flaggedQuestions).toContain('q1')

    // Click on the question title again to unflag it
    fireEvent.click(titleArea)

    // Verify the unflagged state
    const updatedFlaggedQuestions = JSON.parse(localStorage.getItem('pika:flagged-questions:test-flag-id') || '[]')
    expect(updatedFlaggedQuestions).not.toContain('q1')
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
