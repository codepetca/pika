import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveClassroomPagePilotAccess } from '@/lib/server/classroom-page-access'
import type { AuthenticatedUser } from '@/types'

const ownerId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherClassroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const authenticatedUser = (
  id = ownerId,
  role: AuthenticatedUser['role'] = 'student',
): AuthenticatedUser => ({ id, role, email: 'private@example.test' })

function query(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
  return builder
}

function database(
  classroom: unknown = { id: classroomId, teacher_id: ownerId, archived_at: null },
  enrollment: unknown = null,
) {
  const classrooms = query(classroom)
  const enrollments = query(enrollment)
  const supabase = {
    from: vi.fn((table: string) => (
      table === 'classrooms' ? classrooms : enrollments
    )),
  }
  return { supabase, classrooms, enrollments }
}

describe('contextual classroom page pilot', () => {
  beforeEach(() => {
    vi.stubEnv('PIKA_CLASSROOM_PAGE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_PAGE_ACCESS_PAIRS', JSON.stringify([{ userId: ownerId, classroomId }]))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(['false', '', 'TRUE', '1'])(
    'preserves legacy routing with flag %j without reading relationships',
    async (flag) => {
      vi.stubEnv('PIKA_CLASSROOM_PAGE_ACCESS_ENABLED', flag)
      const { supabase } = database()

      await expect(resolveClassroomPagePilotAccess(
        authenticatedUser(),
        'legacy-classroom-id',
        { supabase: supabase as never },
      )).resolves.toEqual({ mode: 'legacy' })
      expect(supabase.from).not.toHaveBeenCalled()
    },
  )

  it.each([
    '',
    'not-json',
    '{}',
    JSON.stringify([{ userId: ownerId, classroomId, extra: true }]),
    JSON.stringify(Array(101).fill({ userId: ownerId, classroomId })),
    ' '.repeat(20_001),
  ])('fails closed when enabled configuration is invalid', async (pairs) => {
    vi.stubEnv('PIKA_CLASSROOM_PAGE_ACCESS_PAIRS', pairs)
    const { supabase } = database()

    await expect(resolveClassroomPagePilotAccess(
      authenticatedUser(),
      classroomId,
      { supabase: supabase as never },
    )).rejects.toMatchObject({ statusCode: 503 })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('keeps an authenticated unmatched pair on the legacy page branch', async () => {
    const { supabase } = database()

    await expect(resolveClassroomPagePilotAccess(
      authenticatedUser(),
      otherClassroomId,
      { supabase: supabase as never },
    )).resolves.toEqual({ mode: 'legacy' })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('resolves a student-valued owner without rewriting the session role', async () => {
    const { supabase, enrollments } = database()

    await expect(resolveClassroomPagePilotAccess(
      authenticatedUser(ownerId, 'student'),
      classroomId,
      { supabase: supabase as never },
    )).resolves.toMatchObject({
      mode: 'contextual',
      context: { relationship: 'owner', userId: ownerId, classroomId },
    })
    expect(enrollments.select).not.toHaveBeenCalled()
  })

  it('resolves a teacher-valued active member only from exact enrollment evidence', async () => {
    vi.stubEnv('PIKA_CLASSROOM_PAGE_ACCESS_PAIRS', JSON.stringify([{ userId: memberId, classroomId }]))
    const { supabase, enrollments } = database(
      { id: classroomId, teacher_id: ownerId, archived_at: null },
      { classroom_id: classroomId, student_id: memberId },
    )

    await expect(resolveClassroomPagePilotAccess(
      authenticatedUser(memberId, 'teacher'),
      classroomId,
      { supabase: supabase as never },
    )).resolves.toMatchObject({
      mode: 'contextual',
      context: { relationship: 'member', userId: memberId, classroomId },
    })
    expect(enrollments.eq.mock.calls).toEqual([
      ['classroom_id', classroomId],
      ['student_id', memberId],
    ])
  })

  it('permits archived owner reads but denies archived member access', async () => {
    const archived = '2026-09-01T00:00:00Z'
    const ownerDatabase = database({ id: classroomId, teacher_id: ownerId, archived_at: archived })
    await expect(resolveClassroomPagePilotAccess(
      authenticatedUser(),
      classroomId,
      { supabase: ownerDatabase.supabase as never },
    )).resolves.toMatchObject({ mode: 'contextual', context: { archived: true } })

    vi.stubEnv('PIKA_CLASSROOM_PAGE_ACCESS_PAIRS', JSON.stringify([{ userId: memberId, classroomId }]))
    const memberDatabase = database(
      { id: classroomId, teacher_id: ownerId, archived_at: archived },
      { classroom_id: classroomId, student_id: memberId },
    )
    await expect(resolveClassroomPagePilotAccess(
      authenticatedUser(memberId, 'teacher'),
      classroomId,
      { supabase: memberDatabase.supabase as never },
    )).rejects.toMatchObject({ statusCode: 403 })
  })

  it.each([
    { label: 'missing', classroom: null, error: null, statusCode: 404 },
    { label: 'failed', classroom: null, error: { code: '08006' }, statusCode: 503 },
    { label: 'substituted', classroom: { id: otherClassroomId, teacher_id: ownerId, archived_at: null }, error: null, statusCode: 503 },
  ])('rejects $label classroom evidence without legacy fallback', async ({ classroom, error, statusCode }) => {
    const { supabase, classrooms } = database(classroom)
    classrooms.maybeSingle.mockResolvedValue({ data: classroom, error })

    await expect(resolveClassroomPagePilotAccess(
      authenticatedUser(),
      classroomId,
      { supabase: supabase as never },
    )).rejects.toMatchObject({ statusCode })
  })

  it('canonicalizes exact pairs and rejects malformed enabled identifiers', async () => {
    vi.stubEnv('PIKA_CLASSROOM_PAGE_ACCESS_PAIRS', JSON.stringify([{
      userId: ownerId.toUpperCase(),
      classroomId: classroomId.toUpperCase(),
    }]))
    const { supabase } = database()
    await expect(resolveClassroomPagePilotAccess(
      authenticatedUser(),
      classroomId.toUpperCase(),
      { supabase: supabase as never },
    )).resolves.toMatchObject({ mode: 'contextual' })

    await expect(resolveClassroomPagePilotAccess(
      authenticatedUser(),
      'not-a-uuid',
      { supabase: supabase as never },
    )).rejects.toMatchObject({ statusCode: 400 })
  })
})
