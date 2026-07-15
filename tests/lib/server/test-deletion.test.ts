import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-handler'
import { deleteTeacherTestAtomic } from '@/lib/server/test-deletion'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({ rpc }),
}))

describe('deleteTeacherTestAtomic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the atomic response count', async () => {
    rpc.mockResolvedValueOnce({ data: { deleted: true, responses_count: 4 }, error: null })

    await expect(deleteTeacherTestAtomic({
      testId: 'test-1',
      teacherId: 'teacher-1',
    })).resolves.toEqual({ deleted: true, responsesCount: 4 })
    expect(rpc).toHaveBeenCalledWith('delete_test_atomic', {
      p_test_id: 'test-1',
      p_teacher_id: 'teacher-1',
    })
  })

  it.each([
    [{ code: 'P0002', message: 'Test not found' }, 404],
    [{ code: '42501', message: 'Classroom is archived' }, 403],
    [{ code: '22023', message: 'Invalid payload' }, 400],
  ])('maps database error %#', async (error, statusCode) => {
    rpc.mockResolvedValueOnce({ data: null, error })
    await expect(deleteTeacherTestAtomic({ testId: 'test-1', teacherId: 'teacher-1' }))
      .rejects.toMatchObject<ApiError>({ statusCode })
  })

  it('rejects malformed successful results', async () => {
    rpc.mockResolvedValueOnce({ data: { deleted: true, responses_count: -1 }, error: null })
    await expect(deleteTeacherTestAtomic({ testId: 'test-1', teacherId: 'teacher-1' }))
      .rejects.toThrow('Invalid test deletion result')
  })
})
