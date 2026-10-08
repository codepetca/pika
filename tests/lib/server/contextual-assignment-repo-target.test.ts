import { describe, expect, it, vi } from 'vitest'

import { saveAssignmentRepoTargetForOwner } from '@/lib/server/contextual-assignment-repo-target'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const studentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const target = {
  selectedRepoUrl: 'https://github.com/codepetca/pika',
  overrideGitHubUsername: 'student-login',
  repoOwner: 'codepetca',
  repoName: 'pika',
  selectionMode: 'teacher_override' as const,
  validationStatus: 'valid' as const,
  validationMessage: null,
}

function repoTarget(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    assignment_id: assignmentId,
    student_id: studentId,
    selected_repo_url: target.selectedRepoUrl,
    override_github_username: target.overrideGitHubUsername,
    repo_owner: target.repoOwner,
    repo_name: target.repoName,
    selection_mode: target.selectionMode,
    validation_status: target.validationStatus,
    validation_message: target.validationMessage,
    validated_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function input(rpc: ReturnType<typeof vi.fn>, value = target as typeof target | null) {
  return {
    supabase: { rpc } as never,
    actorId,
    assignmentId,
    studentId,
    target: value,
  }
}

describe('saveAssignmentRepoTargetForOwner', () => {
  it('persists a strictly bound target through the owner RPC', async () => {
    const rpc = vi.fn(async (_name, args) => ({
      data: {
        ok: true,
        actor_id: actorId,
        assignment_id: assignmentId,
        student_id: studentId,
        repo_target: repoTarget({ validated_at: args.p_now }),
      },
      error: null,
    }))

    await expect(saveAssignmentRepoTargetForOwner(input(rpc))).resolves.toMatchObject({
      assignment_id: assignmentId,
      student_id: studentId,
      selection_mode: 'teacher_override',
    })
    expect(rpc).toHaveBeenCalledWith('save_assignment_repo_target_for_owner_v1', expect.objectContaining({
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
      p_student_id: studentId,
      p_target: expect.objectContaining({ repo_owner: 'codepetca' }),
    }))
  })

  it('accepts the equivalent PostgreSQL UTC timestamp representation', async () => {
    const rpc = vi.fn(async (_name, args) => ({
      data: {
        ok: true,
        actor_id: actorId,
        assignment_id: assignmentId,
        student_id: studentId,
        repo_target: repoTarget({ validated_at: args.p_now.replace('Z', '+00:00') }),
      },
      error: null,
    }))

    await expect(saveAssignmentRepoTargetForOwner(input(rpc))).resolves.toMatchObject({
      assignment_id: assignmentId,
      student_id: studentId,
      validation_status: 'valid',
    })
  })

  it('supports an exact reset result', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        actor_id: actorId,
        assignment_id: assignmentId,
        student_id: studentId,
        repo_target: null,
      },
      error: null,
    })
    await expect(saveAssignmentRepoTargetForOwner(input(rpc, null))).resolves.toBeNull()
  })

  it.each([
    { assignment_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    { student_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    { repo_owner: 'substituted' },
    { validated_at: '2026-09-20T00:00:00.000Z' },
  ])('rejects substituted result evidence', async (overrides) => {
    const rpc = vi.fn(async (_name, args) => ({
      data: {
        ok: true,
        actor_id: actorId,
        assignment_id: assignmentId,
        student_id: studentId,
        repo_target: repoTarget({ validated_at: args.p_now, ...overrides }),
      },
      error: null,
    }))
    await expect(saveAssignmentRepoTargetForOwner(input(rpc)))
      .rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    ['P0002', 404],
    ['42501', 403],
    ['55000', 403],
    ['40001', 409],
    ['55P03', 409],
    ['22023', 400],
    ['XX000', 503],
  ])('maps database error %s to HTTP %s', async (code, statusCode) => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code, message: code === '55000' ? 'assignment_repo_target_archived' : 'Database error' },
    })
    await expect(saveAssignmentRepoTargetForOwner(input(rpc)))
      .rejects.toMatchObject({ statusCode })
  })
})
