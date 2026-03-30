import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TeacherQuizzesTab } from '@/app/classrooms/[classroomId]/TeacherQuizzesTab'
import { TooltipProvider } from '@/ui'
import {
  TEACHER_QUIZZES_UPDATED_EVENT,
  TEACHER_TEST_GRADING_ROW_UPDATED_EVENT,
} from '@/lib/events'
import { GRADE_11CS_JAVA_CODEHS_PROMPT_GUIDELINE } from '@/lib/test-ai-prompt-guideline'
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

function studentCheckboxOrder(): string[] {
  return screen
    .getAllByRole('checkbox')
    .map((checkbox) => checkbox.getAttribute('aria-label') || '')
    .filter((label) => label.startsWith('Select ') && label !== 'Select all students')
    .map((label) => label.replace(/^Select /, ''))
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
      onTestGradingDataRefresh?: () => void
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
        onTestGradingDataRefresh={options?.onTestGradingDataRefresh}
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

  it('shows iconized exits/away columns and formats last time without am/pm', async () => {
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
                exit_count: 4,
                away_total_seconds: 13,
                away_count: 4,
                route_exit_attempts: 2,
                window_unmaximize_attempts: 3,
              },
            },
          ],
        }),
      })

    renderTab('test')
    await screen.findByText('Signals Test')

    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))

    const awaySignal = await screen.findByText('0:13')
    const exitSignal = await screen.findByText('4')
    const statusIcon = await screen.findByLabelText('Submitted')
    const lastTimeCell = await screen.findByText('6:07')

    expect(screen.queryByText('Status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Exits column')).toBeInTheDocument()
    expect(screen.getByLabelText('Away column')).toBeInTheDocument()
    expect(statusIcon).toBeInTheDocument()
    expect(lastTimeCell).toHaveClass('font-semibold')
    expect(screen.queryByText(/am|pm/i)).not.toBeInTheDocument()

    expect(exitSignal).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Away/focus 4, in-app exits 2, window/full-screen exits 3')
    )
    expect(awaySignal).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Away from test route')
    )
    expect(screen.queryByLabelText(/Focus events/i)).not.toBeInTheDocument()
    expect(statusIcon).toHaveAttribute('aria-label', 'Submitted')
    expect(statusIcon.querySelector('.lucide-check')).not.toBeNull()
  })

  it('toggles grading row sort between last-name asc and first-name asc from the student header', async () => {
    const quiz = makeQuiz({
      id: 'test-sort-names',
      title: 'Sort Names Test',
      assessment_type: 'test',
    })

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
              name: 'Zoe Marie Anderson',
              first_name: 'Zoe Marie',
              last_name: 'Anderson',
              email: 'zoe-marie@example.com',
              status: 'submitted',
              submitted_at: '2026-02-25T15:06:00.000Z',
              last_activity_at: '2026-02-25T23:07:00.000Z',
              points_earned: 1,
              points_possible: 6,
              percent: 16.7,
              graded_open_responses: 0,
              ungraded_open_responses: 0,
              focus_summary: null,
            },
            {
              student_id: 'student-2',
              name: 'Zoe Zimmer',
              first_name: 'Zoe',
              last_name: 'Zimmer',
              email: 'zoe@example.com',
              status: 'submitted',
              submitted_at: '2026-02-25T15:06:00.000Z',
              last_activity_at: '2026-02-25T23:07:00.000Z',
              points_earned: 1,
              points_possible: 6,
              percent: 16.7,
              graded_open_responses: 0,
              ungraded_open_responses: 0,
              focus_summary: null,
            },
            {
              student_id: 'student-3',
              name: 'Amy Brown',
              first_name: 'Amy',
              last_name: 'Brown',
              email: 'amy@example.com',
              status: 'submitted',
              submitted_at: '2026-02-25T15:06:00.000Z',
              last_activity_at: '2026-02-25T23:07:00.000Z',
              points_earned: 1,
              points_possible: 6,
              percent: 16.7,
              graded_open_responses: 0,
              ungraded_open_responses: 0,
              focus_summary: null,
            },
          ],
        }),
      })

    renderTab('test')
    await screen.findByText('Sort Names Test')
    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))

    await screen.findByText('Zoe Marie Anderson')
    expect(studentCheckboxOrder()).toEqual(['Zoe Marie Anderson', 'Amy Brown', 'Zoe Zimmer'])

    fireEvent.click(screen.getByRole('button', { name: 'Sort students by first name' }))
    expect(studentCheckboxOrder()).toEqual(['Amy Brown', 'Zoe Zimmer', 'Zoe Marie Anderson'])

    fireEvent.click(screen.getByRole('button', { name: 'Sort students by last name' }))
    expect(studentCheckboxOrder()).toEqual(['Zoe Marie Anderson', 'Amy Brown', 'Zoe Zimmer'])
  })

  it('updates the grading row score from targeted sidebar save event without reloading', async () => {
    const quiz = makeQuiz({ id: 'test-row-update', title: 'Row Update Test', assessment_type: 'test' })
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
          stats: { open_questions_count: 0, graded_open_responses: 0, ungraded_open_responses: 1, grading_finalized: false },
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
              focus_summary: null,
            },
          ],
        }),
      })

    renderTab('test')
    await screen.findByText('Row Update Test')

    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))
    await screen.findByText('Student One')
    expect(screen.getByText('1/6')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_TEST_GRADING_ROW_UPDATED_EVENT, {
          detail: {
            testId: 'test-row-update',
            studentId: 'student-1',
            pointsEarned: 4,
            pointsPossible: 6,
            percent: 66.7,
            gradedOpenResponses: 1,
            ungradedOpenResponses: 0,
          },
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByText('4/6')).toBeInTheDocument()
    })
    expect(screen.queryByText('1/6')).not.toBeInTheDocument()

    const resultsCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/api/teacher/tests/test-row-update/results')
    )
    expect(resultsCalls).toHaveLength(1)
  })

  it('prompts to close active test before return and sends close_test=true', async () => {
    const quiz = makeQuiz({
      id: 'test-active-return',
      title: 'Active Return Test',
      assessment_type: 'test',
      status: 'active',
    })

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
              focus_summary: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ returned_count: 1, skipped_count: 0, test_closed: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quizzes: [{ ...quiz, status: 'closed' }] }),
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
              status: 'returned',
              submitted_at: '2026-02-25T15:06:00.000Z',
              last_activity_at: '2026-02-25T23:07:00.000Z',
              points_earned: 1,
              points_possible: 6,
              percent: 16.7,
              graded_open_responses: 0,
              ungraded_open_responses: 1,
              focus_summary: null,
            },
          ],
        }),
      })

    renderTab('test')
    await screen.findByText('Active Return Test')

    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))
    await screen.findByText('Student One')

    fireEvent.click(screen.getByLabelText('Select Student One'))
    fireEvent.click(screen.getByRole('button', { name: 'Return 1 selected tests' }))

    expect(await screen.findByText('Close test and return work to 1 selected student(s)?')).toBeInTheDocument()
    expect(screen.getByText('This test is still open. Confirming will close it for all students before returning selected work.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Close and Return'))

    await waitFor(() => {
      const returnCall = fetchMock.mock.calls.find(
        ([url]: [string]) => typeof url === 'string' && url.includes('/api/teacher/tests/test-active-return/return')
      )
      expect(returnCall).toBeDefined()
      const [, init] = returnCall as [string, RequestInit]
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({
        student_ids: ['student-1'],
        close_test: true,
      })
    })

    const returnedStatusIcon = await screen.findByLabelText('Returned')
    expect(returnedStatusIcon.querySelector('.lucide-send')).not.toBeNull()
  })

  it('uses split grade button and sends edited AI prompt guideline', async () => {
    const onTestGradingDataRefresh = vi.fn()
    const quiz = makeQuiz({
      id: 'test-ai-guideline',
      title: 'AI Guideline Test',
      assessment_type: 'test',
      status: 'active',
    })

    const initialResultsPayload = {
      quiz: { id: quiz.id, title: quiz.title, grading_finalized_at: null },
      questions: [],
      stats: { open_questions_count: 0, graded_open_responses: 0, ungraded_open_responses: 1, grading_finalized: false },
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
          focus_summary: null,
        },
      ],
    }

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quizzes: [quiz] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initialResultsPayload,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          graded_students: 1,
          skipped_students: 0,
          eligible_students: 1,
          graded_responses: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initialResultsPayload,
      })

    renderTab('test', { onTestGradingDataRefresh })
    await screen.findByText('AI Guideline Test')

    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))
    await screen.findByText('Student One')

    fireEvent.click(screen.getByLabelText('Select Student One'))

    fireEvent.click(screen.getByRole('button', { name: 'Grade options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'AI prompt' }))

    expect(await screen.findByRole('heading', { name: 'AI Prompt Guideline' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '11CS Java' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    fireEvent.click(screen.getByRole('button', { name: 'Grade 1 selected' }))

    await waitFor(() => {
      const gradeCall = fetchMock.mock.calls.find(
        ([url]: [string]) => typeof url === 'string' && url.includes('/api/teacher/tests/test-ai-guideline/auto-grade')
      )
      expect(gradeCall).toBeDefined()
      const [, init] = gradeCall as [string, RequestInit]
      expect(JSON.parse(String(init.body))).toEqual({
        student_ids: ['student-1'],
        prompt_guideline: GRADE_11CS_JAVA_CODEHS_PROMPT_GUIDELINE,
      })
    })

    await waitFor(() => {
      expect(onTestGradingDataRefresh).toHaveBeenCalledOnce()
    })
  })

  it('summarizes repeated batch auto-grade failures without exposing student ids', async () => {
    const quiz = makeQuiz({
      id: 'test-ai-errors',
      title: 'AI Errors Test',
      assessment_type: 'test',
      status: 'active',
    })

    const initialResultsPayload = {
      quiz: { id: quiz.id, title: quiz.title, grading_finalized_at: null },
      questions: [],
      stats: { open_questions_count: 0, graded_open_responses: 0, ungraded_open_responses: 2, grading_finalized: false },
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
          focus_summary: null,
        },
        {
          student_id: 'student-2',
          name: 'Student Two',
          email: 'student2@example.com',
          status: 'submitted',
          submitted_at: '2026-02-25T15:06:00.000Z',
          last_activity_at: '2026-02-25T23:07:00.000Z',
          points_earned: 2,
          points_possible: 6,
          percent: 33.3,
          graded_open_responses: 0,
          ungraded_open_responses: 1,
          focus_summary: null,
        },
      ],
    }

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quizzes: [quiz] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initialResultsPayload,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          graded_students: 0,
          skipped_students: 2,
          eligible_students: 2,
          graded_responses: 0,
          errors: [
            'student-1: AI grading service failed for this response. Try again.',
            'student-2: AI grading service failed for this response. Try again.',
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initialResultsPayload,
      })

    renderTab('test')
    await screen.findByText('AI Errors Test')

    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))
    await screen.findByText('Student One')

    fireEvent.click(screen.getByLabelText('Select Student One'))
    fireEvent.click(screen.getByLabelText('Select Student Two'))
    fireEvent.click(screen.getByRole('button', { name: 'Grade 2 selected' }))

    expect(await screen.findByText('2 students: AI grading service failed for this response. Try again.')).toBeInTheDocument()
    expect(screen.queryByText(/student-1:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/student-2:/i)).not.toBeInTheDocument()
  })

  it('clears selected open scores/feedback with confirmation', async () => {
    const onTestGradingDataRefresh = vi.fn()
    const quiz = makeQuiz({
      id: 'test-clear-open-grades',
      title: 'Clear Open Grades Test',
      assessment_type: 'test',
      status: 'active',
    })

    const initialResultsPayload = {
      quiz: { id: quiz.id, title: quiz.title, grading_finalized_at: null },
      questions: [],
      stats: { open_questions_count: 0, graded_open_responses: 1, ungraded_open_responses: 0, grading_finalized: false },
      students: [
        {
          student_id: 'student-1',
          name: 'Student One',
          email: 'student1@example.com',
          status: 'submitted',
          submitted_at: '2026-02-25T15:06:00.000Z',
          last_activity_at: '2026-02-25T23:07:00.000Z',
          points_earned: 4,
          points_possible: 6,
          percent: 66.7,
          graded_open_responses: 1,
          ungraded_open_responses: 0,
          focus_summary: null,
        },
      ],
    }

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quizzes: [quiz] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initialResultsPayload,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cleared_students: 1,
          skipped_students: 0,
          cleared_responses: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => initialResultsPayload,
      })

    renderTab('test', { onTestGradingDataRefresh })
    await screen.findByText('Clear Open Grades Test')

    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))
    await screen.findByText('Student One')

    fireEvent.click(screen.getByLabelText('Select Student One'))
    fireEvent.click(screen.getByRole('button', { name: 'Grade options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear open scores/feedback' }))

    expect(await screen.findByText('Clear open scores and feedback for 1 selected student(s)?')).toBeInTheDocument()
    expect(screen.getByText('This removes all open-response scores and feedback (including AI grading metadata) for the selected students.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear Open Grades' }))

    await waitFor(() => {
      const clearCall = fetchMock.mock.calls.find(
        ([url]: [string]) => typeof url === 'string' && url.includes('/api/teacher/tests/test-clear-open-grades/clear-open-grades')
      )
      expect(clearCall).toBeDefined()
      const [, init] = clearCall as [string, RequestInit]
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({
        student_ids: ['student-1'],
      })
    })

    await waitFor(() => {
      expect(onTestGradingDataRefresh).toHaveBeenCalledOnce()
    })
  })
})
