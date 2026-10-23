import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import {
  assertManagedClassroomHomeCreationAccess,
  authorizeClassroomHomeActor,
  loadClassroomHomeCreationAccess,
} from '@/lib/server/classroom-home-creation'

const home = vi.hoisted(() => ({ admitted: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/server/contextual-classroom-home', () => ({ isContextualClassroomHomeAdmitted: home.admitted }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const access = {
  subject_user_id: actorId, feature_key: 'classrooms.create', managed: true,
  allowed: true, reason: 'allowed', source: 'plan',
  starts_at: '2026-01-01T00:00:00+00:00', expires_at: null,
  quota_limit: 2, active_count: 0, revision: 1,
}
const client = (data: unknown = access, error: unknown = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) })

describe('classroom home creation capability', () => {
  beforeEach(() => { vi.clearAllMocks(); home.admitted.mockReturnValue(true) })
  afterEach(() => { vi.unstubAllEnvs() })

  it('reads only the authenticated subject and projects no quota or plan metadata', async () => {
    const supabase = client()
    await expect(loadClassroomHomeCreationAccess(actorId, supabase as never)).resolves.toEqual({ canCreate: true })
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('get_classroom_creation_access_v1', { p_subject_user_id: actorId })
  })

  it.each(['disabled', 'not_started', 'expired', 'active_limit_reached'])(
    'does not offer creation for %s but allows the atomic writer to resolve a replay', async (reason) => {
      const supabase = client({ ...access, allowed: false, reason })
      await expect(loadClassroomHomeCreationAccess(actorId, supabase as never)).resolves.toEqual({ canCreate: false })
      await expect(assertManagedClassroomHomeCreationAccess(actorId, supabase as never)).resolves.toBeUndefined()
    },
  )

  it('does not turn unmanaged legacy compatibility into a creation capability', async () => {
    const supabase = client({ ...access, managed: false, allowed: true, reason: 'legacy', source: null,
      starts_at: null, quota_limit: null, revision: null })
    await expect(loadClassroomHomeCreationAccess(actorId, supabase as never)).resolves.toEqual({ canCreate: false })
    await expect(assertManagedClassroomHomeCreationAccess(actorId, supabase as never)).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    null, { ...access, subject_user_id: otherId }, { ...access, feature_key: 'grading.ai' },
    { ...access, managed: false, allowed: false, reason: 'unavailable' },
    { ...access, allowed: true, reason: 'disabled' }, { ...access, active_count: -1 },
    { ...access, revision: null }, { ...access, source: null },
  ])('fails closed on unavailable or unbound evidence %#', async (data) => {
    await expect(loadClassroomHomeCreationAccess(actorId, client(data) as never)).rejects.toMatchObject({ statusCode: 503 })
  })

  it('fails closed on RPC rejection, source errors, or malformed actor identity', async () => {
    await expect(loadClassroomHomeCreationAccess(actorId, client(null, { code: 'PGRST202' }) as never)).rejects.toMatchObject({ statusCode: 503 })
    const rejected = { rpc: vi.fn().mockRejectedValue(new Error('connection failed')) }
    await expect(loadClassroomHomeCreationAccess(actorId, rejected as never)).rejects.toMatchObject({ statusCode: 503 })
    const untouched = client()
    await expect(loadClassroomHomeCreationAccess('invalid', untouched as never)).rejects.toMatchObject({ statusCode: 503 })
    expect(untouched.rpc).not.toHaveBeenCalled()
  })

  it('maps a malformed RPC envelope to capability unavailability', async () => {
    const malformed = { rpc: vi.fn().mockResolvedValue(null) }
    await expect(loadClassroomHomeCreationAccess(actorId, malformed as never)).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('classroom home actor admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student' } as never)
    vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'teacher' } as never)
    home.admitted.mockReturnValue(true)
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('admits an exact home and shared actor without changing the account role', async () => {
    await expect(authorizeClassroomHomeActor()).resolves.toEqual({ user: { id: actorId, role: 'student' }, contextual: true })
    expect(requireRole).not.toHaveBeenCalled()
  })

  it.each(['home', 'shared'])('retains the legacy teacher guard for unmatched %s admission', async (gate) => {
    if (gate === 'home') home.admitted.mockReturnValue(false)
    else vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [otherId] }))
    await expect(authorizeClassroomHomeActor()).resolves.toMatchObject({ contextual: false })
    expect(requireRole).toHaveBeenCalledWith('teacher')
  })

  it('keeps the no-home-configuration legacy path on requireRole only', async () => {
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'false')
    await authorizeClassroomHomeActor()
    expect(requireAuth).not.toHaveBeenCalled()
    expect(requireRole).toHaveBeenCalledWith('teacher')
  })

  it('keeps the legacy path when home is enabled but shared admission is absent', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    await authorizeClassroomHomeActor()
    expect(requireAuth).not.toHaveBeenCalled()
    expect(requireRole).toHaveBeenCalledWith('teacher')
  })

  it('fails closed for malformed shared admission after authentication', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    await expect(authorizeClassroomHomeActor()).rejects.toMatchObject({ statusCode: 503 })
    expect(requireAuth).toHaveBeenCalledOnce()
    expect(requireRole).not.toHaveBeenCalled()
  })

  it('does not hide malformed configured shared admission behind a home-cohort miss', async () => {
    home.admitted.mockReturnValue(false)
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    await expect(authorizeClassroomHomeActor()).rejects.toMatchObject({ statusCode: 503 })
    expect(requireRole).not.toHaveBeenCalled()
  })
})
