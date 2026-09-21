import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { PATCH, DELETE } from '@/app/api/teacher/assignments/[id]/route'
import { POST as releaseAssignment } from '@/app/api/teacher/assignments/[id]/release/route'
import { POST as discardAssignment } from '@/app/api/teacher/assignments/[id]/discard-pristine/route'
import { authorizeContextualAssignmentOwnerMutationRequest } from '@/lib/server/contextual-assignment-owner-mutation-access'
import {
  deleteAssignmentForOwner,
  discardPristineAssignmentDraftForOwner,
  releaseAssignmentForOwner,
  updateAssignmentForOwner,
} from '@/lib/server/contextual-assignment-owner-mutations'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
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
    vi.mocked(deleteAssignmentForOwner).mockResolvedValue({ ok: true, classroomId })
    const response = await DELETE(new NextRequest(
      `http://localhost/api/teacher/assignments/${assignmentId}`,
      { method: 'DELETE' },
    ), { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(200)
    expect(deleteAssignmentForOwner).toHaveBeenCalledWith(expect.objectContaining({ actorId, assignmentId }))
    expect(mockRunCleanup).toHaveBeenCalledTimes(1)
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
