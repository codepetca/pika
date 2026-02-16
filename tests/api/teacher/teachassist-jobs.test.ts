/**
 * API tests for POST /api/teacher/sync/teachassist/jobs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/teacher/sync/teachassist/jobs/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/teachassist/engine', () => ({ runTeachAssistSyncJob: vi.fn() }))

const mockSupabaseClient = { from: vi.fn() }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClassroomsChain(result: { data: any; error: any }) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(result),
      })),
    })),
  }
}

const ownerOk = { data: { id: 'c-1', teacher_id: 'teacher-1' }, error: null }
const ownerWrong = { data: { id: 'c-1', teacher_id: 'other-teacher' }, error: null }

// ---------------------------------------------------------------------------
// POST tests
// ---------------------------------------------------------------------------

describe('POST /api/teacher/sync/teachassist/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/sync/teachassist/jobs', {
      method: 'POST',
      body: JSON.stringify({ mode: 'execute' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('classroom_id')
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest('http://localhost:3000/api/teacher/sync/teachassist/jobs', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'c-1' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('should return 403 when teacher does not own classroom', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn().mockReturnValueOnce(
      makeClassroomsChain(ownerWrong)
    )
    const request = new NextRequest('http://localhost:3000/api/teacher/sync/teachassist/jobs', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'c-1' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(403)
  })

  it('should return 200 on successful job creation', async () => {
    const { runTeachAssistSyncJob } = await import('@/lib/teachassist/engine')
    ;(mockSupabaseClient.from as any) = vi.fn().mockReturnValueOnce(
      makeClassroomsChain(ownerOk)
    )
    ;(runTeachAssistSyncJob as any).mockResolvedValueOnce({
      ok: true,
      jobId: 'job-42',
      summary: { planned: 10, upserted: 10, skipped: 0, failed: 0 },
      errors: [],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/sync/teachassist/jobs', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        mode: 'execute',
        source: 'gradebook',
        dataset: { attendance: [] },
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.jobId).toBe('job-42')
    expect(runTeachAssistSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'c-1',
        mode: 'execute',
        source: 'gradebook',
        createdBy: 'teacher-1',
      })
    )
  })
})
