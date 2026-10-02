import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, requireAuth, requireRole } from '@/lib/auth'
import { readContextualLessonPlans } from '@/lib/server/contextual-lesson-plan-read'
import { authorizeClassroomLessonPlanRequest } from '@/lib/server/classroom-lesson-plan-access'
import { getServiceRoleClient } from '@/lib/supabase'
import { GET as teacherGet } from '@/app/api/teacher/classrooms/[id]/lesson-plans/route'
import { GET as studentGet } from '@/app/api/student/classrooms/[id]/lesson-plans/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classroom-lesson-plan-access', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/classroom-lesson-plan-access')>(),
  authorizeClassroomLessonPlanRequest: vi.fn(),
}))
vi.mock('@/lib/server/contextual-lesson-plan-read', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/contextual-lesson-plan-read')>(),
  readContextualLessonPlans: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const user = (role: 'student' | 'teacher') => ({ id: actorId, role, email: 'actor@example.test' } as AuthenticatedUser)
const request = (query = 'start=2026-09-01&end=2026-09-30') => new NextRequest(`http://localhost/api/classrooms/${classroomId}/lesson-plans?${query}`)
const params = { params: Promise.resolve({ id: classroomId }) }
const routes = [
  { handler: teacherGet, role: 'student', permission: 'owner' },
  { handler: studentGet, role: 'teacher', permission: 'member' },
] as const

describe('shared classroom lesson-plan route admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(getServiceRoleClient).mockReturnValue({ from: vi.fn() } as unknown as ReturnType<typeof getServiceRoleClient>)
    vi.mocked(readContextualLessonPlans).mockResolvedValue({ lesson_plans: [] })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(routes)('lets an admitted global $role use the $permission read', async ({ handler, role, permission }) => {
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    const response = await handler(request(), params)
    expect(response.status).toBe(200)
    expect(readContextualLessonPlans).toHaveBeenCalledWith(expect.objectContaining({
      actorId, classroomId, start: '2026-09-01', end: '2026-09-30', permission,
    }))
    expect(authorizeClassroomLessonPlanRequest).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
  })

  it.each(routes)('authenticates $permission before reading deferred route params', async ({ handler }) => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthenticationError())
    const then = vi.fn()
    const response = await handler(request(), { params: { then } as unknown as Promise<{ id: string }> })
    expect(response.status).toBe(401)
    expect(then).not.toHaveBeenCalled()
    expect(readContextualLessonPlans).not.toHaveBeenCalled()
  })

  it.each(routes)('rejects malformed shared admission before reading $permission route params', async ({ handler, role }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    const then = vi.fn()
    const response = await handler(request(), { params: { then } as unknown as Promise<{ id: string }> })
    expect(response.status).toBe(503)
    expect(then).not.toHaveBeenCalled()
    expect(readContextualLessonPlans).not.toHaveBeenCalled()
  })

  it.each(routes)('rejects reversed or unreal $permission dates with 400', async ({ handler, role }) => {
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    for (const query of ['start=2026-09-30&end=2026-09-01', 'start=2026-02-30&end=2026-03-01']) {
      expect((await handler(request(query), params)).status).toBe(400)
    }
    expect(readContextualLessonPlans).not.toHaveBeenCalled()
  })

  it.each(routes)('sends nonadmitted $permission requests through the original helper', async ({ handler, role }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    vi.mocked(authorizeClassroomLessonPlanRequest).mockRejectedValue(new AuthenticationError())
    const response = await handler(request(), params)
    expect(response.status).toBe(401)
    expect(authorizeClassroomLessonPlanRequest).toHaveBeenCalledTimes(1)
    expect(readContextualLessonPlans).not.toHaveBeenCalled()
  })

  it.each(routes)('leaves absent shared admission with the original $permission helper', async ({ handler }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    vi.mocked(authorizeClassroomLessonPlanRequest).mockRejectedValue(new AuthenticationError())
    const response = await handler(request(), params)
    expect(response.status).toBe(401)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(authorizeClassroomLessonPlanRequest).toHaveBeenCalledTimes(1)
  })
})
