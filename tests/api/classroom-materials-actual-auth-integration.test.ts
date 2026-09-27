import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { GET as teacherGet } from '@/app/api/teacher/classrooms/[id]/materials/route'
import { GET as studentGet } from '@/app/api/student/classrooms/[id]/materials/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
}))

const ownerA = 'a1111111-1111-4111-8111-111111111111'
const memberB = 'b2222222-2222-4222-8222-222222222222'
const outsiderC = 'c3333333-3333-4333-8333-333333333333'
const classroomId = 'd4444444-4444-4444-8444-444444444444'
const materialId = 'e5555555-5555-4555-8555-555555555555'

type Classroom = { id: string; teacher_id: string; archived_at: string | null }
type Enrollment = { classroom_id: string; student_id: string } | null

function user(id: string, role: 'student' | 'teacher'): AuthenticatedUser {
  return { id, role, email: `${id}@private.example` } as AuthenticatedUser
}

function materialRows(isDraft = false) {
  return [{
    id: materialId,
    classroom_id: classroomId,
    title: 'Bound material',
    is_draft: isDraft,
    position: 1,
  }]
}

function database({ classroom, enrollment, rows = [] }: {
  classroom: Classroom
  enrollment: Enrollment
  rows?: unknown
}) {
  const classrooms = {
    select: vi.fn(() => classrooms),
    eq: vi.fn(() => classrooms),
    maybeSingle: vi.fn().mockResolvedValue({ data: classroom, error: null }),
  }
  const enrollments = {
    select: vi.fn(() => enrollments),
    eq: vi.fn(() => enrollments),
    maybeSingle: vi.fn().mockResolvedValue({ data: enrollment, error: null }),
  }
  let materialOrderCalls = 0
  const materials = {
    select: vi.fn(() => materials),
    eq: vi.fn(() => materials),
    order: vi.fn(() => {
      materialOrderCalls += 1
      return materialOrderCalls === 2 ? Promise.resolve({ data: rows, error: null }) : materials
    }),
  }
  const from = vi.fn((table: string) => {
    if (table === 'classrooms') return classrooms
    if (table === 'classroom_enrollments') return enrollments
    if (table === 'classwork_materials') return materials
    throw new Error(`Unexpected table: ${table}`)
  })
  return { client: { from }, from, classrooms, enrollments, materials }
}

function configureSharedAdmission(actorId: string) {
  vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({
    version: 1,
    admittedUserIds: [actorId],
  }))
  vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', 'false')
}

function context(id = classroomId) {
  return { params: Promise.resolve({ id }) }
}

describe('actual shared-admission classroom material reads', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('uses one unchanged admitted account as owner of A, member of B, and outsider to C', async () => {
    const actor = user(ownerA, 'teacher')
    const classroomB = 'f6666666-6666-4666-8666-666666666666'
    const classroomC = 'a7777777-7777-4777-8777-777777777777'
    configureSharedAdmission(actor.id)
    vi.mocked(requireAuth).mockResolvedValue(actor)

    const cases = [
      { id: classroomId, owner: actor.id, enrolled: true, handler: teacherGet, status: 200, draft: true },
      { id: classroomB, owner: memberB, enrolled: true, handler: studentGet, status: 200, draft: false },
      { id: classroomC, owner: memberB, enrolled: false, handler: studentGet, status: 403, draft: false },
    ]
    for (const scenario of cases) {
      const rows = materialRows(scenario.draft).map((row) => ({ ...row, classroom_id: scenario.id }))
      const db = database({
        classroom: { id: scenario.id, teacher_id: scenario.owner, archived_at: null },
        enrollment: scenario.enrolled ? { classroom_id: scenario.id, student_id: actor.id } : null,
        rows,
      })
      vi.mocked(getServiceRoleClient).mockReturnValue(db.client as ReturnType<typeof getServiceRoleClient>)
      const response = await scenario.handler(new NextRequest(`http://localhost/api/classrooms/${scenario.id}/materials`), context(scenario.id))

      expect(response.status).toBe(scenario.status)
      expect(db.classrooms.eq).toHaveBeenCalledWith('id', scenario.id)
      if (scenario.owner !== actor.id) {
        expect(db.enrollments.eq).toHaveBeenCalledWith('classroom_id', scenario.id)
        expect(db.enrollments.eq).toHaveBeenCalledWith('student_id', actor.id)
      }
      if (scenario.status === 200) {
        expect(await response.json()).toEqual({ materials: rows })
        expect(db.materials.eq).toHaveBeenCalledWith('classroom_id', scenario.id)
        if (!scenario.draft) expect(db.materials.eq).toHaveBeenCalledWith('is_draft', false)
      } else {
        expect(db.from).not.toHaveBeenCalledWith('classwork_materials')
      }
      expect(actor).toEqual(user(ownerA, 'teacher'))
    }
  })

  it('keeps owner A as the owner despite a historical self-enrollment and returns the owner projection', async () => {
    configureSharedAdmission(ownerA)
    vi.mocked(requireAuth).mockResolvedValue(user(ownerA, 'student'))
    const db = database({
      classroom: { id: classroomId, teacher_id: ownerA, archived_at: null },
      enrollment: { classroom_id: classroomId, student_id: ownerA },
      rows: materialRows(true),
    })
    vi.mocked(getServiceRoleClient).mockReturnValue(db.client as ReturnType<typeof getServiceRoleClient>)

    const response = await teacherGet(new NextRequest(`http://localhost/api/teacher/classrooms/${classroomId}/materials`), context())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ materials: materialRows(true) })
    expect(requireAuth).toHaveBeenCalledTimes(1)
    expect(db.classrooms.eq).toHaveBeenCalledWith('id', classroomId)
    expect(db.from).not.toHaveBeenCalledWith('classroom_enrollments')
    expect(db.materials.eq).toHaveBeenCalledWith('classroom_id', classroomId)
  })

  it('keeps member B as the member and returns only the published member projection', async () => {
    configureSharedAdmission(memberB)
    vi.mocked(requireAuth).mockResolvedValue(user(memberB, 'teacher'))
    const db = database({
      classroom: { id: classroomId, teacher_id: ownerA, archived_at: null },
      enrollment: { classroom_id: classroomId, student_id: memberB },
      rows: materialRows(),
    })
    vi.mocked(getServiceRoleClient).mockReturnValue(db.client as ReturnType<typeof getServiceRoleClient>)

    const response = await studentGet(new NextRequest(`http://localhost/api/student/classrooms/${classroomId}/materials`), context())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ materials: materialRows() })
    expect(requireAuth).toHaveBeenCalledTimes(1)
    expect(db.enrollments.eq).toHaveBeenCalledWith('classroom_id', classroomId)
    expect(db.enrollments.eq).toHaveBeenCalledWith('student_id', memberB)
    expect(db.materials.eq).toHaveBeenCalledWith('classroom_id', classroomId)
    expect(db.materials.eq).toHaveBeenCalledWith('is_draft', false)
  })

  it('denies admitted outsider C before querying material rows', async () => {
    configureSharedAdmission(outsiderC)
    vi.mocked(requireAuth).mockResolvedValue(user(outsiderC, 'student'))
    const db = database({
      classroom: { id: classroomId, teacher_id: ownerA, archived_at: null },
      enrollment: null,
    })
    vi.mocked(getServiceRoleClient).mockReturnValue(db.client as ReturnType<typeof getServiceRoleClient>)

    const response = await studentGet(new NextRequest(`http://localhost/api/student/classrooms/${classroomId}/materials`), context())

    expect(response.status).toBe(403)
    expect(db.enrollments.eq).toHaveBeenCalledWith('student_id', outsiderC)
    expect(db.from).not.toHaveBeenCalledWith('classwork_materials')
    expect(db.materials.select).not.toHaveBeenCalled()
  })

  it('permits an admitted archived owner read while denying an archived member before material rows', async () => {
    const archivedAt = '2026-09-01T00:00:00.000Z'
    configureSharedAdmission(ownerA)
    vi.mocked(requireAuth).mockResolvedValue(user(ownerA, 'student'))
    const ownerDatabase = database({
      classroom: { id: classroomId, teacher_id: ownerA, archived_at: archivedAt },
      enrollment: { classroom_id: classroomId, student_id: ownerA },
      rows: materialRows(true),
    })
    vi.mocked(getServiceRoleClient).mockReturnValue(ownerDatabase.client as ReturnType<typeof getServiceRoleClient>)

    expect((await teacherGet(new NextRequest(`http://localhost/api/teacher/classrooms/${classroomId}/materials`), context())).status)
      .toBe(200)
    expect(ownerDatabase.from).toHaveBeenCalledWith('classwork_materials')

    configureSharedAdmission(memberB)
    vi.mocked(requireAuth).mockResolvedValue(user(memberB, 'teacher'))
    const memberDatabase = database({
      classroom: { id: classroomId, teacher_id: ownerA, archived_at: archivedAt },
      enrollment: { classroom_id: classroomId, student_id: memberB },
    })
    vi.mocked(getServiceRoleClient).mockReturnValue(memberDatabase.client as ReturnType<typeof getServiceRoleClient>)

    expect((await studentGet(new NextRequest(`http://localhost/api/student/classrooms/${classroomId}/materials`), context())).status)
      .toBe(403)
    expect(memberDatabase.classrooms.eq).toHaveBeenCalledWith('id', classroomId)
    expect(memberDatabase.enrollments.eq).toHaveBeenCalledWith('student_id', memberB)
    expect(memberDatabase.from).not.toHaveBeenCalledWith('classwork_materials')
  })

  it('does not reinterpret a self-enrolled owner as a member for the student projection', async () => {
    configureSharedAdmission(ownerA)
    vi.mocked(requireAuth).mockResolvedValue(user(ownerA, 'teacher'))
    const db = database({
      classroom: { id: classroomId, teacher_id: ownerA, archived_at: null },
      enrollment: { classroom_id: classroomId, student_id: ownerA },
    })
    vi.mocked(getServiceRoleClient).mockReturnValue(db.client as ReturnType<typeof getServiceRoleClient>)

    const response = await studentGet(new NextRequest(`http://localhost/api/student/classrooms/${classroomId}/materials`), context())

    expect(response.status).toBe(403)
    expect(db.from).not.toHaveBeenCalledWith('classroom_enrollments')
    expect(db.from).not.toHaveBeenCalledWith('classwork_materials')
  })
})
