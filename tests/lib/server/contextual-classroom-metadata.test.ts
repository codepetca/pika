import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { updateContextualClassroomMetadata } from '@/lib/server/contextual-classroom-metadata'
import { contextualClassroomMetadataPatchSchema, contextualClassroomMetadataDBPatchSchema } from '@/lib/validations/contextual-classroom-metadata'
import { hydrateClassroomRecord } from '@/lib/server/classrooms'
import { DEFAULT_ACTUAL_COURSE_SITE_CONFIG } from '@/lib/course-site-publishing'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'
import { actorId, classroomId, otherId, classroom } from '../../helpers/contextual-classroom-detail'
import type { Database } from '@/types/database'

function fixture(result: unknown = { ...classroom, title: 'Changed' }, status = 200) {
  const requests: Array<{ url: URL; options?: RequestInit }> = []
  const fetch = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
    requests.push({ url: new URL(String(url)), options })
    if (result instanceof Error) throw result
    return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } })
  })
  const supabase = createClient<Database>('http://127.0.0.1:54321', 'fake-key', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } })
  return { requests, fetch, supabase, run: (patch: unknown = { title: 'Changed' }) => updateContextualClassroomMetadata({ supabase, actorId, classroomId, patch: contextualClassroomMetadataPatchSchema.parse(patch) }) }
}
const cases = [
  { request: { title: '  Title  ' }, database: { title: '  Title  ' } },
  { request: { classCode: '' }, database: { class_code: '' } },
  { request: { termLabel: '' }, database: { term_label: '' } },
  { request: { allowEnrollment: false }, database: { allow_enrollment: false } },
  { request: { joinPolicy: 'open_join' }, database: { join_policy: 'open_join' } },
  { request: { themeColor: 'teal' }, database: { theme_color: 'teal' } },
  { request: { lessonPlanVisibility: 'one_week_ahead' }, database: { lesson_plan_visibility: 'one_week_ahead' } },
  { request: { featureVisibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY }, database: { feature_visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY } },
  { request: { actualSiteSlug: '  valid-address  ' }, database: { actual_site_slug: 'valid-address' } },
  { request: { actualSitePublished: true }, database: { actual_site_published: true } },
  { request: { actualSiteConfig: DEFAULT_ACTUAL_COURSE_SITE_CONFIG }, database: { actual_site_config: DEFAULT_ACTUAL_COURSE_SITE_CONFIG } },
  { request: { courseOverviewMarkdown: ' \nOverview ' }, database: { course_overview_markdown: ' \nOverview ' } },
  { request: { courseOutlineMarkdown: '' }, database: { course_outline_markdown: '' } },
]
describe('metadata owner adapter and strict feature contracts (SDK fetch stub, no network)', () => {
  it.each(cases)('normalizes allowed request $request into exact metadata RPC fields', async ({ request, database }) => {
    const row = { ...classroom, actual_site_slug: 'existing-address', ...database }
    const f = fixture(row)
    expect(await f.run(request)).toEqual(hydrateClassroomRecord(row))
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0].url.pathname).toBe('/rest/v1/rpc/update_classroom_metadata_for_owner_v1')
    expect(f.requests[0].options?.method).toBe('POST')
    expect(JSON.parse(String(f.requests[0].options?.body))).toEqual({ p_actor_id: actorId, p_classroom_id: classroomId, p_patch: database })
  })
  it('retains explicit-null slug, unpublishing, omitted fields and the full thirty-column owner response', async () => {
    const row = { ...classroom, actual_site_slug: null, actual_site_published: false }
    const f = fixture(row)
    expect(await f.run({ actualSiteSlug: null, actualSitePublished: false })).toEqual(hydrateClassroomRecord(row))
    expect(Object.keys(row)).toHaveLength(30)
    expect(JSON.parse(String(f.requests[0].options?.body)).p_patch).toEqual({ actual_site_slug: null, actual_site_published: false })
  })
  it.each([{}, { archived: true }, { archived: false }, { archived: null }, { title: 'New', archived: false }, { actorId }, { teacher_id: actorId }, { position: 4 }, { blueprint_source_revision: 9 }, { authoring_guidance_version_id: otherId }, { manual_attendance_revision: 2 }, { unknown: true }, { title: '' }, { classCode: null }, { termLabel: null }, { allowEnrollment: 'true' }, { actualSiteSlug: 'UPPER' }, { joinPolicy: 'invalid' }])('rejects empty, lifecycle, unknown and malformed shared keys %#', patch => {
    expect(contextualClassroomMetadataPatchSchema.safeParse(patch).success).toBe(false)
  })
  it.each([{ feature_visibility: {} }, { actual_site_config: {} }, { actual_site_slug: ' space ' }, { feature_visibility: { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, private: true } }, { actual_site_config: { ...DEFAULT_ACTUAL_COURSE_SITE_CONFIG, private: true } }, { actor_id: actorId }, { title: null }, { allow_enrollment: 1 }, { archived_at: null }])('independently rejects invalid normalized direct DB patches %#', patch => {
    expect(contextualClassroomMetadataDBPatchSchema.safeParse(patch).success).toBe(false)
  })
  it.each([{ id: otherId }, { teacher_id: otherId }, { archived_at: classroom.updated_at }, { title: 'Wrong' }, { actual_site_published: true, actual_site_slug: null }, { manual_attendance_revision: null }, { authoring_guidance_version_id: 'invalid' }, { secret: 'extra' }, { course_outline_markdown: undefined }])('rejects malformed/substituted/late response evidence without claiming rollback %#', async patch => {
    const f = fixture({ ...classroom, title: 'Changed', ...patch })
    await expect(f.run()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
  it.each([null, [], [{ ...classroom, title: 'Changed' }], [{ ...classroom, title: 'Changed' }, classroom], {}, false])('requires exactly one full-row RPC object %#', async row => {
    await expect(fixture(row).run()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([
    ['PT400', 'classroom_metadata_public_slug_required', 400], ['PT403', 'classroom_metadata_forbidden', 403],
    ['PT403', 'classroom_metadata_archived', 403], ['PT404', 'classroom_metadata_not_found', 404],
    ['PT409', 'classroom_metadata_slug_conflict', 409], ['PT409', 'classroom_metadata_busy', 409],
    ['PT409', 'unrelated', 503], ['23505', 'unrelated unique constraint', 503], ['55000', 'unrelated policy', 503], ['PGRST202', 'missing RPC', 503],
  ])('maps only documented RPC error %s/%s', async (code, message, expected) => {
    const f = fixture({ code, message, details: null, hint: null }, 400)
    await expect(f.run()).rejects.toMatchObject({ statusCode: expected })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
  it('reports lost post-commit transport as uncertain failure without replay or compensating writes', async () => {
    const f = fixture(new Error('lost response after a possible commit'))
    await expect(f.run()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
  it('maps excessive recursive returned historical JSON to generic contract failure', async () => {
    let origin: unknown = null
    for (let n = 0; n < 3000; n++) origin = { nested: origin }
    await expect(fixture({ ...classroom, title: 'Changed', source_blueprint_origin: origin }).run()).rejects.toMatchObject({ statusCode: 503 })
  })
})
