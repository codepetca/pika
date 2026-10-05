import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getServiceRoleClient } from '@/lib/supabase'
import { createContextualMaterial, updateContextualMaterial, deleteContextualMaterial } from '@/lib/server/contextual-material-mutation'
import { contextualMaterialCreateSchema } from '@/lib/validations/classwork-authoring'
import { materialUpdateBodySchema } from '@/lib/validations/material-mutations'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const materialId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const timestamp = '2026-10-03T12:00:00.123456+00:00'
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '读 🐦 café' }] }] }
const row = () => ({ id: materialId, classroom_id: classroomId, title: 'Reference', content,
  is_draft: false, released_at: timestamp, created_by: actorId, created_at: timestamp, updated_at: timestamp,
  position: 2, artifact_id: otherId, source_artifact_id: null, blueprint_archived_at: null, source_blueprint_version_id: null })
const success = (material: unknown = row(), evidence = {}) => ({ data: { actor_id: actorId, classroom_id: classroomId, material, ...evidence }, error: null, count: null, status: 200, statusText: 'OK' })
const bindings = { actorId, classroomId, materialId }
const rpc = vi.fn()
const update = (body = materialUpdateBodySchema.parse({ title: 'Reference' })) => updateContextualMaterial({ ...bindings, body })

describe('shared material owner RPC contracts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockResolvedValue(success())
  })
  it('binds normalized creation inputs and validates the entire result', async () => {
    const body = contextualMaterialCreateSchema.parse({ title: '\u00a0 Reference \u3000', content, is_draft: false })
    expect(await createContextualMaterial({ actorId, classroomId, body })).toEqual({ material: row() })
    expect(rpc).toHaveBeenCalledWith('create_classwork_material_for_owner_v2', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_title: 'Reference', p_content: content, p_is_draft: false,
    })
  })
  it('accepts the canonical allocator result when all existing mixed positions are negative', async () => {
    const allocated = { ...row(), position: -4 }
    rpc.mockResolvedValue(success(allocated))
    expect(await createContextualMaterial({ actorId, classroomId,
      body: contextualMaterialCreateSchema.parse({ title: 'Reference', content, is_draft: false }),
    })).toEqual({ material: allocated })
  })
  it.each([{ title: 'Reference' }, { content }, { is_draft: false }])('forwards only present patch keys: %j', async patch => {
    await update(materialUpdateBodySchema.parse(patch))
    expect(rpc).toHaveBeenCalledWith('update_classwork_material_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_material_id: materialId, p_patch: patch,
    })
  })
  it('accepts historical authors and nonnull lineage on edits, including an unchanged release', async () => {
    const historical = { ...row(), created_by: otherId, source_artifact_id: materialId,
      blueprint_archived_at: timestamp, source_blueprint_version_id: otherId }
    rpc.mockResolvedValue(success(historical))
    expect(await update({ is_draft: false })).toEqual({ material: historical })
  })
  it('accepts existing draft/release inconsistencies only when publication is absent', async () => {
    rpc.mockResolvedValue(success({ ...row(), is_draft: true }))
    expect((await update()).material.released_at).toBe(timestamp)
    await expect(update({ is_draft: true })).rejects.toMatchObject({ statusCode: 503 })
    rpc.mockResolvedValue(success({ ...row(), released_at: null }))
    expect((await update()).material.released_at).toBeNull()
    await expect(update({ is_draft: false })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('accepts a true draft transition only with its release cleared', async () => {
    rpc.mockResolvedValue(success({ ...row(), is_draft: true, released_at: null }))
    expect((await update({ is_draft: true })).material.is_draft).toBe(true)
  })
  it('compares JSON content structurally rather than by property order', async () => {
    const reordered = { content: content.content, type: content.type }
    rpc.mockResolvedValue(success({ ...row(), content: reordered }))
    expect((await update(materialUpdateBodySchema.parse({ content }))).material.content).toEqual(content)
  })
  it('compares content after its JSON transport normalization', async () => {
    const requested = { type: 'doc', content: [{ type: 'paragraph', attrs: { level: -0 } }] }
    rpc.mockResolvedValue(success({ ...row(), content: JSON.parse(JSON.stringify(requested)) }))
    expect((await update(materialUpdateBodySchema.parse({ content: requested }))).material.content).toEqual(JSON.parse(JSON.stringify(requested)))
  })
  it.each(['42501', 'P0002', 'PT404', '22023', 'PT409', 'PT503', '40001', '40P01', '55P03', '55000', 'PGRST202', 'PGRST204', 'PGRST205', 'XX000'])('maps database code %s without leaking details', async code => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private', details: null, hint: null } })
    const statusCode = ({ '42501': 403, P0002: 404, PT404: 404, '22023': 400, PT409: 409, '40001': 409, '40P01': 409, '55P03': 409, '55000': 409 } as Record<string, number>)[code] ?? 503
    await expect(update()).rejects.toMatchObject({ statusCode })
    await expect(update()).rejects.not.toMatchObject({ message: 'private' })
  })
  it.each([
    null, {}, { data: null, error: null }, { ...success(), extra: true },
    { ...success(), error: { code: '42501' } }, { data: null, error: {} },
    success({ ...row(), extra: true }), success({ ...row(), id: otherId }),
    success({ ...row(), classroom_id: otherId }), success(row(), { actor_id: otherId }),
    success(row(), { classroom_id: otherId }), success({ ...row(), title: 'Substituted' }),
    success({ ...row(), artifact_id: null }), success({ ...row(), position: 2.5 }),
    success({ ...row(), updated_at: 'invalid' }), success({ ...row(), content: { type: 'paragraph' } }),
  ])('rejects malformed/substituted output %#', async response => {
    rpc.mockResolvedValue(response)
    await expect(update()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(Object.keys(row()))('requires persisted field %s in the response', async key => {
    const incomplete: Record<string, unknown> = row()
    delete incomplete[key]
    rpc.mockResolvedValue(success(incomplete))
    await expect(update()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['created_at', 'updated_at', 'released_at', 'blueprint_archived_at'].flatMap(field => [
    'infinity', '-infinity', '10000-01-01T00:00:00+00:00', '0001-01-01T00:00:00+00:00 BC',
    '1900-01-01T00:00:00+05:21:10',
  ].map(value => ({ field, value }))))('rejects nonrepresentable $field $value', async ({ field, value }) => {
    rpc.mockResolvedValue(success({ ...row(), [field]: value }))
    await expect(update()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['created_by', 'artifact_id', 'source_artifact_id', 'source_blueprint_version_id'].flatMap(field => [
    '11111111-1111-0111-8111-111111111111', '11111111-1111-9111-8111-111111111111',
    '11111111-1111-4111-1111-111111111111',
  ].map(value => ({ field, value }))))('rejects stored non-RFC UUID $field $value', async ({ field, value }) => {
    rpc.mockResolvedValue(success({ ...row(), [field]: value }))
    await expect(update()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff'])('retains the installed UUID schema exception %s', async value => {
    rpc.mockResolvedValue(success({ ...row(), created_by: value, artifact_id: value,
      source_artifact_id: value, source_blueprint_version_id: value }))
    expect((await update()).material.artifact_id).toBe(value)
  })
  it('rejects unapplied requested content', async () => {
    await expect(update(materialUpdateBodySchema.parse({ content: { type: 'doc', content: [] } }))).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['created_by', 'source_artifact_id', 'source_blueprint_version_id', 'blueprint_archived_at', 'position'])('rejects invalid create invariant %s', async field => {
    rpc.mockResolvedValue(success({ ...row(), [field]: field === 'position' ? 2.5 : otherId }))
    await expect(createContextualMaterial({ actorId, classroomId, body: contextualMaterialCreateSchema.parse({ title: 'Reference', content, is_draft: false }) })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('requires exact bound deletion evidence and preserves the public API', async () => {
    rpc.mockResolvedValue({ data: { deleted: true, actor_id: actorId, classroom_id: classroomId, material_id: materialId }, error: null })
    expect(await deleteContextualMaterial(bindings)).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('delete_classwork_material_for_owner_v1', { p_actor_id: actorId, p_classroom_id: classroomId, p_material_id: materialId })
  })
  it.each([
    { deleted: false, actor_id: actorId, classroom_id: classroomId, material_id: materialId },
    { deleted: true, actor_id: otherId, classroom_id: classroomId, material_id: materialId },
    { deleted: true, actor_id: actorId, classroom_id: otherId, material_id: materialId },
    { deleted: true, actor_id: actorId, classroom_id: classroomId, material_id: otherId },
    { success: true },
  ])('rejects invalid deletion evidence %j', async data => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(deleteContextualMaterial(bindings)).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([createContextualMaterial, updateContextualMaterial, deleteContextualMaterial])('rejects invalid identifiers before the SDK %#', async mutation => {
    await expect(mutation({ ...bindings, classroomId: 'bad', body: contextualMaterialCreateSchema.parse({ title: 'Reference', content }) })).rejects.toThrow()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('canonicalizes identifiers and rejects a malformed trusted actor', async () => {
    expect(await updateContextualMaterial({ ...bindings, classroomId: classroomId.toUpperCase(), materialId: materialId.toUpperCase(), body: { title: 'Reference' } })).toEqual({ material: row() })
    await expect(updateContextualMaterial({ ...bindings, actorId: 'bad', body: { title: 'Reference' } })).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('fails closed on transport exceptions', async () => {
    rpc.mockRejectedValue(new Error('private'))
    await expect(update()).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('shared material mutation request schemas', () => {
  it.each([{}, { title: '' }, { title: '\u00a0\u3000' }, { title: null }, { is_draft: 'false' }, { is_draft: null },
    { content: { type: 'doc', content: [{}] } }, { content: { type: 'doc', content: [{ type: 'text', text: 3 }] } },
    { created_by: actorId }, { title: 'ok', position: 1 }, { title: 'ok', released_at: timestamp },
    { title: 'ok', artifact_id: otherId }, { title: 'ok', source_artifact_id: null }, { title: 'ok', blueprint_archived_at: null },
  ])('rejects malformed or authority-bearing patches %j', body => {
    expect(materialUpdateBodySchema.safeParse(body).success).toBe(false)
  })
  it('retains PATCH compatibility for long titles while POST enforces 500 UTF16 units', () => {
    expect(materialUpdateBodySchema.parse({ title: ` ${'😀'.repeat(300)} ` }).title).toHaveLength(600)
    expect(contextualMaterialCreateSchema.safeParse({ title: '😀'.repeat(251), content }).success).toBe(false)
    expect(contextualMaterialCreateSchema.parse({ title: '😀'.repeat(250), content }).is_draft).toBe(true)
  })
  it('rejects deeply nested or oversized Tiptap documents', () => {
    let nested: unknown = { type: 'text', text: 'ok' }
    for (let i = 0; i < 101; i++) nested = { type: 'paragraph', content: [nested] }
    for (const invalid of [{ type: 'doc', content: [nested] }, { type: 'doc', content: Array.from({ length: 10001 }, () => ({ type: 'paragraph' })) }]) {
      expect(materialUpdateBodySchema.safeParse({ content: invalid }).success).toBe(false)
      expect(contextualMaterialCreateSchema.safeParse({ title: 'Reference', content: invalid }).success).toBe(false)
    }
  })
})
