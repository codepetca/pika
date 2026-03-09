import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TestStudentGradingPanel } from '@/components/TestStudentGradingPanel'

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

describe('TestStudentGradingPanel save-all grading', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('removes per-question AI/single-save actions and saves edits via registered handler', async () => {
    let persistedScore: number | null = null
    let persistedFeedback: string | null = null
    const patchBodies: Array<Record<string, unknown>> = []

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/teacher/tests/test-1/results')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeResultsPayload(persistedScore, persistedFeedback),
        })
      }
      if (url.endsWith('/api/teacher/tests/test-1/responses/response-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>
        patchBodies.push(body)
        if (body.clear_grade === true) {
          persistedScore = null
          persistedFeedback = null
        } else {
          persistedScore = Number(body.score)
          persistedFeedback = typeof body.feedback === 'string' ? body.feedback : null
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ response: { id: 'response-1' } }),
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
          score: 4,
          feedback: '',
        }),
      ])
    })
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
      if (url.endsWith('/api/teacher/tests/test-1/responses/response-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>
        patchBodies.push(body)
        persistedScore = null
        persistedFeedback = null
        return Promise.resolve({
          ok: true,
          json: async () => ({ response: { id: 'response-1' } }),
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
        { clear_grade: true },
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
})
