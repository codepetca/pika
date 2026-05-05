import { describe, expect, it, vi } from 'vitest'
import { finalizeUnsubmittedTestAttemptsOnClose } from '@/lib/server/finalize-test-attempts'

describe('finalizeUnsubmittedTestAttemptsOnClose', () => {
  it('delegates all-attempt finalization to the atomic RPC', async () => {
    const rpc = vi.fn(async () => ({
      data: { finalized_attempts: 2, inserted_responses: 3 },
      error: null,
    }))
    const mockSupabase = { rpc }

    const result = await finalizeUnsubmittedTestAttemptsOnClose(mockSupabase, 'test-1', {
      closedBy: 'teacher-1',
    })

    expect(result).toEqual({
      ok: true,
      finalized_attempts: 2,
      inserted_responses: 3,
    })
    expect(rpc).toHaveBeenCalledWith('finalize_test_attempts_for_grading_atomic', {
      p_test_id: 'test-1',
      p_student_ids: null,
      p_closed_by: 'teacher-1',
    })
  })

  it('passes selected students to the atomic RPC', async () => {
    const rpc = vi.fn(async () => ({
      data: { finalized_attempts: 1, inserted_responses: 1 },
      error: null,
    }))
    const mockSupabase = { rpc }

    const result = await finalizeUnsubmittedTestAttemptsOnClose(mockSupabase, 'test-1', {
      studentIds: ['student-1', 'student-1', 'student-2'],
      closedBy: null,
    })

    expect(result).toEqual({
      ok: true,
      finalized_attempts: 1,
      inserted_responses: 1,
    })
    expect(rpc).toHaveBeenCalledWith('finalize_test_attempts_for_grading_atomic', {
      p_test_id: 'test-1',
      p_student_ids: ['student-1', 'student-2'],
      p_closed_by: null,
    })
  })

  it('returns migration guidance when the atomic RPC is missing', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find function finalize_test_attempts_for_grading_atomic',
      },
    }))
    const mockSupabase = { rpc }

    const result = await finalizeUnsubmittedTestAttemptsOnClose(mockSupabase, 'test-1')

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Finalizing test attempts requires migrations 061-063 to be applied',
    })
  })

  it('returns a server error when the atomic RPC fails unexpectedly', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '23514', message: 'constraint violation' },
    }))
    const mockSupabase = { rpc }

    const result = await finalizeUnsubmittedTestAttemptsOnClose(mockSupabase, 'test-1')

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Failed to finalize test submissions',
    })
  })
})
