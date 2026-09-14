import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StudentProviderCleanupError } from '@/lib/server/student-provider-cleanup'
import { getLiveStudentCleanupTarget, listLiveStudentCleanupTargets } from '@/lib/server/live-student-cleanup'
const mocks = vi.hoisted(() => ({ from: vi.fn(), read: vi.fn(), factory: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/server/student-provider-cleanup-database', () => ({
  createStudentProviderCleanupDatabaseCoordinator: (...args: unknown[]) => { mocks.factory(...args); return { read: mocks.read } },
}))
const teacher = '10000000-0000-4000-8000-000000000001', classroom = '20000000-0000-4000-8000-000000000001'
const student = '30000000-0000-4000-8000-000000000001', generation = '40000000-0000-4000-8000-000000000001'
const operation = '50000000-0000-4000-8000-000000000001'
function query(data: unknown, error: unknown = null) {
  const chain = { select: vi.fn(), eq: vi.fn(), neq: vi.fn(), not: vi.fn(), maybeSingle: vi.fn(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data, error })) }
  for (const method of ['select','eq','neq','not'] as const) chain[method].mockReturnValue(chain)
  chain.maybeSingle.mockResolvedValue({ data, error })
  return chain
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('PIKA_LIVE_STUDENT_CLEANUP_ENABLED', 'false'); vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'false'); vi.stubEnv('PIKA_REMOVED_STUDENT_ACADEMIC_CLEANUP_ENABLED', 'false') })
afterEach(() => vi.unstubAllEnvs())
it('defaults off and does not fetch removed student identities with no pending operation', async () => {
  const q = query([]); mocks.from.mockReturnValue(q)
  expect(await listLiveStudentCleanupTargets(teacher, classroom)).toEqual([])
  expect(mocks.from).toHaveBeenCalledExactlyOnceWith('student_purge_operations')
  expect(q.eq.mock.calls).toEqual([['teacher_id', teacher], ['classroom_id', classroom], ['status', 'provider_pending']])
})
it('projects only pending removed memberships while paused, with no provider binding metadata', async () => {
  const pending = query([{ student_id: student }])
  const removed = query([{ removed_student_id: student, removed_enrollment_id: generation, email: 'a@example.com', first_name: 'Ada', last_name: null },
    { removed_student_id: operation, removed_enrollment_id: operation, email: 'b@example.com' }])
  mocks.from.mockReturnValueOnce(pending).mockReturnValueOnce(removed)
  expect(await listLiveStudentCleanupTargets(teacher, classroom)).toEqual([{ student_id: student, generation_id: generation, email: 'a@example.com', name: 'Ada' }])
  expect(removed.eq).toHaveBeenCalledWith('classroom_id', classroom)
  expect(removed.not).toHaveBeenCalledWith('removed_at', 'is', null)
})
it('authorizes ownership before discovering a removal', async () => {
  mocks.from.mockReturnValue(query(null))
  await expect(getLiveStudentCleanupTarget(teacher, classroom, student)).rejects.toMatchObject({ statusCode: 403 })
  expect(mocks.from).toHaveBeenCalledOnce()
})
it('recovers existing operation using exact retained generation while activation is paused', async () => {
  mocks.from.mockReturnValueOnce(query({ id: classroom })).mockReturnValueOnce(query({ removed_enrollment_id: generation })).mockReturnValueOnce(query({ id: operation }))
  mocks.read.mockResolvedValue({ operation_id: operation })
  expect(await getLiveStudentCleanupTarget(teacher, classroom, student)).toEqual({ generation_id: generation, enabled: false, operation: { operation_id: operation } })
  expect(mocks.read).toHaveBeenCalledWith({ teacherId: teacher, classroomId: classroom, studentId: student, generationId: generation, operationId: operation })
  expect(mocks.factory).toHaveBeenCalledWith(undefined, { live: true })
})
it('never creates an operation when no pending operation exists and activation is off', async () => {
  mocks.from.mockReturnValueOnce(query({ id: classroom })).mockReturnValueOnce(query({ removed_enrollment_id: generation })).mockReturnValueOnce(query(null))
  await expect(getLiveStudentCleanupTarget(teacher, classroom, student)).rejects.toThrow('not enabled')
  expect(mocks.read).not.toHaveBeenCalled()
})


it('reports strict-policy discovery as a stable ineligible conflict without transport', async () => {
  mocks.from.mockReturnValueOnce(query({ id: classroom })).mockReturnValueOnce(query({ removed_enrollment_id: generation })).mockReturnValueOnce(query({ id: operation }))
  mocks.read.mockRejectedValue(new StudentProviderCleanupError('binding_invalid'))
  await expect(getLiveStudentCleanupTarget(teacher, classroom, student)).rejects.toMatchObject({ statusCode: 409 })
  expect(mocks.factory).toHaveBeenCalledExactlyOnceWith(undefined, { live: true })
})
