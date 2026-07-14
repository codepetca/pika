import { describe, expect, it } from 'vitest'
import {
  gradexAssignmentRunItemResponseSchema,
  gradexAssignmentRunResponseSchema,
} from '@/lib/server/gradex-assignment-grading'

const validRun = {
  id: 'gradex-run-1',
  status: 'completed',
  counts: {
    requested: 1,
    processed: 1,
    completed: 1,
    failed: 0,
    skipped: 0,
    pending: 0,
  },
  provider: 'openai',
  model: 'gpt-5-nano',
  tier: 'standard',
  policy_version: 'v1',
  prompt_version: 'v1',
  items: [{
    id: 'item-1',
    status: 'completed',
    external_submission_id: 'submission-1',
    external_student_id: 'student-1',
    error: null,
  }],
}

describe('Gradex assignment response contracts', () => {
  it('accepts a complete grading run and item response', () => {
    expect(gradexAssignmentRunResponseSchema.safeParse(validRun).success).toBe(true)
    expect(gradexAssignmentRunItemResponseSchema.safeParse({
      ...validRun.items[0],
      result: {
        provider: 'openai',
        model: 'gpt-5-nano',
        tier: 'standard',
        policy_version: 'v1',
        prompt_version: 'v1',
        audit_id: 'audit-1',
        token_usage: null,
        compatibility: {
          pika_assignment_v1: {
            score_completion: 8,
            score_thinking: 7,
            score_workflow: 9,
            feedback: 'Clear evidence and a concrete next step.',
          },
        },
      },
    }).success).toBe(true)
  })

  it('rejects malformed successful run responses before metadata persistence', () => {
    expect(gradexAssignmentRunResponseSchema.safeParse({
      ...validRun,
      id: undefined,
    }).success).toBe(false)
    expect(gradexAssignmentRunResponseSchema.safeParse({
      ...validRun,
      status: 'done',
    }).success).toBe(false)
    expect(gradexAssignmentRunResponseSchema.safeParse({
      ...validRun,
      counts: { ...validRun.counts, pending: -1 },
    }).success).toBe(false)
  })

  it('rejects malformed successful item responses before grade mapping', () => {
    expect(gradexAssignmentRunItemResponseSchema.safeParse({
      ...validRun.items[0],
      result: { provider: 'openai' },
    }).success).toBe(false)
  })
})
