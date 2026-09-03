import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as begin } from '@/app/api/teacher/classrooms/[id]/attendance-decommission/route'
import { GET as status, POST as tick } from '@/app/api/teacher/classrooms/[id]/attendance-decommission/[operationId]/route'
const mock = vi.hoisted(() => ({ auth: vi.fn(), begin: vi.fn(), status: vi.fn(), tick: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mock.auth }))
vi.mock('@/lib/server/bara-attendance-decommission', () => ({
  beginAttendanceDecommission: mock.begin, getAttendanceDecommission: mock.status, tickAttendanceDecommission: mock.tick,
}))
const teacherId = '10000000-0000-4000-8000-000000000001'
const id = '20000000-0000-4000-8000-000000000001'
const operationId = '30000000-0000-4000-8000-000000000001'
const context = { params: Promise.resolve({ id, operationId }) } as never
beforeEach(() => {
  vi.clearAllMocks()
  mock.auth.mockResolvedValue({ id: teacherId })
  mock.begin.mockResolvedValue({ attendance_removed: false })
  mock.status.mockResolvedValue({ attendance_removed: false })
  mock.tick.mockResolvedValue({ attendance_removed: true, classroom_deleted: false })
})
describe('teacher attendance-decommission routes', () => {
  it('binds tick and status to the signed-in teacher, classroom, and operation', async () => {
    const response = await tick(new NextRequest('http://localhost/tick', { method: 'POST' }), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mock.tick).toHaveBeenCalledWith({ teacherId, classroomId: id, operationId })
    await status(new NextRequest('http://localhost/status'), context)
    expect(mock.status).toHaveBeenCalledWith({ teacherId, classroomId: id, operationId })
  })
  it('rejects students before reading or mutating anything', async () => {
    const error = new Error('Forbidden'); error.name = 'AuthorizationError'
    mock.auth.mockRejectedValue(error)
    for (const handler of [begin, status, tick]) {
      expect((await handler(new NextRequest('http://localhost/deletion', { method: 'POST' }), context)).status).toBe(403)
    }
    expect(mock.begin).not.toHaveBeenCalled(); expect(mock.tick).not.toHaveBeenCalled(); expect(mock.status).not.toHaveBeenCalled()
  })
  it('requires typed confirmation and rejects extra authority fields', async () => {
    const valid = { operation_id: operationId, confirmation: 'DELETE' }
    const beginContext = { params: Promise.resolve({ id }) } as never
    const response = await begin(new NextRequest('http://localhost/deletion', { method: 'POST', body: JSON.stringify(valid) }), beginContext)
    expect(response.status).toBe(202)
    expect(mock.begin).toHaveBeenCalledWith({ teacherId, classroomId: id, operationId, confirmation: 'DELETE' })
    expect((await begin(new NextRequest('http://localhost/deletion', { method: 'POST', body: JSON.stringify({ ...valid, teacher_id: 'other' }) }), beginContext)).status).toBe(400)
  })
})
