import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import {
  authorizeClassroomAssignmentRequest,
  loadContextualClassroomStudentIds,
} from '@/lib/server/classroom-assignment-access'
import { GET as teacherGet } from '@/app/api/teacher/assignments/route'
import { GET as studentGet } from '@/app/api/student/assignments/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
  getClassroomStudentIds: vi.fn(),
}))
vi.mock('@/lib/server/classroom-assignment-access', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/classroom-assignment-access')>(),
  authorizeClassroomAssignmentRequest: vi.fn(),
  loadContextualClassroomStudentIds: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const studentId = '33333333-3333-4333-8333-333333333333'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherClassroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const assignmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const otherAssignmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const rowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const assignment = {
  id: assignmentId,
  classroom_id: classroomId,
  title: 'Essay',
  due_at: '2026-09-30T23:59:59.000Z',
  description: '',
  instructions_markdown: null,
  rich_instructions: null,
  is_draft: false,
  released_at: null,
}
const user = (role: 'student' | 'teacher') => ({ id: actorId, role } as AuthenticatedUser)
const teacherRequest = new NextRequest(
  `http://localhost/api/teacher/assignments?classroom_id=${classroomId}`,
)
const studentRequest = new NextRequest(
  `http://localhost/api/student/assignments?classroom_id=${classroomId}`,
)

function contextualAccess(role: 'student' | 'teacher', relationship: 'owner' | 'member') {
  return {
    mode: 'contextual' as const,
    user: user(role),
    context: {
      userId: actorId,
      classroomId,
      ownerId: relationship === 'owner' ? actorId : ownerId,
      relationship,
      archived: false,
    },
  }
}

function assignmentListBuilder(rows: unknown, error: unknown = null) {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn()
      .mockImplementationOnce(() => builder)
      .mockResolvedValueOnce({ data: rows, error }),
  }
  return builder
}

function assignmentDocsStatsBuilder(rows: unknown, error: unknown = null) {
  return {
    select: vi.fn(() => {
      const query: any = {
        in: vi.fn(() => query),
        order: vi.fn(() => query),
        range: vi.fn().mockResolvedValue({ data: rows, error }),
      }
      return query
    }),
  }
}

function requirementsBuilder(rows: unknown, error: unknown = null) {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn()
      .mockImplementationOnce(() => builder)
      .mockResolvedValueOnce({ data: rows, error }),
  }
  return builder
}

function teacherClient(options: {
  assignments?: unknown
  docs?: unknown
  requirements?: unknown
  docsError?: unknown
}) {
  const from = vi.fn((table: string) => {
    if (table === 'assignments') {
      return assignmentListBuilder(options.assignments === undefined ? [assignment] : options.assignments)
    }
    if (table === 'assignment_docs') {
      return assignmentDocsStatsBuilder(options.docs === undefined ? [{
        assignment_id: assignmentId,
        student_id: studentId,
        is_submitted: false,
        submitted_at: null,
        returned_at: null,
        teacher_cleared_at: null,
      }] : options.docs, options.docsError)
    }
    if (table === 'assignment_submission_requirements') {
      return requirementsBuilder(options.requirements === undefined ? [{
        id: rowId,
        assignment_id: assignmentId,
        type: 'link',
      }] : options.requirements)
    }
    throw new Error(`Unexpected table: ${table}`)
  })
  return { from }
}

function studentClient(options: {
  assignments?: unknown
  docs?: unknown
  assignmentsError?: unknown
  docsError?: unknown
}) {
  const assignmentBuilder: any = {
    select: vi.fn(() => assignmentBuilder),
    eq: vi.fn(() => assignmentBuilder),
    order: vi.fn().mockResolvedValue({
      data: options.assignments === undefined ? [assignment] : options.assignments,
      error: options.assignmentsError ?? null,
    }),
  }
  const docsBuilder: any = {
    select: vi.fn(() => docsBuilder),
    eq: vi.fn(() => docsBuilder),
    in: vi.fn().mockResolvedValue({
      data: options.docs === undefined
        ? [{
            id: rowId,
            assignment_id: assignmentId,
            student_id: actorId,
            returned_at: null,
            feedback_returned_at: null,
          }]
        : options.docs,
      error: options.docsError ?? null,
    }),
  }
  const from = vi.fn((table: string) => table === 'assignments' ? assignmentBuilder : docsBuilder)
  return { from, assignmentBuilder, docsBuilder }
}

describe('contextual classroom assignment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadContextualClassroomStudentIds).mockResolvedValue({
      studentIds: [studentId],
      studentIdSet: new Set([studentId]),
      totalStudents: 1,
    })
  })

  it('lets a student-valued owner read the owner assignment projection and bound support rows', async () => {
    vi.mocked(authorizeClassroomAssignmentRequest).mockResolvedValue(contextualAccess('student', 'owner'))
    const client = teacherClient({})
    vi.mocked(getServiceRoleClient).mockReturnValue(client as unknown as ReturnType<typeof getServiceRoleClient>)

    const response = await teacherGet(teacherRequest)

    expect(response.status).toBe(200)
    expect((await response.json()).assignments).toHaveLength(1)
    expect(assertTeacherOwnsClassroom).not.toHaveBeenCalled()
    expect(loadContextualClassroomStudentIds).toHaveBeenCalledWith(client, classroomId)
  })

  it('lets a teacher-valued member read published assignments and only their own documents', async () => {
    vi.mocked(authorizeClassroomAssignmentRequest).mockResolvedValue(contextualAccess('teacher', 'member'))
    const client = studentClient({})
    vi.mocked(getServiceRoleClient).mockReturnValue(client as unknown as ReturnType<typeof getServiceRoleClient>)

    const response = await studentGet(studentRequest)

    expect(response.status).toBe(200)
    expect((await response.json()).assignments).toHaveLength(1)
    expect(client.assignmentBuilder.eq).toHaveBeenCalledWith('is_draft', false)
    expect(client.docsBuilder.eq).toHaveBeenCalledWith('student_id', actorId)
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
  })

  it('returns contextual denials before service-role reads', async () => {
    vi.mocked(authorizeClassroomAssignmentRequest).mockRejectedValue(new ApiError(403, 'Forbidden'))
    const from = vi.fn()
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    expect((await teacherGet(teacherRequest)).status).toBe(403)
    expect((await studentGet(studentRequest)).status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'null owner assignments', rows: null },
    { name: 'cross-class owner assignments', rows: [{ ...assignment, classroom_id: otherClassroomId }] },
    { name: 'malformed owner assignments', rows: [{ ...assignment, id: 'invalid' }] },
  ])('fails closed on $name', async ({ rows }) => {
    vi.mocked(authorizeClassroomAssignmentRequest).mockResolvedValue(contextualAccess('student', 'owner'))
    vi.mocked(getServiceRoleClient).mockReturnValue(
      teacherClient({ assignments: rows }) as unknown as ReturnType<typeof getServiceRoleClient>
    )
    expect((await teacherGet(teacherRequest)).status).toBe(503)
  })

  it('fails closed when a contextual member assignment is a same-class draft', async () => {
    vi.mocked(authorizeClassroomAssignmentRequest).mockResolvedValue(contextualAccess('teacher', 'member'))
    vi.mocked(getServiceRoleClient).mockReturnValue(
      studentClient({ assignments: [{ ...assignment, is_draft: true }] }) as unknown as ReturnType<typeof getServiceRoleClient>
    )
    expect((await studentGet(studentRequest)).status).toBe(503)
  })

  it('fails closed when a contextual member assignment omits its release policy', async () => {
    vi.mocked(authorizeClassroomAssignmentRequest).mockResolvedValue(contextualAccess('teacher', 'member'))
    const { released_at: _releasedAt, ...missingReleasePolicy } = assignment
    vi.mocked(getServiceRoleClient).mockReturnValue(
      studentClient({ assignments: [missingReleasePolicy] }) as unknown as ReturnType<typeof getServiceRoleClient>
    )
    expect((await studentGet(studentRequest)).status).toBe(503)
  })

  it('fails closed on substituted owner statistics or submission requirements', async () => {
    vi.mocked(authorizeClassroomAssignmentRequest).mockResolvedValue(contextualAccess('student', 'owner'))
    vi.mocked(getServiceRoleClient).mockReturnValue(teacherClient({
      docs: [{ assignment_id: otherAssignmentId, student_id: studentId }],
    }) as unknown as ReturnType<typeof getServiceRoleClient>)
    expect((await teacherGet(teacherRequest)).status).toBe(503)

    vi.mocked(getServiceRoleClient).mockReturnValue(teacherClient({
      requirements: [{ id: rowId, assignment_id: otherAssignmentId }],
    }) as unknown as ReturnType<typeof getServiceRoleClient>)
    expect((await teacherGet(teacherRequest)).status).toBe(503)
  })

  it('fails closed on null owner statistics or requirement evidence', async () => {
    vi.mocked(authorizeClassroomAssignmentRequest).mockResolvedValue(contextualAccess('student', 'owner'))
    vi.mocked(getServiceRoleClient).mockReturnValue(
      teacherClient({ docs: null }) as unknown as ReturnType<typeof getServiceRoleClient>
    )
    expect((await teacherGet(teacherRequest)).status).toBe(503)

    vi.mocked(getServiceRoleClient).mockReturnValue(
      teacherClient({ requirements: null }) as unknown as ReturnType<typeof getServiceRoleClient>
    )
    expect((await teacherGet(teacherRequest)).status).toBe(503)
  })

  it('fails closed on another learner document, another assignment, null rows, or query failure', async () => {
    vi.mocked(authorizeClassroomAssignmentRequest).mockResolvedValue(contextualAccess('teacher', 'member'))
    for (const options of [
      { docs: [{ id: rowId, assignment_id: assignmentId, student_id: studentId, returned_at: null, feedback_returned_at: null }] },
      { docs: [{ id: rowId, assignment_id: otherAssignmentId, student_id: actorId, returned_at: null, feedback_returned_at: null }] },
      { docs: [{ id: rowId, assignment_id: assignmentId, student_id: actorId, returned_at: 'invalid', feedback_returned_at: null }] },
      { docs: [{ id: rowId, assignment_id: assignmentId, student_id: actorId, returned_at: null, feedback_returned_at: 'invalid' }] },
      { docs: null },
      { docs: [], docsError: { message: 'database unavailable' } },
    ]) {
      vi.mocked(getServiceRoleClient).mockReturnValue(
        studentClient(options) as unknown as ReturnType<typeof getServiceRoleClient>
      )
      expect((await studentGet(studentRequest)).status).toBe(503)
    }
  })
})
