import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/tests/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { readContextualTestList } from '@/lib/server/contextual-test-list-read'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { ApiError } from '@/lib/api-error'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mocks) }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherOwnsClassroom: vi.fn(), assertTeacherCanMutateClassroom: vi.fn(), getClassroomStudentIds: vi.fn() }))
vi.mock('@/lib/server/contextual-test-list-read', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/contextual-test-list-read')>(), readContextualTestList: vi.fn(),
}))
const request = (id = classroomId) => new NextRequest(`http://localhost/api/teacher/tests?classroom_id=${id}`)
const admitted = () => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))

describe('owner Test list GET shared admission', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student', email: 'owner@example.test' })
    vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'teacher', email: 'owner@example.test' })
    vi.mocked(readContextualTestList).mockResolvedValue({ tests: [] })
    vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({ ok: true, classroom: { id: classroomId, teacher_id: actorId, archived_at: null } })
    mocks.from.mockImplementation(() => {
      const pending = Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'missing table' } })
      const chain = { select: () => chain, eq: () => chain, order: () => chain, then: pending.then.bind(pending) }
      return chain
    })
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['teacher', 'student'] as const)('uses current-owner reader for admitted global %s labels', async role => {
    admitted(); vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role, email: 'owner@example.test' })
    expect((await GET(request())).status).toBe(200)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(requireRole).not.toHaveBeenCalled(); expect(assertTeacherOwnsClassroom).not.toHaveBeenCalled()
    expect(readContextualTestList).toHaveBeenCalledWith({ supabase: mocks, actorId, classroomId })
  })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('retains exact legacy dispatch and missing-table response %#', async config => {
    if (config !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    const result = await GET(request('legacy-class-id'))
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ tests: [], migration_required: true })
    expect(requireRole).toHaveBeenCalledWith('teacher'); expect(assertTeacherOwnsClassroom).toHaveBeenCalledWith(actorId, 'legacy-class-id')
    expect(readContextualTestList).not.toHaveBeenCalled(); expect(requireAuth).toHaveBeenCalledTimes(config === undefined ? 0 : 1)
  })
  it('fails malformed present admission after auth and before URL parsing or discovery', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    const input = request(); const url = vi.fn(() => { throw new Error('URL must not be read') })
    Object.defineProperty(input, 'url', { get: url })
    expect((await GET(input)).status).toBe(503)
    expect(url).not.toHaveBeenCalled(); expect(requireAuth).toHaveBeenCalledTimes(1); expect(mocks.from).not.toHaveBeenCalled(); expect(requireRole).not.toHaveBeenCalled()
  })
  it('validates admitted Class identity after authentication', async () => {
    admitted(); expect((await GET(request('invalid'))).status).toBe(400)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(readContextualTestList).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each([403, 503])('never falls back after contextual failure %s', async status => {
    admitted(); vi.mocked(readContextualTestList).mockRejectedValue(new ApiError(status, 'Unavailable'))
    expect((await GET(request())).status).toBe(status); expect(requireRole).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })
})
