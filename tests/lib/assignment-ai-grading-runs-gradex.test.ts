import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Assignment } from '@/types'

const { gradeStudentWork } = vi.hoisted(() => ({
  gradeStudentWork: vi.fn(),
}))

const { gradePikaAssignmentWithGradex } = vi.hoisted(() => ({
  gradePikaAssignmentWithGradex: vi.fn(),
}))

const { mockServiceSupabase } = vi.hoisted(() => ({
  mockServiceSupabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/lib/ai-grading', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai-grading')>()
  return {
    ...actual,
    gradeStudentWork,
  }
})

vi.mock('@/lib/server/gradex-client', () => ({
  gradePikaAssignmentWithGradex,
  isGradexAssignmentGradingEnabled: () =>
    process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED?.trim().toLowerCase() === 'true',
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockServiceSupabase),
}))

import {
  gradeAssignmentDocWithAi,
  tickAssignmentAiGradingRun,
} from '@/lib/server/assignment-ai-grading-runs'

const assignment: Assignment = {
  id: 'assignment-db-123',
  classroom_id: 'classroom-db-123',
  title: 'Reflection',
  description: 'Write a reflection.',
  instructions_markdown: 'Write a reflection about your process.',
  rich_instructions: null,
  due_at: '2026-05-15T19:00:00.000Z',
  position: 0,
  is_draft: false,
  released_at: '2026-05-01T12:00:00.000Z',
  track_authenticity: true,
  created_by: 'teacher-db-123',
  created_at: '2026-05-01T12:00:00.000Z',
  updated_at: '2026-05-02T12:00:00.000Z',
}

const assignmentDoc = {
  id: 'assignment-doc-db-456',
  assignment_id: 'assignment-db-123',
  student_id: 'student-db-789',
  submitted_at: '2026-05-04T20:00:00.000Z',
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'I revised my work and explained my choices.' }],
      },
    ],
  },
  feedback: null,
  authenticity_score: 90,
  authenticity_flags: [],
}

function buildSupabaseUpdateHarness() {
  const updates: Record<string, unknown>[] = []
  const eq = vi.fn(async () => ({ error: null }))
  const update = vi.fn((payload: Record<string, unknown>) => {
    updates.push(payload)
    return { eq }
  })
  const from = vi.fn((table: string) => {
    if (table === 'assignment_docs') {
      return { update }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return {
    supabase: { from } as any,
    updates,
    update,
    eq,
  }
}

function buildBackgroundRunHarness(runModel: string) {
  const run = {
    id: 'run-1',
    assignment_id: assignment.id,
    status: 'queued',
    triggered_by: 'teacher-1',
    model: runModel,
    selection_hash: 'selection-hash',
    requested_student_ids_json: [assignmentDoc.student_id],
    requested_count: 1,
    gradable_count: 1,
    processed_count: 0,
    completed_count: 0,
    skipped_missing_count: 0,
    skipped_empty_count: 0,
    failed_count: 0,
    error_samples_json: [],
    lease_token: null,
    lease_expires_at: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-05-04T20:00:00.000Z',
    updated_at: '2026-05-04T20:00:00.000Z',
  }
  const item = {
    id: 'item-1',
    run_id: run.id,
    assignment_id: assignment.id,
    student_id: assignmentDoc.student_id,
    assignment_doc_id: assignmentDoc.id,
    queue_position: 0,
    status: 'queued',
    skip_reason: null,
    attempt_count: 0,
    next_retry_at: null,
    last_error_code: null,
    last_error_message: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-05-04T20:00:00.000Z',
    updated_at: '2026-05-04T20:00:00.000Z',
  }
  const docUpdates: Record<string, unknown>[] = []

  mockServiceSupabase.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'claim_assignment_ai_grading_run') {
      return { data: true, error: null }
    }
    throw new Error(`Unexpected rpc: ${fn}`)
  })

  mockServiceSupabase.from.mockImplementation((table: string) => {
    if (table === 'assignment_ai_grading_runs') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((field: string, value: string) => {
            if (field !== 'id') throw new Error(`Unexpected run eq field: ${field}`)
            return {
              maybeSingle: vi.fn(async () => ({
                data: value === run.id ? { ...run } : null,
                error: null,
              })),
            }
          }),
        })),
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn((field: string, value: string) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                if (field !== 'id' || value !== run.id) return { data: null, error: null }
                Object.assign(run, payload)
                return { data: { ...run }, error: null }
              }),
            })),
          })),
        })),
      }
    }

    if (table === 'assignment_ai_grading_run_items') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((field: string, value: string) => ({
            order: vi.fn(async () => ({
              data:
                field === 'run_id' && value === run.id
                  ? [{ ...item }]
                  : [],
              error: null,
            })),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn(async (field: string, value: string) => {
            if (field === 'id' && value === item.id) Object.assign(item, payload)
            return { error: null }
          }),
        })),
      }
    }

    if (table === 'assignments') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: assignment, error: null })),
          })),
        })),
      }
    }

    if (table === 'assignment_docs') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: assignmentDoc,
              error: null,
            })),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          docUpdates.push(payload)
          return {
            eq: vi.fn(async () => ({ error: null })),
          }
        }),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  })

  return { docUpdates, item, run }
}

describe('assignment AI grading Gradex feature flag', () => {
  const originalFlag = process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED
  const originalSalt = process.env.GRADEX_PIKA_PSEUDONYM_SALT

  beforeEach(() => {
    vi.clearAllMocks()
    mockServiceSupabase.from.mockReset()
    mockServiceSupabase.rpc.mockReset()
    delete process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED
    process.env.GRADEX_PIKA_PSEUDONYM_SALT = 'stable-test-salt'
    gradeStudentWork.mockResolvedValue({
      score_completion: 8,
      score_thinking: 7,
      score_workflow: 9,
      feedback: 'Strength: Clear work. Next Step: Add one detail.',
      model: 'gpt-5-nano',
      attempts: 1,
    })
    gradePikaAssignmentWithGradex.mockResolvedValue({
      score_completion: 6,
      score_thinking: 7,
      score_workflow: 8,
      feedback: 'Strength: Gradex feedback. Next Step: Add one example.',
      model: 'gradex-model',
      auditId: 'audit-1',
      gradingProfileVersion: 'pika-assignment-v1',
    })
  })

  afterEach(() => {
    process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED = originalFlag
    process.env.GRADEX_PIKA_PSEUDONYM_SALT = originalSalt
  })

  it('uses the existing Pika grader when the Gradex assignment flag is missing', async () => {
    const harness = buildSupabaseUpdateHarness()

    await gradeAssignmentDocWithAi({
      supabase: harness.supabase,
      assignment,
      assignmentDoc,
      gradedBy: 'teacher-1',
    })

    expect(gradeStudentWork).toHaveBeenCalledTimes(1)
    expect(gradePikaAssignmentWithGradex).not.toHaveBeenCalled()
    expect(harness.updates[0]).toEqual(expect.objectContaining({
      score_completion: 8,
      score_thinking: 7,
      score_workflow: 9,
      teacher_feedback_draft: 'Strength: Clear work. Next Step: Add one detail.',
      ai_feedback_suggestion: 'Strength: Clear work. Next Step: Add one detail.',
      ai_feedback_model: 'gpt-5-nano',
      graded_by: 'teacher-1',
    }))
    expect(harness.eq).toHaveBeenCalledWith('id', 'assignment-doc-db-456')
  })

  it('uses Gradex and stores the Pika compatibility projection when the flag is enabled', async () => {
    process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED = 'true'
    const harness = buildSupabaseUpdateHarness()

    await gradeAssignmentDocWithAi({
      supabase: harness.supabase,
      assignment,
      assignmentDoc: {
        ...assignmentDoc,
        feedback: 'Earlier returned feedback.',
      },
      gradedBy: 'teacher-1',
      requestTimeoutMs: 12_000,
    })

    expect(gradeStudentWork).not.toHaveBeenCalled()
    expect(gradePikaAssignmentWithGradex).toHaveBeenCalledTimes(1)
    expect(gradePikaAssignmentWithGradex).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ grading_profile: 'pika-assignment-v1' }),
        assignment: expect.objectContaining({
          external_assignment_id: expect.stringMatching(/^pika-assignment-[a-f0-9]{32}$/),
        }),
        submission: expect.objectContaining({
          external_submission_id: expect.stringMatching(/^pika-submission-[a-f0-9]{32}$/),
          external_student_id: expect.stringMatching(/^pika-student-[a-f0-9]{32}$/),
        }),
      }),
      { requestTimeoutMs: 12_000 },
    )
    expect(JSON.stringify(gradePikaAssignmentWithGradex.mock.calls[0]?.[0])).not.toContain('student-db-789')
    expect(harness.updates[0]).toEqual(expect.objectContaining({
      score_completion: 6,
      score_thinking: 7,
      score_workflow: 8,
      teacher_feedback_draft:
        'Earlier returned feedback.\n\n--- Resubmission ---\n\nStrength: Gradex feedback. Next Step: Add one example.',
      ai_feedback_suggestion:
        'Earlier returned feedback.\n\n--- Resubmission ---\n\nStrength: Gradex feedback. Next Step: Add one example.',
      ai_feedback_model: 'gradex:gradex-model',
      graded_by: 'teacher-1',
    }))
  })

  it('surfaces Gradex failures and does not write a partial grade', async () => {
    process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED = 'true'
    gradePikaAssignmentWithGradex.mockRejectedValueOnce(Object.assign(
      new Error('Gradex request failed (503)'),
      { kind: 'server', retryable: true, statusCode: 503 },
    ))
    const harness = buildSupabaseUpdateHarness()

    await expect(gradeAssignmentDocWithAi({
      supabase: harness.supabase,
      assignment,
      assignmentDoc,
      gradedBy: 'teacher-1',
    })).rejects.toMatchObject({
      kind: 'server',
      retryable: true,
      statusCode: 503,
      message: 'Gradex request failed (503)',
    })

    expect(harness.update).not.toHaveBeenCalled()
  })

  it('keeps using Gradex for a persisted Gradex background run if the live flag is later disabled', async () => {
    process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED = 'false'
    const harness = buildBackgroundRunHarness('gradex:pika-assignment-v1')

    const result = await tickAssignmentAiGradingRun({
      assignmentId: assignment.id,
      runId: 'run-1',
    })

    expect(result.run.status).toBe('completed')
    expect(gradePikaAssignmentWithGradex).toHaveBeenCalledTimes(1)
    expect(gradeStudentWork).not.toHaveBeenCalled()
    expect(harness.docUpdates[0]).toEqual(expect.objectContaining({
      score_completion: 6,
      score_thinking: 7,
      score_workflow: 8,
      ai_feedback_model: 'gradex:gradex-model',
    }))
  })

  it('keeps using Pika for a persisted Pika background run if the live flag is later enabled', async () => {
    process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED = 'true'
    const harness = buildBackgroundRunHarness('gpt-5-nano')

    const result = await tickAssignmentAiGradingRun({
      assignmentId: assignment.id,
      runId: 'run-1',
    })

    expect(result.run.status).toBe('completed')
    expect(gradeStudentWork).toHaveBeenCalledTimes(1)
    expect(gradePikaAssignmentWithGradex).not.toHaveBeenCalled()
    expect(harness.docUpdates[0]).toEqual(expect.objectContaining({
      score_completion: 8,
      score_thinking: 7,
      score_workflow: 9,
      ai_feedback_model: 'gpt-5-nano',
    }))
  })
})
