import { describe, expect, it, vi } from 'vitest'
import { updateAssignmentWithSubmissionRequirementsAtomic } from '@/lib/server/assignment-submission-artifacts'

function makeAssignment() {
  return {
    classroom_id: 'classroom-1',
    created_at: '2026-07-16T12:00:00.000Z',
    created_by: 'teacher-1',
    description: 'Instructions',
    due_at: '2026-08-01T03:59:59.000Z',
    gradebook_weight: 1,
    id: 'assignment-1',
    include_in_final: true,
    instructions_markdown: 'Instructions',
    is_draft: false,
    points_possible: 100,
    position: 0,
    released_at: null,
    rich_instructions: null,
    title: 'Assignment',
    track_authenticity: true,
    updated_at: '2026-07-16T12:01:00.000Z',
  }
}

describe('atomic assignment and requirement updates', () => {
  it('parses a complete successful RPC result', async () => {
    const assignment = makeAssignment()
    const result = await updateAssignmentWithSubmissionRequirementsAtomic({
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: { ok: true, assignment, submission_requirements: [] },
          error: null,
        }),
      },
      assignmentId: assignment.id,
      updates: { title: assignment.title },
      requirements: [],
    })

    expect(result).toEqual({
      ok: true,
      assignment,
      submissionRequirements: [],
    })
  })

  it('accepts and strips additive assignment fields during migration-first rollout', async () => {
    const assignment = { ...makeAssignment(), future_assignment_field: 'new-column' }
    const result = await updateAssignmentWithSubmissionRequirementsAtomic({
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: {
            ok: true,
            future_envelope_field: 'new-server-metadata',
            assignment,
            submission_requirements: [],
          },
          error: null,
        }),
      },
      assignmentId: assignment.id,
      updates: { title: assignment.title },
      requirements: [],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.assignment).not.toHaveProperty('future_assignment_field')
  })

  it('rejects malformed successful RPC data', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await updateAssignmentWithSubmissionRequirementsAtomic({
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: {
            ok: true,
            assignment: { ...makeAssignment(), due_at: 'not-a-timestamp' },
            submission_requirements: [{ type: 'repo' }],
          },
          error: null,
        }),
      },
      assignmentId: 'assignment-1',
      updates: {},
      requirements: [],
    })

    expect(result).toEqual({ ok: false, status: 500, error: 'Failed to update assignment' })
    expect(consoleError).toHaveBeenCalled()
  })
})
