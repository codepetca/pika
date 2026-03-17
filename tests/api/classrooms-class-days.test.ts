import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  GET,
  PATCH,
  POST,
} from '@/app/api/classrooms/[classroomId]/class-days/route'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: vi.fn(() => '2026-03-16'),
}))

vi.mock('@/lib/server/class-days', () => ({
  fetchClassDaysForClassroom: vi.fn(async () => ({ classDays: [{ date: '2026-03-17' }], error: null })),
  generateClassDaysForClassroom: vi.fn(async () => ({
    ok: true,
    count: 2,
    classDays: [{ date: '2026-03-17' }, { date: '2026-03-18' }],
  })),
  upsertClassDayForClassroom: vi.fn(async () => ({
    ok: true,
    classDay: { classroom_id: 'classroom-1', date: '2026-03-17', is_class_day: true },
  })),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
  })),
  assertTeacherCanMutateClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
  })),
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', archived_at: null },
  })),
}))

describe('classroom class-days route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns class days for an enrolled student', async () => {
    const { requireAuth } = await import('@/lib/auth')
    ;(requireAuth as any).mockResolvedValueOnce({ id: 'student-1', role: 'student' })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/classrooms/classroom-1/class-days'),
      { params: Promise.resolve({ classroomId: 'classroom-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.class_days).toEqual([{ date: '2026-03-17' }])
  })

  it('generates initial class days for teachers', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/classrooms/classroom-1/class-days', {
        method: 'POST',
        body: JSON.stringify({ semester: 'semester2', year: 2026 }),
      }),
      { params: Promise.resolve({ classroomId: 'classroom-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.count).toBe(2)
  })

  it('rejects patching past class days', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/classrooms/classroom-1/class-days', {
        method: 'PATCH',
        body: JSON.stringify({ date: '2026-03-15', is_class_day: true }),
      }),
      { params: Promise.resolve({ classroomId: 'classroom-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot modify past class days')
  })

  it('updates a future class day', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/classrooms/classroom-1/class-days', {
        method: 'PATCH',
        body: JSON.stringify({ date: '2026-03-17', is_class_day: true }),
      }),
      { params: Promise.resolve({ classroomId: 'classroom-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.class_day.date).toBe('2026-03-17')
  })
})
