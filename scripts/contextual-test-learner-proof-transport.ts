/** Exact finite installed-SDK transport; import has no IO or native authority.
 * The coordinator supplies the inherited complete resource/source guard. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { normalizeTestResponses, buildTestAttemptHistoryMetrics } from '../src/lib/test-attempts'
import { createJsonPatch, shouldStoreSnapshot } from '../src/lib/json-patch'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { TEST_LEARNER_DEADLINE_MS, TEST_LEARNER_REPLY_BYTES, TEST_LEARNER_TOTAL_BYTES,
  TEST_LEARNER_RPC_LIMIT, testLearnerWitnessSchema, testLearnerResultSchemas } from '../src/lib/validations/contextual-test-learner-workflow'
import { testLearnerWorkflowRequest, testLearnerWorkflowCase, validateTestLearnerWorkflowWitness,
  type TestLearnerWorkflowFixture, type TestLearnerObservedAttempt } from './contextual-test-learner-proof-fixture'

const origin = 'http://127.0.0.1:54331', path = '/rest/v1/rpc/test_learner_workflow_v1'
type RefusalStage = 'preflight'|'request'|'guard-before'|'exchange'|'reply'|'witness'|'history-profile'|'guard-after'
const failure = (stage?: RefusalStage,context?: { label: string; phase: string; profile?: HistoryProfile }) =>
  new Error('Learner verification transport refused; native acceptance not established' +
    (stage ? `; stage=${stage}; case=${context?.label??'unset'}; phase=${context?.phase??'unset'}; profile=${context?.profile??'default'}` : ''))
type HistoryProfile = 'baseline'|'collapse'|'patch'|'no-op'|'submit'
const errorSchema = z.object({ code: z.enum(['PT400','PT403','PT404','PT409','PT503','42501','57014']),
  message: z.string().max(16384), details: z.string().max(16384).nullable().optional(), hint: z.string().max(16384).nullable().optional() }).strict()
/** JSON grammar plus duplicate object-key rejection before comparing exact bodies. */
function parseJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text), stack: Array<Set<string>|null> = []
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '{' || char === '[') stack.push(char === '{' ? new Set() : null)
    else if (char === '}' || char === ']') stack.pop()
    else if (char === '"') {
      const start = index++
      for (; index < text.length; index++) { if (text[index] === '\\') index++; else if (text[index] === '"') break }
      let next = index + 1; while (next < text.length && /\s/.test(text[next])) next++
      if (text[next] === ':') { const key = JSON.parse(text.slice(start,index+1)); const object = stack.at(-1); assert(object && !object.has(key)); object.add(key) }
    }
  }
  return parsed
}
export function createTestLearnerProofTransport(f: TestLearnerWorkflowFixture, rawTarget: unknown, projectId: string,
  originalFetch: typeof fetch, guard: () => Promise<void>) {
  assert(Object.isFrozen(f)); assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const target = validateAssignmentListProofTarget(rawTarget, projectId); assert.equal(target.API_URL, origin)
  let context: { label: string; deadline: string; phase: 'inspect'|'operation'|'history-plan'|'history-write'|'document-recheck'|'complete'; document?: unknown;
    profile?: HistoryProfile; saved?: unknown; plan?: unknown; historyWrite?: Record<string,unknown>|null } | undefined
  let failed = false, inFlight = false, calls = 0, bytes = 0
  let observed: readonly TestLearnerObservedAttempt[] = Object.freeze([])
  const seen = new Set<string>()
  function readContext(label: string, deadline: string, profile?: HistoryProfile) {
    const key = `${label}:${profile??'default'}`
    assert(!failed && !inFlight && (!context || context.phase === 'complete') && !seen.has(key))
    testLearnerWorkflowRequest(f,label,deadline,observed)
    if(profile){assert(['baseline','collapse','patch','no-op','submit'].includes(profile));const c=testLearnerWorkflowCase(label);assert(c.expected==='success'&&c.actor===c.subject);assert.equal(c.operation,profile==='submit'?'submit':'save')}
    const end = Date.parse(deadline); assert(end > Date.now() && end <= Date.now() + TEST_LEARNER_DEADLINE_MS)
    context = { label, deadline, phase: 'inspect',profile }; seen.add(key)
  }
  function historyWriteRequest() { assert(context?.profile && (context.phase==='history-write'||context.phase==='complete') && context.historyWrite!==undefined);return context.historyWrite===null?null:structuredClone(context.historyWrite) }
  const safeFetch: typeof fetch = async (resource, init) => {
    let stage: RefusalStage = 'preflight'
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, response: Response | undefined
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    const caller = init?.signal, abort = () => controller.abort()
    const check = () => assert(!failed && !controller.signal.aborted && !caller?.aborted && context && Date.now() < Date.parse(context.deadline))
    try {
      check(); assert(!inFlight && context && context.phase !== 'complete'); inFlight = true
      stage = 'request';assert(!(resource instanceof Request)); assert(typeof resource === 'string' || resource instanceof URL)
      assert.equal(String(resource), origin + path)
      assert(init && init.method === 'POST' && typeof init.body === 'string')
      assert(Object.keys(init).every(key => ['method','headers','body','signal','redirect'].includes(key)))
      assert(init.redirect === undefined || init.redirect === 'error')
      const headers = new Headers(init.headers)
      const allowed: Record<string,string[]> = { authorization: [`Bearer ${target.SERVICE_ROLE_KEY}`], apikey: [target.SERVICE_ROLE_KEY],
        'x-client-info': ['supabase-js-node/2.93.3'], 'content-type': ['application/json'], accept: ['application/json'],
        'accept-profile': ['public'], 'content-profile': ['public'] }
      for (const [name,value] of headers) assert(allowed[name]?.includes(value))
      for (const name of ['authorization','apikey','x-client-info','content-type']) assert.equal(headers.get(name), allowed[name][0])
      const rawBody = init.body; assert(Buffer.byteLength(rawBody) <= 2 * 1024 * 1024)
      const expected = testLearnerWorkflowRequest(f,context.label,context.deadline,observed)
      const c = testLearnerWorkflowCase(context.label)
      const inspect = context.phase === 'inspect'
      let expectedRequest: ReturnType<typeof testLearnerWorkflowRequest> = inspect ? { ...expected, p_classroom_id: null, p_operation: 'inspect',
        p_payload: c.actor === c.subject ? {} : { requested_student_id: f.actors[c.subject].id } } : expected
      if(!inspect&&context.profile&&context.phase==='operation')expectedRequest={...expectedRequest,p_payload:{...expectedRequest.p_payload,
        responses:{[f.questions[0].id]:{question_type:'open_response',response_text:'x'.repeat(1800)},
          [f.questions[1].id]:{question_type:'multiple_choice',selected_option:context.profile==='collapse'?1:0}}}}
      const history = context.phase === 'history-plan' || context.phase === 'history-write'
      const proofLabel = history ? `${context.phase}-member-${f.actors[c.actor].role}` : context.label
      if (history) {
        expectedRequest = testLearnerWorkflowRequest(f,proofLabel,context.deadline,observed)
        if (context.phase === 'history-write' && c.operation === 'submit') expectedRequest = { ...expectedRequest,
          p_payload: { ...expectedRequest.p_payload,trigger: 'submit',keystroke_count: 0 } }
        if(context.phase==='history-write'&&context.profile){assert(context.historyWrite);expectedRequest={...expectedRequest,p_payload:context.historyWrite}}
      }
      assert.deepEqual(parseJson(rawBody), expectedRequest)
      caller?.addEventListener('abort',abort,{ once: true }); timer = setTimeout(abort,Math.max(0,Date.parse(context.deadline)-Date.now()))
      let rejectAbort: (error: Error) => void = () => {}
      const aborted = new Promise<never>((_,reject) => { rejectAbort = reject })
      controller.signal.addEventListener('abort', () => rejectAbort(failure()), { once: true })
      const bounded = async <T>(work: () => Promise<T>): Promise<T> => { check(); const value = await Promise.race([Promise.resolve().then(work),aborted]); check(); return value }
      stage = 'guard-before';await bounded(guard); check(); assert(++calls <= TEST_LEARNER_RPC_LIMIT)
      bytes += Buffer.byteLength(rawBody); assert(bytes <= TEST_LEARNER_TOTAL_BYTES)
      stage = 'exchange';response = await bounded(() => originalFetch(origin+path,{ method: 'POST', headers, body: rawBody, redirect: 'error', signal: controller.signal }))
      stage = 'reply'
      assert(response instanceof Response && !response.redirected && !response.headers.has('location') && response.body)
      assert(!response.url || response.url === origin+path); assert(response.headers.get('content-type')?.startsWith('application/json'))
      const length = response.headers.get('content-length'); assert(length === null || /^\d+$/.test(length) && Number(length) <= TEST_LEARNER_REPLY_BYTES)
      reader = response.body.getReader(); const decoder = new TextDecoder('utf-8',{ fatal: true })
      let output = '', replyBytes = 0, reads = 0
      for (;;) {
        assert(++reads <= TEST_LEARNER_REPLY_BYTES + 1); const part = await bounded(() => reader!.read()); if (part.done) break
        replyBytes += part.value.byteLength; bytes += part.value.byteLength
        assert(replyBytes <= TEST_LEARNER_REPLY_BYTES && bytes <= TEST_LEARNER_TOTAL_BYTES); output += decoder.decode(part.value,{ stream: true })
      }
      output += decoder.decode(); const decoded = parseJson(output)
      let nextObserved = observed
      stage = 'witness';if (response.ok) {
        if (inspect) {
          const w = testLearnerWitnessSchema.parse(decoded); assert.equal(w.operation,'inspect')
          assert.equal(w.actor_id,expected.p_actor_id); assert.equal(w.subject_id,f.actors[c.subject].id)
          assert.equal(w.test_id,f.testId); assert.equal(w.classroom_id,f.classroomId); testLearnerResultSchemas.inspect.parse(w.result)
        } else {
          const accepted = validateTestLearnerWorkflowWitness(f,proofLabel,decoded,observed)
          const result = accepted.result
          if(context.profile&&context.phase==='operation')context.saved=result
          if(context.profile&&context.phase==='history-plan'){
            stage = 'history-profile'
            const plan=testLearnerResultSchemas['history-plan'].parse(result),saved=context.saved
            assert(saved&&typeof saved==='object'&&!Array.isArray(saved));const row=saved as Record<string,unknown>
            const next=normalizeTestResponses({[f.questions[0].id]:{question_type:'open_response',response_text:'x'.repeat(1800)},[f.questions[1].id]:{question_type:'multiple_choice',selected_option:context.profile==='collapse'?1:0}})
            assert(isDeepStrictEqual(normalizeTestResponses(plan.attempt.responses),next));context.plan=plan
            const patch=createJsonPatch(normalizeTestResponses(row.previous_responses),next),last=plan.last_history
            const collapse=c.operation!=='submit'&&last!==null&&last.trigger!=='submit'&&Date.now()-Date.parse(last.created_at)<10000
            const baseline=row.created===true||!last||c.operation==='submit',snapshot=baseline||collapse||shouldStoreSnapshot(patch,next)
            if(context.profile==='collapse')assert(collapse);if(context.profile==='patch')assert(!collapse&&!snapshot&&patch.length>0)
            if(context.profile==='no-op'){assert(c.operation==='save'&&row.created!==true&&patch.length===0);context.historyWrite=null}
            else {const metrics=buildTestAttemptHistoryMetrics(next,0,c.operation==='submit'?0:1)
              context.historyWrite={attempt_id:plan.attempt.id,draft_revision:plan.attempt.draft_revision,expected_last:last,collapse,
                patch:snapshot?null:patch,snapshot:snapshot?next:null,trigger:c.operation==='submit'?'submit':baseline?'baseline':'autosave',...metrics,
                paste_word_count:metrics.paste_word_count+(collapse?last!.paste_word_count??0:0),keystroke_count:metrics.keystroke_count+(collapse?last!.keystroke_count??0:0)}}
          }
          if (c.operation === 'document') {
            if (context.phase === 'document-recheck') assert.deepEqual(result,context.document)
            else context.document = result
          }
          if ('attempt' in result && result.attempt) nextObserved = Object.freeze([...observed.filter(row => row.actorId !== accepted.subject_id),
            Object.freeze({ actorId: accepted.subject_id,attemptId: result.attempt.id,revision: result.attempt.draft_revision })])
          if ('attempt_id' in result) nextObserved = Object.freeze([...observed.filter(row => row.actorId !== accepted.subject_id),
            Object.freeze({ actorId: accepted.subject_id,attemptId: result.attempt_id,revision: result.draft_revision })])
        }
      } else {
        const error = errorSchema.parse(decoded)
        const statuses: Record<string,number> = { PT400: 400,PT403: 403,PT404: 404,PT409: 409,PT503: 503,'42501': 403,'57014': 500 }
        assert.equal(response.status,statuses[error.code]); assert(c.expected === 'denial' || history)
      }
      stage = 'guard-after';await bounded(guard); check()
      observed = nextObserved
      context.phase = !response.ok ? 'complete' : inspect && c.operation !== 'inspect' ? 'operation'
        : context.phase === 'operation' && c.expected === 'success' && (c.operation === 'save' || c.operation === 'submit') ? 'history-plan'
        : context.phase === 'history-plan' ? context.profile&&context.historyWrite===null?'complete':'history-write'
        : context.phase === 'operation' && c.operation === 'document' ? 'document-recheck' : 'complete'
      return new Response(output,{ status: response.status, headers: { 'content-type': 'application/json' } })
    } catch { failed = true; controller.abort(); void reader?.cancel().catch(() => {}); void response?.body?.cancel().catch(() => {}); throw failure(stage,context) }
    finally { clearTimeout(timer); caller?.removeEventListener('abort',abort); inFlight = false }
  }
  return Object.freeze({ safeFetch, readContext, historyWriteRequest, report: () => Object.freeze({ calls, bytes, failed,
    complete: context?.phase === 'complete', observedAttempts: observed,nativeVerified: false as const }) })
}
