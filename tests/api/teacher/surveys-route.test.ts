import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/surveys/route'

const mockSupabaseClient = { from: vi.fn() }

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

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
  assertTeacherOwnsClassroom: vi.fn(async () => ({ ok: true })),
}))

describe('POST /api/teacher/surveys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates an untitled draft survey when no title is provided', async () => {
    const insertedSurvey = {
      id: 'survey-1',
      classroom_id: 'classroom-1',
      title: 'Untitled 2026-05-14 10:15:30',
      status: 'draft',
      opens_at: null,
      show_results: true,
      dynamic_responses: false,
      position: 3,
      created_by: 'teacher-1',
    }
    const insert = vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { ...insertedSurvey, ...payload },
          error: null,
        }),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { position: 1 }, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'classwork_materials') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { position: 2 }, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'surveys') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
          insert,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/surveys', {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'classroom-1', title: '   ' }),
      }),
    )

    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      classroom_id: 'classroom-1',
      title: expect.stringMatching(/^Untitled \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      show_results: true,
      dynamic_responses: false,
      created_by: 'teacher-1',
      position: 3,
    }))
    await expect(response.json()).resolves.toEqual({
      survey: expect.objectContaining({
        title: expect.stringMatching(/^Untitled \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      }),
    })
  })
})
