import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccessFromRecord } from '@/lib/server/classroom-access'
import {
  assertContextualAssignmentDetailArtifacts,
  assertContextualAssignmentDetailDocs,
  assertContextualAssignmentDetailEnrollments,
  assertContextualAssignmentDetailGradingRun,
  assertContextualAssignmentDetailHistory,
  assertContextualAssignmentDetailProfiles,
  assertContextualAssignmentDetailRequirements,
  assertContextualAssignmentStudentDoc,
  assertContextualAssignmentStudentEnrollment,
  assertContextualAssignmentStudentFeedback,
  assertContextualAssignmentStudentProfile,
  assertContextualAssignmentStudentRepoReview,
  assertContextualAssignmentStudentRepoTarget,
  authorizeClassroomAssignmentDetailRequest,
  canonicalizeContextualAssignmentStudentId,
  resolveContextualAssignmentDetailAccess,
} from '@/lib/server/classroom-assignment-detail-access'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccessFromRecord: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const studentId = '33333333-3333-4333-8333-333333333333'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherClassroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const assignmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const otherAssignmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const docId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const requirementId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const artifactId = '99999999-9999-4999-8999-999999999999'
const feedbackId = '88888888-8888-4888-8888-888888888888'
const repoTargetId = '77777777-7777-4777-8777-777777777777'
const repoReviewId = '66666666-6666-4666-8666-666666666666'
const repoRunId = '55555555-5555-4555-8555-555555555555'

const user = (role: 'student' | 'teacher' = 'student') => ({
  id: actorId,
  role,
  email: 'private@example.com',
} as AuthenticatedUser)

const assignment = (overrides: Record<string, unknown> = {}) => ({
  id: assignmentId,
  classroom_id: classroomId,
  classrooms: {
    id: classroomId,
    teacher_id: actorId,
    archived_at: null,
  },
  ...overrides,
})

describe('classroom assignment detail exact-pair access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      assignmentId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue(user())
    vi.mocked(requireRole).mockResolvedValue(user('teacher'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(['false', '', 'TRUE', '1'])('preserves the legacy role guard with flag %j', async (flag) => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_ENABLED', flag)
    expect(await authorizeClassroomAssignmentDetailRequest('legacy-id', { legacyRole: 'teacher' }))
      .toEqual({ mode: 'legacy', user: user('teacher') })
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(requireAuth).not.toHaveBeenCalled()
  })

  it.each([
    '',
    'not-json',
    '{}',
    '[{"userId":"*","assignmentId":"*"}]',
    JSON.stringify([{ userId: actorId, assignmentId, extra: true }]),
    JSON.stringify(Array(101).fill({ userId: actorId, assignmentId })),
    ' '.repeat(20_001),
  ])('fails closed for invalid enabled configuration', async (pairs) => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_PAIRS', pairs)
    await expect(authorizeClassroomAssignmentDetailRequest(assignmentId, { legacyRole: 'teacher' }))
      .rejects.toMatchObject({ statusCode: 503 })
  })

  it('authenticates before resolving the assignment route value', async () => {
    const resolver = vi.fn().mockReturnValue(assignmentId)
    vi.mocked(requireAuth).mockRejectedValue(new Error('no session'))
    await expect(authorizeClassroomAssignmentDetailRequest(resolver, { legacyRole: 'teacher' }))
      .rejects.toThrow('no session')
    expect(resolver).not.toHaveBeenCalled()
  })

  it('never cross-products separately admitted users and assignments', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_PAIRS', JSON.stringify([
      { userId: actorId, assignmentId },
      { userId: ownerId, assignmentId: otherAssignmentId },
    ]))
    await expect(authorizeClassroomAssignmentDetailRequest(otherAssignmentId, { legacyRole: 'teacher' }))
      .rejects.toMatchObject({ name: 'AuthorizationError' })
    expect(resolveClassroomAccessFromRecord).not.toHaveBeenCalled()
  })

  it('admits a student-valued owner and preserves archived owner reads', async () => {
    const access = await authorizeClassroomAssignmentDetailRequest(assignmentId, { legacyRole: 'teacher' })
    expect(access.mode).toBe('contextual')
    if (access.mode !== 'contextual') throw new Error('Expected contextual access')
    vi.mocked(resolveClassroomAccessFromRecord).mockResolvedValue({
      userId: actorId,
      classroomId,
      ownerId: actorId,
      relationship: 'owner',
      archived: true,
    })
    await expect(resolveContextualAssignmentDetailAccess(access, assignment({
      classrooms: {
        id: classroomId,
        teacher_id: actorId,
        archived_at: '2026-09-01T00:00:00.000Z',
      },
    }), { supabase: {} })).resolves.toMatchObject({ relationship: 'owner' })
  })

  it('rejects substituted bindings and the wrong classroom relationship', async () => {
    const access = await authorizeClassroomAssignmentDetailRequest(assignmentId, { legacyRole: 'teacher' })
    if (access.mode !== 'contextual') throw new Error('Expected contextual access')

    for (const row of [
      assignment({ id: otherAssignmentId }),
      assignment({ classroom_id: otherClassroomId }),
      assignment({ classrooms: { id: otherClassroomId, teacher_id: actorId, archived_at: null } }),
    ]) {
      await expect(resolveContextualAssignmentDetailAccess(access, row, {
        supabase: {},
      })).rejects.toMatchObject({ statusCode: 503 })
    }

    vi.mocked(resolveClassroomAccessFromRecord).mockResolvedValue({
      userId: actorId,
      classroomId,
      ownerId,
      relationship: 'member',
      archived: false,
    })
    await expect(resolveContextualAssignmentDetailAccess(access, assignment(), {
      supabase: {},
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('validates every supporting resource binding', () => {
    const enrollments = [{
      id: ownerId,
      classroom_id: classroomId,
      student_id: studentId,
      users: { id: studentId, email: 'student@example.com' },
    }]
    const profiles = [{ user_id: studentId, first_name: 'Student', last_name: null }]
    const docs = [{ id: docId, assignment_id: assignmentId, student_id: studentId }]
    const requirements = [{ id: requirementId, assignment_id: assignmentId }]
    const artifacts = [{
      id: artifactId,
      assignment_doc_id: docId,
      requirement_id: requirementId,
      student_id: studentId,
    }]
    const history = [{ assignment_doc_id: docId, created_at: '2026-09-01T00:00:00.000Z' }]

    expect(() => assertContextualAssignmentDetailEnrollments(classroomId, enrollments)).not.toThrow()
    expect(() => assertContextualAssignmentDetailProfiles([studentId], profiles)).not.toThrow()
    expect(() => assertContextualAssignmentDetailDocs(assignmentId, [studentId], docs)).not.toThrow()
    expect(() => assertContextualAssignmentDetailRequirements(assignmentId, requirements)).not.toThrow()
    expect(() => assertContextualAssignmentDetailArtifacts(docs, requirements, artifacts)).not.toThrow()
    expect(() => assertContextualAssignmentDetailHistory([docId], history)).not.toThrow()
    expect(() => assertContextualAssignmentDetailGradingRun(assignmentId, {
      assignment_id: assignmentId,
    })).not.toThrow()

    const badCases = [
      () => assertContextualAssignmentDetailEnrollments(classroomId, [{
        ...enrollments[0], classroom_id: otherClassroomId,
      }]),
      () => assertContextualAssignmentDetailProfiles([studentId], [{
        ...profiles[0], user_id: ownerId,
      }]),
      () => assertContextualAssignmentDetailDocs(assignmentId, [studentId], [{
        ...docs[0], assignment_id: otherAssignmentId,
      }]),
      () => assertContextualAssignmentDetailRequirements(assignmentId, [{
        ...requirements[0], assignment_id: otherAssignmentId,
      }]),
      () => assertContextualAssignmentDetailArtifacts(docs, requirements, [{
        ...artifacts[0], student_id: ownerId,
      }]),
      () => assertContextualAssignmentDetailHistory([docId], [{
        ...history[0], assignment_doc_id: ownerId,
      }]),
      () => assertContextualAssignmentDetailGradingRun(assignmentId, {
        assignment_id: otherAssignmentId,
      }),
    ]
    for (const run of badCases) {
      expect(run).toThrowError(expect.objectContaining({ statusCode: 503 }))
    }
  })

  it('canonicalizes the contextual student identifier and rejects aliases', () => {
    expect(canonicalizeContextualAssignmentStudentId(studentId.toUpperCase())).toBe(studentId)
    expect(() => canonicalizeContextualAssignmentStudentId('not-a-uuid'))
      .toThrowError(expect.objectContaining({ statusCode: 400 }))
  })

  it('validates individual student-work bindings and optional absence', () => {
    const enrollment = {
      id: ownerId,
      classroom_id: classroomId,
      student_id: studentId,
      users: { id: studentId, email: 'student@example.com' },
    }
    const profile = { user_id: studentId, first_name: 'Student', last_name: null }
    const doc = { id: docId, assignment_id: assignmentId, student_id: studentId }
    const feedback = [{ id: feedbackId, assignment_id: assignmentId, student_id: studentId }]
    const target = { id: repoTargetId, assignment_id: assignmentId, student_id: studentId }
    const review = {
      id: repoReviewId,
      run_id: repoRunId,
      assignment_id: assignmentId,
      student_id: studentId,
      assignment_repo_review_runs: { status: 'completed' },
    }

    expect(() => assertContextualAssignmentStudentEnrollment(classroomId, studentId, enrollment)).not.toThrow()
    expect(() => assertContextualAssignmentStudentProfile(studentId, profile)).not.toThrow()
    expect(() => assertContextualAssignmentStudentProfile(studentId, null)).not.toThrow()
    expect(() => assertContextualAssignmentStudentDoc(assignmentId, studentId, doc)).not.toThrow()
    expect(() => assertContextualAssignmentStudentDoc(assignmentId, studentId, null)).not.toThrow()
    expect(() => assertContextualAssignmentStudentFeedback(assignmentId, studentId, feedback)).not.toThrow()
    expect(() => assertContextualAssignmentStudentRepoTarget(assignmentId, studentId, target)).not.toThrow()
    expect(() => assertContextualAssignmentStudentRepoTarget(assignmentId, studentId, null)).not.toThrow()
    expect(() => assertContextualAssignmentStudentRepoReview(assignmentId, studentId, review)).not.toThrow()
    expect(() => assertContextualAssignmentStudentRepoReview(assignmentId, studentId, null)).not.toThrow()

    const badCases = [
      () => assertContextualAssignmentStudentEnrollment(classroomId, ownerId, enrollment),
      () => assertContextualAssignmentStudentProfile(ownerId, profile),
      () => assertContextualAssignmentStudentDoc(otherAssignmentId, studentId, doc),
      () => assertContextualAssignmentStudentFeedback(assignmentId, studentId, [{
        ...feedback[0], student_id: ownerId,
      }]),
      () => assertContextualAssignmentStudentRepoTarget(assignmentId, studentId, {
        ...target, assignment_id: otherAssignmentId,
      }),
      () => assertContextualAssignmentStudentRepoReview(assignmentId, studentId, {
        ...review, assignment_repo_review_runs: { status: 'failed' },
      }),
    ]
    for (const run of badCases) {
      expect(run).toThrowError(expect.objectContaining({ statusCode: 503 }))
    }
  })
})
