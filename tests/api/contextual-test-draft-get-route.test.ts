import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/teacher/tests/[id]/draft/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { ensureAssessmentDraft } from '@/lib/server/assessment-drafts'
import { getTestEditingPolicy } from '@/lib/server/test-editing-policy'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const content = { title: 'Draft', show_results: false, questions: [], question_identity_version: 1 }
const draft = { id: '44444444-4444-4444-8444-444444444444', assessment_type: 'test', assessment_id: testId,
  classroom_id: classroomId, content, version: 1, created_by: actorId, updated_by: actorId,
  created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z' }
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mocks) }))
vi.mock('@/lib/server/tests', () => ({ assertTeacherOwnsTest: vi.fn() }))
vi.mock('@/lib/server/test-editing-policy', () => ({ getTestEditingPolicy: vi.fn() }))
vi.mock('@/lib/server/assessment-drafts', () => ({ ensureAssessmentDraft: vi.fn(),
  buildTestDraftContentFromRows: vi.fn(), buildNextDraftContent: vi.fn(() => ({ ok: true, content })),
  getAssessmentDraftByType: vi.fn(), saveTestDraftAtomic: vi.fn(async () => ({ ok: true, draft })) }))
const request = () => new NextRequest(`http://localhost/api/teacher/tests/${testId}/draft`)
const admitted = () => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
function rpcFailure(code: string) {
  mocks.rpc.mockImplementation(() => {
    const query = Promise.resolve({ data: null, error: { code, message: 'closed failure' } })
    return Object.assign(query, { abortSignal: vi.fn(() => query) })
  })
}

describe('Test draft GET shared admission boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student', email: 'owner@example.test' } as any)
    vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'teacher', email: 'owner@example.test' } as any)
    vi.mocked(assertTeacherOwnsTest).mockResolvedValue({ ok: true, test: {
      id: testId, classroom_id: classroomId, title: 'Draft', status: 'draft', show_results: false,
      documents: [], classrooms: { archived_at: null },
    } } as any)
    vi.mocked(ensureAssessmentDraft).mockResolvedValue({ ok: true, draft } as any)
    vi.mocked(getTestEditingPolicy).mockResolvedValue({ structureLocked: false })
    rpcFailure('PGRST202')
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('preserves the unchanged legacy ensure path %#', async config => {
    if (config !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    const result = await GET(request(), { params: Promise.resolve({ id: 'legacy-id' }) })
    expect(result.status).toBe(200); expect((await result.json()).draft).toEqual(draft)
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(assertTeacherOwnsTest).toHaveBeenCalledWith(actorId, 'legacy-id', { checkArchived: true })
    expect(ensureAssessmentDraft).toHaveBeenCalledTimes(1); expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each(['teacher', 'student'])('does not use a global %s label or unbound legacy reads for an admitted actor', async role => {
    admitted(); vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role, email: 'owner@example.test' } as any)
    expect((await GET(request(), { params: Promise.resolve({ id: testId }) })).status).toBe(503)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(requireRole).not.toHaveBeenCalled()
    expect(assertTeacherOwnsTest).not.toHaveBeenCalled(); expect(ensureAssessmentDraft).not.toHaveBeenCalled()
    expect(getTestEditingPolicy).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects malformed admission after authentication and before params or data discovery', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    const params = { then: vi.fn(() => { throw Error('params must not resolve') }) }
    expect((await GET(request(), { params: params as any })).status).toBe(503)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(params.then).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled(); expect(ensureAssessmentDraft).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns authentication failure before malformed admission disclosure', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Authentication required'), { name: 'AuthenticationError' }))
    expect((await GET(request(), { params: Promise.resolve({ id: testId }) })).status).toBe(401)
    expect(requireRole).not.toHaveBeenCalled(); expect(ensureAssessmentDraft).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('validates an admitted Test identity after authentication, without legacy fallback', async () => {
    admitted()
    expect((await GET(request(), { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(400)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(requireRole).not.toHaveBeenCalled()
    expect(ensureAssessmentDraft).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not fall back after the transaction denies current ownership', async () => {
    admitted(); rpcFailure('PT403')
    expect((await GET(request(), { params: Promise.resolve({ id: testId }) })).status).toBe(403)
    expect(requireRole).not.toHaveBeenCalled(); expect(ensureAssessmentDraft).not.toHaveBeenCalled()
    expect(getTestEditingPolicy).not.toHaveBeenCalled()
  })

  it.each(['snapshot', 'final'])('returns unavailable for raw %s privilege failure without fallback or private error output', async phase => {
    admitted()
    mocks.rpc.mockImplementation((name: string) => {
      const rejected = (phase === 'snapshot') === (name === 'snapshot_test_draft_for_owner_v1')
      const result = rejected ? { data: null, status: 403, statusText: 'Forbidden',
        error: { code: '42501', message: 'private privilege state', details: 'private table grant', hint: 'private owner' } } : {
        data: { version: 1, actor_id: actorId, classroom: { id: classroomId, teacher_id: actorId, archived_at: null },
          test: { id: testId, classroom_id: classroomId, title: 'Persisted', show_results: true, status: 'draft',
            blueprint_archived_at: null, questions_locked_at: null }, draft, question_count: 0, questions: [], source_sha256: 'a'.repeat(64) }, error: null,
      }
      const query = Promise.resolve(result)
      return Object.assign(query, { abortSignal: vi.fn(() => query) })
    })
    const result = await GET(request(), { params: Promise.resolve({ id: testId }) })
    expect(result.status).toBe(503); expect(await result.json()).toEqual({ error: 'Unable to verify test draft' })
    expect(mocks.rpc).toHaveBeenCalledTimes(phase === 'snapshot' ? 1 : 2)
    expect(requireRole).not.toHaveBeenCalled(); expect(ensureAssessmentDraft).not.toHaveBeenCalled()
    expect(getTestEditingPolicy).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns the existing two-key DTO for admitted inspection with canonical route identity', async () => {
    admitted()
    mocks.rpc.mockImplementation((name: string, args: { p_content?: unknown }) => {
      const data = name === 'snapshot_test_draft_for_owner_v1' ? {
        version: 1, actor_id: actorId, classroom: { id: classroomId, teacher_id: actorId, archived_at: null },
        test: { id: testId, classroom_id: classroomId, title: 'Persisted', show_results: true, status: 'draft',
          blueprint_archived_at: null, questions_locked_at: null }, draft, question_count: 0, questions: [], source_sha256: 'a'.repeat(64),
      } : {
        version: 1, actor_id: actorId, classroom_id: classroomId, test_id: testId, operation: 'inspect',
        draft: { ...draft, content: args.p_content }, editingPolicy: { structureLocked: false },
      }
      const query = Promise.resolve({ data, error: null })
      return Object.assign(query, { abortSignal: vi.fn(() => query) })
    })
    const result = await GET(request(), { params: Promise.resolve({ id: testId.toUpperCase() }) })
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ draft, editingPolicy: { structureLocked: false } })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_test_id: testId, p_actor_id: actorId })
    expect(requireRole).not.toHaveBeenCalled(); expect(ensureAssessmentDraft).not.toHaveBeenCalled()
    expect(getTestEditingPolicy).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })

  it('keeps PATCH on its original guard and ensure path even with malformed shared admission', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    const result = await PATCH(new NextRequest(`http://localhost/api/teacher/tests/${testId}/draft`, {
      method: 'PATCH', body: JSON.stringify({ version: 1, content }),
    }), { params: Promise.resolve({ id: 'legacy-id' }) })
    expect(result.status).toBe(200); expect(requireAuth).not.toHaveBeenCalled()
    expect(requireRole).toHaveBeenCalledWith('teacher'); expect(ensureAssessmentDraft).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
