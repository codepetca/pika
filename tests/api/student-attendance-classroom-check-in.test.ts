import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  execute: vi.fn(),
  supabase: {},
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => mocks.supabase }))
vi.mock('@/lib/server/classroom-attendance-qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-attendance-qr')>()
  return { ...actual, executeClassroomQrStudentCheckIn: mocks.execute }
})

import { POST } from '@/app/api/student/attendance/classroom-check-in/route'
import { ClassroomAttendanceQrError } from '@/lib/server/classroom-attendance-qr'

const user = { id: 'student-1', email: 'student@example.com', role: 'student' }
const classroomQrToken = 'a'.repeat(43)
const attemptId = '11111111-1111-4111-8111-111111111111'

function request(body: unknown) {
  return new NextRequest('https://pika.codepet.ca/api/student/attendance/classroom-check-in', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('POST /api/student/attendance/classroom-check-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue(user)
    mocks.execute.mockResolvedValue({
      state: 'checked_in', title: 'You are checked in', description: 'Recorded',
    })
  })

  it('derives identity only from the authenticated student session', async () => {
    const response = await POST(request({ classroomQrToken, attemptId }))
    expect(response.status).toBe(200)
    expect(mocks.requireRole).toHaveBeenCalledWith('student')
    expect(mocks.execute).toHaveBeenCalledWith({
      supabase: mocks.supabase, pikaUser: user, classroomQrToken, attemptId,
    })
  })

  it.each([
    ['invalid_or_revoked', 'invalid', 'This classroom QR is no longer valid'],
    ['not_open', 'closed', 'Attendance is not open'],
    ['not_enrolled', 'needs_staff', 'Your teacher needs to help'],
  ] as const)('maps %s without leaking classroom or Bara identifiers', async (code, state, title) => {
    mocks.execute.mockRejectedValue(new ClassroomAttendanceQrError(code))
    const response = await POST(request({ classroomQrToken, attemptId }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ state, title })
    expect(JSON.stringify(body)).not.toMatch(/11111111|roster_|occurrence_|check.in.token/i)
  })

  it('rejects client-supplied classroom or student identity fields', async () => {
    const response = await POST(request({
      classroomQrToken, attemptId, classroomId: 'attacker-choice', studentId: 'attacker-choice',
    }))
    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
