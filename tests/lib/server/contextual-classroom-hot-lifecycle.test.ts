import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { setContextualClassroomHotArchive } from '@/lib/server/contextual-classroom-hot-lifecycle'
import { contextualClassroomHotLifecyclePatchSchema, contextualClassroomUpdatePatchSchema } from '@/lib/validations/contextual-classroom-hot-lifecycle'
import { contextualClassroomMetadataPatchSchema } from '@/lib/validations/contextual-classroom-metadata'
import { hydrateClassroomRecord } from '@/lib/server/classrooms'
import { mapClassroomCreationDatabaseError } from '@/lib/server/classroom-creation-entitlement'
import type { Database } from '@/types/database'
import { actorId, classroomId, otherId, classroom, timestamp } from '../../helpers/contextual-classroom-detail'

function fixture(result: unknown = { ...classroom, archived_at: timestamp }, status = 200) {
  const requests: Array<{ url: URL; options?: RequestInit }> = []
  const fetch = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
    requests.push({ url: new URL(String(url)), options })
    if (result instanceof Error) throw result
    return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } })
  })
  const supabase = createClient<Database>('http://127.0.0.1:54321', 'fake-key', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } })
  return { requests, fetch, supabase, run: (archived = true) => setContextualClassroomHotArchive({ supabase, actorId, classroomId, archived }) }
}

describe('hot classroom lifecycle adapter (installed SDK, fetch stub only)', () => {
  it.each([true, false])('sends only actor/classroom/desired-state to one bound RPC (%s)', async archived => {
    const row = { ...classroom, archived_at: archived ? timestamp : null }
    const f = fixture(row)
    expect(await f.run(archived)).toEqual({ kind: 'updated', classroom: hydrateClassroomRecord(row) })
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0].url.pathname).toBe('/rest/v1/rpc/set_classroom_hot_archive_for_owner_v1')
    expect(f.requests[0].options?.method).toBe('POST')
    expect(JSON.parse(String(f.requests[0].options?.body))).toEqual({ p_actor_id: actorId, p_classroom_id: classroomId, p_archived: archived })
  })
  it('normalizes actor and classroom UUIDs independently of historical role', async () => {
    const f = fixture()
    await setContextualClassroomHotArchive({ supabase: f.supabase, actorId: actorId.toUpperCase(), classroomId: classroomId.toUpperCase(), archived: true })
    expect(JSON.parse(String(f.requests[0].options?.body))).toEqual({ p_actor_id: actorId, p_classroom_id: classroomId, p_archived: true })
  })
  it.each([{}, { archived: null }, { archived: 'true' }, { archived: 1 }, { archived: true, title: 'x' }, { archived: false, position: 1 }, { archived: true, actorId }, { archived: true, extra: false }])('rejects invalid or mixed lifecycle input %#', patch => {
    expect(contextualClassroomHotLifecyclePatchSchema.safeParse(patch).success).toBe(false)
    expect(contextualClassroomUpdatePatchSchema.safeParse(patch).success).toBe(false)
  })
  it.each([true, false])('does not widen the metadata-only contract (%s)', archived => {
    expect(contextualClassroomHotLifecyclePatchSchema.parse({ archived })).toEqual({ archived })
    expect(contextualClassroomUpdatePatchSchema.parse({ archived })).toEqual({ archived })
    expect(contextualClassroomMetadataPatchSchema.safeParse({ archived }).success).toBe(false)
    expect(contextualClassroomUpdatePatchSchema.parse({ title: 'Changed' })).toEqual({ title: 'Changed' })
  })
  it.each([
    ['PT400', 'classroom_hot_lifecycle_invalid_patch', 400],
    ['PT400', 'classroom_hot_lifecycle_already_archived', 400],
    ['PT400', 'classroom_hot_lifecycle_not_archived', 400],
    ['PT403', 'classroom_hot_lifecycle_forbidden', 403],
    ['PT403', 'classroom_hot_lifecycle_fenced', 403],
    ['PT404', 'classroom_hot_lifecycle_not_found', 404],
    ['PT409', 'classroom_hot_lifecycle_busy', 409],
    ['PT503', 'classroom_hot_lifecycle_postcondition_failed', 503],
    ['PT403', 'unrelated', 503], ['42501', 'unrelated', 503],
    ['23514', 'unrelated', 503], ['55000', 'unrelated', 503], ['PGRST202', 'missing RPC', 503],
  ])('maps only the exact public lifecycle error %s/%s', async (code, message, expected) => {
    const f = fixture({ code, message, details: null, hint: null }, 400)
    await expect(f.run()).rejects.toMatchObject({ statusCode: expected })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['42501', 'classroom_creation_entitlement_disabled'],
    ['42501', 'classroom_creation_entitlement_not_started'],
    ['42501', 'classroom_creation_entitlement_expired'],
    ['23514', 'classroom_creation_active_limit_reached'],
    ['55000', 'classroom_creation_entitlement_unavailable'],
  ])('retains the exact existing entitlement denial %s/%s', async (code, message) => {
    const error = { code, message, details: null, hint: null }
    const f = fixture(error, 400)
    expect(await f.run(false)).toEqual({ kind: 'denied', denial: mapClassroomCreationDatabaseError(error) })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    { id: otherId }, { teacher_id: otherId }, { archived_at: null }, { archived_at: 'bad' },
    { secret: 'extra' }, { manual_attendance_revision: null }, { course_outline_markdown: undefined },
  ])('refuses substituted, wrong-state or malformed row evidence %#', async patch => {
    const f = fixture({ ...classroom, archived_at: timestamp, ...patch })
    await expect(f.run()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
  it('requires null archived_at after a restore', async () => {
    await expect(fixture().run(false)).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([null, [], {}, [classroom], false])('requires one full owner row %#', async row => {
    await expect(fixture(row).run()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([
    { data: classroom }, { error: null }, { data: classroom, error: null, secret: true },
    { data: classroom, error: null, count: 2 }, { data: classroom, error: null, status: 500 },
    { data: null, error: { code: 'PT403', message: 'classroom_hot_lifecycle_forbidden' } },
    { data: classroom, error: { code: 'PT403', message: 'classroom_hot_lifecycle_forbidden', details: null, hint: null } },
  ])('fails closed on malformed SDK envelopes %#', async result => {
    const f = fixture()
    const rpc = vi.spyOn(f.supabase, 'rpc').mockResolvedValue(result as never)
    await expect(f.run()).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).toHaveBeenCalledTimes(1); expect(f.fetch).not.toHaveBeenCalled()
  })
  it('reports lost response as uncertain, never as rollback or automatic replay', async () => {
    const f = fixture(new Error('private transport detail'))
    await expect(f.run()).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify classroom lifecycle update; refresh to reconcile its outcome' })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
})
