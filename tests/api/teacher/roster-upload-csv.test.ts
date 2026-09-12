/**
 * API tests for POST /api/teacher/classrooms/[id]/roster/upload-csv
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/teacher/classrooms/[id]/roster/upload-csv/route'
import { NextRequest } from 'next/server'
import { assertStudentsCanBeAddedToRoster } from '@/lib/server/classroom-student-removal'
import { ApiError } from '@/lib/api-error'

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

  it.each([false, true])('rejects removed students before CSV preview or write (confirmed=%s)', async (confirmed) => {
    vi.mocked(assertStudentsCanBeAddedToRoster).mockRejectedValueOnce(new ApiError(409, 'Student cannot be re-added'))
    const response = await POST(createRequest({
      csvData: 'First Name,Last Name,Email\nA,B,removed@example.com', confirmed,
    }), { params: { id: 'c-1' } })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'Student cannot be re-added' })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('maps a concurrent database removal denial without reporting a successful import', async () => {
    mockSupabaseClient.from.mockReturnValue({ upsert: vi.fn(() => ({ select: vi.fn().mockResolvedValue({
      data: null, error: { code: '55000', message: 'student_class_data_pending_purge' },
    }) })) })
    const response = await POST(createRequest({
      csvData: 'First Name,Last Name,Email\nA,B,removed@example.com', confirmed: true,
    }), { params: { id: 'c-1' } })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('cannot be re-added') })
  })

  it('should return 400 when csvData is missing', async () => {
    const request = createRequest({})
    const response = await POST(request, { params: { id: 'c-1' } })
    expect(response.status).toBe(400)
  })

  describe('preview mode (no confirmed flag)', () => {
    it('returns needsConfirmation with changes when some students already exist', async () => {
      const existingStudents = [
        { id: 'r-1', email: 'existing@student.com', first_name: 'Old', last_name: 'Name', student_number: '111', counselor_email: null },
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
      expect(data.changes[0].current).toEqual({ firstName: 'Old', lastName: 'Name', studentNumber: '111', counselorEmail: null })
      expect(data.changes[0].incoming).toEqual({ firstName: 'New', lastName: 'Name', studentNumber: '111', counselorEmail: null })
      expect(data.newCount).toBe(1)
      expect(data.updateCount).toBe(1)
    })

    it('proceeds directly when existing students have no actual changes', async () => {
      const existingStudents = [
        { id: 'r-1', email: 'same@student.com', first_name: 'Same', last_name: 'Name', student_number: '111', counselor_email: null },
      ]
      const upsertMock = vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: [{ id: 'r-1', email: 'same@student.com' }], error: null }),
      }))
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_roster') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({ data: existingStudents, error: null }),
              })),
            })),
            upsert: upsertMock,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      // CSV has identical data to existing
      const request = createRequest({
        csvData: 'Student Number,First Name,Last Name,Email\n111,Same,Name,same@student.com\n',
      })

      const response = await POST(request, { params: { id: 'c-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.needsConfirmation).toBeUndefined()
      expect(data.success).toBe(true)
      expect(upsertMock).toHaveBeenCalled()
      expect(upsertMock).toHaveBeenCalledWith([
        expect.objectContaining({
          email: 'same@student.com',
          join_source: 'csv',
        }),
      ], { onConflict: 'classroom_id,email' })
    })

    it('proceeds directly when no existing students found', async () => {
      const upsertMock = vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: [{ id: 'r-1', email: 'new@student.com' }], error: null }),
      }))
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_roster') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
            upsert: upsertMock,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = createRequest({
        csvData: 'Student Number,First Name,Last Name,Email,Email (2nd)\n123,New,Student,new@student.com,secondary@student.com\n',
      })

      const response = await POST(request, { params: { id: 'c-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.needsConfirmation).toBeUndefined()
      expect(data.success).toBe(true)
      expect(data.upsertedCount).toBe(1)
      expect(upsertMock).toHaveBeenCalledWith(
        [expect.objectContaining({ counselor_email: 'secondary@student.com' })],
        { onConflict: 'classroom_id,email' },
      )
    })

    it('accepts a four-column CSV with no student number column', async () => {
      const upsertMock = vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: [{ id: 'r-1', email: 'new@student.com' }], error: null }),
      }))
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_roster') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
            upsert: upsertMock,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const response = await POST(createRequest({
        csvData: 'First Name,Last Name,Email,Email (2nd)\nNew,Student,new@student.com,secondary@student.com\n',
      }), { params: { id: 'c-1' } })

      expect(response.status).toBe(200)
      expect(upsertMock).toHaveBeenCalledWith([
        expect.objectContaining({
          first_name: 'New',
          last_name: 'Student',
          email: 'new@student.com',
          student_number: null,
          counselor_email: 'secondary@student.com',
        }),
      ], { onConflict: 'classroom_id,email' })
    })

    it('does not request confirmation when a four-column CSV matches an existing row', async () => {
      const existingStudents = [
        {
          id: 'r-1',
          email: 'same@student.com',
          first_name: 'Same',
          last_name: 'Name',
          student_number: null,
          counselor_email: 'secondary@student.com',
        },
      ]
      const upsertMock = vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: [{ id: 'r-1', email: 'same@student.com' }], error: null }),
      }))
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_roster') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({ data: existingStudents, error: null }),
              })),
            })),
            upsert: upsertMock,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const response = await POST(createRequest({
        csvData: 'First Name,Last Name,Email,Email (2nd)\nSame,Name,same@student.com,secondary@student.com\n',
      }), { params: { id: 'c-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.needsConfirmation).toBeUndefined()
      expect(data.success).toBe(true)
      expect(upsertMock).toHaveBeenCalledWith([
        expect.objectContaining({
          student_number: null,
          counselor_email: 'secondary@student.com',
        }),
      ], { onConflict: 'classroom_id,email' })
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
      expect(upsertMock).toHaveBeenCalledWith([
        expect.objectContaining({
          email: 'a@student.com',
          join_source: 'csv',
        }),
      ], { onConflict: 'classroom_id,email' })
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
vi.mock('@/lib/server/classroom-student-removal', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/classroom-student-removal')>(),
  assertStudentsCanBeAddedToRoster: vi.fn(async () => {}),
}))
