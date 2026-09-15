import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.auth }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))

import { prepareMembershipPalReadRequest } from '@/lib/server/pal-membership'

const student = 'c1680000-0000-4000-8000-000000000002'
const classroom = 'c1680000-0000-4000-8000-000000000010'
const ref = 'pika-membership-v1-5b66aab75f854a339057c4dcc709cb73'

describe('disabled membership-scoped Pal read foundation', () => {
  beforeEach(() => {
    vi.stubEnv('PAL_MEMBERSHIP_IDENTITY_ENABLED', 'true')
    mocks.auth.mockReset().mockResolvedValue({ id: student, role: 'student' })
    mocks.rpc.mockReset().mockResolvedValue({ data: { status: 'active', learner_id: ref }, error: null })
    mocks.client.mockReset().mockReturnValue({ rpc: mocks.rpc })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['', 'false', 'TRUE', '1'])('does no database/provider work when flag is %j', async flag => {
    vi.stubEnv('PAL_MEMBERSHIP_IDENTITY_ENABLED', flag)
    await expect(prepareMembershipPalReadRequest({ classroomId: classroom })).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it('authenticates the student and returns only the opaque provider payload', async () => {
    const result = await prepareMembershipPalReadRequest({ classroomId: classroom })
    expect(mocks.auth).toHaveBeenCalledWith('student')
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_pal_membership', {
      p_student_id: student, p_classroom_id: classroom,
    })
    expect(result).toEqual({ learner_id: ref })
    expect(JSON.stringify(result)).not.toContain(student)
    expect(JSON.stringify(result)).not.toContain(classroom)
  })

  it('rejects a caller-supplied student identity and malformed classroom input', async () => {
    await expect(prepareMembershipPalReadRequest({ classroomId: classroom, studentId: student })).rejects.toThrow()
    await expect(prepareMembershipPalReadRequest({ classroomId: 'invalid' })).rejects.toThrow()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('denies unauthenticated or wrong-role callers before resolving a profile', async () => {
    mocks.auth.mockRejectedValue(new Error('Forbidden'))
    await expect(prepareMembershipPalReadRequest({ classroomId: classroom })).rejects.toThrow('Forbidden')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each(['forbidden', 'disabled'])('fails closed for database status %s', async status => {
    mocks.rpc.mockResolvedValue({ data: { status }, error: null })
    await expect(prepareMembershipPalReadRequest({ classroomId: classroom })).rejects.toMatchObject({
      statusCode: status === 'forbidden' ? 403 : 503,
    })
  })

  it.each(['PGRST202', '42P01', '40001', 'unexpected'])('fails closed without leaking database errors: %s', async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: `private ${student}` } })
    await expect(prepareMembershipPalReadRequest({ classroomId: classroom })).rejects.toMatchObject({
      statusCode: 503, message: 'Classroom Pal identity is unavailable',
    })
  })

  it.each([null, {}, { status: 'active', learner_id: student }, { status: 'active', learner_id: ref, student_id: student }])(
    'rejects malformed or widened provider boundary data', async data => {
      mocks.rpc.mockResolvedValue({ data, error: null })
      await expect(prepareMembershipPalReadRequest({ classroomId: classroom })).rejects.toMatchObject({ statusCode: 503 })
    },
  )

  it('rechecks membership on every call, including after a successful request', async () => {
    await prepareMembershipPalReadRequest({ classroomId: classroom })
    mocks.rpc.mockResolvedValue({ data: { status: 'forbidden' }, error: null })
    await expect(prepareMembershipPalReadRequest({ classroomId: classroom })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('contains transport failures without leaking raw identifiers', async () => {
    mocks.rpc.mockRejectedValue(new Error(`transport failed for ${student}`))
    await expect(prepareMembershipPalReadRequest({ classroomId: classroom })).rejects.toMatchObject({
      statusCode: 503, message: 'Classroom Pal identity is unavailable',
    })
  })

  it('keeps persisted references stable across secret rotation and retries', async () => {
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'old-secret')
    const first = await prepareMembershipPalReadRequest({ classroomId: classroom })
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'new-secret')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'rotated-provider-credential')
    expect(await prepareMembershipPalReadRequest({ classroomId: classroom })).toEqual(first)
  })
})
