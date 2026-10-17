import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createContextualTest } from '@/lib/server/contextual-test-create'

const require = createRequire(import.meta.url)
type Flag = 'denied' | 'uncertain' | 'expired' | 'capExceeded'
type Bucket = 'app' | 'storage' | 'api'
type Ledger = { note(flag: Flag): void; charge(bucket: Bucket): void; snapshot(): unknown }
type Policy = { admit(url: string): Bucket; check(): void; socket(options: { host: string; port: number }): void }
const { createContextualTestEgressPolicy, createContextualTestBoundedFetch } = require('../../scripts/contextual-test-rehearsal-egress.cjs') as {
  createContextualTestEgressPolicy(options: { deadline: number; ledger: Ledger }): Policy
  createContextualTestBoundedFetch(fetcher: typeof fetch, options: { deadline: number; ledger: Ledger }, policy: Policy): typeof fetch
}

const apiOrigin = 'http://127.0.0.1:54331'
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = '33333333-3333-4333-8333-333333333333'
const draftId = '44444444-4444-4444-8444-444444444444'
const artifactId = '55555555-5555-4555-8555-555555555555'
const stamp = '2026-10-17T15:00:00Z'
const title = 'Untitled 2026-10-17 11:00:00'
const input = { classroom_id: classroomId }
const rpcArgs = () => ({ p_actor_id: actorId, p_classroom_id: classroomId, p_title: title, p_deadline: '2026-10-17T15:00:20.000Z' })
function acknowledgement() {
  return { version: 1, actor_id: actorId, classroom_id: classroomId, test_id: testId,
    test: { id: testId, classroom_id: classroomId, title, status: 'draft', show_results: false, position: 0,
      points_possible: 100, include_in_final: true, created_by: actorId, created_at: stamp, updated_at: stamp,
      documents: [], artifact_id: artifactId, source_artifact_id: null, blueprint_archived_at: null,
      source_blueprint_version_id: null, questions_locked_at: null, gradebook_category_id: null,
      gradebook_weight: 10, gradebook_maximum_override: null, gradebook_score_scale: 1 },
    draft: { id: draftId, assessment_type: 'test', assessment_id: testId, classroom_id: classroomId,
      content: { title, show_results: false, question_identity_version: 1, questions: [], source_format: 'markdown' },
      version: 1, created_by: actorId, updated_by: actorId, created_at: stamp, updated_at: stamp } }
}

/** No native installer, sockets, processes, database, or browser. This is the
 * installed SDK's real fetch boundary, with only an in-memory response source.
 * The synthetic ledger has no authority over a native rehearsal or its receipts.
 */
function fixture(mode: 'success' | 'socket-denied' | 'lost-ack' | 'domain-denied' | 'malformed-ack' = 'success', origin = apiOrigin) {
  const state = { app: 0, storage: 0, api: 0, flags: { denied: false, uncertain: false, expired: false, capExceeded: false } }
  const ledger: Ledger = {
    note(flag) { state.flags[flag] = true }, snapshot: () => structuredClone(state),
    charge(bucket) {
      if (Object.values(state.flags).some(Boolean)) throw Error('Synthetic allocation closed')
      if ((bucket === 'app' && state.app >= 50) || (bucket === 'storage' && state.storage >= 20)) {
        state.flags.capExceeded = true; throw Error('Synthetic allocation exhausted')
      }
      state[bucket]++
    },
  }
  const options = { deadline: Date.now() + 30000, ledger }
  const policy = createContextualTestEgressPolicy(options)
  const requests: Array<{ inputKind: string; url: string; method: string | undefined; headersAreNative: boolean;
    hasAuth: boolean; hasApiKey: boolean; contentType: string | null; body: unknown; redirect: RequestRedirect | undefined; signal: AbortSignal | null | undefined }> = []
  const dispatch = vi.fn<typeof fetch>(async (value, init) => {
    const headers = new Headers(init?.headers)
    // Observe only synthetic fields; never retain credential/header values.
    requests.push({ inputKind: typeof value, url: String(value), method: init?.method,
      headersAreNative: init?.headers instanceof Headers, hasAuth: headers.has('authorization'), hasApiKey: headers.has('apikey'),
      contentType: headers.get('content-type'), body: JSON.parse(String(init?.body)), redirect: init?.redirect, signal: init?.signal })
    if (mode === 'socket-denied') policy.socket({ host: '203.0.113.9', port: 54331 })
    if (mode === 'lost-ack') throw Error('SYNTHETIC_PRIVATE_ACK_FAILURE')
    const body = mode === 'domain-denied' ? { code: 'PT403', message: 'SYNTHETIC_PRIVATE_SQL', details: 'SYNTHETIC_PRIVATE_DETAILS', hint: null }
      : mode === 'malformed-ack' ? { ...acknowledgement(), test_id: artifactId } : acknowledgement()
    return new Response(JSON.stringify(body), { status: mode === 'domain-denied' ? 403 : 200, headers: { 'content-type': 'application/json' } })
  })
  const boundedFetch = createContextualTestBoundedFetch(dispatch, options, policy)
  const sdk = createClient<Database>(origin, 'offline-synthetic-key', {
    global: { fetch: boundedFetch }, auth: { persistSession: false, autoRefreshToken: false },
  })
  const from = vi.spyOn(sdk, 'from'), storage = vi.spyOn(sdk.storage, 'from')
  return { state, sdk, dispatch, requests, from, storage,
    create: () => createContextualTest({ supabase: sdk, actorId, input }),
    rpc: () => sdk.rpc('create_test_for_owner_v1', rpcArgs()) }
}

describe('offline characterization of the rehearsal server Test create boundary', () => {
  const unconfiguredFetch = vi.fn(() => { throw Error('Unconfigured offline fetch') })
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(stamp)
    unconfiguredFetch.mockClear(); vi.stubGlobal('fetch', unconfiguredFetch)
  })
  afterEach(() => {
    expect(unconfiguredFetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  })

  it('admits the installed SDK string/Headers POST and verifies the real helper acknowledgement', async () => {
    const f = fixture()
    await expect(f.create()).resolves.toEqual({ test: { ...acknowledgement().test, assessment_type: 'test' } })
    expect(f.requests).toEqual([{ inputKind: 'string', url: `${apiOrigin}/rest/v1/rpc/create_test_for_owner_v1`, method: 'POST',
      headersAreNative: true, hasAuth: true, hasApiKey: true, contentType: 'application/json', body: rpcArgs(), redirect: 'error', signal: expect.any(AbortSignal) }])
    expect(f.requests[0].signal?.aborted).toBe(true)
    expect(f.dispatch).toHaveBeenCalledOnce(); expect(f.from).not.toHaveBeenCalled(); expect(f.storage).not.toHaveBeenCalled()
    expect(f.state).toEqual({ app: 0, storage: 0, api: 1, flags: { denied: false, uncertain: false, expired: false, capExceeded: false } })
  })

  it('characterizes SDK conversion of URL admission rejection before dispatch', async () => {
    const f = fixture('success', 'https://offline.invalid')
    const result = await f.rpc()
    // Do not assert/print raw SDK message/details; it may include a stack.
    expect({ data: result.data, count: result.count, status: result.status, statusText: result.statusText,
      code: result.error?.code, hint: result.error?.hint }).toEqual({ data: null, count: null, status: 0, statusText: '', code: '', hint: '' })
    expect(f.dispatch).not.toHaveBeenCalled()
    expect(f.state).toEqual({ app: 0, storage: 0, api: 0, flags: { denied: true, uncertain: false, expired: false, capExceeded: false } })
  })

  it('maps the same synthetic pre-dispatch denial to a safe 503 without retry or fallback', async () => {
    const f = fixture('success', 'https://offline.invalid')
    await expect(f.create()).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify test creation' })
    expect(f.dispatch).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled(); expect(f.storage).not.toHaveBeenCalled()
    expect(f.state.flags).toEqual({ denied: true, uncertain: false, expired: false, capExceeded: false })
  })

  it('distinguishes a denied socket inside original fetch by its additional uncertainty latch', async () => {
    const f = fixture('socket-denied')
    await expect(f.create()).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify test creation' })
    expect(f.dispatch).toHaveBeenCalledOnce(); expect(f.from).not.toHaveBeenCalled(); expect(f.storage).not.toHaveBeenCalled()
    expect(f.state).toEqual({ app: 0, storage: 0, api: 1, flags: { denied: true, uncertain: true, expired: false, capExceeded: false } })
  })

  it('retains lost acknowledgement as uncertainty without retry or compensating writes', async () => {
    const f = fixture('lost-ack')
    await expect(f.create()).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify test creation' })
    expect(f.dispatch).toHaveBeenCalledOnce(); expect(f.from).not.toHaveBeenCalled(); expect(f.storage).not.toHaveBeenCalled()
    expect(f.state.flags).toEqual({ denied: false, uncertain: true, expired: false, capExceeded: false })
  })

  it('distinguishes a database PT403 from egress denial and strips private database details', async () => {
    const f = fixture('domain-denied')
    await expect(f.create()).rejects.toMatchObject({ statusCode: 403, message: 'Forbidden' })
    expect(f.dispatch).toHaveBeenCalledOnce(); expect(f.from).not.toHaveBeenCalled(); expect(f.storage).not.toHaveBeenCalled()
    expect(f.state.flags).toEqual({ denied: false, uncertain: false, expired: false, capExceeded: false })
  })

  it('refuses a malformed success acknowledgement without treating HTTP success as creation proof', async () => {
    const f = fixture('malformed-ack')
    await expect(f.create()).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify test creation' })
    expect(f.dispatch).toHaveBeenCalledOnce(); expect(f.from).not.toHaveBeenCalled(); expect(f.storage).not.toHaveBeenCalled()
    expect(f.state.flags).toEqual({ denied: false, uncertain: false, expired: false, capExceeded: false })
  })
})
