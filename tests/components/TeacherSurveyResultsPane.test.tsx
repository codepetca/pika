import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { TeacherSurveyResultsPane } from '@/components/surveys/TeacherSurveyResultsPane'
import type { SurveyWithStats } from '@/types'

function makeSurvey(overrides: Partial<SurveyWithStats> = {}): SurveyWithStats {
  return {
    id: 'survey-1',
    classroom_id: 'classroom-1',
    title: 'Planning Poll',
    status: 'active',
    opens_at: null,
    show_results: true,
    dynamic_responses: false,
    position: 0,
    created_by: 'teacher-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    stats: { total_students: 2, responded: 0, questions_count: 1 },
    ...overrides,
  }
}

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

describe('TeacherSurveyResultsPane', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the survey title in the results card and puts percentages inside option bars', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        stats: { total_students: 2, responded: 2 },
        results: [
          {
            question_id: 'question-1',
            question_type: 'multiple_choice',
            question_text: 'Pick one',
            options: ['A', 'B'],
            counts: [1, 1],
            responses: [],
            total_responses: 2,
          },
        ],
      }),
    })))

    render(<TeacherSurveyResultsPane survey={makeSurvey()} />)

    expect(await screen.findByRole('heading', { name: 'Planning Poll' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument()
    expect(screen.queryByText('0/2 responded')).not.toBeInTheDocument()
    expect(screen.queryByText('2 of 2 students responded')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getAllByText('50%')).toHaveLength(2)
    })
    expect(screen.queryByText('1 (50%)')).not.toBeInTheDocument()
  })

  it('ignores stale result responses after selected survey changes', async () => {
    const staleResults = createDeferred<Response>()
    const currentResults = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/api/teacher/surveys/survey-stale/results')) return staleResults.promise
      if (href.endsWith('/api/teacher/surveys/survey-current/results')) return currentResults.promise
      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const { rerender } = render(
      <TeacherSurveyResultsPane survey={makeSurvey({ id: 'survey-stale', title: 'Stale Survey' })} />
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/teacher/surveys/survey-stale/results')
    })

    rerender(
      <TeacherSurveyResultsPane survey={makeSurvey({ id: 'survey-current', title: 'Current Survey' })} />
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/teacher/surveys/survey-current/results')
    })

    await act(async () => {
      currentResults.resolve(jsonResponse({
        stats: { total_students: 2, responded: 1 },
        results: [{
          question_id: 'question-current',
          question_type: 'multiple_choice',
          question_text: 'Current results question',
          options: ['A', 'B'],
          counts: [1, 0],
          responses: [],
          total_responses: 1,
        }],
      }))
      await currentResults.promise
    })

    expect(await screen.findByText('Current results question')).toBeInTheDocument()

    await act(async () => {
      staleResults.resolve(jsonResponse({
        stats: { total_students: 2, responded: 1 },
        results: [{
          question_id: 'question-stale',
          question_type: 'multiple_choice',
          question_text: 'Stale results question',
          options: ['A', 'B'],
          counts: [0, 1],
          responses: [],
          total_responses: 1,
        }],
      }))
      await staleResults.promise
    })

    expect(screen.getByText('Current results question')).toBeInTheDocument()
    expect(screen.queryByText('Stale results question')).not.toBeInTheDocument()
  })

  it('hides loaded results immediately when selected survey changes', async () => {
    const currentResults = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/api/teacher/surveys/survey-stale/results')) {
        return Promise.resolve(jsonResponse({
          stats: { total_students: 2, responded: 1 },
          results: [{
            question_id: 'question-stale',
            question_type: 'multiple_choice',
            question_text: 'Already loaded stale question',
            options: ['A', 'B'],
            counts: [0, 1],
            responses: [],
            total_responses: 1,
          }],
        }))
      }
      if (href.endsWith('/api/teacher/surveys/survey-current/results')) return currentResults.promise
      throw new Error(`Unexpected fetch: ${href}`)
    }))

    const mounted = createMountedRoot()
    try {
      await act(async () => {
        mounted.render(
          <TeacherSurveyResultsPane survey={makeSurvey({ id: 'survey-stale', title: 'Stale Survey' })} />
        )
      })

      expect(await screen.findByText('Already loaded stale question')).toBeInTheDocument()

      flushSync(() => {
        mounted.render(
          <TeacherSurveyResultsPane survey={makeSurvey({ id: 'survey-current', title: 'Current Survey' })} />
        )
      })

      expect(screen.queryByText('Already loaded stale question')).not.toBeInTheDocument()

      await act(async () => {
        currentResults.resolve(jsonResponse({
          stats: { total_students: 2, responded: 1 },
          results: [{
            question_id: 'question-current',
            question_type: 'multiple_choice',
            question_text: 'Current loaded question',
            options: ['A', 'B'],
            counts: [1, 0],
            responses: [],
            total_responses: 1,
          }],
        }))
        await currentResults.promise
      })

      expect(await screen.findByText('Current loaded question')).toBeInTheDocument()
    } finally {
      mounted.cleanup()
    }
  })
})
