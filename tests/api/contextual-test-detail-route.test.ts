import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/tests/[id]/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { readContextualTestDetail } from '@/lib/server/contextual-test-detail-read'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { getAssessmentDraftByType } from '@/lib/server/assessment-drafts'

const actorId = '11111111-1111-4111-8111-111111111111'
const testId = '33333333-3333-4333-8333-333333333333'
const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mocks) }))
vi.mock('@/lib/server/contextual-test-detail-read', async importOriginal => ({ ...await importOriginal<any>(), readContextualTestDetail: vi.fn() }))
vi.mock('@/lib/server/tests', () => ({ assertTeacherOwnsTest: vi.fn() }))
vi.mock('@/lib/server/assessment-drafts', () => ({ getAssessmentDraftByType: vi.fn(), isMissingAssessmentDraftsError: vi.fn(() => true), publishTestFromDraftAtomic: vi.fn() }))
vi.mock('@/lib/server/test-document-content-types', () => ({ resolveTestDocumentUploadContentTypes: vi.fn(async () => []) }))
const request = () => new NextRequest(`http://localhost/api/teacher/tests/${testId}`)

describe('test detail GET shared admission integration', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student', email: 'owner@example.test' } as any)
    vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'teacher', email: 'owner@example.test' } as any)
    vi.mocked(readContextualTestDetail).mockResolvedValue({ test: { id: testId }, questions: [], draft_version: null, classroom: {} } as any)
    vi.mocked(assertTeacherOwnsTest).mockResolvedValue({ ok: true, test: { id: testId, classroom_id: actorId, title: 'Legacy', status: 'closed', show_results: false, classrooms: {} } } as any)
    vi.mocked(getAssessmentDraftByType).mockResolvedValue({ draft: null, error: null })
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) })
  })
  it('takes the admitted owner path without a global role or legacy read', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    expect((await GET(request(), { params: Promise.resolve({ id: testId }) })).status).toBe(200)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(requireRole).not.toHaveBeenCalled(); expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
    expect(readContextualTestDetail).toHaveBeenCalledWith({ supabase: mocks, actorId, testId })
  })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('preserves legacy GET and missing-draft behavior %#', async config => {
    if (config !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    vi.mocked(getAssessmentDraftByType).mockResolvedValue({ draft: null, error: { code: 'PGRST205', message: 'missing' } } as any)
    const result = await GET(request(), { params: Promise.resolve({ id: 'legacy-id' }) })
    expect(result.status).toBe(200); expect((await result.json()).test.title).toBe('Legacy')
    expect(requireRole).toHaveBeenCalledWith('teacher'); expect(readContextualTestDetail).not.toHaveBeenCalled()
  })
  it('rejects malformed admission before parsing or database discovery', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    const params = { then: vi.fn(() => { throw Error('params must not resolve') }) }
    expect((await GET(request(), { params: params as any })).status).toBe(503)
    expect(params.then).not.toHaveBeenCalled(); expect(requireAuth).toHaveBeenCalledTimes(1); expect(mocks.from).not.toHaveBeenCalled()
  })
  it('validates admitted route identity after authentication', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    expect((await GET(request(), { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(400)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(readContextualTestDetail).not.toHaveBeenCalled()
  })
  it('does not fall back to legacy after a contextual denial or verification failure', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    const { ApiError } = await import('@/lib/api-error')
    vi.mocked(readContextualTestDetail).mockRejectedValue(new ApiError(503, 'Unable to verify test detail'))
    expect((await GET(request(), { params: Promise.resolve({ id: testId }) })).status).toBe(503)
    expect(requireRole).not.toHaveBeenCalled(); expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
  })
})
