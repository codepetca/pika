/**
 * API tests for GET/POST /api/teacher/teachassist/config
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from '@/app/api/teacher/teachassist/config/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
  })),
}))
vi.mock('@/lib/teachassist/crypto', () => ({
  encryptPassword: vi.fn((p: string) => `enc:${p}`),
}))

const mockSupabaseClient = { from: vi.fn() }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMappingsSelectChain(result: { data: any; error: any }) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(result),
      })),
    })),
  }
}

function makeMappingsUpsertChain(result: { error: any }) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    })),
    upsert: vi.fn().mockResolvedValue(result),
  }
}

// ---------------------------------------------------------------------------
// GET tests
// ---------------------------------------------------------------------------

describe('GET /api/teacher/teachassist/config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/config')
    const response = await GET(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('classroom_id')
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/teachassist/config?classroom_id=c-1'
    )
    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('should return 403 when user is authenticated but not a teacher', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authzError = new Error('Forbidden')
    authzError.name = 'AuthorizationError'
    ;(requireRole as any).mockRejectedValueOnce(authzError)

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/teachassist/config?classroom_id=c-1'
    )
    const response = await GET(request)
    expect(response.status).toBe(403)
  })

  it('should return 404 when classroom does not exist', async () => {
    const { assertTeacherOwnsClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherOwnsClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: 'Classroom not found',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/teachassist/config?classroom_id=missing'
    )
    const response = await GET(request)
    expect(response.status).toBe(404)
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const { assertTeacherOwnsClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherOwnsClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/teachassist/config?classroom_id=c-1'
    )
    const response = await GET(request)
    expect(response.status).toBe(403)
  })

  it('should return 200 with null config when no config exists', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn().mockReturnValueOnce(
      makeMappingsSelectChain({ data: null, error: null })
    )

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/teachassist/config?classroom_id=c-1'
    )
    const response = await GET(request)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.config).toBeNull()
  })

  it('should return 200 with config omitting password', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn().mockReturnValueOnce(
      makeMappingsSelectChain({
        data: {
          config: {
            ta_username: 'jsmith',
            ta_password_encrypted: 'enc:secret',
            ta_base_url: 'https://ta.yrdsb.ca/yrdsb/',
            ta_course_search: 'GLD2OOH',
            ta_block: 'A1',
            ta_execution_mode: 'confirmation',
          },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-15T00:00:00Z',
        },
        error: null,
      })
    )

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/teachassist/config?classroom_id=c-1'
    )
    const response = await GET(request)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.config.ta_username).toBe('jsmith')
    expect(data.config.has_password).toBe(true)
    expect(data.config).not.toHaveProperty('ta_password_encrypted')
  })
})

// ---------------------------------------------------------------------------
// POST tests
// ---------------------------------------------------------------------------

describe('POST /api/teacher/teachassist/config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/config', {
      method: 'POST',
      body: JSON.stringify({ ta_username: 'jsmith', ta_course_search: 'GLD', ta_block: 'A1', ta_password: 'pass' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('classroom_id')
  })

  it('should return 400 when required fields are missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/config', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'c-1', ta_password: 'pass' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('required')
  })

  it('should return 400 when no password on first save', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn().mockReturnValueOnce(
      // Existing config lookup — no record
      makeMappingsSelectChain({ data: null, error: null })
    )

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/config', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        ta_username: 'jsmith',
        ta_course_search: 'GLD2OOH',
        ta_block: 'A1',
        // no ta_password
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('ta_password is required')
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/config', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'c-1', ta_username: 'jsmith', ta_course_search: 'GLD', ta_block: 'A1', ta_password: 'pass' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('should return 403 when user is authenticated but not a teacher', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authzError = new Error('Forbidden')
    authzError.name = 'AuthorizationError'
    ;(requireRole as any).mockRejectedValueOnce(authzError)

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/config', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'c-1', ta_username: 'jsmith', ta_course_search: 'GLD', ta_block: 'A1', ta_password: 'pass' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(403)
  })

  it('should return 404 when classroom does not exist', async () => {
    const { assertTeacherOwnsClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherOwnsClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: 'Classroom not found',
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/config', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'missing', ta_username: 'jsmith', ta_course_search: 'GLD', ta_block: 'A1', ta_password: 'pass' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(404)
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const { assertTeacherOwnsClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherOwnsClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/config', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: 'c-1', ta_username: 'jsmith', ta_course_search: 'GLD', ta_block: 'A1', ta_password: 'pass' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(403)
  })

  it('should return 200 when save succeeds and encrypt the password', async () => {
    const { encryptPassword } = await import('@/lib/teachassist/crypto')
    ;(mockSupabaseClient.from as any) = vi.fn().mockReturnValueOnce(
      makeMappingsUpsertChain({ error: null })
    )

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/config', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        ta_username: 'jsmith',
        ta_password: 'secret',
        ta_course_search: 'GLD2OOH',
        ta_block: 'A1',
        ta_execution_mode: 'confirmation',
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(encryptPassword).toHaveBeenCalledWith('secret')
  })

  it('should return 500 on DB upsert error', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn().mockReturnValueOnce(
      makeMappingsUpsertChain({ error: { message: 'DB error' } })
    )

    const request = new NextRequest('http://localhost:3000/api/teacher/teachassist/config', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: 'c-1',
        ta_username: 'jsmith',
        ta_password: 'secret',
        ta_course_search: 'GLD2OOH',
        ta_block: 'A1',
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(500)
  })
})
