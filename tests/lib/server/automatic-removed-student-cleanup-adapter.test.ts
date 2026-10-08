import { afterEach, describe, expect, it, vi } from 'vitest'

const { pal, bara } = vi.hoisted(() => ({ pal: vi.fn(), bara: vi.fn() }))
vi.mock('@/lib/server/pal-profile-erasure', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/pal-profile-erasure')>(), requestPalProfileErasure: pal,
}))
vi.mock('@/lib/server/bara-attendance-client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/bara-attendance-client')>(), postBaraParticipantErasure: bara,
}))

import { runAutomaticRemovedStudentCleanup } from '@/lib/server/automatic-removed-student-cleanup'
import { createLiveStudentCleanup } from '@/lib/server/live-student-cleanup'
import { createStudentProviderCleanupDatabaseCoordinator } from '@/lib/server/student-provider-cleanup-database'

const ids = Array.from({ length: 7 }, (_, index) => `${index + 1}0000000-0000-4000-8000-000000000001`)
const job = { job_id: ids[0], operation_id: ids[1], teacher_id: ids[2], classroom_id: ids[3],
  student_id: ids[4], generation_id: ids[5], attempt_count: 1 }
const binding = {
  schema_version: 1, operation_id: job.operation_id, generation_id: job.generation_id,
  status: 'provider_pending', pal_schema_version: 2, pal_policy: 'pika-live-v1',
  pal_origin: 'https://pal.example.invalid', pal_integration_id: ids[6],
  pal_reference: `pika-membership-v1-${'a'.repeat(32)}`,
  bara_origin: 'https://bara.example.invalid', installation_ref: 'installation_one',
  roster_ref: 'roster_one', participant_ref: 'participant_one', actor_principal_ref: 'principal_one',
  pal_receipt: null, bara_receipt: null,
}

afterEach(() => vi.unstubAllEnvs())

describe('automatic cleanup database error classification', () => {
  it('retries a live operation conflict without provider transport or quarantine', async () => {
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'true')
    const providerRpc = vi.fn(async (name: string) => {
      if (name === 'authorize_student_provider_cleanup') return {
        data: null, error: { code: '55000', message: 'student_provider_operation_conflict' },
      }
      if (name === 'advance_removed_student_academic_cleanup'
        || name === 'get_student_provider_cleanup') return { data: binding, error: null }
      throw new Error(`Unexpected provider RPC ${name}`)
    })
    const providers = createStudentProviderCleanupDatabaseCoordinator({ rpc: providerRpc } as never, { live: true })
    const cleanup = createLiveStudentCleanup({
      providers,
      academic: { inventory: vi.fn(), advance: vi.fn() } as never,
    })
    const claims: unknown[] = [job, null]
    const queueRpc = vi.fn(async (name: string) => name === 'claim_removed_student_cleanup_job'
      ? { data: claims.shift(), error: null }
      : { data: true, error: null })

    const scope = { operationId: job.operation_id, teacherId: job.teacher_id,
      classroomId: job.classroom_id, studentId: job.student_id, generationId: job.generation_id }
    await expect(cleanup.reserve(scope)).resolves.toMatchObject({ cleanup_completed: false })
    await expect(cleanup.advance(scope)).resolves.toMatchObject({ cleanup_completed: false })

    const result = await runAutomaticRemovedStudentCleanup({
      client: { rpc: queueRpc } as never, cleanup, maxAdvances: 1, leaseTokenFactory: () => ids[6],
    })

    expect(result).toMatchObject({ ok: true, pending: 1, quarantined: 0 })
    expect(queueRpc).toHaveBeenCalledWith('release_removed_student_cleanup_job', expect.objectContaining({
      p_error_code: 'cleanup_pending', p_completed: false,
    }))
    expect(pal).not.toHaveBeenCalled()
    expect(bara).not.toHaveBeenCalled()
  })
})
