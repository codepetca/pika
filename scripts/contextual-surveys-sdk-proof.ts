/** Finite Survey263 SDK transport and pure committed graph oracles.
 * Import/client preparation has no IO; root owns native invocation and cleanup. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '../src/types/database'
import type { SurveyNativeFixture } from './contextual-surveys-native-contracts'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { Survey263UnjoinedChildError } from './contextual-assignment-list-proof-platform'
import { SURVEY_SDK_PHASE_MS } from './contextual-surveys-sdk-contracts'
import { contextualSurveyDetailSchema, contextualSurveyListSchema, contextualSurveyMemberResultsSchema,
  contextualSurveyOwnerResultsSchema, contextualSurveyMutationSchema, contextualSurveyQuestionMutationSchema,
  contextualSurveyRespondSchema, contextualSurveyDeleteSchema } from '../src/lib/validations/contextual-surveys'

const origin = 'http://127.0.0.1:54331'
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const fail = () => new Error('Survey SDK proof refused; private details withheld')
class SurveySdkBoundaryError extends Error {
  constructor(readonly reason: 'sdk-deadline' | 'caller-abort') { super('Survey SDK boundary refused') }
}
const uuid = z.string().uuid(), stamp = z.string().datetime({ offset: true })
const question = contextualSurveyQuestionMutationSchema.shape.question.extend({ artifact_id: uuid,
  source_artifact_id: uuid.nullable(), source_blueprint_version_id: uuid.nullable() }).strict()
const survey = contextualSurveyMutationSchema.shape.survey.extend({ artifact_id: uuid, source_artifact_id: uuid.nullable(),
  source_blueprint_version_id: uuid.nullable(), blueprint_archived_at: stamp.nullable() }).strict()
const errorReply = z.object({ code: z.literal('PT403'), message: z.string().max(16384),
  details: z.string().max(16384).nullable(), hint: z.string().max(16384).nullable() }).strict()
const names = Object.freeze(['get_survey_for_owner_v1', 'get_surveys_for_owner_v1', 'get_survey_for_member_v1',
  'get_survey_for_member_v1', 'get_survey_for_member_v1', 'get_surveys_for_member_v1', 'respond_to_survey_for_member_v1',
  'get_survey_results_for_member_v1', 'get_survey_results_for_owner_v1', 'update_survey_for_owner_v1',
  'create_survey_question_for_owner_v1', 'update_survey_question_for_owner_v1', 'delete_survey_question_for_owner_v1', 'delete_survey_for_owner_v1'])
export const SURVEY_SDK_PROOF_CAPS = Object.freeze({ calls: 16, expectedCalls: 14, totalMs: SURVEY_SDK_PHASE_MS.legacy,
  requestBytes: 4096, responseBytes: 8 * 1024 * 1024, totalBytes: 14 * (4096 + 8 * 1024 * 1024) })
export const SURVEY_269_COMPONENT_SDK_CAPS = Object.freeze({ ...SURVEY_SDK_PROOF_CAPS, totalMs: SURVEY_SDK_PHASE_MS.component269 })
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
/** Duplicate JSON keys cannot hide substituted SDK metadata. */
function parse(text: string): unknown {
  const parsed: unknown = JSON.parse(text), stack: Array<Set<string> | null> = []
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '{' || char === '[') stack.push(char === '{' ? new Set() : null)
    else if (char === '}' || char === ']') stack.pop()
    else if (char === '"') {
      const start = index++
      for (; index < text.length; index++) { if (text[index] === '\\') index++; else if (text[index] === '"') break }
      let next = index + 1; while (next < text.length && /\s/.test(text[next])) next++
      if (text[next] === ':') { const key: unknown = JSON.parse(text.slice(start, index + 1)), keys = stack.at(-1)
        assert(typeof key === 'string' && keys && !keys.has(key)); keys.add(key) }
    }
  }
  return parsed
}
export function surveySdkProofManifest(f: SurveyNativeFixture) {
  return sdkProofManifest(f, SURVEY_SDK_PROOF_CAPS)
}
export function survey269ComponentSdkProofManifest(f: SurveyNativeFixture) {
  return sdkProofManifest(f, SURVEY_269_COMPONENT_SDK_CAPS)
}
function sdkProofManifest(f: SurveyNativeFixture, caps: typeof SURVEY_SDK_PROOF_CAPS | typeof SURVEY_269_COMPONENT_SDK_CAPS) {
  assert(Object.isFrozen(f) && Object.isFrozen(f.question))
  return freeze({ version: 1, projectId: f.projectId, origin, method: 'POST', rpcNames: names, fixtureSha256: hash(JSON.stringify(f)),
    caps, executionEnabled: false as const, nativeVerified: false as const })
}
export function createSurveySdkProofTransport(f: SurveyNativeFixture, rawTarget: unknown, original: typeof fetch, guard: () => Promise<void>,
  chargeComponentBytes?: (bytes: number) => void, componentSettlement?: Readonly<{ cleanupDeadline: number }>,chargeRemainingRequest?:()=>void) {
  assert(chargeRemainingRequest===undefined||componentSettlement!==undefined)
  if (componentSettlement) {
    assert.deepEqual(Object.keys(componentSettlement), ['cleanupDeadline'])
    assert(Number.isSafeInteger(componentSettlement.cleanupDeadline) && componentSettlement.cleanupDeadline > Date.now())
  }
  const cleanupDeadline = componentSettlement?.cleanupDeadline
  type PendingKind = 'guard' | 'http' | 'body' | 'cancel'
  const pending = new Map<Promise<unknown>, PendingKind>()
  let poison: Survey263UnjoinedChildError | undefined
  let poisonKind = 'none'
  function owned<T>(operation: Promise<T>, kind: PendingKind): Promise<T> {
    if (cleanupDeadline === undefined) return operation
    pending.set(operation, kind)
    void operation.then(() => pending.delete(operation), error => { pending.delete(operation); if (kind === 'cancel' || error instanceof Survey263UnjoinedChildError) {poison ??= error instanceof Survey263UnjoinedChildError ? error : new Survey263UnjoinedChildError();if(poisonKind==='none')poisonKind=kind} })
    return operation
  }
  async function settle() {
    if (cleanupDeadline === undefined) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      assert(Date.now() < cleanupDeadline)
      await Promise.race([(async () => {while (pending.size) await Promise.allSettled([...pending.keys()])})(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => {poisonKind=[...new Set(pending.values())].sort().join('+') || poisonKind;reject(poison ??= new Survey263UnjoinedChildError())}, cleanupDeadline - Date.now())
      })])
    } catch (error) { poison ??= error instanceof Survey263UnjoinedChildError ? error : new Survey263UnjoinedChildError() }
    finally { if (timer) clearTimeout(timer) }
    if (poison) throw poison
  }
  const manifest = cleanupDeadline === undefined ? surveySdkProofManifest(f) : survey269ComponentSdkProofManifest(f), manifestSha256 = hash(JSON.stringify(manifest))
  const caps = manifest.caps
  const target = validateAssignmentListProofTarget(rawTarget, f.projectId)
  let deadline: number | undefined, startedAt: number | undefined, failed = false, inFlight = false, calls = 0, bytes = 0, index = 0
  let memberQuestions: z.infer<typeof question>[] | undefined, created: z.infer<typeof question> | undefined
  const receipts: Array<{ index: number; requestSha256: string; responseSha256: string; responseBytes: number }> = []
  type Stage = 'idle' | 'request' | 'guard-before' | 'exchange' | 'reply' | 'guard-after' | 'complete' | 'failed'
  let stage: Stage = 'idle'
  let firstFailure: Readonly<{ stage: Stage; reason: 'sdk-deadline' | 'caller-abort' | 'operation'; elapsedMs: number; remainingMs: number; completedCalls: number }> | undefined
  function rememberFailure(error: unknown) {
    if (cleanupDeadline !== undefined) firstFailure ??= Object.freeze({ stage, reason: error instanceof SurveySdkBoundaryError ? error.reason : 'operation',
      elapsedMs: Math.min(900000, Math.max(0, Date.now() - (startedAt ?? Date.now()))), remainingMs: Math.min(caps.totalMs, Math.max(0, (deadline ?? Date.now()) - Date.now())), completedCalls: index })
  }
  const owner = f.actors[0].id, member = f.actors[1].id, sid = f.surveys[0].id, cid = f.classes[0].id
  function start(rootDeadline: number) {
    assert(deadline === undefined && !failed && Number.isSafeInteger(rootDeadline) && rootDeadline > Date.now())
    deadline = Math.min(rootDeadline, Date.now() + caps.totalMs)
    startedAt = Date.now()
  }
  function expected() {
    const identity = { p_actor_id: index === 3 ? f.actors[2].id : [4, 5, 6, 7].includes(index) ? member : owner, p_survey_id: sid }
    if (index === 1 || index === 5) return { p_actor_id: index === 1 ? owner : member, p_classroom_id: cid }
    if (index === 6) { assert(memberQuestions); return { ...identity, p_classroom_id: cid, p_expected_questions: memberQuestions,
      p_responses: { [f.question.id]: { question_type: 'short_text', response_text: 'SDK response' } } } }
    if (index === 9) return { ...identity, p_patch: { title: 'SDK renamed' } }
    if (index === 10) return { ...identity, p_question: { question_type: 'short_text', question_text: 'Added?', options: [], response_max_chars: 500 } }
    if (index === 11) { assert(created); return { ...identity, p_question_id: created.id, p_expected_question: created,
      p_question: { question_type: 'link', question_text: 'URL?', options: [], response_max_chars: 2048, position: created.position } } }
    if (index === 12) { assert(created); return { ...identity, p_question_id: created.id } }
    return identity
  }
  function validateReply(raw: unknown, status: number) {
    if (index === 2 || index === 3) { assert.equal(status, 403); errorReply.parse(raw); return }
    assert.equal(status, 200)
    if (index === 0 || index === 4) {
      const decoded = contextualSurveyDetailSchema.parse(raw)
      assert.equal(decoded.classroom.id, cid); assert.equal(decoded.classroom.teacher_id, owner); assert.equal(decoded.classroom.archived_at, null)
      const row = survey.parse(decoded.survey); assert.equal(row.id, sid); assert.equal(row.classroom_id, cid); assert.equal(row.created_by, owner)
      assert.equal(row.status, 'active'); assert.equal(row.show_results, true); assert.equal(row.dynamic_responses, false)
      assert.equal(decoded.responses.length, 0); assert.equal(decoded.questions.length, 1)
      const questions = decoded.questions.map(value => question.parse(value)); assert(isDeepStrictEqual(questions[0], f.question))
      if (index === 4) memberQuestions = questions
    } else if (index === 1 || index === 5) {
      const decoded = contextualSurveyListSchema.parse(raw)
      assert.equal(decoded.classroom.id, cid); assert.equal(decoded.classroom.teacher_id, owner)
      assert.deepEqual(decoded.surveys.map(row => row.id).sort(), [sid, f.surveys[2].id].sort())
    } else if (index === 6) assert(isDeepStrictEqual(contextualSurveyRespondSchema.parse(raw), { success: true, updated: false }))
    else if (index === 7 || index === 8) {
      const decoded = index === 7 ? contextualSurveyMemberResultsSchema.parse(raw) : contextualSurveyOwnerResultsSchema.parse(raw)
      assert.equal(decoded.classroom.id, cid); assert.equal(decoded.survey.id, sid); assert.equal(decoded.results.length, 1)
      assert.equal(decoded.results[0].question_id, f.question.id); assert.equal(decoded.results[0].responses.length, 1)
      assert.equal(decoded.results[0].question_type, 'short_text'); assert.equal(decoded.results[0].question_text, f.question.question_text)
      assert.equal(decoded.results[0].total_responses, 1); assert.equal(decoded.results[0].options.length, 0); assert.equal(decoded.results[0].counts.length, 0)
      assert.equal(decoded.results[0].responses[0].response_text, 'SDK response')
      if (index === 8) { const ownerResult = contextualSurveyOwnerResultsSchema.parse(raw)
        assert.equal(ownerResult.stats.total_students, 2); assert.equal(ownerResult.stats.responded, 1)
        assert.equal(ownerResult.responders.length, 1); assert.equal(ownerResult.responders[0].student_id, member)
        assert.equal(ownerResult.responders[0].email, f.actors[1].email)
        assert.equal(ownerResult.results[0].responses[0].student_id, member)
        assert.equal(ownerResult.results[0].responses[0].email, f.actors[1].email) }
    } else if (index === 9) {
      const row = survey.parse(contextualSurveyMutationSchema.parse(raw).survey)
      assert.equal(row.id, sid); assert.equal(row.classroom_id, cid); assert.equal(row.created_by, owner); assert.equal(row.title, 'SDK renamed')
    } else if (index === 10 || index === 11) {
      const row = question.parse(contextualSurveyQuestionMutationSchema.parse(raw).question)
      assert.equal(row.survey_id, sid); assert.equal(row.source_artifact_id, null); assert.equal(row.source_blueprint_version_id, null)
      if (index === 10) {
        assert(!f.allocatedIds.includes(row.id) && !f.allocatedIds.includes(row.artifact_id)); assert.notEqual(row.id, row.artifact_id)
        assert.equal(row.position, 1); assert.equal(row.question_type, 'short_text'); assert.equal(row.question_text, 'Added?'); assert.equal(row.response_max_chars, 500)
        assert.equal(row.options.length, 0); created = row
      } else { assert(created); assert.equal(row.id, created.id); assert.equal(row.artifact_id, created.artifact_id)
        assert.equal(row.created_at, created.created_at); assert.equal(row.position, created.position); assert.equal(row.question_type, 'link')
        assert.equal(row.question_text, 'URL?'); assert.equal(row.response_max_chars, 2048); assert.equal(row.options.length, 0) }
    } else contextualSurveyDeleteSchema.parse(raw)
  }
  const safeFetch: typeof fetch = async (resource, init) => {
    const controller = new AbortController(), caller = init?.signal
    let timer: ReturnType<typeof setTimeout> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, response: Response | undefined
    let abortReason: 'sdk-deadline' | 'caller-abort' | undefined
    const abort = () => { abortReason ??= 'caller-abort'; controller.abort() }
    const check = () => {
      if (cleanupDeadline !== undefined) {
        if (deadline !== undefined && Date.now() >= deadline) throw new SurveySdkBoundaryError('sdk-deadline')
        if (controller.signal.aborted || caller?.aborted) throw new SurveySdkBoundaryError(abortReason ?? 'caller-abort')
      }
      assert(!failed && deadline !== undefined && Date.now() < deadline && !controller.signal.aborted && !caller?.aborted)
    }
    try {
      check(); assert(!inFlight && index < names.length); inFlight = true; stage = 'request'
      assert(!(resource instanceof Request)); assert.equal(String(resource), `${origin}/rest/v1/rpc/${names[index]}`)
      assert(init && init.method === 'POST' && typeof init.body === 'string')
      assert(Object.keys(init).every(key => ['method', 'headers', 'body', 'signal', 'redirect'].includes(key)))
      assert(init.redirect === undefined || init.redirect === 'error')
      const headers = new Headers(init.headers), allowed: Record<string, string> = {
        authorization: `Bearer ${target.SERVICE_ROLE_KEY}`, apikey: target.SERVICE_ROLE_KEY,
        'x-client-info': 'supabase-js-node/2.93.3', 'content-type': 'application/json', accept: 'application/json',
        'accept-profile': 'public', 'content-profile': 'public',
      }
      for (const [name, value] of headers) assert.equal(value, allowed[name])
      for (const name of ['authorization', 'apikey', 'x-client-info', 'content-type']) assert.equal(headers.get(name), allowed[name])
      assert(Buffer.byteLength(init.body) <= SURVEY_SDK_PROOF_CAPS.requestBytes)
      assert.equal(init.body, JSON.stringify(expected()))
      caller?.addEventListener('abort', abort, { once: true }); timer = setTimeout(() => {abortReason ??= 'sdk-deadline';controller.abort()}, Math.max(0, deadline! - Date.now()))
      let rejectAbort: (error: Error) => void = () => {}
      const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
      controller.signal.addEventListener('abort', () => rejectAbort(cleanupDeadline !== undefined && deadline !== undefined && Date.now() >= deadline
        ? new SurveySdkBoundaryError('sdk-deadline') : cleanupDeadline !== undefined && abortReason ? new SurveySdkBoundaryError(abortReason) : fail()), { once: true })
      const bounded = async <T>(run: () => Promise<T>, kind: PendingKind) => { check(); const operation = owned(Promise.resolve().then(() => {if (cleanupDeadline !== undefined) check();return run()}), kind); const value = await Promise.race([operation, aborted]); check(); return value }
      stage = 'guard-before'; await bounded(guard, 'guard'); check(); assert(++calls <= SURVEY_SDK_PROOF_CAPS.calls)
      bytes += Buffer.byteLength(init.body); assert(bytes <= SURVEY_SDK_PROOF_CAPS.totalBytes)
      chargeComponentBytes?.(Buffer.byteLength(init.body))
      stage = 'exchange'; response = await bounded(async () => {
        chargeRemainingRequest?.()
        const received = await original(String(resource), { method: 'POST', headers, body: init.body, redirect: 'error', signal: controller.signal })
        if(cleanupDeadline!==undefined)response=received
        if (cleanupDeadline !== undefined && controller.signal.aborted) {
          try { await received.body?.cancel() } catch { throw new Survey263UnjoinedChildError() }
        }
        return received
      }, 'http')
      stage = 'reply'; assert(response instanceof Response && !response.redirected && !response.headers.has('location') && response.body)
      assert(!response.url || response.url === String(resource)); assert(response.headers.get('content-type')?.startsWith('application/json'))
      const declared = response.headers.get('content-length')
      assert(declared === null || /^\d+$/.test(declared) && Number(declared) <= SURVEY_SDK_PROOF_CAPS.responseBytes)
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let count = 0, reads = 0
      for (;;) { assert(++reads <= SURVEY_SDK_PROOF_CAPS.responseBytes + 1); const part = await bounded(async() => {
        const part=await reader!.read()
        if(cleanupDeadline!==undefined&&!part.done){count+=part.value.byteLength;bytes+=part.value.byteLength;chargeComponentBytes?.(part.value.byteLength)}
        return part
      }, 'body'); if (part.done) break
        if(cleanupDeadline===undefined){count += part.value.byteLength; bytes += part.value.byteLength;chargeComponentBytes?.(part.value.byteLength)}
        assert(count <= SURVEY_SDK_PROOF_CAPS.responseBytes && bytes <= SURVEY_SDK_PROOF_CAPS.totalBytes); chunks.push(part.value) }
      const body = Buffer.concat(chunks), text = new TextDecoder('utf-8', { fatal: true }).decode(body)
      validateReply(parse(text), response.status)
      stage = 'guard-after'; await bounded(guard, 'guard'); check()
      receipts.push({ index, requestSha256: hash(init.body), responseSha256: hash(body), responseBytes: count }); index++
      stage = index === names.length ? 'complete' : 'idle'
      return new Response(body, { status: response.status, headers: response.headers })
    } catch (error) {
      rememberFailure(error)
      failed = true; stage = 'failed'; controller.abort(); if (cleanupDeadline !== undefined && error instanceof Survey263UnjoinedChildError) {poison ??= error;throw poison} throw fail()
    }
    finally { if (timer) clearTimeout(timer); caller?.removeEventListener('abort', abort)
      // Request cancellation without letting an untrusted stream's cancel hook
      // extend the fixed deadline. Root still owns exact SQL/backend settlement.
      if (failed) { const cancelled = reader ? reader.cancel() : response?.body?.cancel();
        if (cancelled) {const joined = owned(cancelled, 'cancel');void joined.catch(() => {})} }
      if (reader) { try { reader.releaseLock() } catch { /* a cancelled read is already refused */ } }
      inFlight = false }
  }
  const client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: safeFetch },
  })
  return Object.freeze({ manifest, manifestSha256, client, fetch: safeFetch, start, settle,
    complete() {
      try {
        if (cleanupDeadline !== undefined && deadline !== undefined && Date.now() >= deadline) throw new SurveySdkBoundaryError('sdk-deadline')
        assert(!failed && !inFlight && index === 14 && calls === 14 && deadline !== undefined && Date.now() < deadline)
        return freeze({ calls, bytes, receipts: structuredClone(receipts), nativeVerified: false as const,
          ...(cleanupDeadline === undefined ? {} : { phaseMs: caps.totalMs, absoluteDeadline: deadline }) })
      } catch (error) { rememberFailure(error); throw error }
    },
    diagnostic: () => `DIAG survey-sdk stage=${stage} calls=${Math.min(calls, 17)} bytes=${Math.min(bytes, SURVEY_SDK_PROOF_CAPS.totalBytes + 1)}${cleanupDeadline === undefined ? '' : ` settlement=${poisonKind} firstStage=${firstFailure?.stage ?? 'none'} firstReason=${firstFailure?.reason ?? 'none'} elapsedMs=${firstFailure?.elapsedMs ?? 0} remainingMs=${firstFailure?.remainingMs ?? 0} completedCalls=${firstFailure?.completedCalls ?? index} phaseMs=${caps.totalMs}`}.`,
  })
}

const graphSchema = z.record(z.string().regex(/^(public|private|storage)\.[a-z][a-z0-9_]*$/), z.array(z.record(z.string(), z.json())))
export type SurveyProofGraph = z.infer<typeof graphSchema>
function graph(raw: unknown): SurveyProofGraph {
  assert(Buffer.byteLength(JSON.stringify(raw)) <= SURVEY_SDK_PROOF_CAPS.responseBytes)
  return graphSchema.parse(raw)
}
function sorted(rows: SurveyProofGraph) {
  return Object.fromEntries(Object.keys(rows).sort().map(table => [table, rows[table].map(row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))).sort()]))
}
function exactOne(g: SurveyProofGraph, table: string, column: string, id: string) {
  assert(g[table]); const rows = g[table].filter(row => row[column] === id); assert.equal(rows.length, 1); return rows[0]
}
function bookkeeping(before: Record<string, unknown>, after: Record<string, unknown>, field: string, delta: number,
  window: { startedAt: string; endedAt: string }) {
  assert(Number.isSafeInteger(before[field]) && Number.isSafeInteger(after[field]))
  assert.equal(after[field], Number(before[field]) + delta)
  assert(typeof after.updated_at === 'string' && typeof before.updated_at === 'string')
  const next = Date.parse(after.updated_at), previous = Date.parse(before.updated_at)
  assert(Number.isFinite(next) && next >= previous && next >= Date.parse(window.startedAt) && next <= Date.parse(window.endedAt))
  assert(isDeepStrictEqual({ ...after, [field]: before[field], updated_at: before.updated_at }, before))
}
function nonTarget(before: SurveyProofGraph, after: SurveyProofGraph, allowed: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>) {
  assert(isDeepStrictEqual(Object.keys(before).sort(), Object.keys(after).sort()))
  const remove = (g: SurveyProofGraph) => Object.fromEntries(Object.entries(g).map(([table, rows]) => [table, rows.filter(row => {
    const scope = allowed.get(table); if (!scope) return true
    return ![...scope].some(([column, ids]) => typeof row[column] === 'string' && ids.includes(String(row[column])))
  })]))
  assert(isDeepStrictEqual(sorted(remove(before)), sorted(remove(after))), 'Survey non-target graph changed')
}
function windowBounds(window: { startedAt: string; endedAt: string }) {
  stamp.parse(window.startedAt); stamp.parse(window.endedAt)
  assert(Date.parse(window.endedAt) >= Date.parse(window.startedAt))
}
/** Prepare only a concrete replacement INSERT from a captured original row.
 * Root must add this exact frame to its committed profile, with its own guard.
 * This never grants SQL dispatch or mutates168 operational evidence directly. */
function membershipRestoreSql(f: SurveyNativeFixture, rawBefore: unknown) {
  const before = graph(rawBefore), old = f.enrollments[1], next = f.replacementEnrollment
  const row = z.object({ id: uuid, classroom_id: uuid, student_id: uuid, created_at: stamp, manual_attendance_marks: z.json() }).strict()
    .parse(exactOne(before, 'public.classroom_enrollments', 'id', old.id))
  assert.equal(row.classroom_id, old.classroomId); assert.equal(row.student_id, old.actorId)
  assert(!before['public.classroom_enrollments'].some(value => value.id === next.id))
  assert(!before['private.pal_membership_generations'].some(value => value.generation_id === next.id))
  const marks = JSON.stringify(row.manual_attendance_marks).replaceAll("'", "''")
  const sql = `begin;set local statement_timeout='8s';set local lock_timeout='1s';
do $fresh$ begin
 if exists(select 1 from public.classroom_enrollments where id in ('${old.id}','${next.id}'))
 or exists(select 1 from private.pal_membership_generations where generation_id='${next.id}')
 or not exists(select 1 from private.pal_membership_generations where generation_id='${old.id}' and state='removed'
 and scope_digest=private.pal_membership_scope('${old.classroomId}','${old.actorId}'))
 then raise exception 'Survey fresh membership prerequisite differs';end if;
end;$fresh$;
insert into public.classroom_enrollments(id,classroom_id,student_id,manual_attendance_marks)
 values('${next.id}','${next.classroomId}','${next.actorId}','${marks}'::jsonb);commit;`
  assert(Buffer.byteLength(sql) <= 256 * 1024)
  return sql
}
export function surveyMembershipRestoreSql(f: SurveyNativeFixture, rawBefore: unknown) {
  try { return membershipRestoreSql(f, rawBefore) } catch { throw new Error('Survey membership source proof refused; private details withheld') }
}
/** Fixed SDK terminal state: Survey, original question and all target responses
 * absent.095/112: six resource writes plus five Blueprint classroom updates =
 * eleven archive revisions; five Blueprint revisions. Native confirmation is pending. */
function sdkTerminalEffects(f: SurveyNativeFixture, rawBefore: unknown, rawAfter: unknown, window: { startedAt: string; endedAt: string }, phaseMs: number) {
  windowBounds(window); assert(Date.parse(window.endedAt) - Date.parse(window.startedAt) <= phaseMs)
  const before = graph(rawBefore), after = graph(rawAfter), sid = f.surveys[0].id, cid = f.classes[0].id
  const priorSurvey = survey.parse(exactOne(before, 'public.surveys', 'id', sid))
  assert.equal(priorSurvey.classroom_id, cid); assert.equal(priorSurvey.created_by, f.actors[0].id)
  assert.equal(priorSurvey.status, 'active'); assert.equal(priorSurvey.show_results, true); assert.equal(priorSurvey.dynamic_responses, false)
  assert(isDeepStrictEqual(question.parse(exactOne(before, 'public.survey_questions', 'id', f.question.id)), f.question))
  assert.equal(before['public.survey_questions'].filter(row => row.survey_id === sid).length, 1)
  assert.equal(before['public.survey_responses'].filter(row => row.survey_id === sid).length, 0)
  for (const [table, column, id] of [['public.surveys', 'id', sid], ['public.survey_questions', 'survey_id', sid], ['public.survey_responses', 'survey_id', sid]])
    assert.equal(after[table].filter(row => row[column] === id).length, 0)
  bookkeeping(exactOne(before, 'public.classrooms', 'id', cid), exactOne(after, 'public.classrooms', 'id', cid), 'blueprint_source_revision', 5, window)
  bookkeeping(exactOne(before, 'public.classroom_archive_revisions', 'classroom_id', cid), exactOne(after, 'public.classroom_archive_revisions', 'classroom_id', cid), 'revision', 11, window)
  nonTarget(before, after, new Map([
    ['public.surveys', new Map([['id', [sid]]])], ['public.survey_questions', new Map([['survey_id', [sid]]])],
    ['public.survey_responses', new Map([['survey_id', [sid]]])], ['public.classrooms', new Map([['id', [cid]]])],
    ['public.classroom_archive_revisions', new Map([['classroom_id', [cid]]])],
  ]))
  return freeze({ kind: 'sdk-terminal-effects', sourcePreserved: true, nativeVerified: false as const, archiveRevisionDelta: 11, blueprintRevisionDelta: 5 })
}
export function verifySurveySdkTerminalEffects(f: SurveyNativeFixture, rawBefore: unknown, rawAfter: unknown, window: { startedAt: string; endedAt: string }) {
  try { return sdkTerminalEffects(f, rawBefore, rawAfter, window, SURVEY_SDK_PROOF_CAPS.totalMs) } catch { throw new Error('Survey terminal effects proof refused; private details withheld') }
}
export function verifySurvey269ComponentSdkTerminalEffects(f: SurveyNativeFixture, rawBefore: unknown, rawAfter: unknown, window: { startedAt: string; endedAt: string }) {
  try { return sdkTerminalEffects(f, rawBefore, rawAfter, window, SURVEY_269_COMPONENT_SDK_CAPS.totalMs) } catch { throw new Error('Survey terminal effects proof refused; private details withheld') }
}
/** A legitimate fresh enrollment INSERT invokes168; no UPDATE/DELETE of private
 * evidence is accepted. Only the fixed removed/current pair can differ. */
function membershipRestoration(f: SurveyNativeFixture, rawBefore: unknown, rawAfter: unknown, window: { startedAt: string; endedAt: string }) {
  windowBounds(window); assert(Date.parse(window.endedAt) - Date.parse(window.startedAt) <= 900000)
  const before = graph(rawBefore), after = graph(rawAfter)
  const old = f.enrollments[1], replacement = f.replacementEnrollment
  const previous = exactOne(before, 'public.classroom_enrollments', 'id', old.id)
  assert.equal(previous.classroom_id, old.classroomId); assert.equal(previous.student_id, old.actorId)
  assert(!before['public.classroom_enrollments'].some(row => row.id === replacement.id))
  assert(!before['private.pal_membership_generations'].some(row => row.generation_id === replacement.id))
  assert(!after['public.classroom_enrollments'].some(row => row.id === old.id))
  const next = exactOne(after, 'public.classroom_enrollments', 'id', replacement.id)
  assert.equal(next.classroom_id, previous.classroom_id); assert.equal(next.student_id, previous.student_id)
  assert(typeof next.created_at === 'string' && Date.parse(next.created_at) >= Date.parse(window.startedAt) && Date.parse(next.created_at) <= Date.parse(window.endedAt))
  assert(isDeepStrictEqual({ ...next, id: previous.id, created_at: previous.created_at }, previous))
  const oldGeneration = exactOne(before, 'private.pal_membership_generations', 'generation_id', old.id)
  const retired = exactOne(after, 'private.pal_membership_generations', 'generation_id', old.id)
  assert.equal(oldGeneration.state, 'active'); assert.equal(retired.state, 'removed')
  assert(isDeepStrictEqual({ ...retired, state: 'active' }, oldGeneration))
  const fresh = exactOne(after, 'private.pal_membership_generations', 'generation_id', replacement.id)
  assert.deepEqual(Object.keys(fresh).sort(), ['generation_id', 'pal_reference', 'scope_digest', 'state'])
  assert.equal(fresh.state, 'active'); assert.equal(fresh.scope_digest, hash(`pika-membership-scope-v1:${old.classroomId}:${old.actorId}`))
  assert.equal(fresh.scope_digest, oldGeneration.scope_digest)
  assert(typeof fresh.pal_reference === 'string' && /^pika-membership-v1-[0-9a-f]{32}$/.test(fresh.pal_reference))
  assert(!before['private.pal_membership_generations'].some(row => row.pal_reference === fresh.pal_reference))
  assert.equal(after['private.pal_membership_generations'].filter(row => row.pal_reference === fresh.pal_reference).length, 1)
  const cid = old.classroomId
  bookkeeping(exactOne(before, 'public.classroom_archive_revisions', 'classroom_id', cid), exactOne(after, 'public.classroom_archive_revisions', 'classroom_id', cid), 'revision', 2, window)
  nonTarget(before, after, new Map([
    ['public.classroom_enrollments', new Map([['id', [old.id, replacement.id]]])],
    ['private.pal_membership_generations', new Map([['generation_id', [old.id, replacement.id]]])],
    ['public.classroom_archive_revisions', new Map([['classroom_id', [cid]]])],
  ]))
  return freeze({ kind: 'membership-semantic-restoration', sourcePreserved: true, retiredGenerationRetained: true,
    freshGenerationVerified: true, nativeVerified: false as const })
}
export function verifySurveyMembershipRestoration(f: SurveyNativeFixture, rawBefore: unknown, rawAfter: unknown, window: { startedAt: string; endedAt: string }) {
  try { return membershipRestoration(f, rawBefore, rawAfter, window) } catch { throw new Error('Survey membership restoration proof refused; private details withheld') }
}
