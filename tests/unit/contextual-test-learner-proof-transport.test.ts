import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createContextualTestLearnerWorkflow, type TestLearnerRpcClient } from '../../src/lib/server/contextual-test-learner-workflow'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestLearnerWorkflowFixture, testLearnerWorkflowRequest, TEST_LEARNER_PROOF_CASES, testLearnerCollectionQuestions } from '../../scripts/contextual-test-learner-proof-fixture'
import { createTestLearnerProofTransport } from '../../scripts/contextual-test-learner-proof-transport'

const f = newTestLearnerWorkflowFixture(newAssignmentListProofFixture(new Date('2026-10-10T12:00:00Z')))
const key = `e30.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.synthetic`
const target = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: key }
const url = target.API_URL + '/rest/v1/rpc/test_learner_workflow_v1'
const headers = { apikey: key, authorization: `Bearer ${key}`, 'x-client-info': 'supabase-js-node/2.93.3', 'content-type': 'application/json' }
const attempt = { id: f.attemptId, test_id: f.testId, student_id: f.actors[1].id, responses: {}, is_submitted: false,
  submitted_at: null, created_at: f.now, updated_at: f.now, draft_revision: 1 }
const witness = (operation = 'recover') => ({ version: 1, actor_id: f.actors[1].id, classroom_id: f.classroomId,
  test_id: f.testId, subject_id: f.actors[1].id, operation, result: operation === 'inspect' ? { access_mode: 'member' } : { attempt } })
function setup(reply?: typeof fetch) {
  const deadline = new Date(Date.now()+10000).toISOString(), guard = vi.fn(async () => {})
  const fetcher = vi.fn<typeof fetch>(reply ?? (async (_resource,init) => {
    const op = JSON.parse(String(init?.body)).p_operation
    return new Response(JSON.stringify(witness(op)), { headers: { 'content-type': 'application/json' } })
  }))
  const transport = createTestLearnerProofTransport(f,target,`pika_assignment_list_${f.tag.slice(-12)}`,fetcher,guard)
  transport.readContext('recover-member-teacher',deadline)
  const inspect = { ...testLearnerWorkflowRequest(f,'recover-member-teacher',deadline), p_classroom_id: null, p_operation: 'inspect' }
  return { deadline, guard, fetcher, transport, inspect, init: { method: 'POST', headers, body: JSON.stringify(inspect) } }
}
describe('exact learner installed-SDK source transport (offline, no native acceptance)', () => {
  it('runs the real application helper through installed SDK inspect and recovery', async () => {
    const s = setup(), client = createClient(target.API_URL,key,{ auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: s.transport.safeFetch } })
    const flow = createContextualTestLearnerWorkflow({ supabase: client as unknown as TestLearnerRpcClient,
      actorId: f.actors[1].id, testId: f.testId, deadline: Date.parse(s.deadline) })
    await expect(flow.inspect()).resolves.toEqual({ access_mode: 'member' })
    await expect(flow.run('recover')).resolves.toEqual({ attempt })
    expect(s.fetcher).toHaveBeenCalledTimes(2); expect(s.guard).toHaveBeenCalledTimes(4)
    expect(s.transport.report()).toMatchObject({ calls: 2, complete: true, failed: false, nativeVerified: false })
    await expect(flow.run('recover')).rejects.toMatchObject({ statusCode: 503 })
    expect(s.fetcher).toHaveBeenCalledTimes(2)
  })
  it.each(TEST_LEARNER_PROOF_CASES.filter(c => c.expected === 'success'))('decodes source-only $label through the actual helper and installed SDK', async c => {
    const deadline = new Date(Date.now()+10000).toISOString(), ownAttempt = { ...attempt,student_id: f.actors[c.subject].id,
      ...(['save','submit'].includes(c.operation) ? { draft_revision: 2 } : {}),
      ...(c.label.startsWith('start-first-') ? { id: '99887766-5544-4321-8765-112233445566' } : {}) }
    const state = { test: { id: f.testId,classroom_id: f.classroomId,title: 'Synthetic',status: 'active',show_results: true,
      documents: [],position: 0,created_at: f.now,updated_at: f.now }, attempt: { id: f.attemptId,is_submitted: false,
      returned_at: null,closed_for_grading_at: null,draft_revision: 1 }, access_state: 'open',has_submitted: false }
    const questions = testLearnerCollectionQuestions(f,1001)
    const results: Record<string,unknown> = { inspect: { access_mode: c.actor === 0 ? 'owner' : 'member' },
      detail: { state,attempt: ownAttempt,questions,submitted_responses: {},focus_events: [] },
      start: { questions,attempt: ownAttempt },save: { created: false,previous_responses: {},attempt: ownAttempt },
      submit: { attempt_id: f.attemptId,submitted_at: f.now,inserted_responses: 1,draft_revision: 2 },
      recover: { attempt: ownAttempt },session: { state },history: { history: [],attemptId: f.attemptId },
      focus: { event_id: f.materials[0].id,focus_events: [] },results: { state: { ...state,has_submitted: true,access_state: 'closed',
        attempt: { ...state.attempt,is_submitted: true,returned_at: f.now } },results: [],my_responses: {},question_results: [],
        summary: { earned_points: 0,possible_points: 0,percent: 0 } },
      document: { document: { id: f.materials[0].id,source: 'upload',storage_path: f.materials[0].path },content_type: 'application/pdf',object: null },
      'history-plan': { attempt: ownAttempt,last_history: null },'history-write': { historyEntry: null } }
    const fetcher = vi.fn<typeof fetch>(async (_resource,init) => {
      const op = JSON.parse(String(init?.body)).p_operation
      return new Response(JSON.stringify({ version: 1,actor_id: f.actors[c.actor].id,classroom_id: f.classroomId,test_id: f.testId,
        subject_id: f.actors[c.subject].id,operation: op,result: results[op] }),{ headers: { 'content-type': 'application/json' } })
    })
    const transport = createTestLearnerProofTransport(f,target,`pika_assignment_list_${f.tag.slice(-12)}`,fetcher,async () => {})
    transport.readContext(c.label,deadline)
    const client = createClient(target.API_URL,key,{ auth: { persistSession: false,autoRefreshToken: false },global: { fetch: transport.safeFetch } })
    const flow = createContextualTestLearnerWorkflow({ supabase: client as unknown as TestLearnerRpcClient,actorId: f.actors[c.actor].id,
      testId: f.testId,requestedStudentId: c.actor === c.subject ? undefined : f.actors[c.subject].id,deadline: Date.parse(deadline) })
    await flow.inspect()
    if (c.operation !== 'inspect') await expect(flow.run(c.operation,testLearnerWorkflowRequest(f,c.label,deadline).p_payload as never)).resolves.toEqual(results[c.operation])
    if (c.operation === 'save' || c.operation === 'submit') {
      const plan = testLearnerWorkflowRequest(f,`history-plan-member-${f.actors[c.actor].role}`,deadline,transport.report().observedAttempts)
      await flow.run('history-plan',plan.p_payload as never)
      const write = testLearnerWorkflowRequest(f,`history-write-member-${f.actors[c.actor].role}`,deadline,transport.report().observedAttempts)
      await flow.run('history-write', (c.operation === 'submit' ? { ...write.p_payload,trigger: 'submit',keystroke_count: 0 } : write.p_payload) as never)
    }
    if (c.operation === 'document') await flow.run('document',testLearnerWorkflowRequest(f,c.label,deadline).p_payload as never)
    expect(transport.report()).toMatchObject({ complete: true,failed: false,nativeVerified: false })
  })
  it.each(['p_actor_id','p_test_id','p_classroom_id','p_operation','p_payload','p_deadline'])('rejects changed exact %s before dispatch', async field => {
    const s = setup(); const body = { ...s.inspect, [field]: field === 'p_payload' ? { sql: 'select *' } : f.actors[3].id }
    await expect(s.transport.safeFetch(url,{ ...s.init,body: JSON.stringify(body) })).rejects.toThrow()
    expect(s.fetcher).not.toHaveBeenCalled(); expect(s.guard).not.toHaveBeenCalled()
    await expect(s.transport.safeFetch(url,s.init)).rejects.toThrow(); expect(s.fetcher).not.toHaveBeenCalled()
  })
  it('rejects inconsistent denial HTTP status and SQLSTATE', async () => {
    const deadline = new Date(Date.now()+10000).toISOString()
    const transport = createTestLearnerProofTransport(f,target,`pika_assignment_list_${f.tag.slice(-12)}`,
      async () => new Response(JSON.stringify({ code: 'PT403',message: 'Forbidden' }),{ status: 400,headers: { 'content-type': 'application/json' } }),async () => {})
    transport.readContext('stale-save-revoked',deadline)
    const expected = testLearnerWorkflowRequest(f,'stale-save-revoked',deadline)
    await expect(transport.safeFetch(url,{ method: 'POST',headers,body: JSON.stringify({ ...expected,p_classroom_id: null,p_operation: 'inspect',p_payload: {} }) })).rejects.toThrow()
  })
  it.each(TEST_LEARNER_PROOF_CASES.filter(c => c.expected === 'denial'))('preserves source-only $label refusal without an attempt disclosure', async c => {
    const deniesInspect = c.actor === c.subject && (c.actor === 0 || c.actor === 3) || c.label === 'member-subject-override'
    const deadline = new Date(Date.now()+10000).toISOString(), fetcher = vi.fn<typeof fetch>(async (_resource,init) => {
      if (!deniesInspect && JSON.parse(String(init?.body)).p_operation === 'inspect') return new Response(JSON.stringify({
        version: 1,actor_id: f.actors[c.actor].id,classroom_id: f.classroomId,test_id: f.testId,subject_id: f.actors[c.subject].id,
        operation: 'inspect',result: { access_mode: 'member' } }),{ headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ code: 'PT403',message: 'Forbidden' }),{ status: 403,headers: { 'content-type': 'application/json' } })
    })
    const transport = createTestLearnerProofTransport(f,target,`pika_assignment_list_${f.tag.slice(-12)}`,fetcher,async () => {})
    transport.readContext(c.label,deadline)
    const client = createClient(target.API_URL,key,{ auth: { persistSession: false,autoRefreshToken: false },global: { fetch: transport.safeFetch } })
    const flow = createContextualTestLearnerWorkflow({ supabase: client as unknown as TestLearnerRpcClient,actorId: f.actors[c.actor].id,
      testId: f.testId,requestedStudentId: c.actor === c.subject ? undefined : f.actors[c.subject].id,deadline: Date.parse(deadline) })
    if (deniesInspect) await expect(flow.inspect()).rejects.toMatchObject({ statusCode: 403 })
    else {
      await flow.inspect()
      if (c.label === 'wrong-parent') {
        const raw = await (client as unknown as TestLearnerRpcClient).rpc('test_learner_workflow_v1',testLearnerWorkflowRequest(f,c.label,deadline) as never).abortSignal(new AbortController().signal)
        expect(raw).toMatchObject({ data: null,error: { code: 'PT403' } })
      } else await expect(flow.run(c.operation,testLearnerWorkflowRequest(f,c.label,deadline).p_payload as never)).rejects.toMatchObject({ statusCode: 403 })
    }
    expect(fetcher).toHaveBeenCalledTimes(deniesInspect ? 1 : 2); expect(transport.report()).toMatchObject({ complete: true,failed: false,observedAttempts: [] })
  })
  it('carries only a guarded first-Start allocated attempt into later recovery', async () => {
    const deadline = new Date(Date.now()+10000).toISOString(), generated = '99887766-5544-4321-8765-112233445566'
    const fetcher = vi.fn<typeof fetch>(async (_resource,init) => {
      const op = JSON.parse(String(init?.body)).p_operation
      return new Response(JSON.stringify({ ...witness(op),result: op === 'inspect' ? { access_mode: 'member' }
        : op === 'start' ? { questions: [],attempt: { ...attempt,id: generated } } : { attempt: { ...attempt,id: generated } } }),
        { headers: { 'content-type': 'application/json' } })
    })
    const transport = createTestLearnerProofTransport(f,target,`pika_assignment_list_${f.tag.slice(-12)}`,fetcher,async () => {})
    const client = createClient(target.API_URL,key,{ auth: { persistSession: false,autoRefreshToken: false },global: { fetch: transport.safeFetch } })
    const flowFor = () => createContextualTestLearnerWorkflow({ supabase: client as unknown as TestLearnerRpcClient,
      actorId: f.actors[1].id,testId: f.testId,deadline: Date.parse(deadline) })
    transport.readContext('start-first-member-teacher',deadline); const first = flowFor(); await first.inspect(); await first.run('start')
    expect(transport.report().observedAttempts).toEqual([{ actorId: f.actors[1].id,attemptId: generated,revision: 1 }])
    expect(Object.isFrozen(transport.report().observedAttempts[0])).toBe(true)
    transport.readContext('recover-member-teacher',deadline); const recovery = flowFor(); await recovery.inspect()
    await expect(recovery.run('recover')).resolves.toEqual({ attempt: { ...attempt,id: generated } })
    const historyRequest = testLearnerWorkflowRequest(f,'history-plan-member-teacher',deadline,transport.report().observedAttempts)
    expect(historyRequest.p_payload).toMatchObject({ attempt_id: generated,draft_revision: 1 })
  })
  it.each(['stale-save-current','stale-submit-current'])('keeps $label narrow and terminates before history writes', async label => {
    const deadline = new Date(Date.now()+10000).toISOString(), c = TEST_LEARNER_PROOF_CASES.find(row => row.label === label)!
    const fetcher = vi.fn<typeof fetch>(async (_resource,init) => {
      const op = JSON.parse(String(init?.body)).p_operation
      return new Response(JSON.stringify({ ...witness(op),result: op === 'inspect' ? { access_mode: 'member' }
        : { conflict: true,attempt: { ...attempt,draft_revision: 2 } } }),{ headers: { 'content-type': 'application/json' } })
    })
    const transport = createTestLearnerProofTransport(f,target,`pika_assignment_list_${f.tag.slice(-12)}`,fetcher,async () => {})
    transport.readContext(label,deadline)
    const client = createClient(target.API_URL,key,{ auth: { persistSession: false,autoRefreshToken: false },global: { fetch: transport.safeFetch } })
    const flow = createContextualTestLearnerWorkflow({ supabase: client as unknown as TestLearnerRpcClient,actorId: f.actors[1].id,testId: f.testId,deadline: Date.parse(deadline) })
    await flow.inspect(); await expect(flow.run(c.operation,testLearnerWorkflowRequest(f,label,deadline).p_payload as never)).resolves.toEqual({ conflict: true,attempt: { ...attempt,draft_revision: 2 } })
    expect(transport.report().complete).toBe(true); expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('keeps a successful save witness when a separately fenced history plan refuses', async () => {
    const deadline = new Date(Date.now()+10000).toISOString()
    const fetcher = vi.fn<typeof fetch>(async (_resource,init) => {
      const op = JSON.parse(String(init?.body)).p_operation
      if (op === 'history-plan') return new Response(JSON.stringify({ code: 'PT403',message: 'Current member removed' }),{ status: 403,headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ ...witness(op),result: op === 'inspect' ? { access_mode: 'member' }
        : { created: false,previous_responses: {},attempt: { ...attempt,draft_revision: 2 } } }),{ headers: { 'content-type': 'application/json' } })
    })
    const transport = createTestLearnerProofTransport(f,target,`pika_assignment_list_${f.tag.slice(-12)}`,fetcher,async () => {})
    transport.readContext('save-member-teacher',deadline)
    const client = createClient(target.API_URL,key,{ auth: { persistSession: false,autoRefreshToken: false },global: { fetch: transport.safeFetch } })
    const flow = createContextualTestLearnerWorkflow({ supabase: client as unknown as TestLearnerRpcClient,actorId: f.actors[1].id,testId: f.testId,deadline: Date.parse(deadline) })
    await flow.inspect(); const saved = await flow.run('save',testLearnerWorkflowRequest(f,'save-member-teacher',deadline).p_payload as never)
    await expect(flow.run('history-plan',testLearnerWorkflowRequest(f,'history-plan-member-teacher',deadline,transport.report().observedAttempts).p_payload as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(saved).toMatchObject({ attempt: { draft_revision: 2 } }); expect(transport.report()).toMatchObject({ complete: true,failed: false })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('refuses a changed document tuple on the required second disclosure', async () => {
    const deadline = new Date(Date.now()+10000).toISOString(); let reads = 0
    const fetcher = vi.fn<typeof fetch>(async (_resource,init) => {
      const op = JSON.parse(String(init?.body)).p_operation
      return new Response(JSON.stringify({ ...witness(op),result: op === 'inspect' ? { access_mode: 'member' }
        : { document: { id: f.materials[0].id,source: 'upload',storage_path: f.materials[0].path,title: `revision${++reads}` },content_type: 'application/pdf',object: null } }),{ headers: { 'content-type': 'application/json' } })
    })
    const transport = createTestLearnerProofTransport(f,target,`pika_assignment_list_${f.tag.slice(-12)}`,fetcher,async () => {})
    transport.readContext('document-member-teacher',deadline)
    const client = createClient(target.API_URL,key,{ auth: { persistSession: false,autoRefreshToken: false },global: { fetch: transport.safeFetch } })
    const flow = createContextualTestLearnerWorkflow({ supabase: client as unknown as TestLearnerRpcClient,actorId: f.actors[1].id,testId: f.testId,deadline: Date.parse(deadline) })
    await flow.inspect(); const body = testLearnerWorkflowRequest(f,'document-member-teacher',deadline).p_payload as never
    await flow.run('document',body); expect(transport.report().complete).toBe(false)
    await expect(flow.run('document',body)).rejects.toMatchObject({ statusCode: 503 }); expect(transport.report().failed).toBe(true)
  })
  it.each([url+'?select=*',url+'#fragment',target.API_URL+'/rest/v1/users','https://example.invalid/rest/v1/rpc/test_learner_workflow_v1'])('rejects unlisted URL %s', async changed => {
    const s = setup(); await expect(s.transport.safeFetch(changed,s.init)).rejects.toThrow(); expect(s.fetcher).not.toHaveBeenCalled()
  })
  it('rejects duplicate object keys and unknown headers before dispatch', async () => {
    const a = setup(), duplicate = a.init.body.replace('{',`{"p_actor_id":"${f.actors[3].id}",`)
    await expect(a.transport.safeFetch(url,{ ...a.init,body: duplicate })).rejects.toThrow(); expect(a.fetcher).not.toHaveBeenCalled()
    const b = setup(); await expect(b.transport.safeFetch(url,{ ...b.init,headers: { ...headers,'x-unreviewed': 'yes' } })).rejects.toThrow()
    expect(b.fetcher).not.toHaveBeenCalled()
  })
  it('preserves the pre/post full guard and refuses post-dispatch closure drift', async () => {
    const s = setup(); s.guard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('resource drift'))
    await expect(s.transport.safeFetch(url,s.init)).rejects.toThrow(); expect(s.fetcher).toHaveBeenCalledTimes(1)
    expect(s.transport.report().failed).toBe(true)
  })
  it.each(['guard-before','guard-after'] as const)('retains only fixed refusal context for %s, not the underlying private error', async stage => {
    const s = setup(), privateMessage = `synthetic private context ${key}`
    if (stage === 'guard-after') s.guard.mockResolvedValueOnce(undefined)
    s.guard.mockRejectedValueOnce(new Error(privateMessage))
    const error: unknown = await s.transport.safeFetch(url,s.init).then(() => null,error => error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(`stage=${stage}`)
    expect((error as Error).message).toContain('case=recover-member-teacher')
    expect((error as Error).message).not.toContain(privateMessage)
    expect((error as Error).message).not.toContain(key)
    expect(s.fetcher).toHaveBeenCalledTimes(stage === 'guard-before' ? 0 : 1)
    expect(s.transport.report().failed).toBe(true)
  })
  it.each(['wrong-witness','redirect','oversize','malformed-utf8'])('fails closed on %s replies', async kind => {
    const s = setup(async () => {
      if (kind === 'redirect') return new Response(null,{ status: 302,headers: { location: 'https://example.invalid' } })
      if (kind === 'oversize') return new Response('{}',{ headers: { 'content-type': 'application/json','content-length': String(8*1024*1024+1) } })
      if (kind === 'malformed-utf8') return new Response(new Uint8Array([255]),{ headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ ...witness('inspect'),subject_id: f.actors[3].id }),{ headers: { 'content-type': 'application/json' } })
    })
    await expect(s.transport.safeFetch(url,s.init)).rejects.toThrow(); expect(s.transport.report().failed).toBe(true)
  })
  it('refuses expired or reused contexts before any request', () => {
    const s = setup(); expect(() => s.transport.readContext('recover-member-teacher',s.deadline)).toThrow()
    const t = createTestLearnerProofTransport(f,target,`pika_assignment_list_${f.tag.slice(-12)}`,s.fetcher,s.guard)
    expect(() => t.readContext('recover-member-teacher',new Date(Date.now()-1).toISOString())).toThrow()
    expect(s.fetcher).not.toHaveBeenCalled()
  })
  it.each([
    ...(['baseline','collapse','patch','no-op','submit'] as const).map(profile=>({name:profile,profile,guardDelay:0,offset:profile==='collapse'?-1000:-11000,expiry:'none'})),
    {name:'controlled collapse with slow full guards',profile:'collapse' as const,guardDelay:2000,offset:45000,expiry:'none'},
    {name:'natural collapse expires before plan',profile:'collapse' as const,guardDelay:2000,offset:-1000,expiry:'before-plan'},
    {name:'natural collapse expires between plan and write',profile:'collapse' as const,guardDelay:0,offset:-1000,expiry:'before-write'},
  ])('derives or refuses exact fixed application history $name', async ({profile,guardDelay,offset,expiry}) => {
    let now=Date.now(),guards=0;const initial=now,clock=vi.spyOn(Date,'now').mockImplementation(()=>now)
    try {
    const deadline=new Date(initial+30000).toISOString(),next={ [f.questions[0].id]:{question_type:'open_response',response_text:'x'.repeat(1800)},
      [f.questions[1].id]:{question_type:'multiple_choice',selected_option:profile==='collapse'?1:0} }
    const previous=profile==='baseline'?{}:profile==='no-op'?next:{...next,[f.questions[1].id]:{question_type:'multiple_choice',selected_option:profile==='collapse'?0:1}}
    const current={...attempt,responses:next,draft_revision:2},last=profile==='baseline'?null:{id:f.materials[0].objectId,test_attempt_id:f.attemptId,
      patch:null,snapshot:previous,word_count:1,char_count:1900,paste_word_count:3,keystroke_count:5,trigger:'baseline',created_at:new Date(initial+offset).toISOString()}
    const fetcher=vi.fn<typeof fetch>(async (_resource,init)=>{const body=JSON.parse(String(init?.body)),op=body.p_operation
      if(op==='history-write'&&body.p_payload.collapse&&last&&now-Date.parse(last.created_at)>=10000)
        return new Response(JSON.stringify({code:'PT409',message:'test_learner_history_changed',details:null,hint:null}),{status:409,headers:{'content-type':'application/json'}})
      const result=op==='inspect'?{access_mode:'member'}:op==='save'?{created:profile==='baseline',previous_responses:previous,attempt:current}
        :op==='submit'?{attempt_id:f.attemptId,submitted_at:f.now,inserted_responses:2,draft_revision:2}
        :op==='history-plan'?{attempt:current,last_history:last}:{historyEntry:null}
      return new Response(JSON.stringify({...witness(op),result}),{headers:{'content-type':'application/json'}})})
    const guard=vi.fn(async()=>{now+=guardDelay;if(++guards===6&&expiry==='before-write')now+=11000})
    const transport=createTestLearnerProofTransport(f,target,`pika_assignment_list_${f.tag.slice(-12)}`,fetcher,guard)
    const label=profile==='submit'?'submit-member-teacher':'save-member-teacher'
    transport.readContext(label,deadline,profile)
    const client=createClient(target.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport.safeFetch}})
    const flow=createContextualTestLearnerWorkflow({supabase:client as unknown as TestLearnerRpcClient,actorId:f.actors[1].id,testId:f.testId,deadline:Date.parse(deadline)})
    await flow.inspect();await flow.run(profile==='submit'?'submit':'save',{responses:next,expected_revision:1,...(profile==='submit'?{}:{trigger:'autosave',paste_word_count:0,keystroke_count:1})})
    if(expiry==='before-plan'){
      await expect(flow.run('history-plan',{attempt_id:f.attemptId,draft_revision:2})).rejects.toThrow()
      expect(transport.report().failed).toBe(true);expect(fetcher).toHaveBeenCalledTimes(3);return
    }
    await flow.run('history-plan',{attempt_id:f.attemptId,draft_revision:2})
    const body=transport.historyWriteRequest()
    if(profile==='no-op'){expect(body).toBeNull();expect(fetcher).toHaveBeenCalledTimes(3)}
    else {expect(body).toMatchObject({attempt_id:f.attemptId,draft_revision:2,expected_last:last,collapse:profile==='collapse',trigger:profile==='submit'?'submit':profile==='baseline'?'baseline':'autosave'})
      if(profile==='patch'){expect(body?.snapshot).toBeNull();expect(body?.patch).toHaveLength(1)}else expect(body?.snapshot).toEqual(next)
      if(profile==='collapse')expect(body).toMatchObject({paste_word_count:3,keystroke_count:6})
      if(expiry==='before-write')await expect(flow.run('history-write',body as never)).rejects.toMatchObject({statusCode:409})
      else await flow.run('history-write',body as never)
      expect(fetcher).toHaveBeenCalledTimes(4)}
    expect(transport.report()).toMatchObject({complete:true,failed:false,nativeVerified:false})
    expect(guard).toHaveBeenCalledTimes(profile==='no-op'?6:8)
    } finally {clock.mockRestore()}
  })
})
