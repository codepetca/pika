import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { GET, POST } from '@/app/api/teacher/classrooms/[id]/authoring-guidance/update/route'

const { admission, role, read, legacy, adopt } = vi.hoisted(() => ({ admission: vi.fn(), role: vi.fn(), read: vi.fn(), legacy: vi.fn(), adopt: vi.fn() }))
vi.mock('@/lib/server/contextual-classroom-metadata', () => ({ authorizeSharedClassroomMetadataActor: admission }))
vi.mock('@/lib/auth', () => ({ requireRole: role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({}) }))
vi.mock('@/lib/server/contextual-classroom-guidance-preview', () => ({ readContextualClassroomGuidancePreview: read }))
vi.mock('@/lib/server/classroom-guidance-adoption', () => ({ previewClassroomGuidanceAdoption: legacy, adoptClassroomGuidance: adopt }))
const actor = '10000000-0000-4000-8000-000000000001', id = '20000000-0000-4000-8000-000000000001'
const run = (params: unknown = { id }) => GET(new NextRequest(`http://localhost/api/teacher/classrooms/${id}/authoring-guidance/update`), { params: Promise.resolve(params) } as never)
describe('contextual guidance preview GET admission and legacy POST separation', () => {
  beforeEach(() => { vi.clearAllMocks(); admission.mockResolvedValue({ mode: 'shared', user: { id: actor, role: 'student' } }); role.mockResolvedValue({ id: actor, role: 'teacher' }); read.mockResolvedValue({ preview: { changed: false } }); legacy.mockResolvedValue({ ok: true, preview: { changed: false } }); adopt.mockResolvedValue({ ok: true, version: 3 }) })
  it.each(['teacher', 'student'])('uses the admitted%s account without substituting legacy authority', async label => {
    admission.mockResolvedValue({ mode: 'shared', user: { id: actor, role: label } }); const response = await run()
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ preview: { changed: false } })
    expect(read).toHaveBeenCalledExactlyOnceWith({ supabase: {}, actorId: actor, classroomId: id }); expect(role).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled()
  })
  it('preserves unmatched/absent legacy params, role, helper and status', async () => {
    admission.mockResolvedValue({ mode: 'legacy' }); legacy.mockResolvedValue({ ok: false, status: 409, error: 'No Blueprint Version linked' })
    const response = await run({ id: 'legacy-id' }); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'No Blueprint Version linked' })
    expect(role).toHaveBeenCalledWith('teacher'); expect(legacy).toHaveBeenCalledExactlyOnceWith(actor, 'legacy-id'); expect(read).not.toHaveBeenCalled()
  })
  it('denies unmatched students through the old role guard', async () => {
    admission.mockResolvedValue({ mode: 'legacy' }); role.mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await run()).status).toBe(403); expect(legacy).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled()
  })
  it.each([401, 503])('fails auth/configuration%i before private params and work', async status => {
    admission.mockRejectedValue(new ApiError(status, 'Unavailable')); const accessed = vi.fn()
    expect((await GET(new NextRequest('http://localhost'), { params: { then: accessed } } as never)).status).toBe(status)
    expect(accessed).not.toHaveBeenCalled(); expect(role).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled()
  })
  it.each([{ id: 'bad' }, { id, actor_id: actor }, {}])('validates named strict params%#', async params => {
    expect((await run(params)).status).toBe(400); expect(read).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled()
  })
  it.each([400, 403, 404, 409, 503])('retains authoritative%i without fallback', async status => {
    read.mockRejectedValue(new ApiError(status, 'Unavailable')); expect((await run()).status).toBe(status); expect(role).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled()
  })
  it('keeps unmatched adoption POST on the legacy helper, not the preview reader', async () => {
    admission.mockResolvedValue({ mode: 'legacy' }); const input = { blueprint_id: id, expected_content_version_id: id, expected_guidance_version_id: id, expected_draft_revision: 4 }
    const response = await POST(new NextRequest(`http://localhost/api/teacher/classrooms/${id}/authoring-guidance/update`, { method: 'POST', body: JSON.stringify(input) }), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ version: 3 })
    expect(admission).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled(); expect(role).toHaveBeenCalledWith('teacher'); expect(adopt).toHaveBeenCalledExactlyOnceWith(actor, id, input)
  })
})
