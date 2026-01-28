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
      expect(screen.getByText('1. What is the capital of France?')).toBeInTheDocument()
      expect(screen.getByText('2. Favorite season?')).toBeInTheDocument()
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
})
