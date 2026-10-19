import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
import { authorizeSharedGradebookActor, readContextualGradebookOwner, readContextualGradebookMember, mutateContextualGradebook } from '@/lib/server/contextual-gradebook'

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const classroom = '22222222-2222-4222-8222-222222222222'
const empty = { roster: [], profiles: [], categories: [], assignments: [], assignment_docs: [], tests: [], test_questions: [], test_responses: [], test_attempts: [], items: [], item_scores: [], score_overrides: [] }
const resource = '33333333-3333-4333-8333-333333333333', peer = '44444444-4444-4444-8444-444444444444'
const date = '2026-10-10T12:00:00Z'
const category = { id: resource, classroom_id: classroom, name: 'Term', percentage: 100, default_assessment_weight: 10, position: 0, is_default: true }
const parent = { id: resource, classroom_id: classroom, title: 'Visible own mark', include_in_final: true, gradebook_weight: 1, gradebook_category_id: resource, gradebook_maximum_override: null, gradebook_score_scale: 1 }
const savedItem = { ...parent, points_possible: 10, created_at: date }
const savedScore = { item_id: resource, classroom_id: classroom, student_id: actor, earned: 0, returned_at: null, updated_at: date }
function member(source: Record<string, unknown> = {}, view = 'grades') {
  const { roster: _roster, profiles: _profiles, ...base } = empty
  return { actor_id: actor, classroom: { id: classroom, teacher_id: peer, archived_at: null }, operation: 'member-' + view,
    source: { ...base, student_id: actor, visibility: { classwork: true, tests: true, student_grades: true, gradebook_compact_zero_weight_assessments: true }, categories: [category], items: [savedItem], item_scores: [savedScore], ...source } }
}
function client(data: unknown, error: unknown = null, status = 200) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error, status })
  const rpc = vi.fn(() => ({ abortSignal }))
  mocks.client.mockReturnValue({ rpc })
  return { rpc, abortSignal }
}
describe('contextual Gradebook trust boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION })
  it('leaves absent admission unauthenticated for the original guard', async () => {
    expect(await authorizeSharedGradebookActor()).toEqual({ mode: 'existing' })
    expect(mocks.auth).not.toHaveBeenCalled()
  })
  it('fails closed for present malformed admission', async () => {
    process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION = '{}'
    mocks.auth.mockResolvedValue({ id: actor })
    await expect(authorizeSharedGradebookActor()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('accepts one bound owner snapshot and forwards cancellation', async () => {
    const transport = client({ actor_id: actor, classroom: { id: classroom, teacher_id: actor, archived_at: null }, operation: 'owner-read', selected_student_id: null, source: empty })
    const result = await readContextualGradebookOwner({ actorId: actor.toUpperCase(), classroomId: classroom, selectedStudentId: null })
    expect(result.students).toEqual([])
    expect(transport.rpc).toHaveBeenCalledTimes(1)
    expect(transport.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
  })
  it.each([
    { actor_id: classroom }, { operation: 'member-grades' }, { selected_student_id: actor },
    { classroom: { id: actor, teacher_id: actor, archived_at: null } },
  ])('rejects mismatched source binding %j', async patch => {
    client({ actor_id: actor, classroom: { id: classroom, teacher_id: actor, archived_at: null }, operation: 'owner-read', selected_student_id: null, source: empty, ...patch })
    await expect(readContextualGradebookOwner({ actorId: actor, classroomId: classroom, selectedStudentId: null })).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['PGRST202', '57014', 'unknown'])('never retries or falls back for %s', async code => {
    const transport = client(null, { code, message: 'detail' }, 500)
    await expect(readContextualGradebookOwner({ actorId: actor, classroomId: classroom, selectedStudentId: null })).rejects.toMatchObject({ statusCode: 503 })
    expect(transport.rpc).toHaveBeenCalledTimes(1)
  })
  it('preserves persisted lifecycle conflicts without retry', async () => {
    const transport = client(null, { code: '55000', message: 'fenced' }, 500)
    await expect(readContextualGradebookOwner({ actorId: actor, classroomId: classroom, selectedStudentId: null })).rejects.toMatchObject({ statusCode: 409 })
    expect(transport.rpc).toHaveBeenCalledTimes(1)
  })
  it.each([undefined, { item_id: classroom, student_id: actor }, { item_id: actor, student_id: classroom }, { item_id: actor, student_id: actor, extra: true }])('rejects missing, wrong, foreign, or extra mutation targets %j', async target => {
    const transport = client({ actor_id: actor, classroom: { id: classroom, teacher_id: actor, archived_at: null }, operation: 'item_score', ...(target === undefined ? {} : { target }), result: { saved: true } })
    await expect(mutateContextualGradebook({ actorId: actor, classroomId: classroom, action: 'item_score', payload: { item_id: actor, student_id: actor, earned: 0 } })).rejects.toMatchObject({ statusCode: 503 })
    expect(transport.rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects contradictory success transport envelopes', async () => {
    client({ actor_id: actor, classroom: { id: classroom, teacher_id: actor, archived_at: null }, operation: 'owner-read', selected_student_id: null, source: empty }, null, 403)
    await expect(readContextualGradebookOwner({ actorId: actor, classroomId: classroom, selectedStudentId: null })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('retains production maximum enablement without an availability probe', async () => {
    vi.stubEnv('NODE_ENV', 'production'); delete process.env.GRADEBOOK_MAXIMUM_EDITS_ENABLED
    await expect(mutateContextualGradebook({ actorId: actor, classroomId: classroom, action: 'maximum', payload: { assessment_type: 'assignment', assessment_id: actor, maximum: 50, mode: 'keep_marks', expected_maximum: 30, expected_scale: 1 } })).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.client).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
  it('projects saved unreturned standalone zero and no private source fields', async () => {
    client(member())
    const result = await readContextualGradebookMember({ actorId: actor, classroomId: classroom, view: 'grades' })
    expect(result).toEqual({ currentPercent: 0, compactZeroWeightAssessments: true, items: [{ id: resource, kind: 'Gradebook item', title: 'Visible own mark', earned: 0, possible: 10, percent: 0, included: true, href: null, isZeroWeight: false }] })
  })
  it('ignores partial returned work until a returned override supplies the complete mark', async () => {
    const source = { items: [], item_scores: [], assignments: [{ ...parent, due_at: date, position: 0, is_draft: false, points_possible: 30 }],
      assignment_docs: [{ assignment_id: resource, student_id: actor, score_completion: 10, score_thinking: null, score_workflow: 10, is_submitted: false, submitted_at: null, returned_at: date, teacher_cleared_at: null, graded_at: date }] }
    client(member(source)); expect(await readContextualGradebookMember({ actorId: actor, classroomId: classroom, view: 'grades' })).toMatchObject({ currentPercent: null, items: [] })
    client(member({ ...source, score_overrides: [{ classroom_id: classroom, student_id: actor, assessment_type: 'assignment', assessment_id: resource, earned: 15 }] }))
    expect(await readContextualGradebookMember({ actorId: actor, classroomId: classroom, view: 'grades' })).toMatchObject({ currentPercent: 50, items: [{ earned: 15, possible: 30 }] })
  })
  it('includes a fully scored returned Test without adding a submission prerequisite', async () => {
    const source = { items: [], item_scores: [], tests: [{ ...parent, status: 'active', position: 0 }],
      test_questions: [{ id: peer, test_id: resource, points: 10 }],
      test_attempts: [{ test_id: resource, student_id: actor, returned_at: date, is_submitted: false, submitted_at: null }],
      test_responses: [{ test_id: resource, question_id: peer, student_id: actor, score: 0 }] }
    client(member(source))
    expect(await readContextualGradebookMember({ actorId: actor, classroomId: classroom, view: 'grades' })).toMatchObject({ currentPercent: 0, items: [{ kind: 'Test', earned: 0, possible: 10 }] })
    client(member({ ...source, test_responses: [{ ...source.test_responses[0], question_id: actor }] }))
    await expect(readContextualGradebookMember({ actorId: actor, classroomId: classroom, view: 'grades' })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('keeps zero weight visible and allows Classwork items while aggregate Grades is hidden', async () => {
    client(member({ items: [{ ...savedItem, gradebook_weight: 0 }] }))
    expect(await readContextualGradebookMember({ actorId: actor, classroomId: classroom, view: 'grades' })).toMatchObject({ currentPercent: null, items: [{ earned: 0, isZeroWeight: true, included: false }] })
    client(member({ visibility: { classwork: true, tests: false, student_grades: false, gradebook_compact_zero_weight_assessments: false } }, 'items'))
    expect(await readContextualGradebookMember({ actorId: actor, classroomId: classroom, view: 'items' })).toEqual({ compactZeroWeightAssessments: false, items: [{ id: resource, title: savedItem.title, earned: 0, possible: 10, percent: 0, categoryName: 'Term', isZeroWeight: false, included: true }] })
  })
  it.each([400, 403, 404, 409])('maps only consistent known PT%d errors', async status => {
    client(null, { code: `PT${status}`, message: 'private database details' }, status)
    await expect(readContextualGradebookOwner({ actorId: actor, classroomId: classroom, selectedStudentId: null })).rejects.toMatchObject({ statusCode: status })
    client(null, { code: `PT${status}`, message: 'private database details' }, 200)
    await expect(readContextualGradebookOwner({ actorId: actor, classroomId: classroom, selectedStudentId: null })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('does not retry an uncertain mutation response', async () => {
    const transport = client(null); transport.abortSignal.mockRejectedValue(new Error('network closed'))
    await expect(mutateContextualGradebook({ actorId: actor, classroomId: classroom, action: 'override_delete_all', payload: {} })).rejects.toMatchObject({ statusCode: 503 })
    expect(transport.rpc).toHaveBeenCalledTimes(1)
  })
  it.each([
    { item_scores: [{ ...savedScore, student_id: peer }] },
    { item_scores: [savedScore, savedScore] },
    { items: [{ ...savedItem, classroom_id: peer }] },
    { score_overrides: [{ classroom_id: classroom, student_id: actor, assessment_type: 'final', assessment_id: classroom, earned: 90 }] },
    { visibility: { classwork: false, tests: true, student_grades: true, gradebook_compact_zero_weight_assessments: true } },
    { items: [{ ...savedItem, answer_key: 'secret' }] },
    { items: [{ ...savedItem, title: '😀'.repeat(4097) }] },
  ])('rejects peer, duplicate, foreign, final, hidden, or expanded source %j', async source => {
    client(member(source))
    await expect(readContextualGradebookMember({ actorId: actor, classroomId: classroom, view: 'grades' })).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([actor, peer])('rejects owner precedence or archived member source %#', async ownerId => {
    const value = member(); value.classroom.teacher_id = ownerId
    if (ownerId === peer) Object.assign(value.classroom, { archived_at: date })
    client(value)
    await expect(readContextualGradebookMember({ actorId: actor, classroomId: classroom, view: 'grades' })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('aborts one dispatched SDK operation at the deadline without retry', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const rpc = vi.fn(() => ({ abortSignal: (value: AbortSignal) => { signal = value; return new Promise(() => {}) } }))
    mocks.client.mockReturnValue({ rpc })
    const pending = expect(readContextualGradebookOwner({ actorId: actor, classroomId: classroom, selectedStudentId: null })).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(8000); await pending
    expect(signal?.aborted).toBe(true); expect(rpc).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
  it('caps actual stream bytes and cancels the original reader before JSON parsing', async () => {
    const cancel = vi.fn(), chunk = new Uint8Array(1024 * 1024)
    const body = new ReadableStream({ pull(controller) { controller.enqueue(chunk) }, cancel })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Length': '1' } })))
    const rpc = vi.fn()
    mocks.client.mockImplementation((options: { fetch: typeof fetch }) => ({ rpc: rpc.mockImplementation(() => ({ abortSignal: async () => {
      const response = await options.fetch('http://synthetic.invalid'); return response.json()
    } })) }))
    await expect(readContextualGradebookOwner({ actorId: actor, classroomId: classroom, selectedStudentId: null })).rejects.toMatchObject({ statusCode: 503 })
    expect(cancel).toHaveBeenCalledTimes(1); expect(rpc).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
