import { afterEach, describe, expect, it, vi } from 'vitest'
import type { getServiceRoleClient } from '@/lib/supabase'
import { ApiError } from '@/lib/api-error'
import { readContextualStudentTestList } from '@/lib/server/contextual-student-test-list-read'

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`
const actorId = uuid(1); const classroomId = uuid(2); const ownerId = uuid(3)
const time = '2026-10-08T12:00:00.000Z'
const classroom = { id: classroomId, teacher_id: ownerId, archived_at: null }
const test = (n = 10) => ({ id: uuid(n), classroom_id: classroomId, title: 'Canonical', status: 'active',
  show_results: false, documents: [], position: n, points_possible: 10, include_in_final: true, gradebook_weight: 1,
  created_by: ownerId, created_at: time, updated_at: time })
type Row = Record<string, unknown>
type Call = { select: string; ops: [string, ...unknown[]][] }
const attempt = (n = 40, parent = 10) => ({ id: uuid(n), test_id: uuid(parent), student_id: actorId,
  is_submitted: false, returned_at: null, closed_for_grading_at: null })
const response = (n = 50, parent = 10) => ({ id: uuid(n), test_id: uuid(parent), student_id: actorId,
  selected_option: null, response_text: null })
const availability = (n = 60, parent = 10) => ({ id: uuid(n), test_id: uuid(parent), student_id: actorId, state: 'open' })
function fixture(options: { tests?: Row[]; attempts?: Row[]; responses?: Row[]; availability?: Row[]; cap?: number;
  intercept?: (row: Row, call: Call, index: number) => unknown; reply?: (row: Row, call: Call, index: number) => unknown } = {}) {
  const tests = options.tests ?? [test()]; const calls: Call[] = []
  const kinds = ['attempts', 'responses', 'availability'] as const
  const indexed = new Map(kinds.map(kind => {
    const byParent = new Map<unknown, Row[]>()
    for (const row of options[kind] ?? []) { const rows = byParent.get(row.test_id) ?? []; rows.push(row); byParent.set(row.test_id, rows) }
    return [kind, byParent]
  }))
  const from = vi.fn((table: string) => {
    expect(table).toBe('classrooms')
    const call: Call = { select: '', ops: [] }; calls.push(call)
    const query = {
      select(value: string) { call.select = value; return query },
      eq(...args: unknown[]) { call.ops.push(['eq', ...args]); return query },
      neq(...args: unknown[]) { call.ops.push(['neq', ...args]); return query },
      is(...args: unknown[]) { call.ops.push(['is', ...args]); return query },
      filter(...args: unknown[]) { call.ops.push(['filter', ...args]); return query },
      in(...args: unknown[]) { call.ops.push(['in', ...args]); return query },
      gt(...args: unknown[]) { call.ops.push(['gt', ...args]); return query },
      or(...args: unknown[]) { call.ops.push(['or', ...args]); return query },
      order(...args: unknown[]) { call.ops.push(['order', ...args]); return query },
      limit(...args: unknown[]) { call.ops.push(['limit', ...args]); return query },
      abortSignal(signal: AbortSignal) { call.ops.push(['abortSignal', signal]); return query },
      async maybeSingle() {
        const page = (reference: string, rows: Row[]) => {
          const cursor = call.ops.find(o => o[0] === 'gt' && o[1] === `${reference}.id`)?.[2]
          const limit = call.ops.find(o => o[0] === 'limit' && (o[2] as { referencedTable?: string })?.referencedTable === reference)?.[1]
          return rows.filter(r => typeof cursor !== 'string' || String(r.id) > cursor).sort((a, b) => String(a.id).localeCompare(String(b.id)))
            .slice(0, Math.min(Number(limit ?? 1000), options.cap ?? 1000))
        }
        const row: Row = { ...classroom }
        if (call.select.includes('membership:')) { row.feature_visibility = {}; row.membership = [{ classroom_id: classroomId, student_id: actorId }] }
        if (call.select.includes('tests:')) {
          const ids = call.ops.find(o => o[0] === 'in' && o[1] === 'tests.id')?.[2]
          const batch = Array.isArray(ids) ? tests.filter(t => ids.includes(t.id)) : page('tests', tests.filter(t => t.status === 'active' || t.status === 'closed'))
          row.tests = batch.map(t => {
            if (!call.select.includes('tests_classroom_id_fkey!inner')) return { ...t }
            const parent: Row = { id: t.id, classroom_id: t.classroom_id, status: t.status, updated_at: t.updated_at }
            for (const kind of kinds) if (call.select.includes(`${kind}:`)) parent[kind] = page(`tests.${kind}`, (indexed.get(kind)?.get(t.id) ?? []).filter(r => r.student_id === actorId))
            return parent
          })
        }
        if (options.reply) return options.reply(row, call, calls.length)
        return { data: options.intercept ? options.intercept(row, call, calls.length) : row, error: null }
      },
    }
    return query
  })
  const client = { from } as unknown as ReturnType<typeof getServiceRoleClient>
  return { calls, from, client, read: () => readContextualStudentTestList({ supabase: client, actorId, classroomId }) }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
describe('bounded contextual member Test list', () => {
  it('preserves exact learner DTO and binds every payload, child and final statement', async () => {
    const f = fixture({ responses: [{ ...response(), selected_option: 0 }] })
    const result = await f.read()
    expect(result.tests[0]).toEqual({ ...test(), assessment_type: 'test', student_status: 'responded', access_state: null, effective_access: 'open' })
    for (const call of f.calls.slice(1)) {
      expect(call.select).toContain('membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)')
      expect(call.ops).toContainEqual(['eq', 'id', classroomId]); expect(call.ops).toContainEqual(['neq', 'teacher_id', actorId])
      expect(call.ops).toContainEqual(['is', 'archived_at', null]); expect(call.ops).toContainEqual(['eq', 'membership.student_id', actorId])
      expect(call.ops).toContainEqual(['eq', 'membership.classroom_id', classroomId]); expect(call.ops.some(o => o[0] === 'abortSignal')).toBe(true)
      if (call.select.includes('tests:')) expect(call.ops).toContainEqual(['in', 'tests.status', ['active', 'closed']])
      if (call.select.includes('tests_classroom_id_fkey!inner')) {
        expect(call.ops).toContainEqual(['eq', 'tests.classroom_id', classroomId])
        expect(call.ops).toContainEqual(['or', `and(id.eq.${uuid(10)},status.eq.active,updated_at.eq.${time})`, { referencedTable: 'tests' }])
      }
      for (const kind of ['attempts', 'responses', 'availability']) if (call.select.includes(`${kind}:`)) expect(call.ops).toContainEqual(['eq', `tests.${kind}.student_id`, actorId])
      expect(call.select).not.toMatch(/question|answer_key|feedback|grade_completion|drafts:|participant:|\*/)
    }
    expect(f.calls.slice(2).every(c => c.ops.some(o => o[0] === 'filter' && o[1] === 'feature_visibility'))).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/student_id|response_text|is_submitted|returned_at/)
  })
  it('validates identity before constructing discovery', async () => {
    const f = fixture()
    await expect(readContextualStudentTestList({ supabase: f.client, actorId: 'bad', classroomId })).rejects.toMatchObject({ statusCode: 400 })
    expect(f.from).not.toHaveBeenCalled()
  })
  it.each([{ teacher_id: actorId }, { archived_at: time }])('denies owner precedence and archived member %#', async patch => {
    const f = fixture({ intercept: row => ({ ...row, ...patch }) }); await expect(f.read()).rejects.toMatchObject({ statusCode: 403 }); expect(f.calls).toHaveLength(1)
  })
  it('denies hidden Tests before payload discovery', async () => {
    const f = fixture({ intercept: (row, call) => call.select.includes('membership:') ? { ...row, feature_visibility: { tests: false } } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 403 }); expect(f.calls).toHaveLength(2)
  })
  it.each([[], [{ classroom_id: uuid(99), student_id: actorId }], [{ classroom_id: classroomId, student_id: uuid(99) }],
    [{ classroom_id: classroomId, student_id: actorId }, { classroom_id: classroomId, student_id: actorId }]])('rejects invalid membership %#', async membership => {
    await expect(fixture({ intercept: (row, c) => c.select.includes('membership:') ? { ...row, membership } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('returns 404 for absent Class and verifies empty collections through final authority', async () => {
    await expect(fixture({ intercept: () => null }).read()).rejects.toMatchObject({ statusCode: 404 })
    const f = fixture({ tests: [] }); expect(await f.read()).toEqual({ tests: [] }); expect(f.calls.length).toBeGreaterThan(3)
  })
  it('never reads drafts and preserves active/closed ordering', async () => {
    const f = fixture({ tests: [test(10), { ...test(11), status: 'closed' }, { ...test(12), status: 'draft' }] })
    expect((await f.read()).tests.map(t => t.id)).toEqual([uuid(10), uuid(11)])
  })
  it.each([{ response_text: '  ' }, { response_text: null }, { selected_option: 0 }, { response_text: 'answer' }])('preserves meaningful response semantics %#', async patch => {
    const result = await fixture({ responses: [{ ...response(), ...patch }] }).read()
    expect(result.tests[0].student_status).toBe('selected_option' in patch || patch.response_text?.trim() ? 'responded' : 'not_started')
  })
  it.each([
    { is_submitted: true }, { closed_for_grading_at: time }, { is_submitted: true, returned_at: time },
  ])('preserves submitted, locked and returned status %#', async patch => {
    const result = await fixture({ tests: [{ ...test(), status: 'closed' }], attempts: [{ ...attempt(), ...patch }] }).read()
    expect(result.tests[0].student_status).toBe('returned_at' in patch ? 'can_view_results' : 'responded')
  })
  it('allows repeated own responses but rejects repeated own attempt and availability', async () => {
    expect((await fixture({ responses: [response(50), { ...response(51), selected_option: 0 }] }).read()).tests[0].student_status).toBe('responded')
    await expect(fixture({ attempts: [attempt(40), attempt(41)] }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ availability: [availability(60), availability(61)] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('normalizes accessible documents and removes documents from closed unstarted Tests', async () => {
    const documents = [{ id: ' d ', title: ' PDF ', source: 'upload', storage_path: 'class/test.pdf', upload_content_type: 'APPLICATION/PDF' }]
    expect((await fixture({ tests: [{ ...test(), documents }] }).read()).tests[0].documents).toEqual([{ id: 'd', title: 'PDF', source: 'upload', storage_bucket: 'test-documents', storage_path: 'class/test.pdf', upload_content_type: 'application/pdf' }])
    expect((await fixture({ tests: [{ ...test(), status: 'closed', documents }] }).read()).tests[0].documents).toEqual([])
    expect((await fixture({ tests: [{ ...test(), status: 'closed', documents }], attempts: [{ ...attempt(), is_submitted: true }] }).read()).tests[0].documents).toHaveLength(1)
  })
  it('collects uneven short pages and terminal empties without skipping sibling responses', async () => {
    const f = fixture({ tests: [test(10), test(11)], cap: 2, responses: [response(30), response(31), { ...response(32), selected_option: 0 }, { ...response(50, 11), response_text: 'meaningful' }] })
    expect((await f.read()).tests.map(t => t.student_status)).toEqual(['responded', 'responded'])
    expect(f.calls.filter(c => c.select.includes('responses:')).length).toBeGreaterThan(4)
  })
  it.each([{ classroom_id: uuid(99) }, { status: 'draft' }, { answer_key: 'private' }, { gradebook_weight: Infinity }])('rejects substituted Test projection %#', async patch => {
    await expect(fixture({ tests: [{ ...test(), ...patch }], intercept: (row, c) => patch.status === 'draft' && c.select.includes('tests:') && !c.select.includes('!inner(id') ? { ...row, tests: [{ ...test(), ...patch }] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([{ test_id: uuid(99) }, { student_id: uuid(99) }, { answer_key: 'private' }, { selected_option: -1 }])('rejects returned child identities and fields %#', async patch => {
    await expect(fixture({ intercept: (row, c) => c.select.includes('responses:') ? { ...row, tests: [{ id: uuid(10), classroom_id: classroomId, status: 'active', updated_at: time, responses: [{ ...response(), ...patch }] }] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['status', 'updated_at', 'classroom_id'])('rejects changed parent %s even on terminal child pages', async field => {
    await expect(fixture({ intercept: (row, c) => c.select.includes('responses:') ? { ...row, tests: [{ id: uuid(10), classroom_id: classroomId, status: 'active', updated_at: time, [field]: field === 'status' ? 'closed' : field === 'classroom_id' ? uuid(99) : '2026-10-08T13:00:00.000Z', responses: [] }] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects membership loss on terminal and final statements', async () => {
    for (const final of [false, true]) {
      const f = fixture({ intercept: (row, c, n) => (final ? n > 8 : c.ops.some(o => o[0] === 'gt')) ? null : row })
      await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
    }
  })
  it('rejects final availability and return-control drift', async () => {
    for (const kind of ['availability', 'attempts'] as const) {
      let reads = 0
      const f = fixture({ [kind]: kind === 'availability' ? [availability()] : [attempt()], intercept: (row, c) => {
        if (!c.select.includes(`${kind}:`) || ++reads <= 2) return row
        const parent = (row.tests as Row[])[0]; const children = parent[kind] as Row[]
        return { ...row, tests: [{ ...parent, [kind]: children.map(r => ({ ...r, ...(kind === 'availability' ? { state: 'closed' } : { returned_at: time }) })) }] }
      } })
      await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    }
  })
  it('rejects final Test collection incompleteness and feature drift', async () => {
    let discoveries = 0
    await expect(fixture({ intercept: (row, c) => c.select.includes('tests:') && !c.select.includes('tests_classroom_id_fkey!inner') && ++discoveries > 2 ? { ...row, tests: [] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ intercept: (row, c, n) => n > 2 ? { ...row, feature_visibility: { tests: true } } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects duplicate/nonadvancing Test and child IDs', async () => {
    await expect(fixture({ tests: [test(), test()] }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ responses: [response(), response()] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('fails closed on rejected SDK errors without exposing their status or message', async () => {
    for (const error of [new Error('private transport'), new ApiError(418, 'private SDK error')]) {
      await expect(fixture({ reply: () => Promise.reject(error) }).read()).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify classroom tests' })
    }
    await expect(fixture({ reply: () => ({ data: null, error: { code: 'PGRST205' } }) }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('bounds decoded DTO bytes and recursion before schema decoding', async () => {
    await expect(fixture({ tests: [{ ...test(), title: 'x'.repeat(9 * 1024 * 1024) }] }).read()).rejects.toMatchObject({ statusCode: 503 })
    const cycle: Row = {}; cycle.self = cycle
    await expect(fixture({ reply: () => ({ data: cycle, error: null }) }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('enforces per-Test collection caps without returning partial responses', async () => {
    const responses = Array.from({ length: 10001 }, (_, i) => response(100000 + i))
    await expect(fixture({ responses }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('enforces the complete Test collection cap', async () => {
    await expect(fixture({ tests: Array.from({ length: 10001 }, (_, i) => test(10 + i)) }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects foreign actor history if substituted into returned own-state rows', async () => {
    const f = fixture({ responses: [{ ...response(), student_id: uuid(99), selected_option: 0 }] })
    expect((await f.read()).tests[0].student_status).toBe('not_started')
    expect(f.calls.every(c => !c.select.includes('role') && !c.select.includes('entitlement'))).toBe(true)
  })
  it('requires the complete exact parent batch on final control statements', async () => {
    await expect(fixture({ intercept: (row, c) => c.select.endsWith('tests_classroom_id_fkey!inner(id,classroom_id,status,updated_at)') ? { ...row, tests: [] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects oversized child pages before accepting partial collection data', async () => {
    await expect(fixture({ intercept: (row, c) => c.select.includes('responses:') ? { ...row, tests: [{ id: uuid(10), classroom_id: classroomId, status: 'active', updated_at: time,
      responses: Array.from({ length: 101 }, (_, i) => response(100000 + i)) }] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('enforces aggregate rows across revalidation and bounded batches', async () => {
    const tests = Array.from({ length: 50 }, (_, i) => test(10 + i))
    const responses = tests.flatMap((_, parent) => Array.from({ length: 1001 }, (_, i) => response(100000 + i * 50 + parent, 10 + parent)))
    const f = fixture({ tests, responses })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.calls.length).toBeLessThan(1024)
  })
  it('enforces the fixed statement budget for tiny server pages', async () => {
    const f = fixture({ tests: Array.from({ length: 1100 }, (_, i) => test(10 + i)), cap: 1 })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.calls).toHaveLength(1025)
  })
  it('enforces cumulative bytes across independently valid decoded pages', async () => {
    const title = 'x'.repeat(512 * 1024)
    const f = fixture({ tests: Array.from({ length: 70 }, (_, i) => ({ ...test(10 + i), title })), cap: 8 })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.calls.filter(c => c.select.includes('tests:') && !c.select.includes('tests_classroom_id_fkey!inner')).length).toBeGreaterThan(10)
  })
  it('rejects oversized final DTO even when individual pages and cumulative bytes fit', async () => {
    const f = fixture({ tests: Array.from({ length: 45 }, (_, i) => ({ ...test(10 + i), title: 'x'.repeat(200 * 1024) })), cap: 1 })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.calls.at(-1)?.select).not.toContain('tests:')
  })
  it('checks elapsed time even if the deadline timer has not fired', async () => {
    const now = Date.now(); let checks = 0
    vi.spyOn(Date, 'now').mockImplementation(() => ++checks > 2 ? now + 20000 : now)
    await expect(fixture().read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('aborts stalled SDK work at the fixed deadline', async () => {
    vi.useFakeTimers()
    const f = fixture({ reply: () => new Promise(() => {}) }); const pending = expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(20001); await pending
    expect((f.calls[0].ops.find(o => o[0] === 'abortSignal')?.[1] as AbortSignal).aborted).toBe(true)
  })
})
