/** Closed268 carrier over the existing disposable lifecycle. Inert on import.
 * Native success is reported only after canonical equality and complete teardown. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { ApiError } from '../src/lib/api-error'
import { hydrateClassroomRecord } from '../src/lib/server/classrooms'
import { setContextualClassroomHotArchive } from '../src/lib/server/contextual-classroom-hot-lifecycle'
import { createContextualTestLearnerWorkflow,type TestLearnerRpcClient } from '../src/lib/server/contextual-test-learner-workflow'
import { newAssignmentListProofFixture,assignmentListFixtureSetupSql } from './contextual-assignment-list-proof-fixture'
import { runAssignmentListEphemeralLifecycle,AssignmentListLifecycleError,type AssignmentListLifecycleAdapters } from './contextual-assignment-list-proof-lifecycle'
import { createAssignmentListNativeAdapters,loadAssignmentListReviewedMigrations,assignmentListExpectedResources,assignmentListRestorationPolicy } from './contextual-assignment-list-proof-platform'
import { assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { validateIntegratedGuardResources } from './check-contextual-assignment-learner-integrated-lifecycle'
import { testOwnerListDockerInventory } from './contextual-test-owner-list-proof-inventory'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { newClassroomHotLifecycleFixture,hotLifecycleDigest as hash,HOT_LIFECYCLE_CAPS as caps,assertHotLifecycleGraphChange,
  type HotLifecycleFixture,type HotGraph } from './contextual-classroom-hot-lifecycle-proof-fixture'
import { buildClassroomHotLifecycleNativeContractsManifest,createClassroomHotLifecycleNativeContracts } from './contextual-test-draft-save-native-contracts'
import { validateHotLifecycleGeneratedTypes } from './contextual-classroom-hot-lifecycle-native-contracts'
import { generateTestDraftSaveTypes } from './generate-contextual-test-draft-save-types'

type Session=Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]
type ProofTarget=ReturnType<typeof validateAssignmentListProofTarget>
const origin='http://127.0.0.1:54331',hotPath='/rest/v1/rpc/set_classroom_hot_archive_for_owner_v1',learnerPath='/rest/v1/rpc/test_learner_workflow_v1'
const cleanup='PASS isolated classroom-hot-lifecycle exact teardown and unchanged canonical baseline.\n'
export function parseClassroomHotLifecycleArgs(args:string[]) {
  const generateTypes=args.length===5&&args[4]==='--generate-types'
  const parsed=parseAssignmentListLifecycleArgs(generateTypes?args.slice(0,4):args)
  assert(!generateTypes||parsed.mode==='normal');return {...parsed,generateTypes}
}
/** Exactly one source-owned SDK operation is admitted at a time. No table or Storage requests. */
export function createHotLifecycleProofTransport(f:HotLifecycleFixture,target:ProofTarget,raw:typeof fetch,guard:()=>Promise<void>) {
  validateAssignmentListProofTarget(target,f.projectId);assert.equal(target.API_URL,origin)
  let expected:{path:string;body:Record<string,unknown>}|undefined,inFlight=false
  const counts={rpc:0,bytes:0,rawPrivilegeFailures:0}
  const allowed=new Set([[0,0,true],[0,0,false],[1,1,true],[1,1,false],[2,0,true],[3,0,true],[0,3,false],[0,3,true],[0,4,false]].map(([a,c,v])=>JSON.stringify({p_actor_id:f.actors[Number(a)].id,p_classroom_id:f.classes[Number(c)].id,p_archived:v})))
  function plan(path:typeof hotPath|typeof learnerPath,body:Record<string,unknown>) {
    assert(!expected&&!inFlight)
    if(path===hotPath)assert(allowed.has(JSON.stringify(body)))
    else {assert.equal(path,learnerPath);assert.deepEqual(body,{p_actor_id:f.actors[2].id,p_test_id:f.testId,p_classroom_id:null,p_operation:'inspect',p_payload:{}})}
    expected={path,body:structuredClone(body)}
  }
  function done(){assert(!expected&&!inFlight)}
  const safeFetch:typeof fetch=async(resource,init)=>{
    assert(expected&&!inFlight&&typeof resource==='string'&&init?.method==='POST'&&typeof init.body==='string')
    const url=new URL(resource);assert.equal(url.origin,origin);assert.equal(url.pathname,expected.path);assert.equal(url.search,'');assert.equal(url.hash,'');assert.equal(url.username,'');assert.equal(url.password,'')
    const headers=new Headers(init.headers);assert.equal(headers.get('apikey'),target.SERVICE_ROLE_KEY);assert.equal(headers.get('authorization'),`Bearer ${target.SERVICE_ROLE_KEY}`)
    assert(Buffer.byteLength(init.body)<=4096);const body=JSON.parse(init.body)
    if(expected.path===learnerPath){assert(typeof body.p_deadline==='string');const deadline=Date.parse(body.p_deadline);assert(Number.isFinite(deadline)&&deadline>Date.now()&&deadline<=Date.now()+30000);assert.deepEqual(body,{...expected.body,p_deadline:body.p_deadline})}
    else assert.deepEqual(body,expected.body)
    assert(++counts.rpc<=20);expected=undefined;inFlight=true
    try {
      await guard();const timeout=AbortSignal.timeout(caps.requestMs),signal=init.signal?AbortSignal.any([timeout,init.signal]):timeout
      const response=await raw(resource,{...init,redirect:'error',signal});assert(!response.headers.has('location')&&(response.status<300||response.status>=400))
      const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let bytes=0
      if(reader)for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length
        if(bytes>caps.responseBytes||bytes+counts.bytes>64*1024*1024){await reader.cancel();throw new Error('Hot lifecycle reply cap')};chunks.push(part.value)}
      counts.bytes+=bytes;const data=Buffer.concat(chunks);const decoded:unknown=JSON.parse(data.toString('utf8'))
      if(!response.ok&&decoded&&typeof decoded==='object'&&!Array.isArray(decoded)&&(decoded as Record<string,unknown>).code==='42501')counts.rawPrivilegeFailures++
      return new Response(data,{status:response.status,statusText:response.statusText,headers:response.headers})
    } finally {inFlight=false}
  }
  return Object.freeze({fetch:safeFetch,plan,done,counts})
}
export async function classroomHotLifecycleMain(args=process.argv.slice(2)) {
  const input=parseClassroomHotLifecycleArgs(args)
  const git=(args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000}).trim()
  assert.equal(git(['rev-parse','HEAD']),input.head);assert.equal(git(['status','--porcelain','--untracked-files=all']),'')
  const repository=git(['rev-parse','--show-toplevel']);assert.equal(repository,process.cwd())
  const original=newAssignmentListProofFixture(),f=newClassroomHotLifecycleFixture(original),projectId=f.projectId,migrations=loadAssignmentListReviewedMigrations(repository)
  const manifest=buildClassroomHotLifecycleNativeContractsManifest(original,input.head,repository),manifestHash=hash(JSON.stringify(manifest))
  process.stdout.write(`PREFLIGHT classroom-hot-lifecycle head=${input.head} project=${projectId} manifest=${manifestHash} migrations=${manifest.migrationManifestSha256}.\n`)
  const native=createAssignmentListNativeAdapters(original),originalSetup=assignmentListFixtureSetupSql(original,projectId)
  let target:ProofTarget|undefined,session:Session|undefined,closure:Awaited<ReturnType<typeof testOwnerListDockerInventory>>|undefined
  let engine:ReturnType<typeof createClassroomHotLifecycleNativeContracts>|undefined,transport:ReturnType<typeof createHotLifecycleProofTransport>|undefined
  let client:ReturnType<typeof createClient<Database>>|undefined,complete=false,matrixComplete=false,stage='pending'
  let types:Awaited<ReturnType<typeof generateTestDraftSaveTypes>>|undefined
  const previousPal=process.env.PAL_ENABLED;process.env.PAL_ENABLED='false'
  function sql(source:string) {
    assert(session&&[testOwnerGuardSql(projectId),manifest.snapshot].includes(source))
    return execFileSync('docker',['exec','-i','-e',`PGAPPNAME=${projectId}_fixture`,session.containerId,'psql','-U','postgres','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],
      {input:source,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:45000,maxBuffer:caps.responseBytes}).trim()
  }
  async function guard(){assert(target&&session);closure=validateIntegratedGuardResources(await testOwnerListDockerInventory(),projectId,session.containerId,closure);assert.equal(sql(testOwnerGuardSql(projectId)),'ok')}
  async function snapshot():Promise<HotGraph>{await guard();return JSON.parse(sql(manifest.snapshot))}
  async function hot(actor:number,klass:number,archived:boolean) {
    assert(client&&transport);transport.plan(hotPath,{p_actor_id:f.actors[actor].id,p_classroom_id:f.classes[klass].id,p_archived:archived})
    const before=await snapshot(),result=await setContextualClassroomHotArchive({supabase:client,actorId:f.actors[actor].id,classroomId:f.classes[klass].id,archived})
    transport.done();const after=await snapshot()
    if(result.kind==='updated'){
      const row=(after['public.classrooms'] as Record<string,unknown>[]).find(r=>r.id===f.classes[klass].id);assert(row)
      assert.deepEqual(result.classroom,hydrateClassroomRecord(row));assertHotLifecycleGraphChange(before,after,f.classes[klass].id,archived)
    }else assert.deepEqual(after,before)
    return result
  }
  async function inspect(denied:boolean) {
    assert(client&&transport);const before=await snapshot();transport.plan(learnerPath,{p_actor_id:f.actors[2].id,p_test_id:f.testId,p_classroom_id:null,p_operation:'inspect',p_payload:{}})
    const flow=createContextualTestLearnerWorkflow({supabase:client! as unknown as TestLearnerRpcClient,actorId:f.actors[2].id,testId:f.testId,deadline:Date.now()+25000}),read=()=>flow.run('inspect')
    if(denied)await assert.rejects(read,e=>e instanceof ApiError&&e.statusCode===403);else {const row=await read();assert.deepEqual(row,{access_mode:'member'});assert.equal(flow.classroomId,f.classes[0].id)}
    transport.done();assert.deepEqual(await snapshot(),before)
  }
  async function matrix() {
    assert(complete&&!matrixComplete&&engine&&client&&transport)
    stage='member-active';await inspect(false)
    stage='owner-teacher-archive';assert.equal((await hot(0,0,true)).kind,'updated')
    stage='member-archived';await inspect(true)
    stage='owner-teacher-restore';assert.equal((await hot(0,0,false)).kind,'updated')
    stage='member-restored';await inspect(false)
    stage='owner-student-archive';assert.equal((await hot(1,1,true)).kind,'updated')
    stage='owner-student-restore';assert.equal((await hot(1,1,false)).kind,'updated')
    for(const actor of [2,3]){stage=actor===2?'member-denial':'outsider-denial';const before=await snapshot();await assert.rejects(()=>hot(actor,0,true),e=>e instanceof ApiError&&e.statusCode===403);transport.done();assert.deepEqual(await snapshot(),before)}
    stage='capacity-restore';assert.equal((await hot(0,3,false)).kind,'updated')
    stage='capacity-denial';const denied=await hot(0,4,false);assert.equal(denied.kind,'denied');if(denied.kind==='denied')assert.equal(denied.denial.errorCode,'classroom_creation_active_limit_reached')
    stage='capacity-release';assert.equal((await hot(0,3,true)).kind,'updated')
    stage='privilege';await engine.probeHotLifecyclePrivilegeDrift(async()=>{
      const before=transport!.counts.rpc,errors=transport!.counts.rawPrivilegeFailures
      await assert.rejects(()=>hot(0,0,true),e=>e instanceof ApiError&&e.statusCode===503);transport!.done();assert.equal(transport!.counts.rpc-before,1);assert.equal(transport!.counts.rawPrivilegeFailures-errors,1)
      return {status:503 as const,rpcCalls:1 as const,rawCode:'42501' as const}
    })
    assert.equal(transport.counts.rpc,13);stage='rollback';const rollback=await engine.run();assert(rollback.fixtureUnchanged)
    stage='committed';const committed=await engine.runCommittedTransitions();assert.equal(committed.transitions.schedules.length,4)
    if(input.generateTypes){stage='types';types=await generateTestDraftSaveTypes({repository,reviewedHead:input.head,projectId,guard});assert.equal(types.migrationManifestSha256,manifest.migrationManifestSha256);validateHotLifecycleGeneratedTypes(readFileSync(types.path,'utf8'))}
    matrixComplete=true;stage='complete'
  }
  try {
    await runAssignmentListEphemeralLifecycle({fixture:original,projectId,workdir:assignmentListProofWorkdir(projectId),migrations,mode:input.mode,
      expectedResources:assignmentListExpectedResources(projectId),reviewedManifestSha256:hash(JSON.stringify(original.manifest)),
      restorationPolicies:assignmentListRevocationPlans(original).map(p=>assignmentListRestorationPolicy(original,p))},
    {...native,async command(request){const result=await native.command(request);if(request.args[0]==='status')target=validateAssignmentListProofTarget(result,projectId);return result},
      async executeSql(request){await native.executeSql(request);if(request.sql===originalSetup){assert(!session&&target);session={...request};stage='guard';await guard();assert(closure)
        engine=createClassroomHotLifecycleNativeContracts({repository,reviewedHead:input.head,original,capturedResources:closure,containerId:session.containerId,acceptedManifestSha256:manifestHash,absoluteDeadline:Date.now()+900000})
        stage='setup';await engine.setup();transport=createHotLifecycleProofTransport(f,target,fetch,guard)
        client=createClient<Database>(target.API_URL,target.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport.fetch}});complete=true}},
      async runCase(request){const result=await native.runCase(request);if(!matrixComplete)await matrix();return result}})
    assert(complete&&matrixComplete);stage='accepted';process.stdout.write(`PASS isolated classroom-hot-lifecycle thirteen actual SDK RPCs, full rollback contracts, four observed committed races; ${types?'genuine268 types generated':'types unverified (not requested)'}.\n${cleanup}`)
    return Object.freeze({types:types??null,nativeVerified:true,projectId,reviewedHead:input.head,manifestSha256:manifestHash,migrationManifestSha256:manifest.migrationManifestSha256})
  } catch(error) {
    if(input.mode!=='normal'&&complete&&error instanceof AssignmentListLifecycleError&&error.primary?.stage===input.mode&&error.primary.error instanceof Error&&error.primary.error.message==='Forced isolated lifecycle failure'&&error.cleanupFailures.length===0){process.stdout.write(cleanup);process.stderr.write(`FAIL forced isolated classroom-hot-lifecycle: ${input.mode}.\n`);process.exitCode=1;return}
    process.stderr.write(`DIAG classroom-hot-lifecycle stage=${stage} cleanup=${error instanceof AssignmentListLifecycleError?error.cleanupFailures.map(f=>f.stage).join(',')||'none':'unknown'}.\n`)
    if(engine)process.stderr.write(engine.diagnostic());throw new Error('Classroom hot lifecycle proof failed; private details withheld')
  } finally {if(previousPal===undefined)delete process.env.PAL_ENABLED;else process.env.PAL_ENABLED=previousPal}
}
if(process.argv[1]===fileURLToPath(import.meta.url))classroomHotLifecycleMain().catch(()=>{process.stderr.write('FAIL isolated classroom-hot-lifecycle; private details withheld.\n');process.exitCode=1})
