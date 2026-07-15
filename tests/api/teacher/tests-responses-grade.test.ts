import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { PATCH } from '@/app/api/teacher/tests/[id]/responses/[responseId]/route'

const { saveTestResponseGrade } = vi.hoisted(() => ({ saveTestResponseGrade: vi.fn() }))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))
vi.mock('@/lib/server/test-grades', () => ({ saveTestResponseGrade }))

const context = { params: Promise.resolve({ id: 'test-1', responseId: 'response-1' }) }
const questionGradingSnapshot = {
  test_title: 'Unit Test',
  question_text: 'Explain the result.',
  points: 5,
  response_monospace: false,
  answer_key: 'Expected result',
  sample_solution: null,
}

function request(body: string | object) {
  return new NextRequest('http://localhost/api/teacher/tests/test-1/responses/response-1', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('PATCH teacher test response grade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveTestResponseGrade.mockResolvedValue({ id: 'response-1', revision: 3, score: 4, feedback: 'Good' })
  })

  it('forwards a revision-aware grade and AI provenance', async () => {
    const response = await PATCH(request({
      expected_response_revision: 2,
      score: 4,
      feedback: ' Good ',
      ai_grading_basis: 'generated_reference',
      ai_reference_answers: [' Answer '],
      ai_model: ' model ',
      question_grading_snapshot: questionGradingSnapshot,
      ai_provenance_token: 'signed-token',
      ai_suggested_score: 4,
      ai_suggested_feedback: 'Original AI feedback',
    }), context)

    expect(response.status).toBe(200)
    expect(saveTestResponseGrade).toHaveBeenCalledWith({
      teacherId: 'teacher-1',
      testId: 'test-1',
      responseId: 'response-1',
      grade: expect.objectContaining({
        expected_response_revision: 2,
        feedback: 'Good',
        ai_reference_answers: ['Answer'],
        ai_model: 'model',
        question_grading_snapshot: questionGradingSnapshot,
        ai_provenance_token: 'signed-token',
        ai_suggested_score: 4,
        ai_suggested_feedback: 'Original AI feedback',
      }),
    })
  })

  it('forwards a clear with all provenance removed', async () => {
    const response = await PATCH(request({ expected_response_revision: 2, clear_grade: true }), context)
    expect(response.status).toBe(200)
    expect(saveTestResponseGrade).toHaveBeenCalledWith(expect.objectContaining({
      grade: expect.objectContaining({ clear_grade: true, ai_grading_basis: null }),
    }))
  })

  it.each([
    ['{', 'Invalid JSON body'],
    [{ score: 1 }, 'Invalid grade payload'],
    [{ expected_response_revision: 1, score: '1' }, 'Invalid grade payload'],
  ])('rejects invalid input %#', async (body, message) => {
    const response = await PATCH(request(body), context)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: message })
    expect(saveTestResponseGrade).not.toHaveBeenCalled()
  })

  it('maps a stale response conflict', async () => {
    saveTestResponseGrade.mockRejectedValueOnce(new ApiError(409, 'Test response grade changed; reload and retry'))
    const response = await PATCH(request({ expected_response_revision: 2, score: 4 }), context)
    expect(response.status).toBe(409)
  })
})
