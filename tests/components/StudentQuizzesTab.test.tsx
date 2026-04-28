import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StudentQuizzesTab } from '@/app/classrooms/[classroomId]/StudentQuizzesTab'
import {
  STUDENT_TEST_EXAM_MODE_CHANGE_EVENT,
  STUDENT_TEST_ROUTE_EXIT_ATTEMPT_EVENT,
} from '@/lib/events'
import type { QuizFocusSummary } from '@/types'
import { createMockClassroom } from '../helpers/mocks'

describe('StudentQuizzesTab exam mode', () => {
  const classroom = createMockClassroom()
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    vi.useRealTimers()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1024,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 768,
    })
    Object.defineProperty(window.screen, 'availWidth', {
      configurable: true,
      value: 1024,
    })
    Object.defineProperty(window.screen, 'availHeight', {
      configurable: true,
      value: 768,
    })
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

  function getSplitContainer(container: HTMLElement): HTMLDivElement {
    const splitContainer = container.querySelector(
      '[data-testid="student-test-split-container"]'
    )

    if (!splitContainer || !(splitContainer instanceof HTMLDivElement)) {
      throw new Error('Split container not found')
    }
    return splitContainer
  }

  function querySplitContainer(container: HTMLElement): HTMLDivElement | null {
    const splitContainer = container.querySelector(
      '[data-testid="student-test-split-container"]'
    )
    return splitContainer instanceof HTMLDivElement ? splitContainer : null
  }

  function makeFocusSummary(overrides: Partial<QuizFocusSummary> = {}): QuizFocusSummary {
    return {
      exit_count: 0,
      away_count: 0,
      away_total_seconds: 0,
      route_exit_attempts: 0,
      window_unmaximize_attempts: 0,
      last_away_started_at: null,
      last_away_ended_at: null,
      ...overrides,
    }
  }

  function mockFullscreenSuccess() {
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })

    const requestFullscreen = vi.fn().mockImplementation(async () => {
      fullscreenElement = document.documentElement
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })

    return { requestFullscreen }
  }

  it('does not show an in-panel exit control for active tests', async () => {
    queueTestList()
    queueTestDetail()

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    expect(screen.queryByText('Start this test?')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))

    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('exam-content-obscurer')).not.toBeInTheDocument()
    expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    expect(screen.queryByText('Exit Test')).not.toBeInTheDocument()
    expect(screen.queryByText('Leave this test?')).not.toBeInTheDocument()
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
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(events.some((event) => event.active === true && event.testId === 'test-1')).toBe(true)
    })

    unmount()

    await waitFor(() => {
      expect(events.some((event) => event.active === false)).toBe(true)
    })

    window.removeEventListener(STUDENT_TEST_EXAM_MODE_CHANGE_EVENT, handler)
  })

  it('requests full screen when opening a not-started test', async () => {
    queueTestList()
    queueTestDetail()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        focus_summary: makeFocusSummary(),
      }),
    })
    const { requestFullscreen } = mockFullscreenSuccess()

    render(
      <StudentQuizzesTab classroom={classroom} assessmentType="test" />
    )

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(requestFullscreen).toHaveBeenCalled()
    })
  })

  it('shows a closure notice when an active test is closed remotely and returns to the tests list after acknowledgment', async () => {
    let listReads = 0
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/student/tests?classroom_id=')) {
        listReads += 1
        return {
          ok: true,
          json: async () => ({
            quizzes: [{
              id: 'test-1',
              title: 'Midterm Test',
              assessment_type: 'test',
              status: listReads === 1 ? 'active' : 'closed',
              show_results: false,
              position: 0,
              student_status: listReads === 1 ? 'not_started' : 'responded',
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

      if (url.endsWith('/api/student/tests/test-1/session-status')) {
        return {
          ok: true,
          json: async () => ({
            quiz: {
              id: 'test-1',
              status: 'closed',
              assessment_type: 'test',
              student_status: 'responded',
              returned_at: null,
            },
            student_status: 'responded',
            returned_at: null,
            can_continue: false,
            message: 'Your current work has been submitted.',
          }),
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    mockFullscreenSuccess()

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
    })

    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 30_000)).toBe(true)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('This test is closed.')).toBeInTheDocument()
    })
    expect(screen.getByText('Your current work has been submitted.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Return to tests' }))

    await waitFor(() => {
      expect(screen.queryByText('This test is closed.')).not.toBeInTheDocument()
      expect(screen.getByText('This test is closed')).toBeInTheDocument()
    })
  })

  it('shows the results-available closure copy when the returned-work session is closed remotely', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/student/tests?classroom_id=')) {
        return {
          ok: true,
          json: async () => ({
            quizzes: [
              {
                id: 'test-1',
                title: 'Midterm Test',
                assessment_type: 'test',
                status: 'active',
                show_results: false,
                position: 0,
                student_status: 'not_started',
              },
            ],
          }),
        }
      }

      if (url === '/api/student/tests/test-1') {
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

      if (url.endsWith('/api/student/tests/test-1/session-status')) {
        return {
          ok: true,
          json: async () => ({
            quiz: {
              id: 'test-1',
              status: 'closed',
              assessment_type: 'test',
              student_status: 'can_view_results',
              returned_at: '2026-01-02T00:00:00.000Z',
            },
            student_status: 'can_view_results',
            returned_at: '2026-01-02T00:00:00.000Z',
            can_continue: false,
            message: 'Your current work has been submitted. Results are now available from the tests list.',
          }),
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    mockFullscreenSuccess()

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
    })

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('This test is closed.')).toBeInTheDocument()
    })
    expect(screen.getByText('Your current work has been submitted. Results are now available from the tests list.')).toBeInTheDocument()
  })

  it('shows left-panel exits and away indicators in active test detail', async () => {
    mockFullscreenSuccess()

    fetchMock.mockImplementation(async (url: string) => {
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
              documents: [
                {
                  id: 'doc-1',
                  title: 'Node.js API',
                  url: 'https://nodejs.org/api/fs.html',
                  source: 'link',
                  snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
                  snapshot_content_type: 'text/html',
                  synced_at: '2026-04-02T12:00:00.000Z',
                },
              ],
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
            focus_summary: makeFocusSummary({
              exit_count: 4,
              away_count: 4,
              away_total_seconds: 13,
              route_exit_attempts: 2,
              window_unmaximize_attempts: 3,
            }),
          }),
        }
      }

      if (url.includes('/api/student/tests/test-1/focus-events')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            focus_summary: makeFocusSummary({
              exit_count: 4,
              away_count: 4,
              away_total_seconds: 13,
              route_exit_attempts: 2,
              window_unmaximize_attempts: 3,
            }),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/Exits 4\./)).toBeInTheDocument()
    expect(screen.getByLabelText('Away time 13s.')).toBeInTheDocument()
    expect(screen.queryByText('Window must be maximized in exam mode.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Maximize/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('exam-content-obscurer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('exam-interaction-blocker')).not.toBeInTheDocument()
    expect(screen.queryByText(/Window status:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Focus events:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Browser minimization attempts/i)).not.toBeInTheDocument()
  })

  it('uses centered detail before start and 30/70 exam mode split after start', async () => {
    mockFullscreenSuccess()

    fetchMock.mockImplementation(async (url: string) => {
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
              documents: [
                {
                  id: 'doc-1',
                  title: 'Node.js API',
                  url: 'https://nodejs.org/api/fs.html',
                  source: 'link',
                  snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
                  snapshot_content_type: 'text/html',
                  synced_at: '2026-04-02T12:00:00.000Z',
                },
              ],
              position: 0,
              student_status: 'not_started',
            },
            student_status: 'not_started',
            questions: [
              {
                id: 'q1',
                quiz_id: 'test-1',
                question_text: 'Use [Formula Sheet](https://example.com/formula.pdf). 2 + 2 = ?',
                options: ['3', '4'],
                question_type: 'multiple_choice',
                points: 1,
                response_max_chars: 5000,
                position: 0,
              },
            ],
            student_responses: {},
            focus_summary: makeFocusSummary({
              exit_count: 1,
              away_count: 1,
              away_total_seconds: 7,
              route_exit_attempts: 1,
              window_unmaximize_attempts: 1,
            }),
          }),
        }
      }

      if (url.includes('/api/student/tests/test-1/focus-events')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            focus_summary: makeFocusSummary({
              exit_count: 1,
              away_count: 1,
              away_total_seconds: 7,
              route_exit_attempts: 1,
              window_unmaximize_attempts: 1,
            }),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const { container } = render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    expect(querySplitContainer(container)).toBeNull()
    expect(screen.getByRole('button', { name: 'Back to tests' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tests' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText(/2 \+ 2 = \?/)).toBeInTheDocument()
    })

    const splitContainerAfterStart = getSplitContainer(container)
    expect(splitContainerAfterStart.className).toContain('lg:grid-cols-[30%_70%]')
    expect(splitContainerAfterStart.className).not.toContain('lg:grid-cols-[50%_50%]')
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Exam Mode' })).not.toBeInTheDocument()

    const sections = container.querySelectorAll('section')
    const leftPane = sections.item(0)
    expect(leftPane).toBeTruthy()
    expect(within(leftPane).queryByRole('heading', { name: 'Tests' })).not.toBeInTheDocument()
    expect(within(leftPane).getByRole('button', { name: 'Node.js API' })).toBeInTheDocument()
    expect(within(leftPane).getByLabelText(/Exits /)).toBeInTheDocument()
    expect(within(leftPane).getByLabelText(/Away time/)).toBeInTheDocument()
  })

  it('switches to 50/50 split when opening a doc and restores 30/70 on back', async () => {
    mockFullscreenSuccess()

    fetchMock.mockImplementation(async (url: string) => {
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
              documents: [
                {
                  id: 'doc-1',
                  title: 'Node.js API',
                  url: 'https://nodejs.org/api/fs.html',
                  source: 'link',
                  snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
                  snapshot_content_type: 'text/html',
                  synced_at: '2026-04-02T12:00:00.000Z',
                },
              ],
              position: 0,
              student_status: 'not_started',
            },
            student_status: 'not_started',
            questions: [
              {
                id: 'q1',
                quiz_id: 'test-1',
                question_text: 'Use documentation for this question.',
                options: ['A', 'B'],
                question_type: 'multiple_choice',
                points: 1,
                response_max_chars: 5000,
                position: 0,
              },
            ],
            student_responses: {},
            focus_summary: {
              away_count: 0,
              away_total_seconds: 0,
              route_exit_attempts: 0,
              window_unmaximize_attempts: 0,
              last_away_started_at: null,
              last_away_ended_at: null,
            },
          }),
        }
      }

      if (url.includes('/api/student/tests/test-1/focus-events')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            focus_summary: {
              away_count: 0,
              away_total_seconds: 0,
              route_exit_attempts: 0,
              window_unmaximize_attempts: 0,
              last_away_started_at: null,
              last_away_ended_at: null,
            },
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const { container } = render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Node.js API' })).toBeInTheDocument()
    })
    expect(container.querySelector('iframe[title="Node.js API"]')).toBeInTheDocument()

    const splitContainerExamMode = getSplitContainer(container)
    expect(splitContainerExamMode.className).toContain('lg:grid-cols-[30%_70%]')
    expect(splitContainerExamMode.className).not.toContain('lg:grid-cols-[50%_50%]')
    expect(splitContainerExamMode.className).toContain('lg:h-[calc(100dvh-3rem)]')
    expect(splitContainerExamMode.className).toContain('lg:min-h-0')

    const documentsPane = screen.getByTestId('student-test-documents-pane')
    const detailPane = screen.getByTestId('student-test-detail-pane')
    expect(documentsPane.className).toContain('min-h-0')
    expect(documentsPane.className).toContain('overflow-y-auto')
    expect(documentsPane.className).not.toContain('lg:sticky')
    expect(detailPane.className).toContain('min-h-0')
    expect(detailPane.className).toContain('overflow-y-auto')
    expect(detailPane.className).not.toContain('lg:sticky')

    const docsHeading = screen.getByRole('heading', { name: 'Documents' })
    const leftPaneScroller = docsHeading.closest('.scrollbar-hover')
    expect(leftPaneScroller).toBeInTheDocument()
    expect(leftPaneScroller?.className || '').toContain('overflow-y-auto')

    fireEvent.click(screen.getByRole('button', { name: 'Node.js API' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back to documents list' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Open in new tab' })).not.toBeInTheDocument()
    const activeIframe = container.querySelector('iframe[title="Node.js API"]')
    expect(activeIframe).toBeInTheDocument()
    expect(activeIframe?.getAttribute('src')).toBe('/api/student/tests/test-1/documents/doc-1/snapshot')
    expect(activeIframe?.className || '').toContain('w-[calc(100%+10px)]')
    expect(activeIframe?.className || '').not.toContain('group-hover:w-full')
    expect(activeIframe?.className || '').not.toContain('group-focus-within:w-full')
    expect(container.querySelector('.z-\\[1\\].w-3.bg-white')).not.toBeInTheDocument()
    const splitContainerDocOpen = getSplitContainer(container)
    expect(splitContainerDocOpen.className).toContain('lg:grid-cols-[50%_50%]')
    expect(splitContainerDocOpen.className).not.toContain('lg:grid-cols-[30%_70%]')

    fireEvent.click(screen.getByRole('button', { name: 'Back to documents list' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Node.js API' })).toBeInTheDocument()
    })
    const splitContainerBack = getSplitContainer(container)
    expect(splitContainerBack.className).toContain('lg:grid-cols-[30%_70%]')
  })

  it('renders the submit actions after the last question in an active test', async () => {
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        fullscreenElement = document.documentElement
      }),
    })
    fetchMock.mockImplementation(async (url: string) => {
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
            questions: Array.from({ length: 12 }, (_, index) => ({
              id: `q${index + 1}`,
              quiz_id: 'test-1',
              question_text: `Question ${index + 1}?`,
              options: ['A', 'B'],
              question_type: 'multiple_choice' as const,
              points: 1,
              response_max_chars: 5000,
              position: index,
            })),
            student_responses: {},
            focus_summary: makeFocusSummary(),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('Question 12?')).toBeInTheDocument()
    })

    const detailPane = screen.getByTestId('student-test-detail-pane')
    const actionFooter = within(detailPane).getByTestId('student-quiz-action-footer')
    const questionsStack = screen.getByText('Question 12?').closest('[data-question-id="q12"]')
      ?.parentElement

    expect(detailPane.className).toContain('overflow-y-auto')
    expect(questionsStack?.lastElementChild).toBe(actionFooter)
    expect(actionFooter.className).not.toContain('sticky')
    expect(within(actionFooter).getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    expect(within(actionFooter).getByText('Answer all questions to submit')).toBeInTheDocument()
  })

  it('does not record exam exits for in-window pointer dragging during an active test', async () => {
    const focusBodies: Array<Record<string, any>> = []
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        fullscreenElement = document.documentElement
      }),
    })

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
            focus_summary: makeFocusSummary(),
          }),
        }
      }

      if (url.includes('/api/student/tests/test-1/focus-events')) {
        focusBodies.push(JSON.parse(String(options?.body || '{}')) as Record<string, any>)
        return {
          ok: true,
          json: async () => ({
            success: true,
            focus_summary: makeFocusSummary(),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    const detailPane = await screen.findByTestId('student-test-detail-pane')

    fireEvent.pointerDown(detailPane, { clientX: 300, clientY: 320 })
    fireEvent.pointerMove(detailPane, { clientX: 460, clientY: 320 })
    fireEvent.pointerUp(detailPane, { clientX: 460, clientY: 320 })

    expect(focusBodies).toEqual([])
  })

  it('suppresses iframe doc-triggered fullscreen and resize exits', async () => {
    const focusBodies: Array<Record<string, any>> = []
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        fullscreenElement = document.documentElement
      }),
    })
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 900,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 700,
    })
    Object.defineProperty(window.screen, 'availWidth', {
      configurable: true,
      value: 1400,
    })
    Object.defineProperty(window.screen, 'availHeight', {
      configurable: true,
      value: 900,
    })

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
              documents: [
                {
                  id: 'doc-1',
                  title: 'Node.js API',
                  url: 'https://nodejs.org/api/fs.html',
                  source: 'link',
                  snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
                  snapshot_content_type: 'text/html',
                  synced_at: '2026-04-02T12:00:00.000Z',
                },
              ],
              position: 0,
              student_status: 'not_started',
            },
            student_status: 'not_started',
            questions: [
              {
                id: 'q1',
                quiz_id: 'test-1',
                question_text: 'Use documentation for this question.',
                options: ['A', 'B'],
                question_type: 'multiple_choice',
                points: 1,
                response_max_chars: 5000,
                position: 0,
              },
            ],
            student_responses: {},
            focus_summary: makeFocusSummary(),
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
            focus_summary: makeFocusSummary(),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const { container } = render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Node.js API' })).toBeInTheDocument()
      expect(fullscreenElement).toBe(document.documentElement)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Node.js API' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back to documents list' })).toBeInTheDocument()
    })

    const iframe = container.querySelector('iframe[title="Node.js API"]')
    expect(iframe).toBeInTheDocument()
    fireEvent.pointerEnter(iframe!)
    fullscreenElement = null
    fireEvent(document, new Event('fullscreenchange'))
    fireEvent(window, new Event('resize'))

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(focusBodies).toEqual([])
  })

  it('suppresses blur and visibility exits after text doc interaction', async () => {
    const focusBodies: Array<Record<string, any>> = []
    let visibilityState: DocumentVisibilityState = 'visible'

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
    Object.defineProperty(window, 'getSelection', {
      configurable: true,
      value: vi.fn(() => ({
        toString: () => 'Selected reference text',
      })),
    })

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
              documents: [
                {
                  id: 'doc-1',
                  title: 'Formula Sheet',
                  content: 'Solve using the quadratic formula.',
                  source: 'text',
                },
              ],
              position: 0,
              student_status: 'not_started',
            },
            student_status: 'not_started',
            questions: [
              {
                id: 'q1',
                quiz_id: 'test-1',
                question_text: 'Use the formula sheet.',
                options: ['A', 'B'],
                question_type: 'multiple_choice',
                points: 1,
                response_max_chars: 5000,
                position: 0,
              },
            ],
            student_responses: {},
            focus_summary: makeFocusSummary(),
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
            focus_summary: makeFocusSummary(),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Formula Sheet' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Formula Sheet' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back to documents list' })).toBeInTheDocument()
    })

    fireEvent.mouseUp(screen.getByText('Solve using the quadratic formula.'))
    fireEvent(window, new Event('blur'))
    visibilityState = 'hidden'
    fireEvent(document, new Event('visibilitychange'))

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(focusBodies).toEqual([])
  })

  it('does not log exit telemetry when returning from an open doc to the docs list', async () => {
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
              documents: [
                {
                  id: 'doc-1',
                  title: 'Node.js API',
                  url: 'https://nodejs.org/api/fs.html',
                  source: 'link',
                  snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
                  snapshot_content_type: 'text/html',
                  synced_at: '2026-04-02T12:00:00.000Z',
                },
              ],
              position: 0,
              student_status: 'not_started',
            },
            student_status: 'not_started',
            questions: [
              {
                id: 'q1',
                quiz_id: 'test-1',
                question_text: 'Use documentation for this question.',
                options: ['A', 'B'],
                question_type: 'multiple_choice',
                points: 1,
                response_max_chars: 5000,
                position: 0,
              },
            ],
            student_responses: {},
            focus_summary: makeFocusSummary(),
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
            focus_summary: makeFocusSummary(),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Node.js API' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Node.js API' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back to documents list' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Back to documents list' }))

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(focusBodies).toEqual([])
  })

  it('shows an unavailable state for unsynced link docs', async () => {
    fetchMock.mockImplementation(async (url: string) => {
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
              documents: [
                {
                  id: 'doc-1',
                  title: 'Node.js API',
                  url: 'https://nodejs.org/api/fs.html',
                  source: 'link',
                },
              ],
              position: 0,
              student_status: 'not_started',
            },
            student_status: 'not_started',
            questions: [
              {
                id: 'q1',
                quiz_id: 'test-1',
                question_text: 'Use documentation for this question.',
                options: ['A', 'B'],
                question_type: 'multiple_choice',
                points: 1,
                response_max_chars: 5000,
                position: 0,
              },
            ],
            student_responses: {},
            focus_summary: makeFocusSummary(),
          }),
        }
      }

      if (url.includes('/api/student/tests/test-1/focus-events')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            focus_summary: makeFocusSummary(),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Node.js API' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Node.js API' }))

    await waitFor(() => {
      expect(screen.getByText('This document is unavailable.')).toBeInTheDocument()
    })

    expect(document.querySelector('iframe[title="Node.js API"]')).not.toBeInTheDocument()
  })

  it('uses centered detail when student is viewing returned test results', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/student/tests?classroom_id=')) {
        return {
          ok: true,
          json: async () => ({
            quizzes: [{
              id: 'test-1',
              title: 'Midterm Test',
              assessment_type: 'test',
              status: 'closed',
              show_results: false,
              position: 0,
              student_status: 'can_view_results',
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
              status: 'closed',
              show_results: false,
              position: 0,
              student_status: 'can_view_results',
            },
            student_status: 'can_view_results',
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
            student_responses: {
              q1: {
                question_type: 'multiple_choice',
                selected_option: 1,
              },
            },
            focus_summary: null,
          }),
        }
      }

      if (url.endsWith('/api/student/tests/test-1/results')) {
        return {
          ok: true,
          json: async () => ({
            quiz: {
              id: 'test-1',
              title: 'Midterm Test',
              status: 'closed',
              returned_at: '2026-03-06T10:00:00.000Z',
            },
            results: [],
            question_results: [
              {
                question_id: 'q1',
                question_type: 'multiple_choice',
                question_text: '2 + 2 = ?',
                options: ['3', '4'],
                points: 1,
                response_max_chars: 5000,
                correct_option: 1,
                selected_option: 1,
                response_text: null,
                score: 1,
                feedback: 'Correct',
                graded_at: '2026-03-06T10:00:00.000Z',
                is_correct: true,
              },
            ],
            summary: {
              earned_points: 1,
              possible_points: 1,
              percent: 100,
            },
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const { container } = render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))

    await waitFor(() => {
      expect(screen.getByText('Score')).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: 'Midterm Test Results' })).toBeInTheDocument()
    expect(screen.queryByText('Your response has been submitted.')).not.toBeInTheDocument()
    expect(screen.getByText('Returned')).toBeInTheDocument()
    expect(screen.queryByText('View Results')).not.toBeInTheDocument()

    expect(querySplitContainer(container)).toBeNull()
    expect(screen.getByRole('button', { name: 'Back to tests' })).toBeInTheDocument()
  })

  it('shows Closed, Submitted, and Returned status pills for tests', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        quizzes: [
          {
            id: 'test-closed',
            title: 'Closed Test',
            assessment_type: 'test',
            status: 'closed',
            show_results: false,
            position: 0,
            student_status: 'responded',
          },
          {
            id: 'test-submitted',
            title: 'Submitted Test',
            assessment_type: 'test',
            status: 'active',
            show_results: false,
            position: 1,
            student_status: 'responded',
          },
          {
            id: 'test-returned',
            title: 'Returned Test',
            assessment_type: 'test',
            status: 'closed',
            show_results: false,
            position: 2,
            student_status: 'can_view_results',
          },
        ],
      }),
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Closed Test')).toBeInTheDocument()
      expect(screen.getByText('Submitted Test')).toBeInTheDocument()
      expect(screen.getByText('Returned Test')).toBeInTheDocument()
    })

    const closedCard = screen.getByRole('button', { name: /Closed Test/i })
    const submittedCard = screen.getByRole('button', { name: /Submitted Test/i })
    const returnedCard = screen.getByRole('button', { name: /Returned Test/i })

    expect(within(closedCard).getByText('Closed')).toBeInTheDocument()
    expect(within(submittedCard).getByText('Submitted')).toBeInTheDocument()
    expect(within(returnedCard).getByText('Returned')).toBeInTheDocument()
    expect(screen.queryByText('View Results')).not.toBeInTheDocument()
  })

  it('renders active tests before returned tests and preserves newest-first order within each bucket', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        quizzes: [
          {
            id: 'test-active-new',
            title: 'Newest Active Test',
            assessment_type: 'test',
            status: 'active',
            show_results: false,
            position: 4,
            student_status: 'not_started',
          },
          {
            id: 'test-active-old',
            title: 'Older Active Test',
            assessment_type: 'test',
            status: 'active',
            show_results: false,
            position: 2,
            student_status: 'responded',
          },
          {
            id: 'test-returned-new',
            title: 'Newest Returned Test',
            assessment_type: 'test',
            status: 'closed',
            show_results: false,
            position: 5,
            student_status: 'can_view_results',
          },
        ],
      }),
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Newest Active Test')).toBeInTheDocument()
    })

    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Newest Active Test',
      'Older Active Test',
      'Newest Returned Test',
    ])
  })

  it('renders text documents inline in the left doc panel', async () => {
    fetchMock.mockImplementation(async (url: string) => {
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
              documents: [
                {
                  id: 'doc-text-1',
                  title: 'Allowed formulas',
                  source: 'text',
                  content: 'distance = rate * time',
                },
              ],
              position: 0,
              student_status: 'not_started',
            },
            student_status: 'not_started',
            questions: [
              {
                id: 'q1',
                quiz_id: 'test-1',
                question_text: 'Use provided formulas.',
                options: ['A', 'B'],
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
        return {
          ok: true,
          json: async () => ({
            success: true,
            focus_summary: {
              away_count: 0,
              away_total_seconds: 0,
              route_exit_attempts: 0,
              window_unmaximize_attempts: 0,
              last_away_started_at: null,
              last_away_ended_at: null,
            },
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Allowed formulas' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Allowed formulas' }))

    await waitFor(() => {
      expect(screen.getByText('distance = rate * time')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Open in new tab' })).not.toBeInTheDocument()
  })

  it('refreshes list statuses after submit when returning from detail', async () => {
    let listCallCount = 0
    let detailCallCount = 0

    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes('/api/student/tests?classroom_id=')) {
        listCallCount += 1
        return {
          ok: true,
          json: async () => ({
            quizzes: [
              {
                id: 'test-1',
                title: 'Midterm Test',
                assessment_type: 'test',
                status: 'active',
                show_results: false,
                position: 0,
                student_status: listCallCount > 1 ? 'responded' : 'not_started',
              },
              {
                id: 'test-2',
                title: 'Final Test',
                assessment_type: 'test',
                status: 'active',
                show_results: false,
                position: 1,
                student_status: 'not_started',
              },
            ],
          }),
        }
      }

      if (url.endsWith('/api/student/tests/test-1')) {
        detailCallCount += 1
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
              student_status: detailCallCount > 1 ? 'responded' : 'not_started',
            },
            student_status: detailCallCount > 1 ? 'responded' : 'not_started',
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
            student_responses:
              detailCallCount > 1
                ? {
                    q1: {
                      question_type: 'multiple_choice',
                      selected_option: 1,
                    },
                  }
                : {},
            focus_summary: null,
          }),
        }
      }

      if (url.endsWith('/api/student/tests/test-1/attempt') && options?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ success: true }),
        }
      }

      if (url.endsWith('/api/student/tests/test-1/respond') && options?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" isActive={false} />)

    await waitFor(() => {
      expect(screen.getByText('Final Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('radio', { name: '4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByText('Submit your answers?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Submit' })[1])

    await waitFor(() => {
      expect(screen.getByText('Response Submitted')).toBeInTheDocument()
    })

    expect(querySplitContainer(document.body)).toBeNull()
    expect(screen.queryByText('Final Test')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to tests' }))

    await waitFor(() => {
      expect(screen.getByText('Final Test')).toBeInTheDocument()
    })
    expect(screen.getByText('Submitted')).toBeInTheDocument()
  })

  it('does not log exit telemetry for Cmd+F interruption bursts', async () => {
    const focusBodies: Array<Record<string, any>> = []
    let fullscreenElement: Element | null = null
    let visibilityState: DocumentVisibilityState = 'visible'

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        fullscreenElement = document.documentElement
      }),
    })

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
            focus_summary: makeFocusSummary(),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
      expect(fullscreenElement).toBe(document.documentElement)
    })

    fireEvent.keyDown(window, { key: 'f', metaKey: true })
    fireEvent(window, new Event('blur'))
    visibilityState = 'hidden'
    fireEvent(document, new Event('visibilitychange'))
    fullscreenElement = null
    fireEvent(document, new Event('fullscreenchange'))
    fireEvent(window, new Event('resize'))

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(focusBodies).toEqual([])
  })

  it('preserves raw window signals while counting one notification-style exit', async () => {
    const focusBodies: Array<Record<string, any>> = []
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        fullscreenElement = document.documentElement
      }),
    })

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
        const awayStarts = focusBodies.filter((body) => body.event_type === 'away_start').length
        const awayEnds = focusBodies.filter((body) => body.event_type === 'away_end').length
        const windowAttempts = focusBodies.filter(
          (body) => body.event_type === 'window_unmaximize_attempt'
        ).length
        const routeAttempts = focusBodies.filter(
          (body) => body.event_type === 'route_exit_attempt'
        ).length
        return {
          ok: true,
          json: async () => ({
            success: true,
            focus_summary: makeFocusSummary({
              exit_count: Math.max(awayStarts, windowAttempts + routeAttempts),
              away_count: awayStarts,
              route_exit_attempts: routeAttempts,
              window_unmaximize_attempts: windowAttempts,
              last_away_ended_at: awayEnds > 0 ? '2026-02-24T12:00:01.000Z' : null,
            }),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
    })

    fireEvent(window, new Event('blur'))
    fullscreenElement = null
    fireEvent(document, new Event('fullscreenchange'))
    fireEvent(window, new Event('resize'))
    fireEvent(window, new Event('focus'))

    await waitFor(() => {
      expect(focusBodies.filter((body) => body.event_type === 'away_start')).toHaveLength(1)
      expect(focusBodies.filter((body) => body.event_type === 'window_unmaximize_attempt')).toHaveLength(0)
      expect(focusBodies.filter((body) => body.event_type === 'away_end')).toHaveLength(1)
    })
  })

  it('tracks swipe-away visibility changes as one exit', async () => {
    const focusBodies: Array<Record<string, any>> = []
    let visibilityState: DocumentVisibilityState = 'visible'

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })

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
            focus_summary: makeFocusSummary({
              exit_count: focusBodies.some((body) => body.event_type === 'away_start') ? 1 : 0,
              away_count: focusBodies.filter((body) => body.event_type === 'away_start').length,
            }),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
    })

    visibilityState = 'hidden'
    fireEvent(document, new Event('visibilitychange'))
    visibilityState = 'visible'
    fireEvent(document, new Event('visibilitychange'))

    await waitFor(() => {
      expect(focusBodies.filter((body) => body.event_type === 'away_start')).toHaveLength(1)
      expect(focusBodies.filter((body) => body.event_type === 'away_end')).toHaveLength(1)
      expect(focusBodies.filter((body) => body.event_type === 'window_unmaximize_attempt')).toHaveLength(0)
    })
  })

  it('preserves raw route exit signals while the summary stays deduped', async () => {
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
        const routeExitAttempts = focusBodies.filter(
          (body) => body.event_type === 'route_exit_attempt'
        ).length
        return {
          ok: true,
          json: async () => ({
            success: true,
            focus_summary: makeFocusSummary({
              exit_count: routeExitAttempts > 0 ? 1 : 0,
              route_exit_attempts: routeExitAttempts,
            }),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
    })

    window.dispatchEvent(
      new CustomEvent(STUDENT_TEST_ROUTE_EXIT_ATTEMPT_EVENT, {
        detail: { classroomId: classroom.id, source: 'in_app_navigation' },
      })
    )
    fireEvent(window, new Event('pagehide'))

    await waitFor(() => {
      expect(focusBodies.filter((body) => body.event_type === 'route_exit_attempt')).toHaveLength(2)
    })
  })

  it('logs real route and page exits after the docs suppression window elapses', async () => {
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
              documents: [
                {
                  id: 'doc-1',
                  title: 'Node.js API',
                  url: 'https://nodejs.org/api/fs.html',
                  source: 'link',
                  snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
                  snapshot_content_type: 'text/html',
                  synced_at: '2026-04-02T12:00:00.000Z',
                },
              ],
              position: 0,
              student_status: 'not_started',
            },
            student_status: 'not_started',
            questions: [
              {
                id: 'q1',
                quiz_id: 'test-1',
                question_text: 'Use documentation for this question.',
                options: ['A', 'B'],
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
        const routeExitAttempts = focusBodies.filter(
          (body) => body.event_type === 'route_exit_attempt'
        ).length
        return {
          ok: true,
          json: async () => ({
            success: true,
            focus_summary: makeFocusSummary({
              exit_count: routeExitAttempts > 0 ? 1 : 0,
              route_exit_attempts: routeExitAttempts,
            }),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Node.js API' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Node.js API' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back to documents list' })).toBeInTheDocument()
    })

    const iframe = document.querySelector('iframe[title="Node.js API"]')
    expect(iframe).toBeInTheDocument()
    fireEvent.pointerEnter(iframe!)
    await new Promise((resolve) => setTimeout(resolve, 1250))

    window.dispatchEvent(
      new CustomEvent(STUDENT_TEST_ROUTE_EXIT_ATTEMPT_EVENT, {
        detail: { classroomId: classroom.id, source: 'in_app_navigation' },
      })
    )
    fireEvent(window, new Event('pagehide'))

    await waitFor(() => {
      expect(focusBodies.filter((body) => body.event_type === 'route_exit_attempt')).toHaveLength(2)
    })
  })

  it('keeps the question visible on transient fullscreen loss when the window still looks maximized', async () => {
    const focusBodies: Array<Record<string, any>> = []
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        fullscreenElement = document.documentElement
        document.dispatchEvent(new Event('fullscreenchange'))
      }),
    })

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
            focus_summary: makeFocusSummary(),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
      expect(fullscreenElement).toBe(document.documentElement)
    })

    vi.useFakeTimers()
    fullscreenElement = null
    fireEvent(document, new Event('fullscreenchange'))

    await act(async () => {
      vi.advanceTimersByTime(450)
    })

    expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
    expect(screen.queryByTestId('exam-content-obscurer')).not.toBeInTheDocument()
    expect(focusBodies.filter((body) => body.event_type === 'window_unmaximize_attempt')).toHaveLength(0)
  })

  it('locks after sustained fullscreen loss when the window remains non-compliant', async () => {
    const focusBodies: Array<Record<string, any>> = []
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        fullscreenElement = document.documentElement
        document.dispatchEvent(new Event('fullscreenchange'))
      }),
    })

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
            focus_summary: makeFocusSummary({
              window_unmaximize_attempts: focusBodies.filter(
                (body) => body.event_type === 'window_unmaximize_attempt'
              ).length,
            }),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
      expect(fullscreenElement).toBe(document.documentElement)
    })

    vi.useFakeTimers()
    fullscreenElement = null
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 900,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 700,
    })
    Object.defineProperty(window.screen, 'availWidth', {
      configurable: true,
      value: 1400,
    })
    Object.defineProperty(window.screen, 'availHeight', {
      configurable: true,
      value: 900,
    })
    fireEvent(document, new Event('fullscreenchange'))

    await act(async () => {
      vi.advanceTimersByTime(450)
    })

    expect(screen.getByTestId('exam-content-obscurer')).toBeInTheDocument()
    expect(screen.getByText('2 + 2 = ?')).not.toBeVisible()
    expect(
      focusBodies.some(
        (body) =>
          body.event_type === 'window_unmaximize_attempt' &&
          body.metadata?.source === 'fullscreen_exit'
      )
    ).toBe(true)
  })

  it('cancels the pending lock when compliance returns before the grace window expires', async () => {
    const focusBodies: Array<Record<string, any>> = []
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        fullscreenElement = document.documentElement
        document.dispatchEvent(new Event('fullscreenchange'))
      }),
    })

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
            focus_summary: makeFocusSummary(),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
      expect(fullscreenElement).toBe(document.documentElement)
    })

    vi.useFakeTimers()
    fullscreenElement = null
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 900,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 700,
    })
    Object.defineProperty(window.screen, 'availWidth', {
      configurable: true,
      value: 1400,
    })
    Object.defineProperty(window.screen, 'availHeight', {
      configurable: true,
      value: 900,
    })
    fireEvent(document, new Event('fullscreenchange'))

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1024,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 768,
    })
    Object.defineProperty(window.screen, 'availWidth', {
      configurable: true,
      value: 1024,
    })
    Object.defineProperty(window.screen, 'availHeight', {
      configurable: true,
      value: 768,
    })
    fireEvent(window, new Event('resize'))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
    expect(screen.queryByTestId('exam-content-obscurer')).not.toBeInTheDocument()
    expect(focusBodies.filter((body) => body.event_type === 'window_unmaximize_attempt')).toHaveLength(0)
  })

  it('locks after the grace window when exam mode window is reduced', async () => {
    const focusBodies: Array<Record<string, any>> = []
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        fullscreenElement = document.documentElement
        document.dispatchEvent(new Event('fullscreenchange'))
      }),
    })

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
              route_exit_attempts: 0,
              window_unmaximize_attempts: focusBodies.filter(
                (body) => body.event_type === 'window_unmaximize_attempt'
              ).length,
              last_away_started_at: null,
              last_away_ended_at: null,
            },
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
      expect(fullscreenElement).toBe(document.documentElement)
    })

    vi.useFakeTimers()
    fullscreenElement = null
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 900,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 700,
    })
    Object.defineProperty(window.screen, 'availWidth', {
      configurable: true,
      value: 1400,
    })
    Object.defineProperty(window.screen, 'availHeight', {
      configurable: true,
      value: 900,
    })
    fireEvent(window, new Event('resize'))

    await act(async () => {
      vi.advanceTimersByTime(450)
    })

    expect(screen.getByTestId('exam-content-obscurer')).toBeInTheDocument()
    expect(screen.getByText('2 + 2 = ?')).not.toBeVisible()
    expect(
      focusBodies.some(
        (body) =>
          body.event_type === 'window_unmaximize_attempt' &&
          body.metadata?.source === 'window_resize'
      )
    ).toBe(true)
  })

  it('keeps the active test visible when an answer tap causes a transient resize', async () => {
    const focusBodies: Array<Record<string, any>> = []
    let fullscreenElement: Element | null = null

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        fullscreenElement = document.documentElement
        document.dispatchEvent(new Event('fullscreenchange'))
      }),
    })

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
              route_exit_attempts: 0,
              window_unmaximize_attempts: focusBodies.filter(
                (body) => body.event_type === 'window_unmaximize_attempt'
              ).length,
              last_away_started_at: null,
              last_away_ended_at: null,
            },
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(screen.getByText('2 + 2 = ?')).toBeInTheDocument()
      expect(fullscreenElement).toBe(document.documentElement)
    })

    vi.useFakeTimers()
    const answer = screen.getByText('3')
    fireEvent.pointerDown(answer)
    fireEvent.click(answer)

    fullscreenElement = null
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 900,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 700,
    })
    Object.defineProperty(window.screen, 'availWidth', {
      configurable: true,
      value: 1400,
    })
    Object.defineProperty(window.screen, 'availHeight', {
      configurable: true,
      value: 900,
    })
    fireEvent(window, new Event('resize'))

    await act(async () => {
      vi.advanceTimersByTime(450)
    })

    expect(screen.queryByTestId('exam-content-obscurer')).not.toBeInTheDocument()
    expect(screen.getByText('2 + 2 = ?')).toBeVisible()
    expect(screen.getByText('3').closest('label')).toHaveClass('border-primary')
    expect(
      focusBodies.some(
        (body) =>
          body.event_type === 'window_unmaximize_attempt' &&
          body.metadata?.source === 'window_resize'
      )
    ).toBe(false)

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    })
    fireEvent(window, new Event('resize'))

    await act(async () => {
      vi.advanceTimersByTime(1_600)
    })

    expect(screen.queryByTestId('exam-content-obscurer')).not.toBeInTheDocument()
    expect(screen.getByText('2 + 2 = ?')).toBeVisible()
  })

  it('keeps mobile browsers without fullscreen support usable after re-entering a saved test', async () => {
    const requestFullscreenDescriptor = Object.getOwnPropertyDescriptor(
      document.documentElement,
      'requestFullscreen'
    )
    const maxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      'maxTouchPoints'
    )
    let savedResponses: Record<string, unknown> = {
      q1: { question_type: 'multiple_choice', selected_option: 2 },
    }

    try {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => null,
      })
      Object.defineProperty(document.documentElement, 'requestFullscreen', {
        configurable: true,
        value: undefined,
      })
      Object.defineProperty(window.navigator, 'maxTouchPoints', {
        configurable: true,
        value: 5,
      })
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: 390,
      })
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        writable: true,
        value: 664,
      })
      Object.defineProperty(window.screen, 'availWidth', {
        configurable: true,
        value: 390,
      })
      Object.defineProperty(window.screen, 'availHeight', {
        configurable: true,
        value: 844,
      })

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

        if (url.includes('/api/student/tests/test-1/session-status')) {
          return {
            ok: true,
            json: async () => ({
              quiz: {
                id: 'test-1',
                status: 'active',
                assessment_type: 'test',
                student_status: 'not_started',
                returned_at: null,
              },
              student_status: 'not_started',
              returned_at: null,
              can_continue: true,
              message: null,
            }),
          }
        }

        if (url.includes('/api/student/tests/test-1') && !url.includes('/session-status') && !url.includes('/focus-events') && !url.includes('/attempt')) {
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
                  question_text: 'Which HTTP method is usually used for partial updates?',
                  options: ['GET', 'POST', 'PATCH', 'DELETE'],
                  question_type: 'multiple_choice',
                  points: 1,
                  response_max_chars: 5000,
                  position: 0,
                },
              ],
              student_responses: savedResponses,
              focus_summary: makeFocusSummary(),
            }),
          }
        }

        if (url.includes('/api/student/tests/test-1/attempt') && options?.method === 'PATCH') {
          const body = JSON.parse(String(options.body || '{}')) as { responses?: Record<string, unknown> }
          savedResponses = body.responses || {}
          return {
            ok: true,
            json: async () => ({
              attempt: {
                id: 'attempt-1',
                responses: savedResponses,
                is_submitted: false,
              },
            }),
          }
        }

        if (url.includes('/api/student/tests/test-1/focus-events')) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              focus_summary: makeFocusSummary(),
            }),
          }
        }

        throw new Error(`Unexpected fetch call: ${url}`)
      })

      render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

      await waitFor(() => {
        expect(screen.getByText('Midterm Test')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Midterm Test'))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
      await waitFor(() => {
        expect(screen.getByText('Start this test?')).toBeInTheDocument()
      })

      vi.useFakeTimers()
      fireEvent.click(screen.getByText('Start test'))

      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.getByText('Which HTTP method is usually used for partial updates?')).toBeInTheDocument()
      expect(screen.getByText('PATCH').closest('label')).toHaveClass('border-primary')

      fireEvent.click(screen.getByText('GET'))

      await act(async () => {
        vi.advanceTimersByTime(450)
        await Promise.resolve()
      })

      expect(screen.queryByTestId('exam-content-obscurer')).not.toBeInTheDocument()
      expect(screen.getByText('Which HTTP method is usually used for partial updates?')).toBeVisible()
      expect(screen.getByText('GET').closest('label')).toHaveClass('border-primary')

      await act(async () => {
        vi.advanceTimersByTime(5_000)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(savedResponses).toEqual({
        q1: { question_type: 'multiple_choice', selected_option: 0 },
      })
    } finally {
      if (requestFullscreenDescriptor) {
        Object.defineProperty(document.documentElement, 'requestFullscreen', requestFullscreenDescriptor)
      } else {
        delete (document.documentElement as HTMLElement & { requestFullscreen?: unknown }).requestFullscreen
      }

      if (maxTouchPointsDescriptor) {
        Object.defineProperty(window.navigator, 'maxTouchPoints', maxTouchPointsDescriptor)
      } else {
        delete (window.navigator as Navigator & { maxTouchPoints?: unknown }).maxTouchPoints
      }
    }
  })

  it('preserves unsaved in-progress test answers when exam window compliance changes', async () => {
    let fullscreenElement: Element | null = null
    let savedResponses: Record<string, unknown> = {}
    const focusBodies: Array<Record<string, any>> = []

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockImplementation(async () => {
        fullscreenElement = document.documentElement
        document.dispatchEvent(new Event('fullscreenchange'))
      }),
    })

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

      if (url.includes('/api/student/tests/test-1/session-status')) {
        return {
          ok: true,
          json: async () => ({
            quiz: {
              id: 'test-1',
              status: 'active',
              assessment_type: 'test',
              student_status: 'not_started',
              returned_at: null,
            },
            student_status: 'not_started',
            returned_at: null,
            can_continue: true,
            message: null,
          }),
        }
      }

      if (url.includes('/api/student/tests/test-1') && !url.includes('/session-status') && !url.includes('/focus-events') && !url.includes('/attempt')) {
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
              {
                id: 'q2',
                quiz_id: 'test-1',
                question_text: 'Explain one benefit of writing tests before implementation.',
                options: [],
                question_type: 'open_response',
                points: 4,
                response_max_chars: 5000,
                position: 1,
              },
            ],
            student_responses: savedResponses,
            focus_summary: makeFocusSummary({
              window_unmaximize_attempts: focusBodies.filter(
                (body) => body.event_type === 'window_unmaximize_attempt'
              ).length,
            }),
          }),
        }
      }

      if (url.includes('/api/student/tests/test-1/attempt') && options?.method === 'PATCH') {
        const body = JSON.parse(String(options.body || '{}')) as { responses?: Record<string, unknown> }
        savedResponses = body.responses || {}
        return {
          ok: true,
          json: async () => ({
            attempt: {
              id: 'attempt-1',
              responses: savedResponses,
              is_submitted: false,
            },
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
            focus_summary: makeFocusSummary({
              window_unmaximize_attempts: focusBodies.filter(
                (body) => body.event_type === 'window_unmaximize_attempt'
              ).length,
            }),
          }),
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    render(<StudentQuizzesTab classroom={classroom} assessmentType="test" />)

    await waitFor(() => {
      expect(screen.getByText('Midterm Test')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Midterm Test'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start the Test' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the Test' }))
    await waitFor(() => {
      expect(screen.getByText('Start this test?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Start test'))

    await waitFor(() => {
      expect(
        screen.getByText('Explain one benefit of writing tests before implementation.')
      ).toBeInTheDocument()
    })

    vi.useFakeTimers()

    const responseBox = screen.getAllByPlaceholderText('Write your response...')[0]
    fireEvent.change(responseBox, {
      target: { value: 'TDD clarifies expected behavior before coding.' },
    })

    expect(savedResponses).toEqual({})

    fullscreenElement = null
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 900,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 700,
    })
    Object.defineProperty(window.screen, 'availWidth', {
      configurable: true,
      value: 1400,
    })
    Object.defineProperty(window.screen, 'availHeight', {
      configurable: true,
      value: 900,
    })
    fireEvent(document, new Event('fullscreenchange'))

    await act(async () => {
      vi.advanceTimersByTime(450)
    })

    expect(screen.getByTestId('exam-content-obscurer')).toBeInTheDocument()

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    })
    Object.defineProperty(window.screen, 'availWidth', {
      configurable: true,
      value: 1400,
    })
    Object.defineProperty(window.screen, 'availHeight', {
      configurable: true,
      value: 900,
    })
    await act(async () => {
      fireEvent(window, new Event('resize'))
    })

    expect(screen.queryByTestId('exam-content-obscurer')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('TDD clarifies expected behavior before coding.')).toBeVisible()
  })
})
