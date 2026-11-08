import { deleteAssignmentWithRepoLightCleanup } from '@/lib/server/repolight-assignment-delete'
vi.mock('@/lib/server/repolight-assignment-delete', async original => ({ ...await original<typeof import('@/lib/server/repolight-assignment-delete')>(), deleteAssignmentWithRepoLightCleanup: vi.fn() }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { PATCH, DELETE } from '@/app/api/teacher/assignments/[id]/route'
import { POST as releaseAssignment, DELETE as cancelRelease } from '@/app/api/teacher/assignments/[id]/release/route'
import { POST as discardAssignment } from '@/app/api/teacher/assignments/[id]/discard-pristine/route'
import { authorizeContextualAssignmentOwnerMutationRequest } from '@/lib/server/contextual-assignment-owner-mutation-access'
import {
  discardPristineAssignmentDraftForOwner,
  releaseAssignmentForOwner,
  updateAssignmentForOwner,
} from '@/lib/server/contextual-assignment-owner-mutations'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const intentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const user = { id: actorId, role: 'student', email: 'owner@example.com' }

const mockRunCleanup = vi.hoisted(() => vi.fn(async () => ({ claimed: 0, completed: 0, failed: 0 })))
const mockSupabase = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } }))

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabase) }))
vi.mock('@/lib/server/assignment-ai-grading-runs', () => ({
  getActiveAssignmentAiGradingRunSummary: vi.fn(async () => null),
}))
vi.mock('@/lib/server/assignment-artifact-storage-cleanup', () => ({
  runAssignmentArtifactStorageCleanup: mockRunCleanup,
}))
vi.mock('@/lib/server/contextual-assignment-owner-mutation-access', () => ({
  authorizeContextualAssignmentOwnerMutationRequest: vi.fn(),
}))
vi.mock('@/lib/server/contextual-assignment-owner-mutations', () => ({
  deleteAssignmentForOwner: vi.fn(),
  discardPristineAssignmentDraftForOwner: vi.fn(),
  releaseAssignmentForOwner: vi.fn(),
  updateAssignmentForOwner: vi.fn(),
}))

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: assignmentId,
    classroom_id: classroomId,
    title: 'Draft assignment',
    description: '',
    instructions_markdown: '',
    rich_instructions: null,
    due_at: '2099-01-02T00:00:00.000Z',
    is_draft: true,
    released_at: null,
    updated_at: '2026-09-20T12:00:00.000Z',
    classrooms: { teacher_id: actorId, archived_at: null },
    ...overrides,
  }
}

function selectAssignment(existing = assignment()) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: existing, error: null }),
      })),
    })),
  }
}

describe('contextual existing-assignment owner mutation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authorizeContextualAssignmentOwnerMutationRequest).mockResolvedValue({
      mode: 'contextual', user: user as any, assignmentId,
    })
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'assignments') return selectAssignment()
      throw new Error(`Unexpected table: ${table}`)
    })
  })

  it('routes a student-valued exact-pair owner update through the actor-bound RPC adapter', async () => {
    vi.mocked(updateAssignmentForOwner).mockResolvedValue({
      ok: true,
      assignment: assignment({ title: 'Updated title' }) as never,
      submissionRequirements: [],
    })
    const response = await PATCH(new NextRequest(
      `http://localhost/api/teacher/assignments/${assignmentId}`,
      { method: 'PATCH', body: JSON.stringify({ title: 'Updated title' }) },
    ), { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(200)
    expect(updateAssignmentForOwner).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
      updates: expect.objectContaining({ title: 'Updated title' }),
    }))
  })

  it('routes contextual deletion through the actor-bound RPC and retains queued cleanup', async () => {
    vi.mocked(deleteAssignmentWithRepoLightCleanup).mockResolvedValue({ complete: true, operationId: assignmentId })
    const response = await DELETE(new NextRequest(
      `http://localhost/api/teacher/assignments/${assignmentId}`,
      { method: 'DELETE' },
    ), { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(200)
    expect(deleteAssignmentWithRepoLightCleanup).toHaveBeenCalledWith(expect.objectContaining({ actorId, assignmentId }))
    expect(mockRunCleanup).toHaveBeenCalledTimes(1)
  })

  it('keeps pending cleanup a non-success response and retains its operation ID', async () => {
    vi.mocked(deleteAssignmentWithRepoLightCleanup).mockResolvedValue({ complete: false, operationId: assignmentId })
    const response = await DELETE(new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}`, {
      method: 'DELETE', body: JSON.stringify({ operationId: assignmentId }),
    }), { params: Promise.resolve({ id: assignmentId }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ errorCode: 'repolight_cleanup_pending', operationId: assignmentId })
    expect(mockRunCleanup).not.toHaveBeenCalled()
  })

  it('routes contextual release through the actor-bound RPC', async () => {
    vi.mocked(releaseAssignmentForOwner).mockResolvedValue({
      ok: true,
      assignment: assignment({ is_draft: false, released_at: '2099-01-01T00:00:00.000Z' }) as never,
    })
    const response = await releaseAssignment(new NextRequest(
      `http://localhost/api/teacher/assignments/${assignmentId}/release`,
      { method: 'POST', body: JSON.stringify({ release_at: '2099-01-01T00:00:00.000Z' }) },
    ), { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(200)
    expect(releaseAssignmentForOwner).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
      scheduled: true,
    }))
  })

  it('returns a guarded schedule while keeping canonical draft evidence', async () => {
    const scheduledFor = '2099-01-01T00:00:00.000Z'
    const schedule = { id: intentId, scheduled_for: scheduledFor, state: 'pending', notice_code: null }
    mockSupabase.rpc.mockResolvedValue({ data: {
      assignment: assignment(), release_schedule: schedule,
    }, error: null })

    const response = await releaseAssignment(new NextRequest(
      `http://localhost/api/teacher/assignments/${assignmentId}/release`,
      { method: 'POST', body: JSON.stringify({ release_at: scheduledFor }) },
    ), { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(200)
    expect(mockSupabase.rpc).toHaveBeenCalledExactlyOnceWith('schedule_assignment_for_billing_v1', {
      p_actor_id: actorId, p_assignment_id: assignmentId, p_scheduled_for: scheduledFor,
    })
    expect(await response.json()).toMatchObject({ assignment: { id: assignmentId, is_draft: true, released_at: null, release_schedule: schedule } })
    expect(releaseAssignmentForOwner).not.toHaveBeenCalled()
  })

  it('passes the observed generation when rescheduling or canceling', async () => {
    const scheduledFor = '2099-01-01T00:00:00.000Z'
    const context = { params: Promise.resolve({ id: assignmentId }) }
    const url = `http://localhost/api/teacher/assignments/${assignmentId}/release`
    mockSupabase.rpc.mockResolvedValueOnce({ error: { code: 'PT409', message: 'billing_assignment_schedule_changed' } })
    const conflict = await releaseAssignment(new NextRequest(url, {
      method: 'POST', body: JSON.stringify({ release_at: scheduledFor, expected_intent_id: intentId }),
    }), context)
    expect(conflict.status).toBe(409)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('schedule_assignment_for_billing_v1', {
      p_actor_id: actorId, p_assignment_id: assignmentId, p_scheduled_for: scheduledFor, p_expected_intent_id: intentId,
    })

    mockSupabase.rpc.mockResolvedValueOnce({ data: { assignment: assignment(), release_schedule: null }, error: null })
    const response = await cancelRelease(new NextRequest(url, {
      method: 'DELETE', body: JSON.stringify({ expected_intent_id: intentId }),
    }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ assignment: { is_draft: true, released_at: null, release_schedule: null } })
    expect(mockSupabase.rpc).toHaveBeenCalledWith('cancel_assignment_release_for_owner_v1', {
      p_actor_id: actorId, p_assignment_id: assignmentId, p_expected_intent_id: intentId,
    })
    expect(releaseAssignmentForOwner).not.toHaveBeenCalled()
  })

  it('uses the observed generation for manual posting without falling back when the RPC is unavailable', async () => {
    const url = `http://localhost/api/teacher/assignments/${assignmentId}/release`
    const response = await releaseAssignment(new NextRequest(url, {
      method: 'POST', body: JSON.stringify({ expected_intent_id: intentId }),
    }), { params: Promise.resolve({ id: assignmentId }) })
    expect(response.status).toBe(503)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('publish_scheduled_assignment_for_owner_v1', {
      p_actor_id: actorId, p_assignment_id: assignmentId, p_expected_intent_id: intentId,
    })
    expect(releaseAssignmentForOwner).not.toHaveBeenCalled()
  })

  it('does not treat a malformed release request as an immediate post', async () => {
    const response = await releaseAssignment(new NextRequest(
      `http://localhost/api/teacher/assignments/${assignmentId}/release`,
      { method: 'POST', body: '{' },
    ), { params: Promise.resolve({ id: assignmentId }) })
    expect(response.status).toBe(400)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
    expect(releaseAssignmentForOwner).not.toHaveBeenCalled()
  })

  it.each([
    ['PT403', 'billing_classroom_new_work_unavailable', 403, 'Assignment release is unavailable for this classroom.'],
    ['PT409', 'billing_assignment_publication_busy', 409, 'Assignment changed during this update. Refresh and try again.'],
  ])('surfaces a legacy publication error with code %s', async (code, message, status, errorText) => {
    vi.mocked(authorizeContextualAssignmentOwnerMutationRequest).mockResolvedValue({
      mode: 'legacy', user: user as any, assignmentId,
    })
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: null, error: { code, message },
          }),
        })),
      })),
    }))
    mockSupabase.from.mockReturnValue({ ...selectAssignment(), update })

    const response = await releaseAssignment(new NextRequest(
      `http://localhost/api/teacher/assignments/${assignmentId}/release`,
      { method: 'POST', body: '{}' },
    ), { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ error: errorText })
    expect(releaseAssignmentForOwner).not.toHaveBeenCalled()
  })

  it('routes contextual pristine discard through the actor-bound RPC', async () => {
    vi.mocked(discardPristineAssignmentDraftForOwner).mockResolvedValue({ discarded: true })
    const response = await discardAssignment(new NextRequest(
      `http://localhost/api/teacher/assignments/${assignmentId}/discard-pristine`,
      {
        method: 'POST',
        body: JSON.stringify({ expected_updated_at: '2026-09-20T12:00:00.000Z' }),
      },
    ), { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(200)
    expect(discardPristineAssignmentDraftForOwner).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
    }))
  })
})
