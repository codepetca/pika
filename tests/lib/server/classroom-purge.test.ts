import { describe, expect, it, vi } from 'vitest'
import {
  countClassroomStudents,
  deleteClassroomPurgeStorageObject,
  isStableManagedInventoryCoverage,
} from '@/lib/server/classroom-purge'

function storageAdapter(removeError?: unknown) {
  const remove = vi.fn().mockResolvedValue({ error: removeError || null })
  const from = vi.fn(() => ({ remove }))
  return { adapter: { from }, from, remove }
}

describe('classroom purge storage cleanup', () => {
  it('counts roster-only invitations without double-counting joined students', () => {
    expect(countClassroomStudents({
      classroom_roster: [{ email: 'joined@example.com' }, { email: 'invited@example.com' }],
      classroom_enrollments: [{ student_id: 'student-1' }],
      entries: [{ student_id: 'student-1' }],
    }, [{ id: 'student-1', email: 'JOINED@example.com', role: 'student' }])).toBe(2)
    expect(countClassroomStudents({
      classroom_roster: [],
      classroom_enrollments: [{ student_id: 'student-1' }],
      entries: [{ student_id: 'student-2' }],
    })).toBe(2)
  })

  it('unions former students and student actors across every classroom resource', () => {
    expect(countClassroomStudents({
      classroom_roster: [{ email: 'current@example.com' }],
      classroom_enrollments: [{ student_id: 'current-student' }],
      assignment_docs: [{ student_id: 'former-student' }],
      announcement_reads: [{ user_id: 'announcement-student' }, { user_id: 'teacher' }],
      classroom_retired_assessment_record_actors: [
        { actor_id: 'retired-student', source_column: 'student_id' },
        { actor_id: 'retired-teacher', source_column: 'graded_by' },
      ],
    }, [
      { id: 'current-student', email: 'current@example.com', role: 'student' },
      { id: 'former-student', email: 'former@example.com', role: 'student' },
      { id: 'announcement-student', email: 'reader@example.com', role: 'student' },
      { id: 'teacher', email: 'teacher@example.com', role: 'teacher' },
    ])).toBe(4)
  })

  it('rejects an ABA managed-registry change even when the digest returns to its prior value', () => {
    const digest = 'a'.repeat(64)
    expect(isStableManagedInventoryCoverage(
      { status: 'verified', inventory_version: 7, inventory_sha256: digest },
      { status: 'verified', inventory_version: 9, inventory_sha256: digest },
    )).toBe(false)
    expect(isStableManagedInventoryCoverage(
      { status: 'verified', inventory_version: 9, inventory_sha256: digest },
      { status: 'verified', inventory_version: 9, inventory_sha256: digest },
    )).toBe(true)
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

  it('surfaces retryable provider errors for durable failure recording', async () => {
    const providerError = { statusCode: 503, code: 'service_unavailable' }
    const mock = storageAdapter(providerError)
    await expect(deleteClassroomPurgeStorageObject(
      mock.adapter,
      'gradex-analytics-extracts',
      'teacher/classroom/extract.tar.gz',
    )).rejects.toBe(providerError)
  })
})
