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

  function renderTab(assessmentType: QuizAssessmentType = 'quiz') {
    render(<TeacherQuizzesTab classroom={classroom} assessmentType={assessmentType} />, {
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
    renderTab('quiz')

    expect(await screen.findByText('Loops Quiz')).toBeInTheDocument()
    expect(screen.getByText('New Quiz')).toBeInTheDocument()
    expect(listFetchCalls(fetchMock)[0][0]).toContain('/api/teacher/quizzes?classroom_id=')
  })
})
