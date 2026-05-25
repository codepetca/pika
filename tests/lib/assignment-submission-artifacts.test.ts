import { describe, expect, it, vi } from 'vitest'
import { replaceAssignmentSubmissionRequirements } from '@/lib/server/assignment-submission-artifacts'
import type { AssignmentSubmissionRequirement } from '@/types'

function makeRequirement(
  overrides: Partial<AssignmentSubmissionRequirement>
): AssignmentSubmissionRequirement {
  return {
    id: overrides.id ?? 'req-1',
    assignment_id: overrides.assignment_id ?? 'assignment-1',
    type: overrides.type ?? 'link',
    label: overrides.label ?? 'Public link',
    instructions: overrides.instructions ?? '',
    required: overrides.required ?? true,
    position: overrides.position ?? 0,
    validation_policy_json: overrides.validation_policy_json ?? {},
    created_at: overrides.created_at ?? '2026-05-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-05-01T00:00:00.000Z',
  }
}

describe('replaceAssignmentSubmissionRequirements', () => {
  it('delegates replacement to the atomic database function with normalized drafts', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        makeRequirement({ id: 'new-1', type: 'link', label: 'Public demo', position: 0 }),
        makeRequirement({ id: 'req-repo', type: 'repo_link', label: 'Repository URL', position: 1 }),
      ],
      error: null,
    }))
    const supabase = { rpc }

    const result = await replaceAssignmentSubmissionRequirements(supabase, 'assignment-1', [
      { type: 'link', label: '  Public demo  ', position: 0 },
      { id: 'req-repo', type: 'repo_link', label: 'Repository URL', position: 1 },
    ])

    expect(rpc).toHaveBeenCalledWith('replace_assignment_submission_requirements_atomic', {
      p_assignment_id: 'assignment-1',
      p_requirements: [
        {
          id: undefined,
          type: 'link',
          label: 'Public demo',
          instructions: '',
          required: true,
          position: 0,
          validation_policy_json: {},
        },
        {
          id: 'req-repo',
          type: 'repo_link',
          label: 'Repository URL',
          instructions: '',
          required: true,
          position: 1,
          validation_policy_json: {},
        },
      ],
    })
    expect(result.map((requirement) => requirement.id)).toEqual(['new-1', 'req-repo'])
  })
})
