import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  saveStudentTestAttempt,
  submitStudentTestAttempt,
} from '@/lib/server/test-submissions'
import {
  insertVersionedBaselineHistory,
  persistVersionedHistory,
} from '@/lib/server/versioned-history'

const rpc = vi.fn()
const mockSupabaseClient = { rpc }

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/server/versioned-history', () => ({
  insertVersionedBaselineHistory: vi.fn(async () => ({ id: 'history-1' })),
  persistVersionedHistory: vi.fn(async () => ({ id: 'history-2' })),
}))

const responses = {
  'question-1': { question_type: 'multiple_choice' as const, selected_option: 1 },
  'question-2': { question_type: 'open_response' as const, response_text: 'Reasoning' },
}

describe('submitStudentTestAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({
      data: {
        attempt_id: '10000000-0000-4000-8000-000000000001',
        submitted_at: '2026-07-14T12:00:00.000Z',
        inserted_responses: 2,
      },
      error: null,
    })
  })

  it('submits through the RPC and records versioned history after commit', async () => {
    const result = await submitStudentTestAttempt({
      testId: 'test-1',
      studentId: 'student-1',
      responses,
    })

    expect(result).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('submit_test_attempt_atomic', {
      p_test_id: 'test-1',
      p_student_id: 'student-1',
      p_responses: responses,
      p_submitted_at: expect.any(String),
    })
    expect(insertVersionedBaselineHistory).toHaveBeenCalledWith(expect.objectContaining({
      supabase: mockSupabaseClient,
      table: 'test_attempt_history',
      ownerColumn: 'test_attempt_id',
      ownerId: '10000000-0000-4000-8000-000000000001',
      content: responses,
      trigger: 'submit',
    }))
  })

  it('keeps a committed submission successful when history persistence fails', async () => {
    vi.mocked(insertVersionedBaselineHistory).mockRejectedValueOnce(new Error('history unavailable'))

    await expect(submitStudentTestAttempt({
      testId: 'test-1',
      studentId: 'student-1',
      responses,
    })).resolves.toEqual({ ok: true })
  })

  it.each([
    ['22023', 'All questions must be answered', 400, 'All questions must be answered'],
    ['23505', 'duplicate key value violates unique constraint', 400, 'You have already responded to this test'],
    ['42501', 'Student is not enrolled in this classroom', 403, 'Student is not enrolled in this classroom'],
    ['P0002', 'Test not found', 404, 'Test not found'],
    ['22P02', 'invalid input syntax for type uuid', 404, 'Test not found'],
    ['PGRST202', 'Could not find the function', 500, 'Test submission migration is required'],
    ['42883', 'function does not exist', 500, 'Test submission migration is required'],
    ['XX000', 'internal database detail', 500, 'Failed to submit responses'],
  ])('maps RPC error %s', async (code, message, status, error) => {
    rpc.mockResolvedValueOnce({ data: null, error: { code, message } })

    const result = await submitStudentTestAttempt({
      testId: 'test-1',
      studentId: 'student-1',
      responses,
    })

    expect(result).toEqual({ ok: false, status, error })
    expect(insertVersionedBaselineHistory).not.toHaveBeenCalled()
  })

  it('fails closed when the RPC returns a malformed success payload', async () => {
    rpc.mockResolvedValueOnce({ data: { inserted_responses: 2 }, error: null })

    await expect(submitStudentTestAttempt({
      testId: 'test-1',
      studentId: 'student-1',
      responses,
    })).resolves.toEqual({ ok: false, status: 500, error: 'Failed to submit responses' })
    expect(insertVersionedBaselineHistory).not.toHaveBeenCalled()
  })
})

const savedAttempt = {
  id: '10000000-0000-4000-8000-000000000020',
  test_id: '10000000-0000-4000-8000-000000000010',
  student_id: '10000000-0000-4000-8000-000000000002',
  responses,
  is_submitted: false,
  submitted_at: null,
  created_at: '2026-07-14T12:00:00.000Z',
  updated_at: '2026-07-14T12:01:00.000Z',
}

describe('saveStudentTestAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({
      data: { created: true, previous_responses: {}, attempt: savedAttempt },
      error: null,
    })
  })

  it('creates a draft through the RPC and writes baseline history', async () => {
    const result = await saveStudentTestAttempt({
      testId: savedAttempt.test_id,
      studentId: savedAttempt.student_id,
      responses,
      trigger: 'blur',
      pasteWordCount: 2,
      keystrokeCount: 4,
    })

    expect(result).toEqual({ ok: true, attempt: savedAttempt, historyEntry: { id: 'history-1' } })
    expect(rpc).toHaveBeenCalledWith('save_test_attempt_atomic', {
      p_test_id: savedAttempt.test_id,
      p_student_id: savedAttempt.student_id,
      p_responses: responses,
    })
    expect(insertVersionedBaselineHistory).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: savedAttempt.id,
      trigger: 'baseline',
      content: responses,
    }))
    expect(persistVersionedHistory).not.toHaveBeenCalled()
  })

  it('writes patch history for an existing draft', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        created: false,
        previous_responses: {
          'question-1': { question_type: 'multiple_choice', selected_option: 0 },
        },
        attempt: savedAttempt,
      },
      error: null,
    })

    const result = await saveStudentTestAttempt({
      testId: savedAttempt.test_id,
      studentId: savedAttempt.student_id,
      responses,
      trigger: 'blur',
      pasteWordCount: 0,
      keystrokeCount: 1,
    })

    expect(result.ok).toBe(true)
    expect(persistVersionedHistory).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: savedAttempt.id,
      trigger: 'blur',
      nextContent: responses,
    }))
    expect(insertVersionedBaselineHistory).not.toHaveBeenCalled()
  })

  it.each([
    ['22023', 'Invalid option', 400, 'Invalid option'],
    ['42501', 'Cannot edit a submitted test', 403, 'Cannot edit a submitted test'],
    ['P0002', 'Test not found', 404, 'Test not found'],
    ['22P02', 'invalid uuid', 404, 'Test not found'],
    ['PGRST202', 'missing function', 500, 'Test attempt migration is required'],
    ['XX000', 'internal detail', 500, 'Failed to save responses'],
  ])('maps save RPC error %s', async (code, message, status, error) => {
    rpc.mockResolvedValueOnce({ data: null, error: { code, message } })

    const result = await saveStudentTestAttempt({
      testId: savedAttempt.test_id,
      studentId: savedAttempt.student_id,
      responses,
      pasteWordCount: 0,
      keystrokeCount: 0,
    })

    expect(result).toEqual({ ok: false, status, error })
    expect(insertVersionedBaselineHistory).not.toHaveBeenCalled()
    expect(persistVersionedHistory).not.toHaveBeenCalled()
  })

  it('fails closed on a malformed save result', async () => {
    rpc.mockResolvedValueOnce({ data: { created: true }, error: null })

    const result = await saveStudentTestAttempt({
      testId: savedAttempt.test_id,
      studentId: savedAttempt.student_id,
      responses,
      pasteWordCount: 0,
      keystrokeCount: 0,
    })

    expect(result).toEqual({ ok: false, status: 500, error: 'Failed to save responses' })
  })
})
