import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StudentTestForm } from '@/components/StudentTestForm'
import { createMockTestQuestion } from '../helpers/mocks'

describe('StudentTestForm preview mode', () => {
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
      <StudentTestForm
        testId="test-preview-id"
        questions={[
          createMockTestQuestion({
            id: 'q1',
            question_text: 'Which option is correct?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
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

  it('labels open-response textboxes for assistive technology', () => {
    render(
      <StudentTestForm
        testId="test-open-response-label-id"
        questions={[
          createMockTestQuestion({
            id: 'q1',
            question_text: 'Explain your reasoning.',
            options: [],
            question_type: 'open_response',
            position: 0,
          }),
        ]}
        previewMode
      />
    )

    expect(screen.getByRole('textbox', { name: 'Response for question 1' })).toBeInTheDocument()
  })

  it('requires non-blank open responses before enabling submit', () => {
    render(
      <StudentTestForm
        testId="test-open-response-submit-id"
        questions={[
          createMockTestQuestion({
            id: 'q1',
            question_text: 'Explain your reasoning.',
            options: [],
            question_type: 'open_response',
            position: 0,
          }),
        ]}
        previewMode
        onSubmitted={vi.fn()}
      />
    )

    const submitButton = screen.getByRole('button', { name: 'Submit' })
    const textbox = screen.getByRole('textbox', { name: 'Response for question 1' })

    expect(submitButton).toBeDisabled()

    fireEvent.change(textbox, { target: { value: '   ' } })
    expect(submitButton).toBeDisabled()

    fireEvent.change(textbox, { target: { value: 'A clear explanation.' } })
    expect(submitButton).toBeEnabled()
  })

  it('exposes a named flag toggle and persists pointer changes', () => {
    const onSubmitted = vi.fn()

    render(
      <StudentTestForm
        testId="test-flag-id"
        questions={[
          createMockTestQuestion({
            id: 'q1',
            question_text: 'Which option is correct?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
        previewMode
        onSubmitted={onSubmitted}
      />
    )

    const flagToggle = screen.getByRole('button', { name: 'Flag question 1 for review' })

    expect(flagToggle).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(flagToggle)

    const flaggedQuestions = JSON.parse(localStorage.getItem('pika:flagged-questions:test-flag-id') || '[]')
    expect(flaggedQuestions).toEqual(['q1'])
    expect(flagToggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(flagToggle)

    const updatedFlaggedQuestions = JSON.parse(localStorage.getItem('pika:flagged-questions:test-flag-id') || '[]')
    expect(updatedFlaggedQuestions).not.toContain('q1')
    expect(flagToggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles flagged state exactly once for Enter and Space', () => {
    render(
      <StudentTestForm
        testId="test-flag-keyboard-id"
        questions={[
          createMockTestQuestion({
            id: 'q1',
            question_text: 'Which option is correct?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
        previewMode
        onSubmitted={vi.fn()}
      />
    )

    const flagToggle = screen.getByRole('button', { name: 'Flag question 1 for review' })

    fireEvent.keyDown(flagToggle, { key: 'Enter' })
    fireEvent.keyUp(flagToggle, { key: 'Enter' })

    expect(flagToggle).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(localStorage.getItem('pika:flagged-questions:test-flag-keyboard-id') || '[]')).toEqual(['q1'])

    fireEvent.keyDown(flagToggle, { key: ' ' })
    fireEvent.keyUp(flagToggle, { key: ' ' })

    expect(flagToggle).toHaveAttribute('aria-pressed', 'false')
    expect(JSON.parse(localStorage.getItem('pika:flagged-questions:test-flag-keyboard-id') || '[]')).toEqual([])
  })

  it('exposes locked flag controls as disabled and does not toggle them', () => {
    render(
      <StudentTestForm
        testId="test-flag-locked-id"
        questions={[
          createMockTestQuestion({
            id: 'q1',
            question_text: 'Which option is correct?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
        previewMode
        isInteractionLocked
        onSubmitted={vi.fn()}
      />
    )

    const flagToggle = screen.getByRole('button', { name: 'Flag question 1 for review' })

    expect(flagToggle).toHaveAttribute('aria-pressed', 'false')
    expect(flagToggle).toHaveAttribute('aria-disabled', 'true')
    expect(flagToggle).toHaveAttribute('tabindex', '-1')

    fireEvent.click(flagToggle)
    fireEvent.keyDown(flagToggle, { key: 'Enter' })
    fireEvent.keyUp(flagToggle, { key: 'Enter' })
    fireEvent.keyDown(flagToggle, { key: ' ' })
    fireEvent.keyUp(flagToggle, { key: ' ' })

    expect(flagToggle).toHaveAttribute('aria-pressed', 'false')
    expect(localStorage.getItem('pika:flagged-questions:test-flag-locked-id')).toBeNull()
  })

  it('shows warning when submitting with flagged questions', async () => {
    const onSubmitted = vi.fn()

    render(
      <StudentTestForm
        testId="test-warning-id"
        questions={[
          createMockTestQuestion({
            id: 'q1',
            question_text: 'Which option is correct?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
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
      <StudentTestForm
        testId="test-footer-id"
        questions={[
          createMockTestQuestion({
            id: 'q1',
            question_text: 'Question 1?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
          createMockTestQuestion({
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
        enableDraftAutosave
        onSubmitted={onSubmitted}
      />
    )

    const actionPanel = screen.getByTestId('student-test-action-footer')
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
      <StudentTestForm
        testId="test-radio-position-id"
        questions={[
          createMockTestQuestion({
            id: 'q1',
            question_text: 'Which option is correct?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
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
      <StudentTestForm
        testId="test-markdown-options-id"
        questions={[
          createMockTestQuestion({
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
        previewMode
        onSubmitted={onSubmitted}
      />
    )

    expect(screen.getByText('public static void main')).toHaveClass('font-mono')
    expect(screen.getByText('public class Main {}')).toBeInTheDocument()
    expect(screen.queryByText(/```/)).not.toBeInTheDocument()
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
      <StudentTestForm
        testId="test-closed-id"
        questions={[
          createMockTestQuestion({
            id: 'q1',
            question_text: 'Which option is correct?',
            options: ['A', 'B'],
            question_type: 'multiple_choice',
            position: 0,
          }),
        ]}
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
