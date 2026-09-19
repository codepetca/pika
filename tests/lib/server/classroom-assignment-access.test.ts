import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import {
  assertContextualAssignmentRequirements,
  assertContextualAssignmentRows,
  assertContextualAssignmentStatsDocs,
  assertContextualStudentAssignmentDocs,
  authorizeClassroomAssignmentRequest,
  loadContextualClassroomStudentIds,
} from '@/lib/server/classroom-assignment-access'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccess: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const studentId = '33333333-3333-4333-8333-333333333333'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherClassroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const assignmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const otherAssignmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const rowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const user = (role: 'student' | 'teacher' = 'student') => ({
  id: actorId,
  role,
  email: 'private@example.com',
} as AuthenticatedUser)
const context = (relationship: 'owner' | 'member' | 'none', archived = false) => ({
  userId: actorId,
  classroomId,
  ownerId: relationship === 'owner' ? actorId : ownerId,
  relationship,
  archived,
})

describe('classroom assignment exact-pair access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      classroomId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue(user())
    vi.mocked(requireRole).mockResolvedValue(user('teacher'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(['false', '', 'TRUE', '1'])('preserves the legacy role guard with flag %j', async (flag) => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_ENABLED', flag)
    expect(await authorizeClassroomAssignmentRequest('legacy-id', {
      legacyRole: 'teacher', permission: 'owner',
    })).toEqual({ mode: 'legacy', user: user('teacher') })
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(requireAuth).not.toHaveBeenCalled()
  })

  it.each([
    '',
    'not-json',
    '{}',
    '[{"userId":"*","classroomId":"*"}]',
    JSON.stringify([{ userId: actorId, classroomId, extra: true }]),
    JSON.stringify(Array(101).fill({ userId: actorId, classroomId })),
    ' '.repeat(20_001),
  ])('fails closed for invalid enabled configuration', async (pairs) => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_PAIRS', pairs)
    await expect(authorizeClassroomAssignmentRequest(classroomId, {
      legacyRole: 'teacher', permission: 'owner',
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('authenticates before resolving the classroom query value', async () => {
    const resolver = vi.fn().mockReturnValue(classroomId)
    vi.mocked(requireAuth).mockRejectedValue(new Error('no session'))
    await expect(authorizeClassroomAssignmentRequest(resolver, {
      legacyRole: 'teacher', permission: 'owner',
    })).rejects.toThrow('no session')
    expect(resolver).not.toHaveBeenCalled()
  })

  it('preserves legacy validation and wrong-role denial for missing, malformed, and unmatched values', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    for (const value of [null, 'legacy-id', otherClassroomId]) {
      expect((await authorizeClassroomAssignmentRequest(value, {
        legacyRole: 'teacher', permission: 'owner',
      })).mode).toBe('legacy')
    }

    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    await expect(authorizeClassroomAssignmentRequest(null, {
      legacyRole: 'teacher', permission: 'owner',
    })).rejects.toMatchObject({ name: 'AuthorizationError' })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('never cross-products separately admitted users and classrooms', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_PAIRS', JSON.stringify([
      { userId: actorId, classroomId },
      { userId: ownerId, classroomId: otherClassroomId },
    ]))
    await expect(authorizeClassroomAssignmentRequest(otherClassroomId, {
      legacyRole: 'teacher', permission: 'owner',
    })).rejects.toMatchObject({ name: 'AuthorizationError' })
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it('admits only the requested contextual relationship and lifecycle', async () => {
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('owner'))
    expect((await authorizeClassroomAssignmentRequest(classroomId, {
      legacyRole: 'teacher', permission: 'owner',
    })).mode).toBe('contextual')
    await expect(authorizeClassroomAssignmentRequest(classroomId, {
      legacyRole: 'student', permission: 'member',
    })).rejects.toMatchObject({ statusCode: 403 })

    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('member'))
    expect((await authorizeClassroomAssignmentRequest(classroomId, {
      legacyRole: 'student', permission: 'member',
    })).mode).toBe('contextual')

    vi.mocked(resolveClassroomAccess).mockResolvedValue(context('member', true))
    await expect(authorizeClassroomAssignmentRequest(classroomId, {
      legacyRole: 'student', permission: 'member',
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('validates owner and published-member assignment rows', () => {
    const ownerRows = [{ id: assignmentId, classroom_id: classroomId, is_draft: true }]
    expect(() => assertContextualAssignmentRows(classroomId, ownerRows, { publishedOnly: false })).not.toThrow()
    expect(() => assertContextualAssignmentRows(classroomId, ownerRows, { publishedOnly: true }))
      .toThrowError(expect.objectContaining({ statusCode: 503 }))

    for (const rows of [
      null,
      [{ id: 'invalid', classroom_id: classroomId, is_draft: false }],
      [{ id: assignmentId, classroom_id: otherClassroomId, is_draft: false }],
    ]) {
      expect(() => assertContextualAssignmentRows(classroomId, rows, { publishedOnly: false }))
        .toThrowError(expect.objectContaining({ statusCode: 503 }))
    }
  })

  it('validates stats, requirement, and own-document support rows', () => {
    expect(() => assertContextualAssignmentStatsDocs(
      [assignmentId], [studentId], [{ assignment_id: assignmentId, student_id: studentId }]
    )).not.toThrow()
    expect(() => assertContextualAssignmentRequirements(assignmentId, [{
      id: rowId, assignment_id: assignmentId,
    }])).not.toThrow()
    expect(() => assertContextualStudentAssignmentDocs(actorId, [assignmentId], [{
      id: rowId, assignment_id: assignmentId, student_id: actorId,
    }])).not.toThrow()

    expect(() => assertContextualAssignmentStatsDocs(
      [assignmentId], [studentId], [{ assignment_id: otherAssignmentId, student_id: studentId }]
    )).toThrowError(expect.objectContaining({ statusCode: 503 }))
    expect(() => assertContextualAssignmentRequirements(assignmentId, [{
      id: rowId, assignment_id: otherAssignmentId,
    }])).toThrowError(expect.objectContaining({ statusCode: 503 }))
    expect(() => assertContextualStudentAssignmentDocs(actorId, [assignmentId], [{
      id: rowId, assignment_id: assignmentId, student_id: studentId,
    }])).toThrowError(expect.objectContaining({ statusCode: 503 }))
  })

  it('loads a subject-bound contextual roster and rejects substituted evidence', async () => {
    function client(rows: unknown, count: number | null = 1, error: unknown = null) {
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        order: vi.fn(() => builder),
        range: vi.fn().mockResolvedValue({ data: rows, count, error }),
      }
      return { from: vi.fn(() => builder) }
    }

    await expect(loadContextualClassroomStudentIds(client([{
      classroom_id: classroomId,
      student_id: studentId,
    }]), classroomId)).resolves.toMatchObject({ studentIds: [studentId], totalStudents: 1 })

    for (const badClient of [
      client(null),
      client([{ classroom_id: otherClassroomId, student_id: studentId }]),
      client([{ classroom_id: classroomId, student_id: 'invalid' }]),
      client([{ classroom_id: classroomId, student_id: studentId }], 2),
      client([], 0, { message: 'database unavailable' }),
    ]) {
      await expect(loadContextualClassroomStudentIds(badClient, classroomId))
        .rejects.toMatchObject({ statusCode: 503 })
    }
  })
})
