import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/types/database'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), client: vi.fn(), remote: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/bara-attendance-client', () => ({ postBaraDecommission: mocks.remote }))
import { POST as begin } from '@/app/api/teacher/classrooms/[id]/attendance-decommission/route'
import { GET as status, POST as tick } from '@/app/api/teacher/classrooms/[id]/attendance-decommission/[operationId]/route'

const actorId = '10000000-0000-4000-8000-000000000001'
const classroomId = '20000000-0000-4000-8000-000000000001'
const operationId = '30000000-0000-4000-8000-000000000001'
const otherId = '40000000-0000-4000-8000-000000000001'
const operation = { operation_id: operationId, state: 'fenced', installation_ref: 'installation_one',
  roster_ref: 'roster_one', actor_principal_ref: 'principal_owner', deleted_count: 0,
  operation_ref: `decommission_${operationId.replaceAll('-', '')}` }
const receipt = { schema_version: 1, ok: true, installation_ref: operation.installation_ref,
  roster_ref: operation.roster_ref, operation_ref: operation.operation_ref,
  state: 'deleted', absence_verified: true, deleted_count: 7 }
const methods = ['begin', 'status', 'tick'] as const
type Method = typeof methods[number]
type Reply = { body: unknown; status?: number } | Error
function fixture(replies: Reply[] = [{ body: operation }]) {
  const requests: { name: string; body: Record<string, unknown> }[] = []
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(String(url))
    if (target.origin !== 'https://sealed.invalid' || !target.pathname.startsWith('/rest/v1/rpc/')) {
      throw new Error('Unexpected sealed transport target')
    }
    requests.push({ name: target.pathname.split('/').at(-1)!, body: JSON.parse(String(init?.body)) })
    const reply = replies.shift()
    if (!reply) throw new Error('Unexpected sealed transport request')
    if (reply instanceof Error) throw reply
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200,
      headers: { 'Content-Type': 'application/json' } })
  })
  const client = createClient<Database>('https://sealed.invalid', 'test-key', {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  mocks.client.mockReturnValue(client)
  return { requests, fetch }
}
function invoke(method: Method, options: { classroomId?: string; operationId?: string; body?: unknown } = {}) {
  const id = options.classroomId ?? classroomId
  const op = options.operationId ?? operationId
  const context = { params: Promise.resolve(method === 'begin' ? { id } : { id, operationId: op }) } as never
  const request = new NextRequest('https://pika.invalid/decommission', {
    method: method === 'status' ? 'GET' : 'POST',
    ...(method === 'begin' ? { body: JSON.stringify(options.body ?? { operation_id: op, confirmation: 'DELETE' }) } : {}),
  })
  return ({ begin, status, tick })[method](request, context)
}
function denial(code: string): Reply {
  return { body: { code, message: 'private database detail', details: null, hint: null }, status: 400 }
}
function admit(role = 'student') {
  mocks.auth.mockResolvedValue({ id: actorId, role })
  vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('PIKA_BARA_DECOMMISSION_MODE', 'canary')
  vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
  admit()
  mocks.role.mockResolvedValue({ id: actorId, role: 'teacher' })
  mocks.remote.mockResolvedValue(receipt)
})
afterEach(() => vi.unstubAllEnvs())

describe('contextual attendance decommission through installed SDK with sealed transport', () => {
  it.each(['teacher', 'student'])('uses all three unchanged service methods for admitted %s owners', async role => {
    admit(role)
    const f = fixture([{ body: operation }, { body: operation }, { body: operation },
      { body: { ...operation, state: 'remote_deleted' } }, { body: { ...operation, state: 'local_deleted', deleted_count: 7 } }])
    expect((await invoke('begin')).status).toBe(202)
    expect(mocks.remote).not.toHaveBeenCalled()
    const read = await invoke('status')
    expect(read.status).toBe(200)
    expect(read.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await read.json()).toEqual({ operation: { operation_id: operationId, state: 'fenced',
      deleted_count: 0, attendance_removed: false, classroom_deleted: false } })
    const done = await invoke('tick')
    expect(done.status).toBe(200)
    expect(await done.json()).toEqual({ operation: { operation_id: operationId, state: 'local_deleted',
      deleted_count: 7, attendance_removed: true, classroom_deleted: false } })
    expect(f.requests.map(row => row.name)).toEqual(['begin_attendance_decommission', 'get_attendance_decommission',
      'authorize_attendance_decommission_advance', 'record_attendance_decommission_receipt', 'tick_attendance_decommission'])
    for (const request of f.requests) expect(request.body).toMatchObject({ p_teacher_id: actorId,
      p_classroom_id: classroomId, p_operation_id: operationId })
    expect(f.requests[0].body.p_confirmation).toBe('DELETE')
    expect(mocks.role).not.toHaveBeenCalled()
    expect(mocks.remote).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'begin',
      operation_ref: operation.operation_ref, actor_principal_ref: operation.actor_principal_ref }))
  })

  it.each(methods)('preserves absent/unmatched teacher authorization before %s params or body', async method => {
    const f = fixture()
    const error = new Error('Forbidden'); error.name = 'AuthorizationError'
    mocks.role.mockRejectedValue(error)
    for (const configuration of [undefined, JSON.stringify({ version: 1, admittedUserIds: [otherId] })]) {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', configuration)
      const response = await invoke(method, { classroomId: 'invalid', body: { invalid: true } })
      expect(response.status).toBe(403)
    }
    expect(f.fetch).not.toHaveBeenCalled(); expect(mocks.remote).not.toHaveBeenCalled()
  })

  it.each(methods)('allows legacy teachers through unchanged %s service when admission is absent/unmatched', async method => {
    for (const configuration of [undefined, JSON.stringify({ version: 1, admittedUserIds: [otherId] })]) {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', configuration)
      const f = fixture([{ body: { ...operation, state: 'local_deleted' } }])
      expect((await invoke(method)).status).toBe(method === 'begin' ? 202 : 200)
      expect(f.requests).toHaveLength(1)
    }
    expect(mocks.role).toHaveBeenCalledTimes(2)
    expect(mocks.remote).not.toHaveBeenCalled()
  })

  it.each(methods)('rejects malformed admission and unauthenticated callers before %s work', async method => {
    const f = fixture()
    for (const raw of ['', '{', '{}', JSON.stringify({ version: 1, admittedUserIds: ['invalid'] })]) {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', raw)
      expect((await invoke(method)).status).toBe(503)
    }
    const error = new Error('Unauthorized'); error.name = 'AuthenticationError'
    mocks.auth.mockRejectedValue(error)
    expect((await invoke(method, { classroomId: 'bad' })).status).toBe(401)
    expect(mocks.role).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled(); expect(mocks.remote).not.toHaveBeenCalled()
  })

  // SQL owns relationship/lifecycle checks. These real PostgREST error envelopes
  // prove their status and side-effect boundary; the SQL rollback fixture proves predicates.
  it.each([
    ['non-owner member', '42501', 403], ['foreign classroom', '42501', 403], ['missing classroom', '42501', 403],
    ['active classroom', '55000', 503], ['cold classroom', '42501', 403], ['owner changed', '42501', 403],
    ['strict confirmation mismatch', '22023', 400], ['mapping absent', '55000', 503],
    ['missing contract', 'PGRST202', 503],
  ])('preserves database denial for %s and never contacts provider', async (_case, code, expected) => {
    const f = fixture([denial(String(code))])
    const response = await invoke('begin')
    expect(response.status).toBe(expected)
    expect(JSON.stringify(await response.json())).not.toContain('private database detail')
    expect(f.requests).toHaveLength(1); expect(mocks.remote).not.toHaveBeenCalled()
  })

  it.each(['status', 'tick'] as const)('binds %s to durable actor/class/operation and denies substitutions', async method => {
    for (const patch of [{ classroomId: otherId }, { operationId: otherId }, {}]) {
      const f = fixture([denial('P0002')])
      expect((await invoke(method, patch)).status).toBe(404)
      expect(f.requests[0].body).toEqual({ p_teacher_id: actorId,
        p_classroom_id: patch.classroomId ?? classroomId, p_operation_id: patch.operationId ?? operationId })
      expect(mocks.remote).not.toHaveBeenCalled()
    }
  })

  it('retains status and continuation after parent deletion with no parent lookup', async () => {
    const f = fixture([{ body: { ...operation, state: 'remote_deleted' } },
      { body: { ...operation, state: 'remote_deleted' } }, { body: { ...operation, state: 'local_deleted' } }])
    expect((await invoke('status')).status).toBe(200)
    expect((await invoke('tick')).status).toBe(200)
    expect(f.requests.map(row => row.name)).toEqual(['get_attendance_decommission',
      'authorize_attendance_decommission_advance', 'tick_attendance_decommission'])
    expect(mocks.remote).not.toHaveBeenCalled()
  })

  it('keeps status readable while environment progress is paused', async () => {
    vi.stubEnv('PIKA_BARA_DECOMMISSION_MODE', 'disabled')
    const f = fixture()
    expect((await invoke('begin')).status).toBe(503)
    expect((await invoke('tick')).status).toBe(503)
    expect((await invoke('status')).status).toBe(200)
    expect(f.requests.map(row => row.name)).toEqual(['get_attendance_decommission'])
    expect(mocks.remote).not.toHaveBeenCalled()
  })

  it.each(['DB paused', 'canary rescope', 'installation mismatch'])('blocks provider advance for %s', async () => {
    const f = fixture([denial('55000')])
    expect((await invoke('tick')).status).toBe(503)
    expect(f.requests.map(row => row.name)).toEqual(['authorize_attendance_decommission_advance'])
    expect(mocks.remote).not.toHaveBeenCalled()
  })

  it('rechecks DB advance between remote begin and tick, preserving the fence on pause', async () => {
    const f = fixture([{ body: operation }, denial('55000')])
    mocks.remote.mockResolvedValue({ ...receipt, state: 'deleting', absence_verified: false })
    expect((await invoke('tick')).status).toBe(503)
    expect(f.requests.map(row => row.name)).toEqual(['authorize_attendance_decommission_advance', 'authorize_attendance_decommission_advance'])
    expect(mocks.remote).toHaveBeenCalledTimes(1)
  })

  it('preserves remote-deleted evidence when a retained generation blocks local deletion', async () => {
    const f = fixture([{ body: operation }, { body: { ...operation, state: 'remote_deleted' } },
      denial('55000'), { body: { ...operation, state: 'remote_deleted' } }])
    expect((await invoke('tick')).status).toBe(503)
    const response = await invoke('status')
    expect(await response.json()).toEqual({ operation: { operation_id: operationId,
      state: 'remote_deleted', deleted_count: 0, attendance_removed: false, classroom_deleted: false } })
    expect(f.requests.map(row => row.name)).toEqual(['authorize_attendance_decommission_advance',
      'record_attendance_decommission_receipt', 'tick_attendance_decommission', 'get_attendance_decommission'])
    expect(mocks.remote).toHaveBeenCalledTimes(1)
  })

  it.each(methods)('maps malformed internal %s evidence to 503 without leaking refs or accepting another operation', async method => {
    for (const body of [null, {}, { ...operation, deleted_count: '7' }, { ...operation, operation_id: otherId },
      { ...operation, operation_ref: `decommission_${otherId.replaceAll('-', '')}` }, { ...operation, unexpected: 'private' }]) {
      const f = fixture([{ body }])
      const response = await invoke(method)
      expect(response.status).toBe(503)
      expect(JSON.stringify(await response.json())).not.toMatch(/installation_one|roster_one|principal_owner|unexpected/)
      expect(f.requests).toHaveLength(1)
      expect(mocks.remote).not.toHaveBeenCalled()
    }
  })

  it('preserves request-validation 400s before service execution', async () => {
    const f = fixture()
    for (const body of [{ operation_id: operationId, confirmation: '' },
      { operation_id: operationId, confirmation: 'DELETE', actor_id: otherId },
      { operation_id: 'invalid', confirmation: 'DELETE' }]) {
      expect((await invoke('begin', { body })).status).toBe(400)
    }
    expect((await invoke('status', { operationId: 'invalid' })).status).toBe(400)
    expect(f.fetch).not.toHaveBeenCalled(); expect(mocks.remote).not.toHaveBeenCalled()
  })

  it('rejects unbound remote receipts before recording or local deletion', async () => {
    for (const patch of [{ operation_ref: 'other' }, { roster_ref: 'other' }, { installation_ref: 'other' }, { absence_verified: false }]) {
      const f = fixture()
      mocks.remote.mockResolvedValue({ ...receipt, ...patch })
      expect((await invoke('tick')).status).toBe(503)
      expect(f.requests.map(row => row.name)).toEqual(['authorize_attendance_decommission_advance'])
    }
  })

  it('reports unknown provider outcomes without retry, unfencing, or rollback claims', async () => {
    const f = fixture()
    mocks.remote.mockRejectedValue(new Error('private native transport detail'))
    const response = await invoke('tick')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Attendance deletion outcome is unverified; reconcile using the same operation' })
    expect(f.requests).toHaveLength(1); expect(mocks.remote).toHaveBeenCalledTimes(1)
  })

  it('reconciles a lost begin acknowledgment by the same operation without provider work', async () => {
    const f = fixture([new Error('response lost after possible commit'), { body: operation }])
    expect((await invoke('begin')).status).toBe(503)
    expect((await invoke('status')).status).toBe(200)
    expect(f.requests.map(row => row.body.p_operation_id)).toEqual([operationId, operationId])
    expect(mocks.remote).not.toHaveBeenCalled()
  })

  it.each(['receipt', 'local completion'])('does not retry after a lost %s acknowledgment and reconciles the same operation', async phase => {
    const committed = { ...operation, state: phase === 'receipt' ? 'remote_deleted' : 'local_deleted' }
    const replies: Reply[] = [{ body: operation }]
    if (phase === 'local completion') replies.push({ body: { ...operation, state: 'remote_deleted' } })
    replies.push(new Error('private lost completion detail'), { body: committed })
    const f = fixture(replies)
    const response = await invoke('tick')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Attendance deletion could not proceed; its safety fence is preserved' })
    expect(mocks.remote).toHaveBeenCalledTimes(1)
    expect((await invoke('status')).status).toBe(200)
    expect(f.requests.map(row => row.name)).toEqual(['authorize_attendance_decommission_advance',
      'record_attendance_decommission_receipt', ...(phase === 'local completion' ? ['tick_attendance_decommission'] : []),
      'get_attendance_decommission'])
    expect(f.requests.every(row => row.body.p_operation_id === operationId)).toBe(true)
  })
})
