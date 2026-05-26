import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-handler'

const { mockSupabaseClient } = vi.hoisted(() => ({
  mockSupabaseClient: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

import {
  assertTeacherCanMutateAssignment,
  assertTeacherOwnsAssignment,
} from '@/lib/server/repo-review'

function installAssignmentLookup(assignment: unknown) {
  mockSupabaseClient.from.mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: assignment,
          error: null,
        }),
      })),
    })),
  })
}

describe('assignment ownership guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from.mockReset()
  })

  it('allows read ownership checks for archived assignments', async () => {
    const assignment = {
      id: 'assignment-1',
      classroom_id: 'classroom-1',
      classrooms: {
        id: 'classroom-1',
        title: 'Archived class',
        teacher_id: 'teacher-1',
        archived_at: '2026-05-01T12:00:00.000Z',
      },
    }
    installAssignmentLookup(assignment)

    await expect(assertTeacherOwnsAssignment('teacher-1', 'assignment-1')).resolves.toEqual(assignment)
  })

  it('rejects mutation checks for archived assignments', async () => {
    installAssignmentLookup({
      id: 'assignment-1',
      classroom_id: 'classroom-1',
      classrooms: {
        id: 'classroom-1',
        title: 'Archived class',
        teacher_id: 'teacher-1',
        archived_at: '2026-05-01T12:00:00.000Z',
      },
    })

    await expect(assertTeacherCanMutateAssignment('teacher-1', 'assignment-1')).rejects.toMatchObject({
      statusCode: 403,
      message: 'Classroom is archived',
    } satisfies Partial<ApiError>)
  })
})
