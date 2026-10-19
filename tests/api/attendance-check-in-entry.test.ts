import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getServiceRoleClient: vi.fn(() => ({ kind: 'service-role' })),
  execute: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.getServiceRoleClient }))
vi.mock('@/lib/server/bara-attendance-student', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/bara-attendance-student')>(
    '@/lib/server/bara-attendance-student',
  )
  return { ...actual, executeStudentAttendanceCheckIn: mocks.execute }
})

import { POST } from '@/app/api/student/attendance/check-in/route'

const user = { id: '30000000-0000-4000-8000-000000000001', email: 'student@example.com', role: 'student' }
const entryToken = 'A'.repeat(100)
const attemptId = '11111111-1111-4111-8111-111111111111'

function request(body: unknown) {
  return new NextRequest('https://pika.codepet.ca/api/student/attendance/check-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/student/attendance/check-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue(user)
    mocks.execute.mockResolvedValue({
      state: 'checked_in',
      title: 'You are checked in',
      description: 'Your attendance was recorded.',
      classroomName: 'PPZ3C — Health for Life',
      studentId: user.id, classroomId: '20000000-0000-4000-8000-000000000001',
      attendanceStatus: 'present', recordedAt: '2026-09-02T13:01:00.000Z',
      occurrenceBinding: 'a'.repeat(32), classDate: '2026-09-02',
      serverNow: '2026-09-02T13:02:00.000Z', validUntil: '2026-09-03T04:00:00.000Z',
    })
  })

  it('derives the actor from the verified student session and accepts no client identity', async () => {
    const response = await POST(request({ entryToken, attemptId }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ state: 'checked_in', classroomName: 'PPZ3C — Health for Life' })
    expect(mocks.requireRole).toHaveBeenCalledWith('student')
    expect(mocks.execute).toHaveBeenCalledWith({
      supabase: { kind: 'service-role' },
      pikaUser: user,
      entryToken,
      attemptId,
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects client-supplied identity fields before calling Bara', async () => {
    const response = await POST(request({
      entryToken,
      attemptId,
      actorWorkosSubject: 'user_attacker',
    }))
    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
