import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/assignments/[id]/students/[studentId]/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { resolveClassroomAccessFromRecord } from '@/lib/server/classroom-access'
import { loadAssignmentFeedbackEntries } from '@/lib/server/assignment-feedback'
import { loadAssignmentRepoTarget } from '@/lib/server/assignment-repo-targets'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccessFromRecord: vi.fn() }))
vi.mock('@/lib/server/assignment-feedback', () => ({
  loadAssignmentFeedbackEntries: vi.fn(),
}))
vi.mock('@/lib/server/assignment-submission-artifacts', () => ({
  loadAssignmentSubmissionArtifactsForDoc: vi.fn(async () => []),
  loadAssignmentSubmissionRequirements: vi.fn(async () => []),
}))
vi.mock('@/lib/server/assignment-repo-targets', () => ({
  extractRepoArtifactsFromContent: vi.fn(() => []),
  loadAssignmentRepoTarget: vi.fn(),
  resolveAssignmentRepoTarget: vi.fn(() => ({
    target: null,
    candidateRepos: [],
    submittedRepoUrl: null,
    submittedGitHubUsername: null,
    effectiveRepoUrl: null,
    effectiveGitHubUsername: null,
    repoOwner: null,
    repoName: null,
    selectionMode: 'auto',
    validationStatus: 'missing',
    validationMessage: null,
  })),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const studentId = '22222222-2222-4222-8222-222222222222'
const otherStudentId = '33333333-3333-4333-8333-333333333333'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const assignmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const otherAssignmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const enrollmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

type QueryResult = { data: unknown; error: unknown }

const assignment = {
  id: assignmentId,
  classroom_id: classroomId,
  title: 'Contextual assignment',
  description: null,
  instructions_markdown: '',
  rich_instructions: null,
  due_at: null,
  position: 0,
  created_by: actorId,
  created_at: '2026-09-18T12:00:00.000Z',
  updated_at: '2026-09-18T12:00:00.000Z',
  released_at: null,
  classrooms: {
    id: classroomId,
    teacher_id: actorId,
    title: 'Owned classroom',
    archived_at: '2026-09-19T12:00:00.000Z',
  },
}

const enrollment = {
  id: enrollmentId,
  classroom_id: classroomId,
  student_id: studentId,
  users: { id: studentId, email: 'student@example.test' },
}

let tableResults: Record<string, { single?: QueryResult; rows?: QueryResult }>
let eqCalls: Array<{ table: string; column: string; value: unknown }>

function createQuery(table: string) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push({ table, column, value })
      return query
    }),
    order: vi.fn(() => query),
    single: vi.fn(async () => tableResults[table]?.single ?? { data: null, error: null }),
    limit: vi.fn(async () => tableResults[table]?.rows ?? { data: [], error: null }),
  }
  return query
}

describe('contextual GET /api/teacher/assignments/[id]/students/[studentId]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      assignmentId,
    }]))
    tableResults = {
      assignments: { single: { data: assignment, error: null } },
      classroom_enrollments: { rows: { data: [enrollment], error: null } },
      student_profiles: { rows: { data: [], error: null } },
      assignment_docs: { rows: { data: [], error: null } },
      assignment_repo_review_results: { rows: { data: [], error: null } },
    }
    eqCalls = []
    const supabase = { from: vi.fn((table: string) => createQuery(table)) }
    vi.mocked(getServiceRoleClient).mockReturnValue(supabase as never)
    vi.mocked(requireAuth).mockResolvedValue({
      id: actorId,
      role: 'student',
      email: 'owner@example.test',
    })
    vi.mocked(requireRole).mockResolvedValue({
      id: actorId,
      role: 'teacher',
      email: 'owner@example.test',
    })
    vi.mocked(resolveClassroomAccessFromRecord).mockResolvedValue({
      userId: actorId,
      classroomId,
      ownerId: actorId,
      relationship: 'owner',
      archived: true,
    })
    vi.mocked(loadAssignmentFeedbackEntries).mockResolvedValue([])
    vi.mocked(loadAssignmentRepoTarget).mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('admits a student-valued archived owner and canonicalizes both route identifiers', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}/students/${studentId}`),
      { params: { id: assignmentId.toUpperCase(), studentId: studentId.toUpperCase() } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      assignment: { id: assignmentId },
      classroom: { id: classroomId, teacher_id: actorId, title: 'Owned classroom' },
      student: { id: studentId, email: 'student@example.test', name: null },
      doc: null,
    })
    expect(body.classroom).not.toHaveProperty('archived_at')
    expect(requireRole).not.toHaveBeenCalled()
    expect(loadAssignmentFeedbackEntries).toHaveBeenCalledWith(assignmentId, studentId, {
      supabase: expect.anything(),
      requireDataArray: true,
    })
    expect(loadAssignmentRepoTarget).toHaveBeenCalledWith(assignmentId, studentId, {
      supabase: expect.anything(),
      requireEvidence: true,
    })
    expect(eqCalls).toContainEqual({ table: 'assignments', column: 'id', value: assignmentId })
    expect(eqCalls).toContainEqual({ table: 'classroom_enrollments', column: 'student_id', value: studentId })
  })

  it('rejects an invalid contextual student identifier before creating a service client', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}/students/not-a-uuid`),
      { params: { id: assignmentId, studentId: 'not-a-uuid' } },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid student identifier' })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('authenticates before resolving either route parameter', async () => {
    const authError = new Error('No session')
    authError.name = 'AuthenticationError'
    vi.mocked(requireAuth).mockRejectedValue(authError)
    const params = {
      then: vi.fn((resolve: (value: { id: string; studentId: string }) => unknown) => resolve({
        id: assignmentId,
        studentId,
      })),
    }

    const response = await GET(
      new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}/students/${studentId}`),
      { params: params as never },
    )

    expect(response.status).toBe(401)
    expect(params.then).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('returns not found only from an available empty roster result', async () => {
    tableResults.classroom_enrollments = { rows: { data: [], error: null } }

    const response = await GET(
      new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}/students/${studentId}`),
      { params: { id: assignmentId, studentId } },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Student not found in classroom' })
  })

  it.each([
    ['unavailable roster', () => {
      tableResults.classroom_enrollments = { rows: { data: null, error: null } }
    }],
    ['substituted roster row', () => {
      tableResults.classroom_enrollments = { rows: { data: [{
        ...enrollment,
        student_id: otherStudentId,
        users: { id: otherStudentId, email: 'other@example.test' },
      }], error: null } }
    }],
    ['substituted profile', () => {
      tableResults.student_profiles = { rows: { data: [{
        user_id: otherStudentId,
        first_name: 'Other',
        last_name: 'Student',
      }], error: null } }
    }],
    ['unavailable document evidence', () => {
      tableResults.assignment_docs = { rows: { data: null, error: null } }
    }],
  ])('fails closed for %s', async (_label, arrange) => {
    arrange()

    const response = await GET(
      new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}/students/${studentId}`),
      { params: { id: assignmentId, studentId } },
    )

    expect(response.status).toBe(503)
  })

  it('rejects substituted feedback and repository review evidence', async () => {
    vi.mocked(loadAssignmentFeedbackEntries).mockResolvedValue([{
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      assignment_id: otherAssignmentId,
      student_id: studentId,
      entry_kind: 'teacher_feedback',
      author_type: 'teacher',
      body: 'Substituted',
      returned_at: '2026-09-19T12:00:00.000Z',
      created_at: '2026-09-19T12:00:00.000Z',
      created_by: actorId,
    }])

    const feedbackResponse = await GET(
      new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}/students/${studentId}`),
      { params: { id: assignmentId, studentId } },
    )
    expect(feedbackResponse.status).toBe(503)

    vi.mocked(loadAssignmentFeedbackEntries).mockResolvedValue([])
    tableResults.assignment_repo_review_results = { rows: { data: [{
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      run_id: '99999999-9999-4999-8999-999999999999',
      assignment_id: assignmentId,
      student_id: otherStudentId,
      assignment_repo_review_runs: { status: 'completed' },
    }], error: null } }

    const reviewResponse = await GET(
      new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}/students/${studentId}`),
      { params: { id: assignmentId, studentId } },
    )
    expect(reviewResponse.status).toBe(503)
  })

  it('preserves role-first denial for an unmatched student-valued caller', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/teacher/assignments/${otherAssignmentId}/students/${studentId}`),
      { params: { id: otherAssignmentId, studentId } },
    )

    expect(response.status).toBe(403)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
})
