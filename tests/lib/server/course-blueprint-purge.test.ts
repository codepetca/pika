import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteCourseBlueprintPurgeStorageObject,
  getCourseBlueprintPurgeImpact,
  isMissingCourseBlueprintPurgeSchemaError,
  runCourseBlueprintPurgeSafetyNet,
  startCourseBlueprintPurge,
} from '@/lib/server/course-blueprint-purge'

const serviceClient = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  storage: { from: vi.fn() },
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => serviceClient),
}))

function storageAdapter(removeError?: unknown) {
  const remove = vi.fn().mockResolvedValue({ error: removeError || null })
  const from = vi.fn(() => ({ remove }))
  return { adapter: { from }, from, remove }
}

describe('Course Blueprint purge helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceClient.from.mockImplementation((table: string) => {
      if (table !== 'course_blueprint_purge_operations') {
        throw new Error(`Unexpected table ${table}`)
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        })),
      }
    })
  })

  it('deletes only the exact leased test-document object', async () => {
    const mock = storageAdapter()
    await deleteCourseBlueprintPurgeStorageObject(
      mock.adapter,
      'test-documents',
      'managed-copies/operation/teacher-material.pdf',
    )
    expect(mock.from).toHaveBeenCalledWith('test-documents')
    expect(mock.remove).toHaveBeenCalledWith([
      'managed-copies/operation/teacher-material.pdf',
    ])
  })

  it('treats authoritative missing-object evidence as idempotent success', async () => {
    const mock = storageAdapter({ statusCode: 404, code: 'NoSuchKey' })
    await expect(deleteCourseBlueprintPurgeStorageObject(
      mock.adapter,
      'test-documents',
      'managed-copies/operation/already-gone.pdf',
    )).resolves.toBeUndefined()
  })

  it('surfaces provider errors so the durable ledger can retry', async () => {
    const providerError = { statusCode: 503, code: 'service_unavailable' }
    const mock = storageAdapter(providerError)
    await expect(deleteCourseBlueprintPurgeStorageObject(
      mock.adapter,
      'test-documents',
      'managed-copies/operation/retry.pdf',
    )).rejects.toBe(providerError)
  })

  it('requires the exact Blueprint title or DELETE before starting', async () => {
    serviceClient.rpc.mockResolvedValue({
      data: {
        ok: true,
        status: 200,
        course_blueprint_id: '20000000-0000-4000-8000-000000000201',
        course_blueprint_title: 'Biology Blueprint',
        source_revision: 7,
        authority_mode: 'pika',
        planned_site_published: false,
        planned_site_slug: null,
        inventory_sha256: 'a'.repeat(64),
        relational_row_count: 1,
        linked_classroom_count: 0,
        managed_file_count: 0,
        managed_file_bytes: 0,
        missing_file_count: 0,
        resource_counts: { course_blueprints: 1 },
        storage_counts: {},
        conflicting_operation: null,
        deletion_available: true,
        unavailable_reason: null,
      },
      error: null,
    })
    await expect(startCourseBlueprintPurge({
      teacherId: '10000000-0000-4000-8000-000000000201',
      courseBlueprintId: '20000000-0000-4000-8000-000000000201',
      operationId: '30000000-0000-4000-8000-000000000201',
      confirmation: 'biology blueprint',
      expectedSourceRevision: 7,
      expectedInventorySha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'confirmation_mismatch', status: 400 })
    expect(serviceClient.rpc).toHaveBeenCalledTimes(1)
  })

  it('requires a fresh inventory identity before installing the fence', async () => {
    serviceClient.rpc.mockResolvedValue({
      data: {
        ok: true,
        status: 200,
        course_blueprint_id: '20000000-0000-4000-8000-000000000201',
        course_blueprint_title: 'Biology Blueprint',
        source_revision: 8,
        authority_mode: 'pika',
        planned_site_published: false,
        planned_site_slug: null,
        inventory_sha256: 'b'.repeat(64),
        relational_row_count: 1,
        linked_classroom_count: 0,
        managed_file_count: 0,
        managed_file_bytes: 0,
        missing_file_count: 0,
        resource_counts: { course_blueprints: 1 },
        storage_counts: {},
        conflicting_operation: null,
        deletion_available: true,
        unavailable_reason: null,
      },
      error: null,
    })
    await expect(startCourseBlueprintPurge({
      teacherId: '10000000-0000-4000-8000-000000000201',
      courseBlueprintId: '20000000-0000-4000-8000-000000000201',
      operationId: '30000000-0000-4000-8000-000000000201',
      confirmation: 'DELETE',
      expectedSourceRevision: 7,
      expectedInventorySha256: 'a'.repeat(64),
    })).rejects.toMatchObject({
      code: 'course_blueprint_purge_inventory_changed',
      status: 409,
    })
    expect(serviceClient.rpc).toHaveBeenCalledTimes(1)
  })

  it('recognizes only missing pre-migration tables as a compatibility no-op', () => {
    expect(isMissingCourseBlueprintPurgeSchemaError({ code: 'PGRST202' })).toBe(true)
    expect(isMissingCourseBlueprintPurgeSchemaError({ code: '42883' })).toBe(true)
    expect(isMissingCourseBlueprintPurgeSchemaError({ code: 'PGRST205' })).toBe(true)
    expect(isMissingCourseBlueprintPurgeSchemaError({ code: '42P01' })).toBe(true)
    expect(isMissingCourseBlueprintPurgeSchemaError({ code: '42501' })).toBe(false)
    expect(isMissingCourseBlueprintPurgeSchemaError(null)).toBe(false)
  })

  it('returns a deliberate unavailable error when migration 120 is absent', async () => {
    serviceClient.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'function not found' },
    })

    await expect(getCourseBlueprintPurgeImpact(
      '10000000-0000-4000-8000-000000000201',
      '20000000-0000-4000-8000-000000000201',
    )).rejects.toMatchObject({
      code: 'course_blueprint_purge_unavailable',
      status: 503,
      retryable: false,
    })
  })

  it('reuses persisted impact for an interrupted operation before fresh inventory', async () => {
    const impact = {
      course_blueprint_id: '20000000-0000-4000-8000-000000000201',
      course_blueprint_title: 'Biology Blueprint',
      source_revision: 7,
      authority_mode: 'pika',
      planned_site_published: false,
      planned_site_slug: null,
      inventory_sha256: 'a'.repeat(64),
      relational_row_count: 1,
      linked_classroom_count: 0,
      managed_file_count: 1,
      managed_file_bytes: 123,
      missing_file_count: 0,
      resource_counts: { course_blueprints: 1 },
      storage_counts: { 'test-documents': 1 },
      conflicting_operation: null,
      deletion_available: true,
      unavailable_reason: null,
    }
    serviceClient.from.mockImplementation((table: string) => {
      if (table !== 'course_blueprint_purge_operations') {
        throw new Error(`Unexpected table ${table}`)
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: '30000000-0000-4000-8000-000000000201',
                  course_blueprint_id: impact.course_blueprint_id,
                  teacher_id: '10000000-0000-4000-8000-000000000201',
                  status: 'deleting_objects',
                  retryable: null,
                  error_code: null,
                  resource_counts: impact.resource_counts,
                  impact_summary: impact,
                  attempt_count: 1,
                  completed_at: null,
                },
                error: null,
              }),
            })),
          })),
        })),
      }
    })

    await expect(startCourseBlueprintPurge({
      teacherId: '10000000-0000-4000-8000-000000000201',
      courseBlueprintId: impact.course_blueprint_id,
      operationId: '30000000-0000-4000-8000-000000000201',
      confirmation: 'DELETE',
      expectedSourceRevision: 8,
      expectedInventorySha256: 'b'.repeat(64),
    })).rejects.toMatchObject({
      code: 'course_blueprint_purge_inventory_changed',
      status: 409,
    })
    expect(serviceClient.rpc).not.toHaveBeenCalled()
  })

  it('does not touch operations when migration 120 is absent', async () => {
    serviceClient.from.mockImplementation((table: string) => {
      if (table === 'course_blueprint_purge_settings') {
        return {
          select: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST205', message: 'table not found' },
          }),
        }
      }
      throw new Error(`Purge table must not be queried: ${table}`)
    })

    await expect(runCourseBlueprintPurgeSafetyNet()).resolves.toEqual({
      processed: 0,
      completed: 0,
      failed: 0,
    })
    expect(serviceClient.from).toHaveBeenCalledTimes(1)
    expect(serviceClient.rpc).not.toHaveBeenCalled()
    expect(serviceClient.storage.from).not.toHaveBeenCalled()
  })

  it('does not process pending operations while rollout is disabled', async () => {
    serviceClient.from.mockImplementation((table: string) => {
      if (table === 'course_blueprint_purge_settings') {
        return {
          select: vi.fn().mockResolvedValue({
            data: [{ singleton: true, rollout_mode: 'disabled' }],
            error: null,
          }),
        }
      }
      throw new Error(`Disabled purge must not query: ${table}`)
    })

    await expect(runCourseBlueprintPurgeSafetyNet()).resolves.toEqual({
      processed: 0,
      completed: 0,
      failed: 0,
    })
  })
})
