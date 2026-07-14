import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/assignments/[id]/feedback-return/route'

const {
  assertTeacherCanMutateAssignment,
  loadTeacherOwnedAssignment,
  mockSupabaseClient,
} = vi.hoisted(() => ({
  assertTeacherCanMutateAssignment: vi.fn(),
  loadTeacherOwnedAssignment: vi.fn(),
  mockSupabaseClient: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/server/assignments', () => ({
  assertTeacherCanMutateAssignment,
  loadTeacherOwnedAssignment,
}))

const studentId = '10000000-0000-4000-8000-000000000001'
const outsideStudentId = '10000000-0000-4000-8000-000000000002'
const assignmentRowId = '20000000-0000-4000-8000-000000000001'
const docId = '30000000-0000-4000-8000-000000000001'
const entryId = '40000000-0000-4000-8000-000000000001'
const teacherRowId = '50000000-0000-4000-8000-000000000001'
const now = '2026-07-14T12:00:00.000Z'

function successfulAtomicResult(feedback: string) {
  return {
    applied: true,
    doc: {
      id: docId,
      assignment_id: assignmentRowId,
      student_id: studentId,
      updated_at: now,
      feedback,
      teacher_feedback_draft: null,
      feedback_returned_at: now,
    },
    entry: {
      id: entryId,
      assignment_id: assignmentRowId,
      student_id: studentId,
      entry_kind: 'teacher_feedback',
      author_type: 'teacher',
      body: feedback,
      returned_at: now,
      created_at: now,
      created_by: teacherRowId,
    },
    created_doc: false,
  }
}

function makeRequest(body: unknown) {
  const normalized = body && typeof body === 'object' && !Array.isArray(body)
    ? {
        ...(body as Record<string, unknown>),
        ...(
          'student_id' in body && !('expected_doc_updated_at' in body)
            ? { expected_doc_updated_at: now }
            : {}
        ),
      }
    : body
  return new NextRequest('http://localhost:3000/api/teacher/assignments/a0000000-0000-4000-8000-000000000001/feedback-return', {
    method: 'POST',
    body: JSON.stringify(normalized),
  })
}

describe('POST /api/teacher/assignments/[id]/feedback-return', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assertTeacherCanMutateAssignment.mockResolvedValue({
      id: 'a0000000-0000-4000-8000-000000000001',
      classroom_id: 'classroom-1',
    })
  })

  it('authenticates before parsing or authorizing the request', async () => {
    const { requireRole } = await import('@/lib/auth')
    const error = new Error('Not authenticated')
    error.name = 'AuthenticationError'
    vi.mocked(requireRole).mockRejectedValueOnce(error)

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a0000000-0000-4000-8000-000000000001/feedback-return', {
      method: 'POST',
      body: '{',
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })

    expect(response.status).toBe(401)
    expect(assertTeacherCanMutateAssignment).not.toHaveBeenCalled()
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('authorizes assignment mutation before parsing the request', async () => {
    const error = new Error('Forbidden')
    error.name = 'AuthorizationError'
    assertTeacherCanMutateAssignment.mockRejectedValueOnce(error)

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a0000000-0000-4000-8000-000000000001/feedback-return', {
      method: 'POST',
      body: '{',
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })

    expect(response.status).toBe(403)
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('rejects a missing student id before database access', async () => {
    const response = await POST(makeRequest({}), { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_id is required')
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('requires the browser document revision before database access', async () => {
    const response = await POST(makeRequest({
      student_id: studentId,
      feedback: 'Feedback',
      expected_doc_updated_at: undefined,
    }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })

    expect(response.status).toBe(400)
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed feedback instead of returning the stored draft', async () => {
    const response = await POST(makeRequest({ student_id: studentId, feedback: { text: 'Feedback' } }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })

    expect(response.status).toBe(400)
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('maps atomic enrollment validation to the legacy bad-request response', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'Student is not enrolled in this classroom' },
    })

    const response = await POST(makeRequest({ student_id: outsideStudentId }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Student is not enrolled in this classroom')
  })

  it('preserves a forbidden response when authorization changes during the transaction', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Classroom is archived' },
    })

    const response = await POST(makeRequest({ student_id: studentId, feedback: 'Feedback' }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Classroom is archived')
  })

  it('does not fall back to the stored draft when explicit feedback is blank', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'Comment draft is required before returning comments' },
    })

    const response = await POST(makeRequest({ student_id: studentId, feedback: '   ' }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Comment draft is required before returning comments')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'return_assignment_feedback_atomic',
      expect.objectContaining({ p_feedback: '' }),
    )
  })

  it('returns stored draft feedback through the atomic RPC', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({
      data: successfulAtomicResult('Draft feedback'),
      error: null,
    })

    const response = await POST(makeRequest({ student_id: studentId }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.doc.feedback).toBe('Draft feedback')
    expect(data.entry.body).toBe('Draft feedback')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'return_assignment_feedback_atomic',
      expect.objectContaining({
        p_assignment_id: 'a0000000-0000-4000-8000-000000000001',
        p_student_id: studentId,
        p_teacher_id: 'teacher-1',
        p_feedback: null,
        p_expected_doc_updated_at: '2026-07-14T12:00:00.000Z',
        p_now: expect.any(String),
      }),
    )
  })

  it('trims explicit feedback and supports a missing assignment document', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({
      data: {
        ...successfulAtomicResult('Explicit feedback'),
        created_doc: true,
      },
      error: null,
    })

    const response = await POST(makeRequest({
      student_id: studentId,
      feedback: '  Explicit feedback  ',
      expected_doc_updated_at: null,
    }), { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })

    expect(response.status).toBe(200)
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'return_assignment_feedback_atomic',
      expect.objectContaining({
        p_feedback: 'Explicit feedback',
        p_expected_doc_updated_at: null,
      }),
    )
  })

  it('returns a conflict instead of clearing a concurrently changed draft', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({
      data: {
        applied: false,
        doc: {
          ...successfulAtomicResult('Old draft').doc,
          feedback: 'Previous feedback',
          teacher_feedback_draft: 'Newer draft',
        },
        entry: null,
      },
      error: null,
    })

    const response = await POST(makeRequest({ student_id: studentId, feedback: 'Old draft' }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Assignment feedback changed; reload and try again')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'return_assignment_feedback_atomic',
      expect.objectContaining({ p_expected_doc_updated_at: now }),
    )
  })

  it('rejects an invalid database response as a server contract failure', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({ data: { applied: true }, error: null })

    const response = await POST(makeRequest({ student_id: studentId, feedback: 'Feedback' }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Invalid assignment feedback return result')
  })
})
