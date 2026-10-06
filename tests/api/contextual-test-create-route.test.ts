import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import type { Database } from '@/types/database'
import { POST } from '@/app/api/teacher/tests/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { createAssessmentDraft } from '@/lib/server/assessment-drafts'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const draftId = '44444444-4444-4444-8444-444444444444'
const artifactId = '55555555-5555-4555-8555-555555555555'
const stamp = '2026-10-06T03:25:00Z'
const title = 'Custom'
const content = { title, show_results: false, question_identity_version: 1 as const, questions: [], source_format: 'markdown' as const }
const test = { id: testId, classroom_id: classroomId, title, status: 'draft', show_results: false, position: 3, points_possible: 100, include_in_final: true,
  created_by: actorId, created_at: stamp, updated_at: stamp, documents: [], artifact_id: artifactId, source_artifact_id: null,
  source_blueprint_version_id: null, blueprint_archived_at: null, questions_locked_at: null, gradebook_category_id: null,
  gradebook_weight: 10, gradebook_maximum_override: null, gradebook_score_scale: 1 }
const draft = { id: draftId, assessment_type: 'test' as const, assessment_id: testId, classroom_id: classroomId, content, version: 1,
  created_by: actorId, updated_by: actorId, created_at: stamp, updated_at: stamp }
const witness = () => ({ version: 1, actor_id: actorId, classroom_id: classroomId, test_id: testId, test, draft })
let result: unknown
let httpStatus: number
let network: ReturnType<typeof vi.fn<typeof fetch>>
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: vi.fn(), assertTeacherOwnsClassroom: vi.fn(), getClassroomStudentIds: vi.fn() }))
vi.mock('@/lib/server/assessment-drafts', async () => ({ ...await vi.importActual<typeof import('@/lib/server/assessment-drafts')>('@/lib/server/assessment-drafts'), createAssessmentDraft: vi.fn() }))
const admitted = () => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
const request = (body: unknown = { classroom_id: classroomId, title }) => new NextRequest('http://localhost/api/teacher/tests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('contextual owner empty Test POST route', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    result = witness(); httpStatus = 200; vi.useFakeTimers(); vi.setSystemTime('2026-10-06T03:25:00Z')
    network = vi.fn<typeof fetch>(async (url) => {
      const path = String(url)
      return new Response(JSON.stringify(path.includes('/rpc/') ? result : path.includes('select=position') ? { position: 2 } : test), { status: path.includes('/rpc/') ? httpStatus : 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.mocked(getServiceRoleClient).mockReturnValue(createClient<Database>('https://example.test', 'offline-key', { global: { fetch: network }, auth: { persistSession: false, autoRefreshToken: false } }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student', email: 'owner@example.test' })
    vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'teacher', email: 'owner@example.test' })
    vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({ ok: true })
    vi.mocked(createAssessmentDraft).mockResolvedValue({ draft, error: null })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('retains complete legacy POST for unconfigured/unmatched actor %#', async config => {
    if (config !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    const response = await POST(request())
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ test: { ...test, assessment_type: 'test' } })
    expect(requireRole).toHaveBeenCalledWith('teacher'); expect(assertTeacherCanMutateClassroom).toHaveBeenCalledWith(actorId, classroomId)
    expect(createAssessmentDraft).toHaveBeenCalledTimes(1); expect(network).toHaveBeenCalledTimes(2)
    expect(network.mock.calls.every(call => !String(call[0]).includes('/rpc/'))).toBe(true)
  })
  it.each(['teacher', 'student'] as const)('uses current-owner RPC for admitted historical %s role', async role => {
    admitted(); vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role, email: 'owner@example.test' })
    const response = await POST(request()); expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ test: { ...test, assessment_type: 'test' } })
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(requireRole).not.toHaveBeenCalled(); expect(assertTeacherCanMutateClassroom).not.toHaveBeenCalled()
    expect(createAssessmentDraft).not.toHaveBeenCalled(); expect(network).toHaveBeenCalledTimes(1)
    expect(String(network.mock.calls[0][0])).toContain('/rpc/create_test_for_owner_v1')
  })
  it('preserves the ordinary caller transport with only classroom_id', async () => {
    admitted(); const fallback = 'Untitled 2026-10-05 23:25:00'
    result = { ...witness(), test: { ...test, title: fallback }, draft: { ...draft, content: { ...content, title: fallback } } }
    const response = await POST(request({ classroom_id: classroomId })); expect(response.status).toBe(201)
    expect((await response.json()).test.title).toBe(fallback)
  })
  it('authenticates and rejects malformed admission before reading body', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}'); const body = request(); const reader = vi.spyOn(body.body!, 'getReader')
    expect((await POST(body)).status).toBe(503); expect(requireAuth).toHaveBeenCalledTimes(1); expect(reader).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('returns auth failure before malformed configuration disclosure', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Authentication required'), { name: 'AuthenticationError' }))
    expect((await POST(request())).status).toBe(401); expect(network).not.toHaveBeenCalled()
  })
  it.each(['actor_id', 'deadline', 'plan', 'id', 'artifact_id', 'draft', 'questions', 'documents', 'status', 'gradebook_category_id'])('rejects forged %s with zero RPCs', async field => {
    admitted(); expect((await POST(request({ classroom_id: classroomId, [field]: 'forged' }))).status).toBe(400)
    expect(network).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it.each([{ classroom_id: 'bad' }, { classroom_id: classroomId, title: 1 }, { classroom_id: classroomId, title: 'x'.repeat(501) }])('rejects bad input before data discovery %#', async value => {
    admitted(); expect((await POST(request(value))).status).toBe(400); expect(network).not.toHaveBeenCalled()
  })
  it('maps malformed JSON400 after authentication', async () => {
    admitted(); const response = await POST(new NextRequest('http://localhost', { method: 'POST', body: '{' }))
    expect(response.status).toBe(400); expect(requireAuth).toHaveBeenCalledTimes(1); expect(network).not.toHaveBeenCalled()
  })
  it.each(['member', 'nonmember', 'former owner', 'archived'])('honors SQL denial for %s without legacy fallback', async () => {
    admitted(); httpStatus = 403; result = { code: 'PT403', message: 'private relationship' }
    const response = await POST(request()); expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(network).toHaveBeenCalledTimes(1); expect(requireRole).not.toHaveBeenCalled(); expect(createAssessmentDraft).not.toHaveBeenCalled()
  })
  it.each(['Free', 'paid', 'owner plus self enrollment'])('does not use %s as HTTP authoring authority', async () => {
    admitted(); expect((await POST(request())).status).toBe(201); expect(network).toHaveBeenCalledTimes(1)
    expect(assertTeacherCanMutateClassroom).not.toHaveBeenCalled()
  })
  it('shares the remaining deadline after a delayed body rather than starting again', async () => {
    admitted(); const payload = new TextEncoder().encode(JSON.stringify({ classroom_id: classroomId, title }))
    const stream = new ReadableStream<Uint8Array>({ start(controller) { setTimeout(() => { controller.enqueue(payload); controller.close() }, 750) } })
    const init = { method: 'POST', body: stream, duplex: 'half' }; const response = POST(new NextRequest('http://localhost', init))
    await vi.advanceTimersByTimeAsync(750); expect((await response).status).toBe(201)
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).p_deadline).toBe('2026-10-06T03:25:20.000Z')
    expect(vi.getTimerCount()).toBe(0)
  })
})
