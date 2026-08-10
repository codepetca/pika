import { describe, expect, it, vi } from 'vitest'
import {
  countClassroomStudents,
  deleteClassroomPurgeStorageObject,
  isMissingClassroomPurgeSchemaError,
  mergeClassroomPurgeResourceCounts,
  getClassroomPurgeStatus,
  runClassroomPurgeSafetyNet,
  shouldRequeueClassroomPurgeSafetyNet,
} from '@/lib/server/classroom-purge'

const serviceClient = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  storage: { from: vi.fn() },
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => serviceClient),
}))

const operation = {
  operation_id: 'b1800000-0000-4000-8000-000000000200',
  classroom_id: 'b1800000-0000-4000-8000-000000000010',
  status: 'deleting_objects' as const,
  retryable: null,
  error_code: null,
  attempt_count: 1,
  resource_counts: {},
  storage_object_counts: { pending: 1 },
  completed_at: null,
}

function storageAdapter(removeError?: unknown) {
  const remove = vi.fn().mockResolvedValue({ error: removeError || null })
  const from = vi.fn(() => ({ remove }))
  return { adapter: { from }, from, remove }
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

describe('classroom purge helpers', () => {
  it('counts roster-only invitations without double-counting joined students', () => {
    expect(countClassroomStudents({
      classroom_roster: [{ email: 'joined@example.com' }, { email: 'invited@example.com' }],
      classroom_enrollments: [{ student_id: 'student-1' }],
      entries: [{ student_id: 'student-1' }],
    }, [{ id: 'student-1', email: 'JOINED@example.com', role: 'student' }])).toBe(2)
  })

  it('unions former students and student actors across classroom resources', () => {
    expect(countClassroomStudents({
      classroom_roster: [{ email: 'current@example.com' }],
      classroom_enrollments: [{ student_id: 'current-student' }],
      assignment_docs: [{ student_id: 'former-student' }],
      announcement_reads: [{ user_id: 'announcement-student' }, { user_id: 'teacher' }],
      classroom_retired_assessment_record_actors: [
        { actor_id: 'retired-student', source_column: 'student_id' },
      ],
    }, [
      { id: 'current-student', email: 'current@example.com', role: 'student' },
      { id: 'former-student', email: 'former@example.com', role: 'student' },
      { id: 'announcement-student', email: 'reader@example.com', role: 'student' },
      { id: 'teacher', email: 'teacher@example.com', role: 'teacher' },
    ])).toBe(4)
  })

  it('includes archive and Gradex operational ledgers in the displayed record impact', () => {
    const counts = mergeClassroomPurgeResourceCounts(
      { classrooms: 1, assignment_docs: 4 },
      {
        classroom_archive_operations: 2,
        classroom_archive_object_upload_cleanup: 3,
        classroom_gradex_extracts: 1,
        classroom_gradex_extract_cleanup: 1,
      },
    )
    expect(Object.values(counts).reduce((total, count) => total + count, 0)).toBe(12)
  })

  it('requests removal of the one exact leased object', async () => {
    const mock = storageAdapter()
    await deleteClassroomPurgeStorageObject(
      mock.adapter,
      'assignment-artifacts',
      'teacher/classroom/submission.png',
    )
    expect(mock.from).toHaveBeenCalledWith('assignment-artifacts')
    expect(mock.remove).toHaveBeenCalledWith(['teacher/classroom/submission.png'])
  })

  it('treats authoritative missing-object evidence as idempotent success', async () => {
    const mock = storageAdapter({ statusCode: 404, code: 'NoSuchKey' })
    await expect(deleteClassroomPurgeStorageObject(
      mock.adapter,
      'classroom-archives',
      'teacher/classroom/archive.tar.gz',
    )).resolves.toBeUndefined()
  })

  it('surfaces provider errors for durable retry recording', async () => {
    const providerError = { statusCode: 503, code: 'service_unavailable' }
    const mock = storageAdapter(providerError)
    await expect(deleteClassroomPurgeStorageObject(
      mock.adapter,
      'gradex-analytics-extracts',
      'teacher/classroom/extract.tar.gz',
    )).rejects.toBe(providerError)
  })

  it('does not hot-loop a safety-net operation when no object was due', () => {
    expect(shouldRequeueClassroomPurgeSafetyNet(operation, false)).toBe(false)
    expect(shouldRequeueClassroomPurgeSafetyNet(operation, true)).toBe(true)
    expect(shouldRequeueClassroomPurgeSafetyNet({
      ...operation,
      status: 'failed',
      retryable: true,
      storage_object_counts: { failed: 1 },
    }, true)).toBe(false)
  })

  it('treats only missing pre-migration purge tables as a compatibility no-op', () => {
    expect(isMissingClassroomPurgeSchemaError({ code: 'PGRST205' })).toBe(true)
    expect(isMissingClassroomPurgeSchemaError({ code: '42P01' })).toBe(true)
    expect(isMissingClassroomPurgeSchemaError({ code: '42501' })).toBe(false)
    expect(isMissingClassroomPurgeSchemaError(null)).toBe(false)
  })

  it('does not touch legacy purge operations when migration 118 readiness is absent', async () => {
    serviceClient.from.mockImplementation((table: string) => {
      if (table === 'classroom_purge_settings') {
        return {
          select: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST205', message: 'table not found' },
          }),
        }
      }
      throw new Error(`Legacy purge table must not be queried: ${table}`)
    })

    await expect(runClassroomPurgeSafetyNet()).resolves.toEqual({
      processed: 0,
      completed: 0,
      failed: 0,
    })
    expect(serviceClient.from).toHaveBeenCalledTimes(1)
    expect(serviceClient.from).toHaveBeenCalledWith('classroom_purge_settings')
    expect(serviceClient.rpc).not.toHaveBeenCalled()
    expect(serviceClient.storage.from).not.toHaveBeenCalled()
  })

  it('rejects a cold operation at the shared hot status boundary', async () => {
    serviceClient.from.mockReset()
    serviceClient.from.mockImplementation((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: table === 'classroom_purge_operations' ? {
                id: operation.operation_id,
                classroom_id: operation.classroom_id,
                teacher_id: 'b1800000-0000-4000-8000-000000000001',
                status: operation.status,
                retryable: null,
                error_code: null,
                resource_counts: {},
                attempt_count: 1,
                completed_at: null,
                purge_scope: 'cold_classroom',
              } : null,
              error: null,
            }),
          })),
        })),
      })),
    }))

    await expect(getClassroomPurgeStatus(
      'b1800000-0000-4000-8000-000000000001',
      operation.operation_id,
    )).rejects.toMatchObject({ status: 404, code: 'purge_not_found' })
  })

  it('keeps pre-migration hot status reads compatible when purge_scope is absent', async () => {
    serviceClient.from.mockReset()
    const operationSelect = vi.fn((columns: string) => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue(
            columns.includes('purge_scope')
              ? {
                data: null,
                error: { code: 'PGRST204', message: 'purge_scope column not found' },
              }
              : {
                data: {
                  id: operation.operation_id,
                  classroom_id: operation.classroom_id,
                  teacher_id: 'b1800000-0000-4000-8000-000000000001',
                  status: operation.status,
                  retryable: null,
                  error_code: null,
                  resource_counts: {},
                  attempt_count: 1,
                  completed_at: null,
                },
                error: null,
              },
          ),
        })),
      })),
    }))
    serviceClient.from.mockImplementation((table: string) => {
      if (table === 'classroom_purge_operations') return { select: operationSelect }
      if (table === 'classroom_purge_objects') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [{ status: 'pending' }], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await expect(getClassroomPurgeStatus(
      'b1800000-0000-4000-8000-000000000001',
      operation.operation_id,
    )).resolves.toMatchObject({
      operation_id: operation.operation_id,
      status: 'deleting_objects',
      storage_object_counts: { pending: 1 },
    })
    expect(operationSelect).toHaveBeenCalledTimes(2)
  })

  it('filters cold and terminal failures before limiting hot safety-net work', async () => {
    serviceClient.from.mockReset()
    serviceClient.rpc.mockReset()
    const teacherId = 'b1800000-0000-4000-8000-000000000001'
    const coldRows = Array.from({ length: 25 }, (_, index) => ({
      id: `c1800000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      teacher_id: teacherId,
      status: 'failed',
      retryable: true,
      purge_scope: 'cold_classroom',
    }))
    const terminalHotRows = Array.from({ length: 25 }, (_, index) => ({
      id: `d1800000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      teacher_id: teacherId,
      status: 'failed',
      retryable: false,
      purge_scope: 'hot_classroom',
    }))
    const retryableHot = {
      id: operation.operation_id,
      teacher_id: teacherId,
      status: 'failed',
      retryable: true,
      purge_scope: 'hot_classroom',
    }
    const listSelect = vi.fn((columns: string) => operationListQuery(
      [...coldRows, ...terminalHotRows, retryableHot],
      columns,
    ))
    serviceClient.from.mockImplementation((table: string) => {
      if (table === 'classroom_purge_settings') {
        return { select: vi.fn().mockResolvedValue({ data: [{ singleton: true }], error: null }) }
      }
      if (table === 'classroom_purge_operations') return { select: listSelect }
      throw new Error(`Unexpected table: ${table}`)
    })
    serviceClient.rpc.mockResolvedValue({
      data: null,
      error: { code: 'fixture_stop_after_claim', message: 'fixture' },
    })

    await expect(runClassroomPurgeSafetyNet(25)).resolves.toEqual({
      processed: 1,
      completed: 0,
      failed: 1,
    })
    expect(serviceClient.rpc).toHaveBeenCalledWith(
      'claim_classroom_purge_object',
      expect.objectContaining({
        p_operation_id: retryableHot.id,
        p_teacher_id: teacherId,
      }),
    )
    for (const cold of coldRows) {
      expect(serviceClient.rpc).not.toHaveBeenCalledWith(
        'claim_classroom_purge_object',
        expect.objectContaining({ p_operation_id: cold.id }),
      )
    }
  })
})
