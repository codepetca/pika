/**
 * API tests for POST /api/teacher/classrooms/[id]/roster/upload-csv
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/teacher/classrooms/[id]/roster/upload-csv/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

function createRequest(body: object) {
  return new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/roster/upload-csv', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/teacher/classrooms/[id]/roster/upload-csv', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 400 when csvData is missing', async () => {
    const request = createRequest({})
    const response = await POST(request, { params: { id: 'c-1' } })
    expect(response.status).toBe(400)
  })

  describe('preview mode (no confirmed flag)', () => {
    it('returns needsConfirmation with changes when some students already exist', async () => {
      const existingStudents = [
        { id: 'r-1', email: 'existing@student.com', first_name: 'Old', last_name: 'Name', student_number: '111' },
      ]
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_roster') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({ data: existingStudents, error: null }),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = createRequest({
        csvData: 'Student Number,First Name,Last Name,Email\n111,New,Name,existing@student.com\n222,Brand,New,new@student.com\n',
      })

      const response = await POST(request, { params: { id: 'c-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.needsConfirmation).toBe(true)
      expect(data.changes).toHaveLength(1)
      expect(data.changes[0].email).toBe('existing@student.com')
      expect(data.changes[0].current).toEqual({ firstName: 'Old', lastName: 'Name', studentNumber: '111' })
      expect(data.changes[0].incoming).toEqual({ firstName: 'New', lastName: 'Name', studentNumber: '111' })
      expect(data.newCount).toBe(1)
      expect(data.updateCount).toBe(1)
    })

    it('proceeds directly when no existing students found', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_roster') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
            upsert: vi.fn(() => ({
              select: vi.fn().mockResolvedValue({ data: [{ id: 'r-1', email: 'new@student.com' }], error: null }),
            })),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = createRequest({
        csvData: 'Student Number,First Name,Last Name,Email\n123,New,Student,new@student.com\n',
      })

      const response = await POST(request, { params: { id: 'c-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.needsConfirmation).toBeUndefined()
      expect(data.success).toBe(true)
      expect(data.upsertedCount).toBe(1)
    })
  })

  describe('confirmed mode', () => {
    it('upserts into classroom_roster when confirmed is true', async () => {
      const upsertMock = vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: [{ id: 'r-1', email: 'a@student.com' }], error: null }),
      }))
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_roster') {
          return { upsert: upsertMock }
        }
        throw new Error(`Unexpected table: ${table}`)
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = createRequest({
        csvData: 'Student Number,First Name,Last Name,Email\n123,A,B,a@student.com\n',
        confirmed: true,
      })

      const response = await POST(request, { params: { id: 'c-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.upsertedCount).toBe(1)
      expect(upsertMock).toHaveBeenCalled()
    })

    it('skips preview check when confirmed is true', async () => {
      const selectMock = vi.fn()
      const upsertMock = vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: [{ id: 'r-1', email: 'a@student.com' }], error: null }),
      }))
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_roster') {
          return {
            select: selectMock,
            upsert: upsertMock,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = createRequest({
        csvData: 'Student Number,First Name,Last Name,Email\n123,A,B,a@student.com\n',
        confirmed: true,
      })

      await POST(request, { params: { id: 'c-1' } })

      // Should NOT have called select to check for existing students
      expect(selectMock).not.toHaveBeenCalled()
      // Should have called upsert directly
      expect(upsertMock).toHaveBeenCalled()
    })
  })
})
