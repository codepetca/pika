/**
 * API tests for DELETE /api/teacher/classrooms/[id]/roster/[studentId]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DELETE } from '@/app/api/teacher/classrooms/[id]/roster/[studentId]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

describe('DELETE /api/teacher/classrooms/[id]/roster/[studentId]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 403 when not classroom owner', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { teacher_id: 'other' }, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/s-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: { id: 'c-1', studentId: 's-1' } })
    expect(response.status).toBe(403)
  })

  it('deletes classroom data and removes enrollment', async () => {
    const fromImpl = (table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { teacher_id: 'teacher-1' }, error: null }),
            })),
          })),
        }
      }

      if (table === 'entries') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          })),
        }
      }

      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [{ id: 'a-1' }, { id: 'a-2' }], error: null }),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({ error: null }),
            })),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }

    ;(mockSupabaseClient.from as any) = vi.fn(fromImpl)

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/s-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: { id: 'c-1', studentId: 's-1' } })
    expect(response.status).toBe(200)

    expect(mockSupabaseClient.from).toHaveBeenCalledWith('entries')
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('assignments')
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('assignment_docs')
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('classroom_enrollments')
  })
})
