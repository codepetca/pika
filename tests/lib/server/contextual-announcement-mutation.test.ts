import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { createContextualAnnouncement, updateContextualAnnouncement, deleteContextualAnnouncement } from '@/lib/server/contextual-announcement-mutation'
import { announcementCreateBodySchema, announcementUpdateBodySchema } from '@/lib/validations/announcement-mutations'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const announcementId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const timestamp = '2026-10-01T12:00:00.000Z'
const row = () => ({
  id: announcementId, classroom_id: classroomId, content: 'Content', title: null,
  created_by: actorId, is_draft: false, published_at: timestamp, scheduled_for: null,
  created_at: timestamp, updated_at: timestamp,
})
const rpc = vi.fn()
const bindings = { actorId, classroomId, announcementId }
const success = (announcement = row()) => ({ data: { announcement }, error: null, status: 200, statusText: 'OK', count: null })
const update = (body = announcementUpdateBodySchema.parse({ content: 'Content' })) => updateContextualAnnouncement({ ...bindings, body })

describe('announcement owner mutation RPC contracts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockResolvedValue(success())
  })

  it('binds create actor and normalized nullable scalar inputs', async () => {
    const body = announcementCreateBodySchema.parse({ content: ' Content ', title: '  ' })
    expect(await createContextualAnnouncement({ actorId, classroomId, body })).toEqual({ announcement: row() })
    expect(rpc).toHaveBeenCalledWith('create_announcement_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_content: 'Content', p_title: null,
      p_is_draft: false, p_scheduled_for: null,
    })
  })

  it.each([
    { title: null }, { content: 'Content' }, { is_draft: false }, { scheduled_for: null },
  ])('forwards only present patch keys: %j', async patch => {
    await update(announcementUpdateBodySchema.parse(patch))
    expect(rpc).toHaveBeenCalledWith('update_announcement_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_announcement_id: announcementId, p_patch: patch,
    })
  })

  it('accepts a historical author after ownership transfer', async () => {
    rpc.mockResolvedValue(success({ ...row(), created_by: otherId }))
    expect((await update()).announcement.created_by).toBe(otherId)
  })

  it('accepts unchanged publication timestamps for an already published false-draft no-op', async () => {
    expect(await update({ is_draft: false })).toEqual({ announcement: row() })
  })

  it('verifies draft and scheduled publication output', async () => {
    rpc.mockResolvedValue(success({ ...row(), is_draft: true, published_at: null }))
    expect((await update({ is_draft: true })).announcement.is_draft).toBe(true)
    const scheduled = '2099-01-01T12:00:00.000Z'
    rpc.mockResolvedValue(success({ ...row(), published_at: scheduled, scheduled_for: scheduled }))
    expect((await update({ scheduled_for: scheduled })).announcement.scheduled_for).toBe(scheduled)
  })

  it.each(['42501', 'P0002', 'PT404', '22023', 'PT409', '40001', '40P01', '55000', '55P03', 'PGRST202', 'XX000'])('maps database code %s without exposing details', async code => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private details', details: null, hint: null } })
    const statusCode = ({ '42501': 403, P0002: 404, PT404: 404, '22023': 400, PT409: 409, '40001': 409, '40P01': 409, '55000': 409, '55P03': 409 } as Record<string, number>)[code] ?? 503
    await expect(update()).rejects.toMatchObject({ statusCode })
    await expect(update()).rejects.not.toMatchObject({ message: 'private details' })
  })

  it.each([
    null, {}, { data: null, error: null },
    { ...success(), unknown: true },
    { ...success(), error: { code: '42501' } },
    { data: null, error: { code: '42501', unknown: true } },
    { data: { announcement: { ...row(), unknown: true } }, error: null },
    { data: { announcement: row(), unknown: true }, error: null },
    success({ ...row(), classroom_id: otherId }), success({ ...row(), id: otherId }),
    success({ ...row(), published_at: null }), success({ ...row(), updated_at: 'invalid' }),
    success({ ...row(), is_draft: true }), success({ ...row(), content: 'substituted' }),
  ])('rejects malformed or substituted RPC output %#', async response => {
    rpc.mockResolvedValue(response)
    await expect(update()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { content: 'Requested' }, { title: 'Requested' }, { title: null },
    { is_draft: true }, { scheduled_for: '2099-01-01T12:00:00.000Z' },
  ])('rejects unapplied requested fields %j', async body => {
    rpc.mockResolvedValue(success({ ...row(), title: 'Original' }))
    await expect(update(body)).rejects.toMatchObject({ statusCode: 503 })
  })

  it('requires create authorship to match the authenticated actor', async () => {
    rpc.mockResolvedValue(success({ ...row(), created_by: otherId }))
    await expect(createContextualAnnouncement({ actorId, classroomId, body: announcementCreateBodySchema.parse({ content: 'Content' }) })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('projects bound deletion evidence to the existing public success result', async () => {
    rpc.mockResolvedValue({ data: { deleted: true, classroom_id: classroomId, announcement_id: announcementId }, error: null })
    expect(await deleteContextualAnnouncement(bindings)).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledWith('delete_announcement_for_owner_v1', { p_actor_id: actorId, p_classroom_id: classroomId, p_announcement_id: announcementId })
  })

  it.each([
    { deleted: true, classroom_id: otherId, announcement_id: announcementId },
    { deleted: true, classroom_id: classroomId, announcement_id: otherId },
    { deleted: false, classroom_id: classroomId, announcement_id: announcementId },
    { success: true },
  ])('rejects unbound deletion evidence %j', async data => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(deleteContextualAnnouncement(bindings)).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([createContextualAnnouncement, updateContextualAnnouncement, deleteContextualAnnouncement])('validates malformed identifiers before any SDK call %#', async mutation => {
    await expect(mutation({ ...bindings, classroomId: 'bad', body: announcementCreateBodySchema.parse({ content: 'Content' }) })).rejects.toThrow()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects an invalid actor before the SDK', async () => {
    await expect(updateContextualAnnouncement({ ...bindings, actorId: 'bad', body: { title: null } })).rejects.toBeInstanceOf(ApiError)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([updateContextualAnnouncement, deleteContextualAnnouncement])('rejects malformed resource IDs before the SDK %#', async mutation => {
    await expect(mutation({ ...bindings, announcementId: 'bad', body: { title: null } })).rejects.toThrow()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('canonicalizes identifier casing before binding and comparison', async () => {
    expect(await updateContextualAnnouncement({ ...bindings, classroomId: classroomId.toUpperCase(), announcementId: announcementId.toUpperCase(), body: { title: null } })).toEqual({ announcement: row() })
    expect(rpc).toHaveBeenCalledWith('update_announcement_for_owner_v1', expect.objectContaining({ p_classroom_id: classroomId, p_announcement_id: announcementId }))
  })

  it('fails closed on SDK exceptions', async () => {
    rpc.mockRejectedValue(new Error('private details'))
    await expect(update()).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('announcement mutation transport schemas', () => {
  it.each([
    {}, { content: '' }, { content: '  ' }, { title: 42 }, { title: 'x'.repeat(61) },
    { is_draft: 'false' }, { scheduled_for: '' }, { scheduled_for: 'yesterday' },
    { scheduled_for: '2000-01-01' }, { is_draft: true, scheduled_for: '2099-01-01' },
    { scheduled_for: '+010000-01-01T00:00:00.000Z' },
    { content: 'Content', actorId }, { title: null, role: 'teacher' }, { classroom_id: classroomId },
  ])('rejects invalid or authority-bearing patches %j', body => {
    expect(announcementUpdateBodySchema.safeParse(body).success).toBe(false)
  })
  it('normalizes Date-compatible scheduling input once and retains null presence', () => {
    expect(announcementUpdateBodySchema.parse({ scheduled_for: '2099-01-01' })).toEqual({ scheduled_for: '2099-01-01T00:00:00.000Z' })
    expect(announcementUpdateBodySchema.parse({ scheduled_for: null })).toEqual({ scheduled_for: null })
    expect(announcementUpdateBodySchema.parse({ title: '  ' })).toEqual({ title: null })
    expect(announcementCreateBodySchema.parse({ content: ' Content ', is_draft: true, scheduled_for: null })).toEqual({ content: 'Content', is_draft: true, scheduled_for: null })
  })
})
