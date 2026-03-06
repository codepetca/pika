import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/assignments/[id]/return/route'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/assignments/[id]/return', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when student_ids is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/return', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_ids array is required')
  })

  it('auto-finalizes draft-scored docs when returning', async () => {
    const updates: Array<{ payload: Record<string, unknown>; ids: string[] }> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assignment-1',
                  classroom_id: 'classroom-1',
                  classrooms: { teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'doc-draft',
                    student_id: 'student-1',
                    graded_at: null,
                    returned_at: null,
                    score_completion: 6,
                    score_thinking: 7,
                    score_workflow: 8,
                  },
                  {
                    id: 'doc-graded',
                    student_id: 'student-2',
                    graded_at: '2026-03-05T10:00:00.000Z',
                    returned_at: null,
                    score_completion: 9,
                    score_thinking: 9,
                    score_workflow: 9,
                  },
                  {
                    id: 'doc-incomplete',
                    student_id: 'student-3',
                    graded_at: null,
                    returned_at: null,
                    score_completion: 4,
                    score_thinking: null,
                    score_workflow: 5,
                  },
                ],
                error: null,
              }),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => ({
            in: vi.fn(async (_column: string, ids: string[]) => {
              updates.push({ payload, ids })
              return { error: null }
            }),
          })),
        }
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/return', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1', 'student-2', 'student-3'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.returned_count).toBe(2)
    expect(data.skipped_count).toBe(1)

    expect(updates).toHaveLength(2)

    const finalizeUpdate = updates.find((u) => u.ids.includes('doc-draft'))
    expect(finalizeUpdate).toBeDefined()
    expect(finalizeUpdate?.payload.graded_by).toBe('teacher')
    expect(typeof finalizeUpdate?.payload.graded_at).toBe('string')
    expect(finalizeUpdate?.payload.returned_at).toBe(finalizeUpdate?.payload.graded_at)
    expect(finalizeUpdate?.payload.is_submitted).toBe(false)

    const returnOnlyUpdate = updates.find((u) => u.ids.includes('doc-graded'))
    expect(returnOnlyUpdate).toBeDefined()
    expect(returnOnlyUpdate?.payload.graded_at).toBeUndefined()
    expect(returnOnlyUpdate?.payload.returned_at).toBeDefined()
    expect(returnOnlyUpdate?.payload.is_submitted).toBe(false)
  })
})
