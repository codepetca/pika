import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { GET as teacherGet } from '@/app/api/teacher/assignments/route'
import { GET as studentGet } from '@/app/api/student/assignments/route'
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
  assertTeacherCanMutateClassroom: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
  getClassroomStudentIds: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const routes = [
  { handler: teacherGet, callerRole: 'student', expectedError: 'Forbidden' },
  { handler: studentGet, callerRole: 'teacher', expectedError: 'Forbidden' },
] as const

describe('classroom assignment route authentication order', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      classroomId,
    }]))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(routes)('authenticates before handling a missing classroom query', async ({ handler }) => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthenticationError())

    const response = await handler(new NextRequest('http://localhost/api/assignments'))

    expect(response.status).toBe(401)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it.each(routes)(
    'preserves the legacy wrong-role denial before missing-query validation',
    async ({ handler, callerRole, expectedError }) => {
      vi.mocked(requireAuth).mockResolvedValue({
        id: actorId,
        email: 'private@example.com',
        role: callerRole,
      } as AuthenticatedUser)

      const response = await handler(new NextRequest('http://localhost/api/assignments'))

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: expectedError })
      expect(getServiceRoleClient).not.toHaveBeenCalled()
      expect(resolveClassroomAccess).not.toHaveBeenCalled()
    },
  )
})
