/** Inert sealed installed-SDK transport. No import-time IO, SQL, native
 * acceptance, providers or cleanup. The adopter supplies real guarded effects. */
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { boundedAssignmentListJson } from '../src/lib/validations/contextual-assignment-list-read'
import { contextualTestReorderResultSchema } from '../src/lib/validations/contextual-test-reorder'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import {
  TEST_OWNER_REORDER_CAPS, testOwnerReorderRequest, registerTestOwnerReorderWitness, verifyTestOwnerReorderEffects,
  type TestOwnerReorderFixture, type TestOwnerReorderWitness,
} from './contextual-test-reorder-proof-fixture'

const API = 'http://127.0.0.1:54331'
const RPC = '/rest/v1/rpc/reorder_tests_for_owner_v1'
const requestKeys = Object.freeze(['p_actor_id', 'p_classroom_id', 'p_test_ids', 'p_deadline'])
const failure = () => new Error('Test owner reorder proof transport rejected; private details withheld')
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export function testOwnerReorderRequestManifest(f: TestOwnerReorderFixture) {
  return freeze({ version: 1 as const, fixtureTag: f.tag, origin: API, method: 'POST', sdk: 'supabase-js-node/2.93.3',
    paths: [RPC], requestKeys, caps: TEST_OWNER_REORDER_CAPS, cases: f.cases, privilegeProbes: f.privilegeProbes,
    nativeVerified: false as const })
}
/** Grammar plus bounded lexical scanning rejects escaped duplicate keys,
 * without treating escaped strings as structural JSON. */
function json(text: string, check: () => void): unknown {
  check(); const value: unknown = JSON.parse(text); check()
  const stack: Array<Set<string> | null> = []
  for (let i = 0; i < text.length; i++) {
    if ((i & 511) === 0) check()
    const char = text[i]
    if (char === '{' || char === '[') { stack.push(char === '{' ? new Set() : null); assert(stack.length <= 64) }
    else if (char === '}' || char === ']') stack.pop()
    else if (char === '"') {
      const start = i++
      for (; i < text.length; i++) { if ((i & 511) === 0) check(); if (text[i] === '\\') i++; else if (text[i] === '"') break }
      let next = i + 1; while (next < text.length && /[\t\n\r ]/.test(text[next])) next++
      if (text[next] === ':') {
        const key: string = JSON.parse(text.slice(start, i + 1)); const object = stack.at(-1)
        assert(object && !object.has(key)); object.add(key)
      }
    }
  }
  check(); return value
}
const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
const requestSchema = z.object({ p_actor_id: uuid, p_classroom_id: uuid,
  p_test_ids: z.array(uuid).max(TEST_OWNER_REORDER_CAPS.maxTestIds).refine(ids => new Set(ids).size === ids.length),
  p_deadline: timestamp }).strict()
const errorSchema = z.object({ code: z.enum(['PT400', 'PT403', 'PT404', 'PT409', 'PT503', '42501']),
  message: z.string().max(16384), details: z.string().max(16384).nullable().optional(), hint: z.string().max(16384).nullable().optional(),
}).strict()
type Scenario = TestOwnerReorderFixture['cases'][number] | TestOwnerReorderFixture['privilegeProbes'][number]
type Pending = Readonly<{ caseLabel: string; ledger: TestOwnerReorderWitness[] }>

/** Private monotonic run state. Only the complete fixture effect verifier may
 * promote a provisional acknowledgement or admit unchanged failed requests. */
export function createTestOwnerReorderProofTransport(f: TestOwnerReorderFixture, rawTarget: unknown, projectId: string,
  originalFetch: typeof fetch, guard: () => Promise<void>) {
  let target: ReturnType<typeof validateAssignmentListProofTarget>
  try {
    assert.match(f.tag, /^testownerreorder_[a-f0-9]{12}$/); assert(Object.isFrozen(f))
    assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
    assert(typeof originalFetch === 'function' && typeof guard === 'function')
    target = freeze(validateAssignmentListProofTarget(rawTarget, projectId)); assert.equal(target.API_URL, API)
    assert(f.cases.length + f.privilegeProbes.length <= 24)
    assert([...f.cases, ...f.privilegeProbes].every(c => c.expectedRPCs === 1))
  } catch { throw failure() }
  const manifest = testOwnerReorderRequestManifest(f)
  const observed = { network: 0, rpc: 0, storage: 0, exchangeBytes: 0, totalBytes: 0, snapshotBytes: 0, snapshots: 0 }
  let accepted: TestOwnerReorderWitness[] = freeze([]); let pending: Pending | undefined; let exposed = false
  let previousSnapshot: unknown; let context: Scenario | undefined; let start = 0; let deadline = 0
  let contextCalls = 0; let verified = true; let inFlight = false; let failed = false
  let activeController: AbortController | undefined; let rawPrivilegeFailures = 0
  const seen = new Set<string>(); const rawPrivilegeContexts = new Set<string>(); const restoredPrivilegeContexts = new Set<string>()
  const verifiedContexts: string[] = []
  let phase: 'idle' | 'context' | 'validate' | 'guard' | 'dispatch' | 'decode' | 'complete' | 'effects' | 'failed' = 'idle'
  function reject(): never { failed = true; activeController?.abort(); pending = undefined; phase = 'failed'; throw failure() }
  function readContext(caseLabel: string, startTime = Date.now()) {
    try {
      assert(!failed && !inFlight && verified && !pending && !seen.has(caseLabel))
      const found = [...manifest.cases, ...manifest.privilegeProbes].find(c => c.label === caseLabel); assert(found)
      assert(Number.isSafeInteger(startTime) && startTime <= Date.now() && Date.now() < startTime + manifest.caps.requestMs)
      context = found; start = startTime; deadline = startTime + manifest.caps.requestMs
      contextCalls = 0; verified = false; exposed = false; phase = 'context'; seen.add(caseLabel)
    } catch { reject() }
  }
  const safeFetch: typeof fetch = async (resource, init) => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined; let reply: Response | undefined
    let timer: ReturnType<typeof setTimeout> | undefined; let caller: AbortSignal | undefined
    let callerListener: (() => void) | undefined; let abortListener: (() => void) | undefined
    const controller = new AbortController(); let rpcDeadline = 0; let operationBytes = 0
    const check = () => assert(!failed && !controller.signal.aborted && !caller?.aborted && Date.now() < (rpcDeadline || deadline))
    try {
      assert(!failed && context && !inFlight && phase === 'context' && contextCalls === 0)
      phase = 'validate'; check()
      assert(!(resource instanceof Request)); assert(typeof resource === 'string' || resource instanceof URL)
      const expectedUrl = API + RPC; const url = new URL(String(resource))
      assert.equal(url.href, expectedUrl); assert.equal(String(resource), expectedUrl)
      assert(!url.search && !url.hash && !url.username && !url.password)
      assert(init && init.method === 'POST' && typeof init.body === 'string')
      assert(Object.keys(init).every(k => ['method', 'headers', 'body', 'signal', 'redirect'].includes(k)))
      assert(init.redirect === undefined || init.redirect === 'error'); assert(!init.signal || init.signal instanceof AbortSignal)
      caller = init.signal ?? undefined; assert(!caller?.aborted)
      const headers = new Headers(init.headers)
      const allowed: Record<string, readonly string[]> = { authorization: [`Bearer ${target.SERVICE_ROLE_KEY}`], apikey: [target.SERVICE_ROLE_KEY],
        'x-client-info': [manifest.sdk], accept: ['application/json'], 'accept-profile': ['public'], 'content-profile': ['public'], 'content-type': ['application/json'] }
      for (const [name, value] of headers) assert(allowed[name]?.includes(value))
      for (const name of ['authorization', 'apikey', 'x-client-info', 'content-type', 'content-profile']) assert.equal(headers.get(name), allowed[name][0])
      const rawBody = init.body; const requestBytes = Buffer.byteLength(rawBody, 'utf8'); assert(requestBytes <= manifest.caps.requestBytes)
      const request = requestSchema.parse(json(rawBody, check)); const expected = testOwnerReorderRequest(f, context.label)
      assert.deepEqual(Object.keys(request).sort(), [...requestKeys].sort())
      assert.equal(request.p_actor_id, context.actorId); assert.equal(request.p_classroom_id, expected.classroom_id)
      assert.deepEqual(request.p_test_ids, expected.test_ids)
      rpcDeadline = Date.parse(request.p_deadline); assert(rpcDeadline <= deadline && rpcDeadline > Date.now())
      assert.equal(new Date(rpcDeadline).toISOString(), request.p_deadline)
      operationBytes = requestBytes; inFlight = true; activeController = controller
      callerListener = () => controller.abort(); caller?.addEventListener('abort', callerListener, { once: true })
      timer = setTimeout(() => controller.abort(), Math.max(0, rpcDeadline - Date.now()))
      let abortReject: (reason: Error) => void = () => {}
      const aborted = new Promise<never>((_, rejectAbort) => { abortReject = rejectAbort })
      abortListener = () => abortReject(failure()); controller.signal.addEventListener('abort', abortListener, { once: true })
      const bounded = async <T>(work: () => Promise<T>) => {
        check(); const value = await Promise.race([Promise.resolve().then(() => { check(); return work() }), aborted]); check(); return value
      }
      phase = 'guard'; await bounded(guard); check()
      assert(observed.network < manifest.caps.networkRequests && observed.rpc < manifest.caps.rpcRequests)
      observed.network++; observed.rpc++; contextCalls++; observed.exchangeBytes += requestBytes; observed.totalBytes += requestBytes
      assert(observed.totalBytes <= manifest.caps.totalBytes)
      phase = 'dispatch'
      reply = await bounded(() => Promise.resolve(originalFetch(expectedUrl, { method: 'POST', headers, body: rawBody, redirect: 'error', signal: controller.signal })).then(response => {
        if (controller.signal.aborted || failed) void response.body?.cancel().catch(() => {})
        return response
      }))
      assert(reply instanceof Response && reply.status >= 200 && reply.status <= 599 && !(reply.status >= 300 && reply.status < 400))
      assert(!reply.redirected && !reply.headers.has('location')); assert(!reply.url || reply.url === expectedUrl)
      const length = reply.headers.get('content-length'); assert(length === null || /^\d+$/.test(length) && Number(length) <= manifest.caps.resultBytes)
      phase = 'decode'; assert(reply.body && !reply.body.locked && !reply.bodyUsed); reader = reply.body.getReader()
      const decoder = new TextDecoder('utf-8', { fatal: true }); let text = ''; let resultBytes = 0; let reads = 0
      for (;;) {
        assert(++reads <= manifest.caps.resultBytes + 1)
        const part = await bounded(() => reader!.read()); if (part.done) break
        resultBytes += part.value.byteLength; operationBytes += part.value.byteLength
        observed.exchangeBytes += part.value.byteLength; observed.totalBytes += part.value.byteLength
        assert(resultBytes <= manifest.caps.resultBytes && operationBytes <= manifest.caps.operationBytes && observed.totalBytes <= manifest.caps.totalBytes)
        text += decoder.decode(part.value, { stream: true }); check()
      }
      text += decoder.decode(); const value = json(text, check); assert(boundedAssignmentListJson(value, manifest.caps.resultBytes)); check()
      assert(boundedAssignmentListJson({ data: reply.ok ? value : null, error: reply.ok ? null : value, count: null, status: reply.status, statusText: reply.statusText }, manifest.caps.envelopeBytes))
      phase = 'guard'; await bounded(guard); check()
      const probe = f.privilegeProbes.find(p => p.label === context!.label)
      if (reply.ok) {
        assert.equal(reply.status, 200); assert.equal(context.expectedHTTP, 200); assert(!probe)
        const e = contextualTestReorderResultSchema.parse(value)
        const ledger = registerTestOwnerReorderWitness(f, accepted, context.label, e, { startMs: start, deadlineMs: rpcDeadline })
        pending = freeze({ caseLabel: context.label, ledger })
      } else {
        const error = errorSchema.parse(value); assert(context.expectedHTTP !== 200)
        if (probe) {
          assert.equal(error.code, '42501'); assert.equal(reply.status, 403)
          rawPrivilegeFailures++; rawPrivilegeContexts.add(probe.context)
        } else { assert.equal(error.code, `PT${context.expectedHTTP}`); assert.equal(reply.status, context.expectedHTTP) }
      }
      check(); phase = 'complete'
      return new Response(text, { status: reply.status, headers: { 'content-type': 'application/json' } })
    } catch { reject() } finally {
      clearTimeout(timer); if (callerListener) caller?.removeEventListener('abort', callerListener)
      if (abortListener) controller.signal.removeEventListener('abort', abortListener)
      controller.abort(); if (activeController === controller) activeController = undefined; inFlight = false
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock() }
      else void reply?.body?.cancel().catch(() => {})
    }
  }
  function snapshots(values: unknown[]) {
    for (const value of values) {
      assert(boundedAssignmentListJson(value, manifest.caps.snapshotBytes))
      observed.snapshots++; observed.snapshotBytes += Buffer.byteLength(JSON.stringify(value), 'utf8')
      assert(observed.snapshots <= 48 && observed.snapshotBytes <= manifest.caps.snapshotTotalBytes)
    }
  }
  function verifyEffects(before: unknown, after: unknown, publicResult?: unknown, transactionTimestamp?: string) {
    try {
      assert(!failed && context && !inFlight && !verified && phase === 'complete' && contextCalls === context.expectedRPCs)
      phase = 'effects'; snapshots([before, after]); if (previousSnapshot !== undefined) assert.deepEqual(before, previousSnapshot)
      const completed = verifyTestOwnerReorderEffects(f, before, after, context.label, pending?.ledger ?? accepted, publicResult, transactionTimestamp)
      assert(completed.every(w => w.state === 'verified'))
      accepted = completed; previousSnapshot = freeze(structuredClone(after)); verifiedContexts.push(context.label)
      // A subsequent successful execution plus complete effects proves service
      // EXECUTE was restored; caller flags cannot manufacture that evidence.
      if (context.expectedHTTP === 200 && rawPrivilegeContexts.has('254')
        && verifiedContexts.includes(f.privilegeProbes[0].label)) restoredPrivilegeContexts.add('254')
      pending = undefined; verified = true; phase = 'complete'; return accepted
    } catch { reject() }
  }
  const counts = Object.freeze({ get network() { return observed.network }, get rpc() { return observed.rpc }, get storage() { return observed.storage },
    get exchangeBytes() { return observed.exchangeBytes }, get totalBytes() { return observed.totalBytes },
    get snapshotBytes() { return observed.snapshotBytes }, get snapshots() { return observed.snapshots } })
  const evidence = Object.freeze({ get rawPrivilegeFailures() { return rawPrivilegeFailures },
    get rawPrivilegeContexts() { return Object.freeze([...rawPrivilegeContexts].sort()) },
    get restoredPrivilegeContexts() { return Object.freeze([...restoredPrivilegeContexts].sort()) } })
  return Object.freeze({ fetch: safeFetch, counts, evidence, readContext, verifyEffects,
    getPendingWitness() { if (failed || exposed || !pending) return undefined; exposed = true; return pending },
    getVerifiedLedger() { return failed ? freeze([] as TestOwnerReorderWitness[]) : accepted },
    completion() {
      const labels = [...f.privilegeProbes, ...f.cases].map(c => c.label)
      const inventory = [...f.privilegeProbes, ...f.cases].map(c => ({ kind: c.expectedHTTP === 200 ? 'reorder' : 'denial', caseLabel: c.label, state: 'verified' }))
      const expectedRequests = [...f.privilegeProbes, ...f.cases].reduce((sum, c) => sum + c.expectedRPCs, 0)
      return freeze({ verifiedContextLabels: [...verifiedContexts],
        complete: !failed && !inFlight && verified && !pending && isDeepStrictEqual(verifiedContexts, labels)
          && isDeepStrictEqual(accepted.map(w => ({ kind: w.kind, caseLabel: w.caseLabel, state: w.state })), inventory)
          && observed.network === expectedRequests && observed.rpc === expectedRequests && observed.storage === 0
          && observed.snapshots === 2 * labels.length && rawPrivilegeFailures === f.privilegeProbes.length
          && isDeepStrictEqual([...rawPrivilegeContexts].sort(), f.privilegeProbes.map(p => p.context).sort())
          && isDeepStrictEqual([...restoredPrivilegeContexts].sort(), f.privilegeProbes.map(p => p.context).sort()) })
    },
    diagnostic: () => `DIAG test-owner-reorder transport phase=${phase} requests=${observed.network} rpc=${observed.rpc} storage=${observed.storage} snapshots=${observed.snapshots} raw-privilege=${rawPrivilegeFailures}.\n`,
  })
}
