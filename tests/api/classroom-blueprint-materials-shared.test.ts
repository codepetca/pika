import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { GET } from '@/app/api/teacher/classrooms/[id]/blueprint-materials/route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), legacy: vi.fn(), shared: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/classroom-blueprint-materials', () => ({ getClassroomBlueprintMaterials: mocks.legacy }))
vi.mock('@/lib/server/contextual-classroom-blueprint-material-read', () => ({ readContextualClassroomBlueprintMaterials: mocks.shared }))
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const classroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const request = new NextRequest(`http://localhost/api/teacher/classrooms/${classroomId}/blueprint-materials`)
const context = () => ({ params: Promise.resolve({ id: classroomId }) })
function pendingParams() {
  const then = vi.fn()
  return { context: { params: { then } as unknown as Promise<{ id: string }> }, then }
}

describe('shared linked Blueprint material GET admission', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    mocks.auth.mockResolvedValue({ id: actorId, role: 'student', email: 'owner@example.test' })
    mocks.role.mockResolvedValue({ id: actorId, role: 'teacher' })
    mocks.legacy.mockResolvedValue({ ok: true, materials: null })
    mocks.shared.mockResolvedValue({ materials: null })
    mocks.client.mockReturnValue({ marker: 'service-client' })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['teacher', 'student'])('admits a global %s owner without requiring the global teacher role', async role => {
    mocks.auth.mockResolvedValue({ id: actorId, role })
    const response = await GET(request, context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ materials: null })
    expect(mocks.shared).toHaveBeenCalledWith({ supabase: { marker: 'service-client' }, actorId, classroomId })
    expect(mocks.role).not.toHaveBeenCalled()
    expect(mocks.legacy).not.toHaveBeenCalled()
  })

  it('authenticates before malformed configuration and unresolved parameters', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    mocks.auth.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    const params = pendingParams()
    expect((await GET(request, params.context)).status).toBe(401)
    expect(params.then).not.toHaveBeenCalled()
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it.each(['', '{', JSON.stringify({ version: 2, admittedUserIds: [actorId] }), JSON.stringify({ version: 1, admittedUserIds: [actorId, actorId] })])('rejects malformed admission before params: %s', async config => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    const params = pendingParams()
    expect((await GET(request, params.context)).status).toBe(503)
    expect(mocks.auth).toHaveBeenCalledOnce()
    expect(params.then).not.toHaveBeenCalled()
    expect(mocks.shared).not.toHaveBeenCalled()
    expect(mocks.legacy).not.toHaveBeenCalled()
  })

  it.each([{ id: 'bad' }, { id: classroomId, actorId: otherId }])('validates strict shared params %j after authentication but before data', async params => {
    expect((await GET(request, { params: Promise.resolve(params) })).status).toBe(400)
    expect(mocks.auth).toHaveBeenCalledOnce()
    expect(mocks.client).not.toHaveBeenCalled()
    expect(mocks.shared).not.toHaveBeenCalled()
  })

  it.each([403, 404, 503])('preserves shared denial %i without an admitted fallback', async status => {
    mocks.shared.mockRejectedValue(new ApiError(status, 'Denied'))
    const response = await GET(request, context())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: 'Denied' })
    expect(mocks.legacy).not.toHaveBeenCalled()
    expect(mocks.role).not.toHaveBeenCalled()
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [otherId] })])('preserves legacy global-teacher requests when admission is absent/unmatched: %s', async config => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    expect((await GET(request, context())).status).toBe(200)
    expect(mocks.role).toHaveBeenCalledWith('teacher')
    expect(mocks.legacy).toHaveBeenCalledWith(actorId, classroomId)
    expect(mocks.shared).not.toHaveBeenCalled()
    expect(mocks.client).not.toHaveBeenCalled()
    if (config === undefined) expect(mocks.auth).not.toHaveBeenCalled()
  })

  it('preserves unmatched wrong-role denial before parameter/data access', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    mocks.role.mockRejectedValue(new ApiError(403, 'Forbidden'))
    const params = pendingParams()
    expect((await GET(request, params.context)).status).toBe(403)
    expect(params.then).not.toHaveBeenCalled()
    expect(mocks.shared).not.toHaveBeenCalled()
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
})
