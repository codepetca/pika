import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { withAdmissionRequestContext } from '@/lib/server/admission-request-context'
import {
  isClassroomExperienceRegistryConfigured,
  resolveAttendanceProtocolCompatibility,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc }) }))
const actor = '00000000-0000-4000-8000-000000000101'
const other = '00000000-0000-4000-8000-000000000102'
const manifest = 'a'.repeat(64)
const configuration = { version: 2, source: 'registry', bootstrapManifestSha256: manifest }
const decision = {
  version: 2, registry_revision: 3, bootstrap_manifest_sha256: manifest,
  actor_id: actor, admitted: true, bootstrap_member: false,
}

describe('inactive versioned classroom admission registry', () => {
  beforeEach(() => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify(configuration))
    rpc.mockReset().mockResolvedValue({ data: decision, error: null })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('makes no registry read in unset or version-one installations', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    expect(isClassroomExperienceRegistryConfigured()).toBe(false)
    expect(await resolveClassroomExperienceAdmission({ id: actor })).toEqual({ status: 'not-admitted' })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] }))
    expect(isClassroomExperienceRegistryConfigured()).toBe(false)
    expect(await resolveClassroomExperienceAdmission({ id: actor })).toEqual({ status: 'admitted' })
    expect(await resolveAttendanceProtocolCompatibility({ id: actor })).toEqual({ status: 'admitted' })
    expect(await resolveAttendanceProtocolCompatibility({ id: other })).toEqual({ status: 'not-admitted' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('admits a registry-only actor while keeping that actor out of the provider compatibility set', async () => {
    expect(isClassroomExperienceRegistryConfigured()).toBe(true)
    await withAdmissionRequestContext(async () => {
      expect(await resolveClassroomExperienceAdmission({ id: actor })).toEqual({ status: 'admitted' })
      expect(await resolveAttendanceProtocolCompatibility({ id: actor })).toEqual({ status: 'not-admitted' })
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('read_classroom_experience_admission_v2', { p_actor_id: actor })
  })

  it('preserves bootstrap and negative provider decisions', async () => {
    rpc.mockResolvedValueOnce({ data: { ...decision, bootstrap_member: true }, error: null })
    expect(await resolveAttendanceProtocolCompatibility({ id: actor })).toEqual({ status: 'admitted' })
    rpc.mockResolvedValueOnce({ data: { ...decision, admitted: false }, error: null })
    expect(await resolveClassroomExperienceAdmission({ id: actor })).toEqual({ status: 'not-admitted' })
  })

  it('rejects an invalid authenticated identity before accessing the registry', async () => {
    await expect(resolveClassroomExperienceAdmission({ id: 'not-a-local-user' }))
      .rejects.toMatchObject({ statusCode: 503 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses database error responses even when they contain an apparently valid decision', async () => {
    rpc.mockResolvedValue({ data: decision, error: { code: 'PT503' } })
    await expect(resolveClassroomExperienceAdmission({ id: actor })).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { ...configuration, source: 'unknown' }, { ...configuration, extra: true },
    { ...configuration, bootstrapManifestSha256: 'x' }, { version: 3 },
  ])('rejects malformed configuration before a database read', async (value) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify(value))
    await expect(resolveClassroomExperienceAdmission({ id: actor })).rejects.toMatchObject({ statusCode: 503 })
    expect(() => isClassroomExperienceRegistryConfigured()).toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    null, [], {}, { ...decision, extra: true }, { ...decision, version: 1 },
    { ...decision, actor_id: other }, { ...decision, bootstrap_manifest_sha256: 'b'.repeat(64) },
    { ...decision, registry_revision: 0 }, { ...decision, registry_revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...decision, admitted: false, bootstrap_member: true }, { ...decision, admitted: 'true' },
  ])('refuses malformed, stale-binding or contradictory wire decisions without fallback', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(resolveClassroomExperienceAdmission({ id: actor })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('fails closed and memoizes a failed read only within its API invocation', async () => {
    rpc.mockRejectedValue(new Error('private transport details'))
    const wrapped = withErrorHandler('RegistryTest', async () => {
      const outcomes = await Promise.allSettled([
        resolveClassroomExperienceAdmission({ id: actor }),
        resolveAttendanceProtocolCompatibility({ id: actor }),
      ])
      const failure = outcomes.find((outcome) => outcome.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
      return NextResponse.json({ ok: true })
    })
    const request = new NextRequest('https://example.test/api/registry')
    const response = await wrapped(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private transport')
    expect(rpc).toHaveBeenCalledTimes(1)
    rpc.mockResolvedValue({ data: decision, error: null })
    expect((await wrapped(request, { params: Promise.resolve({}) })).status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('isolates overlapping requests and different actors with no positive cache after the request', async () => {
    rpc.mockImplementation(async (_name, { p_actor_id }) => ({
      data: { ...decision, actor_id: p_actor_id, admitted: p_actor_id === actor }, error: null,
    }))
    const results = await Promise.all([actor, other].map((id) => withAdmissionRequestContext(async () => {
      const [a, b] = await Promise.all([
        resolveClassroomExperienceAdmission({ id }), resolveClassroomExperienceAdmission({ id }),
      ])
      expect(a).toEqual(b)
      return a
    })))
    expect(results).toEqual([{ status: 'admitted' }, { status: 'not-admitted' }])
    expect(rpc).toHaveBeenCalledTimes(2)
    await resolveClassroomExperienceAdmission({ id: actor })
    expect(rpc).toHaveBeenCalledTimes(3)
  })
})
