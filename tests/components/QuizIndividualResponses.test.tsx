import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { QuizIndividualResponses } from '@/components/QuizIndividualResponses'

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

function quizResultsPayload(quizId: string, studentName: string) {
  return {
    questions: [{
      id: `${quizId}-question`,
      question_text: `${quizId} question`,
      question_type: 'multiple_choice',
      options: ['A', 'B'],
    }],
    responders: [{
      student_id: `${quizId}-student`,
      name: studentName,
      email: `${quizId}@example.com`,
      answers: { [`${quizId}-question`]: 1 },
      focus_summary: null,
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

describe('QuizIndividualResponses', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('ignores stale result responses after selected quiz changes', async () => {
    const staleResults = createDeferred<Response>()
    const currentResults = createDeferred<Response>()
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/api/teacher/tests/quiz-stale/results')) return staleResults.promise
      if (href.endsWith('/api/teacher/tests/quiz-current/results')) return currentResults.promise
      throw new Error(`Unexpected fetch: ${href}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<QuizIndividualResponses quizId="quiz-stale" />)

    await act(async () => {
      rerender(<QuizIndividualResponses quizId="quiz-current" />)
    })

    await act(async () => {
      currentResults.resolve(jsonResponse(quizResultsPayload('quiz-current', 'Current Student')))
      await currentResults.promise
    })

    expect(await screen.findByText('Current Student')).toBeInTheDocument()

    await act(async () => {
      staleResults.resolve(jsonResponse(quizResultsPayload('quiz-stale', 'Stale Student')))
      await staleResults.promise
    })

    expect(screen.getByText('Current Student')).toBeInTheDocument()
    expect(screen.queryByText('Stale Student')).not.toBeInTheDocument()
  })

  it('hides loaded responses immediately when selected quiz changes', async () => {
    const currentResults = createDeferred<Response>()
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/api/teacher/tests/quiz-stale/results')) {
        return Promise.resolve(jsonResponse(quizResultsPayload('quiz-stale', 'Already Loaded Student')))
      }
      if (href.endsWith('/api/teacher/tests/quiz-current/results')) return currentResults.promise
      throw new Error(`Unexpected fetch: ${href}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const mounted = createMountedRoot()
    try {
      await act(async () => {
        mounted.render(<QuizIndividualResponses quizId="quiz-stale" />)
      })

      expect(await screen.findByText('Already Loaded Student')).toBeInTheDocument()

      flushSync(() => {
        mounted.render(<QuizIndividualResponses quizId="quiz-current" />)
      })

      expect(screen.queryByText('Already Loaded Student')).not.toBeInTheDocument()

      await act(async () => {
        currentResults.resolve(jsonResponse(quizResultsPayload('quiz-current', 'Current Loaded Student')))
        await currentResults.promise
      })

      expect(await screen.findByText('Current Loaded Student')).toBeInTheDocument()
    } finally {
      mounted.cleanup()
    }
  })
})
