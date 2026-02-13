import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/assignments/[id]/grade/route'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/assignments/[id]/grade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts a grade (including 0) even when no submission doc exists', async () => {
    const mockFrom = vi.fn((table: string) => {
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

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'enroll-1' }, error: null }),
              })),
            })),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          upsert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'doc-1',
                  assignment_id: 'assignment-1',
                  student_id: 'student-1',
                  score_completion: 0,
                  score_thinking: 0,
                  score_workflow: 0,
                },
                error: null,
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/grade', {
      method: 'POST',
      body: JSON.stringify({
        student_id: 'student-1',
        score_completion: 0,
        score_thinking: 0,
        score_workflow: 0,
        feedback: 'No submission',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.doc.score_completion).toBe(0)
    expect(body.doc.score_thinking).toBe(0)
    expect(body.doc.score_workflow).toBe(0)
  })

  it('returns 400 if student is not enrolled in the assignment classroom', async () => {
    const mockFrom = vi.fn((table: string) => {
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

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/grade', {
      method: 'POST',
      body: JSON.stringify({
        student_id: 'student-missing',
        score_completion: 0,
        score_thinking: 0,
        score_workflow: 0,
        feedback: 'No submission',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    expect(response.status).toBe(400)
  })
})
