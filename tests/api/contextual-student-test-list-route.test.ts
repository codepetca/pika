import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/tests/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { readContextualStudentTestList } from '@/lib/server/contextual-student-test-list-read'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { ApiError } from '@/lib/api-error'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mocks) }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: vi.fn() }))
vi.mock('@/lib/server/contextual-student-test-list-read', async original => ({
  ...await original<typeof import('@/lib/server/contextual-student-test-list-read')>(), readContextualStudentTestList: vi.fn(),
}))
const request = (id = classroomId) => new NextRequest(`http://localhost/api/student/tests?classroom_id=${id}`)
const admitted = () => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
describe('member Test list GET shared admission', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'teacher', email: 'member@example.test' })
    vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'student', email: 'member@example.test' })
    vi.mocked(readContextualStudentTestList).mockResolvedValue({ tests: [] })
    vi.mocked(assertStudentCanAccessClassroom).mockResolvedValue({ ok: true })
    mocks.from.mockImplementation(() => {
      const pending = Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'missing' } })
      const chain = { select: () => chain, eq: () => chain, order: () => chain, then: pending.then.bind(pending) }
      return chain
    })
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['teacher', 'student'] as const)('dispatches admitted global %s members without global-role checks', async role => {
    admitted(); vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role, email: 'member@example.test' })
    const result = await GET(request())
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ tests: [] })
    expect(requireRole).not.toHaveBeenCalled(); expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
    expect(readContextualStudentTestList).toHaveBeenCalledWith({ supabase: mocks, actorId, classroomId })
  })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('preserves absent/nonadmitted legacy guards, arbitrary IDs and compatibility response %#', async config => {
    if (config !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    const result = await GET(request('legacy-class-id'))
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ tests: [], migration_required: true })
    expect(requireRole).toHaveBeenCalledWith('student'); expect(assertStudentCanAccessClassroom).toHaveBeenCalledWith(actorId, 'legacy-class-id')
    expect(readContextualStudentTestList).not.toHaveBeenCalled(); expect(requireAuth).toHaveBeenCalledTimes(config === undefined ? 0 : 1)
  })
  it('fails malformed present admission after auth before URL or service client access', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    const input = request(); const url = vi.fn(() => { throw new Error('URL must not be read') }); Object.defineProperty(input, 'url', { get: url })
    expect((await GET(input)).status).toBe(503)
    expect(url).not.toHaveBeenCalled(); expect(requireAuth).toHaveBeenCalledTimes(1); expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(requireRole).not.toHaveBeenCalled()
  })
  it('authenticates before parameters for configured admission', async () => {
    admitted(); vi.mocked(requireAuth).mockRejectedValue(new ApiError(401, 'Unauthorized'))
    const input = request(); const url = vi.fn(() => { throw new Error('URL must not be read') }); Object.defineProperty(input, 'url', { get: url })
    expect((await GET(input)).status).toBe(401); expect(url).not.toHaveBeenCalled(); expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it.each(['invalid', ''])('validates admitted query %s before client creation', async id => {
    admitted(); expect((await GET(request(id))).status).toBe(400)
    expect(requireAuth).toHaveBeenCalledTimes(1); expect(getServiceRoleClient).not.toHaveBeenCalled(); expect(readContextualStudentTestList).not.toHaveBeenCalled()
  })
  it('matches existing feature query policy: ignores unused query keys and canonicalizes UUID', async () => {
    admitted(); const upper = 'ABCDEFAB-1234-4123-8123-123456789ABC'
    expect((await GET(new NextRequest(`http://localhost/api/student/tests?classroom_id=${upper}&unused=value`))).status).toBe(200)
    expect(readContextualStudentTestList).toHaveBeenCalledWith({ supabase: mocks, actorId, classroomId: upper.toLowerCase() })
  })
  it.each([403, 503])('does not fall back after contextual failure %s', async status => {
    admitted(); vi.mocked(readContextualStudentTestList).mockRejectedValue(new ApiError(status, 'Unavailable'))
    expect((await GET(request())).status).toBe(status); expect(requireRole).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })
  it('keeps exact legacy missing-query body', async () => {
    const result = await GET(new NextRequest('http://localhost/api/student/tests'))
    expect(result.status).toBe(400); expect(await result.json()).toEqual({ error: 'classroom_id is required' })
  })
})
