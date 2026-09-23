import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/classrooms/[id]/grades/route'
import { mockAuthenticationError, mockAuthorizationError } from '../setup'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), getStudentGrades: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/server/student-grades', () => ({ getStudentGrades: mocks.getStudentGrades }))

const classroomId = '11111111-1111-4111-8111-111111111111'
const studentId = '22222222-2222-4222-8222-222222222222'

function request(id = classroomId) {
  return GET(new NextRequest(`http://localhost/api/student/classrooms/${id}/grades`), {
    params: Promise.resolve({ id }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ id: studentId, role: 'student' })
  mocks.getStudentGrades.mockResolvedValue({ currentPercent: 84, items: [] })
})

describe('GET /api/student/classrooms/[id]/grades', () => {
  it.each([['unauthenticated', mockAuthenticationError(), 401], ['teacher', mockAuthorizationError(), 403]])('rejects %s callers', async (_label, error, status) => {
    mocks.requireRole.mockRejectedValueOnce(error)
    expect((await request()).status).toBe(status)
    expect(mocks.getStudentGrades).not.toHaveBeenCalled()
  })

  it('validates classroom ids before loading grades', async () => {
    expect((await request('invalid')).status).toBe(400)
    expect(mocks.getStudentGrades).not.toHaveBeenCalled()
  })

  it('returns the private student projection without shared caching', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ currentPercent: 84, items: [] })
    expect(mocks.getStudentGrades).toHaveBeenCalledWith(studentId, classroomId)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
