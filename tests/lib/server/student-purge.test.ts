import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteStudentPurgeStorageObject,
  getStudentPurgeEnabledStudentIds,
  isMissingStudentPurgeSchemaError,
  runStudentPurgeSafetyNet,
  shouldRequeueStudentPurgeSafetyNet,
} from '@/lib/server/student-purge'

const serviceClient = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => serviceClient) }))

const status = {
  operation_id: '10000000-0000-4000-8000-000000000001',
  classroom_id: '20000000-0000-4000-8000-000000000001',
  status: 'deleting_objects' as const,
  retryable: true,
  error_code: null,
  attempt_count: 1,
  resource_counts: {},
  storage_object_counts: { pending: 1 },
  completed_at: null,
}

describe('student purge server boundaries', () => {
  afterEach(() => vi.clearAllMocks())

  it('treats only missing schema/RPC errors as pre-migration compatibility', () => {
    expect(isMissingStudentPurgeSchemaError({ code: 'PGRST205' })).toBe(true)
    expect(isMissingStudentPurgeSchemaError({ code: '42P01' })).toBe(true)
    expect(isMissingStudentPurgeSchemaError({ code: 'PGRST202' })).toBe(true)
    expect(isMissingStudentPurgeSchemaError({ code: '42501' })).toBe(false)
  })

  it('keeps rollout absent when migration 123 has not been applied', async () => {
    serviceClient.from.mockReturnValue({
      select: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({
        data: null, error: { code: 'PGRST205', message: 'missing' },
      }) })),
    })
    await expect(getStudentPurgeEnabledStudentIds('teacher', 'classroom', ['student']))
      .resolves.toEqual([])
  })

  it('allows only the exact canary triple', async () => {
    serviceClient.from.mockReturnValue({
      select: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: {
        rollout_mode: 'canary',
        canary_teacher_id: '10000000-0000-4000-8000-000000000001',
        canary_classroom_id: '20000000-0000-4000-8000-000000000001',
        canary_student_id: '30000000-0000-4000-8000-000000000001',
      }, error: null }) })),
    })
    await expect(getStudentPurgeEnabledStudentIds(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      ['30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001'],
    )).resolves.toEqual(['30000000-0000-4000-8000-000000000001'])
  })

  it('deletes one exact leased object and accepts authoritative absence', async () => {
    const remove = vi.fn().mockResolvedValue({ error: { statusCode: 404, code: 'NoSuchKey' } })
    const storage = { from: vi.fn(() => ({ remove })) }
    await expect(deleteStudentPurgeStorageObject(
      storage,
      'submission-images',
      'classroom/student/image.png',
    )).resolves.toBeUndefined()
    expect(remove).toHaveBeenCalledWith(['classroom/student/image.png'])
  })

  it('does not hot-loop failed or unadvanced operations', () => {
    expect(shouldRequeueStudentPurgeSafetyNet(status, true)).toBe(true)
    expect(shouldRequeueStudentPurgeSafetyNet(status, false)).toBe(false)
    expect(shouldRequeueStudentPurgeSafetyNet({
      ...status,
      status: 'failed',
      storage_object_counts: { failed: 1 },
    }, true)).toBe(false)
  })

  it('is a safe no-op before migration 123 exists', async () => {
    serviceClient.from.mockReturnValue({
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          or: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({ data: null, error: { code: '42P01' } }),
            })),
          })),
        })),
      })),
    })
    await expect(runStudentPurgeSafetyNet()).resolves.toEqual({ processed: 0, completed: 0, failed: 0 })
    expect(serviceClient.storage.from).not.toHaveBeenCalled()
  })
})
