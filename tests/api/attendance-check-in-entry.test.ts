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

const user = { id: 'student-one', email: 'student@example.com', role: 'student' }
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
      attendanceStatus: 'present',
    })
  })

  it('derives the actor from the verified student session and accepts no client identity', async () => {
    const response = await POST(request({ entryToken, attemptId }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ state: 'checked_in' })
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
