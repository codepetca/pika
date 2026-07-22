import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function errorResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as Response
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

function openResponseResultsPayload(revision: number, score: number | null, feedback: string | null) {
  return {
    questions: [{
      id: 'question-open',
      question_text: 'Explain the result.',
      question_type: 'open_response',
      points: 5,
      options: [],
    }],
    responders: [{
      student_id: 'student-1',
      name: 'Student One',
      email: 'student@example.com',
      answers: {
        'question-open': {
          response_id: 'response-1',
          response_revision: revision,
          question_type: 'open_response',
          selected_option: null,
          response_text: 'Because the values converge.',
          score,
          feedback,
          graded_at: score == null ? null : '2026-07-14T12:00:00.000Z',
        },
      },
      focus_summary: null,
    }],
    stats: {
      graded_open_responses: score == null ? 0 : 1,
      ungraded_open_responses: score == null ? 1 : 0,
    },
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

  it('sends revision-aware AI provenance and reloads revisions after save and clear', async () => {
    let revision = 7
    let score: number | null = null
    let feedback: string | null = null
    let resultsCalls = 0
    const patchBodies: Array<Record<string, unknown>> = []
    const questionGradingSnapshot = {
      test_title: 'Unit Test',
      question_text: 'Explain the result.',
      points: 5,
      response_monospace: false,
      answer_key: 'Expected result',
      sample_solution: null,
    }
    const gradingProvenance = {
      schemaVersion: 'test-grading-provenance-v1',
      gradingRequestId: '10000000-0000-4000-8000-000000000001',
      provider: 'openai',
      model: 'gpt-5-nano',
      policyVersion: 'pika-test-open-response-policy-v1',
      promptVersion: 'pika-test-open-response-manual-prompt-v1',
      gradingProfileVersion: 'pika-test-open-response-v1',
      rubricVersion: 'pika-test-open-response-rubric-v1',
      operation: 'single',
      batchSize: 1,
      providerRequestCount: 1,
      tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/teacher/tests/test-1/results')) {
        resultsCalls += 1
        return Promise.resolve(jsonResponse(openResponseResultsPayload(revision, score, feedback)))
      }
      if (url.endsWith('/api/teacher/tests/test-1/responses/response-1/ai-suggest')) {
        return Promise.resolve(jsonResponse({
          suggestion: {
            score: 4,
            feedback: 'Clear explanation.',
            grading_basis: 'teacher_key',
            reference_answers: [],
            model: 'gpt-5-nano',
            provenance: gradingProvenance,
          },
          question_grading_snapshot: questionGradingSnapshot,
          ai_provenance_token: 'signed-token',
        }))
      }
      if (url.endsWith('/api/teacher/tests/test-1/responses/response-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>
        patchBodies.push(body)
        revision += 1
        if (body.clear_grade === true) {
          score = null
          feedback = null
        } else {
          score = Number(body.score)
          feedback = typeof body.feedback === 'string' ? body.feedback : null
        }
        return Promise.resolve(jsonResponse({ success: true }))
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<TestIndividualResponses testId="test-1" />)

    await user.click(await screen.findByRole('button', { name: /^Student One/ }))
    await user.click(screen.getByRole('button', { name: 'AI Suggest' }))
    expect(await screen.findByDisplayValue('4')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Clear explanation.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save Grade' }))
    await waitFor(() => expect(resultsCalls).toBe(2))
    expect(patchBodies[0]).toEqual({
      response_id: 'response-1',
      expected_response_revision: 7,
      score: 4,
      feedback: 'Clear explanation.',
      ai_grading_basis: 'teacher_key',
      ai_reference_answers: null,
      ai_model: 'gpt-5-nano',
      question_grading_snapshot: questionGradingSnapshot,
      ai_provenance_token: 'signed-token',
      ai_suggested_score: 4,
      ai_suggested_feedback: 'Clear explanation.',
      ai_grading_provenance: gradingProvenance,
    })

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(resultsCalls).toBe(3))
    expect(patchBodies[1]).toEqual({
      response_id: 'response-1',
      expected_response_revision: 8,
      clear_grade: true,
    })
  })

  it('reloads a save conflict, preserves the draft, and drops stale AI provenance', async () => {
    let revision = 7
    let score: number | null = null
    let feedback: string | null = null
    let patchCalls = 0
    const patchBodies: Array<Record<string, unknown>> = []
    const conflictResponse = createDeferred<Response>()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/teacher/tests/test-1/results')) {
        return Promise.resolve(jsonResponse(openResponseResultsPayload(revision, score, feedback)))
      }
      if (url.endsWith('/api/teacher/tests/test-1/responses/response-1/ai-suggest')) {
        return Promise.resolve(jsonResponse({
          suggestion: {
            score: 4,
            feedback: 'AI draft feedback.',
            grading_basis: 'teacher_key',
            reference_answers: [],
            model: 'gpt-5-nano',
          },
          question_grading_snapshot: {
            test_title: 'Unit Test',
            question_text: 'Explain the result.',
            points: 5,
            response_monospace: false,
            answer_key: 'Expected result',
            sample_solution: null,
          },
          ai_provenance_token: 'stale-signed-token',
        }))
      }
      if (url.endsWith('/api/teacher/tests/test-1/responses/response-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>
        patchBodies.push(body)
        patchCalls += 1
        if (patchCalls === 1) {
          revision = 8
          score = 2
          feedback = 'Concurrent grade.'
          return conflictResponse.promise
        }
        revision = 9
        score = Number(body.score)
        feedback = String(body.feedback)
        return Promise.resolve(jsonResponse({ success: true }))
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<TestIndividualResponses testId="test-1" />)

    await user.click(await screen.findByRole('button', { name: /^Student One/ }))
    await user.click(screen.getByRole('button', { name: 'AI Suggest' }))
    await user.click(screen.getByRole('button', { name: 'Save Grade' }))
    const scoreInput = screen.getByDisplayValue('4')
    const feedbackInput = screen.getByDisplayValue('AI draft feedback.')
    await user.clear(scoreInput)
    await user.type(scoreInput, '3')
    await user.clear(feedbackInput)
    await user.type(feedbackInput, 'Edited while saving.')
    await act(async () => {
      conflictResponse.resolve(errorResponse(409, { error: 'Grade changed' }))
      await conflictResponse.promise
    })

    expect(await screen.findByText(/AI suggestion must be regenerated/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('3')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Edited while saving.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save Grade' }))
    await waitFor(() => expect(patchBodies).toHaveLength(2))
    expect(patchBodies[1]).toEqual({
      response_id: 'response-1',
      expected_response_revision: 8,
      score: 3,
      feedback: 'Edited while saving.',
    })
  })

  it('reloads a clear conflict so the next clear uses the canonical revision', async () => {
    let revision = 5
    let score: number | null = 3
    let feedback: string | null = 'Initial grade.'
    let patchCalls = 0
    const patchBodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/teacher/tests/test-1/results')) {
        return Promise.resolve(jsonResponse(openResponseResultsPayload(revision, score, feedback)))
      }
      if (url.endsWith('/api/teacher/tests/test-1/responses/response-1') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>
        patchBodies.push(body)
        patchCalls += 1
        if (patchCalls === 1) {
          revision = 6
          score = 4
          feedback = 'Concurrent grade.'
          return Promise.resolve(errorResponse(409, { error: 'Grade changed' }))
        }
        revision = 7
        score = null
        feedback = null
        return Promise.resolve(jsonResponse({ success: true }))
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<TestIndividualResponses testId="test-1" />)

    await user.click(await screen.findByRole('button', { name: /^Student One/ }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(await screen.findByText(/latest version was loaded/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('4')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Concurrent grade.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(patchBodies).toHaveLength(2))
    expect(patchBodies[1]).toEqual({
      response_id: 'response-1',
      expected_response_revision: 6,
      clear_grade: true,
    })
  })
})
