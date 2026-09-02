import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  owns: vi.fn(),
  assertAccess: vi.fn(),
  load: vi.fn(),
  rotate: vi.fn(),
  supabase: {},
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => mocks.supabase }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: mocks.owns }))
vi.mock('@/lib/server/bara-attendance-scope', () => ({
  assertBaraAttendanceClassroomAccess: mocks.assertAccess,
}))
vi.mock('@/lib/server/classroom-attendance-qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-attendance-qr')>()
  return {
    ...actual,
    loadTeacherClassroomQrPresentation: mocks.load,
    rotateTeacherClassroomQrPresentation: mocks.rotate,
  }
})

import { GET, POST } from '@/app/api/teacher/attendance/classroom-qr/route'

const classroomId = '11111111-1111-4111-8111-111111111111'
const presentation = {
  entryPath: `/attendance/classroom/${'a'.repeat(43)}`,
  generation: 2,
  rotatedAt: '2026-09-01T12:00:00.000Z',
}

describe('/api/teacher/attendance/classroom-qr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue({ id: 'teacher-1', role: 'teacher' })
    mocks.owns.mockResolvedValue({ ok: true })
    mocks.assertAccess.mockResolvedValue({ state: 'ready' })
    mocks.load.mockResolvedValue(presentation)
    mocks.rotate.mockResolvedValue({ ...presentation, generation: 3 })
  })

  it('authorizes ownership and attendance scope before returning the stable poster', async () => {
    const response = await GET(new NextRequest(
      `https://pika.codepet.ca/api/teacher/attendance/classroom-qr?classroom_id=${classroomId}`,
    ))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(presentation)
    expect(mocks.owns).toHaveBeenCalledWith('teacher-1', classroomId, { supabase: mocks.supabase })
    expect(mocks.assertAccess).toHaveBeenCalledWith({
      supabase: mocks.supabase, teacherId: 'teacher-1', classroomId,
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('does not reveal or rotate another teacher classroom', async () => {
    mocks.owns.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const response = await POST(new NextRequest(
      'https://pika.codepet.ca/api/teacher/attendance/classroom-qr',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroom_id: classroomId, expected_generation: 2 }),
      },
    ))
    expect(response.status).toBe(403)
    expect(mocks.assertAccess).not.toHaveBeenCalled()
    expect(mocks.rotate).not.toHaveBeenCalled()
  })

  it('rotates with stale-write protection', async () => {
    const response = await POST(new NextRequest(
      'https://pika.codepet.ca/api/teacher/attendance/classroom-qr',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroom_id: classroomId, expected_generation: 2 }),
      },
    ))
    expect(response.status).toBe(200)
    expect(mocks.rotate).toHaveBeenCalledWith({
      supabase: mocks.supabase,
      classroomId,
      expectedGeneration: 2,
    })
  })
})
