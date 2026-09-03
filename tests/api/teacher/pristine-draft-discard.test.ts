import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as discardAssignment } from '@/app/api/teacher/assignments/[id]/discard-pristine/route'
import { POST as discardTest } from '@/app/api/teacher/tests/[id]/discard-pristine/route'
import {
  discardPristineAssignmentDraftAtomic,
  discardPristineTestDraftAtomic,
} from '@/lib/server/pristine-draft-discard'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1' })),
}))

vi.mock('@/lib/server/pristine-draft-discard', () => ({
  discardPristineAssignmentDraftAtomic: vi.fn(),
  discardPristineTestDraftAtomic: vi.fn(),
}))

describe('pristine draft discard routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the Assignment version fence to the atomic discard boundary', async () => {
    vi.mocked(discardPristineAssignmentDraftAtomic).mockResolvedValueOnce({ discarded: true })
    const response = await discardAssignment(new NextRequest(
      'http://localhost:3000/api/teacher/assignments/assignment-1/discard-pristine',
      {
        method: 'POST',
        body: JSON.stringify({ expected_updated_at: '2026-05-14T10:45:00.000Z' }),
      },
    ), { params: Promise.resolve({ id: 'assignment-1' }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ discarded: true })
    expect(discardPristineAssignmentDraftAtomic).toHaveBeenCalledWith({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      expectedUpdatedAt: '2026-05-14T10:45:00.000Z',
    })
  })

  it('returns the preserved Assignment when a same-teacher edit wins the race', async () => {
    vi.mocked(discardPristineAssignmentDraftAtomic).mockResolvedValueOnce({
      discarded: false,
      assignment: { id: 'assignment-1', title: 'Edited in another tab' } as never,
    })
    const response = await discardAssignment(new NextRequest(
      'http://localhost:3000/api/teacher/assignments/assignment-1/discard-pristine',
      {
        method: 'POST',
        body: JSON.stringify({ expected_updated_at: '2026-05-14T10:45:00.000Z' }),
      },
    ), { params: Promise.resolve({ id: 'assignment-1' }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      discarded: false,
      assignment: { title: 'Edited in another tab' },
    })
  })

  it('passes both Test concurrency fences to the atomic discard boundary', async () => {
    vi.mocked(discardPristineTestDraftAtomic).mockResolvedValueOnce({ discarded: true })
    const response = await discardTest(new NextRequest(
      'http://localhost:3000/api/teacher/tests/test-1/discard-pristine',
      {
        method: 'POST',
        body: JSON.stringify({
          expected_draft_version: 7,
          expected_test_updated_at: '2026-05-14T10:45:00.000Z',
        }),
      },
    ), { params: Promise.resolve({ id: 'test-1' }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ discarded: true })
    expect(discardPristineTestDraftAtomic).toHaveBeenCalledWith({
      testId: 'test-1',
      teacherId: 'teacher-1',
      expectedDraftVersion: 7,
      expectedTestUpdatedAt: '2026-05-14T10:45:00.000Z',
    })
  })

  it('returns the preserved Test when a same-teacher edit wins the race', async () => {
    vi.mocked(discardPristineTestDraftAtomic).mockResolvedValueOnce({
      discarded: false,
      test: { id: 'test-1', title: 'Edited in another tab' } as never,
    })
    const response = await discardTest(new NextRequest(
      'http://localhost:3000/api/teacher/tests/test-1/discard-pristine',
      {
        method: 'POST',
        body: JSON.stringify({
          expected_draft_version: 7,
          expected_test_updated_at: '2026-05-14T10:45:00.000Z',
        }),
      },
    ), { params: Promise.resolve({ id: 'test-1' }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      discarded: false,
      test: { title: 'Edited in another tab' },
    })
  })
})
