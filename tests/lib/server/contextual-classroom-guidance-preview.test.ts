import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readContextualClassroomGuidancePreview as read } from '@/lib/server/contextual-classroom-guidance-preview'
import { CLASSROOM_GUIDANCE_PREVIEW_WIRE_BYTES as cap } from '@/lib/validations/contextual-classroom-guidance-preview'

const actor = '10000000-0000-4000-8000-000000000001', classroom = '20000000-0000-4000-8000-000000000001'
const blueprint = '30000000-0000-4000-8000-000000000001', content = '40000000-0000-4000-8000-000000000001', adopted = '40000000-0000-4000-8000-000000000002'
const rpc = vi.fn(), abortSignal = vi.fn()
const empty = () => ({ course_expectations_markdown: '', assignment_guidance_markdown: '', test_guidance_markdown: '', unit_exceptions: [] })
const guidance = () => ({ ...empty(), course_expectations_markdown: 'Rules' })
const payload = () => ({ actor_id: actor, classroom_id: classroom,
  classroom: { id: classroom, teacher_id: actor, archived_at: null, source_blueprint_id: blueprint,
    source_blueprint_version_id: content, authoring_guidance_version_id: adopted as string | null },
  blueprint: { id: blueprint, teacher_id: actor, content_revision: 99 },
  versions: { content: { id: content, course_blueprint_id: blueprint }, guidance: { id: adopted, course_blueprint_id: blueprint, version_number: 2 } },
  current_guidance: guidance() as unknown, guidance: guidance() as unknown,
})
const envelope = (data: unknown) => ({ data, error: null, status: 200, statusText: 'OK', count: null })
const run = () => read({ supabase: { rpc } as never, actorId: actor, classroomId: classroom })
describe('contextual active dual-owner guidance preview', () => {
  beforeEach(() => { vi.clearAllMocks(); rpc.mockReturnValue({ abortSignal }); abortSignal.mockResolvedValue(envelope(payload())) })
  it('uses one bounded two-identity RPC and returns only the existing preview DTO', async () => {
    expect(await run()).toEqual({ preview: { blueprint_id: blueprint, expected_content_version_id: content, expected_guidance_version_id: adopted,
      expected_draft_revision: 99, current_guidance_version_number: 2, current_guidance: guidance(), guidance: guidance(), changed: false } })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('preview_classroom_authoring_guidance_for_owner_v1', { p_actor_id: actor, p_classroom_id: classroom })
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
  })
  it('normalizes both selected and proposed rules before equality, not Draft age or raw whitespace', async () => {
    const row = payload(), unit = { id: actor, unit_label: 'Unit', assignment_guidance_markdown: '', test_guidance_markdown: '' }
    row.current_guidance = { ...guidance(), unit_exceptions: [{ ...unit, unit_label: ' \tUnit\r ' }] }
    row.guidance = { ...guidance(), unit_exceptions: [unit] }
    abortSignal.mockResolvedValue(envelope(row)); expect((await run()).preview).toMatchObject({ changed: false, current_guidance: { unit_exceptions: [unit] }, guidance: { unit_exceptions: [unit] } })
    row.guidance = { ...guidance(), course_expectations_markdown: 'New rules', unit_exceptions: [unit] }
    abortSignal.mockResolvedValue(envelope(row)); expect((await run()).preview.changed).toBe(true)
  })
  it('preserves inherited guidance and historical null rules as empty', async () => {
    const row = payload(); row.classroom.authoring_guidance_version_id = null; row.versions.guidance.id = content
    row.current_guidance = null; row.guidance = empty(); abortSignal.mockResolvedValue(envelope(row))
    expect((await run()).preview).toMatchObject({ expected_guidance_version_id: content, current_guidance: empty(), guidance: empty(), changed: false })
  })
  it.each([
    (r: ReturnType<typeof payload>) => ({ ...r, actor_id: classroom }),
    (r: ReturnType<typeof payload>) => ({ ...r, classroom_id: actor }),
    (r: ReturnType<typeof payload>) => ({ ...r, classroom: { ...r.classroom, id: actor } }),
    (r: ReturnType<typeof payload>) => ({ ...r, classroom: { ...r.classroom, teacher_id: classroom } }),
    (r: ReturnType<typeof payload>) => ({ ...r, classroom: { ...r.classroom, archived_at: '2026-10-20' } }),
    (r: ReturnType<typeof payload>) => ({ ...r, classroom: { ...r.classroom, source_blueprint_id: null } }),
    (r: ReturnType<typeof payload>) => ({ ...r, blueprint: { ...r.blueprint, id: actor } }),
    (r: ReturnType<typeof payload>) => ({ ...r, blueprint: { ...r.blueprint, teacher_id: classroom } }),
    (r: ReturnType<typeof payload>) => ({ ...r, blueprint: { ...r.blueprint, content_revision: 0 } }),
    (r: ReturnType<typeof payload>) => ({ ...r, blueprint: { ...r.blueprint, content_revision: Number.MAX_SAFE_INTEGER + 1 } }),
    (r: ReturnType<typeof payload>) => ({ ...r, versions: { ...r.versions, content: { ...r.versions.content, id: adopted } } }),
    (r: ReturnType<typeof payload>) => ({ ...r, versions: { ...r.versions, content: { ...r.versions.content, course_blueprint_id: actor } } }),
    (r: ReturnType<typeof payload>) => ({ ...r, versions: { ...r.versions, guidance: { ...r.versions.guidance, id: content } } }),
    (r: ReturnType<typeof payload>) => ({ ...r, versions: { ...r.versions, guidance: { ...r.versions.guidance, course_blueprint_id: actor } } }),
    (r: ReturnType<typeof payload>) => ({ ...r, versions: { ...r.versions, guidance: { ...r.versions.guidance, version_number: Number.MAX_SAFE_INTEGER + 1 } } }),
    (r: ReturnType<typeof payload>) => ({ ...r, current_guidance: { private: 'withheld' } }),
    (r: ReturnType<typeof payload>) => ({ ...r, guidance: { private: 'withheld' } }),
    (r: ReturnType<typeof payload>) => ({ ...r, private_course: 'withheld' }),
  ])('rejects substituted authority, lineage, malformed rules or private projection%#', async change => {
    abortSignal.mockResolvedValue(envelope(change(payload()))); await expect(run()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledOnce()
  })
  it.each([
    [400, 'invalid_argument', 'Invalid classroom guidance preview query'],
    [404, 'classroom_missing', 'Classroom not found'], [404, 'blueprint_missing', 'Course blueprint not found'],
    [403, 'forbidden', 'Forbidden'], [403, 'archived', 'Classroom is archived'], [409, 'unlinked', 'No Blueprint Version linked'],
    [503, 'fenced', 'Unable to verify classroom guidance preview'], [503, 'invalid', 'Unable to verify classroom guidance preview'],
    [503, 'unavailable', 'Unable to verify classroom guidance preview'], [503, 'too_large', 'Unable to verify classroom guidance preview'],
  ] as const)('maps only exact%i/%s without retry or legacy fallback', async (status, reason, message) => {
    abortSignal.mockResolvedValue({ data: null, error: { code: `PT${status}`, message: `class_guidance_preview_${reason}`, details: null, hint: null }, status, statusText: 'Error', count: null })
    await expect(run()).rejects.toMatchObject({ statusCode: status, message }); expect(rpc).toHaveBeenCalledOnce()
  })
  it.each(['transport', 'unknown', 'mismatched-status', 'malformed-envelope'] as const)('sanitizes%s and makes no retry', async kind => {
    if (kind === 'transport') abortSignal.mockRejectedValue(Error('private'))
    else abortSignal.mockResolvedValue({ data: kind === 'malformed-envelope' ? payload() : null, error: { code: kind === 'unknown' ? '42501' : 'PT403', message: 'class_guidance_preview_forbidden', details: 'private', hint: null }, status: 500, statusText: 'Error', count: null })
    await expect(run()).rejects.toMatchObject({ statusCode: 503, message: expect.not.stringContaining('private') }); expect(rpc).toHaveBeenCalledOnce()
  })
  it('rejects malformed identities before RPC and normalizes UUID case', async () => {
    await expect(read({ supabase: { rpc } as never, actorId: 'bad', classroomId: classroom })).rejects.toMatchObject({ statusCode: 400 }); expect(rpc).not.toHaveBeenCalled()
    const lower = 'a0000000-0000-4000-8000-000000000001', row = payload()
    row.actor_id = lower; row.classroom.teacher_id = lower; row.blueprint.teacher_id = lower
    abortSignal.mockResolvedValue(envelope(row))
    await read({ supabase: { rpc } as never, actorId: lower.toUpperCase(), classroomId: classroom })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('preview_classroom_authoring_guidance_for_owner_v1', { p_actor_id: lower, p_classroom_id: classroom })
  })
  it.each([0, 1])('enforces exact valid UTF8 wire boundary plus%i without truncation', async extra => {
    const row = payload(), unit = (n: number, text: string) => ({ id: `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`, unit_label: 'Unit', assignment_guidance_markdown: text, test_guidance_markdown: text })
    const current = { ...empty(), unit_exceptions: Array.from({ length: 60 }, (_, n) => unit(n, n < 50 ? 'é'.repeat(20_000) : '')) }
    row.current_guidance = current; row.guidance = { ...empty(), unit_exceptions: Array.from({ length: 50 }, (_, n) => unit(n, 'é'.repeat(20_000))) }
    let remaining = cap + extra - Buffer.byteLength(JSON.stringify(envelope(row)), 'utf8')
    for (const item of current.unit_exceptions.slice(50)) for (const key of ['assignment_guidance_markdown', 'test_guidance_markdown'] as const) {
      const amount = Math.min(remaining, 20_000); item[key] = 'x'.repeat(amount); remaining -= amount
    }
    expect(remaining).toBe(0); expect(Buffer.byteLength(JSON.stringify(envelope(row)), 'utf8')).toBe(cap + extra)
    expect(JSON.stringify(envelope(row)).length).toBeLessThan(cap)
    abortSignal.mockResolvedValue(envelope(row)); if (extra) await expect(run()).rejects.toMatchObject({ statusCode: 503 }); else expect((await run()).preview.current_guidance.unit_exceptions).toHaveLength(60)
  })
})
