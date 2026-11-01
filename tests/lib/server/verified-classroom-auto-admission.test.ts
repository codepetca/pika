import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, getServiceRoleClient } = vi.hoisted(() => {
  const rpc = vi.fn()
  return { rpc, getServiceRoleClient: vi.fn(() => ({ rpc })) }
})
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient }))
import { canRequestVerifiedClassroomAdmission, ensureVerifiedClassroomAdmission, tryEnsureVerifiedClassroomAdmission } from '@/lib/server/verified-classroom-auto-admission'

const actor = 'b7644f6e-df35-4097-a8ae-81cc006ca79f'
const manifest = 'a'.repeat(64)

describe('verified classroom auto admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PIKA_CLASSROOM_VERIFIED_AUTO_ADMISSION_ENABLED
    process.env.PIKA_CLASSROOM_HOME_ACCESS_ENABLED = 'true'
    process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION = JSON.stringify({ version: 2, source: 'registry', bootstrapManifestSha256: manifest })
  })
  afterEach(() => {
    delete process.env.PIKA_CLASSROOM_VERIFIED_AUTO_ADMISSION_ENABLED
    delete process.env.PIKA_CLASSROOM_HOME_ACCESS_ENABLED
    delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    vi.useRealTimers()
  })

  it('does not obtain a client or write when disabled or misspelled', async () => {
    await expect(ensureVerifiedClassroomAdmission(actor)).resolves.toBeNull()
    process.env.PIKA_CLASSROOM_VERIFIED_AUTO_ADMISSION_ENABLED = 'TRUE'
    await expect(ensureVerifiedClassroomAdmission(actor)).resolves.toBeNull()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each(['admitted', 'already_admitted', 'growth_stopped', 'excluded', 'unverified'] as const)(
    'accepts the registry %s decision for the server actor', async (outcome) => {
      process.env.PIKA_CLASSROOM_VERIFIED_AUTO_ADMISSION_ENABLED = 'true'
      rpc.mockResolvedValue({ data: { version: 1, outcome, registry_revision: 4 }, error: null })
      await expect(ensureVerifiedClassroomAdmission(actor)).resolves.toEqual({ version: 1, outcome, registry_revision: 4 })
      expect(rpc).toHaveBeenCalledOnce()
      expect(rpc).toHaveBeenCalledWith('ensure_verified_classroom_admission_v1', { p_actor_id: actor, p_bootstrap_manifest_sha256: manifest })
    },
  )

  it('refuses writes with Home off, absent or v1 routing, or malformed v2 selector', async () => {
    process.env.PIKA_CLASSROOM_VERIFIED_AUTO_ADMISSION_ENABLED = 'true'
    process.env.PIKA_CLASSROOM_HOME_ACCESS_ENABLED = 'false'
    await expect(ensureVerifiedClassroomAdmission(actor)).resolves.toBeNull()
    process.env.PIKA_CLASSROOM_HOME_ACCESS_ENABLED = 'true'
    delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    await expect(ensureVerifiedClassroomAdmission(actor)).resolves.toBeNull()
    process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION = JSON.stringify({ version: 1, admittedUserIds: [] })
    await expect(ensureVerifiedClassroomAdmission(actor)).resolves.toBeNull()
    process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION = JSON.stringify({ version: 2, source: 'registry', bootstrapManifestSha256: 'bad' })
    await expect(ensureVerifiedClassroomAdmission(actor)).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('bounds non-responsive transports and does not break authentication', async () => {
    vi.useFakeTimers()
    process.env.PIKA_CLASSROOM_VERIFIED_AUTO_ADMISSION_ENABLED = 'true'
    rpc.mockReturnValue(new Promise(() => {}))
    const operation = tryEnsureVerifiedClassroomAdmission(actor)
    await vi.advanceTimersByTimeAsync(5000)
    await expect(operation).resolves.toBeUndefined()
  })

  it('rejects errors, extra fields and untrusted result shapes', async () => {
    process.env.PIKA_CLASSROOM_VERIFIED_AUTO_ADMISSION_ENABLED = 'true'
    for (const response of [
      { data: null, error: { message: 'private database detail' } },
      { data: { version: 1, outcome: 'admitted', registry_revision: 4, extra: true }, error: null },
      { data: { version: 1, outcome: 'admitted', registry_revision: -1 }, error: null },
    ]) {
      rpc.mockResolvedValueOnce(response)
      await expect(ensureVerifiedClassroomAdmission(actor)).rejects.toThrow('Classroom admission unavailable')
    }
  })

  it('checks display eligibility read-only and rejects uncertain results', async () => {
    await expect(canRequestVerifiedClassroomAdmission(actor)).resolves.toBe(false)
    expect(rpc).not.toHaveBeenCalled()
    process.env.PIKA_CLASSROOM_VERIFIED_AUTO_ADMISSION_ENABLED = 'true'
    rpc.mockResolvedValueOnce({ data: { version: 1, eligible: true }, error: null })
    await expect(canRequestVerifiedClassroomAdmission(actor)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('read_verified_classroom_auto_admission_eligibility_v1', { p_actor_id: actor, p_bootstrap_manifest_sha256: manifest })
    rpc.mockResolvedValueOnce({ data: { version: 1, eligible: false }, error: null })
    await expect(canRequestVerifiedClassroomAdmission(actor)).resolves.toBe(false)
    rpc.mockResolvedValueOnce({ data: { version: 1, eligible: true, detail: 'extra' }, error: null })
    await expect(canRequestVerifiedClassroomAdmission(actor)).rejects.toThrow('Classroom admission unavailable')
  })

  it('does not break successful authentication on a registry outage', async () => {
    process.env.PIKA_CLASSROOM_VERIFIED_AUTO_ADMISSION_ENABLED = 'true'
    rpc.mockRejectedValue(new Error('private detail'))
    await expect(tryEnsureVerifiedClassroomAdmission(actor)).resolves.toBeUndefined()
  })
})
