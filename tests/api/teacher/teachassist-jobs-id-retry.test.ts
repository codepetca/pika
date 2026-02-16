/**
 * API tests for POST /api/teacher/sync/teachassist/jobs/[id]/retry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/teacher/sync/teachassist/jobs/[id]/retry/route'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/teachassist/engine', () => ({ runTeachAssistSyncJob: vi.fn() }))

const mockSupabaseClient = { from: vi.fn() }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a sync_jobs chain: .select().eq().single() */
function makeJobChain(result: { data: any; error: any }) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(result),
      })),
    })),
  }
}

const mockJob = {
  id: 'job-1',
  classroom_id: 'c-1',
  source: 'manual',
  source_payload: { attendance: [] },
  classrooms: { teacher_id: 'teacher-1' },
}

// ---------------------------------------------------------------------------
// POST tests
// ---------------------------------------------------------------------------

describe('POST /api/teacher/sync/teachassist/jobs/[id]/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const response = await POST(new Request('http://localhost:3000'), {
      params: Promise.resolve({ id: 'job-1' }),
    })
    expect(response.status).toBe(401)
  })

  it('should return 404 when job not found', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn().mockReturnValueOnce(
      makeJobChain({ data: null, error: { message: 'not found' } })
    )
    const response = await POST(new Request('http://localhost:3000'), {
      params: Promise.resolve({ id: 'missing-job' }),
    })
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toContain('not found')
  })

  it('should return 403 when job belongs to another teacher', async () => {
    const otherJob = { ...mockJob, classrooms: { teacher_id: 'other-teacher' } }
    ;(mockSupabaseClient.from as any) = vi.fn().mockReturnValueOnce(
      makeJobChain({ data: otherJob, error: null })
    )
    const response = await POST(new Request('http://localhost:3000'), {
      params: Promise.resolve({ id: 'job-1' }),
    })
    expect(response.status).toBe(403)
  })

  it('should return 200 on successful retry', async () => {
    const { runTeachAssistSyncJob } = await import('@/lib/teachassist/engine')
    ;(mockSupabaseClient.from as any) = vi.fn().mockReturnValueOnce(
      makeJobChain({ data: mockJob, error: null })
    )
    ;(runTeachAssistSyncJob as any).mockResolvedValueOnce({
      ok: true,
      jobId: 'job-2',
      summary: { planned: 3, upserted: 3, skipped: 0, failed: 0 },
      errors: [],
    })

    const response = await POST(new Request('http://localhost:3000'), {
      params: Promise.resolve({ id: 'job-1' }),
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(runTeachAssistSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'c-1',
        mode: 'execute',
        source: 'manual:retry',
        createdBy: 'teacher-1',
      })
    )
  })
})
