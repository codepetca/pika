import { describe, expect, it } from 'vitest'
import {
  PIKA_ASSIGNMENT_GRADING_PROFILE,
  PIKA_ASSIGNMENT_GRADING_PROFILE_VERSION,
  PIKA_ASSIGNMENT_PROMPT_VERSION,
  PIKA_ASSIGNMENT_RUBRIC_VERSION,
} from '@/lib/grading/profiles/pika-assignment'

describe('Pika assignment grading profile', () => {
  it('exposes stable profile, prompt, and rubric versions', () => {
    expect(PIKA_ASSIGNMENT_GRADING_PROFILE.id).toBe('pika-assignment')
    expect(PIKA_ASSIGNMENT_GRADING_PROFILE.version).toBe(PIKA_ASSIGNMENT_GRADING_PROFILE_VERSION)
    expect(PIKA_ASSIGNMENT_GRADING_PROFILE.promptVersion).toBe(PIKA_ASSIGNMENT_PROMPT_VERSION)
    expect(PIKA_ASSIGNMENT_GRADING_PROFILE.rubric.version).toBe(PIKA_ASSIGNMENT_RUBRIC_VERSION)
    expect(PIKA_ASSIGNMENT_GRADING_PROFILE.rubric.criteria.map((criterion) => criterion.id)).toEqual([
      'completion',
      'thinking',
      'workflow',
    ])
  })

  it('normalizes the legacy assignment output into criterion results', () => {
    const parsed = PIKA_ASSIGNMENT_GRADING_PROFILE.parseOutput(
      '{"score_completion":8,"score_thinking":7,"score_workflow":6,"feedback":"Specific feedback."}',
    )

    expect(PIKA_ASSIGNMENT_GRADING_PROFILE.normalizeOutput(parsed)).toEqual({
      criteria: [
        { criterionId: 'completion', score: 8 },
        { criterionId: 'thinking', score: 7 },
        { criterionId: 'workflow', score: 6 },
      ],
      feedback: { student: 'Specific feedback.', teacherNotes: null },
    })
  })
})
