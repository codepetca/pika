import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isAutomaticRemovedStudentCleanupEnabled,
  runAutomaticRemovedStudentCleanup,
} from '@/lib/server/automatic-removed-student-cleanup'
import { ApiError } from '@/lib/api-error'

const ids = Array.from({ length: 7 }, (_, index) => `${index + 1}0000000-0000-4000-8000-000000000001`)
const job = { job_id: ids[0], operation_id: ids[1], teacher_id: ids[2], classroom_id: ids[3],
  student_id: ids[4], generation_id: ids[5], attempt_count: 1 }

function fixture(claims: unknown[] = [job, null]) {
  const rpc = vi.fn(async (name: string) => name === 'claim_removed_student_cleanup_job'
    ? { data: claims.shift(), error: null }
    : { data: true, error: null })
  const cleanup = { reserve: vi.fn().mockResolvedValue({ cleanup_completed: false }),
    advance: vi.fn().mockResolvedValue({ cleanup_completed: true }) }
  return { client: { rpc } as never, cleanup, rpc }
}

afterEach(() => vi.unstubAllEnvs())

describe('automatic removed-student cleanup worker', () => {
  it('requires both its independent flag and every live cleanup flag', () => {
    const flags = ['PIKA_AUTOMATIC_REMOVED_STUDENT_CLEANUP_ENABLED','PIKA_LIVE_STUDENT_CLEANUP_ENABLED',
      'STUDENT_PROVIDER_CLEANUP_ENABLED','PAL_PROFILE_ERASURE_ENABLED',
      'PIKA_BARA_PARTICIPANT_ERASURE_ENABLED','PIKA_REMOVED_STUDENT_ACADEMIC_CLEANUP_ENABLED']
    flags.forEach(flag => vi.stubEnv(flag, 'true'))
    expect(isAutomaticRemovedStudentCleanupEnabled()).toBe(true)
    for (const flag of flags) {
      vi.stubEnv(flag, 'false')
      expect(isAutomaticRemovedStudentCleanupEnabled()).toBe(false)
      vi.stubEnv(flag, 'true')
    }
  })

  it('does no cleanup work while the queue is empty', async () => {
    const f = fixture([null])
    expect(await runAutomaticRemovedStudentCleanup({ client: f.client, cleanup: f.cleanup }))
      .toEqual({ ok: true, status: 200, claimed: 0, completed: 0, pending: 0,
        failed: 0, quarantined: 0, retry_recording_failed: 0 })
    expect(f.cleanup.reserve).not.toHaveBeenCalled()
  })

  it('reserves the stable operation, advances bounded work, and records completion', async () => {
    const f = fixture()
    const result = await runAutomaticRemovedStudentCleanup({ client: f.client, cleanup: f.cleanup,
      leaseTokenFactory: () => ids[6] })
    expect(result).toMatchObject({ ok: true, claimed: 1, completed: 1 })
    expect(f.cleanup.reserve).toHaveBeenCalledWith({ operationId: job.operation_id,
      teacherId: job.teacher_id, classroomId: job.classroom_id,
      studentId: job.student_id, generationId: job.generation_id })
    expect(f.cleanup.advance).toHaveBeenCalledOnce()
    expect(f.rpc).toHaveBeenCalledWith('release_removed_student_cleanup_job', expect.objectContaining({
      p_job_id: job.job_id, p_lease_token: ids[6], p_completed: true,
    }))
  })

  it('stops at the advancement bound and becomes retryable before the next five-minute boundary', async () => {
    const f = fixture()
    f.cleanup.advance.mockResolvedValue({ cleanup_completed: false })
    const result = await runAutomaticRemovedStudentCleanup({ client: f.client, cleanup: f.cleanup,
      maxAdvances: 2, leaseTokenFactory: () => ids[6] })
    expect(result).toMatchObject({ ok: true, pending: 1 })
    expect(f.cleanup.advance).toHaveBeenCalledTimes(2)
    expect(f.rpc).toHaveBeenCalledWith('release_removed_student_cleanup_job', expect.objectContaining({
      p_completed: false, p_error_code: 'cleanup_pending', p_retry_delay_seconds: 240,
    }))
  })

  it('stops claiming more jobs when the request time budget is consumed', async () => {
    const f = fixture([job, { ...job, job_id: ids[6] }, null])
    f.cleanup.advance.mockResolvedValue({ cleanup_completed: false })
    let time = 0
    const result = await runAutomaticRemovedStudentCleanup({ client: f.client, cleanup: f.cleanup,
      maxAdvances: 10, timeBudgetMs: 2, now: () => time++, leaseTokenFactory: () => ids[6] })
    expect(result.claimed).toBe(1)
  })

  it('records a sanitized retry after cleanup failure', async () => {
    const f = fixture()
    f.cleanup.reserve.mockRejectedValue(new Error('provider body with identifiers'))
    expect(await runAutomaticRemovedStudentCleanup({ client: f.client, cleanup: f.cleanup,
      leaseTokenFactory: () => ids[6] })).toMatchObject({ ok: true, failed: 1 })
    expect(f.rpc).toHaveBeenCalledWith('release_removed_student_cleanup_job', expect.objectContaining({
      p_error_code: 'cleanup_unavailable',
    }))
  })

  it('quarantines a permanent failure and continues with the next job', async () => {
    const second = { ...job, job_id: ids[6], operation_id: ids[5] }
    const f = fixture([job, second, null])
    f.cleanup.reserve
      .mockRejectedValueOnce(new ApiError(409, 'private binding detail'))
      .mockResolvedValueOnce({ cleanup_completed: true })
    const result = await runAutomaticRemovedStudentCleanup({ client: f.client, cleanup: f.cleanup,
      leaseTokenFactory: () => ids[6] })
    expect(result).toMatchObject({ ok: false, status: 503, claimed: 2, completed: 1,
      failed: 1, quarantined: 1, error_code: 'automatic_cleanup_job_quarantined' })
    expect(f.rpc).toHaveBeenCalledWith('release_removed_student_cleanup_job', expect.objectContaining({
      p_job_id: job.job_id, p_completed: false, p_error_code: 'cleanup_quarantined',
    }))
  })

  it('quarantines a job at the bounded attempt limit without another provider attempt', async () => {
    const f = fixture([{ ...job, attempt_count: 3 }, null])
    expect(await runAutomaticRemovedStudentCleanup({ client: f.client, cleanup: f.cleanup,
      maxAttempts: 3, leaseTokenFactory: () => ids[6] })).toMatchObject({ quarantined: 1 })
    expect(f.cleanup.reserve).not.toHaveBeenCalled()
  })

  it('fails the invocation when retry evidence cannot be persisted', async () => {
    const f = fixture()
    f.rpc.mockImplementation(async (name: string) => name === 'claim_removed_student_cleanup_job'
      ? { data: job, error: null } : { data: null, error: { code: '500' } })
    expect(await runAutomaticRemovedStudentCleanup({ client: f.client, cleanup: f.cleanup,
      maxClaims: 1, leaseTokenFactory: () => ids[6] })).toMatchObject({
      ok: false, status: 503, retry_recording_failed: 1,
    })
  })
})
