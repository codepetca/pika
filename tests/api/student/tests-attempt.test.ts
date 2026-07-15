import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/student/tests/[id]/attempt/route'
import { requireRole } from '@/lib/auth'
import { saveStudentTestAttempt } from '@/lib/server/test-submissions'
import { mockAuthenticationError } from '../setup'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: '10000000-0000-4000-8000-000000000002',
    email: 'student1@example.com',
    role: 'student',
  })),
}))

vi.mock('@/lib/server/test-submissions', () => ({
  saveStudentTestAttempt: vi.fn(),
}))

const routeContext = {
  params: Promise.resolve({ id: '10000000-0000-4000-8000-000000000010' }),
}

function buildRequest(body: unknown, raw = false) {
  return new NextRequest('http://localhost:3000/api/student/tests/test-1/attempt', {
    method: 'PATCH',
    body: raw ? String(body) : JSON.stringify(body),
  })
}

describe('PATCH /api/student/tests/[id]/attempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(saveStudentTestAttempt).mockResolvedValue({
      ok: true,
      attempt: {
        id: '10000000-0000-4000-8000-000000000020',
        test_id: '10000000-0000-4000-8000-000000000010',
        student_id: '10000000-0000-4000-8000-000000000002',
        responses: {},
        is_submitted: false,
        submitted_at: null,
        created_at: '2026-07-14T12:00:00.000Z',
        updated_at: '2026-07-14T12:00:00.000Z',
      },
      historyEntry: null,
    })
  })

  it('authenticates before parsing malformed JSON', async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(mockAuthenticationError())

    const response = await PATCH(buildRequest('{', true), routeContext)

    expect(response.status).toBe(401)
    expect(saveStudentTestAttempt).not.toHaveBeenCalled()
  })

  it.each([
    ['{', true, 'Invalid JSON body'],
    [null, false, 'Responses are required'],
    [{ responses: [] }, false, 'Responses are required'],
    [{ responses: {}, trigger: 'submit' }, false, 'Invalid trigger'],
  ])('rejects invalid request %#', async (body, raw, expectedError) => {
    const response = await PATCH(buildRequest(body, raw), routeContext)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: expectedError })
    expect(saveStudentTestAttempt).not.toHaveBeenCalled()
  })

  it('normalizes the draft and telemetry before invoking the atomic workflow', async () => {
    const response = await PATCH(buildRequest({
      responses: { 'q-1': 1, 'q-2': 'Draft answer' },
      trigger: 'blur',
      paste_word_count: 2.6,
      keystroke_count: -5,
    }), routeContext)

    expect(response.status).toBe(200)
    expect(saveStudentTestAttempt).toHaveBeenCalledWith({
      testId: '10000000-0000-4000-8000-000000000010',
      studentId: '10000000-0000-4000-8000-000000000002',
      responses: {
        'q-1': { question_type: 'multiple_choice', selected_option: 1 },
        'q-2': { question_type: 'open_response', response_text: 'Draft answer' },
      },
      trigger: 'blur',
      pasteWordCount: 3,
      keystrokeCount: 0,
    })
  })

  it('returns workflow errors', async () => {
    vi.mocked(saveStudentTestAttempt).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Cannot edit a submitted test',
    })

    const response = await PATCH(buildRequest({ responses: {} }), routeContext)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Cannot edit a submitted test' })
  })
})
