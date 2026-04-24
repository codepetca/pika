import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TestStudentGradingPanel } from '@/components/TestStudentGradingPanel'
import { TEACHER_TEST_GRADING_ROW_UPDATED_EVENT } from '@/lib/events'

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

vi.mock('@/components/QuestionMarkdown', () => ({
  QuestionMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('@/ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props} />,
}))

function makeResultsPayload(score: number | null, feedback: string | null) {
  return {
    quiz: { id: 'test-1', title: 'Unit Test' },
    questions: [
      {
        id: 'q-open-1',
        question_text: 'Explain osmosis.',
        question_type: 'open_response' as const,
        options: [],
        points: 5,
      },
    ],
    students: [
      {
        student_id: 'student-1',
        name: 'Student One',
        email: 'student1@example.com',
        status: 'submitted' as const,
        submitted_at: '2026-03-08T12:00:00.000Z',
        last_activity_at: '2026-03-08T12:01:00.000Z',
        points_earned: score ?? 0,
        points_possible: 5,
        percent: score == null ? null : (score / 5) * 100,
        graded_open_responses: score == null ? 0 : 1,
        ungraded_open_responses: score == null ? 1 : 0,
        answers: {
          'q-open-1': {
            response_id: 'response-1',
            question_type: 'open_response' as const,
            selected_option: null,
            response_text: 'Water moves to balance concentration.',
            score,
            feedback,
            graded_at: score == null ? null : '2026-03-08T12:05:00.000Z',
          },
        },
        focus_summary: null,
      },
    ],
  }
}

function makeMixedResultsPayload(
  mcScore: number,
  openScore: number | null,
  feedback: string | null,
  options: {
    selectedOption?: number
    correctOption?: number | null
  } = {}
) {
  const selectedOption = options.selectedOption ?? 1
  const correctOption = options.correctOption ?? 1
  return {
    quiz: { id: 'test-1', title: 'Unit Test' },
    questions: [
      {
        id: 'q-mc-1',
        question_text: 'What is 2 + 2?',
        question_type: 'multiple_choice' as const,
        options: ['3', '4', '5'],
        correct_option: correctOption,
        points: 2,
      },
      {
        id: 'q-open-1',
        question_text: 'Explain osmosis.',
        question_type: 'open_response' as const,
        options: [],
        correct_option: null,
        points: 5,
      },
    ],
    students: [
      {
        student_id: 'student-1',
        name: 'Student One',
        email: 'student1@example.com',
        status: 'submitted' as const,
        submitted_at: '2026-03-08T12:00:00.000Z',
        last_activity_at: '2026-03-08T12:01:00.000Z',
        points_earned: mcScore + (openScore ?? 0),
        points_possible: 7,
        percent: ((mcScore + (openScore ?? 0)) / 7) * 100,
        graded_open_responses: openScore == null ? 0 : 1,
        ungraded_open_responses: openScore == null ? 1 : 0,
        answers: {
          'q-mc-1': {
            response_id: 'response-mc-1',
            question_type: 'multiple_choice' as const,
            selected_option: selectedOption,
            response_text: null,
            score: mcScore,
            feedback: null,
            graded_at: '2026-03-08T12:04:00.000Z',
          },
          'q-open-1': {
            response_id: 'response-open-1',
            question_type: 'open_response' as const,
            selected_option: null,
            response_text: 'Water moves to balance concentration.',
            score: openScore,
            feedback,
            graded_at: openScore == null ? null : '2026-03-08T12:05:00.000Z',
          },
        },
        focus_summary: null,
      },
    ],
  }
}

describe('TestStudentGradingPanel save-all grading', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('removes per-question AI/single-save actions and saves edits via registered handler', async () => {
    let persistedScore: number | null = null
    let persistedFeedback: string | null = null
    const patchBodies: Array<Record<string, unknown>> = []
    const gradingRowUpdates: Array<CustomEvent> = []
    const handleGradingRowUpdated = (event: Event) => {
      gradingRowUpdates.push(event as CustomEvent)
    }
    window.addEventListener(TEACHER_TEST_GRADING_ROW_UPDATED_EVENT, handleGradingRowUpdated, { once: true })

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/teacher/tests/test-1/results')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeResultsPayload(persistedScore, persistedFeedback),
        })
      }
      if (url.endsWith('/api/teacher/tests/test-1/students/student-1/grades') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>
        patchBodies.push(body)
        const grade = Array.isArray(body.grades) ? (body.grades[0] as Record<string, unknown>) : null
        if (grade?.clear_grade === true) {
          persistedScore = null
          persistedFeedback = null
        } else {
          persistedScore = Number(grade?.score)
          persistedFeedback = typeof grade?.feedback === 'string' ? grade.feedback : null
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ saved_count: 1 }),
        })
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    let saveHandler: (() => Promise<void>) | null = null
    const saveStates: Array<{ canSave: boolean; isSaving: boolean }> = []

    const user = userEvent.setup()
    render(
      <TestStudentGradingPanel
        testId="test-1"
        selectedStudentId="student-1"
        onRegisterSaveHandler={(handler) => {
          saveHandler = handler
        }}
        onSaveStateChange={(state) => {
          saveStates.push(state)
        }}
      />
    )

    await screen.findByText('Water moves to balance concentration.')
    expect(screen.queryByRole('button', { name: 'AI Suggest' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Grade' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(typeof saveHandler).toBe('function')
    })

    const scoreInput = screen.getByRole('spinbutton')
    await user.clear(scoreInput)
    await user.type(scoreInput, '4')

    await waitFor(() => {
      expect(saveStates.at(-1)).toMatchObject({ canSave: true, isSaving: false })
    })

    await act(async () => {
      await saveHandler?.()
    })

    await waitFor(() => {
      expect(patchBodies).toEqual([
        expect.objectContaining({
          grades: [
            expect.objectContaining({
              question_id: 'q-open-1',
              score: 4,
              feedback: '',
            }),
          ],
        }),
      ])
    })

    await waitFor(() => {
      expect(gradingRowUpdates).toHaveLength(1)
    })
    expect(gradingRowUpdates[0].detail).toMatchObject({
      testId: 'test-1',
      studentId: 'student-1',
      pointsEarned: 4,
      pointsPossible: 5,
      percent: 80,
      gradedOpenResponses: 1,
      ungradedOpenResponses: 0,
    })

    const resultsCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([input]) =>
      String(input).endsWith('/api/teacher/tests/test-1/results')
    )
    expect(resultsCalls).toHaveLength(1)
  })

  it('renders score inputs for MC and open questions and saves MC overrides', async () => {
    let persistedMcScore = 2
    let persistedOpenScore: number | null = 3
    let persistedOpenFeedback: string | null = 'Solid explanation.'
    const patchCalls: Array<{ url: string; body: Record<string, unknown> }> = []

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/teacher/tests/test-1/results')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeMixedResultsPayload(
            persistedMcScore,
            persistedOpenScore,
            persistedOpenFeedback
          ),
        })
      }

      if (url.endsWith('/api/teacher/tests/test-1/students/student-1/grades') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>
        patchCalls.push({ url, body })
        const grades = Array.isArray(body.grades) ? (body.grades as Array<Record<string, unknown>>) : []
        const mcGrade = grades.find((grade) => grade.question_id === 'q-mc-1')
        const openGrade = grades.find((grade) => grade.question_id === 'q-open-1')
        if (mcGrade) {
          persistedMcScore = Number(mcGrade.score)
        }
        if (openGrade && openGrade.clear_grade !== true) {
          persistedOpenScore = Number(openGrade.score)
          persistedOpenFeedback = typeof openGrade.feedback === 'string' ? openGrade.feedback : null
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ saved_count: grades.length }),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    let saveHandler: (() => Promise<void>) | null = null
    const user = userEvent.setup()
    render(
      <TestStudentGradingPanel
        testId="test-1"
        selectedStudentId="student-1"
        onRegisterSaveHandler={(handler) => {
          saveHandler = handler
        }}
      />
    )

    const scoreInputs = await screen.findAllByRole('spinbutton')
    expect(scoreInputs).toHaveLength(2)
    expect(screen.queryByText(/pts/i)).not.toBeInTheDocument()

    await user.clear(scoreInputs[0])
    await user.type(scoreInputs[0], '1')

    await act(async () => {
      await saveHandler?.()
    })

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1)
    })
    expect(patchCalls[0]).toMatchObject({
      url: expect.stringContaining('/students/student-1/grades'),
      body: {
        grades: [
          { question_id: 'q-mc-1', score: 1 },
        ],
      },
    })
  })

  it('highlights incorrect MC answers and shows the correct answer', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/teacher/tests/test-1/results')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeMixedResultsPayload(0, null, null, { correctOption: 2 }),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    render(
      <TestStudentGradingPanel
        testId="test-1"
        selectedStudentId="student-1"
      />
    )

    await screen.findByText('Student answer')

    const studentAnswerLabel = screen.getByText('Student answer')
    const studentAnswerBlock = studentAnswerLabel.closest('div')
    const correctAnswerLabel = screen.getByText('Correct answer')
    const correctAnswerBlock = correctAnswerLabel.closest('div')

    expect(studentAnswerLabel.className).toContain('text-warning')
    expect(studentAnswerBlock).not.toBeNull()
    expect(correctAnswerBlock).not.toBeNull()
    expect(within(studentAnswerBlock!).getByText('4').className).toContain('text-warning')
    expect(correctAnswerLabel).toBeInTheDocument()
    expect(within(correctAnswerBlock!).getByText('5')).toBeInTheDocument()
  })

  it('does not highlight correct MC answers', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/teacher/tests/test-1/results')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeMixedResultsPayload(2, null, null),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    render(
      <TestStudentGradingPanel
        testId="test-1"
        selectedStudentId="student-1"
      />
    )

    await screen.findByText('Student answer')

    const studentAnswerLabel = screen.getByText('Student answer')
    const studentAnswerBlock = studentAnswerLabel.closest('div')
    const correctAnswerLabel = screen.getByText('Correct answer')
    const correctAnswerBlock = correctAnswerLabel.closest('div')

    expect(studentAnswerLabel.className).not.toContain('text-warning')
    expect(studentAnswerBlock).not.toBeNull()
    expect(correctAnswerBlock).not.toBeNull()
    expect(within(studentAnswerBlock!).getByText('4').className).not.toContain('text-warning')
    expect(within(correctAnswerBlock!).getByText('4')).toBeInTheDocument()
  })

  it('saves cleared score/feedback as clear_grade through save-all handler', async () => {
    let persistedScore: number | null = 4
    let persistedFeedback: string | null = 'Nice work'
    const patchBodies: Array<Record<string, unknown>> = []

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/teacher/tests/test-1/results')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeResultsPayload(persistedScore, persistedFeedback),
        })
      }
      if (url.endsWith('/api/teacher/tests/test-1/students/student-1/grades') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>
        patchBodies.push(body)
        persistedScore = null
        persistedFeedback = null
        return Promise.resolve({
          ok: true,
          json: async () => ({ saved_count: 1 }),
        })
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    let saveHandler: (() => Promise<void>) | null = null
    const user = userEvent.setup()
    render(
      <TestStudentGradingPanel
        testId="test-1"
        selectedStudentId="student-1"
        onRegisterSaveHandler={(handler) => {
          saveHandler = handler
        }}
      />
    )

    const scoreInput = await screen.findByRole('spinbutton')
    const feedbackInput = screen.getByRole('textbox')
    await user.clear(scoreInput)
    await user.clear(feedbackInput)

    await act(async () => {
      await saveHandler?.()
    })

    await waitFor(() => {
      expect(patchBodies).toEqual([
        { grades: [{ question_id: 'q-open-1', clear_grade: true }] },
      ])
    })
  })

  it('reloads results when refreshToken changes', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeResultsPayload(2, 'Initial feedback'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeResultsPayload(5, 'Updated feedback'),
      })

    const { rerender } = render(
      <TestStudentGradingPanel
        testId="test-1"
        selectedStudentId="student-1"
        refreshToken={0}
      />
    )

    await screen.findByDisplayValue('2')
    await screen.findByDisplayValue('Initial feedback')

    rerender(
      <TestStudentGradingPanel
        testId="test-1"
        selectedStudentId="student-1"
        refreshToken={1}
      />
    )

    await screen.findByDisplayValue('5')
    await screen.findByDisplayValue('Updated feedback')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('autosaves feedback with debounce instead of per keypress', async () => {
    const patchBodies: Array<Record<string, unknown>> = []

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/teacher/tests/test-1/results')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeResultsPayload(null, null),
        })
      }
      if (url.endsWith('/api/teacher/tests/test-1/students/student-1/grades') && init?.method === 'PATCH') {
        patchBodies.push(JSON.parse(String(init.body || '{}')) as Record<string, unknown>)
        return Promise.resolve({
          ok: true,
          json: async () => ({ saved_count: 1 }),
        })
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    render(
      <TestStudentGradingPanel
        testId="test-1"
        selectedStudentId="student-1"
      />
    )

    const scoreInput = await screen.findByRole('spinbutton')
    const feedbackInput = screen.getByRole('textbox')

    fireEvent.change(scoreInput, { target: { value: '4' } })
    fireEvent.change(feedbackInput, { target: { value: 'Great' } })
    fireEvent.change(feedbackInput, { target: { value: 'Great detail.' } })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800))
    })
    expect(patchBodies).toHaveLength(0)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600))
    })

    await waitFor(() => {
      expect(patchBodies).toHaveLength(1)
    })
    expect(patchBodies[0]).toMatchObject({
      grades: [
        {
          question_id: 'q-open-1',
          score: 4,
          feedback: 'Great detail.',
        },
      ],
    })
  })
})
