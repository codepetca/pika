import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/assignments/[id]/grade-selected/route'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockSupabaseClient = { from: mockFrom, rpc: mockRpc }
const revisionOne = '2026-07-14T18:00:00Z'
const revisionTwo = '2026-07-14T18:00:01Z'

function makeDoc(studentId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `doc-${studentId}`,
    assignment_id: 'a0000000-0000-4000-8000-000000000001',
    student_id: studentId,
    updated_at: '2026-07-14T18:02:00Z',
    score_completion: 7,
    score_thinking: 8,
    score_workflow: 9,
    teacher_feedback_draft: 'Shared feedback',
    teacher_feedback_draft_updated_at: '2026-07-14T18:02:00Z',
    graded_at: '2026-07-14T18:02:00Z',
    graded_by: 'teacher',
    ...overrides,
  }
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost:3000/api/teacher/assignments/a0000000-0000-4000-8000-000000000001/grade-selected', {
    method: 'POST',
    body: JSON.stringify({
      student_ids: ['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'],
      expected_doc_updated_at_by_student: {
        'b0000000-0000-4000-8000-000000000001': revisionOne,
        'b0000000-0000-4000-8000-000000000002': revisionTwo,
      },
      score_completion: 7,
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Shared feedback',
      save_mode: 'graded',
      ...overrides,
    }),
  })
}

describe('POST /api/teacher/assignments/[id]/grade-selected', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockResolvedValue({
      data: { docs: [makeDoc('b0000000-0000-4000-8000-000000000001'), makeDoc('b0000000-0000-4000-8000-000000000002')] },
      error: null,
    })
  })

  it('authenticates before parsing the request body', async () => {
    const { requireRole } = await import('@/lib/auth')
    const error = new Error('Not authenticated')
    error.name = 'AuthenticationError'
    vi.mocked(requireRole).mockRejectedValueOnce(error)

    const response = await POST(new NextRequest(makeRequest().url, { method: 'POST', body: '{' }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    expect(response.status).toBe(401)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('rejects invalid selected-student input before accessing the database', async () => {
    const response = await POST(makeRequest({ student_ids: [] }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    expect(response.status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('saves unique selected students with their rendered revisions', async () => {
    const response = await POST(makeRequest({ student_ids: ['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001'] }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.updated_student_ids).toEqual(['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'])
    expect(mockRpc).toHaveBeenCalledWith('save_assignment_grades_atomic', expect.objectContaining({
      p_student_ids: ['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'],
      p_expected_doc_updated_at_by_student: {
        'b0000000-0000-4000-8000-000000000001': revisionOne,
        'b0000000-0000-4000-8000-000000000002': revisionTwo,
      },
      p_apply_grade: true,
      p_apply_comments: true,
    }))
  })

  it('preserves comments-only semantics', async () => {
    const response = await POST(makeRequest({
      apply_target: 'comments',
      score_completion: undefined,
      score_thinking: undefined,
      score_workflow: undefined,
    }), { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })

    expect(response.status).toBe(200)
    expect(mockRpc).toHaveBeenCalledWith('save_assignment_grades_atomic', expect.objectContaining({
      p_apply_grade: false,
      p_apply_comments: true,
      p_score_completion: null,
      p_score_thinking: null,
      p_score_workflow: null,
    }))
  })

  it('fails closed when a legacy caller omits selected document revisions', async () => {
    const response = await POST(makeRequest({ expected_doc_updated_at_by_student: undefined }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })

    expect(response.status).toBe(409)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it.each([
    ['40001', 409],
    ['42501', 403],
    ['22023', 400],
  ])('maps database error %s to HTTP %s', async (code, expectedStatus) => {
    mockRpc.mockResolvedValue({ data: null, error: { code, message: 'Database contract error' } })
    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })
    expect(response.status).toBe(expectedStatus)
  })

  it('rejects partial RPC results', async () => {
    mockRpc.mockResolvedValue({ data: { docs: [makeDoc('b0000000-0000-4000-8000-000000000001')] }, error: null })
    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })
    expect(response.status).toBe(500)
  })
})
