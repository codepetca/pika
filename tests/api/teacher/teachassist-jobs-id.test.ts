/**
 * API tests for GET /api/teacher/sync/teachassist/jobs/[id]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/sync/teachassist/jobs/[id]/route'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

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

/** Build a sync_job_items chain: .select().eq().order() */
function makeItemsChain(result: { data: any; error: any }) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn().mockResolvedValue(result),
      })),
    })),
  }
}

const mockJob = {
  id: 'job-1',
  classroom_id: 'c-1',
  provider: 'teachassist',
  mode: 'execute',
  status: 'completed',
  source: 'manual',
  summary: { planned: 5, upserted: 5, skipped: 0, failed: 0 },
  error_message: null,
  started_at: '2025-01-15T10:00:00Z',
  finished_at: '2025-01-15T10:01:00Z',
  created_at: '2025-01-15T10:00:00Z',
  classrooms: { teacher_id: 'teacher-1' },
}

// ---------------------------------------------------------------------------
// GET tests
// ---------------------------------------------------------------------------

describe('GET /api/teacher/sync/teachassist/jobs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const response = await GET(new Request('http://localhost:3000'), {
      params: Promise.resolve({ id: 'job-1' }),
    })
    expect(response.status).toBe(401)
  })

  it('should return 404 when job not found', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn().mockReturnValueOnce(
      makeJobChain({ data: null, error: { message: 'not found' } })
    )
    const response = await GET(new Request('http://localhost:3000'), {
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
    const response = await GET(new Request('http://localhost:3000'), {
      params: Promise.resolve({ id: 'job-1' }),
    })
    expect(response.status).toBe(403)
  })

  it('should return 200 with job and items', async () => {
    const mockItems = [
      { id: 'item-1', sync_job_id: 'job-1', entity_type: 'attendance', status: 'success', created_at: '2025-01-15T10:00:00Z' },
      { id: 'item-2', sync_job_id: 'job-1', entity_type: 'attendance', status: 'success', created_at: '2025-01-15T10:00:01Z' },
    ]
    ;(mockSupabaseClient.from as any) = vi.fn()
      .mockReturnValueOnce(makeJobChain({ data: mockJob, error: null }))
      .mockReturnValueOnce(makeItemsChain({ data: mockItems, error: null }))

    const response = await GET(new Request('http://localhost:3000'), {
      params: Promise.resolve({ id: 'job-1' }),
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.job.id).toBe('job-1')
    expect(data.job.status).toBe('completed')
    expect(data.items).toHaveLength(2)
    // Password / internal fields should not be present
    expect(data.job).not.toHaveProperty('classrooms')
  })

  it('should return 500 when items query fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn()
      .mockReturnValueOnce(makeJobChain({ data: mockJob, error: null }))
      .mockReturnValueOnce(makeItemsChain({ data: null, error: { message: 'DB error' } }))

    const response = await GET(new Request('http://localhost:3000'), {
      params: Promise.resolve({ id: 'job-1' }),
    })
    expect(response.status).toBe(500)
  })
})
