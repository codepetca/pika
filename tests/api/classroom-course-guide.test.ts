import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/classrooms/[classroomId]/course-guide/route'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
  assertStudentCanAccessClassroom: vi.fn(),
  getClassroomCourseGuide: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: mocks.assertTeacherOwnsClassroom,
  assertStudentCanAccessClassroom: mocks.assertStudentCanAccessClassroom,
}))

vi.mock('@/lib/server/course-guide', () => ({
  getClassroomCourseGuide: mocks.getClassroomCourseGuide,
}))

const guide = {
  classroom: { title: 'Computer Science', classCode: 'ICS4U' },
  assignments: [],
  tests: [],
}

function request() {
  return new NextRequest('http://localhost/api/classrooms/classroom-1/course-guide')
}

describe('GET /api/classrooms/[classroomId]/course-guide', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getClassroomCourseGuide.mockResolvedValue({ ok: true, guide })
  })

  it('allows the classroom teacher without requiring public sharing', async () => {
    mocks.requireAuth.mockResolvedValue({ id: 'teacher-1', role: 'teacher' })
    mocks.assertTeacherOwnsClassroom.mockResolvedValue({
      ok: true,
      classroom: { id: 'classroom-1', teacher_id: 'teacher-1' },
    })

    const response = await GET(request(), { params: { classroomId: 'classroom-1' } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ guide })
    expect(mocks.getClassroomCourseGuide).toHaveBeenCalledWith('classroom-1')
  })

  it('allows an enrolled student when the Course Guide feature is visible', async () => {
    mocks.requireAuth.mockResolvedValue({ id: 'student-1', role: 'student' })
    mocks.assertStudentCanAccessClassroom.mockResolvedValue({
      ok: true,
      classroom: {
        id: 'classroom-1',
        archived_at: null,
        feature_visibility: { syllabus: true },
      },
    })

    const response = await GET(request(), { params: { classroomId: 'classroom-1' } })

    expect(response.status).toBe(200)
    expect(mocks.getClassroomCourseGuide).toHaveBeenCalledWith('classroom-1')
  })

  it('does not expose a hidden Course Guide to students', async () => {
    mocks.requireAuth.mockResolvedValue({ id: 'student-1', role: 'student' })
    mocks.assertStudentCanAccessClassroom.mockResolvedValue({
      ok: true,
      classroom: {
        id: 'classroom-1',
        archived_at: null,
        feature_visibility: { syllabus: false },
      },
    })

    const response = await GET(request(), { params: { classroomId: 'classroom-1' } })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Course guide is not available' })
    expect(mocks.getClassroomCourseGuide).not.toHaveBeenCalled()
  })

  it('preserves enrollment and ownership denials', async () => {
    mocks.requireAuth.mockResolvedValue({ id: 'student-1', role: 'student' })
    mocks.assertStudentCanAccessClassroom.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Not enrolled in this classroom',
    })

    const response = await GET(request(), { params: { classroomId: 'classroom-1' } })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Not enrolled in this classroom' })
  })
})
