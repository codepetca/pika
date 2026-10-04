import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authorizeSharedTestDetailReadActor, readContextualTestDetail } from '@/lib/server/contextual-test-detail-read'
import { requireAuth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-10-01T12:00:00Z'
const classroom = { id: classroomId, teacher_id: actorId, archived_at: null }
const test = { id: testId, classroom_id: classroomId, title: 'Canonical', status: 'closed', show_results: false,
  documents: [], position: 0, points_possible: 10, include_in_final: true, created_by: actorId, created_at: stamp, updated_at: stamp, classrooms: classroom }
const question = (n = 1) => ({ id: uuid(n), test_id: testId, artifact_id: uuid(n + 10000), source_artifact_id: null,
  question_type: 'open_response', question_text: 'Explain', options: [], correct_option: null, answer_key: 'Answer', sample_solution: 'Solution',
  points: 1, response_max_chars: 5000, response_monospace: false, position: n, created_at: stamp, updated_at: stamp,
  ai_reference_cache_answers: null, ai_reference_cache_generated_at: null, ai_reference_cache_key: null, ai_reference_cache_model: null })
const draft = { id: uuid(20000), classroom_id: classroomId, assessment_id: testId, assessment_type: 'test', version: 7,
  content: { title: 'Overlay', show_results: true, questions: [{ id: uuid(1), question_type: 'open_response', question_text: 'Draft', options: [],
    correct_option: null, answer_key: 'Draft answer', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false }] } }
const path = `classrooms/${classroomId}/tests/${testId}/documents/${uuid(4)}/${uuid(5)}.pdf`
const document = { id: uuid(4), title: 'PDF', source: 'upload', storage_bucket: 'test-documents', storage_path: path, managed_object_id: uuid(5) }
const reference = { id: uuid(6), test_id: testId, managed_object_id: uuid(5), storage_bucket: 'test-documents', storage_path: path,
  reference_role: 'teacher_document', managed_object: { id: uuid(5), classroom_id: classroomId, course_blueprint_id: null, provisional_owner_id: null,
    storage_bucket: 'test-documents', storage_path: path, purpose: 'teacher_test_material', status: 'ready', content_type: 'application/pdf' } }

type Call = { select: string; ops: Array<[string, ...unknown[]]> }
function fixture(options: { test?: any; questions?: any[]; drafts?: any[]; refs?: any[]; cap?: number;
  intercept?: (row: any, call: Call, index: number) => unknown; info?: any; bucket?: any } = {}) {
  const calls: Call[] = []
  const info = vi.fn(async () => ({ data: { name: path, bucketId: 'test-documents', contentType: 'application/pdf' }, error: null }))
  if (options.info) info.mockResolvedValue(options.info)
  const getBucket = vi.fn(async () => ({ data: { id: 'test-documents', name: 'test-documents', public: true }, error: null }))
  if (options.bucket) getBucket.mockResolvedValue(options.bucket)
  const storageFrom = vi.fn(() => ({ info }))
  const client = { from: vi.fn((table: string) => {
    expect(table).toBe('tests')
    const call: Call = { select: '', ops: [] }; calls.push(call)
    const chain: any = {}
    for (const method of ['eq', 'gt', 'in', 'order', 'limit', 'abortSignal']) chain[method] = (...args: unknown[]) => { call.ops.push([method, ...args]); return chain }
    chain.select = (value: string) => { call.select = value; return chain }
    chain.maybeSingle = async () => {
      let row: any = call.select.includes('title') ? structuredClone(options.test ?? test) : { id: testId, classroom_id: classroomId, classrooms: { ...classroom } }
      if (call.select.includes('questions:')) {
        const cursor = call.ops.find(op => op[0] === 'gt' && op[1] === 'questions.id')?.[2] as string | undefined
        row.questions = (options.questions ?? [question()]).filter(q => !cursor || q.id > cursor).slice(0, options.cap ?? 1000)
      }
      if (call.select.includes('drafts:')) row.classrooms.drafts = structuredClone(options.drafts ?? [])
      if (call.select.includes('refs:')) {
        const cursor = call.ops.find(op => op[0] === 'gt' && op[1] === 'refs.id')?.[2] as string | undefined
        row.refs = structuredClone((options.refs ?? []).filter(r => !cursor || r.id > cursor).slice(0, 1000))
      }
      return { data: options.intercept ? options.intercept(row, call, calls.indexOf(call)) : row, error: null }
    }
    return chain
  }), storage: { from: storageFrom, getBucket } }
  return { calls, client, info, getBucket, storageFrom, read: () => readContextualTestDetail({ supabase: client as any, actorId, testId }) }
}

describe('shared test detail admission', () => {
  beforeEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student', email: 'owner@example.test' } as any) })
  it('preserves absent and valid nonadmitted legacy gates', async () => {
    delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    expect(await authorizeSharedTestDetailReadActor()).toEqual({ mode: 'existing' }); expect(requireAuth).not.toHaveBeenCalled()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    expect(await authorizeSharedTestDetailReadActor()).toEqual({ mode: 'existing' }); expect(requireAuth).toHaveBeenCalledTimes(1)
  })
  it('admits the authenticated owner without relying on its global role', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    expect(await authorizeSharedTestDetailReadActor()).toMatchObject({ mode: 'shared', user: { role: 'student' } })
  })
  it('rejects malformed configuration after authentication', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '')
    await expect(authorizeSharedTestDetailReadActor()).rejects.toMatchObject({ statusCode: 503 }); expect(requireAuth).toHaveBeenCalledTimes(1)
  })
})

describe('contextual test detail statements', () => {
  it('preserves canonical DTO, answer fields, portable identity and archived owner reads', async () => {
    const f = fixture({ test: { ...test, classrooms: { ...classroom, archived_at: stamp } }, drafts: [draft] })
    const result = await f.read()
    expect(result.test).toMatchObject({ title: 'Canonical', assessment_type: 'test', status: 'closed' })
    expect(result.draft_version).toBe(7)
    expect(result.questions[0]).toMatchObject({ id: question().artifact_id, answer_key: 'Answer', sample_solution: 'Solution', ai_reference_cache_answers: null })
    expect(result.questions[0]).not.toHaveProperty('artifact_id'); expect(result.questions[0]).not.toHaveProperty('source_artifact_id')
    expect(result.classroom).toEqual({ ...classroom, archived_at: stamp })
    for (const call of f.calls.slice(1)) {
      expect(call.ops).toContainEqual(['eq', 'id', testId]); expect(call.ops).toContainEqual(['eq', 'classroom_id', classroomId])
      expect(call.ops).toContainEqual(['eq', 'classrooms.id', classroomId]); expect(call.ops).toContainEqual(['eq', 'classrooms.teacher_id', actorId])
    }
    expect(f.calls[0].select).not.toMatch(/question|answer|document|draft|title/)
  })
  it('uses only a validated draft overlay and portable row projection', async () => {
    const result = await fixture({ test: { ...test, status: 'draft' }, drafts: [draft] }).read()
    expect(result.test.title).toBe('Overlay'); expect(result.test.show_results).toBe(true)
    expect(result.questions[0]).toMatchObject({ id: question().artifact_id, question_text: 'Draft', position: 0 })
  })
  it('retains canonical fallback for invalid draft content without a write', async () => {
    const f = fixture({ test: { ...test, status: 'draft' }, drafts: [{ ...draft, content: { invalid: true } }] })
    expect((await f.read()).test.title).toBe('Canonical')
  })
  it('returns 409 when portable draft identity is ambiguous', async () => {
    await expect(fixture({ test: { ...test, status: 'draft' }, questions: [question(), { ...question(2), artifact_id: question().artifact_id }],
      drafts: [{ ...draft, content: { ...draft.content, question_identity_version: 1, questions: [{ ...draft.content.questions[0], id: question().artifact_id }] } }] }).read()).rejects.toMatchObject({ statusCode: 409 })
  })
  it.each(['teacher', 'student', 'paying_nonmember'])('denies a nonowner %s before payload discovery', async () => {
    const f = fixture({ intercept: row => ({ ...row, classrooms: { ...classroom, teacher_id: uuid(99) } }) })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 403 }); expect(f.calls).toHaveLength(1)
  })
  it('returns 404 for an absent test', async () => {
    await expect(fixture({ intercept: () => null }).read()).rejects.toMatchObject({ statusCode: 404 })
  })
  it.each([
    { classroom_id: uuid(90) }, { id: uuid(90) }, { classrooms: { ...classroom, teacher_id: uuid(90) } },
    { status: 'draft' }, { documents: [{ id: 'x', title: 'x', source: 'text', content: 'changed' }] }, { secret: 'unexpected' },
  ])('rejects substituted or changing payload controls %#', async patch => {
    await expect(fixture({ intercept: (row, _call, n) => n === 2 ? { ...row, ...patch } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('requires authority on empty terminal question and final reads', async () => {
    for (const phase of ['terminal', 'final']) {
      const f = fixture({ intercept: (row, call) => phase === 'terminal' ? call.ops.some(o => o[0] === 'gt') ? null : row
        : call.select.includes('drafts:') && call.select.includes('refs:') ? null : row })
      await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
    }
  })
  it('paginates beyond 1000 rows, continues short pages, and sorts the DTO by position', async () => {
    const questions = Array.from({ length: 1001 }, (_, n) => ({ ...question(n + 1), position: 1001 - n }))
    const f = fixture({ questions }); const result = await f.read()
    expect(result.questions).toHaveLength(1001); expect(result.questions[0].position).toBe(1)
    expect(f.calls.filter(c => c.select.includes('questions:'))).toHaveLength(3)
    const short = fixture({ questions: questions.slice(0, 5), cap: 2 })
    expect((await short.read()).questions).toHaveLength(5); expect(short.calls.filter(c => c.select.includes('questions:'))).toHaveLength(4)
  })
  it.each([{ test_id: uuid(20) }, { private_answer: 'extra' }])('rejects question substitution or unknown columns %#', async patch => {
    await expect(fixture({ questions: [{ ...question(), ...patch }] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects duplicate and nonadvancing questions', async () => {
    await expect(fixture({ questions: [question(), question()] }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ intercept: (row, call) => call.select.includes('questions:') ? { ...row, questions: [question()] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('bounds page cardinality, collection totals and statement count independently', async () => {
    const questions = Array.from({ length: 10001 }, (_, n) => question(n + 1))
    await expect(fixture({ questions }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ intercept: (row, call) => call.select.includes('questions:') ? { ...row, questions: questions.slice(0, 1001) } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
    const narrow = fixture({ questions: questions.slice(0, 200), cap: 1 })
    await expect(narrow.read()).rejects.toMatchObject({ statusCode: 503 }); expect(narrow.calls.length).toBeLessThanOrEqual(129)
  })
  it.each([{ classroom_id: uuid(90) }, { assessment_id: uuid(90) }, { assessment_type: 'assignment' }, { unknown: true }])('rejects a misbound draft %#', async patch => {
    await expect(fixture({ drafts: [{ ...draft, ...patch }] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects duplicate and changing draft sources', async () => {
    await expect(fixture({ drafts: [draft, draft] }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ drafts: [draft], intercept: (row, call) => call.select.includes('refs:') && call.select.includes('drafts:')
      ? { ...row, classrooms: { ...row.classrooms, drafts: [{ ...draft, version: 8 }] } } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('uses managed MIME proven through the composite reference and permits legacy attribution', async () => {
    const f = fixture({ test: { ...test, documents: [document] }, refs: [reference] }); const result = await f.read()
    expect(result.test.documents[0]).toMatchObject({ upload_content_type: 'application/pdf' }); expect(f.info).not.toHaveBeenCalled()
    expect(f.calls.some(c => c.select.includes('managed_storage_json_reference_identity_fkey'))).toBe(true)
  })
  it.each([
    { test_id: uuid(90) }, { storage_path: 'other.pdf' }, { managed_object_id: uuid(90) },
    { managed_object: { ...reference.managed_object, classroom_id: uuid(90) } },
    { managed_object: { ...reference.managed_object, purpose: 'test_execution_snapshot' } },
    { managed_object: { ...reference.managed_object, provisional_owner_id: uuid(90) } },
    { managed_object: { ...reference.managed_object, status: 'cleanup_pending' } },
  ])('rejects managed reference substitution %#', async patch => {
    const f = fixture({ test: { ...test, documents: [document] }, refs: [{ ...reference, ...patch }] })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.info).not.toHaveBeenCalled()
  })
  it('looks up null registered MIME only after proof, then revalidates the object', async () => {
    const f = fixture({ test: { ...test, documents: [document] }, refs: [{ ...reference, managed_object: { ...reference.managed_object, content_type: null } }] })
    expect((await f.read()).test.documents[0].upload_content_type).toBe('application/pdf'); expect(f.info).toHaveBeenCalledWith(path)
    const changed = fixture({ test: { ...test, documents: [document] }, refs: [{ ...reference, managed_object: { ...reference.managed_object, content_type: null } }],
      intercept: (row, call) => call.select.includes('drafts:') && call.select.includes('refs:') ? { ...row, refs: [] } : row })
    await expect(changed.read()).rejects.toMatchObject({ statusCode: 503 })
    expect(changed.info).not.toHaveBeenCalled()
    const during = fixture({ test: { ...test, documents: [document] }, refs: [{ ...reference, managed_object: { ...reference.managed_object, content_type: null } }],
      intercept: (row, call) => call.select.includes('drafts:') && call.select.includes('refs:') && during.info.mock.calls.length
        ? { ...row, refs: [{ ...reference, managed_object: { ...reference.managed_object, status: 'cleanup_pending' } }] } : row })
    await expect(during.read()).rejects.toMatchObject({ statusCode: 503 }); expect(during.info).toHaveBeenCalledTimes(1)
  })
  it('allows unmanaged compatibility only for the explicitly public bucket and exact returned path', async () => {
    const { managed_object_id: _managed, ...legacyDocument } = document
    const f = fixture({ test: { ...test, documents: [legacyDocument] } })
    expect((await f.read()).test.documents[0].upload_content_type).toBe('application/pdf'); expect(f.getBucket).toHaveBeenCalledTimes(2)
    for (const options of [{ bucket: { data: { id: 'test-documents', name: 'test-documents', public: false }, error: null } },
      { info: { data: { name: 'other.pdf', bucketId: 'test-documents', contentType: 'application/pdf' }, error: null } }]) {
      await expect(fixture({ ...options, test: { ...test, documents: [legacyDocument] } }).read()).rejects.toMatchObject({ statusCode: 503 })
    }
  })
  it('rejects unexpected transport, oversized payloads and an unresponsive statement', async () => {
    const f = fixture(); f.client.from.mockImplementationOnce(() => { throw Error('private failure') })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ questions: [{ ...question(), question_text: 'x'.repeat(9 * 1024 * 1024) }] }).read()).rejects.toMatchObject({ statusCode: 503 })
    vi.useFakeTimers()
    try {
      const stuck = fixture(); stuck.client.from.mockImplementationOnce(() => ({ select: () => ({ eq: () => ({ abortSignal: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }) }) as any)
      const pending = expect(stuck.read()).rejects.toMatchObject({ statusCode: 503 }); await vi.advanceTimersByTimeAsync(20000); await pending
    } finally { vi.useRealTimers() }
  })
})
