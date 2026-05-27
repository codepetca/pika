/**
 * API tests for GET /api/teacher/entry/[id]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/entry/[id]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

function mockEntryQuery(result: { data: any; error: any }) {
  const single = vi.fn().mockResolvedValue(result)
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  ;(mockSupabaseClient.from as any) = from
  return { from, select, eq, single }
}

describe('GET /api/teacher/entry/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns an owned entry without leaking classroom ownership metadata', async () => {
    const query = mockEntryQuery({
      data: {
        id: 'entry-1',
        classroom_id: 'classroom-1',
        student_id: 'student-1',
        text: 'Daily work',
        student: { email: 'student@example.com' },
        classroom: { teacher_id: 'teacher-1' },
      },
      error: null,
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/entry/entry-1')
    const response = await GET(request, { params: { id: 'entry-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('classroom:classrooms!inner(teacher_id)'))
    expect(data.entry).toEqual({
      id: 'entry-1',
      classroom_id: 'classroom-1',
      student_id: 'student-1',
      text: 'Daily work',
      student: { email: 'student@example.com' },
    })
  })

  it('returns 403 when the entry belongs to another teacher classroom', async () => {
    mockEntryQuery({
      data: {
        id: 'entry-1',
        classroom_id: 'classroom-2',
        student_id: 'student-1',
        text: 'Other class work',
        student: { email: 'student@example.com' },
        classroom: { teacher_id: 'teacher-2' },
      },
      error: null,
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/entry/entry-1')
    const response = await GET(request, { params: { id: 'entry-1' } })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Forbidden')
  })

  it('should return 404 when entry does not exist', async () => {
    mockEntryQuery({ data: null, error: { code: 'PGRST116' } })

    const request = new NextRequest('http://localhost:3000/api/teacher/entry/entry-999')
    const response = await GET(request, { params: { id: 'entry-999' } })
    expect(response.status).toBe(404)
  })
})
