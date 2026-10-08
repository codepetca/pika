import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { authorizeClassroomAnnouncementRequest } from '@/lib/server/classroom-announcement-access'
import { GET as teacherGet } from '@/app/api/teacher/classrooms/[id]/announcements/route'
import { GET as studentGet } from '@/app/api/student/classrooms/[id]/announcements/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
}))
vi.mock('@/lib/server/classroom-announcement-access', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/classroom-announcement-access')>(),
  authorizeClassroomAnnouncementRequest: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherClassroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const announcementId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const announcement = {
  id: announcementId,
  classroom_id: classroomId,
  content: 'Visible announcement',
  is_draft: false,
}
const user = (role: 'student' | 'teacher') => ({ id: actorId, role } as AuthenticatedUser)
const params = { params: Promise.resolve({ id: classroomId }) }
const request = (method = 'GET') => new NextRequest(
  `http://localhost/api/classrooms/${classroomId}/announcements`,
  { method },
)

function readBuilder(rows: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
  }
  return builder
}

describe('contextual classroom announcement routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets a student-valued owner read owner announcements without a legacy owner guard', async () => {
    vi.mocked(authorizeClassroomAnnouncementRequest).mockResolvedValue({
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
    const from = vi.fn(() => readBuilder([announcement]))
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    const response = await teacherGet(request(), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ announcements: [announcement] })
    expect(assertTeacherOwnsClassroom).not.toHaveBeenCalled()
  })

  it('lets a teacher-valued member read only the published member projection', async () => {
    vi.mocked(authorizeClassroomAnnouncementRequest).mockResolvedValue({
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
    const builder = readBuilder([announcement])
    const from = vi.fn(() => builder)
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    const response = await studentGet(request(), params)
    expect(response.status).toBe(200)
    expect(builder.eq).toHaveBeenCalledWith('is_draft', false)
    expect(builder.or).toHaveBeenCalledWith('scheduled_for.is.null,scheduled_for.lte.now()')
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
  })

  it('returns contextual denials before querying announcement data', async () => {
    vi.mocked(authorizeClassroomAnnouncementRequest).mockRejectedValue(new ApiError(403, 'Forbidden'))
    const from = vi.fn()
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    expect((await teacherGet(request(), params)).status).toBe(403)
    expect((await studentGet(request(), params)).status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it('fails closed on null or cross-class contextual rows before disclosure', async () => {
    vi.mocked(authorizeClassroomAnnouncementRequest).mockResolvedValue({
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
    const fromNull = vi.fn(() => readBuilder(null))
    vi.mocked(getServiceRoleClient).mockReturnValue({ from: fromNull } as unknown as ReturnType<typeof getServiceRoleClient>)
    expect((await studentGet(request(), params)).status).toBe(503)

    const substituted = { ...announcement, classroom_id: otherClassroomId }
    const fromSubstituted = vi.fn(() => readBuilder([substituted]))
    vi.mocked(getServiceRoleClient).mockReturnValue({ from: fromSubstituted } as unknown as ReturnType<typeof getServiceRoleClient>)
    expect((await studentGet(request(), params)).status).toBe(503)
  })
})
