import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { GET as teacherGet } from '@/app/api/teacher/classrooms/[id]/announcements/route'
import { GET as studentGet } from '@/app/api/student/classrooms/[id]/announcements/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccess: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const request = new NextRequest('http://localhost/api/classrooms/invalid/announcements')
const routes = [
  { name: 'teacher', handler: teacherGet, expectedRole: 'teacher', callerRole: 'student' },
  { name: 'student', handler: studentGet, expectedRole: 'student', callerRole: 'teacher' },
] as const

function deferredParams(id: string) {
  const then = vi.fn((resolve: (value: { id: string }) => unknown) => (
    Promise.resolve(resolve({ id }))
  ))
  return {
    context: { params: { then } as unknown as Promise<{ id: string }> },
    then,
  }
}

describe('classroom announcement route authentication order', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      classroomId,
    }]))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(routes)('does not resolve $name route params before rejected authentication', async ({ handler }) => {
    const params = deferredParams('invalid')
    vi.mocked(requireAuth).mockRejectedValue(new AuthenticationError())

    const response = await handler(request, params.context)

    expect(response.status).toBe(401)
    expect(params.then).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each(routes)(
    'preserves the legacy $expectedRole-role 403 for a wrong-role malformed $name request',
    async ({ handler, callerRole }) => {
      const params = deferredParams('invalid')
      vi.mocked(requireAuth).mockResolvedValue({
        id: actorId,
        email: 'private@example.com',
        role: callerRole,
      } as AuthenticatedUser)

      const response = await handler(request, params.context)

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Forbidden' })
      expect(params.then).toHaveBeenCalledTimes(1)
      expect(resolveClassroomAccess).not.toHaveBeenCalled()
      expect(getServiceRoleClient).not.toHaveBeenCalled()
    }
  )
})
