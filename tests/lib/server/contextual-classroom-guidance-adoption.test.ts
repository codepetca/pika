import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adoptContextualClassroomGuidance as adopt } from '@/lib/server/contextual-classroom-guidance-adoption'
import { buildCourseBlueprintSnapshot, canonicalizeCourseBlueprintSnapshot, hashCourseBlueprintSnapshot } from '@/lib/server/course-blueprint-versions'
import { CLASSROOM_GUIDANCE_ADOPTION_WIRE_BYTES as cap } from '@/lib/validations/contextual-classroom-guidance-adoption'

const actor = 'a0000000-0000-4000-8000-000000000001', classroom = 'b0000000-0000-4000-8000-000000000001', blueprint = 'c0000000-0000-4000-8000-000000000001'
const content = 'd0000000-0000-4000-8000-000000000001', guidance = 'd0000000-0000-4000-8000-000000000002', saved = 'd0000000-0000-4000-8000-000000000003'
const input = { blueprint_id: blueprint, expected_content_version_id: content, expected_guidance_version_id: guidance, expected_draft_revision: 9 }
const expectedArgs = { p_actor_id: actor, p_classroom_id: classroom, p_blueprint_id: blueprint, p_expected_content_version_id: content, p_expected_guidance_version_id: guidance, p_expected_draft_revision: 9 }
const rules = () => ({ course_expectations_markdown: 'Rules', assignment_guidance_markdown: '', test_guidance_markdown: '', unit_exceptions: [] })
const source = () => ({ actor_id: actor, classroom_id: classroom, classroom: { id: classroom, teacher_id: actor, archived_at: null, source_blueprint_id: blueprint, source_blueprint_version_id: content, authoring_guidance_version_id: guidance as string | null },
  versions: { content: { id: content, course_blueprint_id: blueprint }, guidance: { id: guidance, course_blueprint_id: blueprint, version_number: 2 } },
  source: { blueprint: { id: blueprint, teacher_id: actor, content_revision: 9, title: 'Private source', subject: '', grade_level: '', course_code: '', term_template: '', overview_markdown: '', outline_markdown: '', resources_markdown: '', authoring_guidance: rules(), gradebook_use_weights: false, gradebook_assignments_weight: 70, gradebook_tests_weight: 30, planned_site_slug: null, planned_site_published: false, planned_site_config: {} }, assignments: [], assessments: [], lesson_templates: [], materials: [], surveys: [] },
  counts: { assignments: 0, assessments: 0, lesson_templates: 0, materials: 0, surveys: 0 }, source_sha256: 'a'.repeat(64),
})
const envelope = (data: unknown) => ({ data, error: null, status: 200, statusText: 'OK', count: null })
const rpc = vi.fn(), readResult = vi.fn(), writeResult = vi.fn()
const run = (value: unknown = input, actorId = actor, classroomId = classroom) => adopt({ supabase: { rpc } as never, actorId, classroomId, input: value })
const response = (hash: string) => ({ actor_id: actor, classroom_id: classroom, blueprint_id: blueprint, content_version_id: content, previous_guidance_version_id: guidance, source_sha256: 'a'.repeat(64), guidance_version: { id: saved, course_blueprint_id: blueprint, version_number: 3, source_draft_revision: 9, snapshot_sha256: hash } })
describe('contextual complete-source canonical save and atomic guidance adoption', () => {
  beforeEach(() => { vi.clearAllMocks(); readResult.mockImplementation(async () => envelope(source())); writeResult.mockImplementation(async args => envelope(response(args.p_snapshot_sha256))); rpc.mockImplementation((name, args) => ({ abortSignal: (signal: AbortSignal) => { expect(signal).toBeInstanceOf(AbortSignal); return name === 'read_classroom_guidance_adoption_source_v1' ? readResult(args) : writeResult(args) } })) })
  it('makes exactly source then atomic writer RPC and exposes only the old version DTO', async () => {
    expect(await run()).toEqual({ version: 3 }); expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0]).toEqual(['read_classroom_guidance_adoption_source_v1', expectedArgs])
    const [name, args] = rpc.mock.calls[1]; expect(name).toBe('save_and_adopt_classroom_guidance_for_owner_v1')
    const row = source(), { blueprint: blueprintRow, ...collections } = row.source
    const snapshot = buildCourseBlueprintSnapshot({ ...blueprintRow, ...collections })
    expect(args).toEqual({ ...expectedArgs, p_source_sha256: row.source_sha256, p_snapshot_canonical: canonicalizeCourseBlueprintSnapshot(snapshot), p_snapshot_sha256: hashCourseBlueprintSnapshot(snapshot) })
    expect(args).not.toHaveProperty('p_source_kind'); expect(args).not.toHaveProperty('p_source_metadata')
  })
  it('supports the structural fallback and never writes a separately saved Version', async () => {
    const row = source(); row.classroom.authoring_guidance_version_id = null; row.versions.guidance.id = content
    readResult.mockResolvedValue(envelope(row)); writeResult.mockImplementation(async args => envelope({ ...response(args.p_snapshot_sha256), previous_guidance_version_id: content }))
    expect(await run({ ...input, expected_guidance_version_id: content })).toEqual({ version: 3 }); expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls.map(call => call[0])).not.toContain('save_course_blueprint_version_atomic')
  })
  it.each([
    (r: ReturnType<typeof source>) => ({ ...r, actor_id: classroom }),
    (r: ReturnType<typeof source>) => ({ ...r, classroom_id: actor }),
    (r: ReturnType<typeof source>) => ({ ...r, classroom: { ...r.classroom, teacher_id: classroom } }),
    (r: ReturnType<typeof source>) => ({ ...r, classroom: { ...r.classroom, archived_at: '2026-10-20' } }),
    (r: ReturnType<typeof source>) => ({ ...r, classroom: { ...r.classroom, source_blueprint_id: actor } }),
    (r: ReturnType<typeof source>) => ({ ...r, source: { ...r.source, blueprint: { ...r.source.blueprint, teacher_id: classroom } } }),
    (r: ReturnType<typeof source>) => ({ ...r, source: { ...r.source, blueprint: { ...r.source.blueprint, id: actor } } }),
    (r: ReturnType<typeof source>) => ({ ...r, source: { ...r.source, blueprint: { ...r.source.blueprint, content_revision: 10 } } }),
    (r: ReturnType<typeof source>) => ({ ...r, versions: { ...r.versions, content: { ...r.versions.content, id: guidance } } }),
    (r: ReturnType<typeof source>) => ({ ...r, versions: { ...r.versions, guidance: { ...r.versions.guidance, course_blueprint_id: actor } } }),
    (r: ReturnType<typeof source>) => ({ ...r, versions: { ...r.versions, guidance: { ...r.versions.guidance, id: content } } }),
    (r: ReturnType<typeof source>) => ({ ...r, source_sha256: 'not-a-digest' }),
    (r: ReturnType<typeof source>) => ({ ...r, counts: { ...r.counts, assignments: 1 } }),
    (r: ReturnType<typeof source>) => ({ ...r, private_other_tenant: 'withheld' }),
  ])('rejects malformed authority, complete source, lineage or revision%# before any write', async change => { readResult.mockResolvedValue(envelope(change(source()))); await expect(run()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledOnce(); expect(writeResult).not.toHaveBeenCalled() })
  it.each(['actor_id', 'classroom_id', 'blueprint_id', 'content_version_id', 'previous_guidance_version_id', 'source_sha256'] as const)('rejects a substituted writer%s without retry or deletion compensation', async key => { writeResult.mockImplementation(async args => envelope({ ...response(args.p_snapshot_sha256), [key]: key === 'source_sha256' ? 'b'.repeat(64) : key === 'actor_id' ? classroom : actor })); await expect(run()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(2) })
  it.each(['id', 'course_blueprint_id', 'version_number', 'source_draft_revision', 'snapshot_sha256'] as const)('rejects malformed saved-Version%s without assuming rollback', async key => { writeResult.mockImplementation(async args => { const row = response(args.p_snapshot_sha256); return envelope({ ...row, guidance_version: { ...row.guidance_version, [key]: key === 'id' ? 'bad' : key === 'version_number' ? Number.MAX_SAFE_INTEGER + 1 : key === 'source_draft_revision' ? 10 : key === 'snapshot_sha256' ? 'b'.repeat(64) : actor } }) }); await expect(run()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledTimes(2) })
  it.each([
    [400, 'invalid_argument'], [403, 'forbidden'], [403, 'archived'], [404, 'classroom_missing'], [404, 'blueprint_missing'],
    [409, 'unlinked'], [409, 'changed'], [409, 'busy'], [503, 'fenced'], [503, 'unavailable'], [503, 'invalid'], [503, 'too_large'],
  ] as const)('maps exact%i/%s in either phase with no fallback', async (status, reason) => {
    const failed = { data: null, error: { code: `PT${status}`, message: `class_guidance_adoption_${reason}`, details: null, hint: null }, status, statusText: 'Error', count: null }
    readResult.mockResolvedValue(failed); await expect(run()).rejects.toMatchObject({ statusCode: status }); expect(rpc).toHaveBeenCalledOnce()
    vi.clearAllMocks(); readResult.mockResolvedValue(envelope(source())); writeResult.mockResolvedValue(failed); await expect(run()).rejects.toMatchObject({ statusCode: status }); expect(rpc).toHaveBeenCalledTimes(2)
  })
  it.each(['source', 'writer'] as const)('sanitizes%s transport failure and makes no retry', async phase => { (phase === 'source' ? readResult : writeResult).mockRejectedValue(Error('private source credentials')); await expect(run()).rejects.toMatchObject({ statusCode: 503, message: expect.not.stringContaining('private') }); expect(rpc).toHaveBeenCalledTimes(phase === 'source' ? 1 : 2) })
  it('rejects a mismatched SQL status/code rather than promoting a generic failure', async () => { readResult.mockResolvedValue({ data: null, error: { code: 'PT403', message: 'class_guidance_adoption_forbidden', details: null, hint: null }, status: 500, statusText: 'Error', count: null }); await expect(run()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledOnce() })
  it.each([{ ...input, expected_draft_revision: '9' }, { ...input, expected_draft_revision: Number.MAX_SAFE_INTEGER + 1 }, { ...input, snapshot: {} }])('rejects invalid/server-owned input%# before any RPC', async value => { await expect(run(value)).rejects.toMatchObject({ statusCode: 400 }); expect(rpc).not.toHaveBeenCalled() })
  it('normalizes UUID case before database parameters and rejects malformed identity', async () => { await expect(run(input, 'bad')).rejects.toMatchObject({ statusCode: 400 }); expect(rpc).not.toHaveBeenCalled(); await run({ ...input, blueprint_id: blueprint.toUpperCase() }, actor.toUpperCase(), classroom.toUpperCase()); expect(rpc.mock.calls[0]).toEqual(['read_classroom_guidance_adoption_source_v1', expectedArgs]) })
  it.each([0, 1])('checks exact UTF8 source transport bound plus%i without truncation', async extra => { const row = source(); const available = cap + extra - Buffer.byteLength(JSON.stringify(envelope(row))); row.source.blueprint.overview_markdown = 'é'.repeat(Math.floor(available / 2)) + (available % 2 ? 'x' : ''); expect(Buffer.byteLength(JSON.stringify(envelope(row)))).toBe(cap + extra); readResult.mockResolvedValue(envelope(row)); if (extra) { await expect(run()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledOnce() } else expect(await run()).toEqual({ version: 3 }) })
  it('bounds serialized writer arguments too, not only the canonical text before JSON escaping', async () => {
    const row = source(); row.source.blueprint.overview_markdown = '\\'.repeat(cap / 4)
    expect(Buffer.byteLength(JSON.stringify(envelope(row)))).toBeLessThan(cap)
    readResult.mockResolvedValue(envelope(row)); await expect(run()).rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).toHaveBeenCalledOnce(); expect(writeResult).not.toHaveBeenCalled()
  })
  it('bounds the final writer envelope and never retries an uncertain completed request', async () => {
    writeResult.mockResolvedValue(envelope({ private_source: 'x'.repeat(cap) }))
    await expect(run()).rejects.toMatchObject({ statusCode: 503, message: 'Unable to confirm classroom guidance adoption' })
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
