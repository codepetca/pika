import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE, PUT } from '@/app/api/teacher/gradebook/manual-scores/route'

const saveOverride = vi.fn()
const deleteOverride = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: '10000000-0000-4000-8000-000000000010' })),
}))
vi.mock('@/lib/server/gradebook', () => ({
  saveTeacherGradebookScoreOverride: (...args: unknown[]) => saveOverride(...args),
  deleteTeacherGradebookScoreOverride: (...args: unknown[]) => deleteOverride(...args),
}))

const classroomId = '10000000-0000-4000-8000-000000000001'
const studentId = '10000000-0000-4000-8000-000000000002'
const assessmentId = '10000000-0000-4000-8000-000000000003'

describe('teacher Gradebook manual score route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveOverride.mockResolvedValue({ saved: true })
    deleteOverride.mockResolvedValue({ deleted: true })
  })

  it('rejects malformed UUIDs before calling the save service', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/teacher/gradebook/manual-scores', {
      method: 'PUT',
      body: JSON.stringify({
        classroom_id: classroomId,
        student_id: studentId,
        assessment_type: 'assignment',
        assessment_id: 'not-a-uuid',
        earned: 10,
      }),
    }))

    expect(response.status).toBe(400)
    expect(saveOverride).not.toHaveBeenCalled()
  })

  it('rejects mixed one-cell and bulk-delete fields', async () => {
    const response = await DELETE(new NextRequest('http://localhost/api/teacher/gradebook/manual-scores', {
      method: 'DELETE',
      body: JSON.stringify({
        scope: 'all',
        classroom_id: classroomId,
        student_id: studentId,
        assessment_type: 'assignment',
        assessment_id: assessmentId,
      }),
    }))

    expect(response.status).toBe(400)
    expect(deleteOverride).not.toHaveBeenCalled()
  })

  it('passes an explicit one-cell delete command to the service', async () => {
    const command = {
      scope: 'one' as const,
      classroom_id: classroomId,
      student_id: studentId,
      assessment_type: 'assignment' as const,
      assessment_id: assessmentId,
    }
    const response = await DELETE(new NextRequest('http://localhost/api/teacher/gradebook/manual-scores', {
      method: 'DELETE',
      body: JSON.stringify(command),
    }))

    expect(response.status).toBe(200)
    expect(deleteOverride).toHaveBeenCalledWith({
      teacherId: '10000000-0000-4000-8000-000000000010',
      command,
    })
  })
})
