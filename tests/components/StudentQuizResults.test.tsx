import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { StudentQuizResults } from '@/components/StudentQuizResults'
import type { QuizResultsAggregate } from '@/types'

const sampleResults: QuizResultsAggregate[] = [
  {
    question_id: 'q1',
    question_text: 'What is the capital of France?',
    options: ['London', 'Paris', 'Berlin'],
    counts: [3, 15, 2],
    total_responses: 20,
  },
  {
    question_id: 'q2',
    question_text: 'Favorite season?',
    options: ['Spring', 'Summer', 'Fall', 'Winter'],
    counts: [5, 8, 4, 3],
    total_responses: 20,
  },
]

describe('StudentQuizResults', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows loading spinner initially', () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockReturnValue(new Promise(() => {})) // never resolves

    const { container } = render(
      <StudentQuizResults quizId="quiz-1" myResponses={{}} />
    )

    // Spinner renders an svg or loading element
    expect(container.querySelector('[class*="animate"]')).toBeInTheDocument()
  })

  it('shows error message on fetch failure', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Quiz not found' }),
    })

    render(<StudentQuizResults quizId="quiz-1" myResponses={{}} />)

    await waitFor(() => {
      expect(screen.getByText('Quiz not found')).toBeInTheDocument()
    })
  })

  it('shows empty state when no results', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })

    render(<StudentQuizResults quizId="quiz-1" myResponses={{}} />)

    await waitFor(() => {
      expect(screen.getByText('No results available.')).toBeInTheDocument()
    })
  })

  it('renders aggregate results with bar charts', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: sampleResults }),
    })

    render(<StudentQuizResults quizId="quiz-1" myResponses={{}} />)

    await waitFor(() => {
      expect(screen.getByText('What is the capital of France?')).toBeInTheDocument()
      expect(screen.getByText('Favorite season?')).toBeInTheDocument()
    })

    // Check options and percentages
    expect(screen.getByText('London')).toBeInTheDocument()
    expect(screen.getByText('15 (75%)')).toBeInTheDocument() // Paris
  })

  it('highlights the student\'s own answer', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: sampleResults }),
    })

    // Student selected Paris (index 1) for q1, Fall (index 2) for q2
    const myResponses = { q1: 1, q2: 2 }
    render(<StudentQuizResults quizId="quiz-1" myResponses={myResponses} />)

    await waitFor(() => {
      expect(screen.getByText(/Paris/)).toBeInTheDocument()
    })

    // "your answer" label should appear for selected options
    expect(screen.getByText(/Paris \(your answer\)/)).toBeInTheDocument()
    expect(screen.getByText(/Fall \(your answer\)/)).toBeInTheDocument()

    // Non-selected options should not have "your answer"
    expect(screen.queryByText(/London \(your answer\)/)).not.toBeInTheDocument()
  })

  it('shows submission confirmation banner', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: sampleResults }),
    })

    render(<StudentQuizResults quizId="quiz-1" myResponses={{ q1: 0 }} />)

    await waitFor(() => {
      expect(screen.getByText('Your response has been submitted.')).toBeInTheDocument()
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
      <StudentQuizResults
        quizId="quiz-1"
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

  it('highlights incorrect multiple-choice test answers', async () => {
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
      <StudentQuizResults
        quizId="quiz-1"
        myResponses={{ q1: 0 }}
        assessmentType="test"
        apiBasePath="/api/student/tests"
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Your answer')).toBeInTheDocument()
    })

    expect(screen.getByText('Your answer')).toBeInTheDocument()
    expect(screen.getByText('Correct answer')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()

    const incorrectAnswerLabel = screen.getByText('Your answer')
    const incorrectAnswerText = screen.getByText('3')
    expect(incorrectAnswerLabel.className).toContain('text-warning')
    expect(incorrectAnswerText.className).toContain('text-warning')
    expect(container.querySelector('.bg-warning-bg')).toBeNull()
    expect(container.querySelector('.border-warning')).toBeNull()
    expect(container.querySelector('.border-danger.bg-danger-bg')).toBeNull()
  })

  it('uses muted bar color for non-selected options', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{
          question_id: 'q1',
          question_text: 'Pick one',
          options: ['A', 'B'],
          counts: [10, 10],
          total_responses: 20,
        }],
      }),
    })

    const { container } = render(
      <StudentQuizResults quizId="quiz-1" myResponses={{ q1: 0 }} />
    )

    await waitFor(() => {
      expect(screen.getByText(/Pick one/)).toBeInTheDocument()
    })

    // The student's answer (A, index 0) should have bg-primary
    // The other (B, index 1) should have bg-text-muted/30
    const bars = container.querySelectorAll('.rounded-full.transition-all')
    expect(bars[0].className).toContain('bg-primary')
    expect(bars[1].className).toContain('bg-text-muted')
  })

  it('does not show individual student names or responses', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: sampleResults }),
    })

    render(<StudentQuizResults quizId="quiz-1" myResponses={{ q1: 1 }} />)

    await waitFor(() => {
      expect(screen.getByText('Results')).toBeInTheDocument()
    })

    // Should NOT show any individual response section
    expect(screen.queryByText(/Individual Responses/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Responded/)).not.toBeInTheDocument()
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
      <StudentQuizResults
        quizId="quiz-1"
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
