import { describe, expect, it, vi } from 'vitest'

import { createAssignmentForOwner } from '@/lib/server/contextual-assignment-creation'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const requirementId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: assignmentId,
    classroom_id: classroomId,
    created_by: actorId,
    title: 'Essay',
    ...overrides,
  }
}

function input(rpc: ReturnType<typeof vi.fn>) {
  return {
    supabase: { rpc },
    actorId,
    classroomId,
    title: 'Essay',
    description: 'Write an essay.',
    instructionsMarkdown: 'Write an essay.',
    richInstructions: { type: 'doc', content: [] },
    dueAt: '2099-01-01T23:59:59.000Z',
  }
}

describe('contextual assignment creation adapter', () => {
  it('normalizes requirements and binds returned evidence to the actor and Classroom', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        assignment: assignment(),
        submission_requirements: [{ id: requirementId, assignment_id: assignmentId }],
      },
      error: null,
    })

    await expect(createAssignmentForOwner({
      ...input(rpc),
      requirements: [{
        type: 'link',
        label: '  ',
        validation_policy_json: {
          mode: 'expected_domain',
          expected_domains: ['HTTPS://WWW.Example.com/path', 'example.com'],
        },
      }],
    })).resolves.toMatchObject({ assignment: { id: assignmentId } })

    expect(rpc).toHaveBeenCalledWith('create_assignment_for_owner_v1', expect.objectContaining({
      p_actor_id: actorId,
      p_classroom_id: classroomId,
      p_requirements: [{
        id: undefined,
        type: 'link',
        label: 'Link',
        instructions: '',
        required: true,
        position: 0,
        validation_policy_json: {
          mode: 'expected_domain',
          expected_domains: ['example.com'],
        },
      }],
    }))
  })

  it.each([
    assignment({ classroom_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
    assignment({ created_by: '22222222-2222-4222-8222-222222222222' }),
  ])('fails closed on cross-boundary Assignment evidence', async (returnedAssignment) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, assignment: returnedAssignment, submission_requirements: [] },
      error: null,
    })
    await expect(createAssignmentForOwner(input(rpc))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('fails closed on a cross-Assignment requirement', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        assignment: assignment(),
        submission_requirements: [{
          id: requirementId,
          assignment_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }],
      },
      error: null,
    })
    await expect(createAssignmentForOwner(input(rpc))).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    [{ code: 'P0002' }, 404],
    [{ code: '42501' }, 403],
    [{ code: '55000' }, 403],
    [{ code: '40001' }, 409],
    [{ code: '22023' }, 400],
    [{ code: 'XX000' }, 503],
  ] as const)('maps database error %s to HTTP %s', async (error, statusCode) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error })
    await expect(createAssignmentForOwner(input(rpc))).rejects.toMatchObject({ statusCode })
  })
})
