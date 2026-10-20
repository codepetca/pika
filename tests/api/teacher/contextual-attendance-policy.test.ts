import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT } from '@/app/api/teacher/attendance/policy/route'
import { ApiError } from '@/lib/api-error'

const { requireAuth, requireRole, load, legacy, owner, mutate, save, scope } = vi.hoisted(() => ({
  requireAuth: vi.fn(), requireRole: vi.fn(), load: vi.fn(), legacy: vi.fn(), owner: vi.fn(), mutate: vi.fn(), save: vi.fn(), scope: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAuth, requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({}) }))
vi.mock('@/lib/server/contextual-attendance-policy', async original => ({ ...await original<typeof import('@/lib/server/contextual-attendance-policy')>(), loadContextualAttendancePolicy: load }))
vi.mock('@/lib/server/bara-attendance-policy', async original => ({ ...await original<typeof import('@/lib/server/bara-attendance-policy')>(), loadTeacherAttendancePolicy: legacy, saveTeacherAttendancePolicy: save }))
vi.mock('@/lib/server/bara-attendance-scope', () => ({ assertBaraAttendanceClassroomAccess: scope }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherOwnsClassroom: owner, assertTeacherCanMutateClassroom: mutate }))
const actorId = '10000000-0000-4000-8000-000000000001'
const classroomId = '20000000-0000-4000-8000-000000000001'
const request = () => new NextRequest(`http://localhost/api/teacher/attendance/policy?classroom_id=${classroomId}`)

describe('attendance policy shared admission GET only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    requireAuth.mockResolvedValue({ id: actorId, role: 'student' })
    requireRole.mockResolvedValue({ id: actorId, role: 'teacher' })
    load.mockResolvedValue(null)
    legacy.mockResolvedValue(null)
    owner.mockResolvedValue({ ok: true, classroom: { archived_at: null } })
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['student', 'teacher'])('admits a %s-valued owner independently of account label', async role => {
    requireAuth.mockResolvedValue({ id: actorId, role })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ policy: null })
    expect(load).toHaveBeenCalledWith({ supabase: {}, actorId, classroomId })
    expect(requireRole).not.toHaveBeenCalled()
    expect(owner).not.toHaveBeenCalled()
    expect(legacy).not.toHaveBeenCalled()
  })
  it('preserves unmatched teacher behavior', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{"version":1,"admittedUserIds":[]}')
    expect((await GET(request())).status).toBe(200)
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled()
  })
  it('preserves absent admission legacy authentication before query parsing', async () => {
    delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    requireRole.mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await GET(new NextRequest('http://localhost/api/teacher/attendance/policy'))).status).toBe(403)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })
  it.each([403, 404, 503])('never falls back after an admitted %i failure', async status => {
    load.mockRejectedValue(new ApiError(status, 'Unavailable'))
    expect((await GET(request())).status).toBe(status)
    expect(legacy).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
  })
  it('fails closed for malformed admission', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad')
    expect((await GET(request())).status).toBe(503)
    expect(load).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
  })
  it('retains PUT global teacher authentication even for admitted actors', async () => {
    requireRole.mockRejectedValue(new ApiError(403, 'Forbidden'))
    const response = await PUT(new NextRequest('http://localhost/api/teacher/attendance/policy', { method: 'PUT', body: '{}' }))
    expect(response.status).toBe(403)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})
