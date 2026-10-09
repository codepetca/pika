/** Inert sealed installed-SDK adapter. No CLI, SQL, provider or native effects
 * on import. The adopter supplies complete guards and real captured snapshots. */
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { boundedAssignmentListJson } from '../src/lib/validations/contextual-assignment-list-read'
import { contextualTestDraftGetSnapshotSchema } from '../src/lib/validations/contextual-test-draft-get'
import { contextualTestPublicationResultSchema } from '../src/lib/validations/contextual-test-publication'
import { validateTestDraftContent } from '../src/lib/validations/assessment-drafts'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import {
  TEST_OWNER_PUBLICATION_CAPS, registerTestOwnerPublicationWitness, verifyTestOwnerPublicationEffects,
  verifyTestOwnerPublicationTransitionEffects, type TestOwnerPublicationFixture, type TestOwnerPublicationWitness,
} from './contextual-test-publication-proof-fixture'

const API = 'http://127.0.0.1:54331'
const SNAPSHOT = '/rest/v1/rpc/snapshot_test_draft_for_owner_v1'
const PUBLICATION = '/rest/v1/rpc/publish_test_from_draft_for_owner_v1'
const snapshotKeys = Object.freeze(['p_actor_id', 'p_test_id', 'p_deadline'])
const publicationKeys = Object.freeze(['p_actor_id', 'p_test_id', 'p_classroom_id', 'p_expected_authoring_sha256', 'p_expected_draft_version', 'p_validated_content', 'p_deadline'])
const failure = () => new Error('Test owner publication proof transport rejected; private details withheld')
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export function testOwnerPublicationRequestManifest(f: TestOwnerPublicationFixture) {
  return freeze({ version: 1 as const, fixtureTag: f.tag, origin: API, method: 'POST', sdk: 'supabase-js-node/2.93.3',
    paths: [SNAPSHOT, PUBLICATION], snapshotKeys, publicationKeys, caps: TEST_OWNER_PUBLICATION_CAPS,
    cases: f.cases, privilegeProbes: f.privilegeProbes, nativeVerified: false as const })
}
/** Grammar is validated once, then bounded lexical scanning rejects duplicate
 * decoded keys at every depth without treating strings as structural tokens. */
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
const snapshotRequest = z.object({ p_actor_id: uuid, p_test_id: uuid, p_deadline: timestamp }).strict()
const publicationRequest = snapshotRequest.extend({ p_classroom_id: uuid, p_expected_authoring_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  p_expected_draft_version: z.number().int().positive().max(2147483647),
  p_validated_content: z.unknown().refine(value => boundedAssignmentListJson(value, TEST_OWNER_PUBLICATION_CAPS.contentBytes)).pipe(z.json()),
}).strict()
const errorSchema = z.object({ code: z.enum(['PT400', 'PT403', 'PT404', 'PT409', 'PT503', '42501', '55000', '55P03', '40P01', '40001', 'PGRST202', '42883', '23502', '23503', '23505', '23514', 'XX000', '57014']),
  message: z.string().max(16384), details: z.string().max(16384).nullable().optional(), hint: z.string().max(16384).nullable().optional(),
}).strict()
type Scenario = TestOwnerPublicationFixture['cases'][number] | TestOwnerPublicationFixture['privilegeProbes'][number]
type Pending = Readonly<{ caseLabel: string; ledger: TestOwnerPublicationWitness[] }>
type TransitionEvidence = Parameters<typeof verifyTestOwnerPublicationTransitionEffects>[6]

/** All counters and issued-ledger state are private and monotonic. Only the
 * closed full effects/transition sinks can promote accepted fixture evidence. */
export function createTestOwnerPublicationProofTransport(f: TestOwnerPublicationFixture, rawTarget: unknown, projectId: string,
  originalFetch: typeof fetch, guard: () => Promise<void>) {
  let target: ReturnType<typeof validateAssignmentListProofTarget>
  try {
    assert.match(f.tag, /^testownerpublication_[a-f0-9]{12}$/); assert(Object.isFrozen(f))
    assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
    assert(typeof originalFetch === 'function' && typeof guard === 'function')
    target = freeze(validateAssignmentListProofTarget(rawTarget, projectId)); assert.equal(target.API_URL, API)
  } catch { throw failure() }
  const manifest = testOwnerPublicationRequestManifest(f)
  const observed = { network: 0, rpc: 0, storage: 0, exchangeBytes: 0, totalBytes: 0 }
  let accepted: TestOwnerPublicationWitness[] = freeze([]); let pending: Pending | undefined; let exposed = false
  let previousSnapshot: unknown; let context: Scenario | undefined; let start = 0; let deadline = 0; let operationDeadline = 0
  let contextCalls = 0; let contextBytes = 0; let verified = true; let inFlight = false; let failed = false
  let activeController: AbortController | undefined
  let source: z.infer<typeof contextualTestDraftGetSnapshotSchema> | undefined
  let rawPrivilegeFailures = 0
  const rawPrivilegeContexts = new Set<string>(); const seen = new Set<string>(); const transitions = new Set<string>()
  const verifiedContexts: string[] = []
  let phase: 'idle' | 'context' | 'validate' | 'guard' | 'dispatch' | 'decode' | 'snapshot' | 'complete' | 'effects' | 'transition' | 'failed' = 'idle'
  function reject(): never { failed = true; activeController?.abort(); pending = undefined; phase = 'failed'; throw failure() }
  function readContext(caseLabel: string, startTime = Date.now()) {
    try {
      assert(!failed && !inFlight && verified && !pending && !seen.has(caseLabel))
      const found = [...manifest.cases, ...manifest.privilegeProbes].find(c => c.label === caseLabel); assert(found)
      assert(Number.isSafeInteger(startTime) && startTime <= Date.now() && Date.now() < startTime + manifest.caps.requestMs)
      context = found; start = startTime; deadline = startTime + manifest.caps.requestMs; operationDeadline = 0
      contextCalls = 0; contextBytes = 0; source = undefined; verified = false; exposed = false; phase = 'context'; seen.add(caseLabel)
    } catch { reject() }
  }
  const safeFetch: typeof fetch = async (resource, init) => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined; let reply: Response | undefined
    let timer: ReturnType<typeof setTimeout> | undefined; let caller: AbortSignal | undefined
    let callerListener: (() => void) | undefined; let abortListener: (() => void) | undefined
    const controller = new AbortController(); let rpcDeadline = 0; let operationBytes = 0
    const check = () => assert(!failed && !controller.signal.aborted && !caller?.aborted && Date.now() < (rpcDeadline || deadline))
    try {
      const expectedPhase = contextCalls === 0 ? 'context' : 'snapshot'
      assert(!failed && context && !inFlight && phase === expectedPhase && contextCalls < context.expectedRPCs)
      phase = 'validate'; check()
      assert(!(resource instanceof Request)); assert(typeof resource === 'string' || resource instanceof URL)
      const expectedPath = contextCalls === 0 ? SNAPSHOT : PUBLICATION; const expectedUrl = API + expectedPath
      const url = new URL(String(resource)); assert.equal(url.href, expectedUrl); assert.equal(String(resource), expectedUrl)
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
      const rawBody = init.body; const requestBytes = Buffer.byteLength(rawBody, 'utf8')
      assert(requestBytes <= manifest.caps.requestBytes)
      const rawRequest = json(rawBody, check)
      const body = snapshotRequest.safeParse(rawRequest)
      const final = contextCalls === 1 ? publicationRequest.parse(rawRequest) : undefined
      if (!final) assert(body.success)
      const request = final ?? (body.success ? body.data : undefined); assert(request)
      assert.deepEqual(Object.keys(request).sort(), [...(final ? publicationKeys : snapshotKeys)].sort())
      assert.equal(request.p_actor_id, context.actorId); assert.equal(request.p_test_id, context.testId)
      rpcDeadline = Date.parse(request.p_deadline); assert(rpcDeadline <= deadline && rpcDeadline > Date.now())
      assert.equal(new Date(rpcDeadline).toISOString(), request.p_deadline)
      if (final) {
        assert(source?.draft); assert.equal(rpcDeadline, operationDeadline)
        assert.equal(final.p_classroom_id, source.classroom.id); assert.equal(final.p_expected_authoring_sha256, source.source_sha256)
        assert.equal(final.p_expected_draft_version, source.draft.version); assert.equal(final.p_expected_draft_version, context.input.draft_version)
        const canonical = validateTestDraftContent(source.draft.content, { requirePortableQuestionIdentity: true }); assert(canonical.valid)
        assert(isDeepStrictEqual(source.draft.content, canonical.value)); assert(isDeepStrictEqual(final.p_validated_content, canonical.value))
      } else operationDeadline = rpcDeadline
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
      contextBytes += requestBytes; assert(contextBytes <= manifest.caps.operationBytes && observed.totalBytes <= manifest.caps.totalBytes)
      phase = 'dispatch'
      reply = await bounded(() => Promise.resolve(originalFetch(expectedUrl, { method: 'POST', headers, body: rawBody, redirect: 'error', signal: controller.signal })).then(response => {
        if (controller.signal.aborted || failed) void response.body?.cancel().catch(() => {})
        return response
      }))
      assert(reply instanceof Response && reply.status >= 200 && reply.status <= 599 && !(reply.status >= 300 && reply.status < 400))
      assert(!reply.redirected && !reply.headers.has('location')); assert(!reply.url || reply.url === expectedUrl)
      const length = reply.headers.get('content-length'); assert(length === null || /^\d+$/.test(length) && Number(length) <= manifest.caps.resultBytes)
      phase = 'decode'; assert(reply.body); reader = reply.body.getReader()
      const decoder = new TextDecoder('utf-8', { fatal: true }); let text = ''; let resultBytes = 0; let reads = 0
      for (;;) {
        assert(++reads <= manifest.caps.resultBytes + 1)
        const part = await bounded(() => reader!.read()); if (part.done) break
        resultBytes += part.value.byteLength; operationBytes += part.value.byteLength; observed.exchangeBytes += part.value.byteLength; observed.totalBytes += part.value.byteLength
        contextBytes += part.value.byteLength
        assert(resultBytes <= manifest.caps.resultBytes && operationBytes <= manifest.caps.operationBytes && contextBytes <= manifest.caps.operationBytes && observed.totalBytes <= manifest.caps.totalBytes)
        text += decoder.decode(part.value, { stream: true }); check()
      }
      text += decoder.decode(); const value = json(text, check); assert(boundedAssignmentListJson(value, manifest.caps.resultBytes)); check()
      phase = 'guard'; await bounded(guard); check()
      const plannedTest = f.tests.find(t => t.id === context!.testId); assert(plannedTest)
      const plannedClass = f.classes.find(c => c.id === plannedTest.classroom_id); assert(plannedClass)
      const probe = f.privilegeProbes.find(p => p.label === context!.label)
      if (!final && !probe) {
        // 247 denies owner/archived Class in SQL; retirement, missing Draft,
        // stale version and noncanonical content are local helper decisions.
        assert.equal(reply.ok, plannedClass.owner === context.actorId && !plannedClass.archived)
      }
      if (reply.ok) {
        assert.equal(reply.status, 200)
        assert(value && typeof value === 'object' && 'test' in value && boundedAssignmentListJson(value.test, manifest.caps.rowBytes))
        if (!final) {
          assert('draft' in value && (value.draft === null || boundedAssignmentListJson(value.draft, manifest.caps.rowBytes)))
          assert('questions' in value && Array.isArray(value.questions) && value.questions.length <= 10000)
          for (const question of value.questions) assert(boundedAssignmentListJson(question, manifest.caps.rowBytes))
          source = freeze(contextualTestDraftGetSnapshotSchema.parse(value))
          assert.equal(source.actor_id, context.actorId); assert.equal(source.test.id, context.testId)
          assert.equal(source.classroom.id, plannedTest.classroom_id); assert.equal(source.test.classroom_id, plannedTest.classroom_id)
          assert.equal(source.classroom.teacher_id, plannedClass.owner); assert.equal(source.classroom.archived_at, null)
          if (source.draft) { assert.equal(source.draft.assessment_id, context.testId); assert.equal(source.draft.classroom_id, plannedTest.classroom_id) }
          assert.equal(source.question_count, source.questions.length)
          assert.equal(new Set(source.questions.map(q => q.id)).size, source.questions.length)
          for (let i = 0; i < source.questions.length; i++) {
            const q = source.questions[i]; const previous = source.questions[i - 1]
            assert.equal(q.test_id, context.testId); assert(!previous || previous.position < q.position || previous.position === q.position && previous.id < q.id)
          }
        } else {
          assert.equal(context.expectedHTTP, 200); assert(source?.draft)
          const e = contextualTestPublicationResultSchema.parse(value)
          assert.equal(e.actor_id, context.actorId); assert.equal(e.test_id, context.testId); assert.equal(e.classroom_id, source.classroom.id)
          assert.equal(e.source_sha256, source.source_sha256); assert.equal(e.draft_version, source.draft.version)
          const ledger = registerTestOwnerPublicationWitness(f, accepted, context.label, e, { startMs: start, deadlineMs: rpcDeadline }, source.source_sha256)
          pending = freeze({ caseLabel: context.label, ledger })
        }
      } else {
        const error = errorSchema.parse(value)
        assert(context.expectedHTTP !== 200)
        if (probe) {
          assert.equal(contextCalls, probe.expectedRPCs); assert.equal(error.code, '42501'); assert.equal(reply.status, 403)
          rawPrivilegeFailures++; rawPrivilegeContexts.add(probe.context)
        } else {
          assert.equal(error.code, `PT${context.expectedHTTP}`); assert.equal(reply.status, context.expectedHTTP)
        }
      }
      check(); phase = contextCalls === context.expectedRPCs ? 'complete' : 'snapshot'
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
      assert(boundedAssignmentListJson(value, manifest.caps.snapshotBytes)); observed.totalBytes += Buffer.byteLength(JSON.stringify(value), 'utf8')
      assert(observed.totalBytes <= manifest.caps.totalBytes)
    }
  }
  function verifyEffects(before: unknown, after: unknown, publicResult?: unknown, effectTimestamp?: string) {
    try {
      assert(!failed && context && !inFlight && !verified && phase === 'complete' && contextCalls === context.expectedRPCs)
      phase = 'effects'; snapshots([before, after]); if (previousSnapshot !== undefined) assert.deepEqual(before, previousSnapshot)
      accepted = verifyTestOwnerPublicationEffects(f, before, after, context.label, pending?.ledger ?? accepted, publicResult, effectTimestamp)
      previousSnapshot = freeze(structuredClone(after)); verifiedContexts.push(context.label); pending = undefined; verified = true; phase = 'complete'
      return accepted
    } catch { reject() }
  }
  function verifyTransitionEffects(before: unknown, writerCommit: unknown, after: unknown, label: string, evidence: TransitionEvidence) {
    try {
      assert(!failed && !inFlight && verified && !pending && !transitions.has(label) && f.transitions.some(t => t.label === label))
      phase = 'transition'; snapshots([before, writerCommit, after]); if (previousSnapshot !== undefined) assert.deepEqual(before, previousSnapshot)
      accepted = verifyTestOwnerPublicationTransitionEffects(f, before, writerCommit, after, label, accepted, evidence)
      previousSnapshot = freeze(structuredClone(after)); transitions.add(label); phase = 'complete'
      return accepted
    } catch { reject() }
  }
  const counts = Object.freeze({ get network() { return observed.network }, get rpc() { return observed.rpc }, get storage() { return observed.storage },
    get exchangeBytes() { return observed.exchangeBytes }, get totalBytes() { return observed.totalBytes } })
  const evidence = Object.freeze({ get rawPrivilegeFailures() { return rawPrivilegeFailures }, get rawPrivilegeContexts() { return Object.freeze([...rawPrivilegeContexts].sort()) } })
  return Object.freeze({ target, fetch: safeFetch, counts, evidence, readContext, verifyEffects, verifyTransitionEffects,
    getPendingWitness() { if (failed || exposed || !pending) return undefined; exposed = true; return pending },
    getVerifiedLedger() { return accepted },
    completion() {
      const labels = [...f.privilegeProbes, ...f.cases].map(c => c.label)
      const transitionLabels = f.transitions.map(t => t.label)
      const actualTransitions = [...transitions]
      const inventory = [...f.transitions.map(t => ({ kind: 'transition', caseLabel: t.label, state: 'verified' })),
        ...f.cases.filter(c => c.expectedHTTP === 200).map(c => ({ kind: 'publication', caseLabel: c.label, state: 'verified' }))]
      return freeze({ verifiedContextLabels: [...verifiedContexts], verifiedTransitionLabels: actualTransitions,
        complete: !failed && !inFlight && verified && !pending && isDeepStrictEqual(verifiedContexts, labels)
          && isDeepStrictEqual(actualTransitions, transitionLabels) && accepted.length === 8 && accepted.every(w => w.state === 'verified')
          && isDeepStrictEqual(accepted.map(w => ({ kind: w.kind, caseLabel: w.caseLabel, state: w.state })), inventory)
          && accepted.filter(w => w.kind === 'publication').length === 3 && accepted.filter(w => w.kind === 'transition').length === 5
          && observed.network === 20 && observed.rpc === 20 && rawPrivilegeFailures === 4 && rawPrivilegeContexts.size === 4 })
    },
    diagnostic: () => `DIAG test-owner-publication transport phase=${phase} requests=${observed.network} rpc=${observed.rpc} storage=${observed.storage} raw-privilege=${rawPrivilegeFailures}.\n`,
  })
}
