import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { StudentTestResults } from '@/components/StudentTestResults'

describe('StudentTestResults', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function createDeferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve
      reject = promiseReject
    })
    return { promise, resolve, reject }
  }

  function jsonResponse(body: unknown): Response {
    return { ok: true, json: async () => body } as Response
  }

  it('accepts legacy quizId as a compatibility alias', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })

    render(<StudentTestResults quizId="legacy-test-id" myResponses={{}} />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/student/tests/legacy-test-id/results')
    })
  })

  it('shows loading spinner initially', () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockReturnValue(new Promise(() => {})) // never resolves

    const { container } = render(
      <StudentTestResults testId="test-1" myResponses={{}} />
    )

    // Spinner renders an svg or loading element
    expect(container.querySelector('[class*="animate"]')).toBeInTheDocument()
  })

  it('shows error message on fetch failure', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Test not found' }),
    })

    render(<StudentTestResults testId="test-1" myResponses={{}} />)

    await waitFor(() => {
      expect(screen.getByText('Test not found')).toBeInTheDocument()
    })
  })

  it('shows empty state when no results', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })

    render(<StudentTestResults testId="test-1" myResponses={{}} />)

    await waitFor(() => {
      expect(screen.getByText('No results available.')).toBeInTheDocument()
    })
  })

  it('hides submission confirmation banner when disabled', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        question_results: [
          {
            question_id: 'q1',
            question_type: 'multiple_choice',
            question_text: 'What is 2 + 2?',
            options: ['3', '4'],
            points: 1,
            response_max_chars: 5000,
            correct_option: 1,
            selected_option: 1,
            response_text: null,
            score: 1,
            feedback: 'Correct',
            graded_at: '2026-03-06T10:00:00.000Z',
            is_correct: true,
          },
        ],
        summary: {
          earned_points: 1,
          possible_points: 1,
          percent: 100,
        },
      }),
    })

    render(
      <StudentTestResults
        testId="test-1"
        myResponses={{ q1: 1 }}
        assessmentType="test"
        apiBasePath="/api/student/tests"
        showSubmissionBanner={false}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Score')).toBeInTheDocument()
    })
    expect(screen.queryByText('Your response has been submitted.')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Results' })).not.toBeInTheDocument()
  })

  it('shows multiple-choice test options in original order with compact gutter markers', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        question_results: [
          {
            question_id: 'q1',
            question_type: 'multiple_choice',
            question_text: 'What is 2 + 2?',
            options: ['3', '4'],
            points: 1,
            response_max_chars: 5000,
            correct_option: 1,
            selected_option: 0,
            response_text: null,
            score: 0,
            feedback: null,
            graded_at: '2026-03-06T10:00:00.000Z',
            is_correct: false,
          },
        ],
        summary: {
          earned_points: 0,
          possible_points: 1,
          percent: 0,
        },
      }),
    })

    const { container } = render(
      <StudentTestResults
        testId="test-1"
        myResponses={{ q1: 0 }}
        assessmentType="test"
        apiBasePath="/api/student/tests"
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Multiple choice answer options' })).toBeInTheDocument()
    })

    expect(screen.queryByText('Your answer')).not.toBeInTheDocument()
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument()

    const optionList = screen.getByRole('list', { name: 'Multiple choice answer options' })
    const optionRows = within(optionList).getAllByRole('listitem')
    expect(optionRows).toHaveLength(2)
    expect(within(optionRows[0]).getByText('A')).toBeInTheDocument()
    expect(within(optionRows[0]).getByText('3')).toBeInTheDocument()
    expect(within(optionRows[1]).getByText('B')).toBeInTheDocument()
    expect(within(optionRows[1]).getByText('4')).toBeInTheDocument()

    expect(within(optionRows[0]).getByText('✕')).toHaveClass('text-warning')
    expect(within(optionRows[1]).getByText('✓')).toHaveClass('text-success')
    expect(optionRows[0]).toHaveClass('bg-warning-bg')
    expect(optionRows[1]).toHaveClass('bg-success-bg-muted')
    expect(container.querySelector('.border-danger.bg-danger-bg')).toBeNull()
  })

  it('shows unanswered multiple-choice test questions in the question meta line', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        question_results: [
          {
            question_id: 'q1',
            question_type: 'multiple_choice',
            question_text: 'What is 2 + 2?',
            options: ['3', '4'],
            points: 1,
            response_max_chars: 5000,
            correct_option: 1,
            selected_option: null,
            response_text: null,
            score: 0,
            feedback: null,
            graded_at: '2026-03-06T10:00:00.000Z',
            is_correct: false,
          },
        ],
        summary: {
          earned_points: 0,
          possible_points: 1,
          percent: 0,
        },
      }),
    })

    render(
      <StudentTestResults
        testId="test-1"
        myResponses={{}}
        assessmentType="test"
        apiBasePath="/api/student/tests"
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Q1 · 1 pts · No answer')).toBeInTheDocument()
    })

    const optionList = screen.getByRole('list', { name: 'Multiple choice answer options' })
    expect(within(optionList).queryByText('✕')).not.toBeInTheDocument()
    expect(within(optionList).getByText('✓')).toHaveClass('text-success')
  })

  it('shows coding sample solutions on returned test open responses', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        question_results: [
          {
            question_id: 'q-open-1',
            question_type: 'open_response',
            question_text: 'Write a loop.',
            options: [],
            points: 5,
            response_max_chars: 5000,
            response_monospace: true,
            sample_solution: 'for (int i = 0; i < 5; i++) {\n  println(i);\n}',
            correct_option: null,
            selected_option: null,
            response_text: 'for(int i=0;i<5;i++){println(i);}',
            score: 4,
            feedback: 'Strength: Good loop. Next Step: format it more clearly. Improve: Add braces and spacing for full marks.',
            graded_at: '2026-03-06T10:00:00.000Z',
            is_correct: null,
          },
        ],
        summary: {
          earned_points: 4,
          possible_points: 5,
          percent: 80,
        },
      }),
    })

    render(
      <StudentTestResults
        testId="test-1"
        myResponses={{}}
        assessmentType="test"
        apiBasePath="/api/student/tests"
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Sample solution')).toBeInTheDocument()
    })

    expect(screen.getByText('Sample solution')).toBeInTheDocument()
    expect(screen.getByText(/for \(int i = 0; i < 5; i\+\+\)/)).toBeInTheDocument()
    expect(screen.getByText(/Strength: Good loop/)).toBeInTheDocument()
  })
})
