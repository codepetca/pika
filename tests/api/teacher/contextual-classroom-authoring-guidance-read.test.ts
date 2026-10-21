import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { GET } from '@/app/api/teacher/classrooms/[id]/authoring-guidance/route'

const { admission, role, read, legacy } = vi.hoisted(() => ({ admission: vi.fn(), role: vi.fn(), read: vi.fn(), legacy: vi.fn() }))
vi.mock('@/lib/server/contextual-classroom-metadata', () => ({ authorizeSharedClassroomMetadataActor: admission }))
vi.mock('@/lib/auth', () => ({ requireRole: role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({}) }))
vi.mock('@/lib/server/contextual-classroom-authoring-guidance-read', () => ({ readContextualClassroomAuthoringGuidance: read }))
vi.mock('@/lib/server/classroom-authoring-guidance', () => ({ getClassroomAuthoringGuidance: legacy }))
const actor = '10000000-0000-4000-8000-000000000001', id = '20000000-0000-4000-8000-000000000001'
const run = (params: unknown = { id }) => GET(new NextRequest(`http://localhost/api/teacher/classrooms/${id}/authoring-guidance`), { params: Promise.resolve(params) } as never)
describe('contextual frozen authoring guidance GET admission', () => {
  beforeEach(() => { vi.clearAllMocks(); admission.mockResolvedValue({ mode: 'shared', user: { id: actor, role: 'student' } }); role.mockResolvedValue({ id: actor, role: 'teacher' }); read.mockResolvedValue({ context: null }); legacy.mockResolvedValue({ ok: true, context: null }) })
  it.each(['teacher', 'student'])('uses current ownership for admitted%s-valued accounts', async label => {
    admission.mockResolvedValue({ mode: 'shared', user: { id: actor, role: label } }); const response = await run()
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ context: null })
    expect(read).toHaveBeenCalledExactlyOnceWith({ supabase: {}, actorId: actor, classroomId: id }); expect(role).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled()
  })
  it('preserves the unmatched/absent admission legacy role guard and helper result', async () => {
    admission.mockResolvedValue({ mode: 'legacy' }); legacy.mockResolvedValue({ ok: false, status: 404, error: 'Classroom not found' })
    const response = await run({ id: 'legacy-id' }); expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'Classroom not found' })
    expect(role).toHaveBeenCalledWith('teacher'); expect(legacy).toHaveBeenCalledExactlyOnceWith(actor, 'legacy-id'); expect(read).not.toHaveBeenCalled()
  })
  it('denies unmatched student-valued users through the unchanged teacher role guard', async () => {
    admission.mockResolvedValue({ mode: 'legacy' }); role.mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await run()).status).toBe(403); expect(role).toHaveBeenCalledWith('teacher'); expect(legacy).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled()
  })
  it.each([401, 503])('fails auth/configuration%i before params or legacy work', async status => {
    admission.mockRejectedValue(new ApiError(status, 'Unavailable')); const accessed = vi.fn()
    const response = await GET(new NextRequest('http://localhost'), { params: { then: accessed } } as never)
    expect(response.status).toBe(status); expect(accessed).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(role).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled()
  })
  it.each([{ id: 'bad' }, { id, actor_id: actor }, {}])('validates strict named params%#', async params => {
    expect((await run(params)).status).toBe(400); expect(read).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled()
  })
  it.each([400, 403, 404, 503])('preserves authoritative%i without legacy fallback', async status => {
    read.mockRejectedValue(new ApiError(status, 'Unavailable')); expect((await run()).status).toBe(status); expect(legacy).not.toHaveBeenCalled(); expect(role).not.toHaveBeenCalled()
  })
})
