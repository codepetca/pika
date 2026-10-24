import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireAuth, requireRole } from '@/lib/auth'
import { GET, POST } from '@/app/api/teacher/classrooms/route'
import { listActiveTeacherClassrooms } from '@/lib/server/classroom-order'
import { loadContextualClassroomHome } from '@/lib/server/contextual-classroom-home'
import { ApiError } from '@/lib/api-error'

const database = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/auth', async original => ({ ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => database }))
vi.mock('@/lib/server/classroom-order', () => ({ listActiveTeacherClassrooms: vi.fn() }))
vi.mock('@/lib/server/contextual-classroom-home', async original => ({
  ...await original<typeof import('@/lib/server/contextual-classroom-home')>(),
  loadContextualClassroomHome: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '33333333-3333-4333-8333-333333333333'
const otherId = '22222222-2222-4222-8222-222222222222'
const operationId = '44444444-4444-4444-8444-444444444444'
const snapshot = {
  subject_user_id: actorId, feature_key: 'classrooms.create', managed: true,
  allowed: true, reason: 'allowed', source: 'plan',
  starts_at: '2026-01-01T00:00:00+00:00', expires_at: null,
  quota_limit: 2, active_count: 0, revision: 1,
}
const createRequest = (body = { title: 'Field studies', themeColor: 'blue' }) => new NextRequest('http://localhost/api/teacher/classrooms', {
  method: 'POST', headers: { 'Idempotency-Key': operationId }, body: JSON.stringify(body),
})
const atomicResult = { ok: true, status: 201, operation_id: operationId, replayed: false,
  classroom: { id: classroomId, teacher_id: actorId, title: 'Field studies', theme_color: 'blue' } }

describe('exact-home admitted classroom creation and refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', JSON.stringify([actorId]))
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: 'student@example.invalid', role: 'student' })
    vi.mocked(requireRole).mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
    vi.mocked(listActiveTeacherClassrooms).mockResolvedValue({ data: [], error: null } as never)
    vi.mocked(loadContextualClassroomHome).mockResolvedValue({ owned: [], joined: [] })
    database.rpc.mockImplementation(async name => ({ data: name === 'get_classroom_creation_access_v1' ? snapshot : atomicResult, error: null }))
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('creates for the authenticated student-valued actor through the existing atomic boundary', async () => {
    const response = await POST(createRequest({ title: 'Field studies', themeColor: 'blue',
      teacher_id: otherId, subject_user_id: otherId, role: 'teacher', plan: 'pro' } as never))
    expect(response.status).toBe(201)
    expect((await response.json()).classroom.id).toBe(classroomId)
    expect(requireRole).not.toHaveBeenCalled()
    expect(database.rpc).toHaveBeenNthCalledWith(1, 'get_classroom_creation_access_v1', { p_subject_user_id: actorId })
    expect(database.rpc).toHaveBeenNthCalledWith(2, 'create_classroom_atomic_v1', expect.objectContaining({ p_subject_user_id: actorId, p_operation_id: operationId }))
    expect(database.from).not.toHaveBeenCalled()
  })

  it.each(['teacher', 'student'] as const)('refreshes the complete owned list for %s without creation capacity or leaking joined rows', async role => {
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: 'actor@example.invalid', role })
    vi.mocked(loadContextualClassroomHome).mockResolvedValue({
      owned: [{ id: classroomId, title: 'Owned', relationship: 'owner' }],
      joined: [{ id: otherId, title: 'Joined', relationship: 'member' }],
    } as never)
    const response = await GET(new NextRequest('http://localhost/api/teacher/classrooms'))
    expect(response.status).toBe(200)
    expect((await response.json()).classrooms.map((row: { id: string }) => row.id)).toEqual([classroomId])
    expect(loadContextualClassroomHome).toHaveBeenCalledExactlyOnceWith(actorId, { supabase: database })
    expect(listActiveTeacherClassrooms).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
    expect(database.rpc).not.toHaveBeenCalled()
  })

  it('does not fall back to a partial legacy list when complete refresh fails', async () => {
    vi.mocked(loadContextualClassroomHome).mockRejectedValueOnce(new ApiError(503, 'Unable to verify classroom home'))
    expect((await GET(new NextRequest('http://localhost/api/teacher/classrooms'))).status).toBe(503)
    expect(listActiveTeacherClassrooms).not.toHaveBeenCalled()
  })

  it.each(['home', 'shared'])('retains the student rejection when the actor misses the %s cohort', async gate => {
    if (gate === 'home') vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', JSON.stringify([otherId]))
    else vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [otherId] }))
    expect((await POST(createRequest())).status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(database.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { ...snapshot, subject_user_id: otherId },
    { ...snapshot, managed: false, allowed: true, reason: 'legacy', source: null, starts_at: null, quota_limit: null, revision: null },
    null,
  ])('does not invoke creation for missing or substituted managed evidence %#', async data => {
    database.rpc.mockResolvedValue({ data, error: null })
    expect((await POST(createRequest())).status).toBe(503)
    expect(database.rpc).toHaveBeenCalledTimes(1)
  })

  it('replays a completed operation even when the first creation consumed the final slot', async () => {
    database.rpc.mockResolvedValueOnce({ data: { ...snapshot, active_count: 2, allowed: false, reason: 'active_limit_reached' }, error: null })
      .mockResolvedValueOnce({ data: { ...atomicResult, replayed: true }, error: null })
    const response = await POST(createRequest())
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ replayed: true, operation_id: operationId })
    expect(database.rpc).toHaveBeenCalledTimes(2)
  })

  it('returns the installed writer denial if capacity changes after the display hint', async () => {
    database.rpc.mockResolvedValueOnce({ data: snapshot, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'classroom_creation_active_limit_reached' } })
    const response = await POST(createRequest())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error_code: 'classroom_creation_active_limit_reached', retryable: false })
  })

  // CPU composition: actual route/adapters, synthetic database responses. The
  // separate rollback-only SQL contract proves the real writer/ACL behavior.
  it.each(['teacher', 'student'] as const)('retains %s access through creation freeze, source failure and recovery', async role => {
    const user = { id: actorId, email: 'actor@example.invalid', role }
    vi.mocked(requireAuth).mockResolvedValue(user)
    const home = { owned: [{ id: classroomId, title: 'Owned', relationship: 'owner' }], joined: [] }
    vi.mocked(loadContextualClassroomHome).mockResolvedValue(home as never)
    const disabled = { ...snapshot, allowed: false, reason: 'disabled', revision: 2, active_count: 1 }
    const freshOperationId = '55555555-5555-4555-8555-555555555555'
    const state = { phase: 'allowed' as 'allowed' | 'disabled' | 'unavailable' }
    database.rpc.mockImplementation(async (name, args) => {
      if (name === 'get_classroom_creation_access_v1') {
        expect(args).toEqual({ p_subject_user_id: actorId })
        return state.phase === 'unavailable'
          ? { data: null, error: { code: '42501', message: 'PRIVATE permission detail' } }
          : { data: state.phase === 'allowed' ? snapshot : disabled, error: null }
      }
      expect(name).toBe('create_classroom_atomic_v1')
      expect(state.phase).not.toBe('unavailable')
      expect(args.p_subject_user_id).toBe(actorId)
      if (args.p_operation_id === freshOperationId) {
        expect(state.phase).toBe('disabled')
        return { data: null, error: { code: '42501', message: 'classroom_creation_entitlement_disabled' } }
      }
      expect(args.p_operation_id).toBe(operationId)
      return { data: { ...atomicResult, replayed: state.phase === 'disabled' }, error: null }
    })
    expect((await POST(createRequest())).status).toBe(201)
    state.phase = 'disabled'
    const fresh = new NextRequest('http://localhost/api/teacher/classrooms', {
      method: 'POST', headers: { 'Idempotency-Key': freshOperationId },
      body: JSON.stringify({ title: 'Field studies', themeColor: 'blue' }),
    })
    const denied = await POST(fresh)
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error_code: 'classroom_creation_entitlement_disabled', retryable: false })
    expect(await (await POST(createRequest())).json()).toMatchObject({ replayed: true, classroom: { id: classroomId } })

    state.phase = 'unavailable'
    const beforeFailure = database.rpc.mock.calls.length
    const unavailable = await POST(createRequest())
    expect(unavailable.status).toBe(503)
    expect(JSON.stringify(await unavailable.json())).not.toContain('PRIVATE')
    expect(database.rpc.mock.calls.slice(beforeFailure)).toEqual([
      ['get_classroom_creation_access_v1', { p_subject_user_id: actorId }],
    ])
    const beforeRead = database.rpc.mock.calls.length
    const existing = await GET(new NextRequest('http://localhost/api/teacher/classrooms'))
    expect(existing.status).toBe(200)
    expect((await existing.json()).classrooms.map((row: { id: string }) => row.id)).toEqual([classroomId])
    expect(database.rpc).toHaveBeenCalledTimes(beforeRead)

    state.phase = 'disabled'
    const recovered = await POST(createRequest())
    expect(recovered.status).toBe(201)
    expect(await recovered.json()).toMatchObject({ replayed: true, classroom: { id: classroomId } })
    expect(user).toEqual({ id: actorId, email: 'actor@example.invalid', role })
    expect(requireRole).not.toHaveBeenCalled()
    expect(listActiveTeacherClassrooms).not.toHaveBeenCalled()
    expect(database.from).not.toHaveBeenCalled()
    expect(JSON.parse(process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION!)).toEqual({ version: 1, admittedUserIds: [actorId] })
    expect(JSON.parse(process.env.PIKA_CLASSROOM_HOME_ACCESS_USER_IDS!)).toEqual([actorId])
  })
})
