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

    it('shows Documents tab for tests', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quiz: {
            documents: [
              { id: 'doc-1', title: 'Java API', url: 'https://docs.oracle.com', source: 'link' },
            ],
          },
          questions: sampleQuestions,
        }),
      })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Docs Test',
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      await waitFor(() => {
        expect(screen.getByText('Documents (1)')).toBeInTheDocument()
      })
    })

    it('renders Documents tab before Preview in tests', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quiz: {
            documents: [
              { id: 'doc-1', title: 'Java API', url: 'https://docs.oracle.com', source: 'link' },
            ],
          },
          questions: sampleQuestions,
        }),
      })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Docs Tab Order Test',
      })

      const { container } = render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      await waitFor(() => {
        expect(screen.getByText('Documents (1)')).toBeInTheDocument()
      })

      const tabStrip = container.querySelector('.flex.border-b.border-border.shrink-0')
      expect(tabStrip).toBeTruthy()
      const tabLabels = Array.from(tabStrip!.querySelectorAll('button')).map((button) =>
        button.textContent?.trim() || ''
      )
      expect(tabLabels).toEqual(['Questions (2)', 'Documents (1)', 'Preview', 'Results (0)'])
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

    it('allows editing controls when quiz has responses', async () => {
      mockFetchForQuiz(sampleQuestions, sampleResults)
      const quiz = makeQuizWithStats({ stats: { total_students: 25, responded: 5, questions_count: 2 } })

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.queryByText('Questions cannot be edited after students have responded.')).not.toBeInTheDocument()
      })

      expect(screen.getByText('Add Question')).toBeInTheDocument()
    })

    it('shows Add Question button when editable', async () => {
      mockFetchForQuiz(sampleQuestions)
      const quiz = makeQuizWithStats({ status: 'draft' })

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByText('Add Question')).toBeInTheDocument()
      })
    })

    it('does not show activation warning label when no questions', async () => {
      mockFetchForQuiz([])
      const quiz = makeQuizWithStats()

      render(<QuizDetailPanel quiz={quiz} classroomId="classroom-1" onQuizUpdate={vi.fn()} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.queryByText('Quiz must have at least 1 question')).not.toBeInTheDocument()
      })
    })

    it('in tests authoring, question type is fixed and open-response char limit is hidden', async () => {
      const testQuestion = createMockQuizQuestion({
        id: 'test-q1',
        question_type: 'open_response',
        question_text: 'Explain your reasoning',
        options: [],
        points: 5,
        response_max_chars: 5000,
        answer_key: null,
      })
      mockFetchForQuiz([testQuestion])
      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Mixed Format Test',
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      await waitFor(() => {
        expect(screen.getByDisplayValue('Explain your reasoning')).toBeInTheDocument()
      })

      const promptField = screen.getByPlaceholderText('Question prompt')
      expect(promptField.tagName).toBe('TEXTAREA')

      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText('Character limit')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Code')).toBeInTheDocument()
      expect(screen.getByText('Points')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
      const promptFieldGridCheck = screen.getByDisplayValue('Explain your reasoning')
      const gridContainer = promptFieldGridCheck.closest('div')?.parentElement
      expect(gridContainer?.className).toContain('md:grid-cols-[56px_minmax(0,1fr)_180px]')
      expect(screen.getByRole('button', { name: 'Add Answer Key (Optional)' })).toBeInTheDocument()
      expect(screen.queryByPlaceholderText('Enter an optional answer key for AI-assisted grading...')).not.toBeInTheDocument()
      expect(screen.queryByText('Open response')).not.toBeInTheDocument()
      expect(screen.queryByText('Multiple choice')).not.toBeInTheDocument()
    })

    it('keeps answer key collapsed by default and expands on click', async () => {
      const testQuestion = createMockQuizQuestion({
        id: 'test-q-open',
        question_type: 'open_response',
        question_text: 'Explain photosynthesis.',
        options: [],
        points: 5,
        response_max_chars: 5000,
        answer_key: null,
      })
      mockFetchForQuiz([testQuestion])
      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Open Response Test',
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Add Answer Key (Optional)' })).toBeInTheDocument()
      })
      expect(screen.queryByPlaceholderText('Enter an optional answer key for AI-assisted grading...')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Add Answer Key (Optional)' }))
      expect(screen.getByPlaceholderText('Enter an optional answer key for AI-assisted grading...')).toBeInTheDocument()
    })

    it('sends answer_key when saving an open-response question', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            questions: [
              createMockQuizQuestion({
                id: 'test-q-save',
                question_type: 'open_response',
                question_text: 'Explain inertia.',
                options: [],
                points: 5,
                response_max_chars: 5000,
                answer_key: null,
              }),
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ question: { id: 'test-q-save' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            questions: [
              createMockQuizQuestion({
                id: 'test-q-save',
                question_type: 'open_response',
                question_text: 'Explain inertia.',
                options: [],
                points: 5,
                response_max_chars: 5000,
                answer_key: 'Objects resist changes in motion.',
              }),
            ],
          }),
        })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Save Answer Key Test',
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      await waitFor(() => {
        expect(screen.getByDisplayValue('Explain inertia.')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Add Answer Key (Optional)' }))
      fireEvent.change(
        screen.getByPlaceholderText('Enter an optional answer key for AI-assisted grading...'),
        { target: { value: 'Objects resist changes in motion.' } }
      )
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/teacher/tests/'),
          expect.objectContaining({ method: 'PATCH' })
        )
      })

      const patchCall = fetchMock.mock.calls.find((call: any[]) => call[1]?.method === 'PATCH')
      const patchBody = JSON.parse(patchCall?.[1]?.body ?? '{}')
      expect(patchBody.answer_key).toBe('Objects resist changes in motion.')
    })

    it('creates new test questions with empty question_text so placeholder text remains a placeholder', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ questions: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ question: { id: 'new-question-id' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ questions: [] }),
        })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Draft Test',
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      await waitFor(() => {
        expect(screen.getByText('Add MC Question')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Add MC Question'))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/teacher/tests/'),
          expect.objectContaining({ method: 'POST' })
        )
      })

      const postCall = fetchMock.mock.calls.find((call: any[]) => call[1]?.method === 'POST')
      const postBody = JSON.parse(postCall?.[1]?.body ?? '{}')
      expect(postBody.question_text).toBe('')
    })

    it('adds a link document and sends documents payload to tests PATCH endpoint', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: { documents: [] },
            questions: sampleQuestions,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: {
              documents: [
                { id: 'doc-1', title: 'Java API', url: 'https://docs.oracle.com', source: 'link' },
              ],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: {
              documents: [
                { id: 'doc-1', title: 'Java API', url: 'https://docs.oracle.com', source: 'link' },
              ],
            },
            questions: sampleQuestions,
          }),
        })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Doc Save Test',
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      await waitFor(() => {
        expect(screen.getByText('Documents (0)')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Documents (0)'))

      fireEvent.change(screen.getByPlaceholderText('Title (e.g., Java API)'), {
        target: { value: 'Java API' },
      })
      fireEvent.change(screen.getByPlaceholderText('https://...'), {
        target: { value: 'https://docs.oracle.com' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add link document' }))

      await waitFor(() => {
        const patchCall = fetchMock.mock.calls.find((call: any[]) => call[1]?.method === 'PATCH')
        expect(patchCall).toBeTruthy()
        const body = JSON.parse(patchCall![1].body)
        expect(body.documents).toEqual([
          {
            id: expect.any(String),
            title: 'Java API',
            url: 'https://docs.oracle.com',
            source: 'link',
          },
        ])
      })
    })

    it('adds a text document and sends text content in documents payload', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: { documents: [] },
            questions: sampleQuestions,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: {
              documents: [
                {
                  id: 'doc-text-1',
                  title: 'Allowed formulas',
                  source: 'text',
                  content: 'distance = rate * time',
                },
              ],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: {
              documents: [
                {
                  id: 'doc-text-1',
                  title: 'Allowed formulas',
                  source: 'text',
                  content: 'distance = rate * time',
                },
              ],
            },
            questions: sampleQuestions,
          }),
        })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Doc Text Save Test',
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      await waitFor(() => {
        expect(screen.getByText('Documents (0)')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Documents (0)'))

      fireEvent.change(screen.getByPlaceholderText('Title (e.g., Allowed formulas)'), {
        target: { value: 'Allowed formulas' },
      })
      fireEvent.change(screen.getByPlaceholderText('Paste text students can reference during the test...'), {
        target: { value: 'distance = rate * time' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add text document' }))

      await waitFor(() => {
        const patchCall = fetchMock.mock.calls.find((call: any[]) => call[1]?.method === 'PATCH')
        expect(patchCall).toBeTruthy()
        const body = JSON.parse(patchCall![1].body)
        expect(body.documents).toEqual([
          {
            id: expect.any(String),
            title: 'Allowed formulas',
            source: 'text',
            content: 'distance = rate * time',
          },
        ])
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
        expect(screen.getByText('Favorite color?')).toBeInTheDocument()
        expect(screen.getByText('Favorite animal?')).toBeInTheDocument()
      })

      expect(screen.getByText('Red')).toBeInTheDocument()
      expect(screen.getByText('Blue')).toBeInTheDocument()
      expect(screen.getByText('Cat')).toBeInTheDocument()
      expect(screen.getByText('Dog')).toBeInTheDocument()
      expect(screen.getByText(/Selections are not saved/)).toBeInTheDocument()
    })

    it('hides the helper label in test preview', async () => {
      mockFetchForQuiz(sampleQuestions)
      const testQuiz = makeQuizWithStats({ assessment_type: 'test', title: 'Preview Test' })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      await waitFor(() => {
        expect(screen.getByText('Preview')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Preview'))

      await waitFor(() => {
        expect(screen.getByText('Favorite color?')).toBeInTheDocument()
      })
      expect(screen.queryByText(/Selections are not saved/)).not.toBeInTheDocument()
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
        expect(screen.getByText('Favorite color?')).toBeInTheDocument()
        expect(screen.getByText('Favorite animal?')).toBeInTheDocument()
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
        expect(screen.getByText('Favorite color?')).toBeInTheDocument()
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
