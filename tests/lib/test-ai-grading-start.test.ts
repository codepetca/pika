import { beforeEach, describe, expect, it, vi } from 'vitest'

const { client } = vi.hoisted(() => ({ client: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => client }))
vi.mock('@/lib/ai-test-grading', () => ({ getTestOpenResponseGradingModel: () => 'contract-model' }))

import { createOrResumeTestAiGradingRun, toTestAiGradingRunSummary } from '@/lib/server/test-ai-grading-runs'
import type { TestAiGradingRunItem } from '@/types'

const runId = '10000000-0000-4000-8000-000000000001'
const run = {
  id: runId, test_id: 'test-1', status: 'completed' as const,
  created_at: '2026-10-14T12:00:00Z', requested_count: 28,
  eligible_student_count: 25, queued_response_count: 90, completed_count: 90,
}

beforeEach(() => {
  vi.resetAllMocks()
  client.from.mockImplementation(() => {
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
      query[method] = vi.fn(() => query)
    }
    query.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null })
    query.maybeSingle = vi.fn().mockResolvedValue({ data: run, error: null })
    return query
  })
})

describe('starting Test AI grading from saved work', () => {
  it('delegates finalization and source capture to one atomic start instead of reading mutable drafts', async () => {
    client.rpc.mockResolvedValue({ data: {
      outcome: 'created', run_id: runId, eligible_student_count: 25,
      skipped_unanswered_count: 2, skipped_already_graded_count: 0,
    }, error: null })
    const result = await createOrResumeTestAiGradingRun({
      testId: 'test-1', teacherId: 'teacher-1', studentIds: ['student-1', 'student-1'], gradeScope: 'ungraded',
    })
    expect(result.kind).toBe('created')
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('start_test_ai_grading_run_atomic', expect.objectContaining({
      p_test_id: 'test-1', p_teacher_id: 'teacher-1', p_requested_student_ids: ['student-1'],
      p_grade_scope: 'ungraded', p_model: 'contract-model',
    }))
    expect(client.from.mock.calls.map(([table]) => table)).not.toContain('test_attempts')
    expect(client.from.mock.calls.map(([table]) => table)).not.toContain('test_responses')
  })

  it('reports students without an attempt separately from unanswered questions', async () => {
    client.rpc.mockResolvedValue({ data: {
      outcome: 'noop', run_id: null, eligible_student_count: 1,
      skipped_unanswered_count: 5, skipped_already_graded_count: 0,
    }, error: null })
    const result = await createOrResumeTestAiGradingRun({
      testId: 'test-1', teacherId: 'teacher-1', studentIds: ['student-1', 'student-2'], gradeScope: 'all',
    })
    expect(result).toMatchObject({ kind: 'noop', summary: {
      eligible_student_count: 1, skipped_student_count: 1, skipped_unanswered_count: 5,
    } })
  })

  it('gives a no-saved-work message rather than requiring student submission', async () => {
    client.rpc.mockResolvedValue({ data: {
      outcome: 'noop', run_id: null, eligible_student_count: 0,
      skipped_unanswered_count: 0, skipped_already_graded_count: 0,
    }, error: null })
    const result = await createOrResumeTestAiGradingRun({
      testId: 'test-1', teacherId: 'teacher-1', studentIds: ['student-1'], gradeScope: 'all',
    })
    expect(result).toMatchObject({ kind: 'noop', summary: { message: 'Selected students have no saved test work to grade.' } })
  })

  it('fails closed when the saved-work contract is unavailable', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    await expect(createOrResumeTestAiGradingRun({
      testId: 'test-1', teacherId: 'teacher-1', studentIds: ['student-1'], gradeScope: 'all',
    })).rejects.toThrow('Test AI grading saved-work migration is required')
    expect(client.rpc).toHaveBeenCalledTimes(1)
  })

  it('preserves the no-open-question explanation from the atomic operation', async () => {
    client.rpc.mockResolvedValue({ data: {
      outcome: 'noop', run_id: null, noop_reason: 'no_open_questions',
      eligible_student_count: 0, skipped_unanswered_count: 0, skipped_already_graded_count: 0,
    }, error: null })
    expect(await createOrResumeTestAiGradingRun({
      testId: 'test-1', teacherId: 'teacher-1', studentIds: ['student-1'], gradeScope: 'all',
    })).toMatchObject({ kind: 'noop', summary: {
      message: 'This test has no open-response questions to auto-grade.',
    } })
  })

  it.each(['PT409', '40001'])('maps concurrent source conflicts (%s) to reload/retry', async (code) => {
    client.rpc.mockResolvedValue({ data: null, error: { code, message: 'Test response changed; reload and retry' } })
    await expect(createOrResumeTestAiGradingRun({
      testId: 'test-1', teacherId: 'teacher-1', studentIds: ['student-1'], gradeScope: 'all',
    })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects malformed atomic counts before reporting a grading run', async () => {
    client.rpc.mockResolvedValue({ data: {
      outcome: 'created', run_id: runId, eligible_student_count: -1,
      skipped_unanswered_count: 0, skipped_already_graded_count: 0,
    }, error: null })
    await expect(createOrResumeTestAiGradingRun({
      testId: 'test-1', teacherId: 'teacher-1', studentIds: ['student-1'], gradeScope: 'all',
    })).rejects.toThrow('Invalid test AI grading run creation result')
  })
})

describe('Test AI grading student counts', () => {
  it('counts distinct students with completed answers, excluding failed or queued-only students', () => {
    const items = [
      { student_id: 'student-1', status: 'completed' },
      { student_id: 'student-1', status: 'completed' },
      { student_id: 'student-2', status: 'completed' },
      { student_id: 'student-2', status: 'failed' },
      { student_id: 'student-3', status: 'failed' },
      { student_id: 'student-4', status: 'queued' },
    ] as TestAiGradingRunItem[]
    expect(toTestAiGradingRunSummary(run, { items })).toMatchObject({
      completed_student_count: 2, skipped_student_count: 3,
    })
  })

  it('does not invent a completed student count when run items were not loaded', () => {
    expect(toTestAiGradingRunSummary(run).completed_student_count).toBeUndefined()
  })
})
