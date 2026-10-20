import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readContextualClassroomAuthoringGuidance as read } from '@/lib/server/contextual-classroom-authoring-guidance-read'
import { CLASSROOM_AUTHORING_GUIDANCE_WIRE_BYTES as cap } from '@/lib/validations/contextual-classroom-authoring-guidance-read'

const actor = '10000000-0000-4000-8000-000000000001', classroom = '20000000-0000-4000-8000-000000000001'
const blueprint = '30000000-0000-4000-8000-000000000001', content = '40000000-0000-4000-8000-000000000001', adopted = '40000000-0000-4000-8000-000000000002'
const rpc = vi.fn(), abortSignal = vi.fn()
const payload = () => ({ actor_id: actor, classroom_id: classroom,
  classroom: { id: classroom, teacher_id: actor, source_blueprint_id: blueprint as string | null,
    source_blueprint_version_id: content as string | null, authoring_guidance_version_id: adopted as string | null },
  version_parents: { content: blueprint, guidance: blueprint },
  context: { blueprint_id: blueprint, content_version_id: content, content_version_number: 1,
    source_blueprint_version_id: adopted, source_blueprint_version_number: 2, source_draft_revision: 3, guidance: null as unknown,
    course: { title: 'Frozen', subject: '', grade_level: '', outline_markdown: 'Frozen outline', assignment_titles: ['Original', '  '], test_titles: ['Original Test'] } },
})
const envelope = (data: unknown) => ({ data, error: null, status: 200, statusText: 'OK', count: null })
const run = () => read({ supabase: { rpc } as never, actorId: actor, classroomId: classroom })
describe('contextual saved classroom authoring guidance', () => {
  beforeEach(() => { vi.clearAllMocks(); rpc.mockReturnValue({ abortSignal }); abortSignal.mockResolvedValue(envelope(payload())) })
  it('makes exactly one bounded actor/class-bound RPC and strips all private binding evidence', async () => {
    const result = await run()
    expect(rpc).toHaveBeenCalledExactlyOnceWith('read_classroom_authoring_guidance_for_owner_v1', { p_actor_id: actor, p_classroom_id: classroom })
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
    expect(Object.keys(result)).toEqual(['context'])
    expect(result.context).toEqual({ ...payload().context, guidance: { course_expectations_markdown: '', assignment_guidance_markdown: '', test_guidance_markdown: '', unit_exceptions: [] } })
  })
  it('retains structural strings/order/whitespace and normalizes adopted guidance by the existing rules', async () => {
    const row = payload(); row.context.guidance = { course_expectations_markdown: 'Adopted rules', assignment_guidance_markdown: '', test_guidance_markdown: '',
      unit_exceptions: [{ id: actor, unit_label: ' \tUnit\n', assignment_guidance_markdown: '', test_guidance_markdown: '' }] }
    abortSignal.mockResolvedValue(envelope(row))
    expect(await run()).toMatchObject({ context: { course: row.context.course, content_version_id: content, source_blueprint_version_id: adopted,
      guidance: { course_expectations_markdown: 'Adopted rules', unit_exceptions: [{ unit_label: 'Unit' }] } } })
  })
  it('binds structural fallback without selecting a latest saved Version or live Draft', async () => {
    const row = payload(); row.classroom.authoring_guidance_version_id = null; row.context.source_blueprint_version_id = content; row.context.source_blueprint_version_number = 1
    abortSignal.mockResolvedValue(envelope(row)); expect((await run()).context?.source_blueprint_version_id).toBe(content)
    expect(rpc).toHaveBeenCalledOnce()
  })
  it.each(['source_blueprint_id', 'source_blueprint_version_id'] as const)('preserves historical partial/unlinked%s as null only', async key => {
    const row = payload(); row.classroom[key] = null
    abortSignal.mockResolvedValue(envelope({ ...row, context: null, version_parents: null })); expect(await run()).toEqual({ context: null })
    abortSignal.mockResolvedValue(envelope(row)); await expect(run()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('retains all500 assignment and200 Test titles', async () => {
    const row = payload(); row.context.course.assignment_titles = Array.from({ length: 500 }, (_, n) => `Assignment ${n}`)
    row.context.course.test_titles = Array.from({ length: 200 }, (_, n) => `Test ${n}`)
    abortSignal.mockResolvedValue(envelope(row)); expect((await run()).context?.course).toEqual(row.context.course)
  })
  it.each([
    (r: ReturnType<typeof payload>) => ({ ...r, actor_id: classroom }),
    (r: ReturnType<typeof payload>) => ({ ...r, classroom_id: actor }),
    (r: ReturnType<typeof payload>) => ({ ...r, classroom: { ...r.classroom, id: actor } }),
    (r: ReturnType<typeof payload>) => ({ ...r, classroom: { ...r.classroom, teacher_id: classroom } }),
    (r: ReturnType<typeof payload>) => ({ ...r, context: { ...r.context, blueprint_id: actor } }),
    (r: ReturnType<typeof payload>) => ({ ...r, context: { ...r.context, content_version_id: adopted } }),
    (r: ReturnType<typeof payload>) => ({ ...r, context: { ...r.context, source_blueprint_version_id: content } }),
    (r: ReturnType<typeof payload>) => ({ ...r, version_parents: { ...r.version_parents, content: actor } }),
    (r: ReturnType<typeof payload>) => ({ ...r, version_parents: { ...r.version_parents, guidance: actor } }),
    (r: ReturnType<typeof payload>) => ({ ...r, version_parents: null }),
    (r: ReturnType<typeof payload>) => ({ ...r, context: null }),
    (r: ReturnType<typeof payload>) => ({ ...r, private_answers: 'withheld' }),
    (r: ReturnType<typeof payload>) => ({ ...r, context: { ...r.context, source_draft_revision: -1 } }),
    (r: ReturnType<typeof payload>) => ({ ...r, context: { ...r.context, content_version_number: Number.MAX_SAFE_INTEGER + 1 } }),
    (r: ReturnType<typeof payload>) => ({ ...r, context: { ...r.context, guidance: { private: 'withheld' } } }),
    (r: ReturnType<typeof payload>) => ({ ...r, context: { ...r.context, course: { ...r.context.course, test_titles: [''] } } }),
  ])('rejects forged, malformed or widened binding%# without retry', async change => {
    abortSignal.mockResolvedValue(envelope(change(payload()))); await expect(run()).rejects.toMatchObject({ statusCode: 503 }); expect(rpc).toHaveBeenCalledOnce()
  })
  it.each([['PT400', 'invalid_argument', 400], ['PT404', 'missing', 404], ['PT403', 'forbidden', 403],
    ['PT503', 'fenced', 503], ['PT503', 'unavailable', 503], ['PT503', 'invalid', 503], ['PT503', 'too_large', 503]] as const)('maps only exact%s/%s', async (code, label, status) => {
    abortSignal.mockResolvedValue({ data: null, error: { code, message: `class_authoring_guidance_${label}`, details: null, hint: null }, status, statusText: 'Error', count: null })
    await expect(run()).rejects.toMatchObject({ statusCode: status }); expect(rpc).toHaveBeenCalledOnce()
  })
  it.each(['transport', 'unknown', 'mismatched-envelope'] as const)('sanitizes%s failure and does not fallback or retry', async kind => {
    if (kind === 'transport') abortSignal.mockRejectedValue(Error('private'))
    else abortSignal.mockResolvedValue({ data: null, error: { code: kind === 'unknown' ? '42501' : 'PT403', message: kind === 'unknown' ? 'private' : 'class_authoring_guidance_forbidden', details: null, hint: null }, status: 500, statusText: 'Error', count: null })
    await expect(run()).rejects.toMatchObject({ statusCode: 503, message: expect.not.stringContaining('private') }); expect(rpc).toHaveBeenCalledOnce()
  })
  it('rejects untrusted identities before SDK work', async () => {
    await expect(read({ supabase: { rpc } as never, actorId: 'bad', classroomId: classroom })).rejects.toMatchObject({ statusCode: 400 }); expect(rpc).not.toHaveBeenCalled()
  })
  it('counts UTF8 bytes rather than JavaScript character length', async () => {
    const row = payload(); row.context.course.title = 'é'.repeat(Math.floor(cap / 2))
    expect(JSON.stringify(envelope(row)).length).toBeLessThan(cap)
    expect(Buffer.byteLength(JSON.stringify(envelope(row)), 'utf8')).toBeGreaterThan(cap)
    abortSignal.mockResolvedValue(envelope(row)); await expect(run()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([0, 1])('applies exact private UTF8 wire boundary plus%s without truncation', async extra => {
    const row = payload(); row.context.course.title = 'x'.repeat(cap - Buffer.byteLength(JSON.stringify(envelope(row))) + extra + row.context.course.title.length)
    expect(Buffer.byteLength(JSON.stringify(envelope(row)))).toBe(cap + extra)
    abortSignal.mockResolvedValue(envelope(row)); if (extra) await expect(run()).rejects.toMatchObject({ statusCode: 503 }); else expect((await run()).context?.course.title).toBe(row.context.course.title)
  })
})
