import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/teacher/tests/[id]/draft/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { ensureAssessmentDraft, saveTestDraftAtomic, getAssessmentDraftByType } from '@/lib/server/assessment-drafts'
import { saveContextualTestDraft } from '@/lib/server/contextual-test-draft-save'

const actorId = '11111111-1111-4111-8111-111111111111'
const testId = '33333333-3333-4333-8333-333333333333'
const content = { title: 'Draft', show_results: false, questions: [], question_identity_version: 1 }
const draft = { content, version: 1 }
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mocks) }))
vi.mock('@/lib/server/tests', () => ({ assertTeacherOwnsTest: vi.fn() }))
vi.mock('@/lib/server/test-editing-policy', () => ({ getTestEditingPolicy: vi.fn(async () => ({ structureLocked: false })) }))
vi.mock('@/lib/server/assessment-drafts', () => ({ ensureAssessmentDraft: vi.fn(), buildTestDraftContentFromRows: vi.fn(), buildNextDraftContent: vi.fn(() => ({ ok: true, content })), getAssessmentDraftByType: vi.fn(), saveTestDraftAtomic: vi.fn(async () => ({ ok: true, draft })) }))
vi.mock('@/lib/server/contextual-test-draft-save', () => ({ saveContextualTestDraft: vi.fn() }))
const admitted = () => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
const request = (body: unknown = { version: 1, content }) => new NextRequest(`http://localhost/api/teacher/tests/${testId}/draft`, { method: 'PATCH', body: JSON.stringify(body) })

describe('Test draft PATCH shared admission boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student', email: 'owner@example.test' })
    vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'teacher', email: 'owner@example.test' })
    vi.mocked(assertTeacherOwnsTest).mockResolvedValue({ ok: true, test: { id: testId, status: 'draft', documents: [] } } as never)
    vi.mocked(ensureAssessmentDraft).mockResolvedValue({ ok: true, draft } as never)
    vi.mocked(saveContextualTestDraft).mockResolvedValue({ status: 200, body: { draft, test: { title: 'Draft' }, editingPolicy: { structureLocked: false } } } as never)
  })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('preserves original unconfigured/unadmitted legacy PATCH %#', async config => {
    if (config !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    const result = await PATCH(request(), { params: Promise.resolve({ id: 'legacy-id' }) })
    expect(result.status).toBe(200); expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(assertTeacherOwnsTest).toHaveBeenCalledWith(actorId, 'legacy-id', { checkArchived: true })
    expect(ensureAssessmentDraft).toHaveBeenCalledTimes(1); expect(saveTestDraftAtomic).toHaveBeenCalledTimes(1)
    expect(saveContextualTestDraft).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['teacher', 'student'] as const)('dispatches admitted %s actor with safe DTO and shared deadline', async role => {
    admitted(); vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role, email: 'owner@example.test' })
    const before = Date.now(); const result = await PATCH(request(), { params: Promise.resolve({ id: testId.toUpperCase() }) })
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ draft, test: { title: 'Draft' }, editingPolicy: { structureLocked: false } })
    expect(saveContextualTestDraft).toHaveBeenCalledWith({ supabase: mocks, actorId, testId, input: { version: 1, content }, deadline: expect.any(Number) })
    const deadline = vi.mocked(saveContextualTestDraft).mock.calls[0][0].deadline!
    expect(deadline).toBeGreaterThanOrEqual(before + 20000); expect(deadline).toBeLessThanOrEqual(Date.now() + 20000)
    expect(requireRole).not.toHaveBeenCalled(); expect(assertTeacherOwnsTest).not.toHaveBeenCalled(); expect(ensureAssessmentDraft).not.toHaveBeenCalled()
    expect(saveTestDraftAtomic).not.toHaveBeenCalled(); expect(getAssessmentDraftByType).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })
  it('authenticates before malformed configuration, params or body', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    const body = request(); const reader = vi.spyOn(body.body!, 'getReader')
    const params = { then: vi.fn(() => { throw new Error('must not discover params') }) }
    expect((await PATCH(body, { params: params as never })).status).toBe(503)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(params.then).not.toHaveBeenCalled(); expect(reader).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled(); expect(saveContextualTestDraft).not.toHaveBeenCalled()
  })
  it('decodes populated editor content to canonical authored fields on the admitted branch', async () => {
    admitted()
    const canonicalQuestion = { id: '55555555-5555-4555-8555-555555555555', question_type: 'open_response', question_text: 'Question?',
      options: [], correct_option: null, answer_key: 'Answer', sample_solution: null, points: 1, response_max_chars: 5000, response_monospace: false }
    const canonical = { ...content, questions: [canonicalQuestion] }
    const editor = { ...canonical, questions: [{ ...canonicalQuestion, test_id: testId, position: 0,
      created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' }] }
    expect((await PATCH(request({ version: 1, content: editor }), { params: Promise.resolve({ id: testId }) })).status).toBe(200)
    expect(saveContextualTestDraft).toHaveBeenCalledWith(expect.objectContaining({ input: { version: 1, content: canonical } }))
    expect(mocks.from).not.toHaveBeenCalled(); expect(requireRole).not.toHaveBeenCalled()
  })
  it('returns authentication failure before configuration disclosure', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Authentication required'), { name: 'AuthenticationError' }))
    expect((await PATCH(request(), { params: Promise.resolve({ id: testId }) })).status).toBe(401)
    expect(saveContextualTestDraft).not.toHaveBeenCalled()
  })
  it.each([{ version: '1', content }, { version: 1, patch: [{ op: 'remove', path: 'invalid' }] }, { version: 2147483648, content }])('strictly rejects contextual input before data discovery %#', async body => {
    admitted(); expect((await PATCH(request(body), { params: Promise.resolve({ id: testId }) })).status).toBe(400)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(saveContextualTestDraft).not.toHaveBeenCalled(); expect(requireRole).not.toHaveBeenCalled()
  })
  it('returns malformed JSON as 400 after authentication', async () => {
    admitted(); const body = new NextRequest('http://localhost', { method: 'PATCH', body: '{' })
    expect((await PATCH(body, { params: Promise.resolve({ id: testId }) })).status).toBe(400)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(saveContextualTestDraft).not.toHaveBeenCalled()
  })
  it('returns verified reload conflicts without changing the response', async () => {
    admitted(); vi.mocked(saveContextualTestDraft).mockResolvedValue({ status: 409, body: { error: 'Reload test draft before saving' } } as never)
    const result = await PATCH(request(), { params: Promise.resolve({ id: testId }) })
    expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: 'Reload test draft before saving' })
  })
})
