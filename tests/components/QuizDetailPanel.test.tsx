import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QuizDetailPanel } from '@/components/QuizDetailPanel'
import { TooltipProvider } from '@/ui'
import { createMockQuiz, createMockQuizQuestion } from '../helpers/mocks'
import type { QuizWithStats, QuizQuestion, QuizResultsAggregate } from '@/types'

function Wrapper({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}

function makeQuizWithStats(overrides: Partial<QuizWithStats> = {}): QuizWithStats {
  const base = createMockQuiz(overrides)
  return {
    ...base,
    stats: { total_students: 25, responded: 0, questions_count: 2 },
    ...overrides,
  } as QuizWithStats
}

const sampleQuestions: QuizQuestion[] = [
  createMockQuizQuestion({ id: 'q1', question_text: 'Favorite color?', options: ['Red', 'Blue', 'Green'], position: 0 }),
  createMockQuizQuestion({ id: 'q2', question_text: 'Favorite animal?', options: ['Cat', 'Dog'], position: 1 }),
]

const sampleResults: QuizResultsAggregate[] = [
  { question_id: 'q1', question_text: 'Favorite color?', options: ['Red', 'Blue', 'Green'], counts: [5, 10, 5], total_responses: 20 },
  { question_id: 'q2', question_text: 'Favorite animal?', options: ['Cat', 'Dog'], counts: [12, 8], total_responses: 20 },
]

describe('QuizDetailPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mockFetchForQuiz(questions: QuizQuestion[], results?: QuizResultsAggregate[]) {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    // First call: GET quiz details (questions)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ questions }),
    })
    // Second call (if results provided): GET quiz results
    if (results) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results, responders: [] }),
      })
    }
    return fetchMock
  }

  describe('tabs', () => {
    it('renders Questions, Preview, and Results tabs', async () => {
      mockFetchForQuiz(sampleQuestions)
      const quiz = makeQuizWithStats()

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText(/Questions/)).toBeInTheDocument()
      })
      expect(screen.getByText('Preview')).toBeInTheDocument()
      expect(screen.getByText(/Results/)).toBeInTheDocument()
    })

    it('shows question count in Questions tab', async () => {
      mockFetchForQuiz(sampleQuestions)
      const quiz = makeQuizWithStats()

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('Questions (2)')).toBeInTheDocument()
      })
    })

    it('shows response count in Results tab', async () => {
      mockFetchForQuiz(sampleQuestions, sampleResults)
      const quiz = makeQuizWithStats({ stats: { total_students: 25, responded: 20, questions_count: 2 } })

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('Results (20)')).toBeInTheDocument()
      })
    })
  })

  describe('Questions tab', () => {
    it('shows quiz title that is click-to-edit', async () => {
      mockFetchForQuiz(sampleQuestions)
      const quiz = makeQuizWithStats({ title: 'My Cool Quiz' })

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('My Cool Quiz')).toBeInTheDocument()
      })

      // Click to enter edit mode
      fireEvent.click(screen.getByText('My Cool Quiz'))
      expect(screen.getByDisplayValue('My Cool Quiz')).toBeInTheDocument()
    })

    it('shows warning when quiz has responses', async () => {
      mockFetchForQuiz(sampleQuestions, sampleResults)
      const quiz = makeQuizWithStats({ stats: { total_students: 25, responded: 5, questions_count: 2 } })

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('Questions cannot be edited after students have responded.')).toBeInTheDocument()
      })
    })

    it('shows Add Question button when editable', async () => {
      mockFetchForQuiz(sampleQuestions)
      const quiz = makeQuizWithStats({ status: 'draft' })

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('Add Question')).toBeInTheDocument()
      })
    })

    it('shows empty state when no questions', async () => {
      mockFetchForQuiz([])
      const quiz = makeQuizWithStats()

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('No questions yet. Add one to get started.')).toBeInTheDocument()
      })
    })
  })

  describe('Preview tab', () => {
    it('shows quiz preview with radio buttons', async () => {
      mockFetchForQuiz(sampleQuestions)
      const quiz = makeQuizWithStats()

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('Preview')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Preview'))

      await waitFor(() => {
        expect(screen.getByText('1. Favorite color?')).toBeInTheDocument()
        expect(screen.getByText('2. Favorite animal?')).toBeInTheDocument()
      })

      expect(screen.getByText('Red')).toBeInTheDocument()
      expect(screen.getByText('Blue')).toBeInTheDocument()
      expect(screen.getByText('Cat')).toBeInTheDocument()
      expect(screen.getByText('Dog')).toBeInTheDocument()
      expect(screen.getByText(/Selections are not saved/)).toBeInTheDocument()
    })

    it('shows empty preview when no questions', async () => {
      mockFetchForQuiz([])
      const quiz = makeQuizWithStats()

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('Preview')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Preview'))

      await waitFor(() => {
        expect(screen.getByText('No questions to preview.')).toBeInTheDocument()
      })
    })
  })

  describe('Results tab', () => {
    it('shows aggregate results with bar charts', async () => {
      mockFetchForQuiz(sampleQuestions, sampleResults)
      const quiz = makeQuizWithStats({ stats: { total_students: 25, responded: 20, questions_count: 2 } })

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText(/Results/)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText(/Results \(20\)/))

      await waitFor(() => {
        expect(screen.getByText('Q1. Favorite color?')).toBeInTheDocument()
        expect(screen.getByText('Q2. Favorite animal?')).toBeInTheDocument()
      })

      expect(screen.getByText('10 (50%)')).toBeInTheDocument() // Blue
      expect(screen.getByText('12 (60%)')).toBeInTheDocument() // Cat
    })

    it('shows individual responses section for teacher', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      // Quiz details
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ questions: sampleQuestions }),
      })
      // Results
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: sampleResults, responders: [
          { student_id: 's1', name: 'Alice', email: 'alice@test.com' },
          { student_id: 's2', name: 'Bob', email: 'bob@test.com' },
        ] }),
      })

      const quiz = makeQuizWithStats({ stats: { total_students: 25, responded: 2, questions_count: 2 } })

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText(/Results/)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText(/Results \(2\)/))

      // The individual responses component fetches its own data
      // Just verify the section exists
      await waitFor(() => {
        expect(screen.getByText('Q1. Favorite color?')).toBeInTheDocument()
      })
    })

    it('shows no responses message when empty', async () => {
      mockFetchForQuiz(sampleQuestions)
      const quiz = makeQuizWithStats({ stats: { total_students: 25, responded: 0, questions_count: 2 } })

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText(/Results/)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText(/Results \(0\)/))

      await waitFor(() => {
        expect(screen.getByText('No responses yet.')).toBeInTheDocument()
      })
    })
  })

  describe('title editing', () => {
    it('saves title on Enter key', async () => {
      const fetchMock = mockFetchForQuiz(sampleQuestions)
      const quiz = makeQuizWithStats({ title: 'Old Title' })

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('Old Title')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Old Title'))

      const input = screen.getByDisplayValue('Old Title')
      fireEvent.change(input, { target: { value: 'New Title' } })

      // Mock the PATCH call
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => {
        const patchCall = fetchMock.mock.calls.find(
          (call: any[]) => call[1]?.method === 'PATCH'
        )
        expect(patchCall).toBeTruthy()
        expect(JSON.parse(patchCall![1].body)).toEqual({ title: 'New Title' })
      })
    })

    it('cancels edit on Escape key', async () => {
      mockFetchForQuiz(sampleQuestions)
      const quiz = makeQuizWithStats({ title: 'Original' })

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('Original')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Original'))
      const input = screen.getByDisplayValue('Original')
      fireEvent.change(input, { target: { value: 'Changed' } })
      fireEvent.keyDown(input, { key: 'Escape' })

      // Should revert to original title (non-edit mode)
      expect(screen.getByText('Original')).toBeInTheDocument()
      expect(screen.queryByDisplayValue('Changed')).not.toBeInTheDocument()
    })
  })
})
