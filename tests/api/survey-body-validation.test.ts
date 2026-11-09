import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/teacher/surveys/[id]/route'
import { POST } from '@/app/api/student/surveys/[id]/respond/route'
import { POST as CREATE } from '@/app/api/teacher/surveys/route'
import { PATCH as PATCH_QUESTION } from '@/app/api/teacher/surveys/[id]/questions/[qid]/route'
import { POST as CREATE_QUESTION } from '@/app/api/teacher/surveys/[id]/questions/route'

const mocks = vi.hoisted(() => ({ role: vi.fn(), teacher: vi.fn(), student: vi.fn(), from: vi.fn(), update: vi.fn(), insert: vi.fn(), rpc: vi.fn() }))
const survey = { id: '30000000-0000-4000-8000-000000000001', classroom_id: '30000000-0000-4000-8000-000000000002', status: 'active', opens_at: null, dynamic_responses: false }
const userId = '30000000-0000-4000-8000-000000000003'
const question = { id: '30000000-0000-4000-8000-000000000004', question_type: 'short_text', question_text: 'Feedback', response_max_chars: 500 }
vi.mock('@/lib/auth', () => ({ requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }))
vi.mock('@/lib/server/surveys', () => ({ assertTeacherOwnsSurvey: mocks.teacher, assertStudentCanAccessSurvey: mocks.student, isMissingSurveysTableError: () => false }))
vi.mock('@/lib/server/contextual-classwork-creation-access', () => ({ authorizeContextualClassworkCreationRequest: async () => ({ mode: 'teacher', user: { id: 'teacher-1' } }) }))

function request(body: unknown, method = 'POST') {
  return new NextRequest('http://localhost/api/surveys/survey-1', { method, body: JSON.stringify(body) })
}
const context = { params: Promise.resolve({ id: survey.id, qid: question.id }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.role.mockResolvedValue({ id: userId })
  mocks.teacher.mockResolvedValue({ ok: true, survey })
  mocks.student.mockResolvedValue({ ok: true, survey })
  const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue({ data: [] }), single: vi.fn().mockResolvedValue({ data: survey, error: null }),
    then: (resolve: any) => Promise.resolve({ data: [question], error: null }).then(resolve) }
  mocks.update.mockReturnValue(query)
  mocks.insert.mockResolvedValue({ error: null })
  mocks.rpc.mockResolvedValue({ data: { success: true, updated: false }, error: null })
  mocks.from.mockReturnValue({ ...query, update: mocks.update, insert: mocks.insert })
})

describe('survey request boundaries', () => {
  it.each([null, [], { title: 7 }, { title: null }, { show_results: 'yes' }, { opens_at: 7 }, { status: 'invalid' }])('rejects invalid survey PATCH %j', async (body) => {
    expect((await PATCH(request(body, 'PATCH'), context)).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([null, [], { responses: [] }, { responses: null }, { responses: 'invalid' }])('rejects invalid responses %j', async (body) => {
    expect((await POST(request(body), context)).status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it.each([null, [], { classroom_id: 'classroom-1', title: 7 }])('rejects invalid survey creation %j', async (body) => {
    expect((await CREATE(request(body), context)).status).toBe(400)
  })
  it.each([null, [], { question_text: 7 }])('rejects malformed question bodies %j', async (body) => {
    expect((await PATCH_QUESTION(request(body, 'PATCH'), context)).status).toBe(400)
    expect((await CREATE_QUESTION(request(body), context)).status).toBe(400)
  })
  it('maps malformed JSON to 400', async () => {
    for (const [handler, method] of [[PATCH, 'PATCH'], [POST, 'POST']] as const) {
      expect((await handler(new NextRequest('http://localhost/api/surveys/survey-1', { method, body: '{' }), context)).status).toBe(400)
    }
  })
  it('authenticates before parsing invalid bodies', async () => {
    mocks.role.mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
    expect((await PATCH(request(null, 'PATCH'), context)).status).toBe(401)
    expect((await POST(request(null), context)).status).toBe(401)
    expect(mocks.teacher).not.toHaveBeenCalled()
    expect(mocks.student).not.toHaveBeenCalled()
  })
  it('preserves partial PATCH and trims titles', async () => {
    expect((await PATCH(request({ title: ' Updated ' }, 'PATCH'), context)).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ title: 'Updated' })
  })
  it('persists valid student responses', async () => {
    const answer = { response_text: 'Useful', question_type: 'short_text' }
    expect((await POST(request({ responses: { [question.id]: answer } }), context)).status).toBe(201)
    expect(mocks.rpc).toHaveBeenCalledWith('respond_to_survey_for_member_v1', {
      p_actor_id: userId,
      p_classroom_id: survey.classroom_id,
      p_survey_id: survey.id,
      p_expected_questions: [question],
      p_responses: { [question.id]: answer },
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('rejects an answer if the survey changes between validation and persistence', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'survey_questions_changed' } })
    const response = await POST(request({ responses: { [question.id]: 'Useful' } }), context)
    expect(response.status).toBe(409)
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('authorizes ownership before parsing invalid bodies', async () => {
    mocks.teacher.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    mocks.student.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await PATCH(request(null, 'PATCH'), context)).status).toBe(403)
    expect((await POST(request(null), context)).status).toBe(403)
  })
  it('retains opened-survey lifecycle and empty PATCH restrictions', async () => {
    expect((await PATCH(request({ status: 'draft' }, 'PATCH'), context)).status).toBe(400)
    expect((await PATCH(request({}, 'PATCH'), context)).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('preserves explicit null open dates and omitted PATCH fields', async () => {
    expect((await PATCH(request({ opens_at: null, show_results: false }, 'PATCH'), context)).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ opens_at: null, show_results: false })
  })
  it('retains closed-survey response restrictions', async () => {
    mocks.student.mockResolvedValue({ ok: true, survey: { ...survey, status: 'closed' } })
    expect((await POST(request({ responses: {} }), context)).status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
