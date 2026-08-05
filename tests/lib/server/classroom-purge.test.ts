import { describe, expect, it, vi } from 'vitest'
import {
  countClassroomStudents,
  deleteClassroomPurgeStorageObject,
  isMissingClassroomPurgeSchemaError,
  mergeClassroomPurgeResourceCounts,
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
})
