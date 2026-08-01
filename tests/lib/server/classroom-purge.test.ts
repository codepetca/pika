import { describe, expect, it, vi } from 'vitest'
import {
  countClassroomStudents,
  deleteClassroomPurgeStorageObject,
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
    })).toBe(2)
    expect(countClassroomStudents({
      classroom_roster: [],
      classroom_enrollments: [{ student_id: 'student-1' }],
      entries: [{ student_id: 'student-2' }],
    })).toBe(2)
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
