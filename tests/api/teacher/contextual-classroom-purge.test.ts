import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import type { Database } from '@/types/database'
import { GET as hotStatus } from '@/app/api/teacher/classrooms/[id]/purge/[operationId]/route'
import { POST as hotTick } from '@/app/api/teacher/classrooms/[id]/purge/[operationId]/tick/route'
import { GET as hotImpact, POST as hotStart } from '@/app/api/teacher/classrooms/[id]/purge/route'
import { GET as coldStatus } from '@/app/api/teacher/classrooms/[id]/archives/[archiveId]/purge/[operationId]/route'
import { POST as coldTick } from '@/app/api/teacher/classrooms/[id]/archives/[archiveId]/purge/[operationId]/tick/route'
import { GET as coldImpactRoute, POST as coldStart } from '@/app/api/teacher/classrooms/[id]/archives/[archiveId]/purge/route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
// Inventory traversal is independent of authorization; keep all owner reads, RPCs and workers real.
vi.mock('@/lib/server/classroom-archive-inventory', () => ({
  createSupabaseClassroomArchiveInventoryReader: vi.fn(),
  readClassroomArchiveResourceGraph: async () => ({ classrooms: [{ id: 'bbbbbbbb-0000-4000-8000-000000000001' }] }),
}))
const actor = 'aaaaaaaa-0000-4000-8000-000000000001'
const classroom = 'bbbbbbbb-0000-4000-8000-000000000001'
const archive = 'cccccccc-0000-4000-8000-000000000001'
const operation = 'dddddddd-0000-4000-8000-000000000001'
const other = '50000000-0000-4000-8000-000000000001'
const digest = 'a'.repeat(64)
const context = { params: Promise.resolve({ id: classroom, archiveId: archive, operationId: operation }) }
const record = (cold: boolean) => ({ id: operation, classroom_id: classroom, teacher_id: actor,
  purge_scope: cold ? 'cold_classroom' : 'hot_classroom', cold_archive_id: cold ? archive : null,
  status: 'completed', retryable: null, error_code: null, resource_counts: {}, attempt_count: 1,
  completed_at: '2026-10-20T00:00:00Z' })
const requests: { url: URL; body: Record<string, unknown> | null }[] = []
const coldImpact = () => ({ classroom_id: classroom, archive_id: archive, classroom_title: 'Archived Class', source_revision: 1,
  storage_inventory_sha256: digest, cold_resource_inventory_sha256: digest, cold_resource_count: 1, student_count: 0,
  managed_file_count: 0, managed_file_bytes: 0, missing_file_count: 0, non_ready_file_count: 0, unmanaged_reference_count: 0,
  archive_count: 1, gradex_extract_count: 0, storage_counts: {}, resource_counts: {}, retention: { mode: 'teacher_managed', delete_after: null },
  conflicting_operation: null, deletion_available: true, unavailable_reason: null })
function transport(cold: boolean, patch: Record<string, unknown> = {}, options: {
  loss?: boolean; missing?: boolean; spoof?: boolean; fresh?: boolean; owner?: boolean; active?: boolean; tombstone?: boolean;
  inventory?: Record<string, unknown>; begin?: unknown; beginLoss?: boolean; claim?: unknown; beginDenied?: boolean;
  root?: Record<string, unknown>; progress?: unknown; claimLease?: 'exact' | 'wrong'
} = {}) {
  let exists = !options.fresh
  const fetch = vi.fn(async (raw: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(raw))
    const body = init?.body ? JSON.parse(String(init.body)) : null
    requests.push({ url, body })
    if (options.loss) throw new Error('private/path lost')
    if (url.pathname.endsWith('/classrooms')) return Response.json(options.owner === false ? null : {
      id: classroom, teacher_id: actor, title: 'Archived Class', archived_at: options.active ? null : '2026-10-20T00:00:00Z',
      ...options.root,
    })
    if (url.pathname.endsWith('/classroom_cold_tombstones')) return new Response(null, { headers: { 'content-range': `0-0/${options.tombstone ? 1 : 0}` } })
    if (url.pathname.includes('/rpc/get_')) {
      if (options.owner === false) return Response.json({ ok: false, status: 404, error_code: 'classroom_not_found', error: 'private/path owner denied' })
      return Response.json({ ok: true, status: 200, ...(cold ? coldImpact() : {
        classroom_id: classroom, classroom_title: 'Archived Class', source_revision: 1,
        storage_inventory_sha256: digest, operational_inventory_sha256: digest,
        managed_file_count: 0, managed_file_bytes: 0, missing_file_count: 0, archive_count: 0,
        gradex_extract_count: 0, interrupted_upload_count: 0, storage_counts: {}, operational_counts: {},
        conflicting_operation: null, deletion_available: true, unavailable_reason: null,
      }), ...options.inventory })
    }
    if (url.pathname.includes('/rpc/begin_')) {
      exists = true
      if (options.beginLoss) throw new Error('private/path acknowledgment lost')
      if (options.beginDenied) return Response.json({ ok: false, status: 409, error: 'private/path attendance_decommission_active' })
      return Response.json(options.begin === undefined ? { ok: true, status: 202, operation_id: operation, operation_status: 'deleting_objects' } : options.begin)
    }
    if (url.pathname.includes('/rpc/claim_')) return Response.json(options.claimLease ? [{
      id: other, operation_id: operation, storage_bucket: 'classroom-archives', storage_path: 'private/path',
      lease_token: options.claimLease === 'exact' ? body.p_lease_token : other,
    }] : options.claim === undefined ? [] : options.claim)
    if (url.pathname.startsWith('/storage/v1/object/')) return Response.json([])
    if (url.pathname.endsWith('/rpc/complete_classroom_purge_object')) return Response.json(true)
    if (url.pathname.includes('/rpc/finalize_')) return Response.json({ ok: true, status: 200, operation_id: operation, operation_status: 'completed' })
    if (url.pathname.endsWith('/classroom_purge_objects')) return Response.json(options.progress === undefined ? [] : options.progress)
    if (url.pathname.endsWith('/classroom_purge_operations')) {
      const row = { ...record(cold), ...patch }
      // Apply actual encoded owner/operation/class filters, like PostgREST.
      for (const [key, value] of url.searchParams) {
        if (!options.spoof && value.startsWith('eq.') && row[key as keyof typeof row] !== value.slice(3)) return Response.json(null)
      }
      if (options.missing || !exists) return Response.json(null)
      const selected = url.searchParams.get('select')!.split(',')
      return Response.json(Object.fromEntries(selected.map(key => [key, row[key as keyof typeof row]])))
    }
    throw new Error(`Unexpected request ${url.pathname}`)
  })
  mocks.client.mockReturnValue(createClient<Database>('http://localhost:54321', 'unit-test-key', {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }))
  return fetch
}
const req = (method = 'GET', body?: unknown) => new NextRequest('http://localhost/purge', { method, ...(body ? { body: JSON.stringify(body) } : {}) })
const startBody = (cold: boolean) => ({ operation_id: operation, confirmation: cold ? 'DELETE STORED ARCHIVE' : 'DELETE', expected_source_revision: 1,
  expected_storage_inventory_sha256: digest, [cold ? 'expected_cold_resource_inventory_sha256' : 'expected_operational_inventory_sha256']: digest })

describe('admitted classroom purge routes with native coordinators and isolated SDK transport', () => {
  beforeEach(() => {
    vi.clearAllMocks(); requests.length = 0
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] }))
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'unit-test-key')
    mocks.auth.mockResolvedValue({ id: actor, role: 'student' })
    mocks.role.mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
  })
  afterEach(() => vi.unstubAllEnvs())

  for (const cold of [false, true]) {
    const status = cold ? coldStatus : hotStatus
    const tick = cold ? coldTick : hotTick
    const start = cold ? coldStart : hotStart
    const impact = cold ? coldImpactRoute : hotImpact
    it.each(['teacher', 'student'])(`${cold ? 'cold' : 'hot'} reads current-owner impact for label %s`, async role => {
      mocks.auth.mockResolvedValue({ id: actor, role }); transport(cold, {}, { fresh: true })
      const response = await impact(req(), context)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ impact: { classroom_id: classroom, ...(cold ? { archive_id: archive } : {}) }, operation: null })
      expect(mocks.role).not.toHaveBeenCalled()
      expect(requests.every(r => !/\/(begin|claim|finalize|complete|fail)_/.test(r.url.pathname))).toBe(true)
    })
    it.each(['teacher', 'student'])(`${cold ? 'cold' : 'hot'} durable audit and completed replay admit owner label %s after parent removal`, async role => {
      mocks.auth.mockResolvedValue({ id: actor, role }); transport(cold)
      expect((await status(req(), context)).status).toBe(200)
      expect((await start(req('POST', startBody(cold)), context)).status).toBe(200)
      expect((await tick(req('POST'), context)).status).toBe(200)
      expect(mocks.role).not.toHaveBeenCalled()
      expect(requests.every(r => !r.body && /classroom_purge_(operations|objects)$/.test(r.url.pathname))).toBe(true)
      const read = requests.find(r => r.url.pathname.endsWith('/classroom_purge_operations'))!
      expect(read.url.searchParams.get('teacher_id')).toBe(`eq.${actor}`)
      expect(read.url.searchParams.get('id')).toBe(`eq.${operation}`)
    })
    it.each([{ teacher_id: other }, { classroom_id: other }, { purge_scope: 'student' }, { purge_scope: cold ? 'hot_classroom' : 'cold_classroom' }, ...(cold ? [{ cold_archive_id: other }] : [])])(
      `${cold ? 'cold' : 'hot'} denies cross owner/class/archive/scope before advance %#`, async patch => {
        transport(cold, patch)
        const response = await tick(req('POST'), context)
        expect([404, 503]).toContain(response.status)
        expect(requests.every(r => !r.body)).toBe(true)
      },
    )
    it.each([{ loss: true }, { missing: true }])(`${cold ? 'cold' : 'hot'} stops on unavailable operation %#`, async options => {
      transport(cold, {}, options)
      const response = await tick(req('POST'), context)
      expect([404, 503]).toContain(response.status)
      expect(JSON.stringify(await response.json())).not.toContain('private/path')
      expect(requests.every(r => !r.body)).toBe(true)
    })
    it(`${cold ? 'cold' : 'hot'} refuses missing progress evidence before any advance`, async () => {
      transport(cold, { status: 'deleting_objects', completed_at: null }, { progress: null })
      expect((await tick(req('POST'), context)).status).toBe(503)
      expect(requests.every(r => !r.body)).toBe(true)
    })
    it.each([{ id: other }, { teacher_id: other }, { classroom_id: other }, { status: 'unknown' }, { resource_counts: null }, { completed_at: 'bad' }, { error_code: 'private/storage/path' }])(
      `${cold ? 'cold' : 'hot'} rejects substituted or malformed operation responses %#`, async patch => {
        transport(cold, patch, { spoof: true })
        expect([404, 503]).toContain((await tick(req('POST'), context)).status)
        expect(requests.every(r => !r.body)).toBe(true)
      },
    )
    it(`${cold ? 'cold' : 'hot'} normalizes the exact admitted actor and URL UUIDs`, async () => {
      mocks.auth.mockResolvedValue({ id: actor.toUpperCase(), role: 'student' }); transport(cold)
      const upper = { params: Promise.resolve({ id: classroom.toUpperCase(), archiveId: archive.toUpperCase(), operationId: operation.toUpperCase() }) }
      expect((await status(req(), upper)).status).toBe(200)
      expect(requests[0].url.searchParams.get('teacher_id')).toBe(`eq.${actor}`)
      expect(requests[0].url.searchParams.get('id')).toBe(`eq.${operation}`)
    })
    it.each(['teacher', 'student'])(`${cold ? 'cold' : 'hot'} starts with current owner label %s through native begin/claim/finalize`, async role => {
      mocks.auth.mockResolvedValue({ id: actor, role }); transport(cold, {}, { fresh: true })
      const response = await start(req('POST', startBody(cold)), context)
      expect(response.status).toBe(200)
      const begun = requests.find(r => r.url.pathname.includes('/rpc/begin_'))!
      expect(begun.body).toMatchObject({ p_teacher_id: actor, p_classroom_id: classroom, p_operation_id: operation })
      if (cold) expect(begun.body).toHaveProperty('p_archive_id', archive)
      expect(requests.filter(r => r.url.pathname.includes('/rpc/claim_'))).toHaveLength(1)
      expect(requests.filter(r => r.url.pathname.includes('/rpc/finalize_'))).toHaveLength(1)
    })
    it.each([
      { confirmation: 'wrong' }, { expected_source_revision: 2 }, { expected_storage_inventory_sha256: 'b'.repeat(64) },
      { [cold ? 'expected_cold_resource_inventory_sha256' : 'expected_operational_inventory_sha256']: 'b'.repeat(64) },
    ])(`${cold ? 'cold' : 'hot'} preserves typed confirmation and all digests %#`, async patch => {
      transport(cold, {}, { fresh: true })
      expect([400, 409]).toContain((await start(req('POST', { ...startBody(cold), ...patch }), context)).status)
      expect(requests.every(r => !r.url.pathname.includes('/rpc/begin_') && !r.url.pathname.includes('/rpc/claim_'))).toBe(true)
    })
    it.each([{ owner: false }, { inventory: { deletion_available: false } }, { inventory: { classroom_id: other } }, { inventory: { status: 500 } },
      ...(cold ? [{ inventory: { archive_id: other } }] : [{ active: true }, { tombstone: true }]),
    ])(`${cold ? 'cold' : 'hot'} preserves current ownership/lifecycle/gate and inventory identity denial %#`, async options => {
      transport(cold, {}, { fresh: true, ...options })
      expect([404, 409, 503]).toContain((await start(req('POST', startBody(cold)), context)).status)
      expect(requests.every(r => !r.url.pathname.includes('/rpc/begin_') && !r.url.pathname.includes('/rpc/claim_'))).toBe(true)
    })
    it.each([null, {}, { ok: true, status: 202 }, { ok: true, status: 202, operation_id: other }, { ok: true, status: 500, operation_id: operation }, { ok: true, status: 202, operation_id: operation, operation_status: 'unknown' }])(
      `${cold ? 'cold' : 'hot'} does not advance after an unverified begin acknowledgment %#`, async begin => {
        transport(cold, {}, { fresh: true, begin })
        expect((await start(req('POST', startBody(cold)), context)).status).toBe(503)
        expect(requests.filter(r => r.url.pathname.includes('/rpc/begin_'))).toHaveLength(1)
        expect(requests.every(r => !r.url.pathname.includes('/rpc/claim_') && !r.url.pathname.includes('/rpc/finalize_'))).toBe(true)
      },
    )
    it(`${cold ? 'cold' : 'hot'} reports lost begin acknowledgment without any retry or cleanup`, async () => {
      transport(cold, {}, { fresh: true, beginLoss: true })
      const response = await start(req('POST', startBody(cold)), context)
      expect(response.status).toBe(503)
      expect(JSON.stringify(await response.json())).not.toContain('private/path')
      expect(requests.filter(r => r.url.pathname.includes('/rpc/begin_'))).toHaveLength(1)
      expect(requests.every(r => !r.url.pathname.includes('/rpc/claim_') && !r.url.pathname.includes('/rpc/finalize_'))).toBe(true)
    })
    it(`${cold ? 'cold' : 'hot'} preserves native decommission/ownership race denial at begin`, async () => {
      transport(cold, {}, { fresh: true, beginDenied: true })
      const response = await start(req('POST', startBody(cold)), context)
      expect(response.status).toBe(409)
      expect(JSON.stringify(await response.json())).not.toContain('private/path')
      expect(requests.every(r => !r.url.pathname.includes('/rpc/claim_'))).toBe(true)
    })
    it.each([null, {}, [{ id: other, operation_id: other, storage_bucket: 'classroom-archives', storage_path: 'private/path', lease_token: other }]])(
      `${cold ? 'cold' : 'hot'} cannot delete a missing/malformed/cross-operation claim %#`, async claim => {
        transport(cold, {}, { fresh: true, claim })
        expect((await start(req('POST', startBody(cold)), context)).status).toBe(503)
        expect(requests.every(r => !r.url.pathname.includes('/storage/') && !r.url.pathname.includes('/rpc/complete_') && !r.url.pathname.includes('/rpc/fail_'))).toBe(true)
      },
    )
    it(`${cold ? 'cold' : 'hot'} refuses a substituted lease token for the exact operation before any Storage or worker follow-up`, async () => {
      transport(cold, {}, { fresh: true, claimLease: 'wrong' })
      expect((await start(req('POST', startBody(cold)), context)).status).toBe(503)
      expect(requests.filter(r => r.url.pathname.includes('/rpc/claim_'))).toHaveLength(1)
      expect(requests.every(r => !r.url.pathname.includes('/storage/') && !/\/(complete|fail|finalize)_/.test(r.url.pathname))).toBe(true)
    })
    it(`${cold ? 'cold' : 'hot'} deletes and completes only the exact server-generated claim lease`, async () => {
      transport(cold, {}, { fresh: true, claimLease: 'exact' })
      expect((await start(req('POST', startBody(cold)), context)).status).toBe(200)
      const claim = requests.find(r => r.url.pathname.includes('/rpc/claim_'))!
      const complete = requests.find(r => r.url.pathname.endsWith('/rpc/complete_classroom_purge_object'))!
      expect(claim.body).toMatchObject({ p_teacher_id: actor, p_operation_id: operation, p_lease_token: expect.any(String) })
      expect(complete.body).toEqual({ p_teacher_id: actor, p_object_id: other, p_lease_token: claim.body!.p_lease_token })
      expect(requests.filter(r => r.url.pathname.startsWith('/storage/v1/object/'))).toEqual([{
        url: new URL('http://localhost:54321/storage/v1/object/classroom-archives'), body: { prefixes: ['private/path'] },
      }])
      expect(requests.every(r => !/\/(fail|finalize)_/.test(r.url.pathname))).toBe(true)
    })
    it(`${cold ? 'cold' : 'hot'} keeps absent and unmatched admission on the legacy role guard`, async () => {
      const fetch = transport(cold)
      vi.unstubAllEnvs()
      expect((await status(req(), context)).status).toBe(403)
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [other] }))
      expect((await status(req(), context)).status).toBe(403)
      expect(fetch).not.toHaveBeenCalled()
    })
    it(`${cold ? 'cold' : 'hot'} rejects unauthenticated callers before any purge read`, async () => {
      const fetch = transport(cold)
      mocks.auth.mockRejectedValue(Object.assign(new Error('No session'), { name: 'AuthenticationError' }))
      expect((await status(req(), context)).status).toBe(401)
      expect(fetch).not.toHaveBeenCalled(); expect(mocks.role).not.toHaveBeenCalled()
    })
    it.each([{ confirmation: '' }, { operation_id: 'bad' }, { extra: actor }])(
      `${cold ? 'cold' : 'hot'} rejects malformed admitted start before its coordinator %#`, async patch => {
        const fetch = transport(cold)
        expect((await start(req('POST', { ...startBody(cold), ...patch }), context)).status).toBe(400)
        expect(fetch).not.toHaveBeenCalled()
      },
    )
    it.each(['{', '{"unexpected":true}'])(`${cold ? 'cold' : 'hot'} rejects malformed/nonempty admitted tick %s`, async body => {
      const fetch = transport(cold)
      expect((await tick(new NextRequest('http://localhost/tick', { method: 'POST', body }), context)).status).toBe(400)
      expect(fetch).not.toHaveBeenCalled()
    })
    it.each(['', '{', '{}'])(`${cold ? 'cold' : 'hot'} fails closed for malformed admission %s`, async raw => {
      const fetch = transport(cold); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', raw)
      expect((await status(req(), context)).status).toBe(503)
      expect(fetch).not.toHaveBeenCalled(); expect(mocks.role).not.toHaveBeenCalled()
    })
  }
  it.each([{ id: other }, { teacher_id: other }])('rejects substituted hot current-owner root %#', async root => {
    transport(false, {}, { fresh: true, root })
    expect((await hotStart(req('POST', startBody(false)), context)).status).toBe(503)
    expect(requests.every(r => !r.url.pathname.includes('/rpc/begin_'))).toBe(true)
  })
  it.each([{ id: 'bad' }, { id: other }, { teacher_id: other }, { purge_scope: 'hot_classroom' }])(
    'never treats malformed/substituted cold replay identity as permission to begin %#', async patch => {
      transport(true, patch, { spoof: true })
      expect((await coldStart(req('POST', startBody(true)), context)).status).toBe(503)
      expect(requests.every(r => !r.body)).toBe(true)
    },
  )
})
