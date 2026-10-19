import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { PassThrough, Writable } from 'node:stream'
import type * as http from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createContextualTestPlan, type ContextualTestProofScope } from '../../e2e/helpers/contextual-test-rehearsal'
import { ContextualTestGatewayPolicy, createContextualTestGateways, contextualTestGatewayTarget,
  contextualTestGatewayRedirect, contextualTestGatewayBodyLimit, type ContextualTestGatewayEdges } from '../../scripts/contextual-test-rehearsal-gateway'

const plan = createContextualTestPlan('pika_assignment_list_1a2b3c4d5e6f')
const testId = '50000000-0000-4000-8000-000000000044'
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function harness(now = () => 1000, proofScope?: ContextualTestProofScope) {
  const servers: Array<EventEmitter & { handler: http.RequestListener; listen: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = []
  const upstreams: Array<{ options: http.RequestOptions; callback: (response: http.IncomingMessage) => void; request: Writable; bytes: Buffer[] }> = []
  const edges: ContextualTestGatewayEdges = {
    now,
    createServer(handler) {
      const server = Object.assign(new EventEmitter(), { handler,
        listen: vi.fn((_port, _host, ready) => { queueMicrotask(ready); return server }),
        close: vi.fn(done => { queueMicrotask(() => done()); return server }),
        closeAllConnections: vi.fn(), closeIdleConnections: vi.fn() })
      servers.push(server); return server as unknown as http.Server
    },
    request(options, callback) {
      const bytes: Buffer[] = []
      const request = new Writable({ autoDestroy: false, write(chunk, _encoding, done) { bytes.push(Buffer.from(chunk)); done() } })
      upstreams.push({ options, callback, request, bytes }); return request as http.ClientRequest
    },
  }
  const input = { plan: proofScope ? createContextualTestPlan(plan.projectId,proofScope) : plan, deadline: 2_701_000, proofScope }
  const gateways = createContextualTestGateways(input, edges)
  function incoming(kind: 'app' | 'api', path: string, method = 'GET', body = '', extra: http.IncomingHttpHeaders = {}, endBody = true) {
    const request = Object.assign(new PassThrough(), { method, url: path, headers: { host: kind === 'app' ? 'localhost:3117' : '127.0.0.1:54340', ...extra }, rawHeaders: [] })
    const done = deferred<void>()
    const response = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, status: 0, headers: {} as http.OutgoingHttpHeaders, bytes: Buffer.alloc(0),
      writeHead(status: number, headers: http.OutgoingHttpHeaders) { response.status = status; response.headers = headers; return response },
      end(bytes?: Buffer) { response.bytes = bytes ?? Buffer.alloc(0); response.writableEnded = true; done.resolve(); return response },
      destroy() { response.destroyed = true; done.resolve(); return response } })
    servers[kind === 'app' ? 0 : 1].handler(request as unknown as http.IncomingMessage, response as unknown as http.ServerResponse)
    if (endBody) request.end(body); return { request, response, done: done.promise }
  }
  function respond(index: number, body: string | Buffer, headers: http.IncomingHttpHeaders = { 'content-type': 'application/json' }, status = 200) {
    const response = Object.assign(new PassThrough(), { headers, statusCode: status, rawHeaders: [] })
    upstreams[index].callback(response as unknown as http.IncomingMessage); response.end(body); return response
  }
  return { gateways, input, servers, upstreams, incoming, respond }
}
const flush = async () => { await new Promise<void>(resolve => setImmediate(resolve)) }

describe('Survey successor browser capability', () => {
  const scope = 'survey-workflow-v1' as const
  const surveyPlan = () => createContextualTestPlan(plan.projectId, scope)
  const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12,'0')}`
  const host = 'localhost:3117', cookie = 'pika_session=owned-synthetic-session'
  function policy() {
    const p = surveyPlan(), gateway = new ContextualTestGatewayPolicy(p, 2_701_000, () => 1000, scope)
    gateway.admit('app','/api/auth/login',host,'POST',{email:p.actors.ownerTeacher.email,password:'synthetic-password'})
    gateway.observeAppResponse('app','/api/auth/login','POST',200,{user:p.actors.ownerTeacher},
      {email:p.actors.ownerTeacher.email}, undefined, ['pika_session=owned-synthetic-session; Path=/; HttpOnly'])
    const admit = (path: string, method='GET', body?: unknown) => gateway.admit('app',path,host,method,body,cookie)
    const create = (n=1) => {
      const body = {classroom_id:p.classrooms.classA.id}
      admit('/api/teacher/surveys','POST',body)
      gateway.observeAppResponse('app','/api/teacher/surveys','POST',201,{survey:{id:id(n),classroom_id:p.classrooms.classA.id,created_by:p.actors.ownerTeacher.id}},body,cookie)
      return id(n)
    }
    const question = (parent: string, n: number) => {
      const path = `/api/teacher/surveys/${parent}/questions`
      admit(path,'POST',{question_type:'short_text',question_text:'Synthetic question',options:[],response_max_chars:500})
      gateway.observeAppResponse('app',path,'POST',201,{question:{id:id(n),survey_id:parent}})
      return id(n)
    }
    return {p,gateway,admit,create,question}
  }
  it('rejects absent/forged scope and changed fixture ceilings', () => {
    expect(() => new ContextualTestGatewayPolicy(surveyPlan(),2_701_000,()=>1000)).toThrow()
    expect(() => new ContextualTestGatewayPolicy(surveyPlan(),2_701_000,()=>1000,'forged' as never)).toThrow()
    const forged = {...surveyPlan(),surveyLimits:{surveys:5,questionsPerSurvey:2,uploads:0,screenshots:16}}
    expect(() => new ContextualTestGatewayPolicy(forged as never,2_701_000,()=>1000,scope)).toThrow()
    expect(() => new ContextualTestGatewayPolicy(plan,2_701_000,()=>1000,scope)).toThrow()
  })
  it('requires a real login acknowledgement and refuses foreign/duplicate cookies', () => {
    const h=policy()
    expect(() => h.gateway.admit('app',`/api/teacher/surveys?classroom_id=${h.p.classrooms.classA.id}`,host,'GET',undefined,'pika_session=foreign')).toThrow()
    const other=policy()
    expect(() => other.gateway.admit('app',`/api/teacher/surveys?classroom_id=${other.p.classrooms.classA.id}`,host,'GET',undefined,`${cookie}; ${cookie}`)).toThrow()
  })
  it.each(['classA','classB'] as const)('admits the unconditional member summary Gradebook GET for %s without interpreting legacy403 as failure', classroom => {
    const h=policy(), path=`/api/student/classrooms/${h.p.classrooms[classroom].id}/gradebook-items`
    expect(() => h.admit(path)).not.toThrow()
    expect(() => h.gateway.observeAppResponse('app',path,'GET',403,{error:'Forbidden'})).not.toThrow()
    expect(h.gateway.receipt()).toMatchObject({firstFailure:null,appRequests:2})
  })
  it.each(['foreign-class','query','teacher-path','HEAD','POST','PATCH','DELETE','unbound-session'])('keeps Gradebook companion %s closed', defect => {
    const h=policy(), classroom=h.p.classrooms.classA.id
    const path=defect==='foreign-class' ? `/api/student/classrooms/${id(99)}/gradebook-items`
      : defect==='teacher-path' ? `/api/teacher/classrooms/${classroom}/gradebook-items`
      : `/api/student/classrooms/${classroom}/gradebook-items${defect==='query'?'?classroom_id='+classroom:''}`
    const method=['HEAD','POST','PATCH','DELETE'].includes(defect)?defect:'GET'
    expect(() => h.gateway.admit('app',path,host,method,undefined,defect==='unbound-session'?undefined:cookie)).toThrow()
  })
  it.each([undefined,'vertical-v1','vertical-grade-return-v1','lifecycle-permissions-v1'] as const)('keeps Gradebook companion denied in historical profile %s', old => {
    const legacy=new ContextualTestGatewayPolicy(createContextualTestPlan(plan.projectId,old),2_701_000,()=>1000,old)
    expect(() => legacy.admit('app',`/api/student/classrooms/${plan.classrooms.classA.id}/gradebook-items`,host,'GET')).toThrow()
  })
  it('admits known parents, companion reads, bounded reorder and both-fixture denial probes', () => {
    const h=policy(), first=h.create(1), second=h.create(2), q=h.question(first,11), foreign=h.question(second,12)
    h.admit(`/api/teacher/surveys?classroom_id=${h.p.classrooms.classB.id}`)
    h.admit(`/api/teacher/assignments?classroom_id=${h.p.classrooms.classA.id}`)
    h.admit(`/api/student/classrooms/${h.p.classrooms.classB.id}/materials`)
    h.admit(`/api/teacher/classrooms/${h.p.classrooms.classA.id}/classwork/reorder`,'POST',{items:[{type:'survey',id:second},{type:'survey',id:first}]})
    h.admit(`/api/teacher/surveys/${first}/questions/${foreign}`,'PATCH',{question_text:'Forbidden foreign question'})
    h.gateway.observeAppResponse('app',`/api/teacher/surveys/${first}/questions/${foreign}`,'PATCH',404,{error:'Question not found'})
    h.admit(`/api/teacher/surveys/${first}/questions/${q}`,'DELETE')
    h.gateway.observeAppResponse('app',`/api/teacher/surveys/${first}/questions/${q}`,'DELETE',200,{success:true})
    expect(() => h.admit(`/api/teacher/surveys/${first}/questions/${q}`,'PATCH',{question_text:'stale'})).toThrow()
  })
  it.each(['unknown','extra-query','duplicate-query','outside-class','wrong-method','parent-substitution','upload','test-write','provider'])('rejects %s browser capability', defect => {
    const h=policy(), parent=h.create(), q=h.question(parent,11)
    const routes: Record<string,[string,string,unknown?]> = {
      unknown:[`/api/teacher/surveys/${id(99)}`,'GET'],
      'extra-query':[`/api/teacher/surveys?classroom_id=${h.p.classrooms.classA.id}&extra=true`,'GET'],
      'duplicate-query':[`/api/teacher/surveys?classroom_id=${h.p.classrooms.classA.id}&classroom_id=${h.p.classrooms.classA.id}`,'GET'],
      'outside-class':[`/api/student/surveys?classroom_id=${id(99)}`,'GET'],
      'wrong-method':[`/api/student/surveys/${parent}`,'DELETE'],
      'parent-substitution':[`/api/teacher/surveys/${parent}`,'PATCH',{classroom_id:h.p.classrooms.classB.id}],
      upload:[`/api/teacher/surveys/${parent}/questions/${q}/upload`,'POST',{}],
      'test-write':['/api/teacher/tests','POST',{classroom_id:h.p.classrooms.classA.id}],
      provider:['/api/teacher/ai/generate','POST',{}],
    }
    expect(() => h.admit(...routes[defect])).toThrow()
  })
  it('enforces total creation/question caps and deleted-parent freshness', () => {
    const h=policy(), parent=h.create(); h.question(parent,11); h.question(parent,12)
    expect(() => h.question(parent,13)).toThrow()
    const full=policy(); for(let n=1;n<=4;n++)full.create(n)
    expect(() => full.create(5)).toThrow()
    const removed=policy(), old=removed.create()
    removed.admit(`/api/teacher/surveys/${old}`,'DELETE')
    removed.gateway.observeAppResponse('app',`/api/teacher/surveys/${old}`,'DELETE',200,{success:true})
    expect(() => removed.gateway.observeAppResponse('app',`/api/teacher/surveys/${old}`,'GET',200,{survey:{id:old}})).not.toThrow()
    expect(() => removed.admit(`/api/student/surveys/${old}`)).toThrow()
  })
  it('rejects forged create and successful foreign-question acknowledgements', () => {
    const h=policy()
    expect(() => h.gateway.observeAppResponse('app','/api/teacher/surveys','POST',201,{survey:{id:id(1),classroom_id:h.p.classrooms.classA.id,created_by:h.p.actors.nonmember.id}}, {classroom_id:h.p.classrooms.classA.id},cookie)).toThrow()
    const other=policy(), first=other.create(1), second=other.create(2), q=other.question(second,11)
    expect(() => other.gateway.observeAppResponse('app',`/api/teacher/surveys/${first}/questions/${q}`,'PATCH',200,{})).toThrow()
  })
  it.each([undefined,'vertical-v1','vertical-grade-return-v1','lifecycle-permissions-v1'] as const)('preserves %s Survey denial and backend isolation policy', old => {
    const legacy = new ContextualTestGatewayPolicy(createContextualTestPlan(plan.projectId,old),2_701_000,()=>1000,old)
    legacy.admit('api','/rest/v1/rpc/get_surveys_for_owner_v1','127.0.0.1:54340','POST',{})
    expect(() => legacy.admit('app',`/api/teacher/surveys?classroom_id=${plan.classrooms.classA.id}`,host,'GET')).toThrow()
  })
})

describe('fixed contextual Test HTTP gateway policy', () => {
  it.each([
    ['inspect', 'test_owner_invalid_deadline', 'inspect', 'invalid-deadline'],
    ['results', 'test_owner_invalid_input', 'results', 'invalid-input'],
    ['private-operation', 'private-error', 'other', 'other'],
  ])('records only fixed RPC rejection labels for %s', async (operation, message, expectedOperation, reason) => {
    const h = harness(); await h.gateways.start()
    const body = JSON.stringify({ p_operation: operation, p_payload: { secret: 'private-answer' } })
    const incoming = h.incoming('api', '/rest/v1/rpc/test_owner_workflow_v1', 'POST', body, { 'content-type': 'application/json' })
    await flush()
    const error = JSON.stringify({ code: 'PT400', message, details: 'private-detail', hint: 'private-hint' })
    h.respond(0, error, { 'content-type': 'application/json' }, 400); await incoming.done
    expect(incoming.response.status).toBe(400); expect(incoming.response.bytes.toString()).toBe(error)
    expect(h.gateways.receipt().firstOwnerRpcRejection).toEqual({ operation: expectedOperation, reason })
    expect(Object.isFrozen(h.gateways.receipt().firstOwnerRpcRejection)).toBe(true)
    expect(JSON.stringify(h.gateways.receipt())).not.toContain('private')
    expect(h.gateways.receipt().firstFailure).toBeNull()
    await h.gateways.close(2000)
  })
  it('ignores unrelated or successful responses and retains only the first matching rejection', () => {
    const p = new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000)
    const path = '/rest/v1/rpc/test_owner_workflow_v1', request = { p_operation: 'inspect' }, response = { code: 'PT400', message: 'test_owner_invalid_input' }
    for (const [kind, target, method, status, reply] of [
      ['app', path, 'POST', 400, response], ['api', path + '?x=1', 'POST', 400, response],
      ['api', path, 'GET', 400, response], ['api', path, 'POST', 200, response],
      ['api', path, 'POST', 403, response], ['api', path, 'POST', 400, { code: 'PT403' }],
      ['api', path, 'POST', 400, null], ['api', path, 'POST', 400, []],
    ] as const) p.observeOwnerRpc(kind, target, method, status, request, reply)
    expect(p.receipt().firstOwnerRpcRejection).toBeNull()
    p.observeOwnerRpc('api', path, 'POST', 400, request, response)
    p.observeOwnerRpc('api', path, 'POST', 400, { p_operation: 'results' }, { code: 'PT400', message: 'test_owner_invalid_deadline' })
    expect(p.receipt().firstOwnerRpcRejection).toEqual({ operation: 'inspect', reason: 'invalid-input' })
  })
  it.each(['http://localhost:3117/api/auth/me', '//example.test/x', '/a/../api/auth/me', '/%2e%2e/api/auth/me', '/api%2fauth/me', '/api/%2561uth/me', '/api\\auth/me', '/api//auth/me', '/api/auth/me#x', '/api/auth/me?x=%00', '/api/auth/me?x=%zz'])('rejects ambiguous target %s', value => {
    expect(() => contextualTestGatewayTarget('app', value, 'localhost:3117')).toThrow('Private contextual Test gateway')
  })
  it.each(['example.test', 'localhost:3118', 'secret@localhost:3117', 'localhost:3117, example.test'])('rejects nonpublic app Host %s', host => {
    expect(() => contextualTestGatewayTarget('app', '/api/auth/me', host)).toThrow()
  })
  it('allows canonical PostgREST query encoding and fixed public relative targets', () => {
    expect(contextualTestGatewayTarget('api', '/rest/v1/tests?select=id&or=%28id.eq.a,id.eq.b%29', '127.0.0.1:54340')).toContain('/rest/v1/tests?')
    expect(contextualTestGatewayTarget('app', '/classrooms?x=1', 'localhost:3117')).toBe('/classrooms?x=1')
  })
  it.each(['https://example.test/secret', '//example.test/x', 'http://secret@localhost:3117/x', 'http://localhost:3118/x', '/a/../x', '/%2fexample.test/x'])('rejects foreign or normalized redirect %s', value => {
    expect(() => contextualTestGatewayRedirect('app', value)).toThrow()
  })
  it('preserves legitimate Location exactly', () => {
    expect(contextualTestGatewayRedirect('app', '/classrooms')).toBe('/classrooms')
    expect(contextualTestGatewayRedirect('app', 'http://localhost:3117/classrooms')).toBe('http://localhost:3117/classrooms')
  })
  it('uses finite caps for every response class', () => {
    expect(contextualTestGatewayBodyLimit('api', 'text/plain')).toBe(1048576)
    expect(contextualTestGatewayBodyLimit('app', 'application/problem+json')).toBe(1048576)
    expect(contextualTestGatewayBodyLimit('app', 'text/javascript')).toBe(67108864)
  })
  it('charges at most one create, including an unsuccessful create dispatch', () => {
    const p = new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000)
    p.admit('app', '/api/teacher/tests', 'localhost:3117', 'POST', { classroom_id: plan.classrooms.classB.id })
    expect(() => p.admit('app', '/api/teacher/tests', 'localhost:3117', 'POST', { classroom_id: plan.classrooms.classB.id })).toThrow()
    expect(p.receipt().creates).toBe(1); expect(p.receipt().firstFailure).toBe('create-cap')
  })
  it.each(['/api/billing/x', '/api/teacher/tests/x/ai-grade', '/api/auth/signup', '/api/teacher/tests/x/documents/upload', '/api/student/pal/classroom-visit'])('rejects unrelated app mutations %s', path => {
    expect(() => new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000).admit('app', path, 'localhost:3117', 'POST', {})).toThrow()
  })
  it('retains exact finite endpoint and request ceilings', () => {
    const app = new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000)
    for (let i = 0; i < 950; i++) app.admit('app', '/api/auth/me', 'localhost:3117', 'GET')
    expect(() => app.admit('app', '/api/auth/me', 'localhost:3117', 'GET')).toThrow()
    expect(app.receipt().appRequests).toBe(950)
    const api = new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000)
    for (let i = 0; i < 4000; i++) api.admit('api', '/rest/v1/tests', '127.0.0.1:54340', 'GET')
    expect(() => api.admit('api', '/rest/v1/tests', '127.0.0.1:54340', 'GET')).toThrow()
    expect(api.receipt().apiRequests).toBe(4000)
  })
  it.each(['/storage/v1/object/x', '/auth/v1/token', '/rest/v1/../storage/v1/x'])('denies non-REST API target %s', path => {
    expect(() => new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000).admit('api', path, '127.0.0.1:54340', 'GET')).toThrow()
  })
  it.each([
    ['GET', `/api/teacher/tests/${testId}/draft`], ['GET', `/api/teacher/tests/${testId}/results`],
    ['PATCH', `/api/teacher/tests/${testId}/draft`], ['PATCH', `/api/teacher/tests/${testId}`],
    ['POST', `/api/teacher/tests/${testId}/publish`], ['POST', `/api/teacher/tests/${testId}/student-access`],
    ['POST', `/api/student/tests/${testId}/start`], ['PATCH', `/api/student/tests/${testId}/attempt`],
    ['POST', `/api/student/tests/${testId}/respond`], ['GET', `/api/student/tests/${testId}/results`],
  ])('allows the approved %s %s operation', (method, path) => {
    const p = new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000)
    expect(() => p.admit('app', path, 'localhost:3117', method, {})).not.toThrow()
    expect(p.receipt()).toMatchObject({ appRequests: 1, firstFailure: null })
  })
  it('sanitizes even an invalid internal failure category without coercion', () => {
    const p = new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000)
    const secret = { toString() { throw Error('private-secret') } }
    p.latch(secret as never); expect(p.receipt().firstFailure).toBe('protocol')
    expect(JSON.stringify(p.receipt())).not.toContain('secret')
  })
  it('records fixed endpoint labels without changing rejection or retaining request data', () => {
    const p = new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000)
    expect(() => p.admit('app', '/__nextjs_original-stack-frames?secret=private-value', 'localhost:3117', 'POST', { secret: 'private-body' })).toThrow()
    expect(p.receipt()).toMatchObject({ firstFailure: 'endpoint', appRequests: 0,
      firstEndpointFailure: { kind: 'app', method: 'POST', route: 'framework-stack-frames' } })
    expect(() => p.admit('app', '/api/student/notifications', 'localhost:3117', 'GET')).toThrow()
    expect(p.receipt().firstEndpointFailure?.route).toBe('framework-stack-frames')
    expect(Object.isFrozen(p.receipt().firstEndpointFailure)).toBe(true)
    expect(JSON.stringify(p.receipt())).not.toMatch(/private|secret|__nextjs|notifications/)
  })
  it('maps unknown endpoint and method values to fixed labels', () => {
    const p = new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000)
    expect(() => p.admit('app', '/private-path?private-query=value', 'localhost:3117', 'private-method')).toThrow()
    expect(p.receipt().firstEndpointFailure).toEqual({ kind: 'app', method: 'other', route: 'unknown' })
    expect(JSON.stringify(p.receipt())).not.toContain('private')
  })
  // StudentClassroomsIndex mounts this read even with the attendance integration
  // disabled. The frozen handler reads local state; it does not contact Bara.
  it.each(['/pika-icon-light.svg', '/pika-icon-dark.svg', `/api/classrooms/${plan.classrooms.classB.id}/class-days`, '/api/auth/me', '/api/student/attendance/status'])('admits the exact frozen Tests shell read %s', path => {
    expect(() => new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000).admit('app', path, 'localhost:3117', 'GET')).not.toThrow()
  })
  it.each([
    ['GET', `/api/classrooms/${testId}/class-days`], ['POST', `/api/classrooms/${plan.classrooms.classB.id}/class-days`],
    ['POST', '/api/student/attendance/status'], ['POST', '/api/student/attendance/check-in'],
    ['GET', '/api/student/attendance/status/extra'], ['GET', '/api/student/attendance'],
    ['GET', '/api/teacher/assignments'], ['POST', '/api/auth/workos/logout'], ['POST', '/api/feedback'],
    ['POST', `/api/teacher/tests/${testId}/documents/${testId}/sync`],
  ])('still rejects unrelated or mutating shell path %s %s', (method, path) => {
    expect(() => new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000).admit('app', path, 'localhost:3117', method, {})).toThrow()
  })
  it('admits only the exact fixture Test provenance read without granting guided drafting', () => {
    const path = `/api/teacher/classrooms/${plan.classrooms.classB.id}/authoring-drafts/provenance`
    const query = `?target=tests&artifact_id=${testId}`
    expect(() => new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000).admit('app', path + query, 'localhost:3117', 'GET')).not.toThrow()
    for (const target of [path, path + query + '&extra=1', path + query + '&target=tests',
      path + query.replace('target=tests', 'target=assignments'), path + query.replace(testId, 'invalid'),
      path.replace(plan.classrooms.classB.id, testId) + query, path.replace('provenance', 'suggest') + query]) {
      expect(() => new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000).admit('app', target, 'localhost:3117', 'GET')).toThrow()
    }
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      expect(() => new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000).admit('app', path + query, 'localhost:3117', method, {})).toThrow()
    }
  })
  it('admits the member shell notification read only for one exact fixture classroom', () => {
    const path = `/api/student/notifications?classroom_id=${plan.classrooms.classB.id}`
    expect(() => new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000).admit('app', path, 'localhost:3117', 'GET')).not.toThrow()
    for (const target of ['/api/student/notifications', path + '&extra=1', path + '&classroom_id=' + plan.classrooms.classA.id,
      path.replace(plan.classrooms.classB.id, testId), path.replace('notifications?', 'notifications/read?')]) {
      expect(() => new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000).admit('app', target, 'localhost:3117', 'GET')).toThrow()
    }
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      expect(() => new ContextualTestGatewayPolicy(plan, 2_701_000, () => 1000).admit('app', path, 'localhost:3117', method, {})).toThrow()
    }
  })
})

describe('contextual Test gateway original-byte ownership with fake HTTP I/O', () => {
  it.each(['request-body', 'upstream-headers', 'response-body'] as const)('observes the first %s deadline at the unchanged 30 second end', async phase => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000); const h = harness(Date.now); await h.gateways.start()
      expect(h.gateways.receipt().firstDeadline).toBeNull()
      const call = h.incoming('app', '/api/auth/login', 'POST', '{"private-password":"secret"}',
        { 'content-type': 'application/json', cookie: 'private-cookie' }, phase !== 'request-body')
      await vi.advanceTimersByTimeAsync(0)
      if (phase === 'response-body') {
        const response = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'application/json' } })
        h.upstreams[0].callback(response as unknown as http.IncomingMessage); response.write('{"private-response":')
      }
      await vi.advanceTimersByTimeAsync(29999)
      expect(h.gateways.receipt().firstDeadline).toBeNull()
      expect(call.response.destroyed).toBe(false)
      await vi.advanceTimersByTimeAsync(1); await call.done
      const first = h.gateways.receipt().firstDeadline
      expect(first).toEqual({ kind: 'app', method: 'POST', route: 'auth-login', phase,
        observedAt: 31000, elapsedMs: 30000, detached: false, closing: false })
      expect(Object.isFrozen(first)).toBe(true)
      expect(h.gateways.receipt()).toMatchObject({ firstFailure: 'deadline', pending: 0, sockets: 0, responses: 0 })
      await h.gateways.close(32000)
      expect(h.gateways.receipt().firstDeadline).toBe(first)
      expect(JSON.stringify(h.gateways.receipt())).not.toMatch(/private|secret|password|cookie|\/api\//)
      expect(h.gateways.receipt()).toMatchObject({ closed: true, pending: 0, sockets: 0 })
    } finally { vi.useRealTimers() }
  })
  it.each(['request-body', 'upstream-headers', 'response-validation', 'active-check'] as const)('observes a late %s callback before its existing rejection', async point => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000); const h = harness(Date.now); await h.gateways.start()
      const call = h.incoming('api', '/rest/v1/tests?private=secret', 'GET', '', {}, point !== 'request-body'); await vi.advanceTimersByTimeAsync(0)
      const response = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'application/json' } })
      if (point !== 'request-body' && point !== 'upstream-headers') h.upstreams[0].callback(response as unknown as http.IncomingMessage)
      vi.setSystemTime(31000)
      if (point === 'active-check') expect(() => h.gateways.check()).toThrow()
      else if (point === 'request-body') { call.request.end(); await vi.advanceTimersByTimeAsync(0) }
      else if (point === 'upstream-headers') h.upstreams[0].callback(response as unknown as http.IncomingMessage)
      else { response.end('{}'); await vi.advanceTimersByTimeAsync(0) }
      expect(h.gateways.receipt().firstDeadline).toEqual({ kind: 'api', method: 'GET', route: 'rest',
        phase: point === 'active-check' ? 'response-body' : point, observedAt: 31000, elapsedMs: 30000, detached: false, closing: false })
      await vi.advanceTimersByTimeAsync(30000); await call.done; await h.gateways.close(62000)
      expect(h.gateways.receipt()).toMatchObject({ closed: true, pending: 0, sockets: 0 })
    } finally { vi.useRealTimers() }
  })
  it('records detachment and closing without replacing an earlier mutation failure or first observation', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000); const h = harness(Date.now); await h.gateways.start()
      const call = h.incoming('app', '/api/auth/login', 'POST', '{}', { 'content-type': 'application/json' })
      await vi.advanceTimersByTimeAsync(0); call.response.emit('close')
      const close = h.gateways.close(32000)
      await vi.advanceTimersByTimeAsync(30000); await call.done; await close
      expect(h.gateways.receipt()).toMatchObject({ firstFailure: 'mutation-cancelled', firstDeadline: {
        kind: 'app', method: 'POST', route: 'auth-login', phase: 'upstream-headers', observedAt: 31000,
        elapsedMs: 30000, detached: true, closing: true }, closed: true, pending: 0, sockets: 0 })
      const first = h.gateways.receipt().firstDeadline
      vi.setSystemTime(2_701_000); expect(() => h.gateways.check()).toThrow()
      expect(h.gateways.receipt().firstDeadline).toBe(first)
    } finally { vi.useRealTimers() }
  })
  it.each(['receipt', 'check', 'close'] as const)('records a bounded global observation from %s', async point => {
    let now = 1000; const h = harness(() => now); await h.gateways.start(); now = 2_701_001
    if (point === 'check') expect(() => h.gateways.check()).toThrow()
    if (point === 'close') await h.gateways.close(2_702_000)
    expect(h.gateways.receipt().firstDeadline).toEqual({ kind: 'control', method: 'other', route: 'global', phase: 'global',
      observedAt: now, elapsedMs: 2_700_000, detached: false, closing: point === 'close' })
    if (point !== 'close') await h.gateways.close(2_702_000)
  })
  it.each([undefined,'vertical-v1','vertical-grade-return-v1','lifecycle-permissions-v1'] as const)('lets the installed Next overlay fall back after the real empty diagnostic denial for %s', async scope => {
    const { getOriginalStackFrames } = createRequire(import.meta.url)('next/dist/next-devtools/shared/stack-frame.js')
    const h = harness(undefined,scope); await h.gateways.start()
    const fetch = vi.fn(async (target: string, options: { method: string; body: string }) => {
      const call = h.incoming('app', target, options.method, options.body, { 'content-type': 'text/plain;charset=UTF-8' })
      await call.done
      expect(call.response.status).toBe(404)
      expect(call.response.bytes.length).toBe(0)
      return new Response('', { status: call.response.status })
    })
    vi.stubGlobal('fetch', fetch)
    try {
      const frames = [{ file: 'webpack-internal:///(app-pages-browser)/./src/components/StudentNotificationsProvider.tsx', line1: 87, column1: 1, methodName: 'fetchNotifications' }]
      const result = await getOriginalStackFrames(frames, 'client', true)
      expect(fetch).toHaveBeenCalledOnce()
      expect(result).toMatchObject([{ error: true, originalStackFrame: null, originalCodeFrame: null }])
      expect(h.upstreams).toHaveLength(0)
      expect(h.gateways.receipt()).toMatchObject({ firstFailure: null, rejectedDiagnostics: 1, pending: 0 })
      const next = h.incoming('app','/api/auth/me'); await flush(); h.respond(0,'{}'); await next.done
      expect(next.response.status).toBe(200)
    } finally { vi.unstubAllGlobals(); await h.gateways.close(2000) }
  })
  it.each([
    ['POST', '/__nextjs_original-stack-frames', '{"frames":[],"isServer":false,"isEdgeServer":false,"isAppDirectory":true}'],
    ['GET', '/__nextjs_font/geist-latin.woff2', ''],
    ['HEAD', '/__nextjs_font/geist-mono-latin-ext.woff2', ''],
  ])('denies optional development metadata locally without upstream dispatch: %s %s', async (method, target, body) => {
    const h = harness(); await h.gateways.start()
    const call = h.incoming('app', target, method, body, { 'content-type': 'text/plain;charset=UTF-8' }); await call.done
    expect(call.response.status).toBe(404); expect(call.response.bytes.length).toBe(0)
    expect(h.upstreams).toHaveLength(0)
    expect(h.gateways.receipt()).toMatchObject({ firstFailure: null, firstEndpointFailure: null,
      appRequests: 1, rejectedDiagnostics: 1, pending: 0, creates: 0 })
    const app = h.incoming('app', '/api/auth/me'); await flush(); h.respond(0, '{}'); await app.done
    expect(app.response.status).toBe(200); await h.gateways.close(2000)
  })
  it.each(['malformed','oversize','foreign-origin','query','method','endpoint'] as const)('retains lifecycle diagnostic denials for %s',async mode=>{
    const h=harness(undefined,'lifecycle-permissions-v1');await h.gateways.start()
    const path=mode==='query'?'/__nextjs_original-stack-frames?extra=1':mode==='endpoint'?'/__nextjs_launch-editor':'/__nextjs_original-stack-frames'
    const call=h.incoming('app',path,mode==='method'?'PATCH':'POST',mode==='oversize'?'x'.repeat(1048577):mode==='malformed'?'{':'{}',
      mode==='foreign-origin'?{origin:'http://foreign.invalid'}:{})
    await call.done;expect(h.upstreams).toHaveLength(0)
    expect(h.gateways.receipt().firstFailure).toBe(mode==='oversize'?'request-size':mode==='foreign-origin'?'target':mode==='malformed'?'request-json':'endpoint')
    await h.gateways.close(2000)
  })
  it.each([
    ['POST', '/__nextjs_original-stack-frames?extra=1'], ['GET', '/__nextjs_original-stack-frames'],
    ['POST', '/__nextjs_launch-editor'], ['GET', '/__nextjs_source-map'],
    ['POST', '/__nextjs_font/geist-latin.woff2'], ['GET', '/__nextjs_font/other.woff2'],
    ['GET', '/__nextjs_font/geist-latin.woff2?extra=1'],
  ])('retains fail-closed handling for adjacent development endpoints: %s %s', async (method, target) => {
    const h = harness(); await h.gateways.start(); const call = h.incoming('app', target, method)
    await call.done; expect(h.upstreams).toHaveLength(0)
    expect(h.gateways.receipt()).toMatchObject({ firstFailure: 'endpoint', rejectedDiagnostics: 0 })
    await h.gateways.close(2000)
  })
  it.each(['malformed', 'oversize', 'foreign-origin'] as const)('retains body and origin checks on blocked development reads: %s', async mode => {
    const h = harness(); await h.gateways.start()
    const call = h.incoming('app', '/__nextjs_original-stack-frames', 'POST', mode === 'oversize' ? 'x'.repeat(1048577) : '{',
      mode === 'foreign-origin' ? { origin: 'http://foreign.invalid' } : {})
    await call.done; expect(h.upstreams).toHaveLength(0)
    expect(h.gateways.receipt().firstFailure).toBe(mode === 'oversize' ? 'request-size' : mode === 'foreign-origin' ? 'target' : 'request-json')
    await h.gateways.close(2000)
  })
  it('sanitizes synchronous server-construction failures without creating a default native listener', async () => {
    const gateways = createContextualTestGateways({ plan, deadline: 2_701_000 }, {
      now: () => 1000, createServer() { throw Error('private-secret') }, request() { throw Error('must not dispatch') },
    })
    await expect(gateways.start()).rejects.toThrow('Private contextual Test gateway')
    expect(gateways.receipt()).toMatchObject({ firstFailure: 'startup', started: false })
    expect(JSON.stringify(gateways.receipt())).not.toContain('private-secret'); await gateways.close(2000)
  })
  it('is inert before explicit start and forwards only fixed destinations, preserving public session headers', async () => {
    const h = harness(); expect(h.servers).toHaveLength(0)
    await h.gateways.start()
    expect(h.servers[0].listen).toHaveBeenCalledWith(3117, '127.0.0.1', expect.any(Function))
    expect(h.servers[1].listen).toHaveBeenCalledWith(54340, '127.0.0.1', expect.any(Function))
    const call = h.incoming('app', '/api/auth/login', 'POST', '{"email":"private"}', { origin: plan.appOrigin, cookie: 'private-cookie', 'content-type': 'application/json' })
    await flush()
    expect(h.upstreams[0].options).toMatchObject({ hostname: '127.0.0.1', port: 3118, path: '/api/auth/login', method: 'POST', agent: false,
      headers: { host: 'localhost:3117', origin: plan.appOrigin, cookie: 'private-cookie', 'accept-encoding': 'identity' } })
    h.respond(0, '{}', { 'content-type': 'application/json', 'set-cookie': ['pika_session=private; HttpOnly'], location: '/classrooms' }, 200)
    await call.done; expect(call.response.headers['set-cookie']).toEqual(['pika_session=private; HttpOnly']); expect(call.response.bytes.toString()).toBe('{}')
    expect(JSON.stringify(h.gateways.receipt())).not.toMatch(/private|localhost|http|email|cookie/)
    await h.gateways.close(2000); expect(h.gateways.receipt()).toMatchObject({ closed: true, pending: 0, firstFailure: null, jsonResponses: 1 })
  })
  it('buffers the complete original body before releasing any response headers', async () => {
    const h = harness(); await h.gateways.start(); const call = h.incoming('app', '/api/auth/me'); await flush()
    const upstream = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'application/json', 'content-length': '7' } })
    h.upstreams[0].callback(upstream as http.IncomingMessage); upstream.write('{"a":'); await flush()
    expect(call.response.status).toBe(0); expect(h.gateways.receipt().pending).toBe(1)
    upstream.end('1}'); await call.done; expect(call.response.bytes.toString()).toBe('{"a":1}'); await h.gateways.close(2000)
  })
  it.each(['app', 'api'] as const)('forces upstream identity encoding for %s without changing authentication headers', async kind => {
    const h = harness(); await h.gateways.start()
    const call = h.incoming(kind, kind === 'app' ? '/api/auth/me' : '/rest/v1/tests', 'GET', '', {
      'accept-encoding': 'gzip, br', cookie: 'private-cookie', authorization: 'Bearer private-key', origin: plan.appOrigin,
    }); await flush()
    expect(h.upstreams[0].options.headers).toMatchObject({ 'accept-encoding': 'identity', cookie: 'private-cookie',
      authorization: 'Bearer private-key', origin: plan.appOrigin, host: kind === 'app' ? 'localhost:3117' : '127.0.0.1:54340' })
    h.respond(0, '{}', { 'content-type': 'application/json', 'content-encoding': 'identity' }); await call.done
    expect(h.gateways.receipt()).toMatchObject({ firstFailure: null, jsonResponses: 1 }); await h.gateways.close(2000)
  })
  it.each([
    ['app', '/api/auth/me', 'application/json', 'gzip'],
    ['app', '/_next/static/chunks/a.js', 'text/javascript', 'br'],
    ['api', '/rest/v1/tests', 'application/json', 'gzip'],
    ['api', '/rest/v1/tests', 'text/plain', 'deflate'],
  ] as const)('rejects unexpected compression on %s response before releasing bytes', async (kind, path, mime, encoding) => {
    const h = harness(); await h.gateways.start(); const call = h.incoming(kind, path); await flush()
    h.respond(0, '{}', { 'content-type': mime, 'content-encoding': encoding }); await call.done
    expect(h.gateways.receipt()).toMatchObject({ firstFailure: 'response-body', responses: 0 }); expect(call.response.status).toBe(0)
    await h.gateways.close(2000)
  })
  it('continues validating a released GET when its browser leaves', async () => {
    const h = harness(); await h.gateways.start(); const call = h.incoming('app', '/api/auth/me'); await flush()
    call.response.emit('close'); expect(h.upstreams[0].request.destroyed).toBe(false)
    h.respond(0, '{'); await flush()
    expect(h.gateways.receipt()).toMatchObject({ firstFailure: 'response-json', pending: 0 }); await h.gateways.close(2000)
  })
  it('latches mutation cancellation without cancelling verification of already dispatched bytes', async () => {
    const h = harness(); await h.gateways.start(); const call = h.incoming('app', `/api/student/tests/${testId}/start`, 'POST', '{}', { 'content-type': 'application/json' }); await flush()
    call.response.emit('close'); expect(h.upstreams[0].request.destroyed).toBe(false)
    h.respond(0, '{}'); await flush()
    expect(h.gateways.receipt()).toMatchObject({ firstFailure: 'mutation-cancelled', pending: 0, jsonResponses: 1 }); await h.gateways.close(2000)
  })
  it.each(['request-size', 'request-json', 'response-size', 'response-json', 'redirect', 'upstream'] as const)('fails closed for %s without leaking payload or errors', async mode => {
    const h = harness(); await h.gateways.start()
    const call = h.incoming('app', '/api/auth/login', 'POST', mode === 'request-size' ? 'x'.repeat(1048577) : mode === 'request-json' ? '{secret' : '{}', { 'content-type': 'application/json' }); await flush()
    if (mode === 'response-size') h.respond(0, '{}', { 'content-type': 'application/json', 'content-length': '1048577' })
    if (mode === 'response-json') h.respond(0, '{private')
    if (mode === 'redirect') h.respond(0, '', { location: 'https://private-secret.test/' }, 302)
    if (mode === 'upstream') h.upstreams[0].request.emit('error', Error('private-secret'))
    await call.done; expect(h.gateways.receipt().firstFailure).toBe(mode)
    expect(call.response.bytes.toString()).not.toMatch(/private|secret/); expect(JSON.stringify(h.gateways.receipt())).not.toMatch(/private|secret/)
    if (mode.startsWith('request-')) expect(h.upstreams).toHaveLength(0)
    await h.gateways.close(2000)
  })
  it('keeps the absolute original operation end through headers and stalled response bytes', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000); const h = harness(Date.now); await h.gateways.start(); const call = h.incoming('app', '/api/auth/me')
      await vi.advanceTimersByTimeAsync(29999)
      const response = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'application/json' } })
      h.upstreams[0].callback(response as http.IncomingMessage); response.write('{')
      await vi.advanceTimersByTimeAsync(1); await call.done
      expect(h.gateways.receipt()).toMatchObject({ firstFailure: 'deadline', pending: 0 })
      await h.gateways.close(32000)
    } finally { vi.useRealTimers() }
  })
  it('keeps its original whole deadline even if caller metadata is later changed', async () => {
    let now = 1000
    const h = harness(() => now); await h.gateways.start(); h.input.deadline = 9_000_000; now = 2_701_000
    expect(h.gateways.receipt().firstFailure).toBe('deadline'); expect(() => h.gateways.check()).toThrow()
    await h.gateways.close(2_702_000); expect(h.gateways.receipt()).toMatchObject({ closed: true, firstFailure: 'deadline' })
  })
  it('rejects all CONNECT and arbitrary Upgrade while exact HMR is benign and counted', async () => {
    const h = harness(); await h.gateways.start()
    const socket = () => Object.assign(new EventEmitter(), { destroy: vi.fn() })
    const hmr = socket(); h.servers[0].emit('upgrade', { method: 'GET', url: '/_next/webpack-hmr', headers: { host: 'localhost:3117' } }, hmr)
    expect(hmr.destroy).toHaveBeenCalledOnce(); expect(h.gateways.receipt()).toMatchObject({ firstFailure: null, appRequests: 1, rejectedHmr: 1 })
    h.servers[1].emit('connect', {}, socket()); expect(h.gateways.receipt().firstFailure).toBe('protocol')
    await h.gateways.close(2000)
  })
  it('closes listeners and every tracked socket before acknowledging closure', async () => {
    const h = harness(); await h.gateways.start(); const socket = Object.assign(new EventEmitter(), { destroy: vi.fn(function () { socket.emit('close') }) })
    h.servers[0].emit('connection', socket); await h.gateways.close(2000)
    expect(socket.destroy).toHaveBeenCalledOnce(); expect(h.servers.every(s => s.close.mock.calls.length === 1)).toBe(true)
    expect(h.gateways.receipt()).toMatchObject({ closed: true, pending: 0, sockets: 0 })
  })
  it('charges a stalled request before its body arrives and never dispatches after close starts', async () => {
    const h = harness(); await h.gateways.start()
    const request = Object.assign(new PassThrough(), { method: 'GET', url: '/api/auth/me', headers: { host: 'localhost:3117' }, rawHeaders: [] })
    const response = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, destroy: vi.fn(), end: vi.fn(), writeHead: vi.fn() })
    h.servers[0].handler(request as unknown as http.IncomingMessage, response as unknown as http.ServerResponse)
    expect(h.gateways.receipt()).toMatchObject({ pending: 1, appRequests: 1 })
    const close = h.gateways.close(2000); request.end(); await close
    expect(h.upstreams).toHaveLength(0); expect(h.gateways.receipt()).toMatchObject({ pending: 0, closed: true })
  })
  it('joins an upstream response already released before closing its listeners', async () => {
    const h = harness(); await h.gateways.start(); const call = h.incoming('app', '/api/auth/me'); await flush()
    let closed = false; const close = h.gateways.close(2000).then(() => { closed = true }); await flush()
    expect(closed).toBe(false); h.respond(0, '{}'); await call.done; await close
    expect(h.gateways.receipt()).toMatchObject({ closed: true, pending: 0, jsonResponses: 1 })
  })
  it('tracks upstream sockets, including their close acknowledgement, through cleanup', async () => {
    const h = harness(); await h.gateways.start(); const call = h.incoming('app', '/api/auth/me'); await flush()
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() }); h.upstreams[0].request.emit('socket', socket)
    h.respond(0, '{}'); await call.done
    let done = false; const close = h.gateways.close(2000).then(() => { done = true }); await flush()
    expect(socket.destroy).toHaveBeenCalledOnce(); expect(done).toBe(false); expect(h.gateways.receipt().sockets).toBe(1)
    socket.emit('close'); await close; expect(h.gateways.receipt()).toMatchObject({ closed: true, sockets: 0 })
  })
  it.each(['app', 'api'] as const)('enforces actual streamed %s response bytes without Content-Length', async kind => {
    const h = harness(); await h.gateways.start(); const call = h.incoming(kind, kind === 'app' ? '/api/auth/me' : '/rest/v1/tests'); await flush()
    h.respond(0, Buffer.alloc(1048577), { 'content-type': kind === 'app' ? 'application/json' : 'application/octet-stream' }); await call.done
    expect(h.gateways.receipt()).toMatchObject({ firstFailure: 'response-size', responses: 0, pending: 0 }); await h.gateways.close(2000)
  })
  it('rejects a duplicate Host before dispatch without retaining headers', async () => {
    const h = harness(); await h.gateways.start()
    const request = Object.assign(new PassThrough(), { method: 'GET', url: '/api/auth/me', headers: { host: 'localhost:3117' }, rawHeaders: ['Host','localhost:3117','Host','private-secret'] })
    const response = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, destroy: vi.fn() })
    h.servers[0].handler(request as unknown as http.IncomingMessage, response as unknown as http.ServerResponse); request.end(); await flush()
    expect(h.upstreams).toHaveLength(0); expect(h.gateways.receipt().firstFailure).toBe('protocol')
    expect(JSON.stringify(h.gateways.receipt())).not.toContain('private-secret'); await h.gateways.close(2000)
  })
  it('retains the first failure and performs no retry or later dispatch', async () => {
    const h = harness(); await h.gateways.start(); const call = h.incoming('api', '/rest/v1/tests'); await flush()
    h.upstreams[0].request.emit('error', Error('private')); await call.done
    await h.incoming('app', '/api/auth/me').done
    expect(h.upstreams).toHaveLength(1); expect(h.gateways.receipt()).toMatchObject({ firstFailure: 'upstream', apiRequests: 1, appRequests: 0 }); await h.gateways.close(2000)
  })
  it('never acknowledges cleanup while a socket close is unconfirmed', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000); const h = harness(Date.now); await h.gateways.start()
      const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() }); h.servers[0].emit('connection', socket)
      const close = h.gateways.close(1010), rejected = expect(close).rejects.toThrow('Private contextual Test gateway')
      await vi.advanceTimersByTimeAsync(10); await rejected
      expect(h.gateways.receipt()).toMatchObject({ firstFailure: 'cleanup', closed: false, sockets: 1 })
    } finally { vi.useRealTimers() }
  })
  it('bounds readiness when a listener never acknowledges binding', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000)
      const gateways = createContextualTestGateways({ plan, deadline: 2_701_000 }, { now: Date.now,
        createServer() { const server = Object.assign(new EventEmitter(), { listen() { return server }, close(callback: () => void) { callback(); return server }, closeIdleConnections() {} }); return server as unknown as http.Server },
        request() { throw Error('must not dispatch') },
      })
      const start = gateways.start(), rejected = expect(start).rejects.toThrow('Private contextual Test gateway')
      await vi.advanceTimersByTimeAsync(30000); await rejected
      expect(gateways.receipt()).toMatchObject({ firstFailure: 'deadline', started: false, firstDeadline: {
        kind: 'control', method: 'other', route: 'startup', phase: 'startup', observedAt: 31000,
        elapsedMs: 30000, detached: false, closing: false } }); await gateways.close(32000)
    } finally { vi.useRealTimers() }
  })
})
