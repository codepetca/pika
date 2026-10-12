import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  vi.clearAllMocks(); vi.unstubAllEnvs()
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

describe('existing Survey transports under shared admission', () => {
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
