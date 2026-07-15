import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { POST } from '@/app/api/teacher/tests/[id]/clear-open-grades/route'

const { clearTestOpenResponseGrades } = vi.hoisted(() => ({ clearTestOpenResponseGrades: vi.fn() }))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))
vi.mock('@/lib/server/test-grades', () => ({ clearTestOpenResponseGrades }))

const context = { params: Promise.resolve({ id: 'test-1' }) }
function request(body: string | object) {
  return new NextRequest('http://localhost/api/teacher/tests/test-1/clear-open-grades', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST clear teacher test open grades', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearTestOpenResponseGrades.mockResolvedValue({
      clearedStudents: 2,
      skippedStudents: 1,
      clearedResponses: 3,
    })
  })

  it('normalizes selected students and forwards one atomic clear', async () => {
    const response = await POST(request({
      student_ids: [' student-1 ', 'student-1', 'student-2'],
      responses: [{ response_id: 'response-1', expected_response_revision: 4 }],
    }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      cleared_students: 2,
      skipped_students: 1,
      cleared_responses: 3,
    })
    expect(clearTestOpenResponseGrades).toHaveBeenCalledWith({
      teacherId: 'teacher-1',
      testId: 'test-1',
      studentIds: ['student-1', 'student-2'],
      expectedResponses: [{ response_id: 'response-1', expected_response_revision: 4 }],
    })
  })

  it.each([
    ['{', 'Invalid JSON body'],
    [{}, 'student_ids array is required'],
    [{ student_ids: ['student-1', 2], responses: [] }, 'student_ids must contain non-empty strings'],
    [{ student_ids: ['student-1'] }, 'responses array is required'],
  ])('rejects invalid input %#', async (body, message) => {
    const response = await POST(request(body), context)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: message })
    expect(clearTestOpenResponseGrades).not.toHaveBeenCalled()
  })

  it('maps an archived classroom rejection', async () => {
    clearTestOpenResponseGrades.mockRejectedValueOnce(new ApiError(403, 'Classroom is archived'))
    const response = await POST(request({ student_ids: ['student-1'], responses: [] }), context)
    expect(response.status).toBe(403)
  })
})
