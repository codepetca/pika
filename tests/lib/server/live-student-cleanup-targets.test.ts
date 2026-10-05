import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StudentProviderCleanupError } from '@/lib/server/student-provider-cleanup'
import { getLiveStudentCleanupTarget, listLiveStudentCleanupTargets } from '@/lib/server/live-student-cleanup'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), read: vi.fn(), factory: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }))
vi.mock('@/lib/server/student-provider-cleanup-database', () => ({
  createStudentProviderCleanupDatabaseCoordinator: (...args: unknown[]) => { mocks.factory(...args); return { read: mocks.read } },
}))
const teacher = '10000000-0000-4000-8000-000000000001', classroom = '20000000-0000-4000-8000-000000000001'
const student = '30000000-0000-4000-8000-000000000001', generation = '40000000-0000-4000-8000-000000000001'
const operation = '50000000-0000-4000-8000-000000000001'
const target = { student_id: student, generation_id: generation, email: 'a@example.com', name: 'Ada', operation_id: operation, operation_status: 'provider_pending' }
function page(targets: unknown[] = [], next: string | null = null, studentId: string | null = null, cursor: string | null = null) {
  return { schema_version: 1, teacher_id: teacher, classroom_id: classroom, student_id: studentId,
    after_student_id: cursor, include_unreserved: false, targets, target_count: targets.length, next_student_id: next, snapshot_sha256: 'a'.repeat(64) }
}
function fullPage() {
  return Array.from({ length: 100 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, '0')
    return { ...target, student_id: '30000000-0000-4000-8000-' + suffix,
      generation_id: '40000000-0000-4000-8000-' + suffix,
      operation_id: '50000000-0000-4000-8000-' + suffix }
  })
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('PIKA_LIVE_STUDENT_CLEANUP_ENABLED', 'false'); vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'false'); vi.stubEnv('PIKA_REMOVED_STUDENT_ACADEMIC_CLEANUP_ENABLED', 'false') })
afterEach(() => vi.unstubAllEnvs())
it('defaults off and performs only authorized service-only discovery', async () => {
  mocks.rpc.mockResolvedValue({ data: page(), error: null })
  expect(await listLiveStudentCleanupTargets(teacher, classroom)).toEqual([])
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('discover_retained_student_cleanup_groups', {
    p_teacher_id: teacher, p_classroom_id: classroom, p_student_id: null, p_after_student_id: null, p_include_unreserved: false, p_snapshot_sha256: null,
  })
  expect(mocks.from).not.toHaveBeenCalled()
})
it('projects one deterministic group label with no operation/provider metadata', async () => {
  mocks.rpc.mockResolvedValue({ data: page([target]), error: null })
  expect(await listLiveStudentCleanupTargets(teacher, classroom)).toEqual([{ student_id: student, generation_id: generation, email: 'a@example.com', name: 'Ada' }])
})
it('maps current ownership rejection to the existing forbidden response', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
  await expect(getLiveStudentCleanupTarget(teacher, classroom, student)).rejects.toMatchObject({ statusCode: 403 })
})
it('recovers exact operation evidence while activation is paused', async () => {
  mocks.rpc.mockResolvedValue({ data: page([target], null, student), error: null })
  mocks.read.mockResolvedValue({ operation_id: operation })
  expect(await getLiveStudentCleanupTarget(teacher, classroom, student)).toEqual({ generation_id: generation, enabled: false, operation: { operation_id: operation } })
  expect(mocks.read).toHaveBeenCalledWith({ teacherId: teacher, classroomId: classroom, studentId: student, generationId: generation, operationId: operation })
  expect(mocks.factory).toHaveBeenCalledWith(undefined, { live: true })
})
it('never creates an operation when discovery is unreserved and activation is off', async () => {
  mocks.rpc.mockResolvedValue({ data: page([{ ...target, operation_id: null, operation_status: null }], null, student), error: null })
  await expect(getLiveStudentCleanupTarget(teacher, classroom, student)).rejects.toThrow('not enabled')
  expect(mocks.read).not.toHaveBeenCalled()
})
it('retains strict-policy discovery conflict without provider transport', async () => {
  mocks.rpc.mockResolvedValue({ data: page([target], null, student), error: null })
  mocks.read.mockRejectedValue(new StudentProviderCleanupError('binding_invalid'))
  await expect(getLiveStudentCleanupTarget(teacher, classroom, student)).rejects.toMatchObject({ statusCode: 409 })
})
it('consumes every ordered selector page rather than truncating at the API row limit', async () => {
  const rows = fullPage(), cursor = rows.at(-1)!.student_id
  const second = '30000000-0000-4000-8000-000000000101'
  mocks.rpc.mockResolvedValueOnce({ data: page(rows, cursor), error: null })
    .mockResolvedValueOnce({ data: page([{ ...target, student_id: second,
      generation_id: '40000000-0000-4000-8000-000000000101',
      operation_id: '50000000-0000-4000-8000-000000000101' }], null, null, cursor), error: null })
  expect(await listLiveStudentCleanupTargets(teacher, classroom)).toHaveLength(101)
  expect(mocks.rpc.mock.calls[1][1].p_after_student_id).toBe(cursor)
  expect(mocks.rpc.mock.calls[1][1].p_snapshot_sha256).toBe('a'.repeat(64))
})
it.each([
  ['missing RPC', null, { code: 'PGRST202' }],
  ['uncertain response', null, null],
  ['wrong owner', { ...page([target]), teacher_id: student }, null],
  ['current owner self membership', page([{ ...target, student_id: teacher }]), null],
  ['unknown fields', { ...page([target]), provider_ref: 'private' }, null],
  ['wrong paused binding', page([{ ...target, operation_id: null }]), null],
  ['duplicate contradictory generations', page([target, { ...target, generation_id: operation }]), null],
  ['invalid continuation', page([target], generation), null],
  ['wrong count', { ...page([target]), target_count: 0 }, null],
  ['wrong status', page([{ ...target, operation_status: 'completed' }]), null],
  ['same generation for different learners', page([target, { ...target,
    student_id: '30000000-0000-4000-8000-000000000002',
    operation_id: '50000000-0000-4000-8000-000000000002' }]), null],
  ['same operation for different learners', page([target, { ...target,
    student_id: '30000000-0000-4000-8000-000000000002',
    generation_id: '40000000-0000-4000-8000-000000000002' }]), null],
])('fails closed for %s without SDK fallback', async (_name, data, error) => {
  mocks.rpc.mockResolvedValue({ data, error })
  await expect(listLiveStudentCleanupTargets(teacher, classroom)).rejects.toMatchObject({ statusCode: 503 })
  expect(mocks.from).not.toHaveBeenCalled()
})
it('maps incoherent retained memberships to exact-membership conflict', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'retained_roster_cleanup_group_invalid' } })
  await expect(getLiveStudentCleanupTarget(teacher, classroom, student)).rejects.toMatchObject({ statusCode: 409 })
})
it('does not return partial labels when a later page is unverified', async () => {
  const rows = fullPage(), cursor = rows.at(-1)!.student_id
  mocks.rpc.mockResolvedValueOnce({ data: page(rows, cursor), error: null })
    .mockResolvedValueOnce({ data: page([target], null, null, cursor), error: null })
  await expect(listLiveStudentCleanupTargets(teacher, classroom)).rejects.toMatchObject({ statusCode: 503 })
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
})
it('reauthorizes every page and rejects a changed current owner without partial labels', async () => {
  const rows = fullPage(), cursor = rows.at(-1)!.student_id
  mocks.rpc.mockResolvedValueOnce({ data: page(rows, cursor), error: null })
    .mockResolvedValueOnce({ data: null, error: { code: '42501' } })
  await expect(listLiveStudentCleanupTargets(teacher, classroom)).rejects.toMatchObject({ statusCode: 403 })
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
  expect(mocks.read).not.toHaveBeenCalled()
})
it('rejects an interrupted transport without attempting SDK fallback', async () => {
  mocks.rpc.mockRejectedValue(new Error('transport interrupted'))
  await expect(listLiveStudentCleanupTargets(teacher, classroom)).rejects.toMatchObject({ statusCode: 503 })
  expect(mocks.from).not.toHaveBeenCalled()
})
it('fails closed on backend snapshot drift between pages', async () => {
  const rows = fullPage(), cursor = rows.at(-1)!.student_id
  mocks.rpc.mockResolvedValueOnce({ data: page(rows, cursor), error: null })
    .mockResolvedValueOnce({ data: null, error: { code: '40001', message: 'retained_roster_cleanup_discovery_changed' } })
  await expect(listLiveStudentCleanupTargets(teacher, classroom)).rejects.toMatchObject({ statusCode: 503 })
  expect(mocks.from).not.toHaveBeenCalled()
})
it('rejects a changed discovery snapshot rather than silently omitting a new earlier group', async () => {
  const rows = fullPage(), cursor = rows.at(-1)!.student_id
  mocks.rpc.mockResolvedValueOnce({ data: page(rows, cursor), error: null })
    .mockResolvedValueOnce({ data: { ...page([], null, null, cursor), snapshot_sha256: 'b'.repeat(64) }, error: null })
  await expect(listLiveStudentCleanupTargets(teacher, classroom)).rejects.toMatchObject({ statusCode: 503 })
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
})
it('binds valid uppercase route UUIDs to canonical PostgreSQL UUID metadata', async () => {
  const classroomWithLetters = 'abcdef00-0000-4000-8000-000000000001'
  mocks.rpc.mockResolvedValue({ data: { ...page([target]), classroom_id: classroomWithLetters }, error: null })
  expect(await listLiveStudentCleanupTargets(teacher, classroomWithLetters.toUpperCase())).toHaveLength(1)
  expect(mocks.rpc.mock.calls[0][1].p_classroom_id).toBe(classroomWithLetters)
})
