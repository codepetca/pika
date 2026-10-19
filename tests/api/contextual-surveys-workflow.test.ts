import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as ownerList } from '@/app/api/teacher/surveys/route'
import { GET as ownerDetail, PATCH as ownerPatch, DELETE as ownerDelete } from '@/app/api/teacher/surveys/[id]/route'
import { POST as questionCreate } from '@/app/api/teacher/surveys/[id]/questions/route'
import { PATCH as questionPatch, DELETE as questionDelete } from '@/app/api/teacher/surveys/[id]/questions/[qid]/route'
import { GET as ownerResults } from '@/app/api/teacher/surveys/[id]/results/route'
import { GET as memberList } from '@/app/api/student/surveys/route'
import { GET as memberDetail } from '@/app/api/student/surveys/[id]/route'
import { POST as memberRespond } from '@/app/api/student/surveys/[id]/respond/route'
import { GET as memberResults } from '@/app/api/student/surveys/[id]/results/route'

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), requireRole: vi.fn(), rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth, requireRole: mocks.requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }))
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const classroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const surveyId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const questionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const otherId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const timestamp = '2026-01-01T00:00:00.000Z'
const survey = { id: surveyId, classroom_id: classroomId, title: 'Feedback', status: 'active', opens_at: null, show_results: true,
  dynamic_responses: true, position: 0, created_by: otherId, created_at: timestamp, updated_at: timestamp }
const question = { id: questionId, survey_id: surveyId, question_type: 'short_text', question_text: 'Thoughts?', options: [],
  response_max_chars: 500, position: 0, created_at: timestamp, updated_at: timestamp }
const classroom = { id: classroomId, teacher_id: actorId, archived_at: null }
const context = { params: Promise.resolve({ id: surveyId, qid: questionId }) }
function request(method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost/api/surveys/${surveyId}?classroom_id=${classroomId}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
function success(data: unknown) { return { data, error: null } }
function legacyResponseFixture(activeQuestion: typeof question) {
  mocks.requireRole.mockResolvedValue({ id: actorId, role: 'student' })
  const persist = vi.fn().mockResolvedValue({ error: null })
  mocks.from.mockImplementation((table: string) => {
    const query = { select: vi.fn(), eq: vi.fn(), single: vi.fn(), limit: vi.fn(), order: vi.fn(), upsert: persist, insert: persist }
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query)
    query.single.mockResolvedValue(success(table === 'surveys' ? { ...survey, classrooms: { ...classroom, teacher_id: otherId } } : { id: otherId }))
    query.limit.mockResolvedValue(success([])); query.order.mockResolvedValue(success([activeQuestion]))
    return query
  })
  return persist
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.rpc.mockReset(); vi.unstubAllEnvs()
  vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
  mocks.requireAuth.mockResolvedValue({ id: actorId, role: 'student' })
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'get_survey_for_owner_v1') return success({ classroom, survey, questions: [question], responses: [] })
    if (name === 'get_survey_for_member_v1') return success({ classroom: { ...classroom, teacher_id: otherId }, survey, questions: [question], responses: [] })
    if (name === 'get_surveys_for_owner_v1') return success({ classroom, surveys: [{ ...survey, stats: { total_students: 1, responded: 0, questions_count: 1 } }] })
    if (name === 'get_surveys_for_member_v1') return success({ classroom: { ...classroom, teacher_id: otherId }, surveys: [{ ...survey, has_submitted: false }] })
    if (name === 'update_survey_for_owner_v1') return success({ survey: { ...survey, title: 'Changed' } })
    if (name === 'create_survey_question_for_owner_v1' || name === 'update_survey_question_for_owner_v1') return success({ question })
    if (name === 'respond_to_survey_for_member_v1') return success({ success: true, updated: false })
    if (name === 'get_survey_results_for_member_v1') return success({ classroom: { ...classroom, teacher_id: otherId }, survey: { id: surveyId, title: survey.title, status: survey.status, show_results: true, dynamic_responses: true }, results: [] })
    if (name === 'get_survey_results_for_owner_v1') return success({ classroom, survey: { id: surveyId, title: survey.title, status: survey.status, show_results: true, dynamic_responses: true }, results: [], questions: [question], responders: [], stats: { total_students: 1, responded: 0 } })
    return success({ success: true })
  })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('Survey mutation contention budget across authorization and persistence', () => {
  const busy = { data: null, error: { code: 'PT409', message: 'survey_operation_busy' } }
  const detail = success({ classroom: { ...classroom, teacher_id: otherId }, survey, questions: [question], responses: [] })

  it.each(['preflight', 'writer'])('returns first-response 201 after one %s busy abort', async phase => {
    vi.useFakeTimers()
    const body = request('POST', { responses: { [questionId]: ' Fine ' } })
    const parseBody = vi.spyOn(body, 'json')
    if (phase === 'preflight') mocks.rpc.mockResolvedValueOnce(busy).mockResolvedValueOnce(detail)
    else mocks.rpc.mockResolvedValueOnce(detail).mockResolvedValueOnce(busy)
    const pending = memberRespond(body, context)
    await vi.advanceTimersByTimeAsync(0)
    expect(parseBody).toHaveBeenCalledTimes(phase === 'writer' ? 1 : 0)
    await vi.advanceTimersByTimeAsync(20)
    const response = await pending
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ success: true, updated: false })
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(phase === 'preflight'
      ? ['get_survey_for_member_v1', 'get_survey_for_member_v1', 'respond_to_survey_for_member_v1']
      : ['get_survey_for_member_v1', 'respond_to_survey_for_member_v1', 'respond_to_survey_for_member_v1'])
    expect(parseBody).toHaveBeenCalledOnce()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.requireRole).not.toHaveBeenCalled()
  })

  it('does not renew the retry token for the writer after retrying preflight', async () => {
    vi.useFakeTimers()
    mocks.rpc.mockResolvedValueOnce(busy).mockResolvedValueOnce(detail).mockResolvedValue(busy)
    const pending = memberRespond(request('POST', { responses: { [questionId]: 'Fine' } }), context)
    await vi.runAllTimersAsync()
    expect((await pending).status).toBe(409)
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('does not renew the 100ms deadline after a slow successful preflight', async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    mocks.rpc.mockImplementationOnce(async () => { now = 85; return detail }).mockResolvedValueOnce(busy)
    expect((await memberRespond(request('POST', { responses: { [questionId]: 'Fine' } }), context)).status).toBe(409)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each([
    [{ code: 'PT403', message: 'survey_not_enrolled' }, 403],
    [{ code: 'PT404', message: 'survey_not_found' }, 404],
    [{ code: 'PT400', message: 'survey_already_answered' }, 400],
    [{ code: 'PT409', message: 'survey_questions_changed' }, 409],
    [{ code: 'PT409', message: 'survey_parent_changed' }, 409],
    [{ code: 'PT409', message: 'survey_response_changed' }, 409],
    [{ code: 'PT409', message: 'survey_subject_fenced' }, 409],
    [{ code: 'PT409', message: 'survey_classroom_fenced' }, 409],
    [{ code: '55000', message: 'classroom_purge_active' }, 409],
    [{ code: '55000', message: 'attendance_decommission_active' }, 409],
  ] as const)('returns the current writer denial %j after busy without a third writer call', async (error, status) => {
    vi.useFakeTimers()
    mocks.rpc.mockResolvedValueOnce(detail).mockResolvedValueOnce(busy).mockResolvedValueOnce({ data: null, error })
    const pending = memberRespond(request('POST', { responses: { [questionId]: 'Fine' } }), context)
    await vi.runAllTimersAsync()
    const response = await pending
    expect(response.status).toBe(status)
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
    expect(mocks.rpc.mock.calls[2][1]).toBe(mocks.rpc.mock.calls[1][1])
    expect(JSON.stringify(await response.json())).not.toContain(error.message)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns 503 for an uncertain writer transport outcome after busy with no replay', async () => {
    vi.useFakeTimers()
    mocks.rpc.mockResolvedValueOnce(detail).mockResolvedValueOnce(busy).mockRejectedValueOnce(new Error('private transport text'))
    const pending = memberRespond(request('POST', { responses: { [questionId]: 'Fine' } }), context)
    await vi.runAllTimersAsync()
    const response = await pending
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Survey operation unavailable' })
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('never replays a malformed successful writer acknowledgment', async () => {
    mocks.rpc.mockResolvedValueOnce(detail).mockResolvedValueOnce(success({ success: true }))
    expect((await memberRespond(request('POST', { responses: { [questionId]: 'Fine' } }), context)).status).toBe(503)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('authenticates before body access or any RPC', async () => {
    mocks.requireAuth.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
    const body = request('POST', { responses: { [questionId]: 'Fine' } })
    const parseBody = vi.spyOn(body, 'json')
    expect((await memberRespond(body, context)).status).toBe(401)
    expect(parseBody).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('does not parse a body or dispatch a writer when a preflight retry sees membership revoked', async () => {
    vi.useFakeTimers()
    mocks.rpc.mockResolvedValueOnce(busy).mockResolvedValueOnce({ data: null, error: { code: 'PT403', message: 'survey_not_enrolled' } })
    const body = request('POST', null)
    const parseBody = vi.spyOn(body, 'json')
    const pending = memberRespond(body, context)
    await vi.runAllTimersAsync()
    expect((await pending).status).toBe(403)
    expect(parseBody).not.toHaveBeenCalled()
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['get_survey_for_member_v1', 'get_survey_for_member_v1'])
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each([
    [ownerPatch, 'PATCH', { title: 'Changed' }, 'update_survey_for_owner_v1'],
    [questionCreate, 'POST', { question_type: 'short_text', question_text: 'Thoughts?' }, 'create_survey_question_for_owner_v1'],
    [questionPatch, 'PATCH', { position: 1 }, 'update_survey_question_for_owner_v1'],
  ] as const)('shares the one retry token in owner mutation %#', async (handler, method, body, writer) => {
    vi.useFakeTimers()
    mocks.rpc.mockResolvedValueOnce(busy).mockResolvedValueOnce(success({ classroom, survey, questions: [question], responses: [] })).mockResolvedValue(busy)
    const pending = handler(request(method, body), context)
    await vi.runAllTimersAsync()
    expect((await pending).status).toBe(409)
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['get_survey_for_owner_v1', 'get_survey_for_owner_v1', writer])
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('existing Survey transports under shared admission', () => {
  it.each([ownerList, ownerDetail, ownerResults, memberList, memberDetail, memberResults])('preserves valid uppercase UUID read URLs', async handler => {
    const response = await handler(new NextRequest(`http://localhost/api/surveys/${surveyId.toUpperCase()}?classroom_id=${classroomId.toUpperCase()}`),
      { params: Promise.resolve({ id: surveyId.toUpperCase(), qid: questionId.toUpperCase() }) })
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledOnce()
    const args = mocks.rpc.mock.calls[0][1]
    expect(args.p_actor_id).toBe(actorId)
    expect(args.p_survey_id ?? args.p_classroom_id).toBe(args.p_survey_id ? surveyId : classroomId)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('canonicalizes uppercase mutation URLs before preflight and child matching', async () => {
    const uppercase = { params: Promise.resolve({ id: surveyId.toUpperCase(), qid: questionId.toUpperCase() }) }
    expect((await ownerPatch(request('PATCH', { title: 'Changed' }), uppercase)).status).toBe(200)
    expect((await questionCreate(request('POST', { question_type: 'short_text', question_text: 'Thoughts?' }), uppercase)).status).toBe(201)
    expect((await questionPatch(request('PATCH', { position: 4 }), uppercase)).status).toBe(200)
    expect((await questionDelete(request('DELETE'), uppercase)).status).toBe(200)
    expect((await memberRespond(request('POST', { responses: { [questionId]: 'Fine' } }), uppercase)).status).toBe(201)
    expect((await ownerDelete(request('DELETE'), uppercase)).status).toBe(200)
    for (const [, args] of mocks.rpc.mock.calls) {
      expect(args.p_actor_id).toBe(actorId)
      expect(args.p_survey_id).toBe(surveyId)
      if ('p_question_id' in args) expect(args.p_question_id).toBe(questionId)
    }
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each([ownerList, ownerDetail, memberList, memberDetail, memberResults])('lets either account role use the contextual read without the global role guard', async handler => {
    const response = await handler(request(), context)
    expect(response.status).toBe(200)
    expect(mocks.requireRole).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('retains owner results and strips its internal Classroom evidence', async () => {
    const response = await ownerResults(request(), context)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.stats).toEqual({ total_students: 1, responded: 0 })
    expect(data.classroom).toBeUndefined()
  })
  it('persists owner metadata without treating created_by as authority', async () => {
    expect((await ownerPatch(request('PATCH', { title: ' Changed ' }), context)).status).toBe(200)
    expect(mocks.rpc).toHaveBeenLastCalledWith('update_survey_for_owner_v1', expect.objectContaining({ p_actor_id: actorId, p_patch: { title: 'Changed' } }))
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('does not parse an invalid body before ownership denial', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT403' } })
    expect((await ownerPatch(request('PATCH', null), context)).status).toBe(403)
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
  it('does not parse an invalid owner mutation body in an archived Classroom', async () => {
    mocks.rpc.mockResolvedValue(success({ classroom: { ...classroom, archived_at: timestamp }, survey, questions: [question], responses: [] }))
    for (const [handler, method] of [[ownerPatch, 'PATCH'], [questionCreate, 'POST'], [questionPatch, 'PATCH']] as const) {
      expect((await handler(request(method, null), context)).status).toBe(403)
    }
  })
  it('retains question create, partial patch, and exact child-delete transports', async () => {
    expect((await questionCreate(request('POST', { question_type: 'short_text', question_text: 'Thoughts?' }), context)).status).toBe(201)
    expect((await questionPatch(request('PATCH', { position: 4.8 }), context)).status).toBe(200)
    expect(mocks.rpc).toHaveBeenLastCalledWith('update_survey_question_for_owner_v1', expect.objectContaining({ p_question_id: questionId, p_expected_question: question, p_question: expect.objectContaining({ position: 4, question_type: 'short_text' }) }))
    expect((await questionDelete(request('DELETE'), context)).status).toBe(200)
    expect(mocks.rpc).toHaveBeenLastCalledWith('delete_survey_question_for_owner_v1', { p_actor_id: actorId, p_survey_id: surveyId, p_question_id: questionId })
  })
  it('uses the atomic cascade delete transport', async () => {
    expect((await ownerDelete(request('DELETE'), context)).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('delete_survey_for_owner_v1', { p_actor_id: actorId, p_survey_id: surveyId })
  })
  it('preserves first-response 201 and dynamic-update 200', async () => {
    expect((await memberRespond(request('POST', { responses: { [questionId]: 'Fine' } }), context)).status).toBe(201)
    mocks.rpc.mockImplementation(async name => name === 'get_survey_for_member_v1'
      ? success({ classroom: { ...classroom, teacher_id: otherId }, survey, questions: [question], responses: [] })
      : success({ success: true, updated: true }))
    expect((await memberRespond(request('POST', { responses: { [questionId]: 'Fine' } }), context)).status).toBe(200)
  })
  it.each([
    ['https://a.co', 'https://a.co/'],
    ['https://example.com/é', 'https://example.com/%C3%A9'],
  ])('keeps shared and legacy raw link boundaries identical for %s', async (raw, serialized) => {
    const link = { ...question, question_type: 'link', response_max_chars: raw.length }
    mocks.rpc.mockImplementation(async name => name === 'get_survey_for_member_v1'
      ? success({ classroom: { ...classroom, teacher_id: otherId }, survey, questions: [link], responses: [] })
      : success({ success: true, updated: false }))
    expect((await memberRespond(request('POST', { responses: { [questionId]: raw } }), context)).status).toBe(201)
    expect(mocks.rpc).toHaveBeenLastCalledWith('respond_to_survey_for_member_v1', expect.objectContaining({
      p_expected_questions: [link], p_responses: { [questionId]: { question_type: 'link', response_text: serialized, raw_utf16_length: raw.length } },
    }))
    mocks.rpc.mockClear()
    expect((await memberRespond(request('POST', { responses: { [questionId]: `${raw}a` } }), context)).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalledWith('respond_to_survey_for_member_v1', expect.anything())
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    const persist = legacyResponseFixture(link)
    expect((await memberRespond(request('POST', { responses: { [questionId]: raw } }), context)).status).toBe(201)
    const rows = persist.mock.calls[0][0]
    expect(rows).toMatchObject([{ question_id: questionId, response_text: serialized }])
    expect(rows[0]).not.toHaveProperty('raw_utf16_length')
    persist.mockClear()
    expect((await memberRespond(request('POST', { responses: { [questionId]: `${raw}a` } }), context)).status).toBe(400)
    expect(persist).not.toHaveBeenCalled()
  })
  it('keeps shared and legacy short-text UTF16 overflow rejection', async () => {
    const short = { ...question, response_max_chars: 3 }
    mocks.rpc.mockImplementation(async () => success({ classroom: { ...classroom, teacher_id: otherId }, survey, questions: [short], responses: [] }))
    const body = { responses: { [questionId]: '😀😀' } }
    expect((await memberRespond(request('POST', body), context)).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalledWith('respond_to_survey_for_member_v1', expect.anything())
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    const persist = legacyResponseFixture(short)
    expect((await memberRespond(request('POST', body), context)).status).toBe(400)
    expect(persist).not.toHaveBeenCalled()
  })
  it.each([['PT403', 403], ['PT404', 404], ['PT409', 409], ['PT400', 400], ['PGRST202', 503]])('contains database %s without falling back to a legacy query', async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'private contents' } })
    const response = await memberDetail(request(), context)
    expect(response.status).toBe(status)
    expect(JSON.stringify(await response.json())).not.toContain('private contents')
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('rejects foreign question IDs before response persistence', async () => {
    expect((await memberRespond(request('POST', { responses: { [otherId]: 'Fine' } }), context)).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalledWith('respond_to_survey_for_member_v1', expect.anything())
  })
  it('denies current purge-fenced detail/results before any legacy disclosure', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'survey_subject_fenced' } })
    for (const handler of [memberDetail, memberResults, ownerResults]) {
      expect((await handler(request(), context)).status).toBe(409)
    }
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
