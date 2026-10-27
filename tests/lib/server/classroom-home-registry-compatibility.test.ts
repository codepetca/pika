import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import { isContextualClassroomHomeAdmitted, authenticateContextualClassroomHome } from '@/lib/server/contextual-classroom-home'
import { resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { readClassroomAdmissionRegistry } from '@/lib/server/classroom-admission-registry'
import { authorizeClassroomHomeActor } from '@/lib/server/classroom-home-creation'
import { authenticateClassroomEnrollmentRequest } from '@/lib/server/classroom-enrollment-access'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn(), AuthorizationError: class extends Error {} }))
vi.mock('@/lib/server/classroom-admission-registry', () => ({ readClassroomAdmissionRegistry: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))

const identities = Array.from({ length: 150 }, (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
const user = { id: identities[100], role: 'student', email: 'member@example.com' }
const config = { version: 2, source: 'registry', bootstrapManifestSha256: 'a'.repeat(64) }

describe('registry Home audience compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify(config))
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', 'obsolete-invalid-list')
    vi.mocked(requireAuth).mockResolvedValue(user as never)
    vi.mocked(requireRole).mockResolvedValue(user as never)
    vi.mocked(readClassroomAdmissionRegistry).mockImplementation(async id => ({ admitted: identities.includes(id), bootstrap_member: false }) as never)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('admits the 101st and 150th identities through the same point-read audience for Home and APIs', async () => {
    for (const id of [identities[100], identities[149]]) {
      await expect(isContextualClassroomHomeAdmitted({ id })).resolves.toBe(true)
      await expect(resolveClassroomExperienceAdmission({ id })).resolves.toEqual({ status: 'admitted' })
    }
    await expect(authenticateContextualClassroomHome()).resolves.toEqual(user)
    await expect(authorizeClassroomHomeActor()).resolves.toMatchObject({ contextual: true, user })
    await expect(authenticateClassroomEnrollmentRequest()).resolves.toMatchObject({ mode: 'home_code', user })
    expect(requireRole).not.toHaveBeenCalled()
    expect(readClassroomAdmissionRegistry).toHaveBeenCalledWith(user.id, config.bootstrapManifestSha256)
  })

  it('awaits a negative result instead of admitting a Promise', async () => {
    vi.mocked(readClassroomAdmissionRegistry).mockResolvedValue({ admitted: false, bootstrap_member: false } as never)
    await expect(isContextualClassroomHomeAdmitted(user)).resolves.toBe(false)
    await expect(authenticateContextualClassroomHome()).rejects.toMatchObject({ statusCode: 404 })
    await expect(authorizeClassroomHomeActor()).resolves.toMatchObject({ contextual: false })
    await expect(authenticateClassroomEnrollmentRequest()).resolves.toMatchObject({ mode: 'legacy' })
    expect(requireRole).toHaveBeenCalled()
  })

  it('preserves the Home switch and fails closed on a rejected registry read', async () => {
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'false')
    await expect(isContextualClassroomHomeAdmitted(user)).resolves.toBe(false)
    expect(readClassroomAdmissionRegistry).not.toHaveBeenCalled()
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'true')
    vi.mocked(readClassroomAdmissionRegistry).mockRejectedValue({ statusCode: 503 })
    await expect(authorizeClassroomHomeActor()).rejects.toMatchObject({ statusCode: 503 })
    await expect(authenticateClassroomEnrollmentRequest()).rejects.toMatchObject({ statusCode: 503 })
    expect(requireRole).not.toHaveBeenCalled()
  })

  it('retains the exact v1 Home intersection and its malformed-list failure', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [user.id] }))
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', JSON.stringify([identities[0]]))
    await expect(authorizeClassroomHomeActor()).resolves.toMatchObject({ contextual: false })
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', JSON.stringify([user.id]))
    await expect(authorizeClassroomHomeActor()).resolves.toMatchObject({ contextual: true })
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', 'invalid')
    await expect(isContextualClassroomHomeAdmitted(user)).rejects.toMatchObject({ statusCode: 503 })
    expect(readClassroomAdmissionRegistry).not.toHaveBeenCalled()
  })
})
