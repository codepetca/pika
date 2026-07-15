import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/student/tests/[id]/respond/route'
import { requireRole } from '@/lib/auth'
import { submitStudentTestAttempt } from '@/lib/server/test-submissions'
import { mockAuthenticationError } from '../setup'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'student-1',
    email: 'student1@example.com',
    role: 'student',
  })),
}))

vi.mock('@/lib/server/test-submissions', () => ({
  submitStudentTestAttempt: vi.fn(async () => ({ ok: true })),
}))

function buildRequest(body: unknown, raw = false) {
  return new NextRequest('http://localhost:3000/api/student/tests/test-1/respond', {
    method: 'POST',
    body: raw ? String(body) : JSON.stringify(body),
  })
}

const routeContext = { params: Promise.resolve({ id: 'test-1' }) }

describe('POST /api/student/tests/[id]/respond', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(submitStudentTestAttempt).mockResolvedValue({ ok: true })
  })

  it('authenticates before parsing the request body', async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(mockAuthenticationError())

    const response = await POST(buildRequest('{', true), routeContext)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(requireRole).toHaveBeenCalledWith('student')
    expect(submitStudentTestAttempt).not.toHaveBeenCalled()
  })

  it.each([
    ['{', true, 'Invalid JSON body'],
    [null, false, 'Responses are required'],
    [{}, false, 'Responses are required'],
    [{ responses: null }, false, 'Responses are required'],
    [{ responses: [] }, false, 'Responses are required'],
  ])('returns a deterministic 400 for invalid body %#', async (body, raw, expectedError) => {
    const response = await POST(buildRequest(body, raw), routeContext)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: expectedError })
    expect(submitStudentTestAttempt).not.toHaveBeenCalled()
  })

  it('normalizes responses before invoking the atomic workflow', async () => {
    const response = await POST(
      buildRequest({
        responses: {
          'q-2': 'Open answer\r\nsecond line',
          'q-1': 1,
          ignored: { selected_option: -1 },
        },
      }),
      routeContext,
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ success: true })
    expect(submitStudentTestAttempt).toHaveBeenCalledWith({
      studentId: 'student-1',
      testId: 'test-1',
      responses: {
        'q-1': { question_type: 'multiple_choice', selected_option: 1 },
        'q-2': { question_type: 'open_response', response_text: 'Open answer\nsecond line' },
      },
    })
  })

  it('returns workflow errors without exposing database details', async () => {
    vi.mocked(submitStudentTestAttempt).mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: 'All questions must be answered',
    })

    const response = await POST(buildRequest({ responses: { 'q-1': 1 } }), routeContext)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'All questions must be answered' })
  })
})
