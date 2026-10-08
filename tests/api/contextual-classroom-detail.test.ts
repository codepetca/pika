import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import * as admission from '@/lib/server/classroom-experience-admission'
import { GET as ownerGet, PATCH } from '@/app/api/teacher/classrooms/[id]/route'
import { GET as memberGet } from '@/app/api/student/classrooms/[id]/route'
import { actorId, classroomId, otherId, classroom, membership, preflight, detailFixture } from '../helpers/contextual-classroom-detail'

vi.mock('@/lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
const request = () => new NextRequest(`http://localhost/api/classrooms/${classroomId}`)
const params = () => ({ params: Promise.resolve({ id: classroomId }) })
const resolveAdmission = vi.spyOn(admission, 'resolveClassroomExperienceAdmission')

describe('shared classroom detail GET admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'false')
    vi.stubEnv('PIKA_ACCESS_SHADOW_ENABLED', 'false')
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: 'actor@example.test', role: 'student' })
    vi.mocked(requireRole).mockImplementation(async role => {
      const actor = await requireAuth()
      if (actor.role !== role) throw Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' })
      return actor
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['teacher', 'student'] as const)('admits %s-valued owners without a role check', async role => {
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: 'actor@example.test', role })
    const f = detailFixture([preflight(), classroom])
    vi.mocked(getServiceRoleClient).mockReturnValue(f.supabase)
    const response = await ownerGet(request(), params())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ classroom: { id: classroomId, authoring_guidance_version_id: otherId } })
    expect(requireAuth).toHaveBeenCalledTimes(1)
    expect(resolveAdmission).toHaveBeenCalledTimes(1)
    expect(requireRole).not.toHaveBeenCalled()
  })

  it.each(['teacher', 'student'] as const)('admits %s-valued members with the existing private projection', async role => {
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: 'actor@example.test', role })
    const f = detailFixture([{ ...preflight(), teacher_id: otherId }, { ...classroom, teacher_id: otherId, membership: [membership] }])
    vi.mocked(getServiceRoleClient).mockReturnValue(f.supabase)
    const response = await memberGet(request(), params())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.classroom).toMatchObject({ id: classroomId, course_overview_markdown: '', course_outline_markdown: '' })
    expect(body.classroom).not.toHaveProperty('authoring_guidance_version_id')
    expect(body.classroom).not.toHaveProperty('membership')
    expect(requireAuth).toHaveBeenCalledTimes(1)
    expect(resolveAdmission).toHaveBeenCalledTimes(1)
    expect(requireRole).not.toHaveBeenCalled()
  })

  it.each([ownerGet, memberGet])('authenticates before touching params or malformed configuration', async handler => {
    const readParams = vi.fn(() => ({ id: 'bad' }))
    const deferredParams = { then: (resolve: (value: { id: string }) => unknown) => resolve(readParams()) }
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad')
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
    const response = await handler(request(), { params: deferredParams as unknown as Promise<Record<string, string>> })
    expect(response.status).toBe(401)
    expect(readParams).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each([ownerGet, memberGet])('fails closed for malformed admission before params', async handler => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad')
    const readParams = vi.fn(() => ({ id: 'bad' }))
    const deferredParams = { then: (resolve: (value: { id: string }) => unknown) => resolve(readParams()) }
    const response = await handler(request(), { params: deferredParams as unknown as Promise<Record<string, string>> })
    expect(response.status).toBe(503)
    expect(readParams).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each([ownerGet, memberGet])('validates admitted params before data access', async handler => {
    const response = await handler(request(), { params: Promise.resolve({ id: classroomId.replaceAll('-', '') }) })
    expect(response.status).toBe(400)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('retains unmatched/absent legacy guards and literal owner payload %#', async configuration => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', configuration)
    const forbidden = await ownerGet(request(), params())
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({ error: 'Forbidden' })
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: 'actor@example.test', role: 'teacher' })
    const f = detailFixture([classroom])
    vi.mocked(getServiceRoleClient).mockReturnValue(f.supabase)
    expect((await ownerGet(request(), params())).status).toBe(200)
    expect(f.urls[0].searchParams.get('select')).toBe('*')
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('retains pair-pilot mixed-role ownership %#', async configuration => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', configuration)
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', JSON.stringify([{ userId: actorId, classroomId }]))
    const f = detailFixture([classroom])
    vi.mocked(getServiceRoleClient).mockReturnValue(f.supabase)
    expect((await ownerGet(request(), params())).status).toBe(200)
    expect(f.urls).toHaveLength(1)
    expect(f.urls[0].searchParams.get('select')).toBe('*')
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('retains literal member fallback hydration and raw markdown %#', async configuration => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', configuration)
    const joined = { ...classroom, teacher_id: otherId }
    const f = detailFixture([joined, { id: otherId }, joined])
    vi.mocked(getServiceRoleClient).mockReturnValue(f.supabase)
    const response = await memberGet(request(), params())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.classroom).toMatchObject({ course_overview_markdown: classroom.course_overview_markdown, course_outline_markdown: classroom.course_outline_markdown })
    expect(body.classroom).not.toHaveProperty('authoring_guidance_version_id')
    expect(f.urls).toHaveLength(3)
    expect(f.urls[0].searchParams.get('select')).toBe('*')
    expect(f.urls[2].searchParams.get('select')).toBe('*')
    expect(resolveAdmission).toHaveBeenCalledTimes(configuration === undefined ? 0 : 1)
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('retains pair-pilot mixed-role members %#', async configuration => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', configuration)
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', JSON.stringify([{ userId: actorId, classroomId }]))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: 'actor@example.test', role: 'teacher' })
    const f = detailFixture([{ ...classroom, teacher_id: otherId }, membership])
    vi.mocked(getServiceRoleClient).mockReturnValue(f.supabase)
    const response = await memberGet(request(), params())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ classroom: { course_overview_markdown: '', course_outline_markdown: '' } })
    expect(f.urls).toHaveLength(2)
    expect(f.urls[0].searchParams.get('select')).toBe('*')
    expect(f.urls[1].pathname).toBe('/rest/v1/classroom_enrollments')
  })

  it('keeps absent-admission PATCH on the original teacher guard', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    const response = await PATCH(new NextRequest(`http://localhost/api/classrooms/${classroomId}`, { method: 'PATCH', body: JSON.stringify({ title: 'Changed' }) }), params())
    expect(response.status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(resolveAdmission).not.toHaveBeenCalled()
  })

  it('rejects malformed shared metadata admission before body validation', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad')
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: 'actor@example.test', role: 'teacher' })
    const response = await PATCH(new NextRequest(`http://localhost/api/classrooms/${classroomId}`, { method: 'PATCH', body: '{}' }), params())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Classroom experience admission configuration is unavailable' })
    expect(resolveAdmission).toHaveBeenCalledTimes(1)
    expect(requireAuth).toHaveBeenCalledTimes(1)
    expect(requireRole).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
})
