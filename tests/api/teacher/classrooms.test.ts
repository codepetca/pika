/**
 * API tests for GET/POST /api/teacher/classrooms
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from '@/app/api/teacher/classrooms/route'
import { NextRequest } from 'next/server'

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

describe('GET /api/teacher/classrooms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return list of active teacher classrooms', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'classroom-1', title: 'Math 101' }],
              error: null,
            }),
          })),
          not: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'classroom-archived', title: 'History 101' }],
              error: null,
            }),
          })),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.classrooms).toHaveLength(1)
  })

  it('should return archived classrooms when requested', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'classroom-active', title: 'Math 101' }],
              error: null,
            }),
          })),
          not: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'classroom-archived', title: 'History 101' }],
              error: null,
            }),
          })),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms?archived=true')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.classrooms).toHaveLength(1)
  })
})

describe('POST /api/teacher/classrooms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when title is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
  })

  it('should create classroom with generated code', async () => {
    const mockInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'classroom-1', title: 'Math 101' },
          error: null,
        }),
      })),
    }))

    const mockFrom = vi.fn(() => ({
      insert: mockInsert,
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms', {
      method: 'POST',
      body: JSON.stringify({ title: 'Math 101', termLabel: 'Fall 2024' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(201)
  })
})
