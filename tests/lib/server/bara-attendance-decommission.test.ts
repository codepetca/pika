import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { beginAttendanceDecommission, tickAttendanceDecommission } from '@/lib/server/bara-attendance-decommission'
const mock = vi.hoisted(() => ({ rpc: vi.fn(), remote: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mock.rpc }) }))
vi.mock('@/lib/server/bara-attendance-client', () => ({ postBaraDecommission: mock.remote }))
const scope = { teacherId: '10000000-0000-4000-8000-000000000001',
  classroomId: '20000000-0000-4000-8000-000000000001', operationId: '30000000-0000-4000-8000-000000000001' }
const operation = { operation_id: scope.operationId, state: 'fenced',
  installation_ref: 'installation_one', roster_ref: 'roster_one',
  operation_ref: `decommission_${scope.operationId.replaceAll('-', '')}`,
  actor_principal_ref: 'principal_teacher', deleted_count: 0 }
const receipt = { schema_version: 1, ok: true, installation_ref: operation.installation_ref,
  roster_ref: operation.roster_ref, operation_ref: operation.operation_ref,
  state: 'deleted', absence_verified: true, deleted_count: 7 }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PIKA_BARA_DECOMMISSION_MODE', 'canary')
  mock.rpc.mockResolvedValue({ data: operation, error: null })
})
afterEach(() => vi.unstubAllEnvs())
describe('coordinated attendance deletion ordering', () => {
  it('commits only the local fence at begin, before any remote mutation', async () => {
    expect(await beginAttendanceDecommission({ ...scope, confirmation: 'DELETE' }))
      .toMatchObject({ state: 'fenced', attendance_removed: false, classroom_deleted: false })
    expect(mock.rpc).toHaveBeenCalledWith('begin_attendance_decommission', {
      p_teacher_id: scope.teacherId, p_classroom_id: scope.classroomId,
      p_operation_id: scope.operationId, p_confirmation: 'DELETE',
    })
    expect(mock.remote).not.toHaveBeenCalled()
  })
  it('fails closed on missing migration and never sends a request without a durable fence', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    await expect(tickAttendanceDecommission(scope)).rejects.toThrow()
    expect(mock.remote).not.toHaveBeenCalled()
  })
  it('preserves the operation on uncertain transport and on an incomplete receipt', async () => {
    mock.remote.mockRejectedValueOnce(new Error('uncertain'))
    await expect(tickAttendanceDecommission(scope)).rejects.toThrow('uncertain')
    expect(mock.rpc).toHaveBeenCalledTimes(1)
    mock.remote.mockResolvedValue({ ...receipt, state: 'deleting', absence_verified: false })
    expect(await tickAttendanceDecommission(scope)).toMatchObject({ state: 'fenced' })
    expect(mock.rpc.mock.calls.every(([name]) => name === 'get_attendance_decommission')).toBe(true)
    expect(mock.remote.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'tick', operation_ref: operation.operation_ref })
  })
  it('records a bound verified receipt before any local deletion', async () => {
    mock.remote.mockResolvedValue(receipt)
    mock.rpc.mockResolvedValueOnce({ data: operation, error: null })
      .mockResolvedValueOnce({ data: { ...operation, state: 'remote_deleted' }, error: null })
      .mockResolvedValueOnce({ data: { ...operation, state: 'local_deleted' }, error: null })
    expect(await tickAttendanceDecommission(scope)).toMatchObject({ attendance_removed: true, classroom_deleted: false })
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      'get_attendance_decommission', 'record_attendance_decommission_receipt', 'tick_attendance_decommission',
    ])
  })
  it('rejects a wrong operation receipt before local deletion', async () => {
    mock.remote.mockResolvedValue({ ...receipt, operation_ref: 'other' })
    await expect(tickAttendanceDecommission(scope)).rejects.toThrow()
    expect(mock.rpc).toHaveBeenCalledTimes(1)
  })
  it('retries only the remaining local work after the remote receipt committed', async () => {
    mock.rpc.mockResolvedValue({ data: { ...operation, state: 'remote_deleted' }, error: null })
    await tickAttendanceDecommission(scope)
    expect(mock.remote).not.toHaveBeenCalled()
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual(['get_attendance_decommission', 'tick_attendance_decommission'])
  })
  it('does not repeat deletion after local completion', async () => {
    mock.rpc.mockResolvedValue({ data: { ...operation, state: 'local_deleted' }, error: null })
    await tickAttendanceDecommission(scope)
    expect(mock.rpc).toHaveBeenCalledTimes(1)
    expect(mock.remote).not.toHaveBeenCalled()
  })
})
