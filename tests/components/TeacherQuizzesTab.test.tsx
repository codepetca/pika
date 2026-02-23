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
  QuizModal: ({ isOpen, onSuccess }: { isOpen: boolean; onSuccess: () => void }) =>
    isOpen ? <button data-testid="mock-quiz-save" onClick={onSuccess}>Save Quiz</button> : null,
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

function quizzesFetchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url]: [string]) => typeof url === 'string' && url.includes('/api/teacher/quizzes?')
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

  function renderTab(assessmentType: QuizAssessmentType = 'quiz') {
    render(<TeacherQuizzesTab classroom={classroom} assessmentType={assessmentType} />, { wrapper: Wrapper })
  }

  it('fetches quizzes once on mount', async () => {
    mockQuizzesResponse([])
    renderTab()

    await waitFor(() => {
      expect(quizzesFetchCalls(fetchMock)).toHaveLength(1)
    })
    expect(quizzesFetchCalls(fetchMock)[0][0]).toContain('assessment_type=quiz')
  })

  it('fetches quizzes once when update event fires (not twice)', async () => {
    mockQuizzesResponse([])
    renderTab()

    await waitFor(() => {
      expect(quizzesFetchCalls(fetchMock)).toHaveLength(1)
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
      expect(quizzesFetchCalls(fetchMock)).toHaveLength(2)
    })

    // Wait a tick to ensure no additional fetch sneaks in
    await new Promise((r) => setTimeout(r, 50))
    expect(quizzesFetchCalls(fetchMock)).toHaveLength(2)
  })

  it('does not double-fetch after quiz creation', async () => {
    mockQuizzesResponse([])
    renderTab()

    await waitFor(() => {
      expect(quizzesFetchCalls(fetchMock)).toHaveLength(1)
    })

    // Provide response for the post-creation reload
    mockQuizzesResponse([makeQuiz()])

    // Open modal and trigger creation success
    fireEvent.click(screen.getByText('New Quiz'))
    fireEvent.click(screen.getByTestId('mock-quiz-save'))

    // The event listener should trigger exactly one reload
    await waitFor(() => {
      expect(quizzesFetchCalls(fetchMock)).toHaveLength(2)
    })

    // Confirm no extra fetch
    await new Promise((r) => setTimeout(r, 50))
    expect(quizzesFetchCalls(fetchMock)).toHaveLength(2)
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

    const countBefore = quizzesFetchCalls(fetchMock).length

    fireEvent.click(screen.getByText('Delete'))

    // Wait for delete + reload
    await waitFor(() => {
      expect(quizzesFetchCalls(fetchMock).length).toBe(countBefore + 1)
    })

    // Confirm no extra fetch
    await new Promise((r) => setTimeout(r, 50))
    expect(quizzesFetchCalls(fetchMock).length).toBe(countBefore + 1)
  })

  it('ignores update events for other classrooms', async () => {
    mockQuizzesResponse([])
    renderTab()

    await waitFor(() => {
      expect(quizzesFetchCalls(fetchMock)).toHaveLength(1)
    })

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_QUIZZES_UPDATED_EVENT, {
          detail: { classroomId: 'other-classroom' },
        })
      )
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(quizzesFetchCalls(fetchMock)).toHaveLength(1)
  })

  it('renders test mode and fetches with assessment_type=test', async () => {
    mockQuizzesResponse([])
    renderTab('test')

    await waitFor(() => {
      expect(quizzesFetchCalls(fetchMock)).toHaveLength(1)
    })

    expect(quizzesFetchCalls(fetchMock)[0][0]).toContain('assessment_type=test')
    expect(screen.getByText('New Test')).toBeInTheDocument()
  })
})
