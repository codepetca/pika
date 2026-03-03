import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TeacherQuizzesTab } from '@/app/classrooms/[classroomId]/TeacherQuizzesTab'
import { TooltipProvider } from '@/ui'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { createMockClassroom, createMockQuiz } from '../helpers/mocks'
import type { QuizAssessmentType, QuizWithStats } from '@/types'

vi.mock('@/components/layout', () => ({
  useRightSidebar: () => ({ setOpen: vi.fn() }),
}))

vi.mock('@/components/QuizModal', () => ({
  QuizModal: ({
    isOpen,
    onSuccess,
    assessmentType,
  }: {
    isOpen: boolean
    assessmentType?: 'quiz' | 'test'
    onSuccess: (quiz: QuizWithStats) => void
  }) =>
    isOpen ? (
      <button
        data-testid="mock-quiz-save"
        onClick={() =>
          onSuccess(
            createMockQuiz({
              id: 'created-test-id',
              title: 'Created Test',
              assessment_type: assessmentType || 'quiz',
            }) as QuizWithStats
          )
        }
      >
        Save Quiz
      </button>
    ) : null,
}))

function Wrapper({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}

function makeQuiz(overrides: Partial<QuizWithStats> = {}): QuizWithStats {
  const base = createMockQuiz(overrides)
  return {
    ...base,
    stats: { total_students: 10, responded: 5, questions_count: 3 },
    ...overrides,
  } as QuizWithStats
}

function listFetchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url]: [string]) => typeof url === 'string' && url.includes('/api/teacher/') && url.includes('?classroom_id=')
  )
}

describe('TeacherQuizzesTab', () => {
  const classroom = createMockClassroom()
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mockQuizzesResponse(quizzes: QuizWithStats[] = []) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ quizzes }),
    })
  }

  function renderTab(
    assessmentType: QuizAssessmentType = 'quiz',
    options?: {
      onSelectQuiz?: (quiz: QuizWithStats | null) => void
      onTestGradingContextChange?: (context: {
        mode: 'authoring' | 'grading'
        testId: string | null
        studentId: string | null
        studentName: string | null
      }) => void
    }
  ) {
    render(
      <TeacherQuizzesTab
        classroom={classroom}
        assessmentType={assessmentType}
        onSelectQuiz={options?.onSelectQuiz}
        onTestGradingContextChange={options?.onTestGradingContextChange}
      />,
      { wrapper: Wrapper }
    )
  }

  it('fetches quizzes once on mount', async () => {
    mockQuizzesResponse([])
    renderTab()

    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(1)
    })
    expect(listFetchCalls(fetchMock)[0][0]).toContain('/api/teacher/quizzes?classroom_id=')
  })

  it('fetches quizzes once when update event fires (not twice)', async () => {
    mockQuizzesResponse([])
    renderTab()

    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(1)
    })

    // Provide response for the event-triggered reload
    mockQuizzesResponse([])

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

    // Wait a tick to ensure no additional fetch sneaks in
    await new Promise((r) => setTimeout(r, 50))
    expect(listFetchCalls(fetchMock)).toHaveLength(2)
  })

  it('does not double-fetch after quiz creation', async () => {
    mockQuizzesResponse([])
    renderTab()

    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(1)
    })

    // Provide response for the post-creation reload
    mockQuizzesResponse([makeQuiz()])

    // Open modal and trigger creation success
    fireEvent.click(screen.getByText('New Quiz'))
    fireEvent.click(screen.getByTestId('mock-quiz-save'))

    // The event listener should trigger exactly one reload
    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(2)
    })

    // Confirm no extra fetch
    await new Promise((r) => setTimeout(r, 50))
    expect(listFetchCalls(fetchMock)).toHaveLength(2)
  })

  it('does not double-fetch after quiz deletion', async () => {
    const quiz = makeQuiz({ id: 'quiz-del', title: 'Delete Me' })
    mockQuizzesResponse([quiz])
    renderTab()

    await waitFor(() => {
      expect(screen.getByText('Delete Me')).toBeInTheDocument()
    })

    // Click delete on the quiz card — triggers handleRequestDelete which fetches results
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stats: { responded: 0 } }),
    })
    fireEvent.click(screen.getByLabelText('Delete Delete Me'))

    await waitFor(() => {
      expect(screen.getByText('Delete quiz?')).toBeInTheDocument()
    })

    // Provide response for the DELETE call
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    // Provide response for the event-triggered reload
    mockQuizzesResponse([])

    const countBefore = listFetchCalls(fetchMock).length

    fireEvent.click(screen.getByText('Delete'))

    // Wait for delete + reload
    await waitFor(() => {
      expect(listFetchCalls(fetchMock).length).toBe(countBefore + 1)
    })

    // Confirm no extra fetch
    await new Promise((r) => setTimeout(r, 50))
    expect(listFetchCalls(fetchMock).length).toBe(countBefore + 1)
  })

  it('ignores update events for other classrooms', async () => {
    mockQuizzesResponse([])
    renderTab()

    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(1)
    })

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, {
          detail: { classroomId: 'other-classroom' },
        })
      )
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(listFetchCalls(fetchMock)).toHaveLength(1)
  })

  it('renders test mode and fetches from tests API', async () => {
    mockQuizzesResponse([])
    renderTab('test')

    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(1)
    })

    expect(listFetchCalls(fetchMock)[0][0]).toContain('/api/teacher/tests?classroom_id=')
    expect(screen.getByText('New Test')).toBeInTheDocument()
  })

  it('auto-selects newly created test and keeps tests in authoring mode', async () => {
    const existing = makeQuiz({ id: 'existing-test', title: 'Existing Test', assessment_type: 'test' })
    const created = makeQuiz({ id: 'created-test-id', title: 'Created Test', assessment_type: 'test', position: 1 })
    const onSelectQuiz = vi.fn()
    const onTestGradingContextChange = vi.fn()

    mockQuizzesResponse([existing])
    renderTab('test', { onSelectQuiz, onTestGradingContextChange })

    await waitFor(() => {
      expect(screen.getByText('New Test')).toBeInTheDocument()
    })

    mockQuizzesResponse([existing, created])
    fireEvent.click(screen.getByText('New Test'))
    fireEvent.click(screen.getByTestId('mock-quiz-save'))

    await waitFor(() => {
      expect(onSelectQuiz).toHaveBeenCalledWith(expect.objectContaining({ id: 'created-test-id' }))
    })

    await waitFor(() => {
      expect(onTestGradingContextChange).toHaveBeenCalledWith({
        mode: 'authoring',
        testId: 'created-test-id',
        studentId: null,
        studentName: null,
      })
    })
  })

  it('shows tooltips for status/away/exits and formats last time without am/pm', async () => {
    const quiz = makeQuiz({ id: 'test-signals', title: 'Signals Test', assessment_type: 'test' })
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quizzes: [quiz] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          quiz: { id: quiz.id, title: quiz.title, grading_finalized_at: null },
          questions: [],
          stats: { open_questions_count: 0, graded_open_responses: 0, ungraded_open_responses: 0, grading_finalized: false },
          students: [
            {
              student_id: 'student-1',
              name: 'Student One',
              email: 'student1@example.com',
              status: 'submitted',
              submitted_at: '2026-02-25T15:06:00.000Z',
              last_activity_at: '2026-02-25T23:07:00.000Z',
              points_earned: 1,
              points_possible: 6,
              percent: 16.7,
              graded_open_responses: 0,
              ungraded_open_responses: 1,
              focus_summary: {
                away_total_seconds: 13,
                away_count: 4,
                route_exit_attempts: 2,
              },
            },
          ],
        }),
      })

    renderTab('test')
    await screen.findByText('Signals Test')

    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))

    const awaySignal = await screen.findByText('0:13')
    const exitSignal = await screen.findByText('2')
    const statusIcon = await screen.findByLabelText('Submitted')
    const lastTimeCell = await screen.findByText('6:07')

    expect(screen.queryByText('Status')).not.toBeInTheDocument()
    expect(screen.getByText('Away')).toBeInTheDocument()
    expect(screen.getByText('Exits')).toBeInTheDocument()
    expect(statusIcon).toBeInTheDocument()
    expect(lastTimeCell).toHaveClass('font-semibold')
    expect(screen.queryByText(/am|pm/i)).not.toBeInTheDocument()

    expect(awaySignal).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Away from test route')
    )
    expect(exitSignal).toHaveAttribute(
      'aria-label',
      expect.stringContaining('In-app route exit attempts')
    )
    expect(screen.queryByLabelText(/Focus events/i)).not.toBeInTheDocument()
    expect(statusIcon).toHaveAttribute('aria-label', 'Submitted')
  })
})
