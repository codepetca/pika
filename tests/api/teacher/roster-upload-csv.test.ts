/**
 * API tests for POST /api/teacher/classrooms/[id]/roster/upload-csv
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/teacher/classrooms/[id]/roster/upload-csv/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/classrooms/[id]/roster/upload-csv', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 400 when csvData is missing', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { teacher_id: 'teacher-1' }, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/upload-csv', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request, { params: { id: 'c-1' } })
    expect(response.status).toBe(400)
  })
})
