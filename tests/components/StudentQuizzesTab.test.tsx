import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StudentQuizzesTab } from '@/app/classrooms/[classroomId]/StudentQuizzesTab'
import {
  STUDENT_TEST_EXAM_MODE_CHANGE_EVENT,
} from '@/lib/events'
import { createMockClassroom } from '../helpers/mocks'

describe('StudentQuizzesTab exam mode', () => {
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

  function queueTestList() {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        quizzes: [{
          id: 'test-1',
          title: 'Midterm Test',
          assessment_type: 'test',
          status: 'active',
          show_results: false,
          position: 0,
          student_status: 'not_started',
        }],
      }),
    })
  }

  function queueTestDetail() {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        quiz: {
          id: 'test-1',
          title: 'Midterm Test',
          assessment_type: 'test',
          status: 'active',
          show_results: false,
          position: 0,
          student_status: 'not_started',
        },
        student_status: 'not_started',
        questions: [
          {
            id: 'q1',
            quiz_id: 'test-1',
            question_text: '2 + 2 = ?',
            options: ['3', '4'],
            question_type: 'multiple_choice',
            points: 1,
            response_max_chars: 5000,
            position: 0,
          },
        ],
        student_responses: {},
        focus_summary: null,
      }),
    })
  }

  it('prompts before leaving an active test and logs exit attempts', async () => {
    const focusBodies: Array<Record<string, any>> = []
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes('/api/student/tests?classroom_id=')) {
        return {
          ok: true,
          json: async () => ({
            quizzes: [{
              id: 'test-1',
              title: 'Midterm Test',
              assessment_type: 'test',
              status: 'active',
              show_results: false,
              position: 0,
              student_status: 'not_started',
            }],
          }),
        }
      }

      if (url.endsWith('/api/student/tests/test-1')) {
        return {
          ok: true,
          json: async () => ({
            quiz: {
              id: 'test-1',
              title: 'Midterm Test',
              assessment_type: 'test',
              status: 'active',
              show_results: false,
              position: 0,
              student_status: 'not_started',
            },
            student_status: 'not_started',
            questions: [
              {
                id: 'q1',
                quiz_id: 'test-1',
                question_text: '2 + 2 = ?',
                options: ['3', '4'],
                question_type: 'multiple_choice',
                points: 1,
                response_max_chars: 5000,
                position: 0,
              },
            ],
            student_responses: {},
            focus_summary: null,
          }),
        }
      }

      if (url.includes('/api/student/tests/test-1/focus-events')) {
        const parsedBody = JSON.parse(String(options?.body || '{}')) as Record<string, any>
        focusBodies.push(parsedBody)
        return {
          ok: true,
          json: async () => ({
            success: true,
            focus_summary: {
              away_count: 0,
              away_total_seconds: 0,
              route_exit_attempts: focusBodies.length,
              last_away_started_at: null,
              last_away_ended_at: null,
            },
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(
      <StudentQuizzesTab classroom={classroom} assessmentType="test" />
    )

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))

    await waitFor(() => {
      expect(screen.getByText('Back to tests')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Back to tests'))

    await waitFor(() => {
      expect(screen.getByText('Leave this test?')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Stay in test'))
    await waitFor(() => {
      expect(screen.queryByText('Leave this test?')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Back to tests'))
    await waitFor(() => {
      expect(screen.getByText('Leave this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Leave test'))

    await waitFor(() => {
      expect(screen.queryByText('Back to tests')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(focusBodies.some((body) => body.metadata?.source === 'back_button')).toBe(true)
      expect(focusBodies.some((body) => body.metadata?.source === 'leave_test')).toBe(true)
    })
  })

  it('dispatches exam mode state changes for active test sessions', async () => {
    queueTestList()
    queueTestDetail()

    const events: Array<{ active?: boolean; testId?: string | null }> = []
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean; testId?: string | null }>).detail
      events.push(detail)
    }
    window.addEventListener(STUDENT_TEST_EXAM_MODE_CHANGE_EVENT, handler)

    const { unmount } = render(
      <StudentQuizzesTab classroom={classroom} assessmentType="test" />
    )

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))

    await waitFor(() => {
      expect(events.some((event) => event.active === true && event.testId === 'test-1')).toBe(true)
    })

    unmount()

    await waitFor(() => {
      expect(events.some((event) => event.active === false)).toBe(true)
    })

    window.removeEventListener(STUDENT_TEST_EXAM_MODE_CHANGE_EVENT, handler)
  })
})
