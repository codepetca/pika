import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { GET, POST } from '@/app/api/teacher/classrooms/[id]/authoring-guidance/update/route'

const { admission, role, adopt, legacy, preview } = vi.hoisted(() => ({ admission: vi.fn(), role: vi.fn(), adopt: vi.fn(), legacy: vi.fn(), preview: vi.fn() }))
vi.mock('@/lib/server/contextual-classroom-metadata', () => ({ authorizeSharedClassroomMetadataActor: admission }))
vi.mock('@/lib/auth', () => ({ requireRole: role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({}) }))
vi.mock('@/lib/server/contextual-classroom-guidance-adoption', () => ({ adoptContextualClassroomGuidance: adopt }))
vi.mock('@/lib/server/contextual-classroom-guidance-preview', () => ({ readContextualClassroomGuidancePreview: preview }))
vi.mock('@/lib/server/classroom-guidance-adoption', () => ({ adoptClassroomGuidance: legacy, previewClassroomGuidanceAdoption: vi.fn() }))
const actor = 'a0000000-0000-4000-8000-000000000001', id = 'b0000000-0000-4000-8000-000000000001'
const input = { blueprint_id: id, expected_content_version_id: id, expected_guidance_version_id: id, expected_draft_revision: 4 }
const request = (body: unknown = input) => new NextRequest(`http://localhost/api/teacher/classrooms/${id}/authoring-guidance/update`, { method: 'POST', body: JSON.stringify(body) })
const run = (body: unknown = input, params: unknown = { id }) => POST(request(body), { params: Promise.resolve(params) } as never)
describe('contextual guidance adoption POST and legacy compatibility', () => {
  beforeEach(() => { vi.clearAllMocks(); admission.mockResolvedValue({ mode: 'shared', user: { id: actor, role: 'student' } }); role.mockResolvedValue({ id: actor, role: 'teacher' }); adopt.mockResolvedValue({ version: 3 }); legacy.mockResolvedValue({ ok: true, version: 3 }); preview.mockResolvedValue({ preview: { changed: false } }) })
  it.each(['teacher', 'student'])('uses the admitted%s actor without a legacy role shortcut', async label => {
    admission.mockResolvedValue({ mode: 'shared', user: { id: actor, role: label } })
    const response = await run(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ version: 3 })
    expect(adopt).toHaveBeenCalledExactlyOnceWith({ supabase: {}, actorId: actor, classroomId: id, input }); expect(role).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled()
  })
  it('retains unmatched/absent legacy params, role, helper and error', async () => {
    admission.mockResolvedValue({ mode: 'legacy' }); legacy.mockResolvedValue({ ok: false, status: 409, error: 'Legacy stale' })
    const response = await run(input, { id: 'legacy-id' }); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Legacy stale' })
    expect(role).toHaveBeenCalledWith('teacher'); expect(legacy).toHaveBeenCalledExactlyOnceWith(actor, 'legacy-id', input); expect(adopt).not.toHaveBeenCalled()
  })
  it('still denies an unmatched student through the legacy role guard', async () => {
    admission.mockResolvedValue({ mode: 'legacy' }); role.mockRejectedValue(new ApiError(403, 'Forbidden')); expect((await run()).status).toBe(403); expect(legacy).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled()
  })
  it.each([401, 503])('rejects identity/configuration%i before params or body', async status => {
    admission.mockRejectedValue(new ApiError(status, 'Unavailable')); const params = vi.fn(), body = vi.spyOn(request(), 'json')
    const response = await POST({ json: body } as never, { params: { then: params } } as never)
    expect(response.status).toBe(status); expect(params).not.toHaveBeenCalled(); expect(body).not.toHaveBeenCalled(); expect(role).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled()
  })
  it.each([{ id: 'bad' }, { id, actor_id: actor }, {}])('validates named contextual params%#', async params => { expect((await run(input, params)).status).toBe(400); expect(adopt).not.toHaveBeenCalled() })
  it.each([{ ...input, expected_draft_revision: Number.MAX_SAFE_INTEGER + 1 }, { ...input, expected_draft_revision: '4' }, { ...input, guidance: 'Injected' }, { ...input, snapshot: {} }, { ...input, source_sha256: 'a'.repeat(64) }])('rejects unsafe and server-owned body data%#', async body => { expect((await run(body)).status).toBe(400); expect(adopt).not.toHaveBeenCalled() })
  it('normalizes all contextual UUIDs without changing legacy input', async () => {
    await run({ ...input, blueprint_id: id.toUpperCase() }, { id: id.toUpperCase() }); expect(adopt).toHaveBeenCalledWith({ supabase: {}, actorId: actor, classroomId: id, input })
  })
  it.each([400, 403, 404, 409, 503])('retains authoritative%i without fallback or retries', async status => { adopt.mockRejectedValue(new ApiError(status, 'Unavailable')); expect((await run()).status).toBe(status); expect(adopt).toHaveBeenCalledOnce(); expect(role).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled() })
  it('keeps the reviewed contextual GET on its existing preview reader', async () => { const response = await GET(new NextRequest('http://localhost'), { params: Promise.resolve({ id }) }); expect(response.status).toBe(200); expect(preview).toHaveBeenCalledExactlyOnceWith({ supabase: {}, actorId: actor, classroomId: id }); expect(adopt).not.toHaveBeenCalled() })
})
