import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runStudentPurgeInBackground } from '@/lib/server/student-purge-worker'

const advance = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/student-purge', () => ({ advanceStudentPurge: advance }))

describe('student purge background worker', () => {
  beforeEach(() => vi.resetAllMocks())

  it('finishes a saved operation without browser ticks', async () => {
    advance.mockResolvedValueOnce({ advanced: true, operation: { status: 'deleting_objects' } })
      .mockResolvedValueOnce({ advanced: true, operation: { status: 'completed' } })
    expect(await runStudentPurgeInBackground('teacher', 'operation')).toEqual({ reason: 'completed', ticks: 2 })
    expect(advance).toHaveBeenNthCalledWith(2, 'teacher', 'operation')
  })

  it.each([
    [{ advanced: false, operation: { status: 'deleting_objects' } }, 'waiting'],
    [{ advanced: true, operation: { status: 'failed', retryable: true } }, 'failed'],
    [{ advanced: true, operation: { status: 'failed', retryable: false } }, 'failed'],
  ])('yields instead of spinning on leases or failures', async (result, reason) => {
    advance.mockResolvedValue(result)
    expect(await runStudentPurgeInBackground('teacher', 'operation')).toEqual({ reason, ticks: 1 })
    expect(advance).toHaveBeenCalledTimes(1)
  })

  it('leaves unexpected failures to durable recovery without exposing provider errors', async () => {
    advance.mockRejectedValue(new Error('sensitive provider response'))
    expect(await runStudentPurgeInBackground('teacher', 'operation')).toEqual({ reason: 'failed', ticks: 1 })
  })

  it('bounds each invocation by work count', async () => {
    advance.mockResolvedValue({ advanced: true, operation: { status: 'deleting_objects' } })
    expect(await runStudentPurgeInBackground('teacher', 'operation')).toEqual({ reason: 'budget', ticks: 25 })
  })

  it('does not start more work once its time budget expires', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(21_000)
    try {
      expect(await runStudentPurgeInBackground('teacher', 'operation')).toEqual({ reason: 'budget', ticks: 0 })
      expect(advance).not.toHaveBeenCalled()
    } finally { now.mockRestore() }
  })
})
