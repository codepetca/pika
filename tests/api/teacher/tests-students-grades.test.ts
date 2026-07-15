import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { PATCH } from '@/app/api/teacher/tests/[id]/students/[studentId]/grades/route'

const { saveStudentTestGrades } = vi.hoisted(() => ({ saveStudentTestGrades: vi.fn() }))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))
vi.mock('@/lib/server/test-grades', () => ({ saveStudentTestGrades }))

const context = { params: Promise.resolve({ id: 'test-1', studentId: 'student-1' }) }
const validGrade = {
  question_id: 'question-1',
  response_id: 'response-1',
  expected_response_revision: 2,
  score: 4,
  feedback: 'Good work',
}

function request(body: string | object) {
  return new NextRequest('http://localhost/api/teacher/tests/test-1/students/student-1/grades', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('PATCH teacher student test grades', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveStudentTestGrades.mockResolvedValue({
      savedCount: 1,
      clearedCount: 0,
      responses: [{ id: 'response-1', revision: 3, score: 4, feedback: 'Good work' }],
    })
  })

  it('parses and forwards a revision-aware batch', async () => {
    const response = await PATCH(request({ grades: [validGrade] }), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      saved_count: 1,
      responses: [{ id: 'response-1', revision: 3, score: 4, feedback: 'Good work' }],
    })
    expect(saveStudentTestGrades).toHaveBeenCalledWith({
      teacherId: 'teacher-1',
      testId: 'test-1',
      studentId: 'student-1',
      grades: [expect.objectContaining({
        response_id: 'response-1',
        expected_response_revision: 2,
        score: 4,
      })],
    })
  })

  it.each([
    ['{', 'Invalid JSON body'],
    [{}, 'grades array is required'],
    [{ grades: [{ ...validGrade, expected_response_revision: 0 }] }, 'Invalid grade payload'],
    [{ grades: [{ ...validGrade, score: '4' }] }, 'Invalid grade payload'],
  ])('rejects invalid input %#', async (body, message) => {
    const response = await PATCH(request(body), context)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: message })
    expect(saveStudentTestGrades).not.toHaveBeenCalled()
  })

  it('maps a stale revision conflict', async () => {
    saveStudentTestGrades.mockRejectedValueOnce(new ApiError(409, 'Test response grade changed; reload and retry'))
    const response = await PATCH(request({ grades: [validGrade] }), context)
    expect(response.status).toBe(409)
  })
})
