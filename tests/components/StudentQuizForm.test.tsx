import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('renders test submit actions inline after the last question', async () => {
    const onSubmitted = vi.fn()

    render(
      <StudentQuizForm
        quizId="test-footer-id"
        questions={[
          createMockQuizQuestion({
            id: 'q1',
            question_text: 'Question 1?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
          createMockQuizQuestion({
            id: 'q2',
            question_text: 'Question 2?',
            options: ['C', 'D'],
            question_type: 'multiple_choice',
            position: 1,
          }),
        ]}
        initialResponses={{
          q1: {
            question_type: 'multiple_choice',
            selected_option: 1,
          },
        }}
        assessmentType="test"
        enableDraftAutosave
        onSubmitted={onSubmitted}
      />
    )

    const actionPanel = screen.getByTestId('student-quiz-action-footer')
    const questionsStack = screen.getByText('Question 2?').closest('[data-question-id="q2"]')
      ?.parentElement

    expect(questionsStack?.lastElementChild).toBe(actionPanel)
    expect(actionPanel.className).not.toContain('sticky')
    expect(within(actionPanel).getByText('Saved')).toBeInTheDocument()
    expect(within(actionPanel).getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    expect(within(actionPanel).getByText('Answer all questions to submit')).toBeInTheDocument()
  })

  it('keeps multiple-choice radios anchored inside their option rows', async () => {
    const onSubmitted = vi.fn()

    render(
      <StudentQuizForm
        quizId="test-radio-position-id"
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

    const optionRow = screen.getByText('A').closest('[data-question-option]')
    const radio = within(optionRow as HTMLElement).getByRole('radio')

    expect(optionRow).toHaveClass('relative')
    expect(radio).not.toHaveClass('sr-only')
    expect(radio).toHaveClass('absolute')
    expect(radio).toHaveClass('left-3')
  })

  it('renders markdown inside multiple-choice options', async () => {
    const onSubmitted = vi.fn()

    render(
      <StudentQuizForm
        quizId="test-markdown-options-id"
        questions={[
          createMockQuizQuestion({
            id: 'q1',
            question_text: 'Which code compiles?',
            options: [
              '`public static void main`',
              '```java\npublic class Main {}\n```',
            ],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
        assessmentType="test"
        previewMode
        onSubmitted={onSubmitted}
      />
    )

    expect(screen.getByText('public static void main')).toHaveClass('font-mono')
    expect(screen.getByText('public class Main {}')).toBeInTheDocument()
    expect(screen.queryByText(/```/)).not.toBeInTheDocument()
  })

  it('keeps the sticky submit footer for quizzes', async () => {
    const onSubmitted = vi.fn()

    render(
      <StudentQuizForm
        quizId="quiz-footer-id"
        questions={[
          createMockQuizQuestion({
            id: 'q1',
            question_text: 'Quiz question?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
        assessmentType="quiz"
        onSubmitted={onSubmitted}
      />
    )

    const actionPanel = screen.getByTestId('student-quiz-action-footer')
    expect(actionPanel.className).toContain('sticky')
    expect(within(actionPanel).getByRole('button', { name: 'Submit' })).toBeInTheDocument()
  })

  it('notifies the parent when a submit fails because the test is no longer active', async () => {
    const onSubmitted = vi.fn()
    const onAvailabilityLoss = vi.fn()
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Test is not active' }),
    })

    render(
      <StudentQuizForm
        quizId="test-closed-id"
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
        apiBasePath="/api/student/tests"
        onAvailabilityLoss={onAvailabilityLoss}
        onSubmitted={onSubmitted}
      />
    )

    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    const confirmDialog = screen.getByRole('dialog')
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onAvailabilityLoss).toHaveBeenCalledTimes(1)
    })

    expect(onSubmitted).not.toHaveBeenCalled()
    expect(screen.getByText('Test is not active')).toBeInTheDocument()
  })
})
