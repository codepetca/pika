import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TeacherQuizzesTab } from '@/app/classrooms/[classroomId]/TeacherQuizzesTab'
import { TooltipProvider } from '@/ui'
import { TEACHER_QUIZZES_UPDATED_EVENT } from '@/lib/events'
import { createMockClassroom, createMockQuiz } from '../helpers/mocks'
import type { QuizAssessmentType, QuizWithStats } from '@/types'

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
              id: 'created-quiz-id',
              title: 'Created Quiz',
              assessment_type: assessmentType || 'quiz',
            }) as QuizWithStats
          )
        }
      >
        Save Quiz
      </button>
	    ) : null,
}))

vi.mock('@/components/QuizDetailPanel', () => ({
  QuizDetailPanel: ({
    quiz,
    onQuizUpdate,
  }: {
    quiz: QuizWithStats
    onQuizUpdate?: () => void
  }) => (
    <div data-testid="mock-quiz-detail">
      Detail for {quiz.title}
      <button type="button" onClick={() => onQuizUpdate?.()}>
        Simulate quiz update
      </button>
    </div>
  ),
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
    ([url]: [string]) =>
      typeof url === 'string' && url.includes('/api/teacher/quizzes') && url.includes('?classroom_id=')
  )
}

describe('TeacherQuizzesTab', () => {
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

  function mockQuizzesResponse(quizzes: QuizWithStats[] = []) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ quizzes }),
    })
  }

  function renderTab(options?: {
    assessmentType?: QuizAssessmentType
    selectedQuizId?: string | null
    updateSearchParams?: (
      updater: (params: URLSearchParams) => void,
      options?: { replace?: boolean },
    ) => void
    onRequestDelete?: () => void
  }) {
    render(<TeacherQuizzesTab
      classroom={classroom}
      assessmentType={options?.assessmentType ?? 'quiz'}
      selectedQuizId={options?.selectedQuizId}
      updateSearchParams={options?.updateSearchParams}
      onRequestDelete={options?.onRequestDelete}
    />, {
      wrapper: Wrapper,
    })
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
  })

  it('does not double-fetch after quiz creation', async () => {
    mockQuizzesResponse([])
    renderTab()

    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(1)
    })

    mockQuizzesResponse([makeQuiz()])

    fireEvent.click(screen.getByText('New Quiz'))
    fireEvent.click(screen.getByTestId('mock-quiz-save'))

    await waitFor(() => {
      expect(listFetchCalls(fetchMock)).toHaveLength(2)
    })
  })

  it('renders quiz mode with the quiz API and primary action', async () => {
    mockQuizzesResponse([makeQuiz({ id: 'quiz-1', title: 'Loops Quiz' })])
    renderTab({ assessmentType: 'quiz' })

    expect(await screen.findByText('Loops Quiz')).toBeInTheDocument()
    expect(screen.getByText('New Quiz')).toBeInTheDocument()
    expect(listFetchCalls(fetchMock)[0][0]).toContain('/api/teacher/quizzes?classroom_id=')
  })

  it('opens a selected quiz in the main workspace without opening the passive sidebar', async () => {
    mockQuizzesResponse([makeQuiz({ id: 'quiz-1', title: 'Loops Quiz' })])
    renderTab()

    fireEvent.click(await screen.findByText('Loops Quiz'))

    expect(await screen.findByTestId('mock-quiz-detail')).toHaveTextContent('Detail for Loops Quiz')
    expect(screen.queryByText('New Quiz')).not.toBeInTheDocument()
    expect(setOpenMock).not.toHaveBeenCalledWith(true)
  })

  it('reports quiz selection through search params', async () => {
    const updateSearchParams = vi.fn((updater: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams('tab=quizzes')
      updater(params)
    })

    mockQuizzesResponse([makeQuiz({ id: 'quiz-1', title: 'Loops Quiz' })])
    renderTab({ selectedQuizId: null, updateSearchParams })

    fireEvent.click(await screen.findByText('Loops Quiz'))

    expect(updateSearchParams).toHaveBeenCalledWith(expect.any(Function), undefined)
    const params = new URLSearchParams('tab=quizzes')
    updateSearchParams.mock.calls[0][0](params)
    expect(params.get('quizId')).toBe('quiz-1')
  })

  it('models Browser Back by following controlled quiz params back to summary', async () => {
    mockQuizzesResponse([makeQuiz({ id: 'quiz-1', title: 'Loops Quiz' })])
    const { rerender } = render(
      <TeacherQuizzesTab
        classroom={classroom}
        assessmentType="quiz"
        selectedQuizId="quiz-1"
      />,
      { wrapper: Wrapper },
    )

    expect(await screen.findByTestId('mock-quiz-detail')).toHaveTextContent('Detail for Loops Quiz')

    rerender(
      <TeacherQuizzesTab
        classroom={classroom}
        assessmentType="quiz"
        selectedQuizId={null}
      />
    )

    await waitFor(() => {
      expect(screen.queryByTestId('mock-quiz-detail')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Loops Quiz')).toBeInTheDocument()
  })

  it('shows delete only inside the selected quiz workspace', async () => {
    const onRequestDelete = vi.fn()

    mockQuizzesResponse([makeQuiz({ id: 'quiz-1', title: 'Loops Quiz' })])
    renderTab({ onRequestDelete })

    expect(await screen.findByText('Loops Quiz')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Quiz' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Loops Quiz'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Quiz' }))

    expect(onRequestDelete).toHaveBeenCalledTimes(1)
  })

  it('replaces invalid controlled quiz params with summary params', async () => {
    const updateSearchParams = vi.fn()

    mockQuizzesResponse([makeQuiz({ id: 'quiz-1', title: 'Loops Quiz' })])
    renderTab({ selectedQuizId: 'missing-quiz', updateSearchParams })

    await waitFor(() => {
      expect(updateSearchParams).toHaveBeenCalledWith(expect.any(Function), { replace: true })
    })

    const params = new URLSearchParams('tab=quizzes&quizId=missing-quiz')
    updateSearchParams.mock.calls[0][0](params)
    expect(params.get('tab')).toBe('quizzes')
    expect(params.get('quizId')).toBeNull()
  })
})
