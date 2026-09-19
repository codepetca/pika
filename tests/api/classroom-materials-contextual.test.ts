import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { authorizeClassroomMaterialRequest } from '@/lib/server/classroom-material-access'
import { GET as teacherGet } from '@/app/api/teacher/classrooms/[id]/materials/route'
import { GET as studentGet } from '@/app/api/student/classrooms/[id]/materials/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
}))
vi.mock('@/lib/server/classroom-material-access', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/classroom-material-access')>(),
  authorizeClassroomMaterialRequest: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherClassroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const materialId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const material = {
  id: materialId,
  classroom_id: classroomId,
  title: 'Reference',
  is_draft: false,
  position: 1,
}
const user = (role: 'student' | 'teacher') => ({ id: actorId, role } as AuthenticatedUser)
const params = { params: Promise.resolve({ id: classroomId }) }
const request = new NextRequest(`http://localhost/api/classrooms/${classroomId}/materials`)

function materialBuilder(rows: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn()
      .mockImplementationOnce(() => builder)
      .mockResolvedValueOnce({ data: rows, error }),
  }
  return builder
}

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

describe('contextual classroom material routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets a student-valued owner read owner materials without the legacy owner guard', async () => {
    vi.mocked(authorizeClassroomMaterialRequest).mockResolvedValue(contextualAccess('student', 'owner'))
    const builder = materialBuilder([material])
    const from = vi.fn(() => builder)
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    const response = await teacherGet(request, params)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ materials: [material] })
    expect(assertTeacherOwnsClassroom).not.toHaveBeenCalled()
  })

  it('lets a teacher-valued member read only the published member projection', async () => {
    vi.mocked(authorizeClassroomMaterialRequest).mockResolvedValue(contextualAccess('teacher', 'member'))
    const builder = materialBuilder([material])
    const from = vi.fn(() => builder)
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    const response = await studentGet(request, params)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ materials: [material] })
    expect(builder.eq).toHaveBeenCalledWith('is_draft', false)
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
  })

  it('returns contextual denials before querying material data', async () => {
    vi.mocked(authorizeClassroomMaterialRequest).mockRejectedValue(new ApiError(403, 'Forbidden'))
    const from = vi.fn()
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    expect((await teacherGet(request, params)).status).toBe(403)
    expect((await studentGet(request, params)).status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'null rows', rows: null },
    { name: 'cross-class rows', rows: [{ ...material, classroom_id: otherClassroomId }] },
    { name: 'malformed rows', rows: [{ ...material, id: 'invalid' }] },
  ])('fails closed on $name from contextual material reads', async ({ rows }) => {
    vi.mocked(authorizeClassroomMaterialRequest).mockResolvedValue(contextualAccess('student', 'owner'))
    const from = vi.fn(() => materialBuilder(rows))
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    expect((await teacherGet(request, params)).status).toBe(503)
  })

  it('validates contextual rows returned by the missing-position fallback', async () => {
    vi.mocked(authorizeClassroomMaterialRequest).mockResolvedValue(contextualAccess('teacher', 'member'))
    const primary = materialBuilder(null, {
      code: 'PGRST204',
      message: "Could not find the 'position' column of 'classwork_materials'",
    })
    const fallback = materialBuilder([{ ...material, classroom_id: otherClassroomId }])
    const from = vi.fn()
      .mockReturnValueOnce(primary)
      .mockReturnValueOnce(fallback)
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    const response = await studentGet(request, params)

    expect(response.status).toBe(503)
    expect(from).toHaveBeenCalledTimes(2)
    expect(fallback.eq).toHaveBeenCalledWith('is_draft', false)
  })

  it('preserves the missing-table empty-list response for an admitted contextual pair', async () => {
    vi.mocked(authorizeClassroomMaterialRequest).mockResolvedValue(contextualAccess('student', 'owner'))
    const from = vi.fn(() => materialBuilder(null, {
      code: 'PGRST205',
      message: "Could not find the table 'public.classwork_materials'",
    }))
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)

    const response = await teacherGet(request, params)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ materials: [] })
  })
})
