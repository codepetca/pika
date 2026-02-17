/**
 * API tests for POST /api/teacher/teachassist/sync
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/teacher/teachassist/sync/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
  })),
}))
vi.mock('@/lib/teachassist/attendance-sync', () => ({ runAttendanceSync: vi.fn() }))

const mockSupabaseClient = { from: vi.fn() }

// ---------------------------------------------------------------------------
// POST tests
// ---------------------------------------------------------------------------

describe('POST /api/teacher/teachassist/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/sync', {
      method: 'POST',
      body: JSON.stringify({ mode: 'dry_run' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('classroom_id')
  })

  it('should return 400 when date_range is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/sync', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        mode: 'execute',
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('date_range is required')
  })

  it('should return 400 for invalid date_range format', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/sync', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        mode: 'execute',
        date_range: { from: '2025/01/01', to: '2025-01-31' },
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('YYYY-MM-DD')
  })

  it('should return 400 when only one date_range boundary is provided', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/sync', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        mode: 'execute',
        date_range: { from: '2025-01-01' },
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('are required')
  })

  it('should return 400 for impossible calendar dates in date_range', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/sync', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        mode: 'execute',
        date_range: { from: '2025-02-30', to: '2025-03-01' },
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('valid calendar dates')
  })

  it('should return 400 when date_range spans more than one day', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/sync', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        mode: 'execute',
        date_range: { from: '2025-01-01', to: '2025-01-31' },
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('single date')
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/sync', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'c-1' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const { assertTeacherOwnsClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherOwnsClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/sync', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'c-1' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(403)
  })

  it('should return 200 for dry_run mode', async () => {
    const { runAttendanceSync } = await import('@/lib/teachassist/attendance-sync')
    ;(runAttendanceSync as any).mockResolvedValueOnce({
      jobId: 'job-1',
      ok: true,
      summary: { planned: 5, upserted: 0, skipped: 5, failed: 0 },
      errors: [],
      unmatchedStudents: [],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/sync', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        mode: 'dry_run',
        date_range: { from: '2025-01-15', to: '2025-01-15' },
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.jobId).toBe('job-1')
    expect(runAttendanceSync).toHaveBeenCalledWith(
      expect.objectContaining({ classroomId: 'c-1', mode: 'dry_run' })
    )
  })

  it('should return 200 for execute mode with result', async () => {
    const { runAttendanceSync } = await import('@/lib/teachassist/attendance-sync')
    ;(runAttendanceSync as any).mockResolvedValueOnce({
      jobId: 'job-2',
      ok: true,
      summary: { planned: 3, upserted: 3, skipped: 0, failed: 0 },
      errors: [],
      unmatchedStudents: [],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/sync', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        mode: 'execute',
        execution_mode: 'full_auto',
        date_range: { from: '2025-01-31', to: '2025-01-31' },
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.summary.upserted).toBe(3)
    expect(runAttendanceSync).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'execute',
        executionMode: 'full_auto',
        dateRange: { from: '2025-01-31', to: '2025-01-31' },
      })
    )
  })

  it('should return 400 when sync returns not-ok', async () => {
    const { runAttendanceSync } = await import('@/lib/teachassist/attendance-sync')
    ;(runAttendanceSync as any).mockResolvedValueOnce({
      jobId: 'job-3',
      ok: false,
      summary: { planned: 0, upserted: 0, skipped: 0, failed: 1 },
      errors: [{ type: 'authentication', message: 'Login failed', recoverable: false }],
      unmatchedStudents: [],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/sync', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        mode: 'execute',
        date_range: { from: '2025-01-20', to: '2025-01-20' },
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.ok).toBe(false)
  })
})
