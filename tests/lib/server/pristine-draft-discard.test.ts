import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  discardPristineAssignmentDraftAtomic,
  discardPristineTestDraftAtomic,
} from '@/lib/server/pristine-draft-discard'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => ({ rpc })),
}))

describe('pristine draft discard database boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fences Assignment cleanup with the observed updated_at', async () => {
    rpc.mockResolvedValueOnce({ data: { discarded: true }, error: null })

    await expect(discardPristineAssignmentDraftAtomic({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      expectedUpdatedAt: '2026-05-14T10:45:00.000Z',
    })).resolves.toEqual({ discarded: true })
    expect(rpc).toHaveBeenCalledWith('discard_pristine_assignment_draft_atomic', {
      p_assignment_id: 'assignment-1',
      p_expected_updated_at: '2026-05-14T10:45:00.000Z',
      p_teacher_id: 'teacher-1',
    })
  })

  it('surfaces the current Assignment instead of deleting after a concurrent edit', async () => {
    rpc.mockResolvedValueOnce({
      data: { discarded: false, assignment: { id: 'assignment-1', title: 'Changed' } },
      error: null,
    })

    await expect(discardPristineAssignmentDraftAtomic({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      expectedUpdatedAt: '2026-05-14T10:45:00.000Z',
    })).resolves.toMatchObject({ discarded: false, assignment: { title: 'Changed' } })
  })

  it('fences Test cleanup with the observed draft and Test row versions', async () => {
    rpc.mockResolvedValueOnce({ data: { discarded: true }, error: null })

    await expect(discardPristineTestDraftAtomic({
      testId: 'test-1',
      teacherId: 'teacher-1',
      expectedDraftVersion: 7,
      expectedTestUpdatedAt: '2026-05-14T10:45:00.000Z',
    })).resolves.toEqual({ discarded: true })
    expect(rpc).toHaveBeenCalledWith('discard_pristine_test_draft_atomic', {
      p_expected_draft_version: 7,
      p_expected_test_updated_at: '2026-05-14T10:45:00.000Z',
      p_teacher_id: 'teacher-1',
      p_test_id: 'test-1',
    })
  })

  it('surfaces the current Test instead of deleting after a concurrent edit', async () => {
    rpc.mockResolvedValueOnce({
      data: { discarded: false, test: { id: 'test-1', title: 'Changed' } },
      error: null,
    })

    await expect(discardPristineTestDraftAtomic({
      testId: 'test-1',
      teacherId: 'teacher-1',
      expectedDraftVersion: 7,
      expectedTestUpdatedAt: '2026-05-14T10:45:00.000Z',
    })).resolves.toMatchObject({ discarded: false, test: { title: 'Changed' } })
  })
})
