import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/assignments/[id]/grade/route'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockSupabaseClient = { from: mockFrom, rpc: mockRpc }
const revision = '2026-07-14T18:00:00Z'

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    assignment_id: 'a0000000-0000-4000-8000-000000000001',
    student_id: 'b0000000-0000-4000-8000-000000000001',
    updated_at: '2026-07-14T18:01:00Z',
    score_completion: 7,
    score_thinking: 8,
    score_workflow: 9,
    teacher_feedback_draft: 'Strong work',
    teacher_feedback_draft_updated_at: '2026-07-14T18:01:00Z',
    graded_at: '2026-07-14T18:01:00Z',
    graded_by: 'teacher',
    ...overrides,
  }
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost:3000/api/teacher/assignments/a0000000-0000-4000-8000-000000000001/grade', {
    method: 'POST',
    body: JSON.stringify({
      student_id: 'b0000000-0000-4000-8000-000000000001',
      score_completion: 7,
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Strong work',
      expected_doc_updated_at: revision,
      ...overrides,
    }),
  })
}

describe('POST /api/teacher/assignments/[id]/grade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockResolvedValue({ data: { docs: [makeDoc()] }, error: null })
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

  it('rejects a missing student id before accessing the database', async () => {
    const response = await POST(makeRequest({ student_id: undefined }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    expect(response.status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('saves against the rendered document revision through the atomic RPC', async () => {
    const response = await POST(makeRequest({ score_completion: 0 }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.doc.student_id).toBe('b0000000-0000-4000-8000-000000000001')
    expect(mockRpc).toHaveBeenCalledWith('save_assignment_grades_atomic', expect.objectContaining({
      p_assignment_id: 'a0000000-0000-4000-8000-000000000001',
      p_student_ids: ['b0000000-0000-4000-8000-000000000001'],
      p_teacher_id: 'teacher-1',
      p_expected_doc_updated_at_by_student: { 'b0000000-0000-4000-8000-000000000001': revision },
      p_score_completion: 0,
      p_apply_grade: true,
      p_apply_comments: true,
      p_mark_graded: true,
    }))
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('fails closed when a legacy caller omits the rendered revision', async () => {
    const response = await POST(makeRequest({ expected_doc_updated_at: undefined }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })

    expect(response.status).toBe(409)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('preserves partial draft semantics in RPC arguments', async () => {
    mockRpc.mockResolvedValue({
      data: { docs: [makeDoc({ score_thinking: null, score_workflow: null, graded_at: null, graded_by: null })] },
      error: null,
    })
    const response = await POST(makeRequest({
      score_thinking: '',
      score_workflow: null,
      save_mode: 'draft',
    }), { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })

    expect(response.status).toBe(200)
    expect(mockRpc).toHaveBeenCalledWith('save_assignment_grades_atomic', expect.objectContaining({
      p_score_thinking: null,
      p_score_workflow: null,
      p_mark_graded: false,
    }))
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

  it('rejects a malformed RPC result', async () => {
    mockRpc.mockResolvedValue({ data: { docs: [{ student_id: 'b0000000-0000-4000-8000-000000000001' }] }, error: null })
    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })
    expect(response.status).toBe(500)
  })
})
