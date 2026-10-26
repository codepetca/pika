vi.mock('@/lib/server/repolight-removed-student-cleanup', () => ({ getRepoLightRemovedContext: mocks.remoteContext, reserveRepoLightRemovedCleanup: mocks.remoteReserve, advanceRepoLightRemovedCleanup: mocks.remoteAdvance }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { GET, POST } from '@/app/api/teacher/classrooms/[id]/students/[studentId]/purge/live/route'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), gate: vi.fn(), manualGate: vi.fn(), target: vi.fn(), read: vi.fn(), reserve: vi.fn(), advance: vi.fn(), remoteContext: vi.fn(), remoteReserve: vi.fn(), remoteAdvance: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.role, requireAuth: mocks.auth }))
vi.mock('@/lib/server/live-student-cleanup', () => ({
  isManualRepoLightCleanupEnabled: mocks.manualGate, isLiveStudentCleanupEnabled: () => false, readLiveStudentCleanup: mocks.read, requireLiveStudentCleanupEnabled: mocks.gate, getLiveStudentCleanupTarget: mocks.target,
  liveStudentCleanup: () => ({ read: mocks.read, reserve: mocks.reserve, advance: mocks.advance }),
}))
const teacher = '10000000-0000-4000-8000-000000000001'
const classroom = '20000000-0000-4000-8000-000000000001'
const student = '30000000-0000-4000-8000-000000000001'
const operation = '40000000-0000-4000-8000-000000000001'
const generation = '50000000-0000-4000-8000-000000000001'
const context = { params: Promise.resolve({ id: classroom, studentId: student }) } as never
const body = { action: 'reserve', operation_id: operation, generation_id: generation, confirmation: 'PURGE LIVE CLASSROOM DATA' }
const request = (patch = {}) => new NextRequest('http://localhost/purge/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...patch }) })
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
  mocks.auth.mockResolvedValue({ id: teacher, role: 'teacher' })
  mocks.role.mockResolvedValue({ id: teacher })
  mocks.manualGate.mockReturnValue(true)
  mocks.remoteContext.mockResolvedValue({ generation_id: generation, scope: 'provider_bound', provider_bound: true })
  mocks.remoteReserve.mockResolvedValue({ scope: 'repolight_only', cleanup_completed: false })
  mocks.remoteAdvance.mockResolvedValue({ scope: 'repolight_only', cleanup_completed: true })
  mocks.target.mockResolvedValue({ generation_id: generation })
  mocks.reserve.mockResolvedValue({ status: 'provider_pending', cleanup_completed: false })
  mocks.advance.mockResolvedValue({ status: 'completed', cleanup_completed: true })
  mocks.read.mockResolvedValue({ status: 'provider_pending', cleanup_completed: false })
})

describe.each(['reserve', 'advance'])('admitted contextual owner report-only cleanup: %s', action => {
  const reportRequest = (patch = {}) => request({ action, scope: 'repolight_only', confirmation: 'REMOVE REPOSITORY REPORTS', ...patch })
  beforeEach(() => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [teacher] }))
    mocks.auth.mockResolvedValue({ id: teacher, role: 'student' })
    mocks.remoteContext.mockResolvedValue({ generation_id: generation, scope: 'repolight_only', provider_bound: false })
  })

  it('uses the exact owner/retained-generation report path without other provider work', async () => {
    const response = await POST(reportRequest(), context)
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.role).not.toHaveBeenCalled()
    expect(mocks.remoteContext).toHaveBeenCalledExactlyOnceWith({ teacherId: teacher, classroomId: classroom, studentId: student })
    const selected = action === 'reserve' ? mocks.remoteReserve : mocks.remoteAdvance
    const other = action === 'reserve' ? mocks.remoteAdvance : mocks.remoteReserve
    expect(selected).toHaveBeenCalledExactlyOnceWith({ teacherId: teacher, classroomId: classroom, studentId: student, generationId: generation, operationId: operation })
    expect(other).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled()
  })

  it('denies a nonowner before decoding even malformed request JSON', async () => {
    mocks.remoteContext.mockRejectedValue(new ApiError(403, 'Forbidden'))
    const malformed = new NextRequest('http://localhost/purge/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
    expect((await POST(malformed, context)).status).toBe(403)
    expect(mocks.remoteReserve).not.toHaveBeenCalled(); expect(mocks.remoteAdvance).not.toHaveBeenCalled()
  })

  it('preserves current generation, confirmation and explicit report scope checks', async () => {
    expect((await POST(reportRequest({ generation_id: operation }), context)).status).toBe(409)
    expect((await POST(reportRequest({ confirmation: 'PURGE LIVE CLASSROOM DATA' }), context)).status).toBe(400)
    expect((await POST(reportRequest({ scope: 'provider_bound' }), context)).status).toBe(404)
    expect(mocks.remoteReserve).not.toHaveBeenCalled(); expect(mocks.remoteAdvance).not.toHaveBeenCalled()
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled()
  })

  it('preserves authoritative operation binding denial and manual pause', async () => {
    const selected = action === 'reserve' ? mocks.remoteReserve : mocks.remoteAdvance
    selected.mockRejectedValueOnce(new ApiError(409, 'Cleanup operation does not match this membership'))
    expect((await POST(reportRequest(), context)).status).toBe(409)
    mocks.manualGate.mockReturnValue(false)
    expect((await POST(reportRequest(), context)).status).toBe(404)
    expect(selected).toHaveBeenCalledOnce(); expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled()
  })

  it.each(['broken', JSON.stringify({ version: 2, admittedUserIds: [teacher] })])('fails closed on present malformed admission %j', async value => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', value)
    expect((await POST(reportRequest(), context)).status).toBe(503)
    expect(mocks.remoteContext).not.toHaveBeenCalled(); expect(mocks.remoteReserve).not.toHaveBeenCalled(); expect(mocks.remoteAdvance).not.toHaveBeenCalled()
  })

  it('authenticates anonymous actors before configuration or retained-target checks', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'broken')
    mocks.auth.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    expect((await POST(reportRequest(), context)).status).toBe(401)
    expect(mocks.remoteContext).not.toHaveBeenCalled(); expect(mocks.remoteReserve).not.toHaveBeenCalled(); expect(mocks.remoteAdvance).not.toHaveBeenCalled()
  })
})

describe('contextual owner cleanup progress (read-only)', () => {
  const admit = () => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [teacher] }))

  it.each(['teacher', 'student'])('admits the authenticated %s-labelled actor to existing exact owner discovery', async role => {
    admit()
    mocks.auth.mockResolvedValue({ id: teacher, role })
    const response = await GET(new NextRequest('http://localhost/live'), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.target).toHaveBeenCalledExactlyOnceWith(teacher, classroom, student)
    expect(mocks.role).not.toHaveBeenCalled()
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [student] })])('retains the teacher guard for absent or unmatched admission: %s', async admission => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', admission)
    expect((await GET(new NextRequest('http://localhost/live'), context)).status).toBe(200)
    expect(mocks.role).toHaveBeenCalledExactlyOnceWith('teacher')
    expect(mocks.auth).toHaveBeenCalledTimes(admission === undefined ? 0 : 1)
  })

  it.each(['', 'broken', JSON.stringify({ version: 2, admittedUserIds: [teacher] })])('fails closed on malformed present admission %s', async admission => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', admission)
    expect((await GET(new NextRequest('http://localhost/live'), context)).status).toBe(503)
    expect(mocks.auth).toHaveBeenCalledOnce()
    expect(mocks.role).not.toHaveBeenCalled()
    expect(mocks.target).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('authenticates before malformed admission and request validation', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'broken')
    mocks.auth.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    expect((await GET(new NextRequest('http://localhost/live'), {
      params: Promise.resolve({ id: 'invalid', studentId: student }),
    } as never)).status).toBe(401)
    expect(mocks.role).not.toHaveBeenCalled()
    expect(mocks.target).not.toHaveBeenCalled()
  })

  it('reads saved exact progress with activation off and never advances either provider', async () => {
    admit()
    mocks.auth.mockResolvedValue({ id: teacher, role: 'student' })
    expect((await GET(new NextRequest(`http://localhost/live?operation_id=${operation}&generation_id=${generation}`), context)).status).toBe(200)
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ teacherId: teacher, classroomId: classroom,
      studentId: student, operationId: operation, generationId: generation })
    expect(mocks.gate).not.toHaveBeenCalled()
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })

  it.each(['operation_id=invalid', `operation_id=${operation}&generation_id=${generation}&teacherId=${student}`])('rejects incomplete or widened query before reading: %s', async query => {
    admit()
    expect((await GET(new NextRequest(`http://localhost/live?${query}`), context)).status).toBe(400)
    expect(mocks.target).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('canonicalizes contextual UUID spellings without replacing authenticated identity', async () => {
    admit()
    const classId = 'd1000000-0000-4000-8000-000000000001'
    const memberId = 'e1000000-0000-4000-8000-000000000001'
    const operationId = 'f1000000-0000-4000-8000-000000000001'
    const generationId = 'a1000000-0000-4000-8000-000000000001'
    const response = await GET(new NextRequest(`http://localhost/live?operation_id=${operationId.toUpperCase()}&generation_id=${generationId.toUpperCase()}`), {
      params: Promise.resolve({ id: classId.toUpperCase(), studentId: memberId.toUpperCase() }),
    } as never)
    expect(response.status).toBe(200)
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ teacherId: teacher, classroomId: classId,
      studentId: memberId, operationId, generationId })
  })

  it('preserves current-owner denial from the existing discovery boundary', async () => {
    admit()
    mocks.target.mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await GET(new NextRequest('http://localhost/live'), context)).status).toBe(403)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })

  it('keeps generic provider purge retired for admitted owners', async () => {
    admit()
    expect((await POST(request(), context)).status).toBe(404)
    expect(mocks.role).not.toHaveBeenCalled()
    expect(mocks.auth).toHaveBeenCalledOnce()
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })
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
  it('reserves after exact retained-owner authorization', async () => {
    expect((await POST(request(), context)).status).toBe(404)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })
  it.each([{ confirmation: '' }, { generation_id: 'invalid' }, { teacherId: student }, { action: 'restore' }, { policy: 'strict-v1' }])('rejects invalid or widened input %j', async patch => {
    expect((await POST(request(patch), context)).status).toBe(400)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })
  it('uses remote-only confirmation without invoking either existing provider', async () => {
    mocks.remoteContext.mockResolvedValue({ generation_id: generation, scope: 'repolight_only', provider_bound: false })
    expect((await POST(request({ scope: 'repolight_only' }), context)).status).toBe(400)
    expect(mocks.remoteReserve).not.toHaveBeenCalled()
    expect((await POST(request({ scope: 'repolight_only', confirmation: 'REMOVE REPOSITORY REPORTS' }), context)).status).toBe(200)
    expect(mocks.remoteReserve).toHaveBeenCalledOnce()
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })

  it('advances only the explicitly confirmed existing scope', async () => {
    expect((await POST(request({ action: 'advance' }), context)).status).toBe(404)
    expect(mocks.advance).not.toHaveBeenCalled()
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
it.each(liveFlags)('keeps teacher writes unavailable when %s is off, but reads status', async disabled => {
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
