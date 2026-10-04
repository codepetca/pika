import { describe, expect, it, vi } from 'vitest'
import type { getServiceRoleClient } from '@/lib/supabase'
import { readContextualTestList } from '@/lib/server/contextual-test-list-read'

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`
const actorId = uuid(1); const classroomId = uuid(2); const studentId = uuid(3)
const time = '2026-10-04T12:00:00.000Z'
const classroom = { id: classroomId, teacher_id: actorId, archived_at: null }
const test = (n = 10) => ({ id: uuid(n), classroom_id: classroomId, title: 'Canonical', status: 'active' as const,
  show_results: false, documents: [], position: n, points_possible: 10, include_in_final: true, created_by: actorId, created_at: time, updated_at: time,
  artifact_id: uuid(n + 100), source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null,
  gradebook_category_id: null, gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 1, questions_locked_at: null })
type Operation = [string, ...unknown[]]
type Call = { select: string; ops: Operation[] }
type Row = Record<string, unknown>
function fixture(options: {
  tests?: Row[]; enrollments?: Row[]; questions?: Row[]; attempts?: Row[]; responses?: Row[]; availability?: Row[]; drafts?: Row[];
  cap?: number; intercept?: (row: Row, call: Call, index: number) => unknown;
  reply?: (row: Row, call: Call, index: number) => unknown;
} = {}) {
  const tests = options.tests ?? [test()]; const enrollments = options.enrollments ?? [{ classroom_id: classroomId, student_id: studentId }]
  const calls: Call[] = []
  const from = vi.fn(() => {
    const call: Call = { select: '', ops: [] }; calls.push(call)
    const query = {
      select(value: string) { call.select = value; return query },
      eq(...args: unknown[]) { call.ops.push(['eq', ...args]); return query },
      neq(...args: unknown[]) { call.ops.push(['neq', ...args]); return query },
      in(...args: unknown[]) { call.ops.push(['in', ...args]); return query },
      gt(...args: unknown[]) { call.ops.push(['gt', ...args]); return query },
      or(...args: unknown[]) { call.ops.push(['or', ...args]); return query },
      order(...args: unknown[]) { call.ops.push(['order', ...args]); return query },
      limit(...args: unknown[]) { call.ops.push(['limit', ...args]); return query },
      abortSignal(signal: AbortSignal) { call.ops.push(['abortSignal', signal]); return query },
      async maybeSingle() {
        const value = (kind: string, field: string, rows: Row[]) => {
          const cursor = call.ops.find(o => o[0] === 'gt' && o[1] === `${kind}.${field}`)?.[2]
          const limit = call.ops.find(o => o[0] === 'limit' && (o[2] as { referencedTable?: string })?.referencedTable === kind)?.[1]
          return rows.filter(row => typeof cursor !== 'string' || String(row[field]) > cursor)
            .sort((a, b) => String(a[field]).localeCompare(String(b[field]))).slice(0, Math.min(Number(limit ?? 1000), options.cap ?? 1000))
        }
        const row: Row = { ...classroom }
        if (call.select.includes('enrollments:')) row.enrollments = value('enrollments', 'student_id', enrollments.filter(e => e.student_id !== actorId))
        if (call.select.includes('tests:')) {
          const ids = call.ops.find(o => o[0] === 'in' && o[1] === 'tests.id')?.[2]
          const batch = Array.isArray(ids) ? tests.filter(t => ids.includes(t.id)) : value('tests', 'id', tests)
          row.tests = batch.map(t => {
            if (!call.select.includes('tests!tests_classroom_id_fkey!inner')) return t
            const parent: Row = { id: t.id, classroom_id: t.classroom_id, status: t.status, updated_at: t.updated_at }
            for (const kind of ['questions', 'attempts', 'responses', 'availability'] as const) {
              if (call.select.includes(`${kind}:`)) parent[kind] = value(`tests.${kind}`, 'id', (options[kind] ?? []).filter(r => {
                if (r.test_id !== t.id) return false
                if (kind === 'questions') return true
                if (r.student_id === actorId) return false
                const joined = r.participant
                return typeof joined === 'object' && joined !== null && 'enrollment' in joined && Array.isArray(joined.enrollment)
                  && joined.enrollment.some(e => e.classroom_id === classroomId)
              }))
            }
            return parent
          })
        }
        if (call.select.includes('drafts:')) row.drafts = value('drafts', 'id', options.drafts ?? [])
        if (options.reply) return options.reply(row, call, calls.length)
        return { data: options.intercept ? options.intercept(row, call, calls.length) : row, error: null }
      },
    }
    return query
  })
  const client = { from } as unknown as ReturnType<typeof getServiceRoleClient>
  return { calls, from, read: () => readContextualTestList({ supabase: client, actorId, classroomId }) }
}
const participant = (id = studentId) => ({ id, enrollment: [{ classroom_id: classroomId, student_id: id }] })
const response = (n: number, selected_option: number | null = null, response_text: string | null = null) => ({ id: uuid(n), test_id: uuid(10), student_id: studentId, selected_option, response_text, participant: participant() })
const draft = { id: uuid(70), assessment_id: uuid(10), assessment_type: 'test', classroom_id: classroomId, version: 1,
  content: { title: 'Overlay', show_results: true, questions: [{ id: uuid(80), question_type: 'open_response', question_text: 'Draft', options: [],
    correct_option: null, answer_key: 'private key', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false }] } }

describe('current owner Test list read', () => {
  it('preserves the full Test DTO and all six stats without child data', async () => {
    const f = fixture({ questions: [{ id: uuid(30), test_id: uuid(10) }], attempts: [{ id: uuid(40), test_id: uuid(10), student_id: studentId, is_submitted: true, participant: participant() }],
      responses: [response(50, 0), response(51, null, 'more')], availability: [{ id: uuid(60), test_id: uuid(10), student_id: studentId, state: 'closed', participant: participant() }] })
    expect(await f.read()).toEqual({ tests: [{ ...test(), assessment_type: 'test', stats: { total_students: 1, responded: 1, submitted: 1, open_access: 0, closed_access: 1, questions_count: 1 } }] })
    expect(f.calls.every(c => c.ops.some(o => o[0] === 'abortSignal'))).toBe(true)
    for (const call of f.calls.slice(1)) {
      expect(call.ops).toContainEqual(['eq', 'id', classroomId]); expect(call.ops).toContainEqual(['eq', 'teacher_id', actorId])
      if (call.select.includes('!inner(id,classroom_id,status,updated_at')) {
        expect(call.ops).toContainEqual(['eq', 'tests.classroom_id', classroomId])
        expect(call.ops).toContainEqual(['in', 'tests.id', [uuid(10)]])
        expect(call.ops).toContainEqual(['or', `and(id.eq.${uuid(10)},status.eq.active,updated_at.eq.${time})`, { referencedTable: 'tests' }])
        expect(call.ops).toContainEqual(['limit', 50, { referencedTable: 'tests' }])
      }
      if (call.select.includes('participant:')) {
        expect(call.select).toContain('classroom_enrollments_student_id_fkey!inner(classroom_id,student_id)')
        const kind = ['attempts', 'responses', 'availability'].find(k => call.select.includes(`${k}:`))
        expect(call.ops).toContainEqual(['neq', `tests.${kind}.student_id`, actorId])
        expect(call.ops).toContainEqual(['eq', `tests.${kind}.participant.enrollment.classroom_id`, classroomId])
      }
    }
  })
  it('allows archived owners and excludes owner self enrollment', async () => {
    const f = fixture({ enrollments: [{ classroom_id: classroomId, student_id: actorId }], intercept: row => ({ ...row, archived_at: time }) })
    expect((await f.read()).tests[0].stats.total_students).toBe(0)
  })
  it('returns 404 for missing Classes and rejects malformed caller identity before discovery', async () => {
    await expect(fixture({ intercept: () => null }).read()).rejects.toMatchObject({ statusCode: 404 })
    const f = fixture()
    await expect(readContextualTestList({ supabase: { from: f.from } as unknown as ReturnType<typeof getServiceRoleClient>, actorId: 'bad', classroomId })).rejects.toMatchObject({ statusCode: 400 })
    expect(f.from).not.toHaveBeenCalled()
  })
  it('returns an empty list only after a current final statement', async () => {
    const f = fixture({ tests: [] }); expect(await f.read()).toEqual({ tests: [] }); expect(f.calls.length).toBeGreaterThan(3)
  })
  it('denies membership or global labels without current ownership before payload discovery', async () => {
    const f = fixture({ intercept: row => ({ ...row, teacher_id: uuid(99) }) }); await expect(f.read()).rejects.toMatchObject({ statusCode: 403 }); expect(f.calls).toHaveLength(1)
  })
  it('does not count whitespace or placeholders as meaningful responses', async () => {
    expect((await fixture({ responses: [response(50, null, '  '), response(51)] }).read()).tests[0].stats.responded).toBe(0)
    expect((await fixture({ responses: [response(50, 0)] }).read()).tests[0].stats.responded).toBe(1)
  })
  it.each(['draft', 'active', 'closed'] as const)('computes availability for %s', async status => {
    const f = fixture({ tests: [{ ...test(), status }], availability: [{ id: uuid(60), test_id: uuid(10), student_id: studentId, state: 'open', participant: participant() }] })
    expect((await f.read()).tests[0].stats.open_access).toBe(status === 'draft' ? 0 : 1)
  })
  it('continues uneven and short child pages through terminal empty pages', async () => {
    const tests = [test(10), test(11)]; const questions = [30, 31, 32].map(n => ({ id: uuid(n), test_id: uuid(10) })).concat([{ id: uuid(50), test_id: uuid(11) }])
    const f = fixture({ tests, questions, cap: 2 }); const result = await f.read()
    expect(result.tests.map(t => t.stats.questions_count)).toEqual([1, 3]); expect(f.calls.filter(c => c.select.includes('questions:')).length).toBeGreaterThan(2)
  })
  it.each([{ classroom_id: uuid(99) }, { secret: true }])('rejects full Test substitutions %#', async patch => {
    await expect(fixture({ tests: [{ ...test(), ...patch }] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects parent status drift and ownership loss on terminal pages', async () => {
    await expect(fixture({ intercept: (row, c) => c.select.includes('questions:') ? { ...row, tests: [{ id: uuid(10), classroom_id: classroomId, status: 'closed', updated_at: time, questions: [] }] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ intercept: (row, c) => c.ops.some(o => o[0] === 'gt') ? null : row }).read()).rejects.toMatchObject({ statusCode: 403 })
  })
  it('rejects participant cross substitution and roster loss', async () => {
    await expect(fixture({ responses: [{ ...response(50), participant: participant(uuid(99)) }] }).read()).rejects.toMatchObject({ statusCode: 503 })
    let rosterReads = 0
    await expect(fixture({ intercept: (row, c) => c.select.includes('enrollments:') && ++rosterReads > 2 ? { ...row, enrollments: [] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects malformed and oversized persisted JSON', async () => {
    await expect(fixture({ tests: [{ ...test(), title: 'x'.repeat(9 * 1024 * 1024) }] }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ intercept: row => ({ ...row, unknown: true }) }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('uses validated overlays only for drafts and never exposes raw draft or response content', async () => {
    for (const status of ['draft', 'active', 'closed'] as const) {
      const result = await fixture({ tests: [{ ...test(), status }], drafts: [draft], responses: [response(50, null, 'private response')] }).read()
      expect(result.tests[0].title).toBe(status === 'draft' ? 'Overlay' : 'Canonical')
      expect(result.tests[0].show_results).toBe(status === 'draft')
      expect(result.tests[0].stats.questions_count).toBe(status === 'draft' ? 1 : 0)
      expect(JSON.stringify(result)).not.toMatch(/private key|private response|participant|student_id|draft_version/)
    }
    expect((await fixture({ tests: [{ ...test(), status: 'draft' }], drafts: [{ ...draft, content: { bad: true } }] }).read()).tests[0].title).toBe('Canonical')
  })
  it.each([{ classroom_id: uuid(99) }, { assessment_id: uuid(99) }, { assessment_type: 'assignment' }, { secret: true }])('rejects draft identity or schema substitution %#', async patch => {
    await expect(fixture({ drafts: [{ ...draft, ...patch }] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects multiple drafts for one Test and preserves draft keyset terminal proof', async () => {
    await expect(fixture({ drafts: [draft, { ...draft, id: uuid(71) }] }).read()).rejects.toMatchObject({ statusCode: 503 })
    const f = fixture({ drafts: [draft] }); await f.read()
    const reads = f.calls.filter(c => c.select.includes('drafts:'))
    expect(reads).toHaveLength(2); expect(reads[0].select).toContain('assessment_drafts_classroom_id_fkey')
    expect(reads[0].ops).toContainEqual(['eq', 'drafts.classroom_id', classroomId]); expect(reads[0].ops).toContainEqual(['eq', 'drafts.assessment_type', 'test'])
    expect(reads[0].ops).toContainEqual(['in', 'drafts.assessment_id', [uuid(10)]]); expect(reads[1].ops).toContainEqual(['gt', 'drafts.id', draft.id])
  })
  it('preserves normalized persisted documents and stored MIME without external capabilities', async () => {
    const documents = [{ id: ' upload ', title: ' PDF ', source: 'upload', storage_bucket: 'test-documents', storage_path: 'class/test.pdf', upload_content_type: 'APPLICATION/PDF' },
      { id: 'link', title: 'Reference', source: 'link', url: 'https://example.test/reference', snapshot_path: 'snapshot.pdf', snapshot_content_type: 'application/pdf' }]
    const result = await fixture({ tests: [{ ...test(), documents }] }).read()
    expect(result.tests[0].documents).toEqual([{ id: 'upload', title: 'PDF', source: 'upload', storage_bucket: 'test-documents', storage_path: 'class/test.pdf', upload_content_type: 'application/pdf' }, documents[1]])
  })
  it('includes teacher-valued members and excludes removed membership history', async () => {
    // No global-role column participates in roster admission. A formerly enrolled
    // participant's history disappears through the actual inner enrollment join.
    const removed = uuid(4)
    const f = fixture({ responses: [response(50, 0), { ...response(51, 0), student_id: removed, participant: { id: removed, enrollment: [] } }] })
    const result = await f.read()
    expect(result.tests[0].stats).toMatchObject({ total_students: 1, responded: 1 })
    expect(f.calls.every(c => !c.select.includes('role'))).toBe(true)
  })
  it('fails closed if an excluded historical participant is substituted into the returned rows', async () => {
    const removed = uuid(4)
    await expect(fixture({ responses: [{ ...response(50, 0), student_id: removed, participant: participant(removed) }] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('requires the complete exact Test batch on stats, draft and final statements', async () => {
    for (const target of ['questions:', 'drafts:', 'final']) {
      const f = fixture({ tests: [test(10), test(11)], intercept: (row, call) => (target === 'final'
        ? call.select.endsWith('!inner(id,classroom_id,status,updated_at)') : call.select.includes(target)) ? { ...row, tests: [] } : row })
      await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    }
  })
  it('checks current owner authority on final empty-roster and final Test control statements', async () => {
    for (const target of ['roster', 'test']) {
      let roster = 0
      const f = fixture({ intercept: (row, call) => (target === 'roster'
        ? call.select.includes('enrollments:') && ++roster === 4 : call.select.endsWith('!inner(id,classroom_id,status,updated_at)')) ? null : row })
      await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
    }
  })
  it('rejects invalid participant cardinality on a statistics statement', async () => {
    for (const enrollment of [[], [{ classroom_id: classroomId, student_id: studentId }, { classroom_id: classroomId, student_id: studentId }], [{ classroom_id: uuid(99), student_id: studentId }]]) {
      await expect(fixture({ intercept: (row, c) => c.select.includes('responses:') ? { ...row, tests: [{ id: uuid(10), classroom_id: classroomId, status: 'active', updated_at: time,
        responses: [{ ...response(50, 0), participant: { id: studentId, enrollment } }] }] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
    }
  })
  it('rejects reparenting, altered update controls and unknown child fields', async () => {
    for (const patch of [{ classroom_id: uuid(99) }, { updated_at: '2026-10-04T13:00:00.000Z' }]) {
      await expect(fixture({ intercept: (row, c) => c.select.includes('questions:') ? { ...row, tests: [{ id: uuid(10), classroom_id: classroomId, status: 'active', updated_at: time, ...patch, questions: [] }] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
    }
    await expect(fixture({ questions: [{ id: uuid(30), test_id: uuid(10), answer_key: 'not permitted' }] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects duplicate/nonadvancing child IDs and duplicated availability participants', async () => {
    await expect(fixture({ questions: [{ id: uuid(30), test_id: uuid(10) }, { id: uuid(30), test_id: uuid(10) }] }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ intercept: (row, c) => c.select.includes('questions:') ? { ...row, tests: [{ id: uuid(10), classroom_id: classroomId, status: 'active', updated_at: time, questions: [{ id: uuid(30), test_id: uuid(10) }] }] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
    const availability = [60, 61].map(n => ({ id: uuid(n), test_id: uuid(10), student_id: studentId, state: 'open', participant: participant() }))
    await expect(fixture({ availability }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('paginates Test and roster discovery beyond 1000 rows', async () => {
    const tests = Array.from({ length: 1001 }, (_, n) => test(n + 100))
    const enrollments = Array.from({ length: 1001 }, (_, n) => ({ classroom_id: classroomId, student_id: uuid(n + 20000) }))
    const f = fixture({ tests, enrollments }); const result = await f.read()
    expect(result.tests).toHaveLength(1001); expect(result.tests[0].stats.total_students).toBe(1001)
    expect(f.calls.filter(c => c.select.includes('tests:') && !c.select.includes('!inner'))).toHaveLength(3)
    expect(f.calls.filter(c => c.select.includes('enrollments:'))).toHaveLength(6)
  })
  it('bounds page, collection and statement counts without returning partial results', async () => {
    const questions = Array.from({ length: 10001 }, (_, n) => ({ id: uuid(n + 30000), test_id: uuid(10) }))
    await expect(fixture({ questions }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ intercept: (row, c) => c.select.includes('questions:') ? { ...row, tests: [{ id: uuid(10), classroom_id: classroomId, status: 'active', updated_at: time, questions: questions.slice(0, 101) }] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
    const f = fixture({ questions: questions.slice(0, 1100), cap: 1 })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.calls.length).toBeLessThanOrEqual(1025)
  })
  it('bounds aggregate collected rows across otherwise valid finite child pages', async () => {
    const tests = Array.from({ length: 50 }, (_, n) => test(100 + n))
    const questions = Array.from({ length: 100050 }, (_, n) => ({ id: uuid(n + 30000), test_id: uuid(100 + n % 50) }))
    const f = fixture({ tests, questions })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.calls.length).toBeLessThan(100)
  })
  it('bounds cumulative decoded bytes even when each uneven child statement is below the byte cap', async () => {
    const tests = Array.from({ length: 20 }, (_, n) => test(100 + n))
    const responses = tests.map((test, n) => ({ ...response(500 + n, null, 'x'.repeat(360000)), test_id: test.id }))
    const f = fixture({ tests, responses })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.calls.length).toBeLessThan(100)
  })
  it('fails missing contextual tables/FKs and unexpected transport envelopes', async () => {
    for (const code of ['PGRST205', 'PGRST200']) {
      await expect(fixture({ reply: (row, c) => c.select.includes('attempts:') ? { data: null, error: { code, message: 'missing' } } : { data: row, error: null } }).read()).rejects.toMatchObject({ statusCode: 503 })
    }
    await expect(fixture({ reply: row => ({ data: row, error: null, extra: true }) }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('aborts an unresponsive statement at the overall deadline', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture({ reply: () => new Promise(() => {}) })
      const pending = expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
      await vi.advanceTimersByTimeAsync(20000); await pending
      const signal = f.calls[0].ops.find(o => o[0] === 'abortSignal')?.[1]
      expect(signal).toBeInstanceOf(AbortSignal); expect((signal as AbortSignal).aborted).toBe(true)
    } finally { vi.useRealTimers() }
  })
})
