import { describe, expect, it, vi } from 'vitest'
import {
  buildPikaGradexSmokeSample,
  mapGradexItemsToPikaGradeRecords,
  runPikaGradexSmoke,
  type GradexSmokeRunItemResponse,
  type GradexSmokeRunResponse,
} from '@/lib/server/gradex-smoke-runner'

describe('Pika Gradex smoke runner', () => {
  it('builds a sanitized sample Gradex request from Pika-shaped assignment data', () => {
    const sample = buildPikaGradexSmokeSample()
    const serialized = JSON.stringify(sample.gradexRequest)

    expect(sample.gradexRequest.settings).toMatchObject({
      grading_profile: 'pika-assignment-v1',
      provider: 'auto',
      tier: 'auto',
    })
    expect(sample.gradexRequest.submissions).toHaveLength(1)
    expect(serialized).toContain('J.S.')
    expect(serialized).toContain('[email redacted]')
    expect(serialized).toContain('[url redacted]')
    expect(serialized).not.toContain('Jane Student')
    expect(serialized).not.toContain('jane.student@example.com')
    expect(serialized).not.toContain('student.example.com')
    expect(serialized).not.toContain('assignment-doc-db-smoke-001')
    expect(serialized).not.toMatch(/\b[0-9a-f]{24}\b/i)
    expect(sample.mappings[0].assignment_doc_id).toBe('assignment-doc-db-smoke-001')
  })

  it('posts, ticks, polls, fetches items, and maps Gradex results back to Pika grade fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === 'https://gradex.example.test/api/v1/grading-runs' && method === 'POST') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer gx_test_key' })
        return jsonResponse(202, runResponse('queued'))
      }

      if (url === 'https://gradex.example.test/api/internal/grading-runs/tick' && method === 'POST') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer internal_test' })
        expect(JSON.parse(String(init?.body))).toMatchObject({ runId: 'run_1', limit: 1 })
        return jsonResponse(200, { processed: 1 })
      }

      if (url === 'https://gradex.example.test/api/v1/grading-runs/run_1' && method === 'GET') {
        return jsonResponse(200, runResponse('completed'))
      }

      if (url === 'https://gradex.example.test/api/v1/grading-runs/run_1/items/item_1' && method === 'GET') {
        return jsonResponse(200, itemResponse())
      }

      throw new Error(`Unexpected request: ${method} ${url}`)
    })

    const report = await runPikaGradexSmoke({
      baseUrl: 'https://gradex.example.test/',
      apiKey: 'gx_test_key',
      internalToken: 'internal_test',
      fetchImpl,
      sleep: async () => undefined,
      pollAttempts: 3,
    })

    expect(report.run.status).toBe('completed')
    expect(report.gradeRecords).toEqual([
      expect.objectContaining({
        assignment_doc_id: 'assignment-doc-db-smoke-001',
        student_id: 'student-db-smoke-001',
        gradex_item_id: 'item_1',
        status: 'completed',
        score_completion: 8,
        score_thinking: 7,
        score_workflow: 9,
        feedback: 'Strength: clear reflection. Next step: add one specific example.',
        provider: 'heuristic',
        model: 'heuristic-local',
        tier: 'tier_0',
        audit_id: 'audit_1',
      }),
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('fails closed when a Gradex item cannot be mapped to a local Pika record', () => {
    const sample = buildPikaGradexSmokeSample()
    expect(() =>
      mapGradexItemsToPikaGradeRecords(sample.mappings, [
        {
          ...itemResponse(),
          external_submission_id: 'unknown-submission',
        },
      ]),
    ).toThrow('Missing Pika mapping')
  })

  it('maps Gradex criterion results when compatibility output is absent', () => {
    const sample = buildPikaGradexSmokeSample()
    const record = mapGradexItemsToPikaGradeRecords(sample.mappings, [
      {
        ...itemResponse(),
        result: {
          ...itemResponse().result!,
          compatibility: undefined,
          criteria_results: [
            { criterion_id: 'completion', score: 6 },
            { criterion_id: 'thinking', score: 7 },
            { criterion_id: 'workflow', score: 8 },
          ],
          feedback: {
            student: 'Strength: organized submission. Next step: add evidence.',
          },
        },
      },
    ])[0]

    expect(record).toMatchObject({
      score_completion: 6,
      score_thinking: 7,
      score_workflow: 8,
      feedback: 'Strength: organized submission. Next step: add evidence.',
    })
  })
})

function runResponse(status: GradexSmokeRunResponse['status']): GradexSmokeRunResponse {
  return {
    id: 'run_1',
    status,
    counts: {
      requested: 1,
      processed: status === 'completed' ? 1 : 0,
      completed: status === 'completed' ? 1 : 0,
      failed: 0,
      skipped: 0,
      pending: status === 'completed' ? 0 : 1,
    },
    provider: status === 'completed' ? 'heuristic' : null,
    model: status === 'completed' ? 'heuristic-local' : null,
    tier: status === 'completed' ? 'tier_0' : null,
    policy_version: status === 'completed' ? 'gradex-routing-policy-v1' : null,
    prompt_version: status === 'completed' ? 'gradex-essay-rubric-v1' : null,
    items: [
      {
        id: 'item_1',
        status: status === 'completed' ? 'completed' : 'queued',
        external_submission_id: buildPikaGradexSmokeSample().mappings[0].gradex_submission_id,
        external_student_id: buildPikaGradexSmokeSample().mappings[0].gradex_student_id,
        error: null,
      },
    ],
  }
}

function itemResponse(): GradexSmokeRunItemResponse {
  const mapping = buildPikaGradexSmokeSample().mappings[0]
  return {
    id: 'item_1',
    status: 'completed',
    external_submission_id: mapping.gradex_submission_id,
    external_student_id: mapping.gradex_student_id,
    error: null,
    result: {
      provider: 'heuristic',
      model: 'heuristic-local',
      tier: 'tier_0',
      policy_version: 'gradex-routing-policy-v1',
      prompt_version: 'gradex-essay-rubric-v1',
      audit_id: 'audit_1',
      token_usage: null,
      compatibility: {
        pika_assignment_v1: {
          score_completion: 8,
          score_thinking: 7,
          score_workflow: 9,
          feedback: 'Strength: clear reflection. Next step: add one specific example.',
        },
      },
    },
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
