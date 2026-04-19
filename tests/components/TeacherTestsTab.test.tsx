import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TeacherTestsTab } from '@/app/classrooms/[classroomId]/TeacherTestsTab'
import { TooltipProvider } from '@/ui'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { createMockClassroom, createMockQuiz } from '../helpers/mocks'
import type { QuizWithStats } from '@/types'

const { setOpenMock } = vi.hoisted(() => ({
  setOpenMock: vi.fn(),
}))

vi.mock('@/components/layout', () => ({
  useRightSidebar: () => ({ setOpen: setOpenMock }),
}))

vi.mock('@/components/QuizModal', () => ({
  QuizModal: ({
    isOpen,
    onSuccess,
  }: {
    isOpen: boolean
    onSuccess: (quiz: QuizWithStats) => void
  }) =>
    isOpen ? (
      <button
        data-testid="mock-test-save"
        onClick={() =>
          onSuccess(
            createMockQuiz({
              id: 'created-test-id',
              title: 'Created Test',
              assessment_type: 'test',
            }) as QuizWithStats
          )
        }
      >
        Save Test
      </button>
    ) : null,
}))

vi.mock('@/components/QuizDetailPanel', () => ({
  QuizDetailPanel: ({
    quiz,
    testAuthoringView,
    testQuestionLayout,
    showPreviewButton,
    showResultsTab,
  }: {
    quiz: QuizWithStats
    testAuthoringView?: string
    testQuestionLayout?: string
    showPreviewButton?: boolean
    showResultsTab?: boolean
  }) => (
    <div
      data-testid="mock-test-detail"
      data-authoring-view={testAuthoringView}
      data-question-layout={testQuestionLayout}
      data-show-preview={String(showPreviewButton)}
      data-show-results={String(showResultsTab)}
    >
      Detail for {quiz.title}
    </div>
  ),
}))

function Wrapper({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}

function makeTest(overrides: Partial<QuizWithStats> = {}): QuizWithStats {
  const base = createMockQuiz({
    assessment_type: 'test',
    status: 'draft',
    ...overrides,
  })
  return {
    ...base,
    assessment_type: 'test',
    stats: { total_students: 10, responded: 5, questions_count: 3 },
    ...overrides,
  } as QuizWithStats
}

function listFetchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url]: [string]) =>
      typeof url === 'string' && url.includes('/api/teacher/tests') && url.includes('?classroom_id=')
  )
}

function makeResultsResponse(overrides?: {
  students?: Array<Record<string, unknown>>
  questions?: Array<Record<string, unknown>>
}) {
  return {
    ok: true,
    json: async () => ({
      quiz: { id: 'test-1', title: 'Unit Test', grading_finalized_at: null },
      questions:
        overrides?.questions ?? [
          {
            id: 'q1',
            question_type: 'open_response',
            response_monospace: false,
            points: 5,
          },
        ],
      students:
        overrides?.students ?? [
          {
            student_id: 'student-1',
            name: 'Alice Zephyr',
            first_name: 'Alice',
            last_name: 'Zephyr',
            email: 'alice@example.com',
            status: 'submitted',
            submitted_at: null,
            last_activity_at: '2026-04-17T18:15:00.000Z',
            points_earned: 3,
            points_possible: 5,
            percent: 60,
            graded_open_responses: 0,
            ungraded_open_responses: 1,
            focus_summary: {
              away_count: 1,
              away_total_seconds: 45,
              route_exit_attempts: 1,
              window_unmaximize_attempts: 0,
            },
          },
        ],
    }),
  }
}

describe('TeacherTestsTab', () => {
  const classroom = createMockClassroom()
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    setOpenMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mockTestsResponse(tests: QuizWithStats[] = []) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tests }),
    })
  }

  function renderTab(options?: {
    testsTabClickToken?: number
    onSelectTest?: (test: QuizWithStats | null) => void
    onTestGradingContextChange?: (context: {
      mode: 'authoring' | 'grading'
      testId: string | null
      studentId: string | null
      studentName: string | null
    }) => void
  }) {
    return render(
      <TeacherTestsTab
        classroom={classroom}
        testsTabClickToken={options?.testsTabClickToken}
        onSelectTest={options?.onSelectTest}
        onTestGradingContextChange={options?.onTestGradingContextChange}
      />,
      { wrapper: Wrapper }
    )
  }

  it('renders the tests list by default with no selected workspace', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    renderTab()

    expect(await screen.findByText('Unit Test')).toBeInTheDocument()
    expect(screen.getByText('New Test')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Authoring' })).not.toBeInTheDocument()
    expect(screen.queryByText('Choose a test to review settings, questions, and grading details.')).not.toBeInTheDocument()
    expect(listFetchCalls(fetchMock)[0][0]).toContain('/api/teacher/tests?classroom_id=')
  })

  it('opens a selected test in authoring mode when the card is clicked', async () => {
    const onSelectTest = vi.fn()

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    renderTab({ onSelectTest })

    fireEvent.click(await screen.findByText('Unit Test'))

    expect(await screen.findByTestId('mock-test-detail')).toHaveTextContent('Detail for Unit Test')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-authoring-view', 'questions')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-question-layout', 'summary-detail')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-show-preview', 'false')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-show-results', 'false')
    expect(screen.getByRole('button', { name: 'Authoring' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Grading' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to tests' })).not.toBeInTheDocument()
    expect(onSelectTest).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'test-1', title: 'Unit Test' })
    )
  })

  it('opens a newly created test directly into authoring mode', async () => {
    mockTestsResponse([])
    renderTab()

    expect(await screen.findByText('No tests yet')).toBeInTheDocument()

    mockTestsResponse([makeTest({ id: 'created-test-id', title: 'Created Test' })])

    fireEvent.click(screen.getByText('New Test'))
    fireEvent.click(screen.getByTestId('mock-test-save'))

    expect(await screen.findByTestId('mock-test-detail')).toHaveTextContent('Detail for Created Test')
    expect(screen.getByRole('button', { name: 'Authoring' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('returns to the tests list when the tests tab is clicked again', async () => {
    const onSelectTest = vi.fn()

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    const view = renderTab({ onSelectTest, testsTabClickToken: 0 })

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByTestId('mock-test-detail')).toBeInTheDocument()

    view.rerender(
      <TeacherTestsTab
        classroom={classroom}
        testsTabClickToken={1}
        onSelectTest={onSelectTest}
      />
    )

    await waitFor(() => {
      expect(screen.queryByTestId('mock-test-detail')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Unit Test')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Authoring' })).not.toBeInTheDocument()
    expect(setOpenMock).toHaveBeenCalledWith(false)
    expect(onSelectTest).toHaveBeenLastCalledWith(null)
  })

  it('shows grading in the main pane and only opens the inspector after row selection', async () => {
    const onTestGradingContextChange = vi.fn()

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())

    renderTab({ onTestGradingContextChange })

    fireEvent.click(await screen.findByText('Unit Test'))
    setOpenMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))

    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    expect(setOpenMock).not.toHaveBeenCalledWith(true)
    expect(onTestGradingContextChange).toHaveBeenLastCalledWith({
      mode: 'grading',
      testId: 'test-1',
      studentId: null,
      studentName: null,
    })

    fireEvent.click(screen.getByText('Alice Zephyr'))

    await waitFor(() => {
      expect(setOpenMock).toHaveBeenCalledWith(true)
    })
    expect(onTestGradingContextChange).toHaveBeenLastCalledWith({
      mode: 'grading',
      testId: 'test-1',
      studentId: 'student-1',
      studentName: 'Alice Zephyr',
    })
  })

  it('prompts to close an active test before return and sends close_test=true', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ returned_count: 1, skipped_count: 0, test_closed: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'closed' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select Alice Zephyr'))
    fireEvent.click(screen.getByRole('button', { name: 'Return' }))

    expect(
      await screen.findByText('This test is still open. Confirming will close it for all students before returning selected work.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close and Return' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/tests/test-1/return',
        expect.objectContaining({ method: 'POST' })
      )
    })

    const returnCall = fetchMock.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/tests/test-1/return'
    )
    expect(returnCall).toBeTruthy()
    expect(JSON.parse(returnCall?.[1]?.body as string)).toMatchObject({
      student_ids: ['student-1'],
      close_test: true,
    })
  })

  it('reloads the list once when the update event fires', async () => {
    mockTestsResponse([])
    renderTab()

    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(1)
    })

    mockTestsResponse([])

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, {
          detail: { classroomId: classroom.id },
        })
      )
    })

    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(2)
    })
  })
})
