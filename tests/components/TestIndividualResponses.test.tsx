import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { TestIndividualResponses } from '@/components/TestIndividualResponses'

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

function testResultsPayload(testId: string, studentName: string) {
  return {
    questions: [{
      id: `${testId}-question`,
      question_text: `${testId} question`,
      question_type: 'multiple_choice',
      options: ['A', 'B'],
    }],
    responders: [{
      student_id: `${testId}-student`,
      name: studentName,
      email: `${testId}@example.com`,
      answers: { [`${testId}-question`]: 1 },
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

describe('TestIndividualResponses', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('accepts legacy quizId as a compatibility alias', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
      questions: [],
      responders: [],
    })))
    vi.stubGlobal('fetch', fetchMock)

    render(<TestIndividualResponses quizId="legacy-test-id" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/tests/legacy-test-id/results')
    })
  })

  it('ignores stale result responses after selected test changes', async () => {
    const staleResults = createDeferred<Response>()
    const currentResults = createDeferred<Response>()
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/api/teacher/tests/test-stale/results')) return staleResults.promise
      if (href.endsWith('/api/teacher/tests/test-current/results')) return currentResults.promise
      throw new Error(`Unexpected fetch: ${href}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<TestIndividualResponses testId="test-stale" />)

    await act(async () => {
      rerender(<TestIndividualResponses testId="test-current" />)
    })

    await act(async () => {
      currentResults.resolve(jsonResponse(testResultsPayload('test-current', 'Current Student')))
      await currentResults.promise
    })

    expect(await screen.findByText('Current Student')).toBeInTheDocument()

    await act(async () => {
      staleResults.resolve(jsonResponse(testResultsPayload('test-stale', 'Stale Student')))
      await staleResults.promise
    })

    expect(screen.getByText('Current Student')).toBeInTheDocument()
    expect(screen.queryByText('Stale Student')).not.toBeInTheDocument()
  })

  it('hides loaded responses immediately when selected test changes', async () => {
    const currentResults = createDeferred<Response>()
    const fetchMock = vi.fn((url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/api/teacher/tests/test-stale/results')) {
        return Promise.resolve(jsonResponse(testResultsPayload('test-stale', 'Already Loaded Student')))
      }
      if (href.endsWith('/api/teacher/tests/test-current/results')) return currentResults.promise
      throw new Error(`Unexpected fetch: ${href}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const mounted = createMountedRoot()
    try {
      await act(async () => {
        mounted.render(<TestIndividualResponses testId="test-stale" />)
      })

      expect(await screen.findByText('Already Loaded Student')).toBeInTheDocument()

      flushSync(() => {
        mounted.render(<TestIndividualResponses testId="test-current" />)
      })

      expect(screen.queryByText('Already Loaded Student')).not.toBeInTheDocument()

      await act(async () => {
        currentResults.resolve(jsonResponse(testResultsPayload('test-current', 'Current Loaded Student')))
        await currentResults.promise
      })

      expect(await screen.findByText('Current Loaded Student')).toBeInTheDocument()
    } finally {
      mounted.cleanup()
    }
  })
})
