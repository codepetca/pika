import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
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
    testQuestionLayout,
    showPreviewButton,
    showResultsTab,
    onPendingMarkdownImportChange,
  }: {
    quiz: QuizWithStats
    testQuestionLayout?: string
    showPreviewButton?: boolean
    showResultsTab?: boolean
    onPendingMarkdownImportChange?: (pending: boolean) => void
  }) => (
    <div
      data-testid="mock-test-detail"
      data-question-layout={testQuestionLayout}
      data-show-preview={String(showPreviewButton)}
      data-show-results={String(showResultsTab)}
    >
      Detail for {quiz.title}
      <button type="button" onClick={() => onPendingMarkdownImportChange?.(true)}>
        Mark pending markdown
      </button>
      <button type="button" onClick={() => onPendingMarkdownImportChange?.(false)}>
        Clear pending markdown
      </button>
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

function resultsFetchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url]: [string]) => typeof url === 'string' && url.includes('/api/teacher/tests/') && url.endsWith('/results')
  )
}

function makeResultsResponse(overrides?: {
  quizId?: string
  quizTitle?: string
  students?: Array<Record<string, unknown>>
  questions?: Array<Record<string, unknown>>
  quizStatus?: QuizWithStats['status']
  activeRun?: Record<string, unknown> | null
}) {
  return {
    ok: true,
    json: async () => ({
      quiz: {
        id: overrides?.quizId ?? 'test-1',
        title: overrides?.quizTitle ?? 'Unit Test',
        status: overrides?.quizStatus ?? 'active',
        grading_finalized_at: null,
      },
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
      active_ai_grading_run: overrides?.activeRun ?? null,
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
    vi.useRealTimers()
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
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-question-layout', 'summary-detail')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-show-preview', 'false')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-show-results', 'false')
    expect(screen.getByRole('button', { name: 'Authoring' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Grading' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Questions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Documents' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to tests' })).not.toBeInTheDocument()
    expect(onSelectTest).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'test-1', title: 'Unit Test' })
    )
  })

  it('disables preview and status actions while markdown edits are pending', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test', status: 'draft' })])
    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))

    expect(await screen.findByTestId('mock-test-detail')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Mark pending markdown' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled()
      expect(
        screen.getByText('Apply or undo markdown changes before previewing or changing the test status.')
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear pending markdown' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled()
    })
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

  it('validates and activates a draft test from authoring', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'draft' })] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          questions: [
            {
              id: 'q1',
              question_type: 'multiple_choice',
              question_text: 'Ready to activate?',
              options: ['Yes', 'No'],
              correct_option: 0,
              points: 1,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ test: { id: 'test-1', status: 'active' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByTestId('mock-test-detail')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(await screen.findByText('Activate test?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/tests/test-1', expect.objectContaining({ method: 'PATCH' }))
    })

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === '/api/teacher/tests/test-1' && init?.method === 'PATCH'
    )
    expect(patchCall).toBeTruthy()
    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toEqual({ status: 'active' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    })
  })

  it('confirms and closes an active test from authoring', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ test: { id: 'test-1', status: 'closed' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'closed' })] }),
      })

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByTestId('mock-test-detail')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Close test?')).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/tests/test-1', expect.objectContaining({ method: 'PATCH' }))
    })

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === '/api/teacher/tests/test-1' && init?.method === 'PATCH'
    )
    expect(patchCall).toBeTruthy()
    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toEqual({ status: 'closed' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
    })
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

  it('polls grading rows only while grading is visible and focused', async () => {
    let visibilityState: DocumentVisibilityState = 'visible'
    let hasFocus = true

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
    vi.spyOn(document, 'hasFocus').mockImplementation(() => hasFocus)
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((() => 1) as typeof window.setInterval)
    const clearIntervalSpy = vi
      .spyOn(window, 'clearInterval')
      .mockImplementation((() => undefined) as typeof window.clearInterval)

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValue(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))

    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    expect(resultsFetchCalls(fetchMock)).toHaveLength(1)
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15_000)

    hasFocus = false
    window.dispatchEvent(new Event('blur'))
    expect(clearIntervalSpy).toHaveBeenCalled()

    hasFocus = true
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(resultsFetchCalls(fetchMock)).toHaveLength(2)
    })

    visibilityState = 'hidden'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })

    expect(resultsFetchCalls(fetchMock)).toHaveLength(2)

    visibilityState = 'visible'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(resultsFetchCalls(fetchMock)).toHaveLength(3)
    })
  })

  it('does not start polling when the server reports the test is closed', async () => {
    let visibilityState: DocumentVisibilityState = 'visible'
    let hasFocus = true

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
    vi.spyOn(document, 'hasFocus').mockImplementation(() => hasFocus)
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((() => 1) as typeof window.setInterval)

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValue(makeResultsResponse({ quizStatus: 'closed' }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))

    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    expect(resultsFetchCalls(fetchMock)).toHaveLength(1)
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 15_000)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })

    expect(resultsFetchCalls(fetchMock)).toHaveLength(1)
  })

  it('starts polling when the server reports the test is active even if the list was stale', async () => {
    let visibilityState: DocumentVisibilityState = 'visible'
    let hasFocus = true

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
    vi.spyOn(document, 'hasFocus').mockImplementation(() => hasFocus)
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((() => 1) as typeof window.setInterval)

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'closed' })] }),
      })
      .mockResolvedValue(makeResultsResponse({ quizStatus: 'active' }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))

    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    expect(resultsFetchCalls(fetchMock)).toHaveLength(1)
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15_000)
  })

  it('ignores stale grading responses after switching to a different test', async () => {
    let resolveFirstResults:
      | ((value: { ok: boolean; json: () => Promise<any> }) => void)
      | null = null
    let resolveSecondResults:
      | ((value: { ok: boolean; json: () => Promise<any> }) => void)
      | null = null

    const firstResultsPromise = new Promise<{ ok: boolean; json: () => Promise<any> }>((resolve) => {
      resolveFirstResults = resolve
    })
    const secondResultsPromise = new Promise<{ ok: boolean; json: () => Promise<any> }>((resolve) => {
      resolveSecondResults = resolve
    })

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tests: [
            makeTest({ id: 'test-1', title: 'Unit Test A' }),
            makeTest({ id: 'test-2', title: 'Unit Test B' }),
          ],
        }),
      })
      .mockImplementationOnce(() => firstResultsPromise as unknown as Promise<Response>)
      .mockImplementationOnce(() => secondResultsPromise as unknown as Promise<Response>)

    const view = renderTab({ testsTabClickToken: 0 })

    fireEvent.click(await screen.findByText('Unit Test A'))
    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))

    view.rerender(
      <TeacherTestsTab
        classroom={classroom}
        testsTabClickToken={1}
      />
    )

    await waitFor(() => {
      expect(screen.queryByTestId('mock-test-detail')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Unit Test B'))
    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))

    await act(async () => {
      resolveSecondResults?.(
        makeResultsResponse({
          quizId: 'test-2',
          quizTitle: 'Unit Test B',
          students: [
            {
              student_id: 'student-2',
              name: 'Bob Yellow',
              first_name: 'Bob',
              last_name: 'Yellow',
              email: 'bob@example.com',
              status: 'submitted',
              submitted_at: null,
              last_activity_at: '2026-04-17T18:20:00.000Z',
              points_earned: 4,
              points_possible: 5,
              percent: 80,
              graded_open_responses: 1,
              ungraded_open_responses: 0,
              focus_summary: null,
            },
          ],
        })
      )
      await Promise.resolve()
    })

    expect(await screen.findByText('Bob Yellow')).toBeInTheDocument()

    await act(async () => {
      resolveFirstResults?.(
        makeResultsResponse({
          quizId: 'test-1',
          quizTitle: 'Unit Test A',
          students: [
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
              focus_summary: null,
            },
          ],
        })
      )
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('Bob Yellow')).toBeInTheDocument()
      expect(screen.queryByText('Alice Zephyr')).not.toBeInTheDocument()
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

  it('starts a background AI grading run, polls it, and refreshes rows on completion', async () => {
    const activeRun = {
      id: 'run-1',
      test_id: 'test-1',
      status: 'running',
      model: 'gpt-5-nano',
      prompt_guideline_override: null,
      requested_count: 1,
      eligible_student_count: 1,
      queued_response_count: 1,
      processed_count: 0,
      completed_count: 0,
      skipped_unanswered_count: 0,
      skipped_already_graded_count: 0,
      failed_count: 0,
      pending_count: 1,
      next_retry_at: null,
      error_samples: [],
      started_at: '2026-04-20T12:00:00.000Z',
      completed_at: null,
      created_at: '2026-04-20T12:00:00.000Z',
    }

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)

        if (url === `/api/teacher/tests?classroom_id=${classroom.id}`) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
          })
        }

        if (url === '/api/teacher/tests/test-1/results') {
          return Promise.resolve(makeResultsResponse({ activeRun: null }))
        }

        if (url === '/api/teacher/tests/test-1/auto-grade' && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 202,
            json: async () => ({
              mode: 'background',
              run: activeRun,
            }),
          })
        }

        if (url === '/api/teacher/tests/test-1/auto-grade-runs/run-1') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              run: activeRun,
            }),
          })
        }

        if (url === '/api/teacher/tests/test-1/auto-grade-runs/run-1/tick') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              claimed: true,
              run: {
                ...activeRun,
                status: 'completed',
                processed_count: 1,
                completed_count: 1,
                pending_count: 0,
                completed_at: '2026-04-20T12:01:00.000Z',
              },
            }),
          })
        }

        return Promise.resolve({
          ok: false,
          json: async () => ({ error: `Unhandled fetch: ${url}` }),
        })
      })

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select Alice Zephyr'))
    fireEvent.click(screen.getByRole('button', { name: 'AI Grade' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Grade with AI' }))

    await waitFor(() => {
      expect(screen.getByText('AI grading started')).toBeInTheDocument()
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('Graded 1')).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/teacher/tests/test-1/auto-grade-runs/run-1/tick',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('keeps the AI prompt modal but removes the grading strategy selector', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValue(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))
    await screen.findByText('Alice Zephyr')

    fireEvent.click(screen.getByRole('button', { name: 'AI Prompt' }))

    expect(await screen.findByRole('heading', { name: 'AI Prompt' })).toBeInTheDocument()
    expect(screen.getByText(/Pika automatically uses the coding rubric/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Grading strategy')).not.toBeInTheDocument()
    expect(screen.queryByText('Grading strategy')).not.toBeInTheDocument()
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
