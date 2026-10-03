import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { AuthenticationError, requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeClassroomAssignmentRequest } from '@/lib/server/classroom-assignment-access'
import { readContextualAssignmentList } from '@/lib/server/contextual-assignment-list-read'
import { GET as teacherGet } from '@/app/api/teacher/assignments/route'
import { GET as studentGet } from '@/app/api/student/assignments/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn(), AuthenticationError: class AuthenticationError extends Error { name = 'AuthenticationError' } }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classroom-assignment-access', async original => ({
  ...await original<typeof import('@/lib/server/classroom-assignment-access')>(), authorizeClassroomAssignmentRequest: vi.fn(),
}))
vi.mock('@/lib/server/contextual-assignment-list-read', async original => ({
  ...await original<typeof import('@/lib/server/contextual-assignment-list-read')>(), readContextualAssignmentList: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const user = (role: 'student' | 'teacher') => ({ id: actorId, role } as AuthenticatedUser)
const request = () => new NextRequest(`http://localhost/api/assignments?classroom_id=${classroomId}`)
const routes = [{ get: teacherGet, permission: 'owner' }, { get: studentGet, permission: 'member' }] as const
const admission = (ids = [actorId]) => JSON.stringify({ version: 1, admittedUserIds: ids })

describe('assignment list shared admission and existing exact-pair routing', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs()
    vi.mocked(getServiceRoleClient).mockReturnValue({ from: vi.fn() } as any)
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    vi.mocked(readContextualAssignmentList).mockResolvedValue({ assignments: [{ id: 'result' }] })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(routes)('uses the bound $permission list reader for both role labels in the admitted cohort', async ({ get, permission }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', admission())
    for (const role of ['student', 'teacher'] as const) {
      vi.mocked(requireAuth).mockResolvedValue(user(role))
      const response = await get(request())
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ assignments: [{ id: 'result' }] })
      expect(readContextualAssignmentList).toHaveBeenLastCalledWith({ supabase: getServiceRoleClient(), actorId, classroomId, permission })
    }
    expect(authorizeClassroomAssignmentRequest).not.toHaveBeenCalled()
  })
  it.each(routes)('retains the old pair decision when shared admission is absent or does not admit the actor ($permission)', async ({ get, permission }) => {
    vi.mocked(authorizeClassroomAssignmentRequest).mockResolvedValue({ mode: 'contextual', user: user('teacher'), context: {} } as any)
    for (const config of [undefined, admission([]), admission(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])]) {
      if (config !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
      expect((await get(request())).status).toBe(200)
      expect(authorizeClassroomAssignmentRequest).toHaveBeenLastCalledWith(expect.any(Function), { legacyRole: permission === 'owner' ? 'teacher' : 'student', permission })
      expect(readContextualAssignmentList).toHaveBeenLastCalledWith(expect.objectContaining({ actorId, classroomId, permission }))
    }
  })
  it.each(routes)('authenticates before malformed configuration and request discovery ($permission)', async ({ get }) => {
    for (const config of ['', '{}', 'null', '{', admission([actorId, actorId]), JSON.stringify({ version: 2, admittedUserIds: [actorId] }), 'x'.repeat(20001)]) {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
      const url = vi.fn(() => { throw new Error('request discovery occurred') })
      const req = { get url() { return url() } } as unknown as NextRequest
      expect((await get(req)).status).toBe(503)
      expect(url).not.toHaveBeenCalled()
    }
    expect(requireAuth).toHaveBeenCalledTimes(7)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(authorizeClassroomAssignmentRequest).not.toHaveBeenCalled()
    expect(readContextualAssignmentList).not.toHaveBeenCalled()
  })
  it.each(routes)('keeps authentication and bound-reader denials fail closed ($permission)', async ({ get }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', admission())
    vi.mocked(requireAuth).mockRejectedValueOnce(new AuthenticationError('Unauthorized'))
    expect((await get(request())).status).toBe(401)
    expect(readContextualAssignmentList).not.toHaveBeenCalled()
    for (const statusCode of [403, 404, 503]) {
      vi.mocked(readContextualAssignmentList).mockRejectedValueOnce(new ApiError(statusCode, 'Denied'))
      expect((await get(request())).status).toBe(statusCode)
    }
    expect(authorizeClassroomAssignmentRequest).not.toHaveBeenCalled()
  })
  it.each(routes)('validates contextual query UUIDs after authentication ($permission)', async ({ get }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', admission())
    expect((await get(new NextRequest('http://localhost/api/assignments?classroom_id=invalid'))).status).toBe(400)
    expect((await get(new NextRequest('http://localhost/api/assignments'))).status).toBe(400)
    expect(requireAuth).toHaveBeenCalledTimes(2)
    expect(readContextualAssignmentList).not.toHaveBeenCalled()
  })
})
