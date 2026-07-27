import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { TeacherTestsTab } from '@/app/classrooms/[classroomId]/TeacherTestsTab'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { TEACHER_TESTS_UPDATED_EVENT, TEACHER_TEST_GRADING_ROW_UPDATED_EVENT } from '@/lib/events'
import { createMockClassroom, createMockTest } from '../helpers/mocks'
import { invalidateCachedJSON } from '@/lib/request-cache'
import type { Classroom, TestAssessmentWithStats } from '@/types'

const { setOpenMock } = vi.hoisted(() => ({
  setOpenMock: vi.fn(),
}))
const mockInvalidateGradebookForClassroom = vi.hoisted(() => vi.fn())

vi.mock('@/components/layout', () => ({
  useRightSidebar: () => ({ setOpen: setOpenMock }),
}))

vi.mock('@/lib/gradebook-cache', () => ({
  invalidateGradebookForClassroom: mockInvalidateGradebookForClassroom,
}))

vi.mock('@/components/TestDetailPanel', () => ({
  TestDetailPanel: ({
    test,
    testQuestionLayout,
    showPreviewButton,
    showResultsTab,
    onPendingMarkdownImportChange,
    onSaveStatusChange,
    onRequestTestPreview,
    onDraftSummaryChange,
    onTestUpdate,
    titlePortalTarget,
    generatedTitleLabel,
  }: {
    test?: TestAssessmentWithStats
    testQuestionLayout?: string
    showPreviewButton?: boolean
    showResultsTab?: boolean
    onPendingMarkdownImportChange?: (pending: boolean) => void
    onSaveStatusChange?: (status: 'saved' | 'saving' | 'unsaved') => void
    onRequestTestPreview?: (preview: { testId: string; title: string }) => void
    onDraftSummaryChange?: (update: {
      title: string
      show_results: boolean
      questions_count: number
    }) => void
    onTestUpdate?: (update?: {
      title: string
      show_results: boolean
      questions_count: number
    }) => void
    titlePortalTarget?: HTMLElement | null
    generatedTitleLabel?: string
  }) => {
    if (!test) throw new Error('Mock TestDetailPanel requires test')
    const [pendingMarkdown, setPendingMarkdown] = useState(false)
    const displayedTitle = /^Untitled(?:\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?)?$/.test(test.title)
      ? generatedTitleLabel || 'Untitled'
      : test.title

    return (
      <>
        {titlePortalTarget
          ? createPortal(
              <button type="button" aria-label="Edit test title">
                {displayedTitle}
              </button>,
              titlePortalTarget
            )
          : null}
        <div
          data-testid="mock-test-detail"
          data-question-layout={testQuestionLayout}
          data-show-preview={String(showPreviewButton)}
          data-show-results={String(showResultsTab)}
        >
          Detail for {test.title}
          {showPreviewButton ? (
            <button
              type="button"
              disabled={pendingMarkdown}
              onClick={() => onRequestTestPreview?.({ testId: test.id, title: test.title })}
            >
              Preview
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setPendingMarkdown(true)
              onPendingMarkdownImportChange?.(true)
            }}
          >
            Mark pending markdown
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingMarkdown(false)
              onPendingMarkdownImportChange?.(false)
            }}
          >
            Clear pending markdown
          </button>
          <button type="button" onClick={() => onSaveStatusChange?.('unsaved')}>
            Mark editor unsaved
          </button>
          <button type="button" onClick={() => onSaveStatusChange?.('saved')}>
            Mark editor saved
          </button>
          <button
            type="button"
            onClick={() =>
              onDraftSummaryChange?.({
                title: `${test.title} Draft`,
                show_results: false,
                questions_count: 0,
              })
            }
          >
            Simulate draft change
          </button>
          <button
            type="button"
            onClick={() =>
              onTestUpdate?.({
                title: `${test.title} Updated`,
                show_results: false,
                questions_count: 0,
              })
            }
          >
            Simulate autosave update
          </button>
        </div>
      </>
    )
  },
}))

vi.mock('@/components/TestStudentGradingPanel', () => ({
  TestStudentGradingPanel: ({
    testId,
    selectedStudentId,
    onSaveStateChange,
  }: {
    testId: string
    selectedStudentId: string | null
    onSaveStateChange?: (state: {
      canSave: boolean
      isSaving: boolean
      status: 'idle' | 'unsaved' | 'saving' | 'saved'
    }) => void
  }) => {
    useEffect(() => {
      onSaveStateChange?.({ canSave: false, isSaving: false, status: 'saved' })
    }, [onSaveStateChange])

    return (
      <div data-testid="mock-test-grading-panel">
        Grading panel for {testId}:{selectedStudentId || 'none'}
      </div>
    )
  },
}))

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AppMessageProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </AppMessageProvider>
  )
}

function makeTest(overrides: Partial<TestAssessmentWithStats> = {}): TestAssessmentWithStats {
  const base = createMockTest({
    assessment_type: 'test',
    status: 'draft',
    ...overrides,
  })
  return {
    ...base,
    assessment_type: 'test',
    stats: { total_students: 10, responded: 5, questions_count: 3 },
    ...overrides,
  } as TestAssessmentWithStats
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

function makeGradingStudent(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

function makeResultsResponse(overrides?: {
  testId?: string
  testTitle?: string
  students?: Array<Record<string, unknown>>
  questions?: Array<Record<string, unknown>>
  testStatus?: TestAssessmentWithStats['status']
  activeRun?: Record<string, unknown> | null
}) {
  const testSummary = {
    id: overrides?.testId ?? 'test-1',
    title: overrides?.testTitle ?? 'Unit Test',
    status: overrides?.testStatus ?? 'active',
    grading_finalized_at: null,
  }

  return {
    ok: true,
    json: async () => ({
      test: testSummary,
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
        overrides?.students ?? [makeGradingStudent()],
      active_ai_grading_run: overrides?.activeRun ?? null,
    }),
  }
}

describe('TeacherTestsTab', () => {
  const classroom = createMockClassroom()
  const secondClassroom = createMockClassroom({ id: 'classroom-2', title: 'Second Classroom' })
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    invalidateCachedJSON(`teacher-tests:${classroom.id}`)
    invalidateCachedJSON(`teacher-tests:${secondClassroom.id}`)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    setOpenMock.mockReset()
    mockInvalidateGradebookForClassroom.mockClear()
  })

  afterEach(() => {
    invalidateCachedJSON(`teacher-tests:${classroom.id}`)
    invalidateCachedJSON(`teacher-tests:${secondClassroom.id}`)
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mockTestsResponse(tests: TestAssessmentWithStats[] = []) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tests }),
    })
  }

  it('shows a retryable error instead of an empty state when the tests list fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Database unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Still unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Recovered Test' })] }),
      })

    renderTab()

    expect(await screen.findByText('Tests unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No tests yet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('region', { name: 'Tests' })).toHaveFocus()

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Recovered Test')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Tests' })).toHaveFocus()
    expect(screen.queryByText('Tests unavailable')).not.toBeInTheDocument()
  })

  it('keeps the current list visible when a background refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Current Test' })] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Refresh failed' }),
      })

    renderTab()

    expect(await screen.findByText('Current Test')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_TESTS_UPDATED_EVENT, { detail: { classroomId: classroom.id } }),
      )
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tests could not be refreshed. Showing the last loaded list.',
    )
    expect(screen.getByText('Current Test')).toBeInTheDocument()
    expect(screen.queryByText('No tests yet')).not.toBeInTheDocument()
  })

  function renderTab(options?: {
    classroom?: Classroom
    testsTabClickToken?: number
    selectedTestId?: string | null
    selectedTestMode?: 'authoring' | 'grading' | null
    selectedTestStudentId?: string | null
    updateSearchParams?: (
      updater: (params: URLSearchParams) => void,
      options?: { replace?: boolean },
    ) => void
    onSelectTest?: (test: TestAssessmentWithStats | null) => void
    onRequestTestPreview?: (preview: { testId: string; title: string }) => void
    onRequestDelete?: () => void
    onTestGradingContextChange?: (context: {
      mode: 'authoring' | 'grading'
      testId: string | null
      studentId: string | null
      studentName: string | null
    }) => void
  }) {
    return render(
      <TeacherTestsTab
        classroom={options?.classroom ?? classroom}
        testsTabClickToken={options?.testsTabClickToken}
        selectedTestId={options?.selectedTestId}
        selectedTestMode={options?.selectedTestMode}
        selectedTestStudentId={options?.selectedTestStudentId}
        updateSearchParams={options?.updateSearchParams}
        onSelectTest={options?.onSelectTest}
        onRequestTestPreview={options?.onRequestTestPreview}
        onRequestDelete={options?.onRequestDelete}
        onTestGradingContextChange={options?.onTestGradingContextChange}
      />,
      { wrapper: Wrapper }
    )
  }

  async function openEditModalFromSelectedTest(title = 'Unit Test') {
    fireEvent.click(await screen.findByText(title))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Test' }))
    return screen.findByTestId('mock-test-detail')
  }

  function toggleTestListControls() {
    fireEvent.click(screen.getByRole('button', { name: 'Organize tests' }))
  }

  it('renders the tests list by default with no selected workspace', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    renderTab()

    expect(await screen.findByText('Unit Test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New test' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Organize tests' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Authoring' })).not.toBeInTheDocument()
    expect(screen.queryByText('Choose a test to review settings, questions, and grading details.')).not.toBeInTheDocument()
    expect(listFetchCalls(fetchMock)[0][0]).toContain('/api/teacher/tests?classroom_id=')
  })

  it('ignores late tests-list responses after switching classrooms', async () => {
    type PendingFetch = {
      url: string
      resolve: (value: { ok: boolean; json: () => Promise<{ tests: TestAssessmentWithStats[] }> }) => void
    }
    const pending: PendingFetch[] = []

    fetchMock.mockImplementation((url: string) => (
      new Promise((resolve) => {
        pending.push({ url, resolve: resolve as PendingFetch['resolve'] })
      })
    ))

    function resolveTests(classroomId: string, tests: TestAssessmentWithStats[]) {
      const request = pending.find((item) => item.url === `/api/teacher/tests?classroom_id=${classroomId}`)
      expect(request).toBeTruthy()
      request?.resolve({
        ok: true,
        json: async () => ({ tests }),
      })
    }

    const view = renderTab({ classroom })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`/api/teacher/tests?classroom_id=${classroom.id}`, undefined)
    })

    view.rerender(
      <TeacherTestsTab
        classroom={secondClassroom}
      />,
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`/api/teacher/tests?classroom_id=${secondClassroom.id}`, undefined)
    })

    await act(async () => {
      resolveTests(secondClassroom.id, [makeTest({ id: 'test-b', classroom_id: secondClassroom.id, title: 'Class B Test' })])
      await Promise.resolve()
    })

    expect(await screen.findByText('Class B Test')).toBeInTheDocument()

    await act(async () => {
      resolveTests(classroom.id, [makeTest({ id: 'test-a', classroom_id: classroom.id, title: 'Class A Test' })])
      await Promise.resolve()
    })

    expect(screen.queryByText('Class A Test')).not.toBeInTheDocument()
    expect(screen.getByText('Class B Test')).toBeInTheDocument()
  })

  it('clears pending test delete confirmation after switching classrooms', async () => {
    mockTestsResponse([makeTest({ id: 'test-a', classroom_id: classroom.id, title: 'Class A Test' })])
    const view = renderTab({ classroom })

    expect(await screen.findByText('Class A Test')).toBeInTheDocument()

    toggleTestListControls()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Class A Test' }))
    expect(await screen.findByText('Delete test?')).toBeInTheDocument()

    mockTestsResponse([makeTest({ id: 'test-b', classroom_id: secondClassroom.id, title: 'Class B Test' })])
    view.rerender(
      <TeacherTestsTab
        classroom={secondClassroom}
      />,
    )

    await waitFor(() => {
      expect(screen.queryByText('Delete test?')).not.toBeInTheDocument()
    })
    expect(await screen.findByText('Class B Test')).toBeInTheDocument()
  })

  it('closes the edit dialog after switching classrooms', async () => {
    mockTestsResponse([makeTest({ id: 'test-a', classroom_id: classroom.id, title: 'Class A Test' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse({ testId: 'test-a', testTitle: 'Class A Test' }))
    const view = renderTab({ classroom })

    fireEvent.click(await screen.findByText('Class A Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Test' }))
    expect(await screen.findByTestId('mock-test-detail')).toHaveTextContent('Detail for Class A Test')

    mockTestsResponse([makeTest({ id: 'test-b', classroom_id: secondClassroom.id, title: 'Class B Test' })])
    view.rerender(
      <TeacherTestsTab
        classroom={secondClassroom}
      />,
    )

    await waitFor(() => {
      expect(screen.queryByTestId('mock-test-detail')).not.toBeInTheDocument()
    })
    expect(await screen.findByText('Class B Test')).toBeInTheDocument()
  })

  it('ignores a late create-test response after switching classrooms', async () => {
    type PendingCreate = {
      resolve: (value: { ok: boolean; json: () => Promise<{ test: TestAssessmentWithStats }> }) => void
    }
    let pendingCreate: PendingCreate | null = null

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/teacher/tests' && init?.method === 'POST') {
        return new Promise((resolve) => {
          pendingCreate = { resolve: resolve as PendingCreate['resolve'] }
        })
      }
      if (url === `/api/teacher/tests?classroom_id=${secondClassroom.id}`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tests: [makeTest({ id: 'test-b', classroom_id: secondClassroom.id, title: 'Class B Test' })],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ tests: [] }),
      })
    })

    const view = renderTab({ classroom })

    expect(await screen.findByRole('button', { name: 'New test' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New test' }))

    await waitFor(() => {
      expect(pendingCreate).toBeTruthy()
    })

    view.rerender(
      <TeacherTestsTab
        classroom={secondClassroom}
      />,
    )

    expect(await screen.findByText('Class B Test')).toBeInTheDocument()

    await act(async () => {
      pendingCreate?.resolve({
        ok: true,
        json: async () => ({
          test: makeTest({ id: 'test-a-created', classroom_id: classroom.id, title: 'Created In Class A' }),
        }),
      })
      await Promise.resolve()
    })

    expect(screen.queryByText('Created In Class A')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mock-test-detail')).not.toBeInTheDocument()
    expect(screen.getByText('Class B Test')).toBeInTheDocument()
  })

  it('does not let an old create request clear the current classroom create state', async () => {
    type PendingCreate = {
      classroomId: string
      resolve: (value: { ok: boolean; json: () => Promise<{ test: TestAssessmentWithStats }> }) => void
    }
    const pendingCreates: PendingCreate[] = []

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/teacher/tests' && init?.method === 'POST') {
        const classroomId = JSON.parse(init.body as string).classroom_id as string
        return new Promise((resolve) => {
          pendingCreates.push({ classroomId, resolve: resolve as PendingCreate['resolve'] })
        })
      }
      if (url === `/api/teacher/tests?classroom_id=${secondClassroom.id}`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tests: [makeTest({ id: 'test-b', classroom_id: secondClassroom.id, title: 'Class B Test' })],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ tests: [] }),
      })
    })

    const view = renderTab({ classroom })

    expect(await screen.findByRole('button', { name: 'New test' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New test' }))

    await waitFor(() => {
      expect(pendingCreates.some((request) => request.classroomId === classroom.id)).toBe(true)
    })

    view.rerender(
      <TeacherTestsTab
        classroom={secondClassroom}
      />,
    )

    expect(await screen.findByText('Class B Test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New test' }))

    await waitFor(() => {
      expect(pendingCreates.some((request) => request.classroomId === secondClassroom.id)).toBe(true)
    })

    const newTestButton = screen.getByRole('button', { name: 'New test' })
    expect(newTestButton).toBeDisabled()

    const oldRequest = pendingCreates.find((request) => request.classroomId === classroom.id)
    await act(async () => {
      oldRequest?.resolve({
        ok: true,
        json: async () => ({
          test: makeTest({ id: 'test-a-created', classroom_id: classroom.id, title: 'Created In Class A' }),
        }),
      })
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'New test' })).toBeDisabled()
    expect(screen.queryByText('Created In Class A')).not.toBeInTheDocument()
    expect(screen.getByText('Class B Test')).toBeInTheDocument()
  })

  it('disables test create and options actions for archived classrooms', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    renderTab({
      classroom: {
        ...classroom,
        archived_at: '2026-06-01T12:00:00Z',
      },
    })

    expect(await screen.findByText('Unit Test')).toBeInTheDocument()

    const newTest = screen.getByRole('button', { name: 'New test' })
    const organizeTests = screen.getByRole('button', { name: 'Organize tests' })

    expect(newTest).toBeDisabled()
    expect(organizeTests).toBeDisabled()

    fireEvent.click(organizeTests)
    expect(screen.queryByRole('button', { name: 'Drag to reorder Unit Test' })).not.toBeInTheDocument()
  })

  it('opens a selected test in grading mode and edits in a modal', async () => {
    const onSelectTest = vi.fn()

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse())
    renderTab({ onSelectTest })

    await openEditModalFromSelectedTest()
    expect(screen.queryByRole('button', { name: 'Authoring' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Grading' })).not.toBeInTheDocument()

    expect(await screen.findByTestId('mock-test-detail')).toHaveTextContent('Detail for Unit Test')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-question-layout', 'editor-only')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-show-preview', 'false')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-show-results', 'false')
    const dialog = screen.getByRole('dialog')
    const codeToggle = within(dialog).getByRole('button', { name: 'Code' })
    expect(codeToggle).toHaveAttribute('aria-pressed', 'false')
    expect(within(dialog).queryByRole('button', { name: 'Markdown' })).not.toBeInTheDocument()
    fireEvent.click(codeToggle)
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-question-layout', 'markdown-only')
    expect(codeToggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(codeToggle)
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-question-layout', 'editor-only')
    expect(codeToggle).toHaveAttribute('aria-pressed', 'false')
    expect(onSelectTest).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'test-1', title: 'Unit Test' })
    )
  })

  it('opens the edit modal from the selected test edit button', async () => {
    const updateSearchParams = vi.fn((updater: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams('tab=tests')
      updater(params)
    })

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse())
    renderTab({ updateSearchParams })

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    const editTestButton = screen.getByRole('button', { name: 'Edit Test' })
    expect(editTestButton).toBeEnabled()
    expect(within(editTestButton).getByText('Edit Test')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Manage Attempts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Edit Test' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete Test' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: /Delete Selected/ })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })

    editTestButton.focus()
    fireEvent.click(editTestButton)

    expect(await screen.findByTestId('mock-test-detail')).toHaveTextContent('Detail for Unit Test')
    expect(screen.getByRole('dialog', { name: 'Edit test' })).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText('Edit test')).toBeVisible()
    expect(updateSearchParams).toHaveBeenCalledTimes(2)
    const params = new URLSearchParams('tab=tests&testId=test-1&testMode=grading&testStudentId=student-1')
    updateSearchParams.mock.calls[1][0](params)
    expect(params.get('testId')).toBe('test-1')
    expect(params.get('testMode')).toBe('authoring')
    expect(params.get('testStudentId')).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-question-layout', 'editor-only')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Code' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(editTestButton).toHaveFocus()
    })
  })

  it('closes the edit modal when controlled params return from authoring to grading', async () => {
    const updateSearchParams = vi.fn()

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse())

    const view = renderTab({
      selectedTestId: 'test-1',
      selectedTestMode: 'grading',
      updateSearchParams,
    })

    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Test' }))
    expect(await screen.findByTestId('mock-test-detail')).toBeInTheDocument()

    view.rerender(
      <TeacherTestsTab
        classroom={classroom}
        selectedTestId="test-1"
        selectedTestMode="authoring"
        updateSearchParams={updateSearchParams}
      />
    )
    expect(screen.getByTestId('mock-test-detail')).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(makeResultsResponse())
    view.rerender(
      <TeacherTestsTab
        classroom={classroom}
        selectedTestId="test-1"
        selectedTestMode="grading"
        updateSearchParams={updateSearchParams}
      />
    )

    await waitFor(() => {
      expect(screen.queryByTestId('mock-test-detail')).not.toBeInTheDocument()
    })
  })

  it('requests selected test deletion from the selected test actions menu', async () => {
    const onRequestDelete = vi.fn()

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse())
    renderTab({ onRequestDelete })

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Test' }))

    expect(onRequestDelete).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Delete test?')).not.toBeInTheDocument()
  })

  it('disables status actions while markdown edits are pending in the edit modal', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test', status: 'draft' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse({ testStatus: 'draft' }))
    renderTab()

    await openEditModalFromSelectedTest()
    expect(screen.getByLabelText('Open All')).toBeEnabled()

    expect(await screen.findByTestId('mock-test-detail')).toHaveTextContent('Detail for Unit Test')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-question-layout', 'editor-only')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-show-preview', 'false')
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-show-results', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Mark pending markdown' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Open All')).toBeDisabled()
      expect(
        screen.getByText('Apply or undo markdown changes before previewing or changing the test status.')
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Clear pending markdown' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Open All')).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mark editor unsaved' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mark editor saved' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
    })
  })

  it('delegates preview from the test edit modal', async () => {
    const onRequestTestPreview = vi.fn()
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test', status: 'draft' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse({ testStatus: 'draft' }))
    renderTab({ onRequestTestPreview })

    await openEditModalFromSelectedTest()
    expect(await screen.findByTestId('mock-test-detail')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mark editor unsaved' }))
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(onRequestTestPreview).toHaveBeenCalledWith({
        testId: 'test-1',
        title: 'Unit Test',
      })
    })
  })

  it('updates the selected test header and activation state immediately from modal draft changes', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test', status: 'draft' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse({ testStatus: 'draft' }))
    const onSelectTest = vi.fn()
    renderTab({ onSelectTest })

    await openEditModalFromSelectedTest()
    expect(screen.getByLabelText('Open All')).toBeEnabled()

    expect(await screen.findByTestId('mock-test-detail')).toHaveTextContent('Detail for Unit Test')
    expect(listFetchCalls(fetchMock)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Simulate draft change' }))

    await waitFor(() => {
      expect(onSelectTest).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Unit Test Draft' }))
      expect(screen.getByLabelText('Open All')).toBeDisabled()
    })

    expect(screen.getByTestId('mock-test-detail')).toBeInTheDocument()
    expect(listFetchCalls(fetchMock)).toHaveLength(1)
  })

  it('keeps the selected workspace mounted and updates saved test metadata after autosave', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test', status: 'draft' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse({ testStatus: 'draft' }))
    const onSelectTest = vi.fn()
    renderTab({ onSelectTest })

    await openEditModalFromSelectedTest()
    expect(screen.getByLabelText('Open All')).toBeEnabled()

    expect(await screen.findByTestId('mock-test-detail')).toHaveTextContent('Detail for Unit Test')
    expect(listFetchCalls(fetchMock)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Simulate autosave update' }))

    await waitFor(() => {
      expect(screen.getByTestId('mock-test-detail')).toHaveTextContent('Detail for Unit Test Updated')
      expect(onSelectTest).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Unit Test Updated' }))
      expect(screen.getByLabelText('Open All')).toBeDisabled()
    })

    expect(screen.getByTestId('mock-test-detail')).toBeInTheDocument()
    expect(listFetchCalls(fetchMock)).toHaveLength(1)
  })

  it('creates a draft test directly and opens visual editing', async () => {
    mockTestsResponse([])
    renderTab()

    expect(await screen.findByText('No tests yet')).toBeInTheDocument()

    const createdTest = makeTest({ id: 'created-test-id', title: 'Untitled 2026-05-14 10:45:00' })
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/teacher/tests' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ test: createdTest }),
        })
      }
      if (typeof url === 'string' && url.includes('/api/teacher/tests?classroom_id=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ tests: [createdTest] }),
        })
      }
      if (url === '/api/teacher/tests/created-test-id/results') {
        return Promise.resolve(makeResultsResponse({
          testId: 'created-test-id',
          testTitle: 'Untitled 2026-05-14 10:45:00',
          testStatus: 'draft',
          students: [],
        }))
      }
      return Promise.reject(new Error(`Unexpected fetch ${String(url)}`))
    })

    fireEvent.click(screen.getByRole('button', { name: 'New test' }))

    expect(await screen.findByTestId('mock-test-detail')).toHaveTextContent('Detail for Untitled 2026-05-14 10:45:00')
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Edit test title' })).toHaveTextContent('Untitled Test')
    expect(within(dialog).queryByRole('heading', { name: 'Test' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/tests', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ classroom_id: classroom.id }),
    }))
    expect(screen.getByTestId('mock-test-detail')).toHaveAttribute('data-question-layout', 'editor-only')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Code' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Authoring' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('updates the tests list from edit modal draft title changes', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test', status: 'draft' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse({ testStatus: 'draft' }))
    const view = renderTab({ testsTabClickToken: 0 })

    expect(await openEditModalFromSelectedTest()).toHaveTextContent('Detail for Unit Test')

    fireEvent.click(screen.getByRole('button', { name: 'Simulate draft change' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))

    view.rerender(
      <TeacherTestsTab
        classroom={classroom}
        testsTabClickToken={1}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Unit Test Draft')).toBeInTheDocument()
    })
    expect(screen.queryByText('Unit Test')).not.toBeInTheDocument()
  })

  it('validates and activates a draft test from the selected test split button', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'draft' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse({ testStatus: 'draft' }))
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

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open All' }))

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
      expect(screen.getByRole('button', { name: 'Close All' })).toBeInTheDocument()
    })
    expect(listFetchCalls(fetchMock)).toHaveLength(1)
  })

  it('confirms and opens access for all students from the selected test split button', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        testStatus: 'active',
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
            access_state: 'closed',
            effective_access: 'closed',
            access_source: 'student',
            focus_summary: null,
          },
        ],
      }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ updated_count: 1, skipped_count: 0, state: 'open' }),
      })
      .mockResolvedValueOnce(makeResultsResponse({ testStatus: 'active' }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open All' }))
    expect(await screen.findByText('Open access for 1 student(s)?')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/tests/test-1/student-access'
      )
    ).toBe(false)

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Open Access' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/tests/test-1/student-access',
        expect.objectContaining({ method: 'POST' })
      )
    })

    const accessCall = fetchMock.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/tests/test-1/student-access'
    )
    expect(accessCall).toBeTruthy()
    expect(JSON.parse(accessCall?.[1]?.body as string)).toMatchObject({
      student_ids: ['student-1'],
      state: 'open',
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close All' })).toBeInTheDocument()
    })
    expect(listFetchCalls(fetchMock)).toHaveLength(1)
  })

  it('confirms and closes access for all students from the selected test split button', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse({ testStatus: 'active' }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ updated_count: 1, skipped_count: 0, state: 'closed' }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        testStatus: 'active',
        students: [
          {
            student_id: 'student-1',
            name: 'Alice Zephyr',
            first_name: 'Alice',
            last_name: 'Zephyr',
            email: 'alice@example.com',
            status: 'in_progress',
            submitted_at: null,
            last_activity_at: '2026-04-17T18:15:00.000Z',
            points_earned: 0,
            points_possible: 5,
            percent: null,
            graded_open_responses: 0,
            ungraded_open_responses: 0,
            access_state: 'closed',
            effective_access: 'closed',
            access_source: 'student',
            focus_summary: null,
          },
          {
            student_id: 'student-2',
            name: 'Bob Yellow',
            first_name: 'Bob',
            last_name: 'Yellow',
            email: 'bob@example.com',
            status: 'in_progress',
            submitted_at: null,
            last_activity_at: '2026-04-17T18:10:00.000Z',
            points_earned: 0,
            points_possible: 5,
            percent: null,
            graded_open_responses: 0,
            ungraded_open_responses: 0,
            access_state: 'closed',
            effective_access: 'closed',
            access_source: 'student',
            focus_summary: null,
          },
        ],
      }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close All' }))
    expect(await screen.findByText('Close access for 1 student(s)?')).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close Access' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/tests/test-1/student-access',
        expect.objectContaining({ method: 'POST' })
      )
    })

    const accessCall = fetchMock.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/tests/test-1/student-access'
    )
    expect(accessCall).toBeTruthy()
    expect(JSON.parse(accessCall?.[1]?.body as string)).toMatchObject({
      student_ids: ['student-1'],
      state: 'closed',
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open All' })).toBeInTheDocument()
    })
    expect(listFetchCalls(fetchMock)).toHaveLength(1)
  })

  it('shows test-card preview and access/submission counts without card status actions', async () => {
    const onRequestTestPreview = vi.fn()
    mockTestsResponse([
      makeTest({
        id: 'test-1',
        title: 'Unit Test',
        status: 'active',
        stats: {
          total_students: 2,
          responded: 2,
          submitted: 1,
          open_access: 1,
          closed_access: 1,
          questions_count: 3,
        },
      }),
    ])

    renderTab({ onRequestTestPreview })

    expect(await screen.findByText('Unit Test')).toBeInTheDocument()
    expect(screen.getByText('1/2 submitted')).toBeInTheDocument()
    expect(screen.getByLabelText('1 open')).toBeInTheDocument()
    expect(screen.getByLabelText('1 closed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open test' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close test' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reopen test' })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Preview Unit Test' })).toHaveTextContent('Preview')
    fireEvent.click(screen.getByRole('button', { name: 'Preview Unit Test' }))

    expect(onRequestTestPreview).toHaveBeenCalledWith({
      testId: 'test-1',
      title: 'Unit Test',
    })
    expect(listFetchCalls(fetchMock)).toHaveLength(1)
  })

  it('shows a closed badge when an active test is closed for all students', async () => {
    mockTestsResponse([
      makeTest({
        id: 'test-1',
        title: 'Unit Test',
        status: 'active',
        stats: {
          total_students: 2,
          responded: 1,
          submitted: 1,
          open_access: 0,
          closed_access: 2,
          questions_count: 3,
        },
      }),
    ])

    renderTab()

    expect(await screen.findByText('Unit Test')).toBeInTheDocument()
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.queryByText('Open')).not.toBeInTheDocument()
  })

  it('shows card reorder controls from the list actions menu and resets reorder mode when tests is revisited', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    const view = renderTab({ testsTabClickToken: 0 })

    expect(await screen.findByText('Unit Test')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drag to reorder Unit Test' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Unit Test' })).not.toBeInTheDocument()
    toggleTestListControls()

    expect(screen.getByRole('button', { name: 'Drag to reorder Unit Test' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Unit Test' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Organize tests' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Organize tests' }))
    expect(screen.queryByRole('button', { name: 'Drag to reorder Unit Test' })).not.toBeInTheDocument()

    toggleTestListControls()
    view.rerender(
      <TeacherTestsTab
        classroom={classroom}
        testsTabClickToken={1}
      />
    )

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Drag to reorder Unit Test' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Drag to reorder Unit Test' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Unit Test' })).not.toBeInTheDocument()
  })

  it('shows whole-test delete in list settings mode', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    renderTab()

    expect(await screen.findByText('Unit Test')).toBeInTheDocument()
    toggleTestListControls()

    expect(screen.getByRole('button', { name: 'Drag to reorder Unit Test' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Unit Test' })).toBeInTheDocument()
  })

  it('deletes a test from the list settings card action with confirmation', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    renderTab()

    expect(await screen.findByText('Unit Test')).toBeInTheDocument()

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, responses_count: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [] }),
      })

    toggleTestListControls()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Unit Test' }))
    expect(await screen.findByText('Delete test?')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/tests/test-1', expect.objectContaining({ method: 'DELETE' }))
    })
    await waitFor(() => {
      expect(screen.queryByText('Unit Test')).not.toBeInTheDocument()
    })
  })

  it('returns to the tests list when the tests tab is clicked again', async () => {
    const onSelectTest = vi.fn()

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse())
    const view = renderTab({ onSelectTest, testsTabClickToken: 0 })

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    view.rerender(
      <TeacherTestsTab
        classroom={classroom}
        testsTabClickToken={1}
        onSelectTest={onSelectTest}
      />
    )

    await waitFor(() => {
      expect(screen.queryByText('Alice Zephyr')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Unit Test')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Authoring' })).not.toBeInTheDocument()
    expect(onSelectTest).toHaveBeenLastCalledWith(null)
  })

  it('shows grading in the main pane and only renders the inspector after row selection', async () => {
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

    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-test-grading-panel')).not.toBeInTheDocument()
    expect(setOpenMock).not.toHaveBeenCalledWith(true)
    expect(onTestGradingContextChange).toHaveBeenLastCalledWith({
      mode: 'grading',
      testId: 'test-1',
      studentId: null,
      studentName: null,
    })

    fireEvent.click(screen.getByText('Alice Zephyr'))

    await waitFor(() => {
      expect(screen.getByTestId('mock-test-grading-panel')).toHaveTextContent('Grading panel for test-1:student-1')
    })
    expect(setOpenMock).not.toHaveBeenCalledWith(true)
    expect(onTestGradingContextChange).toHaveBeenLastCalledWith({
      mode: 'grading',
      testId: 'test-1',
      studentId: 'student-1',
      studentName: 'Alice Zephyr',
    })
  })

  it('invalidates gradebook caches when test grading rows update', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_TEST_GRADING_ROW_UPDATED_EVENT, {
          detail: {
            testId: 'test-1',
            studentId: 'student-1',
            pointsEarned: 4,
            pointsPossible: 5,
            percent: 80,
            gradedOpenResponses: 1,
            ungradedOpenResponses: 0,
          },
        })
      )
    })

    expect(mockInvalidateGradebookForClassroom).toHaveBeenCalledWith(classroom.id)
  })

  it('moves the selected grading student with up and down arrows', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        students: [
          makeGradingStudent(),
          makeGradingStudent({
            student_id: 'student-2',
            name: 'Bob Zulu',
            first_name: 'Bob',
            last_name: 'Zulu',
            email: 'bob@example.com',
            points_earned: 4,
            percent: 80,
          }),
        ],
      }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    fireEvent.click(await screen.findByText('Alice Zephyr'))

    await waitFor(() => {
      expect(screen.getByTestId('mock-test-grading-panel')).toHaveTextContent('Grading panel for test-1:student-1')
    })

    const studentScrollPane = screen.getByTestId('test-grading-student-scroll-pane')
    fireEvent.keyDown(studentScrollPane, { key: 'ArrowDown' })

    await waitFor(() => {
      expect(screen.getByTestId('mock-test-grading-panel')).toHaveTextContent('Grading panel for test-1:student-2')
    })

    fireEvent.keyDown(studentScrollPane, { key: 'ArrowUp' })

    await waitFor(() => {
      expect(screen.getByTestId('mock-test-grading-panel')).toHaveTextContent('Grading panel for test-1:student-1')
    })
  })

  it('uses independent scroll containers for the selected test grading panes', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))

    const studentScrollPane = await screen.findByTestId('test-grading-student-scroll-pane')
    expect(studentScrollPane).toHaveClass('flex-1')
    expect(studentScrollPane).toHaveClass('overflow-auto')

    fireEvent.click(screen.getByText('Alice Zephyr'))

    const inspectorScrollPane = await screen.findByTestId('test-grading-inspector-scroll-pane')
    expect(inspectorScrollPane).toHaveClass('h-full')
    expect(inspectorScrollPane).toHaveClass('min-h-0')
    expect(inspectorScrollPane).toHaveClass('min-w-0')
    expect(inspectorScrollPane).toHaveClass('flex-1')
    expect(inspectorScrollPane).toHaveClass('overflow-x-hidden')
    expect(inspectorScrollPane).toHaveClass('overflow-y-auto')
    expect(within(inspectorScrollPane).getByTestId('mock-test-grading-panel')).toBeInTheDocument()
  })

  it('keeps the grading student table constrained on mobile widths', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))

    const studentScrollPane = await screen.findByTestId('test-grading-student-scroll-pane')
    expect(screen.getByRole('region', { name: 'Test grading students' })).toHaveAttribute(
      'aria-keyshortcuts',
      'ArrowUp ArrowDown Home End Escape',
    )
    const table = within(studentScrollPane).getByRole('table')
    expect(table).toHaveClass('table-fixed')
    expect(table).toHaveClass('lg:table-auto')

    const row = screen.getByTestId('test-grading-student-row-student-1')
    expect(within(row).getByText('Alice Zephyr').closest('td')).toHaveClass('max-w-0')
    expect(within(row).getByLabelText(/Exits \d+\./).closest('td')).toHaveClass('hidden')
    expect(within(row).getByLabelText(/Away time/).closest('td')).toHaveClass('hidden')

    expect(screen.getByText('Last', { selector: 'span.cursor-help' }).closest('th')).toHaveClass('hidden')
    expect(screen.getByLabelText('Exits column').closest('th')).toHaveClass('lg:table-cell')
    expect(screen.getByLabelText('Away column').closest('th')).toHaveClass('lg:table-cell')
  })

  it('clears the selected grading row with Escape', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    fireEvent.click(await screen.findByText('Alice Zephyr'))

    await waitFor(() => {
      expect(screen.getByTestId('mock-test-grading-panel')).toBeInTheDocument()
    })
    const selectedRow = screen.getByTestId('test-grading-student-row-student-1')
    expect(selectedRow).toHaveAttribute('id', 'test-grading-student-row-student-1')
    expect(selectedRow).toHaveAttribute('tabindex', '-1')
    expect(selectedRow).toHaveAttribute(
      'aria-selected',
      'true',
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByTestId('mock-test-grading-panel')).not.toBeInTheDocument()
    })
  })

  it('clears batch selection and the active grading student with Escape from the student table', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    fireEvent.click(await screen.findByLabelText('Select Alice Zephyr'))
    fireEvent.click(await screen.findByText('Alice Zephyr'))

    await waitFor(() => {
      expect(screen.getByTestId('mock-test-grading-panel')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Select Alice Zephyr')).toBeChecked()

    fireEvent.keyDown(screen.getByTestId('test-grading-student-scroll-pane'), { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByTestId('mock-test-grading-panel')).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('Select Alice Zephyr')).not.toBeChecked()
  })

  it('clears the selected grading row when clicking table chrome outside the highlighted row', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    fireEvent.click(await screen.findByText('Alice Zephyr'))

    await waitFor(() => {
      expect(screen.getByTestId('mock-test-grading-panel')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByText('Score'))

    await waitFor(() => {
      expect(screen.queryByTestId('mock-test-grading-panel')).not.toBeInTheDocument()
    })
  })

  it('uses controlled test params and reports selection changes through search params', async () => {
    const updateSearchParams = vi.fn((updater: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams('tab=tests')
      updater(params)
    })

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse())
    renderTab({ selectedTestId: null, updateSearchParams })

    fireEvent.click(await screen.findByText('Unit Test'))

    expect(updateSearchParams).toHaveBeenCalledWith(expect.any(Function), undefined)
    const params = new URLSearchParams('tab=tests')
    updateSearchParams.mock.calls[0][0](params)
    expect(params.get('testId')).toBe('test-1')
    expect(params.get('testMode')).toBe('grading')
    expect(params.get('testStudentId')).toBeNull()
  })

  it('reports selected grading student changes through search params', async () => {
    const updateSearchParams = vi.fn((updater: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams('tab=tests')
      updater(params)
    })

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    fetchMock.mockResolvedValueOnce(makeResultsResponse())
    renderTab({ updateSearchParams })

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Alice Zephyr'))

    await waitFor(() => {
      expect(updateSearchParams).toHaveBeenCalledTimes(2)
    })

    const params = new URLSearchParams('tab=tests&testId=test-1&testMode=grading')
    updateSearchParams.mock.calls[1][0](params)
    expect(params.get('testId')).toBe('test-1')
    expect(params.get('testMode')).toBe('grading')
    expect(params.get('testStudentId')).toBe('student-1')
  })

  it('opens controlled authoring params in the test editor', async () => {
    const updateSearchParams = vi.fn()

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])

    renderTab({
      selectedTestId: 'test-1',
      selectedTestMode: 'authoring',
      updateSearchParams,
    })

    expect(await screen.findByTestId('mock-test-detail')).toHaveAttribute('data-question-layout', 'editor-only')
    expect(screen.queryByText('Alice Zephyr')).not.toBeInTheDocument()
    expect(resultsFetchCalls(fetchMock)).toHaveLength(0)
    expect(updateSearchParams).not.toHaveBeenCalled()
  })

  it('returns controlled authoring params to grading params when the editor closes', async () => {
    const updateSearchParams = vi.fn((updater: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams('tab=tests&testId=test-1&testMode=authoring')
      updater(params)
    })

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])

    renderTab({
      selectedTestId: 'test-1',
      selectedTestMode: 'authoring',
      updateSearchParams,
    })

    expect(await screen.findByTestId('mock-test-detail')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(updateSearchParams).toHaveBeenCalledWith(expect.any(Function), { replace: true })
    const params = new URLSearchParams('tab=tests&testId=test-1&testMode=authoring')
    updateSearchParams.mock.calls[0][0](params)
    expect(params.get('testId')).toBe('test-1')
    expect(params.get('testMode')).toBe('grading')
    expect(params.get('testStudentId')).toBeNull()
  })

  it('models Browser Back by following controlled test params back to summary', async () => {
    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    const view = renderTab({ selectedTestId: 'test-1', selectedTestMode: 'authoring' })

    expect(await screen.findByTestId('mock-test-detail')).toBeInTheDocument()

    view.rerender(
      <TeacherTestsTab
        classroom={classroom}
        selectedTestId={null}
        selectedTestMode={null}
      />
    )

    await waitFor(() => {
      expect(screen.queryByTestId('mock-test-detail')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Unit Test')).toBeInTheDocument()
  })

  it('keeps valid controlled test params while the test list is still loading', async () => {
    let resolveTests:
      | ((value: { ok: boolean; json: () => Promise<any> }) => void)
      | null = null
    const updateSearchParams = vi.fn()

    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTests = resolve
        }) as unknown as Promise<Response>,
    )

    renderTab({
      selectedTestId: 'test-1',
      selectedTestMode: 'authoring',
      updateSearchParams,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(updateSearchParams).not.toHaveBeenCalled()

    await act(async () => {
      resolveTests?.({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test' })] }),
      })
      await Promise.resolve()
    })

    expect(await screen.findByTestId('mock-test-detail')).toBeInTheDocument()
    expect(resultsFetchCalls(fetchMock)).toHaveLength(0)
    expect(updateSearchParams).not.toHaveBeenCalled()
  })

  it('keeps controlled test params intact when the tests list fails', async () => {
    const updateSearchParams = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Database unavailable' }),
    })

    renderTab({
      selectedTestId: 'test-1',
      selectedTestMode: 'authoring',
      updateSearchParams,
    })

    expect(await screen.findByText('Tests unavailable')).toBeInTheDocument()
    expect(updateSearchParams).not.toHaveBeenCalled()
  })

  it('replaces invalid controlled test params with summary params', async () => {
    const updateSearchParams = vi.fn()

    mockTestsResponse([makeTest({ id: 'test-1', title: 'Unit Test' })])
    renderTab({ selectedTestId: 'missing-test', selectedTestMode: 'grading', updateSearchParams })

    await waitFor(() => {
      expect(updateSearchParams).toHaveBeenCalledWith(expect.any(Function), { replace: true })
    })

    const params = new URLSearchParams('tab=tests&testId=missing-test&testMode=grading&testStudentId=student-1')
    updateSearchParams.mock.calls[0][0](params)
    expect(params.get('tab')).toBe('tests')
    expect(params.get('testId')).toBeNull()
    expect(params.get('testMode')).toBeNull()
    expect(params.get('testStudentId')).toBeNull()
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

  it('keeps grading rows visible while a background poll refreshes', async () => {
    let intervalCallback: (() => void) | null = null
    let resolvePoll:
      | ((value: { ok: boolean; json: () => Promise<any> }) => void)
      | null = null

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    vi.spyOn(document, 'hasFocus').mockImplementation(() => true)
    vi.spyOn(window, 'setInterval').mockImplementation(((callback: TimerHandler) => {
      intervalCallback = callback as () => void
      return 1
    }) as typeof window.setInterval)

    const pollResultsPromise = new Promise<{ ok: boolean; json: () => Promise<any> }>((resolve) => {
      resolvePoll = resolve
    })

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())
      .mockImplementationOnce(() => pollResultsPromise as unknown as Promise<Response>)

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))

    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    expect(screen.getByText('3/5')).toBeInTheDocument()
    expect(screen.getByTestId('assessment-status-icon-submitted')).toHaveClass('text-success')
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Access' })).toBeInTheDocument()
    expect(screen.queryByText('Submitted')).not.toBeInTheDocument()

    await act(async () => {
      intervalCallback?.()
      await Promise.resolve()
    })

    expect(screen.getByText('Alice Zephyr')).toBeInTheDocument()
    expect(screen.getByText('3/5')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Refreshing grades')
    })

    await act(async () => {
      resolvePoll?.(
        makeResultsResponse({
          students: [
            {
              student_id: 'student-1',
              name: 'Alice Zephyr',
              first_name: 'Alice',
              last_name: 'Zephyr',
              email: 'alice@example.com',
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

    await waitFor(() => {
      expect(screen.getByText('4/5')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  it('shows a simple exit alert and unreviewed row highlight when polling detects a new exit', async () => {
    let intervalCallback: (() => void) | null = null
    let resolvePoll:
      | ((value: { ok: boolean; json: () => Promise<any> }) => void)
      | null = null

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    vi.spyOn(document, 'hasFocus').mockImplementation(() => true)
    vi.spyOn(window, 'setInterval').mockImplementation(((callback: TimerHandler) => {
      intervalCallback = callback as () => void
      return 1
    }) as typeof window.setInterval)

    const pollResultsPromise = new Promise<{ ok: boolean; json: () => Promise<any> }>((resolve) => {
      resolvePoll = resolve
    })
    const focusSummary = {
      exit_count: 0,
      away_count: 0,
      away_total_seconds: 0,
      route_exit_attempts: 0,
      window_unmaximize_attempts: 0,
      last_away_started_at: null,
      last_away_ended_at: null,
    }

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        students: [makeGradingStudent({ focus_summary: focusSummary })],
      }))
      .mockImplementationOnce(() => pollResultsPromise as unknown as Promise<Response>)

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))

    const row = await screen.findByTestId('test-grading-student-row-student-1')
    expect(screen.queryByTestId('test-exit-detected-alert')).not.toBeInTheDocument()
    expect(within(row).getByLabelText(/Exits 0\./)).toHaveClass('text-text-muted')

    await act(async () => {
      intervalCallback?.()
      await Promise.resolve()
    })

    await act(async () => {
      resolvePoll?.(
        makeResultsResponse({
          students: [
            makeGradingStudent({
              focus_summary: {
                ...focusSummary,
                exit_count: 1,
                away_count: 1,
                away_total_seconds: 12,
              },
            }),
          ],
        })
      )
      await Promise.resolve()
    })

    const alert = await screen.findByRole('button', { name: 'Exit detected' })
    const highlightedRow = screen.getByTestId('test-grading-student-row-student-1')
    expect(highlightedRow).toHaveClass('bg-warning-bg')
    expect(within(highlightedRow).getByLabelText(/Exits 1\./)).toHaveClass('text-warning')

    fireEvent.click(alert)

    await waitFor(() => {
      expect(screen.getByTestId('mock-test-grading-panel')).toHaveTextContent('Grading panel for test-1:student-1')
    })
    expect(screen.queryByTestId('test-exit-detected-alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('test-grading-student-row-student-1')).toHaveClass('bg-surface-selected')
    expect(screen.getByTestId('test-grading-student-row-student-1')).not.toHaveClass('bg-warning-bg')
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
      .mockResolvedValue(makeResultsResponse({ testStatus: 'closed' }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))

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

  it('does not poll grades when every student has closed access', async () => {
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
      .mockResolvedValue(
        makeResultsResponse({
          students: [
            {
              student_id: 'student-1',
              name: 'Alice Zephyr',
              first_name: 'Alice',
              last_name: 'Zephyr',
              email: 'alice@example.com',
              status: 'closed',
              submitted_at: null,
              last_activity_at: '2026-04-17T18:15:00.000Z',
              points_earned: 3,
              points_possible: 5,
              percent: 60,
              graded_open_responses: 0,
              ungraded_open_responses: 1,
              access_state: 'closed',
              effective_access: 'closed',
              access_source: 'student',
              focus_summary: null,
            },
          ],
        })
      )

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))

    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    expect(resultsFetchCalls(fetchMock)).toHaveLength(1)
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 15_000)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })

    expect(resultsFetchCalls(fetchMock)).toHaveLength(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
      .mockResolvedValue(makeResultsResponse({ testStatus: 'active' }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))

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

    await act(async () => {
      resolveSecondResults?.(
        makeResultsResponse({
          testId: 'test-2',
          testTitle: 'Unit Test B',
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
          testId: 'test-1',
          testTitle: 'Unit Test A',
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

  it('requires selected students to be closed before returning work', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select Alice Zephyr'))
    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Return/ }))

    expect(await screen.findByText('Close selected students before returning')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/teacher/tests/test-1/return')).toBe(false)
  })

  it('closes access for selected students without submitting their work', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        students: [
          {
            student_id: 'student-1',
            name: 'Alice Zephyr',
            first_name: 'Alice',
            last_name: 'Zephyr',
            email: 'alice@example.com',
            status: 'in_progress',
            submitted_at: null,
            last_activity_at: '2026-04-17T18:15:00.000Z',
            points_earned: 0,
            points_possible: 5,
            percent: null,
            graded_open_responses: 0,
            ungraded_open_responses: 0,
            access_state: null,
            effective_access: 'open',
            access_source: 'test',
            focus_summary: null,
          },
        ],
      }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ updated_count: 1, skipped_count: 0, state: 'closed' }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        students: [
          {
            student_id: 'student-1',
            name: 'Alice Zephyr',
            first_name: 'Alice',
            last_name: 'Zephyr',
            email: 'alice@example.com',
            status: 'in_progress',
            submitted_at: null,
            last_activity_at: '2026-04-17T18:15:00.000Z',
            points_earned: 0,
            points_possible: 5,
            percent: null,
            graded_open_responses: 0,
            ungraded_open_responses: 0,
            access_state: 'closed',
            effective_access: 'closed',
            access_source: 'student',
            focus_summary: null,
          },
        ],
      }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()
    expect(screen.getByLabelText(/Access open, inherited from test status/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select Alice Zephyr'))
    expect(screen.getByRole('button', { name: 'Close 1 Selected' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    expect(screen.getByRole('menuitem', { name: 'Open 1 Selected' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close 1 Selected' }))
    expect(await screen.findByText(/Saved work stays available for grading/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close Access' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/tests/test-1/student-access',
        expect.objectContaining({ method: 'POST' })
      )
    })

    const accessCall = fetchMock.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/tests/test-1/student-access'
    )
    expect(accessCall).toBeTruthy()
    expect(JSON.parse(accessCall?.[1]?.body as string)).toMatchObject({
      student_ids: ['student-1'],
      state: 'closed',
    })
    expect(await screen.findByLabelText(/Access closed for this student/)).toBeInTheDocument()
  })

  it('toggles one student access from the row access icon with confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ updated_count: 1, skipped_count: 0, locked_count: 1, state: 'closed' }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        students: [
          {
            student_id: 'student-1',
            name: 'Alice Zephyr',
            first_name: 'Alice',
            last_name: 'Zephyr',
            email: 'alice@example.com',
            status: 'closed',
            submitted_at: null,
            last_activity_at: '2026-04-17T18:15:00.000Z',
            points_earned: 3,
            points_possible: 5,
            percent: 60,
            graded_open_responses: 0,
            ungraded_open_responses: 0,
            access_state: 'closed',
            effective_access: 'closed',
            access_source: 'student',
            focus_summary: null,
          },
        ],
      }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ updated_count: 1, skipped_count: 0, locked_count: 0, state: 'open' }),
      })
      .mockResolvedValueOnce(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/Close access for Alice Zephyr/))
    expect(await screen.findByText('Close access for Alice Zephyr?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close Access' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/tests/test-1/student-access',
        expect.objectContaining({ method: 'POST' })
      )
    })
    let accessCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/tests/test-1/student-access'
    )
    expect(JSON.parse(accessCalls[0][1]?.body as string)).toMatchObject({
      student_ids: ['student-1'],
      state: 'closed',
    })

    fireEvent.click(await screen.findByLabelText(/Open access for Alice Zephyr/))
    expect(await screen.findByText('Open access for Alice Zephyr?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Access' }))

    await waitFor(() => {
      accessCalls = fetchMock.mock.calls.filter(
        ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/tests/test-1/student-access'
      )
      expect(accessCalls).toHaveLength(2)
    })
    expect(JSON.parse(accessCalls[1][1]?.body as string)).toMatchObject({
      student_ids: ['student-1'],
      state: 'open',
    })
  })

  it('marks selected student attempts unsubmitted without opening access', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'closed' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        testStatus: 'closed',
        students: [
          {
            student_id: 'student-1',
            name: 'Alice Zephyr',
            first_name: 'Alice',
            last_name: 'Zephyr',
            email: 'alice@example.com',
            status: 'submitted',
            submitted_at: '2026-04-17T18:15:00.000Z',
            last_activity_at: '2026-04-17T18:15:00.000Z',
            points_earned: 3,
            points_possible: 5,
            percent: 60,
            graded_open_responses: 1,
            ungraded_open_responses: 0,
            access_state: 'closed',
            effective_access: 'closed',
            access_source: 'student',
            focus_summary: null,
          },
          {
            student_id: 'student-2',
            name: 'Bob Yellow',
            first_name: 'Bob',
            last_name: 'Yellow',
            email: 'bob@example.com',
            status: 'in_progress',
            submitted_at: null,
            last_activity_at: '2026-04-17T18:10:00.000Z',
            points_earned: 0,
            points_possible: 5,
            percent: null,
            graded_open_responses: 0,
            ungraded_open_responses: 0,
            access_state: 'closed',
            effective_access: 'closed',
            access_source: 'student',
            focus_summary: null,
          },
        ],
      }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unsubmitted_count: 1, skipped_count: 0 }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        testStatus: 'closed',
        students: [
          {
            student_id: 'student-1',
            name: 'Alice Zephyr',
            first_name: 'Alice',
            last_name: 'Zephyr',
            email: 'alice@example.com',
            status: 'in_progress',
            submitted_at: null,
            last_activity_at: '2026-04-17T18:15:00.000Z',
            points_earned: 0,
            points_possible: 5,
            percent: null,
            graded_open_responses: 0,
            ungraded_open_responses: 0,
            access_state: 'closed',
            effective_access: 'closed',
            access_source: 'student',
            focus_summary: null,
          },
        ],
      }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select Alice Zephyr'))
    fireEvent.click(screen.getByLabelText('Select Bob Yellow'))
    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    expect(screen.getByRole('menuitem', { name: /AI Grade\s+2/ })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: /Unsubmit Selected\s+1/ })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: /Return\s+2/ })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: /Delete Selected\s+2/ })).toBeEnabled()
    fireEvent.click(screen.getByRole('menuitem', { name: /Unsubmit Selected/ }))
    expect(await screen.findByText('Mark 1 selected attempt unsubmitted?')).toBeInTheDocument()
    expect(await screen.findByText(/Access is unchanged/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark Unsubmitted' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/tests/test-1/unsubmit',
        expect.objectContaining({ method: 'POST' })
      )
    })

    const unsubmitCall = fetchMock.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/tests/test-1/unsubmit'
    )
    expect(unsubmitCall).toBeTruthy()
    expect(JSON.parse(unsubmitCall?.[1]?.body as string)).toMatchObject({
      student_ids: ['student-1'],
    })
  })

  it('disables unsubmit selected when selected students have no submitted work', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        students: [
          {
            student_id: 'student-1',
            name: 'Alice Zephyr',
            first_name: 'Alice',
            last_name: 'Zephyr',
            email: 'alice@example.com',
            status: 'in_progress',
            submitted_at: null,
            last_activity_at: '2026-04-17T18:15:00.000Z',
            points_earned: 0,
            points_possible: 5,
            percent: null,
            graded_open_responses: 0,
            ungraded_open_responses: 0,
            focus_summary: null,
          },
        ],
      }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select Alice Zephyr'))
    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))

    expect(screen.getByRole('menuitem', { name: /Unsubmit Selected\s+0/ })).toBeDisabled()
  })

  it('marks one submitted student unsubmitted from the row submitted icon with confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'closed' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        testStatus: 'closed',
        students: [
          {
            student_id: 'student-1',
            name: 'Alice Zephyr',
            first_name: 'Alice',
            last_name: 'Zephyr',
            email: 'alice@example.com',
            status: 'submitted',
            submitted_at: '2026-04-17T18:15:00.000Z',
            last_activity_at: '2026-04-17T18:15:00.000Z',
            points_earned: 3,
            points_possible: 5,
            percent: 60,
            graded_open_responses: 1,
            ungraded_open_responses: 0,
            access_state: 'closed',
            effective_access: 'closed',
            access_source: 'student',
            focus_summary: null,
          },
        ],
      }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unsubmitted_count: 1, skipped_count: 0 }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        testStatus: 'closed',
        students: [
          {
            student_id: 'student-1',
            name: 'Alice Zephyr',
            first_name: 'Alice',
            last_name: 'Zephyr',
            email: 'alice@example.com',
            status: 'in_progress',
            submitted_at: null,
            last_activity_at: '2026-04-17T18:15:00.000Z',
            points_earned: 0,
            points_possible: 5,
            percent: null,
            graded_open_responses: 0,
            ungraded_open_responses: 0,
            access_state: 'closed',
            effective_access: 'closed',
            access_source: 'student',
            focus_summary: null,
          },
        ],
      }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Mark Alice Zephyr unsubmitted/ }))
    expect(await screen.findByText('Mark Alice Zephyr unsubmitted?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark Unsubmitted' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/tests/test-1/unsubmit',
        expect.objectContaining({ method: 'POST' })
      )
    })
    const unsubmitCall = fetchMock.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/tests/test-1/unsubmit'
    )
    expect(JSON.parse(unsubmitCall?.[1]?.body as string)).toMatchObject({
      student_ids: ['student-1'],
    })
  })

  it('clears student selections with Escape while keeping selected-delete in the dropdown', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    const rowCheckbox = screen.getByLabelText('Select Alice Zephyr') as HTMLInputElement
    fireEvent.click(rowCheckbox)

    expect(rowCheckbox.checked).toBe(true)
    expect(screen.queryByRole('button', { name: 'Delete Alice Zephyr test' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Manage Attempts' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Delete Selected/ })).toBeEnabled()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(rowCheckbox.checked).toBe(false)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('deletes selected student test work from the selected test actions dropdown', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          requested_count: 1,
          deleted_student_count: 1,
          deleted_attempts: 1,
          deleted_responses: 2,
          deleted_focus_events: 1,
          deleted_ai_grading_items: 0,
        }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        students: [
          {
            student_id: 'student-1',
            name: 'Alice Zephyr',
            first_name: 'Alice',
            last_name: 'Zephyr',
            email: 'alice@example.com',
            status: 'not_started',
            submitted_at: null,
            last_activity_at: null,
            points_earned: 0,
            points_possible: 5,
            percent: null,
            graded_open_responses: 0,
            ungraded_open_responses: 0,
            effective_access: 'open',
            access_source: 'test',
            focus_summary: null,
          },
        ],
      }))

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    expect(screen.getByRole('menuitem', { name: /Delete Selected/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))

    fireEvent.click(screen.getByLabelText('Select Alice Zephyr'))
    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete Selected/ }))

    expect(await screen.findByText('Delete 1 selected test work item?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Work' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/tests/test-1/students/attempts/bulk-delete',
        expect.objectContaining({ method: 'POST' })
      )
    })
    const deleteCall = fetchMock.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/tests/test-1/students/attempts/bulk-delete'
    )
    expect(JSON.parse(deleteCall?.[1]?.body as string)).toEqual({ student_ids: ['student-1'] })
    expect(await screen.findByLabelText('Status Not started')).toBeInTheDocument()
  })

  it('keeps selected test work pending when the atomic bulk delete fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValueOnce(makeResultsResponse({
        students: [
          makeGradingStudent(),
          makeGradingStudent({
            student_id: 'student-2',
            name: 'Bob Yellow',
            first_name: 'Bob',
            last_name: 'Yellow',
            email: 'bob@example.com',
          }),
        ],
      }))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Failed to delete selected student test work' }),
      })

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select Alice Zephyr'))
    fireEvent.click(screen.getByLabelText('Select Bob Yellow'))
    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete Selected/ }))

    expect(await screen.findByText('Delete 2 selected test work items?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Work' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/tests/test-1/students/attempts/bulk-delete',
        expect.objectContaining({ method: 'POST' })
      )
    })
    const deleteCall = fetchMock.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/tests/test-1/students/attempts/bulk-delete'
    )
    expect(JSON.parse(deleteCall?.[1]?.body as string).student_ids.sort()).toEqual(['student-1', 'student-2'])
    expect(await screen.findByText('Failed to delete selected student test work')).toBeInTheDocument()
    expect(screen.getByText('Delete 2 selected test work items?')).toBeInTheDocument()
    expect(resultsFetchCalls(fetchMock)).toHaveLength(1)
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
    expect(await screen.findByText('Alice Zephyr')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select Alice Zephyr'))
    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /AI Grade/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Grade with AI' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/grading/i)
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Graded 1')
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/teacher/tests/test-1/auto-grade-runs/run-1/tick',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('does not expose the AI prompt or legacy destructive options', async () => {
    const onRequestDelete = vi.fn()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValue(makeResultsResponse())

    renderTab({ onRequestDelete })

    fireEvent.click(await screen.findByText('Unit Test'))
    await screen.findByText('Alice Zephyr')

    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))

    expect(screen.queryByRole('menuitem', { name: 'AI Prompt' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete Test' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: /Delete Selected/ })).toBeDisabled()
    expect(screen.queryByRole('menuitem', { name: 'Clear Open Grades' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Grading strategy')).not.toBeInTheDocument()
    expect(screen.queryByText('Grading strategy')).not.toBeInTheDocument()
  })

  it('disables AI Grade until students are selected', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tests: [makeTest({ id: 'test-1', title: 'Unit Test', status: 'active' })] }),
      })
      .mockResolvedValue(makeResultsResponse())

    renderTab()

    fireEvent.click(await screen.findByText('Unit Test'))
    await screen.findByText('Alice Zephyr')

    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    expect(screen.getByRole('menuitem', { name: /AI Grade/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))
    fireEvent.click(screen.getByLabelText('Select Alice Zephyr'))
    fireEvent.click(screen.getByRole('button', { name: 'More test actions' }))

    expect(screen.getByRole('menuitem', { name: /AI Grade/ })).toBeEnabled()
  })

  it('reloads the visible list once when the update event fires', async () => {
    mockTestsResponse([])
    renderTab()

    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(1)
    })

    mockTestsResponse([makeTest({ id: 'test-reloaded', title: 'Reloaded Test' })])

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_TESTS_UPDATED_EVENT, {
          detail: { classroomId: classroom.id },
        })
      )
    })

    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(2)
    })
    expect(await screen.findByText('Reloaded Test')).toBeInTheDocument()
  })
})
