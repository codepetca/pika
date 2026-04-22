import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QuizDetailPanel } from '@/components/QuizDetailPanel'
import { TEST_MARKDOWN_AI_SCHEMA } from '@/lib/test-markdown'
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

const summaryDetailQuestions: QuizQuestion[] = [
  createMockQuizQuestion({
    id: 'sq1',
    assessment_type: 'test',
    question_type: 'open_response',
    question_text: 'Explain the runtime complexity of your solution.',
    options: [],
    correct_option: null,
    answer_key: 'Look for linear-time reasoning and mention of hash-map tradeoffs.',
    sample_solution: 'A good answer explains O(n) time and O(n) space.',
    points: 6,
    response_monospace: true,
    position: 0,
  }),
  createMockQuizQuestion({
    id: 'sq2',
    assessment_type: 'test',
    question_type: 'multiple_choice',
    question_text: 'Which traversal visits the root node first?',
    options: ['Inorder', 'Preorder', 'Postorder'],
    correct_option: 1,
    points: 3,
    position: 1,
  }),
]

const sampleResults: QuizResultsAggregate[] = [
  { question_id: 'q1', question_text: 'Favorite color?', options: ['Red', 'Blue', 'Green'], counts: [5, 10, 5], total_responses: 20 },
  { question_id: 'q2', question_text: 'Favorite animal?', options: ['Cat', 'Dog'], counts: [12, 8], total_responses: 20 },
]
const markdownQuestionId1 = '11111111-1111-4111-8111-111111111111'
const markdownQuestionId2 = '22222222-2222-4222-8222-222222222222'

describe('QuizDetailPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mockFetchForQuiz(
    questions: QuizQuestion[],
    results?: QuizResultsAggregate[],
    draftOverrides?: {
      title?: string
      show_results?: boolean
      version?: number
    }
  ) {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const draftContent: Record<string, unknown> = { questions }
    if (typeof draftOverrides?.title === 'string') {
      draftContent.title = draftOverrides.title
    }
    if (typeof draftOverrides?.show_results === 'boolean') {
      draftContent.show_results = draftOverrides.show_results
    }

    // First call: GET assessment draft
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        draft: {
          version: draftOverrides?.version ?? 1,
          content: draftContent,
        },
      }),
    })
    // Second call (if results provided): GET assessment results
    if (results) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results, responders: [] }),
      })
    }
    return fetchMock
  }

  describe('tabs', () => {
    it('renders Questions, Preview, and Results tabs for quizzes', async () => {
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
          draft: {
            version: 1,
            content: {
              title: 'Docs Test',
              show_results: true,
              questions: sampleQuestions,
            },
          },
        }),
      })
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
      expect(screen.getByText('Markdown')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    })

    it('does not render a Preview tab in tests', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          draft: {
            version: 1,
            content: {
              title: 'Docs Tab Order Test',
              show_results: true,
              questions: sampleQuestions,
            },
          },
        }),
      })
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
      const tabLabels = Array.from(tabStrip!.children)
        .filter((element) => element.tagName === 'BUTTON')
        .map((element) => element.textContent?.trim() || '')
      expect(tabLabels).toEqual(['Questions (2)', 'Documents (1)', 'Markdown'])
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    })

    it('renders tests in summary-detail mode with accordion editors on the left and markdown on the right', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          draft: {
            version: 1,
            content: {
              title: 'Two Pane Test',
              show_results: true,
              questions: summaryDetailQuestions,
            },
          },
        }),
      })
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quiz: {
            documents: [],
          },
        }),
      })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Two Pane Test',
        stats: { total_students: 25, responded: 0, questions_count: 2 },
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
          testQuestionLayout="summary-detail"
          showPreviewButton={false}
          showResultsTab={false}
        />,
        { wrapper: Wrapper }
      )

      expect(await screen.findByTestId('test-summary-detail-layout')).toBeInTheDocument()
      const editorPane = screen.getByTestId('test-question-editor-pane')
      const markdownPane = screen.getByTestId('test-question-markdown-pane')
      expect(editorPane).toBeInTheDocument()
      expect(markdownPane).toBeInTheDocument()
      expect(within(editorPane).getByTestId('test-documents-card')).toBeInTheDocument()
      expect(within(editorPane).getByText('Documents')).toBeInTheDocument()
      expect(within(editorPane).getByText('0 documents')).toBeInTheDocument()
      expect(within(editorPane).getByRole('button', { name: 'Add Document' })).toBeInTheDocument()

      expect(within(editorPane).getByTestId('test-question-editor-header-summary')).toHaveTextContent('2 questions')
      expect(within(editorPane).getByTestId('test-question-editor-header-summary')).toHaveTextContent('9 pts')
      expect(within(editorPane).getByRole('button', { name: 'Expand all questions' })).toBeInTheDocument()
      expect(within(editorPane).getByRole('button', { name: 'Collapse question 1' })).toBeInTheDocument()
      expect(within(editorPane).getByRole('button', { name: 'Expand question 2' })).toBeInTheDocument()
      expect(within(editorPane).getByRole('button', { name: 'Duplicate question 1' })).toBeInTheDocument()
      expect(within(editorPane).getByRole('button', { name: 'Delete question 1' })).toBeInTheDocument()
      expect(within(editorPane).getByRole('button', { name: '+ MC Question' })).toHaveClass('bg-primary')
      expect(within(editorPane).getByRole('button', { name: 'Choose question type' })).toBeInTheDocument()
      expect(within(editorPane).getByLabelText('Question 1 points')).toHaveValue(6)
      expect(within(editorPane).getByLabelText('Question 1 code response')).toBeChecked()
      expect(within(editorPane).getByTestId('question-sq2-collapsed-summary')).toHaveTextContent(
        'Which traversal visits the root node first?'
      )
      expect(within(editorPane).getByDisplayValue('Explain the runtime complexity of your solution.')).toBeInTheDocument()
      expect(
        within(editorPane).getByDisplayValue('Look for linear-time reasoning and mention of hash-map tradeoffs.')
      ).toBeInTheDocument()
      expect(within(editorPane).queryByDisplayValue('Which traversal visits the root node first?')).not.toBeInTheDocument()

      const markdownEditor = within(markdownPane).getByTestId('test-markdown-editor')
      expect((markdownEditor as HTMLTextAreaElement).value).toContain('Explain the runtime complexity of your solution.')
      expect((markdownEditor as HTMLTextAreaElement).value).toContain('Which traversal visits the root node first?')
      expect(markdownEditor).toHaveProperty('readOnly', true)
      expect(within(markdownPane).getByTestId('markdown-helper-status')).toHaveTextContent('Markdown mirror')
      expect(within(markdownPane).getByRole('button', { name: 'Edit Markdown' })).toBeInTheDocument()
      expect(within(markdownPane).queryByText('Markdown')).not.toBeInTheDocument()
      expect(within(markdownPane).queryByText('Edit the full test source alongside the structured questions.')).not.toBeInTheDocument()
      expect(within(markdownPane).queryByRole('button', { name: 'Details' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Select question 2' })).not.toBeInTheDocument()

      fireEvent.click(within(editorPane).getByRole('button', { name: 'Collapse documents' }))

      await waitFor(() => {
        expect(within(editorPane).getByRole('button', { name: 'Expand documents' })).toBeInTheDocument()
        expect(within(editorPane).queryByRole('button', { name: 'Add Document' })).not.toBeInTheDocument()
      })

      fireEvent.click(within(editorPane).getByRole('button', { name: 'Expand documents' }))

      await waitFor(() => {
        expect(within(editorPane).getByRole('button', { name: 'Collapse documents' })).toBeInTheDocument()
        expect(within(editorPane).getByRole('button', { name: 'Add Document' })).toBeInTheDocument()
      })

      fireEvent.click(within(editorPane).getByRole('button', { name: 'Expand all questions' }))

      await waitFor(() => {
        expect(within(editorPane).getByRole('button', { name: 'Collapse all questions' })).toBeInTheDocument()
        expect(within(editorPane).getByLabelText('Question 2 points')).toHaveValue(3)
        expect(within(editorPane).getByDisplayValue('Which traversal visits the root node first?')).toBeInTheDocument()
        expect(within(editorPane).queryByTestId('question-sq2-collapsed-summary')).not.toBeInTheDocument()
        expect(within(editorPane).getByDisplayValue('Inorder')).toBeInTheDocument()
        expect(within(editorPane).getByDisplayValue('Preorder')).toBeInTheDocument()
        expect(within(editorPane).getByDisplayValue('Postorder')).toBeInTheDocument()
      })

      fireEvent.click(within(editorPane).getByRole('button', { name: 'Collapse all questions' }))

      await waitFor(() => {
        expect(within(editorPane).getByRole('button', { name: 'Expand all questions' })).toBeInTheDocument()
        expect(within(editorPane).queryByDisplayValue('Explain the runtime complexity of your solution.')).not.toBeInTheDocument()
        expect(within(editorPane).queryByDisplayValue('Which traversal visits the root node first?')).not.toBeInTheDocument()
        expect(within(editorPane).getByTestId('question-sq1-collapsed-summary')).toHaveTextContent(
          'Explain the runtime complexity of your solution.'
        )
        expect(within(editorPane).getByTestId('question-sq2-collapsed-summary')).toHaveTextContent(
          'Which traversal visits the root node first?'
        )
      })
    })

    it('duplicates a test question immediately below the source in summary-detail mode', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          draft: {
            version: 1,
            content: {
              title: 'Duplicate Test',
              show_results: true,
              questions: summaryDetailQuestions,
            },
          },
        }),
      })
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quiz: {
            documents: [],
          },
        }),
      })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Duplicate Test',
        stats: { total_students: 25, responded: 0, questions_count: 2 },
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
          testQuestionLayout="summary-detail"
          showPreviewButton={false}
          showResultsTab={false}
        />,
        { wrapper: Wrapper }
      )

      const editorPane = await screen.findByTestId('test-question-editor-pane')
      fireEvent.click(within(editorPane).getByRole('button', { name: 'Duplicate question 1' }))

      await waitFor(() => {
        expect(within(editorPane).getByTestId('test-question-editor-header-summary')).toHaveTextContent('3 questions')
        expect(within(editorPane).getByTestId('test-question-editor-header-summary')).toHaveTextContent('15 pts')
        expect(within(editorPane).getByRole('button', { name: 'Collapse question 1' })).toBeInTheDocument()
        expect(within(editorPane).getByRole('button', { name: 'Collapse question 2' })).toBeInTheDocument()
        expect(within(editorPane).getByRole('button', { name: 'Expand question 3' })).toBeInTheDocument()
        expect(within(editorPane).getByLabelText('Question 2 points')).toHaveValue(6)
        expect(within(editorPane).getByLabelText('Question 2 code response')).toBeChecked()
        expect(
          within(editorPane).getAllByDisplayValue('Explain the runtime complexity of your solution.')
        ).toHaveLength(2)
        expect(within(editorPane).getByTestId('question-sq2-collapsed-summary')).toHaveTextContent(
          'Which traversal visits the root node first?'
        )
      })
    })

    it('remembers the last selected question type in the add split button', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          draft: {
            version: 1,
            content: {
              title: 'Split Button Test',
              show_results: true,
              questions: summaryDetailQuestions,
            },
          },
        }),
      })
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quiz: {
            documents: [],
          },
        }),
      })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Split Button Test',
        stats: { total_students: 25, responded: 0, questions_count: 2 },
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
          testQuestionLayout="summary-detail"
          showPreviewButton={false}
          showResultsTab={false}
        />,
        { wrapper: Wrapper }
      )

      const editorPane = await screen.findByTestId('test-question-editor-pane')
      expect(within(editorPane).getByRole('button', { name: '+ MC Question' })).toBeInTheDocument()

      fireEvent.click(within(editorPane).getByRole('button', { name: 'Choose question type' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }))

      await waitFor(() => {
        expect(within(editorPane).getByTestId('test-question-editor-header-summary')).toHaveTextContent('3 questions')
        expect(within(editorPane).getByRole('button', { name: '+ Open Question' })).toBeInTheDocument()
      })

      fireEvent.click(within(editorPane).getByRole('button', { name: '+ Open Question' }))

      await waitFor(() => {
        expect(within(editorPane).getByTestId('test-question-editor-header-summary')).toHaveTextContent('4 questions')
        expect(within(editorPane).getByRole('button', { name: '+ Open Question' })).toBeInTheDocument()
      })
    })

    it('updates the markdown mirror immediately after structured edits in summary-detail mode', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          draft: {
            version: 1,
            content: {
              title: 'Mirror Test',
              show_results: true,
              questions: summaryDetailQuestions,
            },
          },
        }),
      })
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quiz: {
            documents: [],
          },
        }),
      })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Mirror Test',
        stats: { total_students: 25, responded: 0, questions_count: 2 },
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
          testQuestionLayout="summary-detail"
          showPreviewButton={false}
          showResultsTab={false}
        />,
        { wrapper: Wrapper }
      )

      const editorPane = await screen.findByTestId('test-question-editor-pane')
      const markdownPane = screen.getByTestId('test-question-markdown-pane')
      const promptField = within(editorPane).getByDisplayValue('Explain the runtime complexity of your solution.')

      fireEvent.change(promptField, {
        target: { value: 'Explain the amortized runtime complexity of your solution.' },
      })
      fireEvent.blur(promptField)

      await waitFor(() => {
        expect(
          (within(markdownPane).getByTestId('test-markdown-editor') as HTMLTextAreaElement).value
        ).toContain('Explain the amortized runtime complexity of your solution.')
      })

      const patchCalls = fetchMock.mock.calls.filter((call: any[]) => call[1]?.method === 'PATCH')
      expect(patchCalls).toHaveLength(0)
    })

    it('locks the left pane while markdown edits are pending in summary-detail mode', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          draft: {
            version: 1,
            content: {
              title: 'Pending Markdown Test',
              show_results: true,
              questions: summaryDetailQuestions,
            },
          },
        }),
      })
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quiz: {
            documents: [],
          },
        }),
      })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Pending Markdown Test',
        stats: { total_students: 25, responded: 0, questions_count: 2 },
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
          testQuestionLayout="summary-detail"
          showPreviewButton={false}
          showResultsTab={false}
        />,
        { wrapper: Wrapper }
      )

      const editorPane = await screen.findByTestId('test-question-editor-pane')
      const markdownPane = screen.getByTestId('test-question-markdown-pane')
      const markdownEditor = within(markdownPane).getByTestId('test-markdown-editor')

      fireEvent.click(within(markdownPane).getByRole('button', { name: 'Edit Markdown' }))
      expect(markdownEditor).toHaveProperty('readOnly', false)

      fireEvent.change(markdownEditor, {
        target: { value: '# Test\nTitle: Pending Markdown Test\nShow Results: true\n' },
      })

      await waitFor(() => {
        expect(within(markdownPane).getByTestId('markdown-helper-status')).toHaveTextContent(
          'Markdown edits not applied'
        )
        expect(within(markdownPane).getByRole('button', { name: 'Apply Markdown' })).toBeInTheDocument()
        expect(within(markdownPane).getByRole('button', { name: 'Undo markdown edits' })).toBeInTheDocument()
        expect(screen.getByTestId('markdown-pending-lock')).toBeInTheDocument()
        expect(within(editorPane).getByRole('button', { name: '+ MC Question' })).toBeDisabled()
      })
    })

    it('applies markdown to the left pane before the save request resolves', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      let resolvePatch: ((value: { ok: boolean; json: () => Promise<any> }) => void) | null = null
      const patchPromise = new Promise<{ ok: boolean; json: () => Promise<any> }>((resolve) => {
        resolvePatch = resolve
      })

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 1,
              content: {
                title: 'Apply Timing Test',
                show_results: true,
                questions: summaryDetailQuestions,
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: {
              documents: [],
            },
          }),
        })
        .mockImplementationOnce(() => patchPromise as unknown as Promise<Response>)

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Apply Timing Test',
        stats: { total_students: 25, responded: 0, questions_count: 2 },
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
          testQuestionLayout="summary-detail"
          showPreviewButton={false}
          showResultsTab={false}
        />,
        { wrapper: Wrapper }
      )

      const editorPane = await screen.findByTestId('test-question-editor-pane')
      const markdownPane = screen.getByTestId('test-question-markdown-pane')

      fireEvent.click(within(markdownPane).getByRole('button', { name: 'Edit Markdown' }))
      fireEvent.change(within(markdownPane).getByTestId('test-markdown-editor'), {
        target: {
          value: `# Test
Title: Apply Timing Test Updated
Show Results: true

## Questions
### Question 1
ID: ${markdownQuestionId1}
Type: multiple_choice
Points: 1
Prompt:
Updated prompt before save returns?
Options:
- A
- B
Correct Option: 2

## Documents
_None_
`,
        },
      })
      fireEvent.click(within(markdownPane).getByRole('button', { name: 'Apply Markdown' }))

      await waitFor(() => {
        expect(within(editorPane).getByDisplayValue('Updated prompt before save returns?')).toBeInTheDocument()
        expect(within(markdownPane).getByTestId('markdown-helper-status')).toHaveTextContent('Applying markdown...')
      })

      resolvePatch?.({
        ok: true,
        json: async () => ({
          draft: {
            version: 2,
            content: {
              title: 'Apply Timing Test Updated',
              show_results: true,
              questions: [
                {
                  id: markdownQuestionId1,
                  question_type: 'multiple_choice',
                  question_text: 'Updated prompt before save returns?',
                  options: ['A', 'B'],
                  correct_option: 1,
                  answer_key: null,
                  sample_solution: null,
                  points: 1,
                  response_max_chars: 5000,
                  response_monospace: false,
                },
              ],
            },
          },
        }),
      })

      await waitFor(() => {
        expect(within(markdownPane).getByText('Markdown applied')).toBeInTheDocument()
      })
    })

    it('saves draft and opens student preview route for tests', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 1,
              content: {
                title: 'Preview Action Test',
                show_results: true,
                questions: sampleQuestions,
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: {
              documents: [],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 2,
              content: {
                title: 'Preview Action Test',
                show_results: true,
                questions: sampleQuestions,
              },
            },
          }),
        })

      const replaceSpy = vi.fn()
      const fakePreviewWindow = {
        closed: false,
        close: vi.fn(),
        focus: vi.fn(),
        moveTo: vi.fn(),
        resizeTo: vi.fn(),
        document: {
          title: '',
          body: {
            innerHTML: '',
            style: {
              margin: '',
            },
          },
        },
        location: {
          replace: replaceSpy,
        },
      } as unknown as Window
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => fakePreviewWindow)

      const testQuiz = makeQuizWithStats({
        id: 'test-preview-action-id',
        assessment_type: 'test',
        title: 'Preview Action Test',
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
        expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

      await waitFor(() => {
        expect(openSpy).toHaveBeenCalled()
      })
      const openArgs = openSpy.mock.calls.at(0)
      expect(openArgs?.[0]).toBe('')
      expect(openArgs?.[1]).toBe('_blank')
      expect(openArgs?.[2]).toContain('popup=yes')
      expect(openArgs?.[2]).toContain('width=')
      expect(openArgs?.[2]).toContain('height=')
      expect(replaceSpy).toHaveBeenCalledWith('/classrooms/classroom-1/tests/test-preview-action-id/preview')

      const patchCall = fetchMock.mock.calls.find(
        (call: any[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('/api/teacher/tests/test-preview-action-id/draft') &&
          call[1]?.method === 'PATCH'
      )
      expect(patchCall).toBeTruthy()

      openSpy.mockRestore()
    })

    it('uses the in-app preview callback for tests when provided', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 1,
              content: {
                title: 'Inline Preview Test',
                show_results: true,
                questions: sampleQuestions,
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: {
              documents: [],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 2,
              content: {
                title: 'Inline Preview Test',
                show_results: true,
                questions: sampleQuestions,
              },
            },
          }),
        })

      const onRequestTestPreview = vi.fn()
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

      const testQuiz = makeQuizWithStats({
        id: 'test-inline-preview-id',
        assessment_type: 'test',
        title: 'Inline Preview Test',
      })

      render(
        <QuizDetailPanel
          quiz={testQuiz}
          classroomId="classroom-1"
          apiBasePath="/api/teacher/tests"
          onQuizUpdate={vi.fn()}
          onRequestTestPreview={onRequestTestPreview}
        />,
        { wrapper: Wrapper }
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

      await waitFor(() => {
        expect(onRequestTestPreview).toHaveBeenCalledWith({
          testId: 'test-inline-preview-id',
          title: 'Inline Preview Test',
        })
      })
      expect(openSpy).not.toHaveBeenCalled()

      const patchCall = fetchMock.mock.calls.find(
        (call: any[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('/api/teacher/tests/test-inline-preview-id/draft') &&
          call[1]?.method === 'PATCH'
      )
      expect(patchCall).toBeTruthy()

      openSpy.mockRestore()
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

  describe('Markdown tab', () => {
    it('loads persisted markdown as a read-only mirror and undo restores it after edits', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      const persistedSourceMarkdown = `# Test
Title: Markdown Test
Show Results: false

<!-- teacher formatting should survive -->

## Questions
### Question 1
ID: ${markdownQuestionId1}
Type: multiple_choice
Prompt:
Favorite color?
Options:
- Red
- Blue
- Green
Correct Option: 2
`

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 1,
              content: {
                title: 'Markdown Test',
                show_results: false,
                questions: sampleQuestions,
                source_format: 'markdown',
                source_markdown: persistedSourceMarkdown,
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: {
              documents: [],
            },
          }),
        })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Markdown Test',
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

      fireEvent.click(await screen.findByText('Markdown'))

      const textarea = await screen.findByRole('textbox')
      expect((textarea as HTMLTextAreaElement).value).toContain('Favorite color?')
      expect((textarea as HTMLTextAreaElement).value).toContain('Favorite animal?')
      expect(textarea).not.toHaveValue(persistedSourceMarkdown)
      expect(textarea).toHaveProperty('readOnly', true)
      expect(screen.getByTestId('markdown-helper-status')).toHaveTextContent('Markdown mirror')
      expect(screen.getByRole('button', { name: 'Edit Markdown' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Edit Markdown' }))
      expect(screen.getByRole('textbox')).toHaveProperty('readOnly', false)
      fireEvent.change(textarea, { target: { value: 'edited markdown' } })
      expect(screen.getByTestId('markdown-helper-status')).toHaveTextContent('Markdown edits not applied')
      fireEvent.click(screen.getByRole('button', { name: 'Undo markdown edits' }))

      await waitFor(() => {
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Favorite color?')
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Favorite animal?')
        expect(screen.getByRole('textbox')).toHaveProperty('readOnly', true)
      })
    })

    it('applies valid markdown and saves through draft endpoint', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 1,
              content: {
                title: 'Markdown Test',
                show_results: false,
                questions: sampleQuestions,
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: {
              documents: [],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 2,
              content: {
                title: 'Markdown Test Updated',
                show_results: true,
                questions: [
                  {
                    id: markdownQuestionId1,
                    question_type: 'multiple_choice',
                    question_text: 'Updated prompt?',
                    options: ['A', 'B'],
                    correct_option: 1,
                    answer_key: null,
                    points: 1,
                    response_max_chars: 5000,
                    response_monospace: false,
                  },
                  {
                    id: markdownQuestionId2,
                    question_type: 'open_response',
                    question_text: 'Explain why.',
                    options: [],
                    correct_option: null,
                    answer_key: 'Any valid explanation.',
                    points: 5,
                    response_max_chars: 5000,
                    response_monospace: true,
                  },
                ],
              },
            },
          }),
        })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Markdown Test',
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
        expect(screen.getByText('Markdown')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Markdown'))
      fireEvent.click(screen.getByRole('button', { name: 'Edit Markdown' }))
      fireEvent.change(screen.getByRole('textbox'), {
        target: {
          value: `# Test
Title: Markdown Test Updated
Show Results: true

## Questions
### Question 1
ID: ${markdownQuestionId1}
Type: multiple_choice
Points: 1
Prompt:
Updated prompt?
Options:
- A
- B
Correct Option: 2

### Question 2
ID: ${markdownQuestionId2}
Type: open_response
Points: 5
Code: true
Prompt:
Explain why.
Answer Key:
Any valid explanation.

## Documents
_None_
`,
        },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Apply Markdown' }))

      await waitFor(() => {
        expect(screen.getByText('Markdown applied')).toBeInTheDocument()
      })

      const patchCall = fetchMock.mock.calls.find(
        (call: any[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('/draft') &&
          call[1]?.method === 'PATCH'
      )
      expect(patchCall).toBeTruthy()
      const body = JSON.parse(patchCall?.[1]?.body ?? '{}')
      expect(body.content.title).toBe('Markdown Test Updated')
      expect(body.content.show_results).toBe(true)
      expect(body.content.questions).toHaveLength(2)
      expect(body.documents).toEqual([])
    })

    it('blocks apply when markdown is invalid', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 1,
              content: {
                title: 'Markdown Test',
                show_results: false,
                questions: sampleQuestions,
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: {
              documents: [],
            },
          }),
        })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Markdown Test',
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
        expect(screen.getByText('Markdown')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Markdown'))
      fireEvent.click(screen.getByRole('button', { name: 'Edit Markdown' }))
      fireEvent.change(screen.getByRole('textbox'), {
        target: {
          value: `# Test
Show Results: maybe

## Questions
### Question 1
Type: multiple_choice
Prompt:
`,
        },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Apply Markdown' }))

      await waitFor(() => {
        expect(screen.getByText(/Title is required/)).toBeInTheDocument()
      })

      const patchCalls = fetchMock.mock.calls.filter((call: any[]) => call[1]?.method === 'PATCH')
      expect(patchCalls).toHaveLength(0)
    })

    it('copies markdown schema to clipboard', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 1,
              content: {
                title: 'Markdown Test',
                show_results: false,
                questions: sampleQuestions,
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: {
              documents: [],
            },
          }),
        })

      const clipboardWriteText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: clipboardWriteText },
        configurable: true,
      })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Markdown Test',
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
        expect(screen.getByText('Markdown')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Markdown'))
      fireEvent.click(screen.getByRole('button', { name: 'Schema' }))

      await waitFor(() => {
        expect(clipboardWriteText).toHaveBeenCalledWith(TEST_MARKDOWN_AI_SCHEMA)
      })
      expect(screen.getByText('Markdown schema copied to clipboard')).toBeInTheDocument()
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
        expect(screen.getByText('Questions (1)')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Questions (1)'))

      await waitFor(() => {
        expect(screen.getByDisplayValue('Explain your reasoning')).toBeInTheDocument()
      })

      const promptField = screen.getByPlaceholderText('Question 1')
      expect(promptField.tagName).toBe('TEXTAREA')

      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText('Character limit')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Code')).toBeInTheDocument()
      expect(screen.getByText('Points')).toBeInTheDocument()
      const promptFieldGridCheck = screen.getByDisplayValue('Explain your reasoning')
      const gridContainer = promptFieldGridCheck.closest('div')?.parentElement
      expect(gridContainer?.className).toContain('md:grid-cols-[16px_24px_minmax(0,1fr)_112px]')
      expect(screen.getByRole('button', { name: 'Add Grading Notes' })).toBeInTheDocument()
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
        expect(screen.getByText('Questions (1)')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Questions (1)'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Add Grading Notes' })).toBeInTheDocument()
      })
      expect(screen.queryByPlaceholderText('Enter an optional answer key for AI-assisted grading...')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Add Grading Notes' }))
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
        expect(screen.getByText('Questions (1)')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Questions (1)'))

      await waitFor(() => {
        expect(screen.getByDisplayValue('Explain inertia.')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Add Grading Notes' }))
      const answerKeyField = screen.getByPlaceholderText('Enter an optional answer key for AI-assisted grading...')
      fireEvent.change(
        answerKeyField,
        { target: { value: 'Objects resist changes in motion.' } }
      )
      fireEvent.blur(answerKeyField)
      await new Promise((resolve) => setTimeout(resolve, 3_200))

      const patchCall = [...fetchMock.mock.calls]
        .reverse()
        .find(
          (call: any[]) =>
            call[1]?.method === 'PATCH' &&
            typeof call[0] === 'string' &&
            call[0].includes('/draft')
        )
      expect(patchCall).toBeTruthy()
      const patchBody = JSON.parse(patchCall?.[1]?.body ?? '{}')
      const answerKeyFromContent = patchBody?.content?.questions?.[0]?.answer_key
      const answerKeyFromPatch = Array.isArray(patchBody?.patch)
        ? patchBody.patch.find((op: any) => String(op?.path || '').includes('answer_key'))?.value
        : undefined
      expect(answerKeyFromContent ?? answerKeyFromPatch).toBe('Objects resist changes in motion.')
    })

    it('creates new test questions with empty question_text so placeholder text remains a placeholder', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 1,
              content: {
                title: 'Draft Test',
                show_results: true,
                questions: [],
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
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
        expect(screen.getByText('Questions (0)')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Questions (0)'))

      await waitFor(() => {
        expect(screen.getByText('+ MC Question')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('+ MC Question'))

      await waitFor(() => {
        expect(screen.getByText('Questions (1)')).toBeInTheDocument()
      })

      const promptField = screen.getByPlaceholderText('Question 1') as HTMLTextAreaElement
      expect(promptField.value).toBe('')
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

      expect(fetchMock.mock.calls.some((call: any[]) => call[1]?.method === 'POST')).toBe(false)
    })

    it('adds a link document and sends documents payload to tests PATCH endpoint', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.includes('/draft')) {
          return {
            ok: true,
            json: async () => ({
              draft: {
                version: 1,
                content: {
                  title: 'Doc Save Test',
                  show_results: true,
                  questions: sampleQuestions,
                },
              },
            }),
          }
        }

        if (url === '/api/teacher/tests/quiz-1' && (!options?.method || options.method === 'GET')) {
          return {
            ok: true,
            json: async () => ({
              quiz: { documents: [] },
            }),
          }
        }

        if (url === '/api/teacher/tests/quiz-1' && options?.method === 'PATCH') {
          const body = JSON.parse(String(options.body))
          return {
            ok: true,
            json: async () => ({
              quiz: {
                documents: body.documents,
              },
            }),
          }
        }

        if (url.match(/\/api\/teacher\/tests\/quiz-1\/documents\/.+\/sync$/) && options?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              quiz: {
                documents: [
                  {
                    id: JSON.parse(String(fetchMock.mock.calls.find((call: any[]) => call[1]?.method === 'PATCH')?.[1]?.body)).documents[0].id,
                    title: 'Java API',
                    url: 'https://docs.oracle.com',
                    source: 'link',
                    snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
                    snapshot_content_type: 'text/html',
                    synced_at: '2026-04-02T12:00:00.000Z',
                  },
                ],
              },
            }),
          }
        }

        throw new Error(`Unexpected fetch call: ${url}`)
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
        expect(screen.getByRole('button', { name: /Documents/ })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /Documents/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Add Document' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Link' }))
      fireEvent.change(screen.getByPlaceholderText('Title'), {
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

      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(
            (call: any[]) => String(call[0]).includes('/documents/') && call[1]?.method === 'POST'
          )
        ).toBe(true)
      })
    })

    it('shows compact sync age and refreshes existing link documents', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.includes('/draft')) {
          return {
            ok: true,
            json: async () => ({
              draft: {
                version: 1,
                content: {
                  title: 'Doc Refresh Test',
                  show_results: true,
                  questions: sampleQuestions,
                },
              },
            }),
          }
        }

        if (url === '/api/teacher/tests/quiz-1' && (!options?.method || options.method === 'GET')) {
          return {
            ok: true,
            json: async () => ({
              quiz: {
                documents: [
                  {
                    id: 'doc-1',
                    title: 'Java API',
                    url: 'https://docs.oracle.com',
                    source: 'link',
                    snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
                    snapshot_content_type: 'text/html',
                    synced_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
                  },
                ],
              },
            }),
          }
        }

        if (url === '/api/teacher/tests/quiz-1/documents/doc-1/sync' && options?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              quiz: {
                documents: [
                  {
                    id: 'doc-1',
                    title: 'Java API',
                    url: 'https://docs.oracle.com',
                    source: 'link',
                    snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
                    snapshot_content_type: 'text/html',
                    synced_at: '2026-04-02T12:00:00.000Z',
                  },
                ],
              },
            }),
          }
        }

        throw new Error(`Unexpected fetch call: ${url}`)
      })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Doc Refresh Test',
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
        expect(screen.getByRole('button', { name: /Documents/ })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /Documents/ }))

      await waitFor(() => {
        expect(screen.getByText('4m')).toBeInTheDocument()
      })

      expect(
        fetchMock.mock.calls.some(
          (call: any[]) => call[0] === '/api/teacher/tests/quiz-1/documents/doc-1/sync' && call[1]?.method === 'POST'
        )
      ).toBe(false)

      fireEvent.click(screen.getByRole('button', { name: 'Refresh Java API' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/teacher/tests/quiz-1/documents/doc-1/sync',
          expect.objectContaining({ method: 'POST' })
        )
      })
    })

    it('auto-syncs stale link documents when a teacher opens the test', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.includes('/draft')) {
          return {
            ok: true,
            json: async () => ({
              draft: {
                version: 1,
                content: {
                  title: 'Doc Auto Sync Test',
                  show_results: true,
                  questions: sampleQuestions,
                },
              },
            }),
          }
        }

        if (url === '/api/teacher/tests/quiz-1' && (!options?.method || options.method === 'GET')) {
          return {
            ok: true,
            json: async () => ({
              quiz: {
                documents: [
                  {
                    id: 'doc-1',
                    title: 'Java API',
                    url: 'https://docs.oracle.com',
                    source: 'link',
                    snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
                    snapshot_content_type: 'text/html',
                    synced_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
                  },
                ],
              },
            }),
          }
        }

        if (url === '/api/teacher/tests/quiz-1/documents/doc-1/sync' && options?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              quiz: {
                documents: [
                  {
                    id: 'doc-1',
                    title: 'Java API',
                    url: 'https://docs.oracle.com',
                    source: 'link',
                    snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
                    snapshot_content_type: 'text/html',
                    synced_at: new Date().toISOString(),
                  },
                ],
              },
            }),
          }
        }

        throw new Error(`Unexpected fetch call: ${url}`)
      })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Doc Auto Sync Test',
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
        expect(screen.getByRole('button', { name: /Documents/ })).toBeInTheDocument()
      })

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/teacher/tests/quiz-1/documents/doc-1/sync',
          expect.objectContaining({ method: 'POST' })
        )
      })
    })

    it('adds a text document and sends text content in documents payload', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 1,
              content: {
                title: 'Doc Text Save Test',
                show_results: true,
                questions: sampleQuestions,
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: { documents: [] },
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
            draft: {
              version: 2,
              content: {
                title: 'Doc Text Save Test',
                show_results: true,
                questions: sampleQuestions,
              },
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
        expect(screen.getByRole('button', { name: 'Documents' })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Documents' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add Document' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Text' }))
      fireEvent.change(screen.getByPlaceholderText('Title'), {
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

    it('opens upload modal from Add Document dropdown PDF option', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            draft: {
              version: 1,
              content: {
                title: 'Doc Upload Modal Test',
                show_results: true,
                questions: sampleQuestions,
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            quiz: { documents: [] },
          }),
        })

      const testQuiz = makeQuizWithStats({
        assessment_type: 'test',
        title: 'Doc Upload Modal Test',
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
        expect(screen.getByRole('button', { name: 'Documents' })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Documents' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add Document' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'PDF' }))

      expect(screen.getByRole('heading', { name: 'Upload pdf' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Choose file' })).toBeInTheDocument()
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
      // Quiz draft
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          draft: {
            version: 1,
            content: {
              title: 'Untitled Quiz',
              show_results: true,
              questions: sampleQuestions,
            },
          },
        }),
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
        expect(String(patchCall?.[0])).toContain('/draft')
        const patchBody = JSON.parse(patchCall?.[1]?.body ?? '{}')
        expect(patchBody.version).toBe(1)
        const payload = JSON.stringify(patchBody.content ?? patchBody.patch ?? {})
        expect(payload).toContain('New Title')
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
