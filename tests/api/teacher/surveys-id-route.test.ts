import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/teacher/surveys/[id]/route'

const mockSupabaseClient = { from: vi.fn() }
const mockAssertTeacherOwnsSurvey = vi.hoisted(() => vi.fn())

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

vi.mock('@/lib/server/surveys', () => ({
  assertTeacherOwnsSurvey: mockAssertTeacherOwnsSurvey,
  isMissingSurveyDueColumnsError: (error: any) => {
    const combined = [error?.message, error?.details, error?.hint]
      .map((value) => String(value || '').toLowerCase())
      .join(' ')
    const mentionsDueColumn = combined.includes('due_at') || combined.includes('due_policy')
    return (error?.code === '42703' || error?.code === 'PGRST204') && mentionsDueColumn
  },
}))

function makeSurvey(overrides: Record<string, unknown> = {}) {
  return {
    id: 'survey-1',
    classroom_id: 'classroom-1',
    title: 'Weekly check-in',
    status: 'active',
    opens_at: '2099-01-01T14:00:00.000Z',
    due_at: null,
    due_policy: 'soft',
    show_results: true,
    dynamic_responses: false,
    position: 0,
    created_by: 'teacher-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    classrooms: {
      id: 'classroom-1',
      teacher_id: 'teacher-1',
      archived_at: null,
    },
    ...overrides,
  }
}

describe('PATCH /api/teacher/surveys/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertTeacherOwnsSurvey.mockResolvedValue({
      ok: true,
      survey: makeSurvey(),
    })
  })

  it('allows rescheduling an active scheduled survey without rejecting active-to-active updates', async () => {
    const update = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: makeSurvey(payload),
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        return { update }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'active',
          opens_at: '2099-01-08T14:00:00.000Z',
        }),
      }),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith({
      status: 'active',
      opens_at: '2099-01-08T14:00:00.000Z',
    })
    expect(data.survey).toEqual(expect.objectContaining({
      status: 'active',
      opens_at: '2099-01-08T14:00:00.000Z',
    }))
  })

  it('retries survey updates without due fields when the due columns are not migrated yet', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const update = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue(
            update.mock.calls.length === 1
              ? {
                  data: null,
                  error: {
                    code: 'PGRST204',
                    message: "Could not find the 'due_at' column of 'surveys' in the schema cache",
                  },
                }
              : {
                  data: makeSurvey(payload),
                  error: null,
                },
          ),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        return { update }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1', {
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Updated check-in',
          due_at: '2026-01-02T20:30:00.000Z',
          due_policy: 'hard',
        }),
      }),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[0][0]).toEqual({
      title: 'Updated check-in',
      due_at: '2026-01-02T20:30:00.000Z',
      due_policy: 'hard',
    })
    expect(update.mock.calls[1][0]).toEqual({
      title: 'Updated check-in',
    })
    expect(data.survey).toEqual(expect.objectContaining({
      title: 'Updated check-in',
      due_at: null,
      due_policy: 'soft',
    }))
    warnSpy.mockRestore()
  })
})
