import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { reorderContextualTests } from '@/lib/server/contextual-test-reorder'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import {
  newTestOwnerReorderFixture, testOwnerReorderRequest, testOwnerReorderBulkTest, TEST_OWNER_REORDER_SNAPSHOT_TABLES,
  testOwnerReorderTableCatalogFromCanonical, validateTestOwnerReorderSetupSnapshot,
} from '../../scripts/contextual-test-reorder-proof-fixture'
import { createTestOwnerReorderProofTransport, testOwnerReorderRequestManifest } from '../../scripts/contextual-test-reorder-proof-transport'

const f = newTestOwnerReorderFixture(newAssignmentListProofFixture(new Date('2026-10-07T03:00:00Z')))
const project = `pika_assignment_list_${f.tag.slice(-12)}`
const key = `e30.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.synthetic`
const target = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: key }
const path = target.API_URL + '/rest/v1/rpc/reorder_tests_for_owner_v1'
const first = f.cases[0]
const headers = () => ({ authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json', 'x-client-info': 'supabase-js-node/2.93.3', 'content-profile': 'public' })
const args = (label = first.label) => {
  const c = [...f.cases, ...f.privilegeProbes].find(c => c.label === label)!
  const input = testOwnerReorderRequest(f, label)
  return { p_actor_id: c.actorId, p_classroom_id: c.classroomId, p_test_ids: input.test_ids, p_deadline: new Date(Date.now() + 20000).toISOString() }
}
function witness(label = first.label, changedCount?: number) {
  const request = args(label); const count = request.p_test_ids.length
  return { version: 1, actor_id: request.p_actor_id, classroom_id: request.p_classroom_id, test_ids: request.p_test_ids,
    positions: request.p_test_ids.map((_, i) => count - 1 - i), count, changed_count: changedCount ?? count }
}
type Whole = Record<string, Record<string, unknown>[]>
const tableNames = [...TEST_OWNER_REORDER_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets', 'public.unrelated_future_table']
const catalog = testOwnerReorderTableCatalogFromCanonical({ rowDigests: JSON.stringify(Object.fromEntries(tableNames.map(t => [t, { count: 0, digest: 'a'.repeat(32) }]))),
  guard168Metadata: '{}', settings: '{}', cronJobs: '[]', resources: '[]' })
function baseline(): Whole {
  const s: Whole = Object.fromEntries(TEST_OWNER_REORDER_SNAPSHOT_TABLES.map(t => [t, []]))
  s['public.users'] = f.actors.map(r => ({ ...r, preserved: true }))
  s['public.classrooms'] = f.classes.map(c => ({ id: c.id, teacher_id: c.owner, title: c.title, class_code: c.code,
    archived_at: c.archived ? f.now : null, blueprint_source_revision: 203, updated_at: f.now, untouched: 'keep' }))
  s['public.classroom_archive_revisions'] = f.classes.map(c => ({ classroom_id: c.id, revision: 411, updated_at: f.now }))
  s['public.gradebook_categories'] = f.classes.flatMap((c, ci) => [0, 1, 2].map(i => ({ id: `99999999-9999-4999-8999-${String(ci * 3 + i).padStart(12, '0')}`,
    classroom_id: c.id, position: i, is_default: i === 0 })))
  s['public.tests'] = f.tests.map(t => ({ ...structuredClone(t), gradebook_category_id: s['public.gradebook_categories'].find(c => c.classroom_id === t.classroom_id)!.id }))
  s.__bulk_tests = f.bulkClasses.flatMap(b => Array.from({ length: b.count }, (_, i) => {
    const row = testOwnerReorderBulkTest(f, b.label, i)
    return { id: row.id, classroom_id: row.classroom_id, position: row.position, updated_at: row.updated_at, immutable_sha256: 'a'.repeat(64) }
  }))
  s.__bulk_setup = f.bulkClasses.map(b => ({ classroom_id: b.classroomId, count: b.count, immutable_valid: true }))
  for (const [table, rows] of [['public.test_questions', f.questions], ['public.assessment_drafts', f.drafts],
    ['public.classroom_enrollments', f.enrollments], ['public.test_attempts', f.attempts], ['public.test_responses', f.responses],
    ['public.test_student_availability', f.availability], ['public.test_focus_events', f.focusEvents],
    ['public.test_attempt_history', f.attemptHistory], ['public.classroom_guided_draft_provenance', f.provenance]] as const) s[table] = rows.map(r => structuredClone(r))
  s['public.managed_storage_settings'] = [{ singleton: true, active_version: 0, updated_at: f.now }]
  s['private.classroom_test_quota_settings'] = [{ singleton: true, enabled: false }]
  for (const table of ['private.pal_membership_settings', 'private.pal_classroom_signal_settings', 'private.student_provider_cleanup_settings',
    'private.classroom_creation_entitlement_settings']) s[table] = [{ singleton: true, enabled: false }]
  s.__nontarget_fingerprints = tableNames.map(table => ({ table, fingerprint: 'unchanged' }))
  validateTestOwnerReorderSetupSnapshot(f, s, catalog)
  return s
}
function postimage(before: Whole, label: string) {
  const after = structuredClone(before); const w = witness(label)
  const positions = new Map(w.test_ids.map((id, i) => [id, w.positions[i]])); let changed = 0
  for (const table of ['public.tests', '__bulk_tests']) after[table] = after[table].map(r => {
    if (r.classroom_id !== w.classroom_id || r.position === positions.get(String(r.id))) return r
    changed++; return { ...r, position: positions.get(String(r.id)), updated_at: new Date().toISOString() }
  })
  for (const [table, field, revision, delta] of [['public.classrooms', 'id', 'blueprint_source_revision', changed],
    ['public.classroom_archive_revisions', 'classroom_id', 'revision', 2 * changed]] as const) after[table] = after[table].map(r =>
    r[field] === w.classroom_id && delta ? { ...r, [revision]: Number(r[revision]) + delta, updated_at: new Date().toISOString() } : r)
  return { after, envelope: { ...w, changed_count: changed } }
}
function harness(fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(witness())))) {
  const guard = vi.fn(async () => {})
  const transport = createTestOwnerReorderProofTransport(f, target, project, fetcher, guard)
  const client = createClient<Database>(target.API_URL, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
  return { transport, client, fetcher, guard, invoke(label = first.label, signal?: AbortSignal) {
    const c = [...f.cases, ...f.privilegeProbes].find(c => c.label === label)!; const start = Date.now(); transport.readContext(label, start)
    return reorderContextualTests({ supabase: client, actorId: c.actorId, input: testOwnerReorderRequest(f, label), deadline: start + 20000, signal })
  } }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime('2026-10-07T04:00:00Z') })
afterEach(() => vi.useRealTimers())

describe('sealed reorder installed SDK transport', () => {
  it('freezes the fixture matrix and unchanged caps without exposing credentials', () => {
    const m = testOwnerReorderRequestManifest(f); const h = harness()
    expect(m.cases).toEqual(f.cases); expect(m.privilegeProbes).toEqual(f.privilegeProbes)
    expect(m.paths).toEqual(['/rest/v1/rpc/reorder_tests_for_owner_v1']); expect(Object.isFrozen(m.cases[0])).toBe(true)
    expect(m.caps).toMatchObject({ requestBytes: 524288, resultBytes: 524288, envelopeBytes: 1048576, networkRequests: 24, rpcRequests: 24, totalBytes: 67108864 })
    expect(h.transport).not.toHaveProperty('target'); expect(JSON.stringify(m)).not.toContain(key)
    expect(h.transport.diagnostic()).not.toContain(key); expect(h.transport.diagnostic()).not.toContain(target.DB_URL)
  })
  it('uses exactly one installed-SDK write and exposes one provisional witness', async () => {
    const h = harness(); expect(await h.invoke()).toEqual({ success: true })
    expect(h.fetcher).toHaveBeenCalledOnce(); expect(String(h.fetcher.mock.calls[0][0])).toBe(path)
    expect(JSON.parse(String(h.fetcher.mock.calls[0][1]?.body))).toEqual(args())
    expect(h.guard).toHaveBeenCalledTimes(2); expect(h.transport.counts).toMatchObject({ network: 1, rpc: 1, storage: 0 })
    expect(h.transport.getPendingWitness()?.ledger.at(-1)?.state).toBe('provisional'); expect(h.transport.getPendingWitness()).toBeUndefined()
    expect(h.transport.getVerifiedLedger()).toHaveLength(0); expect(h.transport.completion().complete).toBe(false)
    expect(h.transport).not.toHaveProperty('installVerifiedLedger'); expect(h.transport).not.toHaveProperty('verifyTransitionEffects'); expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['https://example.invalid', target.API_URL + '/rest/v1/tests', target.API_URL + '/storage/v1/object/x', path + '?q=1', path + '#x',
    target.API_URL + '/rest/v1/rpc/../rpc/reorder_tests_for_owner_v1', 'http://localhost:54331/rest/v1/rpc/reorder_tests_for_owner_v1',
    'http://secret@127.0.0.1:54331/rest/v1/rpc/reorder_tests_for_owner_v1'])('rejects unsealed URL %s', async url => {
    const h = harness(); h.transport.readContext(first.label)
    await expect(h.transport.fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(args()) })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['cookie', 'prefer', 'range', 'x-forwarded-host', 'x-arbitrary'])('rejects extra header %s', async header => {
    const h = harness(); h.transport.readContext(first.label)
    await expect(h.transport.fetch(path, { method: 'POST', headers: { ...headers(), [header]: 'synthetic' }, body: JSON.stringify(args()) })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['authorization', 'apikey', 'x-client-info', 'content-profile', 'content-type'])('requires exact SDK header %s', async header => {
    const h = harness(); h.transport.readContext(first.label); const hs = new Headers(headers()); hs.delete(header)
    await expect(h.transport.fetch(path, { method: 'POST', headers: hs, body: JSON.stringify(args()) })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['p_actor_id', 'p_classroom_id', 'p_test_ids', 'p_deadline', 'extra'])('rejects request %s drift before dispatch', async field => {
    const h = harness(); h.transport.readContext(first.label)
    const bad = { ...args(), [field]: field === 'p_test_ids' ? [...args().p_test_ids].reverse() : field === 'p_deadline' ? new Date(Date.now() + 20001).toISOString() : 'forged' }
    await expect(h.transport.fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(bad) })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('rejects duplicate escaped request keys before dispatch', async () => {
    const h = harness(); h.transport.readContext(first.label)
    const body = JSON.stringify(args()).replace('{', '{"p_\\u0061ctor_id":"forged",')
    await expect(h.transport.fetch(path, { method: 'POST', headers: headers(), body })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('accepts exactly512KiB raw UTF8 request bytes and rejects one extra byte', async () => {
    const text = JSON.stringify(args()).padEnd(524288, ' ')
    const good = harness(); good.transport.readContext(first.label)
    await good.transport.fetch(path, { method: 'POST', headers: headers(), body: text })
    expect(good.fetcher).toHaveBeenCalledOnce(); expect(good.transport.counts.exchangeBytes).toBe(524288 + Buffer.byteLength(JSON.stringify(witness())))
    const bad = harness(); bad.transport.readContext(first.label)
    await expect(bad.transport.fetch(path, { method: 'POST', headers: headers(), body: text + ' ' })).rejects.toThrow(); expect(bad.fetcher).not.toHaveBeenCalled()
  })
  it('rejects a forged service credential and redirect/custom fetch options', async () => {
    for (const init of [
      { method: 'POST', headers: { ...headers(), apikey: 'forged' }, body: JSON.stringify(args()) },
      { method: 'POST', headers: headers(), body: JSON.stringify(args()), redirect: 'follow' as const },
      { method: 'POST', headers: headers(), body: JSON.stringify(args()), cache: 'no-store' as const },
    ]) {
      const h = harness(); h.transport.readContext(first.label)
      await expect(h.transport.fetch(path, init)).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
    }
  })
  it.each(['GET', 'PATCH', 'DELETE'])('rejects method %s', async method => {
    const h = harness(); h.transport.readContext(first.label)
    await expect(h.transport.fetch(path, { method, headers: headers(), body: JSON.stringify(args()) })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['fake', 'duplicate', 'utf8', 'redirect', 'length', 'oversize', 'depth'])('rejects response %s and permanently poisons ledger', async mode => {
    const fetcher = vi.fn<typeof fetch>(async () => mode === 'fake' ? new Response('{"success":true}')
      : mode === 'duplicate' ? new Response(JSON.stringify(witness()).replace('{', '{"\\u0076ersion":1,'))
      : mode === 'utf8' ? new Response(new Uint8Array([255]))
      : mode === 'redirect' ? new Response('{}', { status: 302, headers: { location: 'https://example.invalid' } })
      : mode === 'length' ? new Response('{}', { headers: { 'content-length': '524289' } })
      : mode === 'depth' ? new Response('['.repeat(65) + '0' + ']'.repeat(65)) : new Response(' '.repeat(524289)))
    const h = harness(fetcher); await expect(h.invoke()).rejects.toMatchObject({ statusCode: 503 })
    expect(h.transport.getPendingWitness()).toBeUndefined(); expect(h.transport.completion().complete).toBe(false)
    expect(() => h.transport.readContext(first.label)).toThrow(); expect(h.fetcher).toHaveBeenCalledOnce()
  })
  it('cancels stalled response reads without awaiting hostile cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const h = harness(vi.fn(async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}) }, cancel }))))
    const controller = new AbortController(); const result = expect(h.invoke(first.label, controller.signal)).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(1); controller.abort(); await result
    expect(cancel).toHaveBeenCalledOnce(); expect(h.fetcher).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects locked or consumed response bodies', async () => {
    for (const mode of ['locked', 'used']) {
      const response = new Response(JSON.stringify(witness())); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      if (mode === 'used') await response.text(); else reader = response.body!.getReader()
      const h = harness(vi.fn(async () => response)); await expect(h.invoke()).rejects.toMatchObject({ statusCode: 503 })
      expect(h.fetcher).toHaveBeenCalledOnce(); if (reader) { await reader.cancel(); reader.releaseLock() }
    }
  })
  it('rejects late transport settlement and preserves its rooted budget', async () => {
    const h = harness(vi.fn(async () => { vi.setSystemTime('2026-10-07T04:00:21Z'); return new Response(JSON.stringify(witness())) }))
    await expect(h.invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(h.fetcher).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects a lost acknowledgement without a second request', async () => {
    const h = harness(vi.fn(async () => { throw new Error('offline synthetic lost ACK') }))
    await expect(h.invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(h.fetcher).toHaveBeenCalledOnce(); expect(() => h.transport.readContext(first.label)).toThrow()
  })
  it('physically aborts an active request on forbidden reentry', async () => {
    let signal: AbortSignal | undefined
    const h = harness(vi.fn((_, init) => { signal = init?.signal ?? undefined; return new Promise(() => {}) }))
    const result = expect(h.invoke()).rejects.toMatchObject({ statusCode: 503 }); await vi.advanceTimersByTimeAsync(1)
    expect(() => h.transport.readContext(f.cases[1].label)).toThrow(); expect(signal?.aborted).toBe(true)
    await result; expect(h.fetcher).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
  it('does not renew a never-settling guard or dispatch', async () => {
    const h = harness(); h.guard.mockImplementation(() => new Promise(() => {}))
    const result = expect(h.invoke()).rejects.toMatchObject({ statusCode: 503 }); await vi.advanceTimersByTimeAsync(20000); await result
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.transport.counts.rpc).toBe(0); expect(vi.getTimerCount()).toBe(0)
  })
  it('captures checked request primitives before a guard can mutate caller objects', async () => {
    const h = harness(); h.transport.readContext(first.label); const resource = new URL(path); const hs = new Headers(headers())
    const body = JSON.stringify(args()); const init: RequestInit = { method: 'POST', headers: hs, body }
    h.guard.mockImplementationOnce(async () => { resource.href = 'https://example.invalid'; init.body = 'forged'; hs.set('cookie', 'forged') })
    await h.transport.fetch(resource, init)
    expect(h.fetcher.mock.calls[0][0]).toBe(path); expect(h.fetcher.mock.calls[0][1]?.body).toBe(body); expect(new Headers(h.fetcher.mock.calls[0][1]?.headers).has('cookie')).toBe(false)
  })
  it('only promotes a provisional witness through complete fixture effects', async () => {
    const before = baseline(); const p = postimage(before, first.label); const h = harness(vi.fn(async () => new Response(JSON.stringify(p.envelope))))
    const result = await h.invoke(); h.transport.verifyEffects(before, p.after, result, new Date().toISOString())
    expect(h.transport.getVerifiedLedger()).toHaveLength(1); expect(h.transport.getVerifiedLedger()[0].state).toBe('verified')
    expect(Object.isFrozen(h.transport.getVerifiedLedger()[0])).toBe(true); expect(h.transport).not.toHaveProperty('setState')
  })
  it('rejects incomplete effects and prevents a later context from restarting', async () => {
    const before = baseline(); const p = postimage(before, first.label); p.after['public.test_questions'][0].question_text = 'drift'
    const h = harness(vi.fn(async () => new Response(JSON.stringify(p.envelope)))); const result = await h.invoke()
    expect(() => h.transport.verifyEffects(before, p.after, result)).toThrow(); expect(h.transport.getVerifiedLedger()).toHaveLength(0)
    expect(() => h.transport.readContext(f.cases[1].label)).toThrow()
  })
  it('requires verified effects before another context and rejects duplicate writes', async () => {
    const h = harness(); await h.invoke()
    await expect(h.transport.fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(args()) })).rejects.toThrow()
    expect(h.fetcher).toHaveBeenCalledOnce(); expect(h.transport.getPendingWitness()).toBeUndefined(); expect(() => h.transport.readContext(first.label)).toThrow()
  })
  it('observes raw42501 and requires unchanged effects before any later request', async () => {
    const c = f.privilegeProbes[0]; const before = baseline()
    const h = harness(vi.fn(async () => new Response(JSON.stringify({ code: '42501', message: 'offline synthetic permission probe' }), { status: 403 })))
    await expect(h.invoke(c.label)).rejects.toMatchObject({ statusCode: 503 }); expect(h.transport.evidence.rawPrivilegeFailures).toBe(1)
    h.transport.verifyEffects(before, before); expect(h.transport.getVerifiedLedger()[0]).toMatchObject({ kind: 'denial', state: 'verified' })
    expect(h.transport.evidence.restoredPrivilegeContexts).toEqual([]); expect(h.transport.completion().complete).toBe(false)
  })
  it('does not count55000 as raw42501 privilege evidence', async () => {
    const h = harness(vi.fn(async () => new Response(JSON.stringify({ code: '55000', message: 'offline wrong error' }), { status: 500 })))
    await expect(h.invoke(f.privilegeProbes[0].label)).rejects.toMatchObject({ statusCode: 503 }); expect(h.transport.evidence.rawPrivilegeFailures).toBe(0)
    expect(h.transport.getPendingWitness()).toBeUndefined(); expect(() => h.transport.readContext(first.label)).toThrow()
  })
  it.each([Infinity, NaN, 0, Date.parse('2099-01-01T00:00:00Z')])('rejects invalid rooted context start %s', start => {
    const h = harness(); expect(() => h.transport.readContext(first.label, start)).toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('rejects Request resources, arbitrary contexts and nonisolated targets', async () => {
    const h = harness(); h.transport.readContext(first.label)
    await expect(h.transport.fetch(new Request(path, { method: 'POST', headers: headers(), body: JSON.stringify(args()) }))).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
    expect(() => harness().transport.readContext('arbitrary')).toThrow()
    for (const t of [{ ...target, API_URL: 'http://127.0.0.1:54321' }, { ...target, DB_URL: 'postgresql://postgres:x@localhost:54332/postgres' }, { ...target, SERVICE_ROLE_KEY: 'invalid' }])
      expect(() => createTestOwnerReorderProofTransport(f, t, project, vi.fn(), async () => {})).toThrow()
    expect(() => createTestOwnerReorderProofTransport(f, target, 'production', vi.fn(), async () => {})).toThrow()
  })
  it('completes the 1k boundary matrix with raw denial, restored privilege and36 counted captures', async () => {
    let current = baseline(); let label = first.label; let next: ReturnType<typeof postimage> | undefined
    const h = harness(vi.fn(async () => {
      const c = [...f.cases, ...f.privilegeProbes].find(c => c.label === label)!
      if (f.privilegeProbes.some(c => c.label === label)) return new Response(JSON.stringify({ code: '42501', message: 'offline synthetic permission denial' }), { status: 403 })
      if (c.expectedHTTP !== 200) return new Response(JSON.stringify({ code: `PT${c.expectedHTTP}`, message: 'offline synthetic planned denial' }), { status: c.expectedHTTP })
      next = postimage(current, label); return new Response(JSON.stringify(next.envelope))
    }))
    let serialized = 0
    for (const c of [...f.privilegeProbes, ...f.cases]) {
      label = c.label; next = undefined; const before = structuredClone(current); let publicResult: unknown
      if (c.expectedHTTP === 200) { publicResult = await h.invoke(label); current = next!.after }
      else await expect(h.invoke(label)).rejects.toMatchObject({ statusCode: c.expectedHTTP })
      serialized += Buffer.byteLength(JSON.stringify(before)) + Buffer.byteLength(JSON.stringify(current))
      h.transport.verifyEffects(before, current, publicResult)
    }
    expect(h.transport.completion()).toEqual({ complete: true, verifiedContextLabels: [...f.privilegeProbes, ...f.cases].map(c => c.label) })
    expect(h.transport.counts).toMatchObject({ network: 18, rpc: 18, storage: 0, snapshots: 36, snapshotBytes: serialized })
    expect(serialized).toBeLessThan(64 * 1024 * 1024)
    expect(testOwnerReorderRequestManifest(f).caps.snapshotTotalBytes).toBe(256 * 1024 * 1024)
    expect(h.transport.counts.totalBytes).toBeLessThan(64 * 1024 * 1024)
    expect(h.transport.evidence.rawPrivilegeContexts).toEqual(['254']); expect(h.transport.evidence.restoredPrivilegeContexts).toEqual(['254'])
    expect(h.transport.getVerifiedLedger()).toHaveLength(18); expect(h.transport.getVerifiedLedger().every(w => w.state === 'verified')).toBe(true)
    expect(h.transport.diagnostic()).not.toContain(key); expect(vi.getTimerCount()).toBe(0)
    process.stdout.write('Offline reorder transport byte receipt ' + JSON.stringify({ snapshots: h.transport.counts.snapshots,
      snapshotBytes: serialized, exchangeBytes: h.transport.counts.exchangeBytes, nativeVerified: false }) + '\n')
  }, 60000)
})
