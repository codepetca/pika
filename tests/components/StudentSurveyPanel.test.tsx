import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { StudentSurveyPanel } from '@/components/surveys/StudentSurveyPanel'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

function surveyDetailPayload(surveyId: string, title: string, questionText: string) {
  return {
    survey: {
      id: surveyId,
      classroom_id: 'classroom-1',
      title,
      status: 'active',
      opens_at: null,
      show_results: true,
      dynamic_responses: false,
      position: 0,
      student_status: 'can_view_results',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    questions: [{
      id: `${surveyId}-question`,
      survey_id: surveyId,
      question_type: 'multiple_choice',
      question_text: questionText,
      options: ['A', 'B'],
      response_max_chars: 500,
      position: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }],
    student_status: 'can_view_results',
    has_submitted: false,
    student_responses: {},
  }
}

function surveyResultsPayload(questionId: string, questionText: string) {
  return {
    results: [{
      question_id: questionId,
      question_type: 'multiple_choice',
      question_text: questionText,
      options: ['A', 'B'],
      counts: [1, 0],
      responses: [],
      total_responses: 1,
    }],
  }
}

function createMountedRoot() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  return {
    render: (node: ReactNode) => root.render(node),
    cleanup: () => {
      root.unmount()
      host.remove()
    },
  }
}

describe('StudentSurveyPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/results')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                question_id: 'question-1',
                question_type: 'multiple_choice',
                question_text: 'Pick one',
                options: ['A', 'B'],
                counts: [1, 0],
                responses: [],
                total_responses: 1,
              },
            ],
          }),
        }
      }

      return {
        ok: true,
        json: async () => ({
          survey: {
            id: 'survey-1',
            classroom_id: 'classroom-1',
            title: 'Quick Poll',
            status: 'active',
            opens_at: null,
            show_results: true,
            dynamic_responses: false,
            position: 0,
            student_status: 'can_view_results',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          questions: [
            {
              id: 'question-1',
              survey_id: 'survey-1',
              question_type: 'multiple_choice',
              question_text: 'Pick one',
              options: ['A', 'B'],
              response_max_chars: 500,
              position: 0,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'question-link',
              survey_id: 'survey-1',
              question_type: 'link',
              question_text: 'Share your project link',
              options: [],
              response_max_chars: 2048,
              position: 1,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'question-text',
              survey_id: 'survey-1',
              question_type: 'short_text',
              question_text: 'What did you build?',
              options: [],
              response_max_chars: 500,
              position: 2,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          student_status: 'can_view_results',
          has_submitted: false,
          student_responses: {},
        }),
      }
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows available class results first and exposes a response action', async () => {
    render(<StudentSurveyPanel surveyId="survey-1" />)

    expect(await screen.findByRole('heading', { name: 'Quick Poll' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
    const responseAction = screen.getByRole('button', { name: 'Respond' })
    expect(responseAction).toBeInTheDocument()
    expect(responseAction.parentElement).toHaveClass('fixed', 'top-[3.25rem]', 'z-40')
    expect(responseAction.parentElement?.className).toContain('lg:left-[var(--main-content-center-x,50%)]')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Class results' })).toBeInTheDocument()
    })
    expect(await screen.findByText('100%')).toBeInTheDocument()
    expect(screen.queryByText('1 (100%)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Respond' }))
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View results' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Share your project link response' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'What did you build? response' })).toBeInTheDocument()
  })

  it('ignores stale detail responses after selected survey changes', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const staleDetail = createDeferred<Response>()
    const currentDetail = createDeferred<Response>()
    fetchMock.mockImplementation((url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/api/student/surveys/survey-stale')) return staleDetail.promise
      if (href.endsWith('/api/student/surveys/survey-current')) return currentDetail.promise
      if (href.endsWith('/api/student/surveys/survey-current/results')) {
        return Promise.resolve(jsonResponse(surveyResultsPayload('current-result', 'Current result question')))
      }
      throw new Error(`Unexpected fetch: ${href}`)
    })

    const { rerender } = render(<StudentSurveyPanel surveyId="survey-stale" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/student/surveys/survey-stale')
    })

    rerender(<StudentSurveyPanel surveyId="survey-current" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/student/surveys/survey-current')
    })

    await act(async () => {
      currentDetail.resolve(jsonResponse(surveyDetailPayload(
        'survey-current',
        'Current Student Survey',
        'Current student question',
      )))
      await currentDetail.promise
    })

    expect(await screen.findByRole('heading', { name: 'Current Student Survey' })).toBeInTheDocument()

    await act(async () => {
      staleDetail.resolve(jsonResponse(surveyDetailPayload(
        'survey-stale',
        'Stale Student Survey',
        'Stale student question',
      )))
      await staleDetail.promise
    })

    expect(screen.getByRole('heading', { name: 'Current Student Survey' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Stale Student Survey' })).not.toBeInTheDocument()
  })

  it('ignores stale result responses after selected survey changes', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const staleResults = createDeferred<Response>()
    const currentResults = createDeferred<Response>()
    fetchMock.mockImplementation((url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/api/student/surveys/survey-stale/results')) return staleResults.promise
      if (href.endsWith('/api/student/surveys/survey-current/results')) return currentResults.promise
      if (href.endsWith('/api/student/surveys/survey-stale')) {
        return Promise.resolve(jsonResponse(surveyDetailPayload(
          'survey-stale',
          'Stale Student Survey',
          'Stale student question',
        )))
      }
      if (href.endsWith('/api/student/surveys/survey-current')) {
        return Promise.resolve(jsonResponse(surveyDetailPayload(
          'survey-current',
          'Current Student Survey',
          'Current student question',
        )))
      }
      throw new Error(`Unexpected fetch: ${href}`)
    })

    const { rerender } = render(<StudentSurveyPanel surveyId="survey-stale" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/student/surveys/survey-stale/results')
    })

    rerender(<StudentSurveyPanel surveyId="survey-current" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/student/surveys/survey-current/results')
    })

    await act(async () => {
      currentResults.resolve(jsonResponse(surveyResultsPayload('current-result', 'Current result question')))
      await currentResults.promise
    })

    expect(await screen.findByText('Current result question')).toBeInTheDocument()

    await act(async () => {
      staleResults.resolve(jsonResponse(surveyResultsPayload('stale-result', 'Stale result question')))
      await staleResults.promise
    })

    expect(screen.getByText('Current result question')).toBeInTheDocument()
    expect(screen.queryByText('Stale result question')).not.toBeInTheDocument()
  })

  it('hides loaded results immediately when selected survey changes', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const currentResults = createDeferred<Response>()
    fetchMock.mockImplementation((url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/api/student/surveys/survey-stale/results')) {
        return Promise.resolve(jsonResponse(surveyResultsPayload('stale-result', 'Already loaded stale result')))
      }
      if (href.endsWith('/api/student/surveys/survey-current/results')) return currentResults.promise
      if (href.endsWith('/api/student/surveys/survey-stale')) {
        return Promise.resolve(jsonResponse(surveyDetailPayload(
          'survey-stale',
          'Stale Student Survey',
          'Stale student question',
        )))
      }
      if (href.endsWith('/api/student/surveys/survey-current')) {
        return Promise.resolve(jsonResponse(surveyDetailPayload(
          'survey-current',
          'Current Student Survey',
          'Current student question',
        )))
      }
      throw new Error(`Unexpected fetch: ${href}`)
    })

    const mounted = createMountedRoot()
    try {
      await act(async () => {
        mounted.render(<StudentSurveyPanel surveyId="survey-stale" />)
      })

      expect(await screen.findByText('Already loaded stale result')).toBeInTheDocument()

      flushSync(() => {
        mounted.render(<StudentSurveyPanel surveyId="survey-current" />)
      })

      expect(screen.queryByText('Already loaded stale result')).not.toBeInTheDocument()

      await act(async () => {
        currentResults.resolve(jsonResponse(surveyResultsPayload('current-result', 'Current loaded result')))
        await currentResults.promise
      })

      expect(await screen.findByText('Current loaded result')).toBeInTheDocument()
    } finally {
      mounted.cleanup()
    }
  })
})
