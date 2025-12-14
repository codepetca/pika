/**
 * API tests for GET /api/teacher/logs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/logs/route'
import { NextRequest } from 'next/server'
import { mockAuthenticationError } from '../setup'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (role: string) => {
    if (role === 'teacher') {
      return { id: 'teacher-1', email: 'test@teacher.com', role: 'teacher' }
    }
    throw new Error('Unauthorized')
  }),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1')
    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/logs')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  it('should return 400 for invalid date', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-1-1')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'other-teacher' },
                error: null,
              }),
            })),
          })),
        }
      }
      return {}
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1')
    const response = await GET(request)
    expect(response.status).toBe(403)
  })

  it('should return 200 with roster and entry (when present)', async () => {
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
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                { student_id: 's1', users: { id: 's1', email: 'a@student.com' } },
                { student_id: 's2', users: { id: 's2', email: 'b@student.com' } },
              ],
              error: null,
            }),
          })),
        }
      }
      if (table === 'entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { id: 'e1', student_id: 's2', classroom_id: 'classroom-1', date: '2025-01-02', text: 'hello', minutes_reported: null, mood: null, created_at: '', updated_at: '', on_time: true },
                ],
                error: null,
              }),
            })),
          })),
        }
      }
      return {}
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-01-02')
    const response = await GET(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.logs).toHaveLength(2)
    expect(body.logs[0].student_email).toBe('a@student.com')
    expect(body.logs[0].entry).toBe(null)
    expect(body.logs[1].student_email).toBe('b@student.com')
    expect(body.logs[1].entry?.id).toBe('e1')
  })
})

