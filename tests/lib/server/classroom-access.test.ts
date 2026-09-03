import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getServiceRoleClient } from '@/lib/supabase'
import { resolveClassroomAccess, resolveClassroomAccessFromRecord } from '@/lib/server/classroom-access'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))

const ownerId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const classroom = { id: classroomId, teacher_id: ownerId, archived_at: null }

function query(data: unknown, error: unknown = null) {
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }) }
}
function client(classroomData: unknown = classroom, enrollmentData: unknown = null, error: unknown = null) {
  const classrooms = query(classroomData, error)
  const enrollments = query(enrollmentData)
  const supabase = { from: vi.fn((table: string) => {
    if (table === 'classrooms') return classrooms
    if (table === 'classroom_enrollments') return enrollments
    throw new Error(`Unexpected table: ${table}`)
  }) }
  vi.mocked(getServiceRoleClient).mockReturnValue(supabase as unknown as ReturnType<typeof getServiceRoleClient>)
  return { supabase, classrooms, enrollments }
}

describe('read-only dormant classroom relationship resolver', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses ownership first and never needs enrollment or global role for the owner', async () => {
    const { supabase, classrooms } = client()
    expect(await resolveClassroomAccess(ownerId, classroomId)).toEqual({
      userId: ownerId, classroomId, ownerId, relationship: 'owner', archived: false,
    })
    expect(supabase.from.mock.calls).toEqual([['classrooms']])
    expect(classrooms.select).toHaveBeenCalledWith('id, teacher_id, archived_at')
    expect(classrooms.eq.mock.calls).toEqual([['id', classroomId]])
  })

  it('loads enrollment with both classroom and authenticated-user filters', async () => {
    const { enrollments } = client(classroom, { classroom_id: classroomId, student_id: memberId })
    expect(await resolveClassroomAccess(memberId, classroomId)).toEqual({
      userId: memberId, classroomId, ownerId, relationship: 'member', archived: false,
    })
    expect(enrollments.select).toHaveBeenCalledWith('classroom_id, student_id')
    expect(enrollments.eq.mock.calls).toEqual([['classroom_id', classroomId], ['student_id', memberId]])
  })

  it('represents no relationship explicitly, not as a member', async () => {
    client()
    expect((await resolveClassroomAccess(memberId, classroomId))?.relationship).toBe('none')
  })

  it('preserves archived ownership for policy evaluation', async () => {
    client({ ...classroom, archived_at: '2026-09-01T00:00:00Z' })
    expect(await resolveClassroomAccess(ownerId, classroomId)).toMatchObject({ relationship: 'owner', archived: true })
  })

  it('returns null only when the classroom is genuinely absent', async () => {
    const { supabase } = client(null)
    await expect(resolveClassroomAccess(ownerId, classroomId)).resolves.toBeNull()
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it.each([
    { classroomData: null, error: { code: '08006' } },
    { classroomData: { ...classroom, teacher_id: null }, error: null },
    { classroomData: { ...classroom, archived_at: undefined }, error: null },
    { classroomData: { ...classroom, archived_at: 'not-a-timestamp' }, error: null },
    { classroomData: { ...classroom, id: memberId }, error: null },
  ])('does not hide failures or malformed rows as absence %j', async ({ classroomData, error }) => {
    client(classroomData, null, error)
    await expect(resolveClassroomAccess(ownerId, classroomId))
      .rejects.toMatchObject({ statusCode: 503, message: 'Unable to resolve classroom access' })
  })

  it.each([
    { classroom_id: ownerId, student_id: memberId },
    { classroom_id: classroomId, student_id: ownerId },
    {},
  ])('rejects mismatched or malformed enrollment rows %j', async (enrollment) => {
    client(classroom, enrollment)
    await expect(resolveClassroomAccess(memberId, classroomId)).rejects.toMatchObject({ statusCode: 503 })
  })

  it('does not treat enrollment outages as unenrolled', async () => {
    const { enrollments } = client()
    enrollments.maybeSingle.mockResolvedValue({ data: null, error: { code: '08006' } })
    await expect(resolveClassroomAccess(memberId, classroomId)).rejects.toMatchObject({ statusCode: 503 })
  })

  it('accepts an injected server client without acquiring another', async () => {
    const { supabase } = client()
    await resolveClassroomAccess(ownerId, classroomId, {
      supabase: supabase as unknown as ReturnType<typeof getServiceRoleClient>,
    })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each([['', classroomId], [ownerId, ''], ['not-a-user', classroomId]])('rejects invalid identifiers before querying', async (userId, id) => {
    client()
    await expect(resolveClassroomAccess(userId, id)).rejects.toMatchObject({ statusCode: 400 })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each([['', classroomId], [ownerId, '']])('validates identifiers on the trusted-row entrypoint too', async (userId, id) => {
    client()
    await expect(resolveClassroomAccessFromRecord(userId, id, classroom)).rejects.toMatchObject({ statusCode: 400 })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('reuses an already-fetched classroom and acquires a client only for a necessary membership read', async () => {
    const { supabase } = client()
    expect((await resolveClassroomAccessFromRecord(ownerId, classroomId, classroom)).relationship).toBe('owner')
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect((await resolveClassroomAccessFromRecord(memberId, classroomId, classroom)).relationship).toBe('none')
    expect(supabase.from.mock.calls).toEqual([['classroom_enrollments']])
  })
})
