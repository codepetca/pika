import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GradexClientError,
  gradePikaAssignmentWithGradex,
} from '@/lib/server/gradex-client'
import type { GradexGradeSyncRequest } from '@/lib/server/gradex-assignment-payload'

const payload: GradexGradeSyncRequest = {
  assignment: {
    external_assignment_id: 'pika-assignment-abc',
    title: 'Reflection',
    instructions: 'Write a reflection.',
    type: 'essay',
  },
  rubric: {
    version: 'pika-essay-ctw-v1',
    criteria: [
      {
        id: 'completion',
        label: 'Completion',
        description: 'Did the student complete all parts of the assignment?',
        kind: 'content',
        scale: { min: 0, max: 10 },
        weight: 1,
        feedback_required: true,
      },
      {
        id: 'thinking',
        label: 'Thinking',
        description: 'Does the work show depth of thought, analysis, or understanding?',
        kind: 'thinking',
        scale: { min: 0, max: 10 },
        weight: 1,
        feedback_required: true,
      },
      {
        id: 'workflow',
        label: 'Workflow',
        description: 'Is the work organized, clear, well-presented, and supported by process evidence?',
        kind: 'workflow',
        scale: { min: 0, max: 10 },
        weight: 1,
        feedback_required: true,
      },
    ],
  },
  settings: {
    grading_profile: 'pika-assignment-v1',
    model_profile: 'default',
    feedback_style: 'balanced',
    confidence_threshold: 0.65,
    request_timeout_ms: 25_000,
  },
  submission: {
    external_submission_id: 'pika-submission-def',
    external_student_id: 'pika-student-ghi',
    content_type: 'text',
    content: 'Final submission',
  },
  workflow_evidence: {
    authenticity_score: null,
    evidence_confidence: 0,
    summary: 'No sanitized workflow evidence was available.',
  },
}

describe('gradePikaAssignmentWithGradex', () => {
  const originalApiUrl = process.env.GRADEX_API_URL
  const originalApiKey = process.env.GRADEX_API_KEY

  beforeEach(() => {
    process.env.GRADEX_API_URL = 'https://gradex.test'
    process.env.GRADEX_API_KEY = 'gx_secret'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env.GRADEX_API_URL = originalApiUrl
    process.env.GRADEX_API_KEY = originalApiKey
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends the Gradex auth header, request body, timeout signal, and parses the Pika compatibility projection', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gradex-test-model',
        grading_profile_version: 'pika-assignment-v1',
        audit_id: 'audit-1',
        compatibility: {
          pika_assignment_v1: {
            score_completion: 8,
            score_thinking: 7,
            score_workflow: 9,
            feedback: 'Strength: Clear work. Next Step: Add one detail.',
          },
        },
      }),
    })

    const result = await gradePikaAssignmentWithGradex(payload, {
      requestTimeoutMs: 12_000,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://gradex.test/api/v1/grade/sync')
    expect(init).toEqual(expect.objectContaining({
      method: 'POST',
      headers: {
        Authorization: 'Bearer gx_secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: expect.any(AbortSignal),
    }))
    expect(result).toEqual({
      score_completion: 8,
      score_thinking: 7,
      score_workflow: 9,
      feedback: 'Strength: Clear work. Next Step: Add one detail.',
      model: 'gradex-test-model',
      auditId: 'audit-1',
      gradingProfileVersion: 'pika-assignment-v1',
    })
  })

  it('supports a GRADEX_API_URL that already includes the API version path', async () => {
    process.env.GRADEX_API_URL = 'https://gradex.test/api/v1/'
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gradex-test-model',
        grading_profile_version: 'pika-assignment-v1',
        audit_id: 'audit-1',
        compatibility: {
          pika_assignment_v1: {
            score_completion: 8,
            score_thinking: 7,
            score_workflow: 9,
            feedback: 'Strength: Clear work. Next Step: Add one detail.',
          },
        },
      }),
    })

    await gradePikaAssignmentWithGradex(payload)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://gradex.test/api/v1/grade/sync')
  })

  it('throws a structured non-retryable config error when Gradex credentials are missing', async () => {
    delete process.env.GRADEX_API_KEY

    await expect(gradePikaAssignmentWithGradex(payload)).rejects.toMatchObject({
      name: 'GradexClientError',
      kind: 'config',
      retryable: false,
      statusCode: null,
    })
  })

  it('throws a structured retryable timeout error without including the request body', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const timeout = new Error('The operation timed out')
    timeout.name = 'TimeoutError'
    fetchMock.mockRejectedValueOnce(timeout)

    try {
      await gradePikaAssignmentWithGradex(payload)
      throw new Error('Expected Gradex timeout to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(GradexClientError)
      expect(error).toMatchObject({
        kind: 'timeout',
        retryable: true,
        statusCode: null,
      })
      expect(error.message).not.toContain('Final submission')
      expect(error.message).not.toContain('pika-student-ghi')
    }
  })

  it('throws a structured retryable server error without echoing the response body', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'upstream included submitted work: Final submission',
    })

    await expect(gradePikaAssignmentWithGradex(payload)).rejects.toMatchObject({
      kind: 'server',
      retryable: true,
      statusCode: 503,
      message: 'Gradex request failed (503)',
    })
  })

  it('throws a structured invalid-response error when the compatibility projection is missing', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gradex-test-model',
        grading_profile_version: 'essay-rubric-v1',
        audit_id: 'audit-1',
      }),
    })

    await expect(gradePikaAssignmentWithGradex(payload)).rejects.toMatchObject({
      kind: 'invalid_response',
      retryable: false,
      statusCode: null,
    })
  })

  it('rejects non-integer Pika compatibility scores before they reach Pika smallint grade fields', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gradex-test-model',
        grading_profile_version: 'pika-assignment-v1',
        audit_id: 'audit-1',
        compatibility: {
          pika_assignment_v1: {
            score_completion: 8.5,
            score_thinking: 7,
            score_workflow: 9,
            feedback: 'Strength: Clear work. Next Step: Add one detail.',
          },
        },
      }),
    })

    await expect(gradePikaAssignmentWithGradex(payload)).rejects.toMatchObject({
      kind: 'invalid_response',
      retryable: false,
      message: 'Gradex response has invalid score_completion',
    })
  })

  it('rejects stringified Pika compatibility scores instead of coercing malformed Gradex output', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'gradex-test-model',
        grading_profile_version: 'pika-assignment-v1',
        audit_id: 'audit-1',
        compatibility: {
          pika_assignment_v1: {
            score_completion: '8',
            score_thinking: 7,
            score_workflow: 9,
            feedback: 'Strength: Clear work. Next Step: Add one detail.',
          },
        },
      }),
    })

    await expect(gradePikaAssignmentWithGradex(payload)).rejects.toMatchObject({
      kind: 'invalid_response',
      retryable: false,
      message: 'Gradex response has invalid score_completion',
    })
  })
})
