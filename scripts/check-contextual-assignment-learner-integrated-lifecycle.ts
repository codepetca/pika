/** SOURCE-ONLY prepared sibling rehearsal. Execute only after root's exact-source
 * review and explicit extension SQL/Storage manifest approval. No operations at
 * import. This is installed-SDK/Storage evidence, NOT authenticated app/browser
 * evidence, Pal delivery, same-actor removal, or a concurrency proof. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { ApiError } from '../src/lib/api-error'
import { openSharedAssignmentLearnerDoc } from '../src/lib/server/contextual-assignment-learner-open'
import { readContextualAssignmentInlineImage } from '../src/lib/server/contextual-assignment-inline-images'
import { buildPrivateStorageRedirect } from '../src/lib/server/direct-storage-delivery'
import { newAssignmentListProofFixture, assignmentListFixtureSetupSql } from './contextual-assignment-list-proof-fixture'
import { runAssignmentListEphemeralLifecycle, AssignmentListLifecycleError, type AssignmentListLifecycleAdapters } from './contextual-assignment-list-proof-lifecycle'
import { AssignmentListStartupError, assignmentListStartupDiagnostic, createAssignmentListNativeAdapters, loadAssignmentListReviewedMigrations, assignmentListExpectedResources, assignmentListRestorationPolicy, assignmentListDockerInventory } from './contextual-assignment-list-proof-platform'
import { assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { INTEGRATED_CAPS, INTEGRATED_PNG, newIntegratedLearnerFixture, integratedDigest, integratedGuardSql,
  integratedSetupSql, integratedDocId, integratedObjectPath, acceptCreatedDocument,
  type IntegratedLearnerFixture, type CreatedDocuments } from './contextual-assignment-learner-integrated-proof-fixture'

type Target = ReturnType<typeof validateAssignmentListProofTarget>
type Session = Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]
type RpcPlan = { name:string; args:Record<string,unknown> }
const API = 'http://127.0.0.1:54331'
const cleanupMarker = 'PASS isolated assignment-learner-integrated exact teardown and unchanged canonical baseline.\n'
const q = (value:string) => `'${value.replaceAll("'","''")}'`

/** One fresh complete discovery; no cache, relaxed identity or broader cleanup. */
export function validateIntegratedGuardResources(inventory:Awaited<ReturnType<typeof assignmentListDockerInventory>>,projectId:string,containerId:string,closure?:typeof inventory) {
  const resources=inventory.filter(r=>r.labels['com.supabase.cli.project']===projectId)
  const expected=assignmentListExpectedResources(projectId)
  const names=(rows:Array<{kind:string;name:string}>)=>rows.map(r=>`${r.kind}:${r.name}`).sort()
  assert.deepEqual(names(resources),names(expected))
  for(const r of resources) {assert.equal(r.labels['com.docker.compose.project'],projectId);assert(r.ports.every(p=>[54331,54332,54340].includes(p)))}
  const db=resources.find(r=>r.kind==='container'&&r.name===`supabase_db_${projectId}`)
  assert(db&&db.id===containerId&&db.ports.length>0&&db.ports.every(p=>p===54332))
  if(closure)assert(isDeepStrictEqual(resources,closure))
  const owned=new Set(resources.map(r=>r.id))
  assert(!inventory.some(r=>!owned.has(r.id)&&r.attachedIds.some(id=>owned.has(id))))
  return closure??structuredClone(resources)
}

/** One immutable extension target and finite per-operation manifest. The caller
 * must set a read context or exact RPC body BEFORE invoking hot SDK methods. */
export function createIntegratedTransport(f:IntegratedLearnerFixture, documents:CreatedDocuments, rawTarget:unknown,
  projectId:string, original:typeof fetch, guard:()=>Promise<void>) {
  const target = validateAssignmentListProofTarget(rawTarget,projectId)
  assert.equal(target.API_URL,API); assert.match(projectId,/^pika_assignment_list_[a-f0-9]{12}$/)
  let context:{assignmentId:string; actorId:string}|undefined
  let rpc:RpcPlan|undefined
  const signed = new Set<string>(); const uploaded = new Set<string>()
  const createdReceipts = new Map<string,{id:string;actorId:string;assignmentId:string;classroomId:string}>()
  const counts = { network:0, storage:0, rpc:0, byteReads:0 }
  // Fixed labels only; request identities and raw errors never enter receipts.
  let phase:'not-started'|'validate'|'guard'|'dispatch'|'decode'|'complete'='not-started'
  let operation:'unknown'|'assignment-read'|'open-rpc'|'other-rpc'|'storage'|'signed-read'='unknown'
  let status:'unobserved'|'success'|'error'='unobserved'
  let code='none';let appSignal:AbortSignal|null|undefined;let guardMs:number|undefined
  const knownCodes=new Set(['PGRST200','PGRST201','PGRST204','PGRST202','PGRST116','23514','23502','23503','23505','42501','P0002','22023','40001'])
  const paths = () => f.objects.filter(o=>f.assignments[o.index].docId || documents.has(f.assignments[o.index].id))
    .map(o=>({object:o,path:integratedObjectPath(f,documents,o)}))
  function readContext(assignmentId:string,actorId:string) {
    assert(f.assignments.some(a=>a.id===assignmentId)); assert(f.actors.some(a=>a.id===actorId))
    context={assignmentId,actorId}
  }
  function planRpc(name:string,args:Record<string,unknown>) {
    assert(!rpc)
    assert(['open_assignment_doc_for_member_v1','finalize_assignment_inline_image_for_member_v1',
      'read_assignment_inline_image_for_context_v1','begin_managed_storage_upload','verify_managed_storage_upload','managed_storage_mark_ready',
      'upsert_assignment_artifact_for_member_v1'].includes(name))
    assert(Buffer.byteLength(JSON.stringify(args))<=16384)
    const object=f.objects.find(o=>o.id===args.p_object_id||o.id===args.p_managed_object_id)
    if(name==='open_assignment_doc_for_member_v1') {
      assert.deepEqual(Object.keys(args).sort(),['p_actor_id','p_assignment_id','p_pal_event','p_viewed_at'])
      assert(context&&args.p_assignment_id===context.assignmentId&&args.p_actor_id===context.actorId&&args.p_pal_event===null)
      assert(typeof args.p_viewed_at==='string'&&Number.isFinite(Date.parse(args.p_viewed_at)))
    } else if(name==='read_assignment_inline_image_for_context_v1'||name==='finalize_assignment_inline_image_for_member_v1') {
      assert(object&&f.actors.some(a=>a.id===args.p_actor_id))
      const a=f.assignments.find(row=>(row.docId??documents.get(row.id))===args.p_assignment_doc_id)
      assert(a)
      assert(isDeepStrictEqual(args,{p_actor_id:args.p_actor_id,p_expected_classroom_id:a.classroomId,p_assignment_doc_id:args.p_assignment_doc_id,p_managed_object_id:object.id}))
      if(name==='finalize_assignment_inline_image_for_member_v1')assert(object.bucket==='submission-images'&&[1,2].includes(object.index)&&args.p_actor_id===a.actorId)
    } else if(name==='begin_managed_storage_upload') {
      assert(object); const a=f.assignments[object.index]
      assert(isDeepStrictEqual(args,{p_object_id:object.id,p_storage_bucket:object.bucket,p_storage_path:integratedObjectPath(f,documents,object),p_classroom_id:a.classroomId,
        p_course_blueprint_id:null,p_provisional_owner_id:null,p_purpose:object.bucket==='submission-images'?'student_inline_image':'student_assignment_artifact',
        p_created_by_user_id:a.actorId,p_data_subject_user_id:a.actorId,p_resource_type:'assignment_doc',p_resource_id:integratedDocId(f,documents,object.index),p_content_type:'image/png',p_byte_size:INTEGRATED_PNG.length}))
    } else if(name==='verify_managed_storage_upload') {
      assert(object&&isDeepStrictEqual(args,{p_object_id:object.id,p_content_sha256:integratedDigest(INTEGRATED_PNG)}))
    } else if(name==='managed_storage_mark_ready') {
      assert(object?.ready&&isDeepStrictEqual(args,{p_object_id:object.id}))
    } else if(name==='upsert_assignment_artifact_for_member_v1') {
      assert(object?.bucket==='assignment-artifacts');const a=f.assignments[object.index]
      const requirement=f.requirements.find(r=>r.assignmentId===a.id&&r.type==='image');assert(requirement)
      assert(isDeepStrictEqual(args,{p_actor_id:a.actorId,p_assignment_id:a.id,p_requirement_id:requirement.id,p_type:'image',p_url:null,
        p_storage_path:integratedObjectPath(f,documents,object),p_metadata_json:{},p_validation_status:'valid',p_validation_message:null,p_validated_at:f.now,
        p_managed_object_id:object.id,p_save_github_identity:false,p_github_login:null,p_github_validation_status:null,p_github_validation_message:null}))
    } else throw new Error('Unused RPC is not authorized')
    rpc={name,args:structuredClone(args)}
  }
  function registerSignedUrl(value:string,bucket:string,path:string) {
    assert(paths().some(p=>p.object.bucket===bucket&&p.path===path))
    const url=new URL(value)
    assert.equal(url.origin,API); assert.equal(url.pathname,`/storage/v1/object/sign/${bucket}/${path}`)
    assert(value.length<=4096&&!url.username&&!url.password&&!url.hash&&url.searchParams.size===1&&url.searchParams.get('token'))
    assert(!signed.has(url.href)); signed.add(url.href)
    return url.href
  }
  const safeFetch:typeof fetch=async(resource,init)=>{
    try {
      phase='validate';operation='unknown';status='unobserved';code='none';guardMs=undefined;appSignal=init?.signal
      // Request objects could conceal a second body/credential source; SDK uses strings.
      assert(!(resource instanceof Request))
      const url=new URL(String(resource)); const method=init?.method??'GET'
      assert.equal(url.origin,API); assert(!url.username&&!url.password&&!url.hash)
      assert(init?.redirect===undefined||init.redirect==='error')
      const headers=new Headers(init?.headers)
      const byteRead=signed.has(url.href)&&method==='GET'; let consumedRpc:RpcPlan|undefined
      operation=byteRead?'signed-read':url.pathname==='/rest/v1/assignments'?'assignment-read':url.pathname==='/rest/v1/rpc/open_assignment_doc_for_member_v1'?'open-rpc':url.pathname.startsWith('/rest/v1/rpc/')?'other-rpc':url.pathname.startsWith('/storage/v1/')?'storage':'unknown'
      if(byteRead) { assert(!init?.body&&!headers.has('authorization')&&!headers.has('apikey')&&!headers.has('cookie')); signed.delete(url.href); counts.byteReads++ }
      else {
        assert.equal(headers.get('authorization'),`Bearer ${target.SERVICE_ROLE_KEY}`)
        assert.equal(headers.get('apikey'),target.SERVICE_ROLE_KEY)
        assert(!headers.has('cookie')&&!headers.has('x-forwarded-host'))
        if(url.pathname.startsWith('/rest/v1/rpc/')) {
          assert(method==='POST'&&!url.search&&rpc)
          assert.equal(url.pathname,`/rest/v1/rpc/${rpc.name}`)
          assert(typeof init?.body==='string'&&isDeepStrictEqual(JSON.parse(init.body),rpc.args)); consumedRpc=rpc; rpc=undefined; counts.rpc++
        } else if(url.pathname==='/rest/v1/assignments') {
          assert(method==='GET'&&context&&!init?.body)
          assert.equal(url.searchParams.get('id'),`eq.${context.assignmentId}`)
          const assignment=f.assignments.find(a=>a.id===context!.assignmentId)!
          const select=url.searchParams.get('select'); assert(select&&select.length<=20000&&!select.includes('*')&&!select.includes('password'))
          for(const [key,value] of url.searchParams) {
            assert(['select','id','classroom_id','is_draft','or','classrooms.id','classrooms.teacher_id','classrooms.archived_at',
              'classrooms.membership.classroom_id','classrooms.membership.student_id','classrooms.membership.limit',
              'docs.id','docs.student_id','docs.assignment_id','docs.limit','docs.returned_at','docs.feedback_returned_at',
              'grades.id','grades.student_id','grades.assignment_id','grades.returned_at','grades.limit',
              'released_feedback.id','released_feedback.student_id','released_feedback.assignment_id','released_feedback.returned_at','released_feedback.feedback_returned_at','released_feedback.limit',
              'requirements.assignment_id','requirements.id','requirements.order','requirements.limit',
              'feedback.assignment_id','feedback.student_id','feedback.id','feedback.order','feedback.limit',
              'docs.artifacts.assignment_doc_id','docs.artifacts.student_id','docs.artifacts.requirement.assignment_id','docs.artifacts.id','docs.artifacts.order','docs.artifacts.limit'].includes(key))
            if(key==='classroom_id'||key==='classrooms.id'||key==='classrooms.membership.classroom_id') assert.equal(value,`eq.${assignment.classroomId}`)
            if(key==='feedback.assignment_id') assert.equal(value,`eq.${assignment.id}`)
            if(['classrooms.membership.student_id','docs.student_id','grades.student_id','released_feedback.student_id','feedback.student_id','docs.artifacts.student_id'].includes(key)) assert.equal(value,`eq.${context.actorId}`)
          }
        } else {
          assert(url.pathname.startsWith('/storage/v1/')&&!url.search)
          const identity=paths().find(p=>url.pathname===`/storage/v1/object/${p.object.bucket}/${p.path}`)
          if(identity) {
            assert.equal(method,'POST'); assert.equal(headers.get('x-upsert'),'false'); assert.equal(headers.get('content-type'),'image/png')
            assert(init?.body instanceof Uint8Array&&integratedDigest(init.body)===integratedDigest(INTEGRATED_PNG))
            assert(!uploaded.has(identity.object.id)); uploaded.add(identity.object.id)
          } else {
            assert.equal(method,'POST'); assert(typeof init?.body==='string')
            const body:unknown=JSON.parse(init.body); assert(body&&typeof body==='object'&&!Array.isArray(body))
            const value=body as Record<string,unknown>
            const bucket=url.pathname.split('/').at(-1)!
            if(Object.hasOwn(value,'paths')) {
              assert.equal(url.pathname,`/storage/v1/object/sign/${bucket}`)
              assert.deepEqual(Object.keys(value).sort(),['expiresIn','paths']); assert.equal(value.expiresIn,3600)
              assert(Array.isArray(value.paths)&&value.paths.length>0&&value.paths.length<=2&&new Set(value.paths).size===value.paths.length)
              assert(value.paths.every(path=>paths().some(p=>p.object.bucket===bucket&&p.path===path&&p.object.bucket==='assignment-artifacts')))
            } else {
              assert.deepEqual(Object.keys(value),['expiresIn']); assert.equal(value.expiresIn,60)
              assert(paths().some(p=>url.pathname===`/storage/v1/object/sign/${p.object.bucket}/${p.path}`&&p.object.bucket==='submission-images'))
            }
          }
        }
      }
      assert(++counts.network<=INTEGRATED_CAPS.networkRequests)
      if(url.pathname.startsWith('/storage/')) assert(++counts.storage<=INTEGRATED_CAPS.storageRequests)
      phase='guard';const guardStarted=Date.now()
      try {await guard()}finally {guardMs=Math.max(0,Date.now()-guardStarted)}
      const timeout=AbortSignal.timeout(INTEGRATED_CAPS.requestMs)
      phase='dispatch'
      const response=await original(resource,{...init,redirect: 'error',signal:init?.signal?AbortSignal.any([timeout,init.signal]):timeout})
      status=response.ok?'success':'error';phase='decode'
      assert(response.status<300||response.status>=400); assert(!response.headers.has('location'))
      const reader=response.body?.getReader(); const chunks:Uint8Array[]=[]; let size=0
      if(reader) while(true) { const next=await reader.read(); if(next.done)break; size+=next.value.length
        if(size>INTEGRATED_CAPS.responseBytes) { await reader.cancel(); throw new Error('Response bound') } chunks.push(next.value) }
      const bytes=Buffer.concat(chunks)
      if(!response.ok) {
        code='unknown'
        try {const value:unknown=JSON.parse(bytes.toString('utf8'));if(value&&typeof value==='object'&&!Array.isArray(value)) {
          const candidate=(value as Record<string,unknown>).code;if(typeof candidate==='string'&&knownCodes.has(candidate))code=candidate
        }}catch { /* No private body or arbitrary code is retained. */ }
      }
      if(consumedRpc?.name==='open_assignment_doc_for_member_v1'&&response.ok) {
        const value=JSON.parse(bytes.toString('utf8'))
        assert(value&&typeof value==='object'&&typeof value.created==='boolean'&&typeof value.viewed_at_changed==='boolean')
        if(value.created) {
          assert(value.viewed_at_changed&&Date.parse(value.doc?.viewed_at)===Date.parse(String(consumedRpc.args.p_viewed_at)))
          const a=f.assignments.find(row=>row.id===consumedRpc!.args.p_assignment_id);assert(a&&a.docId===null)
          assert(value.assignment?.id===a.id&&value.assignment.classroom_id===a.classroomId&&value.doc?.assignment_id===a.id&&value.doc.student_id===a.actorId)
          assert(!createdReceipts.has(a.id))
          createdReceipts.set(a.id,{id:value.doc.id,actorId:a.actorId,assignmentId:a.id,classroomId:a.classroomId})
        }
      }
      phase='complete';return new Response(bytes,{status:response.status,headers:response.headers})
    } catch { throw new Error('Integrated transport rejected; private details withheld') }
  }
  return { target, fetch:safeFetch, counts, readContext, planRpc, registerSignedUrl,
    diagnostic() {const time=guardMs===undefined?'unobserved':guardMs<1000?'under-1s':guardMs<5000?'under-5s':guardMs<15000?'under-15s':'at-least-15s'
      return `DIAG integrated transport phase=${phase} operation=${operation} status=${status} code=${code} aborted=${appSignal?.aborted===true} guard=${time} requests=${counts.network} rpc=${counts.rpc}.\n`},
    takeCreatedReceipt(assignmentId:string) { const receipt=createdReceipts.get(assignmentId);assert(receipt);createdReceipts.delete(assignmentId);return receipt },
    assertNoPendingRpc(){assert(!rpc)} }
}

/** Exact scope snapshot contains whole rows, including Storage metadata. Never
 * prints values; use only the digest and assertions in public receipts. */
export function integratedSnapshotSql(f:IntegratedLearnerFixture,documents:CreatedDocuments) {
  const assignments=f.assignments.map(a=>q(a.id)).join(','); const objects=f.objects.map(o=>q(o.id)).join(',')
  const docs=f.assignments.flatMap((a,index)=>a.docId||documents.has(a.id)?[q(integratedDocId(f,documents,index))]:[]).join(',')||'null'
  const actors=f.actors.map(a=>q(a.id)).join(','); const classes=f.classes.map(c=>q(c.id)).join(',')
  const scopes=[['public.users',`id in (${actors})`],['public.classrooms',`id in (${classes})`],['public.assignments',`id in (${assignments})`],
    ['public.assignment_submission_requirements',`assignment_id in (${assignments})`],
    ['public.assignment_docs',`assignment_id in (${assignments})`],['public.assignment_doc_history',`assignment_doc_id in (${docs})`],
    ['public.assignment_submission_artifacts',`assignment_doc_id in (${docs})`],['public.assignment_feedback_entries',`assignment_id in (${assignments})`],
    ['public.user_github_identities',`user_id in (${actors})`],['public.managed_storage_objects',`id in (${objects})`],
    ['public.managed_storage_json_references',`managed_object_id in (${objects})`],['storage.objects',`bucket_id in ('submission-images','assignment-artifacts') and name in (${f.objects.filter(o=>f.assignments[o.index].docId||documents.has(f.assignments[o.index].id)).map(o=>q(integratedObjectPath(f,documents,o))).join(',')})`],
    ['public.classroom_enrollments',`classroom_id in (${classes})`],['public.pal_event_outbox',`student_id in (${actors})`],
    ['private.pal_membership_generations',`generation_id in (${f.enrollments.map(e=>q(e.id)).join(',')}) or scope_digest in (${f.classes.flatMap(c=>f.actors.map(a=>`private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')})`],
    ['private.pal_membership_outbox',`classroom_id in (${classes}) or student_id in (${actors})`],
    ['public.assignment_doc_save_operations',`assignment_doc_id in (${docs})`]]
  const sql=`begin read only;set local lock_timeout='3s';set local statement_timeout='30s';select jsonb_build_object(${scopes.map(([table,predicate])=>`${q(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t where ${predicate})`).join(',')});rollback;`
  assert(Buffer.byteLength(sql)<=INTEGRATED_CAPS.sqlBytes); return sql
}
export async function fetchSignedBytes(transport:ReturnType<typeof createIntegratedTransport>,signedUrl:string,bucket:string,path:string) {
  const url=transport.registerSignedUrl(signedUrl,bucket,path)
  const response=await transport.fetch(url,{method:'GET'}); assert(response.ok)
  const bytes=new Uint8Array(await response.arrayBuffer()); assert.equal(bytes.length,INTEGRATED_PNG.length)
  assert.equal(integratedDigest(bytes),integratedDigest(INTEGRATED_PNG))
}
export function integratedForcedReceipt(mode:string,error:unknown,extensionComplete:boolean) {
  if(extensionComplete&&mode!=='normal'&&['after-fixture','before-capture'].includes(mode)&&error instanceof AssignmentListLifecycleError
    &&error.primary?.stage===mode&&error.primary.error instanceof Error&&error.primary.error.message==='Forced isolated lifecycle failure'&&!error.cleanupFailures.length)
    return {stdout:cleanupMarker,stderr:`FAIL forced isolated assignment-learner-integrated lifecycle: ${mode}.\n`,exitCode:1}
  return null
}
/** Closed labels only: never serialize underlying errors, IDs, credentials or bodies. */
export function integratedFailureDiagnostic(error:unknown,step:string) {
  const stages=new Set(['canonical-before','inventory','prepare','pre-start','start','capture','status','fixture','cases','revocations','after-fixture','before-capture'])
  const steps=new Set(['not-started','guard','extension-sql','open-create','open-repeat','reserve-object','upload-bytes','finalize-inline','verify-upload','mark-ready','upsert-artifact','setup-complete','supplements','inline-positive','open-denials','inline-denials','matrix-complete'])
  const failure=error instanceof AssignmentListLifecycleError?error:null
  const stage=failure?.primary&&stages.has(failure.primary.stage)?failure.primary.stage:'unknown'
  const safeStep=steps.has(step)?step:'unknown'
  const cleanup=failure?failure.cleanupFailures.length?'present':'none':'unknown'
  const startup = stage === 'start' && failure?.primary?.error instanceof AssignmentListStartupError ? assignmentListStartupDiagnostic(failure.primary.error) : ''
  return `DIAG isolated assignment-learner-integrated stage=${stage} step=${safeStep} cleanup=${cleanup}.\n${startup}`
}

export async function assignmentLearnerIntegratedMain(args=process.argv.slice(2)) {
  const input=parseAssignmentListLifecycleArgs(args)
  const git=(values:string[])=>execFileSync('git',values,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000}).trim()
  assert.equal(git(['rev-parse','HEAD']),input.head); assert.equal(git(['status','--porcelain']),''); const repository=git(['rev-parse','--show-toplevel']); assert.equal(repository,process.cwd())
  const original=newAssignmentListProofFixture(); const f=newIntegratedLearnerFixture(original)
  const projectId=`pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`
  const native=createAssignmentListNativeAdapters(original); const originalSetup=assignmentListFixtureSetupSql(original,projectId)
  const extensionSql=integratedSetupSql(f,projectId); const extensionHash=integratedDigest(extensionSql)
  const documents:CreatedDocuments=new Map(); let target:Target|undefined; let bound:Session|undefined; let extensionComplete=false; let observed=0
  let extensionStep='not-started'
  const artifactReceipts=new Map<string,string>()
  let resourceClosure:Awaited<ReturnType<AssignmentListLifecycleAdapters['inventory']>>['resources']|undefined
  const originalPal=process.env.PAL_ENABLED; process.env.PAL_ENABLED='false'
  async function guard() {
    assert(target&&bound)
    const inventory=await assignmentListDockerInventory()
    resourceClosure=validateIntegratedGuardResources(inventory,projectId,bound.containerId,resourceClosure)
    // Same enforced controls in one finite read-only query. Original lifecycle
    // still owns full canonical snapshots and exact teardown; no unused whole-row
    // hashing or repeated inventory inside this app's unchanged 20-second budget.
    const output=execFileSync('docker',['exec','-i','-e',`PGAPPNAME=${projectId}_fixture`,bound.containerId,'psql','-U','postgres','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],
      {input:integratedGuardSql(projectId),encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:45000,maxBuffer:INTEGRATED_CAPS.responseBytes})
    assert.equal(output.trim(),'ok')
  }
  let transport:ReturnType<typeof createIntegratedTransport>; let client:ReturnType<typeof createClient<Database>>
  async function rpc(name:string,values:Record<string,unknown>) {
    transport.planRpc(name,values)
    // Runtime name is checked by the finite transport, never supplied by CLI.
    const result=await client.rpc(name as 'open_assignment_doc_for_member_v1',values as never)
    transport.assertNoPendingRpc(); assert(!result.error); return result.data as unknown
  }
  async function snapshot(ignoreViewedDoc?:string) {
    await guard(); assert(bound)
    const sql=integratedSnapshotSql(f,documents)
    const output=execFileSync('docker',['exec','-i','-e',`PGAPPNAME=${projectId}_fixture`,bound.containerId,'psql','-U','postgres','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],
      {input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:45000,maxBuffer:INTEGRATED_CAPS.responseBytes})
    const value:unknown=JSON.parse(output.trim()); assert(value&&typeof value==='object')
    if(ignoreViewedDoc) {
      assert(f.assignments.some((a,index)=>(a.docId??documents.get(a.id))===ignoreViewedDoc&&index<4))
      const rows=(value as Record<string,unknown>)['public.assignment_docs'];assert(Array.isArray(rows))
      const row=rows.find(r=>r.id===ignoreViewedDoc);assert(row)
      delete row.viewed_at;delete row.updated_at
    }
    return integratedDigest(JSON.stringify(value))
  }
  async function open(index:number,actorId=f.assignments[index].actorId) {
    const a=f.assignments[index]; transport.readContext(a.id,actorId)
    // Register the actual application's fresh timestamp body; delegate unchanged
    // to the real SDK builder. This intercepts intent, never fabricates a result.
    const originalRpc=client.rpc.bind(client)
    const wrapped=Object.create(client) as typeof client
    wrapped.rpc=((name:string,values:Record<string,unknown>)=>{
      assert.equal(name,'open_assignment_doc_for_member_v1'); assert.deepEqual(Object.keys(values).sort(),['p_actor_id','p_assignment_id','p_pal_event','p_viewed_at'])
      assert.equal(values.p_actor_id,actorId); assert.equal(values.p_assignment_id,a.id); assert.equal(values.p_pal_event,null)
      assert(typeof values.p_viewed_at==='string'&&Number.isFinite(Date.parse(values.p_viewed_at)))
      transport.planRpc(name,values); return originalRpc(name,values as never)
    }) as typeof client.rpc
    const body=await openSharedAssignmentLearnerDoc({supabase:wrapped,actorId,assignmentId:a.id})
    transport.assertNoPendingRpc(); assert.equal(body.doc.assignment_id,a.id); assert.equal(body.doc.student_id,actorId)
    assert.equal(body.assignment.classroom_id,a.classroomId); assert(!('pal_delivery' in body)); return body
  }
  async function inline(index:number,actorId:string,object=f.objects.find(o=>o.bucket==='submission-images'&&o.index===index)!) {
    const a=f.assignments[index]; const docId=integratedDocId(f,documents,index)
    const values={p_actor_id:actorId,p_expected_classroom_id:a.classroomId,p_assignment_doc_id:docId,p_managed_object_id:object.id}
    transport.planRpc('read_assignment_inline_image_for_context_v1',values)
    const access=await readContextualAssignmentInlineImage({supabase:client,actorId,classroomId:a.classroomId,assignmentDocId:docId,managedObjectId:object.id})
    transport.assertNoPendingRpc(); return access
  }
  async function setup() {
    extensionStep='guard'
    assert.equal(integratedDigest(extensionSql),extensionHash); await guard(); assert(bound)
    extensionStep='extension-sql'
    await native.executeSql({...bound,sql:extensionSql})
    for(const index of [0,1]) {
      extensionStep='open-create'
      const body=await open(index); assert(body.wasFirstView)
      const receipt=transport.takeCreatedReceipt(f.assignments[index].id);assert.equal(receipt.id,body.doc.id)
      acceptCreatedDocument(f,documents,receipt)
      extensionStep='open-repeat'
      const repeated=await open(index); assert.equal(repeated.doc.id,body.doc.id); assert.equal(repeated.wasFirstView,false); observed+=2
    }
    for(const object of f.objects) {
      const a=f.assignments[object.index]; const path=integratedObjectPath(f,documents,object); const docId=integratedDocId(f,documents,object.index)
      extensionStep='reserve-object'
      await rpc('begin_managed_storage_upload',{p_object_id:object.id,p_storage_bucket:object.bucket,p_storage_path:path,p_classroom_id:a.classroomId,
        p_course_blueprint_id:null,p_provisional_owner_id:null,p_purpose:object.bucket==='submission-images'?'student_inline_image':'student_assignment_artifact',
        p_created_by_user_id:a.actorId,p_data_subject_user_id:a.actorId,p_resource_type:'assignment_doc',p_resource_id:docId,p_content_type:'image/png',p_byte_size:INTEGRATED_PNG.length})
      extensionStep='upload-bytes'
      const upload=await client.storage.from(object.bucket).upload(path,INTEGRATED_PNG,{contentType:'image/png',upsert: false}); assert(!upload.error&&upload.data?.path===path)
      if(object.bucket==='submission-images'&&[1,2].includes(object.index)) {
        extensionStep='finalize-inline'
        await rpc('finalize_assignment_inline_image_for_member_v1',{
          p_actor_id:a.actorId,p_expected_classroom_id:a.classroomId,p_assignment_doc_id:docId,p_managed_object_id:object.id})
      } else {
        extensionStep='verify-upload'
        await rpc('verify_managed_storage_upload',{p_object_id:object.id,p_content_sha256:integratedDigest(INTEGRATED_PNG)})
      }
      if(object.ready) {extensionStep='mark-ready';await rpc('managed_storage_mark_ready',{p_object_id:object.id})}
    }
    for(const requirement of f.requirements.filter(r=>r.type==='image')) {
      extensionStep='upsert-artifact'
      const index=f.assignments.findIndex(a=>a.id===requirement.assignmentId); const object=f.objects.find(o=>o.bucket==='assignment-artifacts'&&o.index===index)!
      const result=await rpc('upsert_assignment_artifact_for_member_v1',{p_actor_id:f.assignments[index].actorId,p_assignment_id:requirement.assignmentId,p_requirement_id:requirement.id,
        p_type:'image',p_url:null,p_storage_path:integratedObjectPath(f,documents,object),p_metadata_json:{},p_validation_status:'valid',p_validation_message:null,
        p_validated_at:f.now,p_managed_object_id:object.id,p_save_github_identity:false,p_github_login:null,p_github_validation_status:null,p_github_validation_message:null})
      assert(result&&typeof result==='object')
      const receipt=result as {ok?:unknown;classroom_id?:unknown;artifact?:{id?:unknown;assignment_doc_id?:unknown;requirement_id?:unknown;student_id?:unknown;type?:unknown;managed_object_id?:unknown;storage_path?:unknown}}
      assert(receipt.ok===true&&receipt.classroom_id===f.assignments[index].classroomId&&receipt.artifact)
      const artifact=receipt.artifact
      assert(typeof artifact.id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(artifact.id))
      assert(artifact.assignment_doc_id===integratedDocId(f,documents,index)&&artifact.requirement_id===requirement.id&&artifact.student_id===f.assignments[index].actorId&&artifact.type==='image')
      assert(artifact.managed_object_id===object.id&&artifact.storage_path===integratedObjectPath(f,documents,object))
      assert(!f.allocatedIds.includes(artifact.id)&&!f.originalAllocatedIds.includes(artifact.id)&&![...artifactReceipts.values()].includes(artifact.id))
      artifactReceipts.set(requirement.id,artifact.id)
    }
    await guard(); extensionComplete = true;extensionStep='setup-complete'
  }
  async function cases() {
    extensionStep='supplements'
    for(const index of [1,2,3]) {
      const before=await snapshot(integratedDocId(f,documents,index))
      const body=await open(index); assert.equal(body.doc.id,integratedDocId(f,documents,index))
      assert.equal(body.wasFirstView,index!==1); assert(body.feedback_entries.length===1); assert(body.github_identity)
      assert.equal(body.doc.score_completion,index===3?0:null)
      if(index<3) {
        assert.equal(body.submission_artifacts.length,1); const object=f.objects.find(o=>o.bucket==='assignment-artifacts'&&o.index===index)!
        const requirement=f.requirements.find(r=>r.assignmentId===f.assignments[index].id)!
        assert.equal(body.submission_artifacts[0].id,artifactReceipts.get(requirement.id))
        const url=body.submission_artifacts[0].url; assert(url)
        await fetchSignedBytes(transport,url,object.bucket,integratedObjectPath(f,documents,object))
      }
      if(index===3)assert(body.submission_artifacts.length===1&&body.submission_artifacts[0].type==='link')
      assert.equal(await snapshot(integratedDocId(f,documents,index)),before)
      observed++
    }
    extensionStep='inline-positive'
    for(const index of [1,2,3,4,5,6]) {
      const object=f.objects.find(o=>o.bucket==='submission-images'&&o.index===index)!
      for(const actorId of [...(index<=2?[]:[f.actors[0].id]),...(index<4?[f.assignments[index].actorId]:[])]) {
        const before=await snapshot();assert(await inline(index,actorId))
        const response=await buildPrivateStorageRedirect({supabase:client,bucket:'submission-images',path:integratedObjectPath(f,documents,object)})
        assert.equal(response.status,302); assert.equal(response.headers.get('cache-control'),'private, no-store'); assert.equal(response.headers.get('referrer-policy'),'no-referrer')
        const url=response.headers.get('location'); assert(url)
        await fetchSignedBytes(transport,url,object.bucket,integratedObjectPath(f,documents,object)); assert.equal(await snapshot(),before); observed++
      }
    }
    extensionStep='open-denials'
    for(const index of [4,5,6,7]) {
      const before=await snapshot(); const storage=transport.counts.storage; const rpcCount=transport.counts.rpc
      await assert.rejects(()=>open(index),error=>error instanceof ApiError&&error.statusCode===404)
      await assert.rejects(()=>open(index,f.actors[0].id),error=>error instanceof ApiError&&error.statusCode===403)
      assert.equal(transport.counts.storage,storage); assert.equal(transport.counts.rpc,rpcCount); assert.equal(await snapshot(),before); observed+=2
    }
    extensionStep='inline-denials'
    for(const [index,actorId,wrong] of [[2,f.actors[3].id,false],[2,f.actors[2].id,false],[2,f.actors[0].id,false],[4,f.actors[1].id,false],[5,f.actors[1].id,false],[6,f.actors[1].id,false],[2,f.actors[1].id,true]] as const) {
      const before=await snapshot(); const storage=transport.counts.storage
      assert.equal(await inline(index,actorId,wrong?f.objects.find(o=>o.bucket==='assignment-artifacts')!:undefined),null)
      assert.equal(transport.counts.storage,storage); assert.equal(await snapshot(),before); observed++
    }
    extensionStep='matrix-complete'
  }
  try {
    await runAssignmentListEphemeralLifecycle({fixture:original,projectId,workdir:assignmentListProofWorkdir(projectId),migrations:loadAssignmentListReviewedMigrations(repository),mode:input.mode,
      expectedResources:assignmentListExpectedResources(projectId),reviewedManifestSha256:integratedDigest(JSON.stringify(original.manifest)),
      restorationPolicies:assignmentListRevocationPlans(original).map(p=>assignmentListRestorationPolicy(original,p))},
    {...native,async command(request) { const result=await native.command(request)
      if(request.args[0]==='status')target=validateAssignmentListProofTarget(result,projectId); return result },
    async executeSql(request) {
      await native.executeSql(request)
      if(request.sql === originalSetup) {
        assert(!bound&&target); bound={...request}
        transport=createIntegratedTransport(f,documents,target,projectId,fetch,guard)
        client=createClient<Database>(target.API_URL,target.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport.fetch}})
        await setup()
      }
    },async runCase(request) { const result=await native.runCase(request)
      if(observed===4)await cases(); return result }})
    assert(extensionComplete);assert.equal(observed,29)
    process.stdout.write(`PASS isolated assignment-learner-integrated ${observed} actual SDK cases; real create/view, nonempty supplements and bounded signed image bytes; no auth HTTP/browser/removal-race claim.\n${cleanupMarker}`)
  } catch(error) {
    const receipt=integratedForcedReceipt(input.mode,error,extensionComplete)
    if(receipt){process.stdout.write(receipt.stdout);process.stderr.write(receipt.stderr);process.exitCode=receipt.exitCode;return}
    process.stderr.write(integratedFailureDiagnostic(error,extensionStep))
    if(transport!)process.stderr.write(transport.diagnostic())
    throw new Error('Integrated lifecycle failed; private details withheld')
  } finally { if(originalPal===undefined)delete process.env.PAL_ENABLED;else process.env.PAL_ENABLED=originalPal }
}
if(process.argv[1]===fileURLToPath(import.meta.url))assignmentLearnerIntegratedMain().catch(()=>{
  process.stderr.write('FAIL isolated assignment-learner-integrated lifecycle; private details withheld.\n');process.exitCode=1
})
