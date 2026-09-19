import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { authorizeClassroomLessonPlanRequest } from '@/lib/server/classroom-lesson-plan-access'
import { GET as teacherGet } from '@/app/api/teacher/classrooms/[id]/lesson-plans/route'
import { GET as studentGet } from '@/app/api/student/classrooms/[id]/lesson-plans/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
}))
vi.mock('@/lib/server/classroom-lesson-plan-access', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/classroom-lesson-plan-access')>(),
  authorizeClassroomLessonPlanRequest: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherClassroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const lessonPlanId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const lessonPlan = {
  id: lessonPlanId,
  classroom_id: classroomId,
  date: '2026-09-19',
  content: { type: 'doc', content: [] },
  content_markdown: 'Plan',
}
const user = (role: 'student' | 'teacher') => ({ id: actorId, role } as AuthenticatedUser)
const params = { params: Promise.resolve({ id: classroomId }) }
const request = new NextRequest(
  `http://localhost/api/classrooms/${classroomId}/lesson-plans?start=2026-09-01&end=2026-09-30`,
)

function rangeBuilder(rows: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  return builder
}

function visibilityBuilder(row: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue({ data: row, error: null }),
  }
  return builder
}

describe('contextual classroom lesson-plan routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets a student-valued owner read owner lesson plans without a legacy owner guard', async () => {
    vi.mocked(authorizeClassroomLessonPlanRequest).mockResolvedValue({
      mode: 'contextual',
      user: user('student'),
      context: {
        userId: actorId,
        classroomId,
        ownerId: actorId,
        relationship: 'owner',
        archived: false,
      },
    })
    const from = vi.fn(() => rangeBuilder([lessonPlan]))
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    const response = await teacherGet(request, params)
    expect(response.status).toBe(200)
    expect((await response.json()).lesson_plans).toHaveLength(1)
    expect(assertTeacherOwnsClassroom).not.toHaveBeenCalled()
  })

  it('lets a teacher-valued active member read the visibility-limited member projection', async () => {
    vi.mocked(authorizeClassroomLessonPlanRequest).mockResolvedValue({
      mode: 'contextual',
      user: user('teacher'),
      context: {
        userId: actorId,
        classroomId,
        ownerId,
        relationship: 'member',
        archived: false,
      },
    })
    const range = rangeBuilder([lessonPlan])
    const visibility = visibilityBuilder({ id: classroomId, lesson_plan_visibility: 'all' })
    const from = vi.fn((table: string) => table === 'classrooms' ? visibility : range)
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    const response = await studentGet(request, params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ visibility: 'all', lesson_plans: [{ id: lessonPlanId }] })
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
  })

  it('returns contextual denials before querying lesson-plan data', async () => {
    vi.mocked(authorizeClassroomLessonPlanRequest).mockRejectedValue(new ApiError(403, 'Forbidden'))
    const from = vi.fn()
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    expect((await teacherGet(request, params)).status).toBe(403)
    expect((await studentGet(request, params)).status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it('fails closed on null or cross-class contextual lesson-plan rows', async () => {
    vi.mocked(authorizeClassroomLessonPlanRequest).mockResolvedValue({
      mode: 'contextual',
      user: user('student'),
      context: {
        userId: actorId,
        classroomId,
        ownerId: actorId,
        relationship: 'owner',
        archived: false,
      },
    })
    const fromNull = vi.fn(() => rangeBuilder(null))
    vi.mocked(getServiceRoleClient).mockReturnValue({ from: fromNull } as unknown as ReturnType<typeof getServiceRoleClient>)
    expect((await teacherGet(request, params)).status).toBe(503)

    const substituted = { ...lessonPlan, classroom_id: otherClassroomId }
    const fromSubstituted = vi.fn(() => rangeBuilder([substituted]))
    vi.mocked(getServiceRoleClient).mockReturnValue({ from: fromSubstituted } as unknown as ReturnType<typeof getServiceRoleClient>)
    expect((await teacherGet(request, params)).status).toBe(503)
  })

  it('fails closed when member visibility is bound to another classroom', async () => {
    vi.mocked(authorizeClassroomLessonPlanRequest).mockResolvedValue({
      mode: 'contextual',
      user: user('teacher'),
      context: {
        userId: actorId,
        classroomId,
        ownerId,
        relationship: 'member',
        archived: false,
      },
    })
    const visibility = visibilityBuilder({ id: otherClassroomId, lesson_plan_visibility: 'all' })
    const from = vi.fn(() => visibility)
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    expect((await studentGet(request, params)).status).toBe(503)
  })
})
