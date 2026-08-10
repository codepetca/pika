import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceClient = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  storage: { from: vi.fn() },
}))
const shared = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  getStatus: vi.fn(),
  shouldRequeue: vi.fn(() => false),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => serviceClient),
}))
vi.mock('@/lib/server/classroom-purge', async () => {
  const { ApiError } = await import('@/lib/api-error')
  class ClassroomPurgeError extends ApiError {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
      public readonly retryable = false,
    ) {
      super(status, message)
    }
  }
  return {
    ClassroomPurgeError,
    deleteClassroomPurgeStorageObject: (...args: unknown[]) => shared.deleteObject(...args),
    getClassroomPurgeStatus: (...args: unknown[]) => shared.getStatus(...args),
    shouldRequeueClassroomPurgeSafetyNet: (...args: unknown[]) => shared.shouldRequeue(...args),
  }
})

import {
  advanceColdClassroomPurge,
  isMissingColdClassroomPurgeSchemaError,
  runColdClassroomPurgeSafetyNet,
} from '@/lib/server/cold-classroom-purge'

const TEACHER_ID = '10000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '20000000-0000-4000-8000-000000000001'
const OPERATION_ID = '30000000-0000-4000-8000-000000000001'
const OBJECT_ID = '40000000-0000-4000-8000-000000000001'
const LEASE_TOKEN = '50000000-0000-4000-8000-000000000001'

const operation = {
  operation_id: OPERATION_ID,
  classroom_id: CLASSROOM_ID,
  status: 'deleting_objects' as const,
  retryable: null,
  error_code: null,
  attempt_count: 1,
  resource_counts: { classroom_cold_tombstones: 1 },
  storage_object_counts: { pending: 1 },
  completed_at: null,
}

function operationListQuery(
  sourceRows: Array<Record<string, unknown>>,
  columns: string,
) {
  let rows = [...sourceRows]
  const selected = columns.split(',')
  const query = {
    eq: vi.fn((column: string, value: string) => {
      rows = rows.filter((row) => row[column] === value)
      return query
    }),
    in: vi.fn((column: string, values: string[]) => {
      rows = rows.filter((row) => values.includes(String(row[column])))
      return query
    }),
    or: vi.fn(() => {
      rows = rows.filter((row) => row.status !== 'failed' || row.retryable !== false)
      return query
    }),
    order: vi.fn(() => query),
    limit: vi.fn(async (count: number) => ({
      data: rows.slice(0, count).map((row) => Object.fromEntries(
        selected.map((column) => [column, row[column]]),
      )),
      error: null,
    })),
  }
  return query
}

describe('cold classroom purge worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shared.getStatus.mockResolvedValue(operation)
  })

  it('claims and deletes one exact managed object before recording its lease completion', async () => {
    serviceClient.rpc
      .mockResolvedValueOnce({
        data: [{
          id: OBJECT_ID,
          operation_id: OPERATION_ID,
          storage_bucket: 'classroom-archives',
          storage_path: 'teacher/classroom/archive.tar.gz',
          lease_token: LEASE_TOKEN,
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null })

    await expect(advanceColdClassroomPurge(TEACHER_ID, OPERATION_ID)).resolves.toEqual({
      operation,
      advanced: true,
    })

    expect(serviceClient.rpc).toHaveBeenNthCalledWith(
      1,
      'claim_cold_classroom_purge_object',
      expect.objectContaining({
        p_operation_id: OPERATION_ID,
        p_teacher_id: TEACHER_ID,
        p_lease_seconds: 60,
      }),
    )
    expect(shared.deleteObject).toHaveBeenCalledWith(
      serviceClient.storage,
      'classroom-archives',
      'teacher/classroom/archive.tar.gz',
    )
    expect(serviceClient.rpc).toHaveBeenNthCalledWith(
      2,
      'complete_classroom_purge_object',
      {
        p_object_id: OBJECT_ID,
        p_teacher_id: TEACHER_ID,
        p_lease_token: LEASE_TOKEN,
      },
    )
  })

  it('records storage failure durably for a later retry', async () => {
    serviceClient.rpc
      .mockResolvedValueOnce({
        data: [{
          id: OBJECT_ID,
          operation_id: OPERATION_ID,
          storage_bucket: 'classroom-archives',
          storage_path: 'teacher/classroom/archive.tar.gz',
          lease_token: LEASE_TOKEN,
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: { ok: true, status: 200 }, error: null })
    shared.deleteObject.mockRejectedValueOnce(new Error('storage_unavailable'))

    await expect(advanceColdClassroomPurge(TEACHER_ID, OPERATION_ID)).resolves.toEqual({
      operation,
      advanced: true,
    })

    expect(serviceClient.rpc).toHaveBeenNthCalledWith(
      2,
      'fail_classroom_purge_object',
      {
        p_object_id: OBJECT_ID,
        p_teacher_id: TEACHER_ID,
        p_lease_token: LEASE_TOKEN,
        p_error_code: 'storage_unavailable',
      },
    )
  })

  it('finalizes only after no exact object is claimable', async () => {
    const completed = { ...operation, status: 'completed' as const }
    serviceClient.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: { ok: true, status: 200 }, error: null })
    shared.getStatus.mockResolvedValueOnce(completed)

    await expect(advanceColdClassroomPurge(TEACHER_ID, OPERATION_ID)).resolves.toEqual({
      operation: completed,
      advanced: true,
    })
    expect(shared.deleteObject).not.toHaveBeenCalled()
    expect(serviceClient.rpc).toHaveBeenNthCalledWith(
      2,
      'finalize_cold_archived_classroom_purge',
      { p_operation_id: OPERATION_ID, p_teacher_id: TEACHER_ID },
    )
  })

  it('treats only missing migration schema as a code-first safety-net no-op', async () => {
    expect(isMissingColdClassroomPurgeSchemaError({ code: 'PGRST205' })).toBe(true)
    expect(isMissingColdClassroomPurgeSchemaError({ code: '42P01' })).toBe(true)
    expect(isMissingColdClassroomPurgeSchemaError({ code: '42501' })).toBe(false)

    serviceClient.from.mockImplementation((table: string) => {
      if (table !== 'cold_classroom_purge_settings') {
        throw new Error(`Unexpected legacy query: ${table}`)
      }
      return {
        select: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST205', message: 'table not found' },
        }),
      }
    })

    await expect(runColdClassroomPurgeSafetyNet()).resolves.toEqual({
      processed: 0,
      completed: 0,
      failed: 0,
    })
    expect(serviceClient.from).toHaveBeenCalledTimes(1)
    expect(serviceClient.rpc).not.toHaveBeenCalled()
  })

  it('filters terminal failures before limiting resumable cold safety-net work', async () => {
    serviceClient.from.mockReset()
    serviceClient.rpc.mockReset()
    const terminalRows = Array.from({ length: 25 }, (_, index) => ({
      id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      teacher_id: TEACHER_ID,
      status: 'failed',
      retryable: false,
      purge_scope: 'cold_classroom',
    }))
    const retryableRow = {
      id: OPERATION_ID,
      teacher_id: TEACHER_ID,
      status: 'failed',
      retryable: true,
      purge_scope: 'cold_classroom',
    }
    const listSelect = vi.fn((columns: string) => operationListQuery(
      [...terminalRows, retryableRow],
      columns,
    ))
    serviceClient.from.mockImplementation((table: string) => {
      if (table === 'cold_classroom_purge_settings') {
        return { select: vi.fn().mockResolvedValue({ data: [{ singleton: true }], error: null }) }
      }
      if (table === 'classroom_purge_operations') return { select: listSelect }
      throw new Error(`Unexpected table: ${table}`)
    })
    serviceClient.rpc.mockResolvedValue({
      data: null,
      error: { code: 'fixture_stop_after_claim', message: 'fixture' },
    })

    await expect(runColdClassroomPurgeSafetyNet(25)).resolves.toEqual({
      processed: 1,
      completed: 0,
      failed: 1,
    })
    expect(serviceClient.rpc).toHaveBeenCalledWith(
      'claim_cold_classroom_purge_object',
      expect.objectContaining({
        p_operation_id: retryableRow.id,
        p_teacher_id: TEACHER_ID,
      }),
    )
    for (const terminal of terminalRows) {
      expect(serviceClient.rpc).not.toHaveBeenCalledWith(
        'claim_cold_classroom_purge_object',
        expect.objectContaining({ p_operation_id: terminal.id }),
      )
    }
  })
})
