/**
 * API tests for PATCH /api/teacher/class-days
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PATCH } from '@/app/api/teacher/class-days/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
  })),
}))
vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: vi.fn(() => '2024-10-15'),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('PATCH /api/teacher/class-days', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when date is invalid', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/class-days', {
      method: 'PATCH',
      body: JSON.stringify({
        classroom_id: 'classroom-1',
        date: '10/15/2024',
        is_class_day: true,
      }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid date format (use YYYY-MM-DD)')
  })

  it('should return 400 when attempting to modify a past date', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/class-days', {
      method: 'PATCH',
      body: JSON.stringify({
        classroom_id: 'classroom-1',
        date: '2024-10-14',
        is_class_day: true,
      }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot modify past class days')
  })

  it('should allow toggling today and create the record if missing', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'teacher-1' },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'day-1',
                  classroom_id: 'classroom-1',
                  date: '2024-10-15',
                  is_class_day: true,
                  prompt_text: null,
                },
                error: null,
              }),
            })),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/class-days', {
      method: 'PATCH',
      body: JSON.stringify({
        classroom_id: 'classroom-1',
        date: '2024-10-15',
        is_class_day: true,
      }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.class_day.id).toBe('day-1')
    expect(data.class_day.is_class_day).toBe(true)
  })
})
