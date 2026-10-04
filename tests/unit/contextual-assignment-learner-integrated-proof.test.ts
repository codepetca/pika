import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { INTEGRATED_CAPS, INTEGRATED_PNG, newIntegratedLearnerFixture, integratedSetupSql, integratedDigest,
  acceptCreatedDocument, integratedObjectPath } from '../../scripts/contextual-assignment-learner-integrated-proof-fixture'
import { createIntegratedTransport, fetchSignedBytes, integratedForcedReceipt, integratedFailureDiagnostic, validateIntegratedGuardResources } from '../../scripts/check-contextual-assignment-learner-integrated-lifecycle'
import {assignmentListExpectedResources} from '../../scripts/contextual-assignment-list-proof-platform'

const runnerPath = 'scripts/check-contextual-assignment-learner-integrated-lifecycle.ts'
const fixturePath = 'scripts/contextual-assignment-learner-integrated-proof-fixture.ts'
const source = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : ''

describe('integrated learner sibling source authority', () => {
  it('has an explicit extension fixture rather than changing the original fixture', () => {
    expect(source(fixturePath)).toContain('newIntegratedLearnerFixture')
  })
  it('uses real open and inline adapters without an RPC result substitute', () => {
    const runner = source(runnerPath)
    expect(runner).toContain('openSharedAssignmentLearnerDoc(')
    expect(runner).toContain('readContextualAssignmentInlineImage(')
    expect(runner).not.toContain('controlledRpcStubs')
  })
  it('wraps extension setup inside the original exact fixture dispatch before forced checkpoints', () => {
    expect(source(runnerPath)).toContain('request.sql === originalSetup')
    expect(source(runnerPath)).toContain('extensionComplete = true')
    expect(source(runnerPath)).toContain('runAssignmentListEphemeralLifecycle(')
  })
  it('contains physical bytes to a fixed tiny PNG and exact no-overwrite paths', () => {
    expect(source(fixturePath)).toContain('INTEGRATED_PNG')
    expect(source(runnerPath)).toContain('upsert: false')
    expect(source(runnerPath)).toContain('fetchSignedBytes')
  })
  it('requires closed one-time generated document receipts', () => {
    expect(source(fixturePath)).toContain('acceptCreatedDocument')
    expect(source(fixturePath)).toContain('.strict()')
  })
  it('enforces finite total and Storage transport budgets', () => {
    expect(source(runnerPath)).toContain('INTEGRATED_CAPS.networkRequests')
    expect(source(runnerPath)).toContain('INTEGRATED_CAPS.storageRequests')
    expect(source(runnerPath)).toContain("redirect: 'error'")
  })
  it('keeps closed cleanup and forced receipts separate from success claims', () => {
    expect(source(runnerPath)).toContain('PASS isolated assignment-learner-integrated exact teardown and unchanged canonical baseline.')
    expect(source(runnerPath)).toContain('FAIL forced isolated assignment-learner-integrated lifecycle:')
  })
  it('rejects guard or settings weakening in the extension SQL', () => {
    expect(source(fixturePath)).toContain('guard_pal_signal_activation')
    expect(source(fixturePath)).not.toMatch(/disable trigger|truncate|delete from|update private\./i)
  })
})

function fixture() {
  const original=newAssignmentListProofFixture(new Date('2026-10-04T10:00:00Z'))
  const f=newIntegratedLearnerFixture(original); const documents=new Map<string,string>()
  const projectId=`pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`
  const token=`e30.${Buffer.from(JSON.stringify({iss:'supabase-demo',role:'service_role'})).toString('base64url')}.synthetic`
  const target={API_URL:'http://127.0.0.1:54331',DB_URL:'postgresql://postgres:synthetic@127.0.0.1:54332/postgres',SERVICE_ROLE_KEY:token}
  const headers={apikey:token,authorization:`Bearer ${token}`}
  const guard=vi.fn(async()=>{})
  const fetcher=vi.fn<typeof fetch>(async()=>new Response('{}',{status:200}))
  const transport=createIntegratedTransport(f,documents,target,projectId,fetcher,guard)
  return {original,f,documents,projectId,target,headers,guard,fetcher,transport}
}
describe('finite integrated fixture and real transport boundary',()=>{
  it('marks guard timing unobserved when validation rejects before guard entry',async()=>{
    const x=fixture()
    await expect(x.transport.fetch('https://unrelated.invalid',{headers:x.headers})).rejects.toThrow('private details withheld')
    expect(x.transport.diagnostic()).toContain('phase=validate');expect(x.transport.diagnostic()).toContain('guard=unobserved')
    expect(x.guard).not.toHaveBeenCalled();expect(x.fetcher).not.toHaveBeenCalled()
  })
  it('records elapsed guard timing even when a delayed guard rejects',async()=>{
    const x=fixture();const a=x.f.assignments[0];x.transport.readContext(a.id,a.actorId)
    let now=1000;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now)
    try {
      x.guard.mockImplementationOnce(async()=>{now+=16000;throw new Error('SECRET delayed guard')})
      await expect(x.transport.fetch(`${x.target.API_URL}/rest/v1/assignments?id=eq.${a.id}&select=id`,{headers:x.headers})).rejects.toThrow('private details withheld')
      expect(x.transport.diagnostic()).toContain('phase=guard');expect(x.transport.diagnostic()).toContain('guard=at-least-15s')
      expect(x.fetcher).not.toHaveBeenCalled();expect(x.transport.diagnostic()).not.toContain('SECRET')
    }finally {clock.mockRestore()}
  })
  it('reports a closed transport phase and known API error code without response bodies or identities',async()=>{
    const x=fixture();const a=x.f.assignments[0];x.transport.readContext(a.id,a.actorId)
    const url=`${x.target.API_URL}/rest/v1/assignments?id=eq.${a.id}&select=id`
    x.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({code:'PGRST200',message:'SECRET relation and token'}),{status:400}))
    await x.transport.fetch(url,{headers:x.headers})
    expect(x.transport.diagnostic()).toBe('DIAG integrated transport phase=complete operation=assignment-read status=error code=PGRST200 aborted=false guard=under-1s requests=1 rpc=0.\n')
    x.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({code:'SECRET',message:'SECRET'}),{status:400}))
    await x.transport.fetch(url,{headers:x.headers})
    expect(x.transport.diagnostic()).toContain('code=unknown')
    expect(x.transport.diagnostic()).not.toContain('SECRET');expect(x.transport.diagnostic()).not.toContain(a.id)
    x.guard.mockRejectedValueOnce(new Error('SECRET guard'))
    await expect(x.transport.fetch(url,{headers:x.headers})).rejects.toThrow('private details withheld')
    expect(x.transport.diagnostic()).toContain('phase=guard');expect(x.transport.diagnostic()).toContain('status=unobserved code=none')
  })
  it('records an aborted app signal during guard checks without extending deadlines or dispatching a replacement',async()=>{
    const x=fixture();const a=x.f.assignments[0];x.transport.readContext(a.id,a.actorId)
    const controller=new AbortController();x.guard.mockImplementationOnce(async()=>{controller.abort()})
    x.fetcher.mockRejectedValueOnce(new Error('SECRET abort'))
    await expect(x.transport.fetch(`${x.target.API_URL}/rest/v1/assignments?id=eq.${a.id}&select=id`,{headers:x.headers,signal:controller.signal})).rejects.toThrow('private details withheld')
    expect(x.transport.diagnostic()).toContain('phase=dispatch');expect(x.transport.diagnostic()).toContain('aborted=true')
    expect(x.fetcher).toHaveBeenCalledOnce();expect(x.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
  it('reports only closed lifecycle stage and setup step after unexpected failures',()=>{
    const failure=new AssignmentListLifecycleError({stage:'fixture',error:new Error('SECRET token and body')},[])
    expect(integratedFailureDiagnostic(failure,'extension-sql')).toBe('DIAG isolated assignment-learner-integrated stage=fixture step=extension-sql cleanup=none.\n')
    const untrusted=new AssignmentListLifecycleError({stage:'SECRET signed URL',error:new Error('SECRET')},[{stage:'SECRET',error:new Error('SECRET')}])
    expect(integratedFailureDiagnostic(untrusted,'SECRET')).toBe('DIAG isolated assignment-learner-integrated stage=unknown step=unknown cleanup=present.\n')
    expect(integratedFailureDiagnostic(new Error('SECRET'),'not-started')).not.toContain('SECRET')
  })
  it('is disjoint, deterministic and preserves the original fixture',()=>{
    const original=newAssignmentListProofFixture();const before=JSON.stringify(original)
    const f=newIntegratedLearnerFixture(original)
    expect(f).toEqual(newIntegratedLearnerFixture(original));expect(JSON.stringify(original)).toBe(before)
    expect(f.actors).toHaveLength(4);expect(f.classes).toHaveLength(3);expect(f.assignments).toHaveLength(8);expect(f.objects).toHaveLength(8)
    expect(f.allocatedIds.every(id=>!original.allocatedIds.includes(id))).toBe(true)
    expect(INTEGRATED_PNG.length).toBeLessThanOrEqual(1024)
    expect(INTEGRATED_PNG.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a')
  })
  it('has a finite hashed SQL transaction with guard179-compatible submit history and all due dates',()=>{
    const {f,projectId}=fixture();const sql=integratedSetupSql(f,projectId)
    expect(sql).toBe(integratedSetupSql(f,projectId));expect(Buffer.byteLength(sql)).toBeLessThan(INTEGRATED_CAPS.sqlBytes)
    expect(integratedDigest(sql)).toMatch(/^[a-f0-9]{64}$/)
    expect(sql).toContain('guard_pal_signal_activation');expect(sql).toContain('Exact179 submit snapshot')
    expect(sql).toContain('due_at');expect(sql).not.toMatch(/disable trigger|truncate|delete from|update private\./i)
    expect(sql).toMatch(/commit;$/)
  })
  it('uses one fresh inventory and one bound read-only guard query without repeated unused whole-row snapshots',()=>{
    const runner=source(runnerPath);const guard=runner.slice(runner.indexOf('  async function guard()'),runner.indexOf('  let transport:'))
    expect(guard).toContain('await assignmentListDockerInventory()')
    expect(guard).toContain('validateIntegratedGuardResources(')
    expect(guard).toContain('execFileSync(');expect(guard).toContain('integratedGuardSql(projectId)')
    expect(guard).not.toContain('native.verifyEphemeral');expect(guard).not.toContain('native.executeSql')
    const {f,projectId}=fixture();const sql=integratedSetupSql(f,projectId)
    expect(source(fixturePath)).toContain('begin read only;')
    for(const table of ['removed_student_academic_settings','classroom_creation_entitlement_settings','test_ai_grading_runs','test_ai_grading_run_items','vault.secrets','cron.job'])expect(sql).toContain(table)
    expect(sql).toContain('pika-removed-student-cleanup-watchdog');expect(sql).toContain('pika-test-ai-grading-watchdog')
  })
  it('keeps exact fresh resource identity, database port, labels, closure and foreign attachment checks',()=>{
    const {projectId}=fixture()
    const resources=assignmentListExpectedResources(projectId).map((r,n)=>({...r,id:String(n+1).padStart(64,'0'),createdAt:'synthetic',labels:{'com.supabase.cli.project':projectId,'com.docker.compose.project':projectId},ports:r.name===`supabase_db_${projectId}`?[54332]:[],attachedIds:[]}))
    const db=resources[0];const closure=validateIntegratedGuardResources(resources,projectId,db.id)
    expect(closure).toEqual(resources);expect(closure).not.toBe(resources)
    expect(validateIntegratedGuardResources(resources,projectId,db.id,closure)).toEqual(resources)
    for(const change of [()=>{db.ports=[54322]},()=>{db.labels['com.docker.compose.project']='pika'},()=>{db.createdAt='replacement'}]){
      const before=structuredClone(resources);change();expect(()=>validateIntegratedGuardResources(resources,projectId,db.id,closure)).toThrow();Object.assign(db,before[0])
    }
    expect(()=>validateIntegratedGuardResources(resources,projectId,'different')).toThrow()
    const foreign={...resources[0],id:'unrelated',name:'unrelated',labels:{'com.supabase.cli.project':'pika','com.docker.compose.project':'pika'},attachedIds:[db.id]}
    expect(()=>validateIntegratedGuardResources([...resources,foreign],projectId,db.id,closure)).toThrow()
  })
  it('creates the synthetic link before submission and records submit history afterward without disabling guard099',()=>{
    const {f,projectId}=fixture();const sql=integratedSetupSql(f,projectId)
    const artifact=sql.indexOf('insert into public.assignment_submission_artifacts')
    const submit=sql.indexOf('update public.assignment_docs set is_submitted=true')
    const history=sql.indexOf('insert into public.assignment_doc_history')
    expect(artifact).toBeGreaterThan(-1);expect(submit).toBeGreaterThan(artifact);expect(history).toBeGreaterThan(submit)
    expect(sql.slice(submit,history)).toContain(`where id='${f.assignments[3].docId}' and is_submitted=false`)
    expect(sql).not.toMatch(/disable trigger|maintenance_mode|session_replication_role/i)
  })
  it('only accepts a one-time closed receipt bound to a no-document Assignment',()=>{
    const {f,documents}=fixture();const a=f.assignments[0]
    const receipt={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',actorId:a.actorId,assignmentId:a.id,classroomId:a.classroomId}
    expect(()=>acceptCreatedDocument(f,documents,{...receipt,extra:true})).toThrow()
    expect(()=>acceptCreatedDocument(f,documents,{...receipt,actorId:f.actors[3].id})).toThrow()
    expect(()=>acceptCreatedDocument(f,documents,{...receipt,id:f.allocatedIds[0]})).toThrow()
    expect(acceptCreatedDocument(f,documents,receipt)).toBe(receipt.id)
    expect(()=>acceptCreatedDocument(f,documents,receipt)).toThrow()
    expect(()=>acceptCreatedDocument(f,documents,{...receipt,assignmentId:f.assignments[2].id})).toThrow()
  })
  it.each(['http://127.0.0.1:54321','http://localhost:54331','https://project.supabase.co','https://github.com'])('rejects foreign/canonical origin %s before dispatch',async origin=>{
    const x=fixture();await expect(x.transport.fetch(`${origin}/rest/v1/assignments`,{headers:x.headers})).rejects.toThrow()
    expect(x.fetcher).not.toHaveBeenCalled();expect(x.guard).not.toHaveBeenCalled()
  })
  it.each(['/auth/v1/user','/rest/v1/users','/storage/v1/object/submission-images/foreign.png','/rest/v1/rpc/submit_assignment_doc_for_member_v1'])('rejects an unplanned endpoint %s',async path=>{
    const x=fixture();await expect(x.transport.fetch(`${x.target.API_URL}${path}`,{method:'POST',headers:x.headers,body:'{}'})).rejects.toThrow()
    expect(x.fetcher).not.toHaveBeenCalled()
  })
  it('uses the real injected fetch after an exact read and gate check, never fabricates an RPC result',async()=>{
    const x=fixture();const a=x.f.assignments[0];x.transport.readContext(a.id,a.actorId)
    const url=`${x.target.API_URL}/rest/v1/assignments?id=eq.${a.id}&select=id`
    await x.transport.fetch(url,{headers:x.headers})
    expect(x.guard).toHaveBeenCalledOnce();expect(x.fetcher).toHaveBeenCalledOnce()
    expect(x.fetcher.mock.calls[0][1]).toMatchObject({redirect:'error',signal:expect.any(AbortSignal)})
    await expect(x.transport.fetch(url,{headers:{...x.headers,authorization:'Bearer unrelated'}})).rejects.toThrow()
    await expect(x.transport.fetch(url.replace('select=id','select=*'),{headers:x.headers})).rejects.toThrow()
    expect(x.fetcher).toHaveBeenCalledOnce()
  })
  it('accepts the installed SDK own feedback Assignment filter but rejects a different Assignment',async()=>{
    const x=fixture();const a=x.f.assignments[0];x.transport.readContext(a.id,a.actorId)
    const client=createClient<Database>(x.target.API_URL,x.target.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:x.transport.fetch}})
    const own=await client.from('assignments').select('id').eq('id',a.id).eq('feedback.assignment_id',a.id)
    expect(own.error).toBeNull();expect(x.fetcher).toHaveBeenCalledOnce()
    const other=await client.from('assignments').select('id').eq('id',a.id).eq('feedback.assignment_id',x.f.assignments[1].id)
    expect(other.error).not.toBeNull();expect(x.fetcher).toHaveBeenCalledOnce()
  })
  it('rejects substituted RPC bodies and fixture-external protocol identities before dispatch',async()=>{
    const x=fixture();const a=x.f.assignments[0];x.transport.readContext(a.id,a.actorId)
    const args={p_actor_id:a.actorId,p_assignment_id:a.id,p_pal_event:null,p_viewed_at:x.f.now}
    expect(()=>x.transport.planRpc('open_assignment_doc_for_member_v1',{...args,p_actor_id:x.f.actors[3].id})).toThrow()
    x.transport.planRpc('open_assignment_doc_for_member_v1',args)
    await expect(x.transport.fetch(`${x.target.API_URL}/rest/v1/rpc/open_assignment_doc_for_member_v1`,{headers:x.headers,method:'POST',body:JSON.stringify({...args,p_pal_event:{}})})).rejects.toThrow()
    expect(x.fetcher).not.toHaveBeenCalled()
  })
  it('rejects failed gate checks and HTTP redirects without exposing private bodies',async()=>{
    const x=fixture();const a=x.f.assignments[0];x.transport.readContext(a.id,a.actorId)
    const url=`${x.target.API_URL}/rest/v1/assignments?id=eq.${a.id}&select=id`
    x.guard.mockRejectedValueOnce(new Error('Secret gate detail'))
    await expect(x.transport.fetch(url,{headers:x.headers})).rejects.toThrow('private details withheld');expect(x.fetcher).not.toHaveBeenCalled()
    x.fetcher.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://provider.invalid'}}))
    await expect(x.transport.fetch(url,{headers:x.headers})).rejects.toThrow('private details withheld')
  })
  it('validates fixed PNG bytes and prohibits repeated overwrite uploads',async()=>{
    const x=fixture();const o=x.f.objects.find(o=>o.index===2&&o.bucket==='submission-images')!
    const path=integratedObjectPath(x.f,x.documents,o);const url=`${x.target.API_URL}/storage/v1/object/${o.bucket}/${path}`
    const headers={...x.headers,'x-upsert':'false','content-type':'image/png'}
    await expect(x.transport.fetch(url,{method:'POST',headers,body:Buffer.from('wrong bytes')})).rejects.toThrow()
    await x.transport.fetch(url,{method:'POST',headers,body:INTEGRATED_PNG})
    await expect(x.transport.fetch(url,{method:'POST',headers,body:INTEGRATED_PNG})).rejects.toThrow()
    expect(x.fetcher).toHaveBeenCalledOnce()
  })
  it('pins signed GET origin/path/token, fetches actual injected bytes, and omits service credentials',async()=>{
    const x=fixture();const o=x.f.objects.find(o=>o.index===2&&o.bucket==='submission-images')!
    const path=integratedObjectPath(x.f,x.documents,o)
    const url=`${x.target.API_URL}/storage/v1/object/sign/${o.bucket}/${path}?token=synthetic`
    expect(()=>x.transport.registerSignedUrl(url+'&extra=true',o.bucket,path)).toThrow()
    expect(()=>x.transport.registerSignedUrl(url.replace(':54331',':54321'),o.bucket,path)).toThrow()
    x.fetcher.mockResolvedValueOnce(new Response(INTEGRATED_PNG))
    await fetchSignedBytes(x.transport,url,o.bucket,path)
    expect(x.fetcher.mock.calls[0][1]?.headers).toBeUndefined()
    expect(x.transport.counts.byteReads).toBe(1)
    await expect(x.transport.fetch(url,{method:'GET'})).rejects.toThrow()
  })
  it('caps all extension network dispatches before a late request',async()=>{
    const x=fixture();const a=x.f.assignments[0];x.transport.readContext(a.id,a.actorId)
    const url=`${x.target.API_URL}/rest/v1/assignments?id=eq.${a.id}&select=id`
    for(let n=0;n<INTEGRATED_CAPS.networkRequests;n++)await x.transport.fetch(url,{headers:x.headers})
    await expect(x.transport.fetch(url,{headers:x.headers})).rejects.toThrow()
    expect(x.fetcher).toHaveBeenCalledTimes(INTEGRATED_CAPS.networkRequests)
  })
  it('proves installed SDK RPC serialization and captures only a genuine created=true response receipt',async()=>{
    const x=fixture();const a=x.f.assignments[0];x.transport.readContext(a.id,a.actorId)
    const args={p_actor_id:a.actorId,p_assignment_id:a.id,p_pal_event:null,p_viewed_at:x.f.now}
    const docId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    x.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ok:true,created:true,viewed_at_changed:true,
      assignment:{id:a.id,classroom_id:a.classroomId},doc:{id:docId,assignment_id:a.id,student_id:a.actorId,viewed_at:x.f.now}}),{headers:{'content-type':'application/json'}}))
    const client=createClient<Database>(x.target.API_URL,x.target.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:x.transport.fetch}})
    x.transport.planRpc('open_assignment_doc_for_member_v1',args)
    const result=await client.rpc('open_assignment_doc_for_member_v1',args)
    expect(result.error).toBeNull();expect(result.data).toMatchObject({created:true})
    const receipt=x.transport.takeCreatedReceipt(a.id)
    expect(acceptCreatedDocument(x.f,x.documents,receipt)).toBe(docId)
    expect(()=>x.transport.takeCreatedReceipt(a.id)).toThrow()
    expect(x.fetcher).toHaveBeenCalledOnce()
  })
  it('proves installed SDK uploads pass the fixed byte/no-overwrite manifest without multipart surprises',async()=>{
    const x=fixture();const o=x.f.objects.find(o=>o.index===2&&o.bucket==='submission-images')!
    const path=integratedObjectPath(x.f,x.documents,o)
    x.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({Id:'synthetic',Key:`${o.bucket}/${path}`}),{headers:{'content-type':'application/json'}}))
    const client=createClient<Database>(x.target.API_URL,x.target.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:x.transport.fetch}})
    const result=await client.storage.from(o.bucket).upload(path,INTEGRATED_PNG,{contentType:'image/png',upsert:false})
    expect(result.error).toBeNull();expect(result.data?.path).toBe(path)
    expect(x.fetcher).toHaveBeenCalledOnce()
  })
  it('caps finite Storage signing requests independently before a late POST',async()=>{
    const x=fixture();const o=x.f.objects.find(o=>o.index===2&&o.bucket==='submission-images')!
    const path=integratedObjectPath(x.f,x.documents,o);const url=`${x.target.API_URL}/storage/v1/object/sign/${o.bucket}/${path}`
    for(let n=0;n<INTEGRATED_CAPS.storageRequests;n++)await x.transport.fetch(url,{method:'POST',headers:x.headers,body:JSON.stringify({expiresIn:60})})
    await expect(x.transport.fetch(url,{method:'POST',headers:x.headers,body:JSON.stringify({expiresIn:60})})).rejects.toThrow()
    expect(x.fetcher).toHaveBeenCalledTimes(INTEGRATED_CAPS.storageRequests)
  })
  it('cancels oversized response bodies before returning data',async()=>{
    const x=fixture();const a=x.f.assignments[0];x.transport.readContext(a.id,a.actorId)
    x.fetcher.mockResolvedValueOnce(new Response(new Uint8Array(INTEGRATED_CAPS.responseBytes+1)))
    await expect(x.transport.fetch(`${x.target.API_URL}/rest/v1/assignments?id=eq.${a.id}&select=id`,{headers:x.headers})).rejects.toThrow('private details withheld')
  })
  it.each(['after-fixture','before-capture'])('only emits forced cleanup receipts after the complete extension and successful teardown: %s',mode=>{
    const error=new AssignmentListLifecycleError({stage:mode,error:new Error('Forced isolated lifecycle failure')},[])
    expect(integratedForcedReceipt(mode,error,false)).toBeNull()
    expect(integratedForcedReceipt(mode,error,true)).toEqual({stdout:'PASS isolated assignment-learner-integrated exact teardown and unchanged canonical baseline.\n',stderr:`FAIL forced isolated assignment-learner-integrated lifecycle: ${mode}.\n`,exitCode:1})
    expect(integratedForcedReceipt(mode,new AssignmentListLifecycleError(error.primary,[{stage:'cleanup',error:new Error('secret')}]),true)).toBeNull()
    expect(integratedForcedReceipt('normal',error,true)).toBeNull()
  })
})
