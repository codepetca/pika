import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, requireAuth, requireRole } from '@/lib/auth'
import { ApiError } from '@/lib/api-error'
import { readContextualAnnouncements } from '@/lib/server/contextual-announcement-read'
import { authorizeClassroomAnnouncementRequest } from '@/lib/server/classroom-announcement-access'
import { getServiceRoleClient } from '@/lib/supabase'
import { GET as teacherGet } from '@/app/api/teacher/classrooms/[id]/announcements/route'
import { GET as studentGet } from '@/app/api/student/classrooms/[id]/announcements/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classroom-announcement-access', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/server/classroom-announcement-access')>(), authorizeClassroomAnnouncementRequest: vi.fn() }))
vi.mock('@/lib/server/contextual-announcement-read', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/server/contextual-announcement-read')>(), readContextualAnnouncements: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const request = () => new NextRequest(`http://localhost/api/classrooms/${classroomId}/announcements`)
const params = { params: Promise.resolve({ id: classroomId }) }
const user = (role: 'student' | 'teacher') => ({ id: actorId, role, email: 'actor@example.test' } as AuthenticatedUser)
const routes = [
  { handler: teacherGet, role: 'student', permission: 'owner' },
  { handler: studentGet, role: 'teacher', permission: 'member' },
] as const

describe('shared announcement GET admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(getServiceRoleClient).mockReturnValue({ from: vi.fn() } as unknown as ReturnType<typeof getServiceRoleClient>)
    vi.mocked(readContextualAnnouncements).mockResolvedValue({ announcements: [] })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(routes)('allows admitted global $role on the $permission GET', async ({ handler, role, permission }) => {
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    const response = await handler(request(), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ announcements: [] })
    expect(readContextualAnnouncements).toHaveBeenCalledWith(expect.objectContaining({ actorId, classroomId, permission }))
    expect(authorizeClassroomAnnouncementRequest).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
  })

  it.each(routes)('authenticates before deferred params for $permission', async ({ handler }) => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthenticationError())
    const then = vi.fn()
    expect((await handler(request(), { params: { then } as unknown as Promise<{ id: string }> })).status).toBe(401)
    expect(then).not.toHaveBeenCalled()
    expect(readContextualAnnouncements).not.toHaveBeenCalled()
  })

  it.each(routes)('fails malformed configuration before $permission params', async ({ handler, role }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    const then = vi.fn()
    expect((await handler(request(), { params: { then } as unknown as Promise<{ id: string }> })).status).toBe(503)
    expect(then).not.toHaveBeenCalled()
    expect(authorizeClassroomAnnouncementRequest).not.toHaveBeenCalled()
  })

  it.each(routes)('rejects invalid $permission IDs after authentication', async ({ handler, role }) => {
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    expect((await handler(request(), { params: Promise.resolve({ id: 'bad' }) })).status).toBe(400)
    expect(readContextualAnnouncements).not.toHaveBeenCalled()
  })

  it.each(routes)('retains helper errors for $permission', async ({ handler, role }) => {
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    vi.mocked(readContextualAnnouncements).mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await handler(request(), params)).status).toBe(403)
  })

  it.each(routes)('retains nonadmitted existing helper for $permission', async ({ handler, role }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    vi.mocked(authorizeClassroomAnnouncementRequest).mockRejectedValue(new AuthenticationError())
    expect((await handler(request(), params)).status).toBe(401)
    expect(authorizeClassroomAnnouncementRequest).toHaveBeenCalledTimes(1)
    expect(readContextualAnnouncements).not.toHaveBeenCalled()
  })

  it.each(routes)('retains absent-config existing helper for $permission', async ({ handler }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    vi.mocked(authorizeClassroomAnnouncementRequest).mockRejectedValue(new AuthenticationError())
    expect((await handler(request(), params)).status).toBe(401)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(authorizeClassroomAnnouncementRequest).toHaveBeenCalledTimes(1)
  })
})
