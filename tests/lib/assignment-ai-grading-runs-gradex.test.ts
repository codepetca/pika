import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Assignment } from '@/types'

const { gradeStudentWork } = vi.hoisted(() => ({
  gradeStudentWork: vi.fn(),
}))

const { gradePikaAssignmentWithGradex } = vi.hoisted(() => ({
  gradePikaAssignmentWithGradex: vi.fn(),
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

import { gradeAssignmentDocWithAi } from '@/lib/server/assignment-ai-grading-runs'

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

describe('assignment AI grading Gradex feature flag', () => {
  const originalFlag = process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED
  const originalSalt = process.env.GRADEX_PIKA_PSEUDONYM_SALT

  beforeEach(() => {
    vi.clearAllMocks()
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
})
