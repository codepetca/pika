/**
 * API tests for GET /api/teacher/logs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }

describe('GET /api/teacher/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
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
      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [],
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
    ;(mockSupabaseClient.rpc as any).mockResolvedValue({
      data: [
        { id: 'h1', student_id: 's1', classroom_id: 'classroom-1', date: '2025-01-03', text: 'preview 1', minutes_reported: null, mood: null, created_at: '', updated_at: '2025-01-03T12:00:00Z', on_time: true },
        { id: 'h2', student_id: 's2', classroom_id: 'classroom-1', date: '2025-01-02', text: 'hello', minutes_reported: null, mood: null, created_at: '', updated_at: '2025-01-02T12:00:00Z', on_time: true },
      ],
      error: null,
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-01-02')
    const response = await GET(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.logs).toHaveLength(2)
    expect(body.logs[0].student_email).toBe('a@student.com')
    expect(body.logs[0].entry).toBe(null)
    expect(body.logs[0].history_preview).toEqual([
      expect.objectContaining({ id: 'h1', student_id: 's1' }),
    ])
    expect(body.logs[1].student_email).toBe('b@student.com')
    expect(body.logs[1].entry?.id).toBe('e1')
    expect(body.logs[1].history_preview).toEqual([
      expect.objectContaining({ id: 'h2', student_id: 's2' }),
    ])
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('get_teacher_log_history_preview', {
      p_classroom_id: 'classroom-1',
      p_student_ids: ['s1', 's2'],
      p_limit: 5,
    })
  })

  it('caps batched history previews to five entries per student', async () => {
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
              ],
              error: null,
            }),
          })),
        }
      }
      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [],
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
                data: [],
                error: null,
              }),
            })),
          })),
        }
      }
      return {}
    })
    ;(mockSupabaseClient.from as any) = mockFrom
    const historyRows = Array.from({ length: 7 }, (_, index) => ({
      id: `h${index + 1}`,
      student_id: 's1',
      classroom_id: 'classroom-1',
      date: `2025-01-${String(10 - index).padStart(2, '0')}`,
      text: `preview ${index + 1}`,
      minutes_reported: null,
      mood: null,
      created_at: '',
      updated_at: `2025-01-${String(10 - index).padStart(2, '0')}T12:00:00Z`,
      on_time: true,
    }))
    ;(mockSupabaseClient.rpc as any).mockResolvedValue({
      data: historyRows,
      error: null,
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-01-02')
    const response = await GET(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.logs[0].history_preview).toHaveLength(5)
    expect(body.logs[0].history_preview.map((entry: any) => entry.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5'])
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('get_teacher_log_history_preview', {
      p_classroom_id: 'classroom-1',
      p_student_ids: ['s1'],
      p_limit: 5,
    })
  })

  it('falls back to per-student capped previews when the preview RPC is unavailable', async () => {
    let entriesQueryIndex = 0
    const historyQuery = (rows: any[]) => {
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }
      return query
    }
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
      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          })),
        }
      }
      if (table === 'entries') {
        entriesQueryIndex += 1
        if (entriesQueryIndex === 1) {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              })),
            })),
          }
        }
        if (entriesQueryIndex === 2) {
          return historyQuery([
            { id: 'fallback-h1', student_id: 's1', classroom_id: 'classroom-1', date: '2025-01-03', text: 'fallback 1', minutes_reported: null, mood: null, created_at: '', updated_at: '2025-01-03T12:00:00Z', on_time: true },
          ])
        }
        return historyQuery([
          { id: 'fallback-h2', student_id: 's2', classroom_id: 'classroom-1', date: '2025-01-02', text: 'fallback 2', minutes_reported: null, mood: null, created_at: '', updated_at: '2025-01-02T12:00:00Z', on_time: true },
        ])
      }
      return {}
    })
    ;(mockSupabaseClient.from as any) = mockFrom
    ;(mockSupabaseClient.rpc as any).mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'missing function' },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-01-02')
    const response = await GET(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.logs[0].history_preview).toEqual([
      expect.objectContaining({ id: 'fallback-h1', student_id: 's1' }),
    ])
    expect(body.logs[1].history_preview).toEqual([
      expect.objectContaining({ id: 'fallback-h2', student_id: 's2' }),
    ])
    expect(warnSpy).toHaveBeenCalledWith(
      'History preview RPC is unavailable; falling back to per-student preview queries'
    )
    warnSpy.mockRestore()
  })
})
