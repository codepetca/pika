import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { GET, POST } from '@/app/api/teacher/classrooms/[id]/students/[studentId]/purge/live/route'
const mocks = vi.hoisted(() => ({ role: vi.fn(), gate: vi.fn(), target: vi.fn(), read: vi.fn(), reserve: vi.fn(), advance: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.role }))
vi.mock('@/lib/server/live-student-cleanup', () => ({
  isLiveStudentCleanupEnabled: () => false, readLiveStudentCleanup: mocks.read, requireLiveStudentCleanupEnabled: mocks.gate, getLiveStudentCleanupTarget: mocks.target,
  liveStudentCleanup: () => ({ read: mocks.read, reserve: mocks.reserve, advance: mocks.advance }),
}))
const teacher = '10000000-0000-4000-8000-000000000001'
const classroom = '20000000-0000-4000-8000-000000000001'
const student = '30000000-0000-4000-8000-000000000001'
const operation = '40000000-0000-4000-8000-000000000001'
const generation = '50000000-0000-4000-8000-000000000001'
const context = { params: Promise.resolve({ id: classroom, studentId: student }) } as never
const body = { action: 'reserve', operation_id: operation, generation_id: generation, confirmation: 'PURGE LIVE CLASSROOM DATA' }
const request = (patch = {}) => new NextRequest('http://localhost/purge/live', { method: 'POST', body: JSON.stringify({ ...body, ...patch }) })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.role.mockResolvedValue({ id: teacher })
  mocks.target.mockResolvedValue({ generation_id: generation })
  mocks.reserve.mockResolvedValue({ status: 'provider_pending', cleanup_completed: false })
  mocks.advance.mockResolvedValue({ status: 'completed', cleanup_completed: true })
  mocks.read.mockResolvedValue({ status: 'provider_pending', cleanup_completed: false })
})
describe('teacher explicit live purge boundary', () => {
  it('authenticates before reading or reserving anything', async () => {
    mocks.role.mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await POST(request(), context)).status).toBe(403)
    expect(mocks.gate).not.toHaveBeenCalled()
    expect(mocks.reserve).not.toHaveBeenCalled()
  })
  it('is unavailable while its gate is off', async () => {
    mocks.target.mockRejectedValue(new ApiError(404, 'Disabled'))
    expect((await GET(new NextRequest('http://localhost/live'), context)).status).toBe(404)
  })
  it('discovers the retained generation with current teacher and target binding', async () => {
    const response = await GET(new NextRequest('http://localhost/live'), context)
    expect(await response.json()).toEqual({ generation_id: generation })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.target).toHaveBeenCalledWith(teacher, classroom, student)
  })
  it('binds explicit reservation to the authenticated teacher and URL scope', async () => {
    expect((await POST(request(), context)).status).toBe(202)
    expect(mocks.reserve).toHaveBeenCalledWith({ teacherId: teacher, classroomId: classroom, studentId: student, operationId: operation, generationId: generation })
    expect(mocks.advance).not.toHaveBeenCalled()
  })
  it.each([{ confirmation: '' }, { generation_id: 'invalid' }, { teacherId: student }, { action: 'restore' }, { policy: 'strict-v1' }])('rejects invalid or widened input %j', async patch => {
    expect((await POST(request(patch), context)).status).toBe(400)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })
  it('returns 200 only for verified completed advancement', async () => {
    expect((await POST(request({ action: 'advance' }), context)).status).toBe(200)
    mocks.advance.mockResolvedValue({ status: 'provider_pending', cleanup_completed: false })
    expect((await POST(request({ action: 'advance' }), context)).status).toBe(202)
  })
  it('reads exact status with activation off without progressing any provider', async () => {
    mocks.gate.mockImplementation(() => { throw new ApiError(404, 'Disabled') })
    expect((await GET(new NextRequest(`http://localhost/live?operation_id=${operation}&generation_id=${generation}`), context)).status).toBe(200)
    expect(mocks.read).toHaveBeenCalledWith({ teacherId: teacher, classroomId: classroom, studentId: student, operationId: operation, generationId: generation })
    expect(mocks.advance).not.toHaveBeenCalled()
    expect(mocks.gate).not.toHaveBeenCalled()
  })
})


afterEach(() => vi.unstubAllEnvs())
const liveFlags = ['PIKA_LIVE_STUDENT_CLEANUP_ENABLED', 'STUDENT_PROVIDER_CLEANUP_ENABLED',
  'PAL_PROFILE_ERASURE_ENABLED', 'PIKA_BARA_PARTICIPANT_ERASURE_ENABLED',
  'PIKA_REMOVED_STUDENT_ACADEMIC_CLEANUP_ENABLED']
it.each(liveFlags)('rejects reserve and advance before coordinator calls when %s is off, but reads status', async disabled => {
  const actual = await vi.importActual<typeof import('@/lib/server/live-student-cleanup')>('@/lib/server/live-student-cleanup')
  liveFlags.forEach(flag => vi.stubEnv(flag, flag === disabled ? 'false' : 'true'))
  mocks.gate.mockImplementation(actual.requireLiveStudentCleanupEnabled)
  expect((await POST(request(), context)).status).toBe(404)
  expect((await POST(request({ action: 'advance' }), context)).status).toBe(404)
  expect(mocks.reserve).not.toHaveBeenCalled()
  expect(mocks.advance).not.toHaveBeenCalled()
  expect((await GET(new NextRequest(`http://localhost/live?operation_id=${operation}&generation_id=${generation}`), context)).status).toBe(200)
  expect(mocks.read).toHaveBeenCalledOnce()
})
