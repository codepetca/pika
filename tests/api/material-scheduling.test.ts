import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/classrooms/[id]/materials/route'
import { PATCH } from '@/app/api/teacher/classrooms/[id]/materials/[materialId]/route'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const materialId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const timestamp = '2026-10-03T12:00:00.000Z'
const scheduled_for = '2099-01-01T12:00:00.000Z'
const content = { type: 'doc', content: [] }
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', role: 'teacher' })) }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => ({ rpc })) }))
vi.mock('@/lib/server/contextual-classwork-creation-access', () => ({
  authorizeContextualClassworkCreationRequest: vi.fn(async () => ({ mode: 'legacy', user: { id: '11111111-1111-4111-8111-111111111111' }, classroomId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
}))
const material = () => ({ id: materialId, classroom_id: classroomId, title: 'Reference', content,
  is_draft: false, released_at: scheduled_for, created_by: actorId, created_at: timestamp, updated_at: timestamp,
  position: 0, artifact_id: materialId, source_artifact_id: null, blueprint_archived_at: null, source_blueprint_version_id: null })
const response = () => ({ data: { actor_id: actorId, classroom_id: classroomId, material: material() }, error: null })
const context = () => ({ params: Promise.resolve({ id: classroomId, materialId }) })
const request = (body: unknown) => new NextRequest(`http://localhost/api/teacher/classrooms/${classroomId}/materials`, {
  method: 'POST', body: JSON.stringify(body),
})

describe('legacy material scheduling uses locked owner operations', () => {
  beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue(response()) })
  it('atomically creates scheduled legacy materials with the same public response', async () => {
    const result = await POST(request({ title: 'Reference', content, is_draft: false, scheduled_for }), context())
    expect(result.status).toBe(201)
    expect(await result.json()).toEqual({ material: material() })
    expect(rpc).toHaveBeenCalledWith('create_classwork_material_for_owner_v3', expect.objectContaining({ p_scheduled_for: scheduled_for }))
  })
  it('schedules an existing legacy material through the locked JSON patch operation', async () => {
    const result = await PATCH(request({ scheduled_for }), context())
    expect(result.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('update_classwork_material_for_owner_v1', expect.objectContaining({ p_patch: { scheduled_for } }))
  })
  it.each([{ scheduled_for: 'invalid' }, { scheduled_for: '2020-01-01T00:00:00Z' }, { is_draft: true, scheduled_for }])('rejects malformed publication %j before writing', async body => {
    const result = await PATCH(request(body), context())
    expect(result.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('maps the database owner check to a denied request', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    expect((await PATCH(request({ scheduled_for }), context())).status).toBe(403)
  })
})
