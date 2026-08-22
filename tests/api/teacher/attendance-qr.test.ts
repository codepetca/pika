import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  owns: vi.fn(),
  load: vi.fn(),
  resolveActor: vi.fn(),
  assertCanary: vi.fn(),
  supabase: {},
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => mocks.supabase }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: mocks.owns }))
vi.mock('@/lib/server/bara-attendance-qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-qr')>()
  return { ...actual, loadTeacherAttendanceQrPresentation: mocks.load }
})
vi.mock('@/lib/server/bara-attendance-teacher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-teacher')>()
  return { ...actual, resolveVerifiedPikaAttendanceTeacher: mocks.resolveActor }
})
vi.mock('@/lib/server/bara-attendance-canary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-canary')>()
  return { ...actual, assertBaraAttendanceCanaryClassroom: mocks.assertCanary }
})

import { GET } from '@/app/api/teacher/attendance/qr/route'
import { TeacherAttendanceQrError } from '@/lib/server/bara-attendance-qr'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'

const classroomId = '11111111-1111-4111-8111-111111111111'
const actor = { workosSubject: 'user_teacher', displayName: 'Teacher One' }

function request() {
  return new NextRequest(
    `https://pika.codepet.ca/api/teacher/attendance/qr?classroom_id=${classroomId}&date=2026-09-02`,
  )
}

describe('GET /api/teacher/attendance/qr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertCanary.mockImplementation(() => undefined)
    mocks.requireRole.mockResolvedValue({
      id: 'teacher-one', email: 'teacher@example.com', role: 'teacher',
    })
    mocks.resolveActor.mockResolvedValue(actor)
    mocks.owns.mockResolvedValue({ ok: true })
    mocks.load.mockResolvedValue({
      entryPath: '/attendance/check-in/23456789ABCDEFGHJKLMNPQRST',
      expiresAt: '2026-09-02T13:20:00.000Z',
      revision: 2,
    })
  })

  it('authorizes the teacher and returns a no-store Pika presentation', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      entryPath: '/attendance/check-in/23456789ABCDEFGHJKLMNPQRST',
      expiresAt: '2026-09-02T13:20:00.000Z',
      revision: 2,
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.owns).toHaveBeenCalledWith('teacher-one', classroomId, {
      supabase: mocks.supabase,
    })
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: 'teacher-one',
      classroomId,
      classDate: '2026-09-02',
      actor,
    }))
    expect(mocks.assertCanary).toHaveBeenCalledWith({
      teacherId: 'teacher-one', classroomId,
    })
  })

  it('stops before identity resolution outside the exact canary', async () => {
    mocks.assertCanary.mockImplementation(() => {
      throw new BaraAttendanceCanaryError('disabled')
    })

    const response = await GET(request())

    expect(response.status).toBe(404)
    expect(mocks.resolveActor).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('does not issue a QR presentation for an archived canary classroom', async () => {
    mocks.owns.mockResolvedValue({
      ok: false, status: 403, error: 'Classroom is archived',
    })

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(mocks.assertCanary).not.toHaveBeenCalled()
    expect(mocks.resolveActor).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('maps a closed session to a bounded conflict without leaking provider detail', async () => {
    mocks.load.mockRejectedValue(new TeacherAttendanceQrError('session_not_open'))
    const response = await GET(request())
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Open attendance before showing the QR code',
    })
  })

  it('turns a missing internal identity link into a teacher-safe recovery message', async () => {
    mocks.load.mockRejectedValue(new TeacherAttendanceQrError('identity_not_linked'))

    const response = await GET(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Attendance setup is still syncing. Try again shortly',
    })
  })
})
