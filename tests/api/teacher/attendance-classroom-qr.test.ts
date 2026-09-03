import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const teacherId = '22222222-2222-4222-8222-222222222222'
const presentation = {
  entryPath: `/attendance/classroom/${'a'.repeat(43)}`,
  generation: 2,
  rotatedAt: '2026-09-01T12:00:00.000Z',
}

describe('/api/teacher/attendance/classroom-qr', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_QR_MODE', 'enabled')
    mocks.requireRole.mockResolvedValue({ id: teacherId, role: 'teacher' })
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
    expect(mocks.owns).toHaveBeenCalledWith(teacherId, classroomId, { supabase: mocks.supabase })
    expect(mocks.assertAccess).toHaveBeenCalledWith({
      supabase: mocks.supabase, teacherId, classroomId,
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
      teacherId,
      classroomId,
      expectedGeneration: 2,
    })
  })

  it.each(['disabled', 'canary'])('blocks both issuance and rotation outside rollout scope (%s)', async (mode) => {
    vi.stubEnv('PIKA_CLASSROOM_QR_MODE', mode)
    vi.stubEnv('PIKA_CLASSROOM_QR_CANARY_TEACHER_ID', teacherId)
    vi.stubEnv('PIKA_CLASSROOM_QR_CANARY_CLASSROOM_ID', teacherId)
    const get = await GET(new NextRequest(`https://pika.codepet.ca/api/teacher/attendance/classroom-qr?classroom_id=${classroomId}`))
    const post = await POST(new NextRequest('https://pika.codepet.ca/api/teacher/attendance/classroom-qr', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classroom_id: classroomId, expected_generation: 2 }),
    }))
    expect(get.status).toBe(404)
    expect(post.status).toBe(404)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.rotate).not.toHaveBeenCalled()
  })

  it('admits the exact canary without bypassing ownership or attendance authorization', async () => {
    vi.stubEnv('PIKA_CLASSROOM_QR_MODE', 'canary')
    vi.stubEnv('PIKA_CLASSROOM_QR_CANARY_TEACHER_ID', teacherId)
    vi.stubEnv('PIKA_CLASSROOM_QR_CANARY_CLASSROOM_ID', classroomId)
    const response = await GET(new NextRequest(`https://pika.codepet.ca/api/teacher/attendance/classroom-qr?classroom_id=${classroomId}`))
    expect(response.status).toBe(200)
    expect(mocks.owns).toHaveBeenCalled()
    expect(mocks.assertAccess).toHaveBeenCalled()
  })
})
