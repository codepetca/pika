import { beforeEach, describe, expect, it, vi } from 'vitest'
import { returnStudentTestAttempts } from '@/lib/server/test-return'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc }) }))
const input = { testId: 'test', teacherId: 'teacher', studentIds: ['student', 'unstarted', 'already-returned'] }
describe('transactional Test Return', () => {
  beforeEach(() => vi.clearAllMocks())
  it('reports committed counts, including idempotent returns and skipped attempts', async () => {
    const counts = { returned_count: 1, already_returned_count: 1, skipped_count: 1, test_closed: false }
    rpc.mockResolvedValueOnce({ data: counts, error: null })
    expect(await returnStudentTestAttempts(input)).toEqual({ ok: true, counts })
    expect(rpc).toHaveBeenCalledWith('return_test_attempts_checked_atomic', {
      p_test_id: 'test', p_returned_by: 'teacher', p_student_ids: input.studentIds,
    })
  })
  it.each([
    ['PT409', 409, 'Close selected students before returning their test work.'],
    ['40001', 409, 'Close selected students before returning their test work.'],
    ['42501', 403, 'Test return is not allowed'],
    ['22023', 400, 'One or more selected students are not enrolled in this classroom'],
    ['PGRST202', 503, 'Test lifecycle migration 244 is required'],
  ])('fails closed on transactional guard %s', async (code, status, error) => {
    rpc.mockResolvedValueOnce({ data: null, error: { code, message: error } })
    expect(await returnStudentTestAttempts(input)).toEqual({ ok: false, status, error })
    expect(rpc).toHaveBeenCalledOnce()
  })
  it('does not report a caller-provided count when the committed result is malformed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValueOnce({ data: { returned_count: 3, skipped_count: 0 }, error: null })
    expect(await returnStudentTestAttempts(input)).toEqual({ ok: false, status: 500, error: 'Failed to return test work' })
    spy.mockRestore()
  })
})
