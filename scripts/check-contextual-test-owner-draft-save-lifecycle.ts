/** Inert finite SDK proof entrypoint. Fixed-source review and explicit parent
 * acceptance precede native execution. This proves helper/RPC behavior only. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { ApiError } from '../src/lib/api-error'
import { buildTestDraftContentFromRows } from '../src/lib/server/assessment-drafts'
import { buildNextDraftContent } from '../src/lib/server/assessment-drafts'
import { preserveCurrentTestDocumentSnapshots, stripTestDocumentSnapshots } from '../src/lib/test-documents'
import { contextualTestDraftSaveRequestSchema, type ContextualTestDraftSaveInput } from '../src/lib/validations/contextual-test-draft-save'
import { validateTestDraftContent } from '../src/lib/validations/assessment-drafts'
import { getTestDraftIdentityResolutionOptions, projectPortableTestQuestionIds } from '../src/lib/test-question-identity'
import { contextualTestDraftSaveSnapshotSchema } from '../src/lib/validations/contextual-test-draft-save'
import { newAssignmentListProofFixture, assignmentListFixtureSetupSql } from './contextual-assignment-list-proof-fixture'
import { runAssignmentListEphemeralLifecycle, AssignmentListLifecycleError, type AssignmentListLifecycleAdapters } from './contextual-assignment-list-proof-lifecycle'
import { createAssignmentListNativeAdapters, loadAssignmentListReviewedMigrations, assignmentListExpectedResources, assignmentListRestorationPolicy, assignmentListRowChanges, assignmentListDockerInventory } from './contextual-assignment-list-proof-platform'
import { assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'
import { testOwnerListDockerInventory } from './contextual-test-owner-list-proof-inventory'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { validateIntegratedGuardResources } from './check-contextual-assignment-learner-integrated-lifecycle'
import { newTestOwnerDraftSaveFixture, testOwnerDraftSaveSetupSql, testOwnerDraftSaveSnapshotSql, testOwnerDigest, testOwnerGuardSql, TEST_OWNER_DRAFT_SAVE_CAPS, type TestOwnerDraftSaveFixture } from './contextual-test-owner-draft-save-proof-fixture'
import { buildDraftSaveNativeContractsManifest, createDraftSaveNativeContracts } from './contextual-test-draft-save-native-contracts'
import { generateTestDraftSaveTypes } from './generate-contextual-test-draft-save-types'

const API = 'http://127.0.0.1:54331'
const paths = Object.freeze(['/rest/v1/rpc/snapshot_test_draft_save_for_owner_v1', '/rest/v1/rpc/finish_test_draft_save_for_owner_v1'])
const cleanupMarker = 'PASS isolated test-owner-draft-save exact teardown and unchanged canonical baseline.\n'
type Rows = Record<string, Array<Record<string, unknown>>>
type Session = Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]
type Source = ReturnType<typeof contextualTestDraftSaveSnapshotSchema.parse>
export function testOwnerDraftSaveRequestManifest(f: TestOwnerDraftSaveFixture) {
  return Object.freeze({ version: 1, fixture: f, caps: TEST_OWNER_DRAFT_SAVE_CAPS, origin: API, method: 'POST', paths, sdk: 'supabase-js-node/2.93.3',
    snapshotKeys: Object.freeze(['p_actor_id', 'p_test_id', 'p_deadline']), finalKeys: Object.freeze(['p_actor_id', 'p_test_id', 'p_classroom_id', 'p_expected_source_sha256', 'p_expected_version', 'p_operation', 'p_content', 'p_documents', 'p_update_documents', 'p_deadline']) })
}
function candidate(source: Source) {
  if (source.draft && source.test.status === 'draft') {
    const valid = validateTestDraftContent(source.draft.content, { allowEmptyQuestionText: true,requirePortableQuestionIdentity:true })
    if (valid.valid) {
      const projected = projectPortableTestQuestionIds(valid.value, source.questions, getTestDraftIdentityResolutionOptions(valid.value)); assert(projected.ok)
      return projected.content
    }
  }
  const valid = validateTestDraftContent(buildTestDraftContentFromRows(source.test, source.questions), { allowEmptyQuestionText: true, requirePortableQuestionIdentity: true })
  assert(valid.valid); return valid.value
}
/** Independently bind the returned snapshot to the reviewed synthetic source;
 * arbitrary app requests cannot choose a Class/hash/operation/content. */
export function createTestOwnerDraftSaveProofTransport(f: TestOwnerDraftSaveFixture, rawTarget: unknown, projectId: string, original: typeof fetch, guard: () => Promise<void>) {
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const target = validateAssignmentListProofTarget(rawTarget, projectId); assert.equal(target.API_URL, API)
  const manifest = testOwnerDraftSaveRequestManifest(f); const hash = testOwnerDigest(JSON.stringify(manifest))
  const counts = { network: 0, rpc: 0, storage: 0, exchangeBytes: 0 }
  const evidence = { emptySource: 0, nonemptySource: 0, complete1001Source: 0, rawPrivilegeFailures: 0 }
  let context: TestOwnerDraftSaveFixture['cases'][number] | undefined; let source: Source | undefined; let deadline: string | undefined
  let expectedInput: ContextualTestDraftSaveInput | undefined; let before: Rows | undefined; let dispatched = 0; let phase = 'idle'; let operation = 'unknown'
  function readContext(testId: string, actorId: string, rows?: Rows, proofInput?: ContextualTestDraftSaveInput, label?: string) {
    context = f.cases.find(c => c.testId === testId && c.actorId === actorId && (!label || c.label===label)); assert(context); expectedInput=proofInput
    source = undefined; deadline = undefined; dispatched = 0; before = rows ? structuredClone(rows) : undefined; phase = 'context'; operation = 'unknown'
  }
  function bindSnapshot(value: unknown) {
    assert(context); const parsed = contextualTestDraftSaveSnapshotSchema.parse(value)
    const test = f.tests.find(t => t.id === context!.testId)!; const classroom = f.classes.find(c => c.id === context!.classroomId)!
    assert.equal(parsed.actor_id, context.actorId)
    assert.deepEqual({ ...parsed.classroom, archived_at: parsed.classroom.archived_at === null ? null : new Date(parsed.classroom.archived_at).toISOString() }, { id: classroom.id, teacher_id: classroom.owner, archived_at: classroom.archived ? f.now : null })
    assert(before); const storedTest=before['public.tests'].find(r=>r.id===test.id);assert(storedTest)
    assert.deepEqual(parsed.test,Object.fromEntries(['id','classroom_id','title','show_results','status','blueprint_archived_at','questions_locked_at','documents','updated_at'].map(k=>[k,storedTest[k]])))
    const plannedQuestions=before['public.test_questions'].filter(r=>r.test_id===test.id).sort((a,b)=>Number(a.position)-Number(b.position)||String(a.id).localeCompare(String(b.id)))
    assert.deepEqual(parsed.questions,plannedQuestions.map(r=>Object.fromEntries(['id','artifact_id','source_artifact_id','test_id','question_type','question_text','options','correct_option','answer_key','sample_solution','points','response_max_chars','response_monospace','position'].map(k=>[k,r[k]]))))
    assert.equal(parsed.question_count,plannedQuestions.length)
    if (parsed.question_count === 0) evidence.emptySource++
    else evidence.nonemptySource++
    if (context.label === 'complete-1001-source') { assert.equal(parsed.question_count, 1001); evidence.complete1001Source++ }
    if (before) assert.deepEqual(parsed.draft, before['public.assessment_drafts'].find(d => d.assessment_type === 'test' && d.assessment_id === test.id) ?? null)
    else {
      const plannedDraft = f.drafts.find(d => d.assessment_id === test.id)
      assert.equal(parsed.draft === null, !plannedDraft)
      if (plannedDraft) for (const [key, value] of Object.entries(plannedDraft)) assert.deepEqual(parsed.draft![key as keyof NonNullable<Source['draft']>], value)
    }
    source = parsed
  }
  const safeFetch: typeof fetch = async (resource, init) => {
    try {
      phase = 'validate'; assert.equal(testOwnerDigest(JSON.stringify(manifest)), hash); assert(context && !(resource instanceof Request))
      const url = new URL(String(resource)); assert.equal(url.origin, API); assert(paths.includes(url.pathname)); assert(!url.search && !url.hash && !url.username && !url.password)
      assert.equal(init?.method, 'POST'); assert(typeof init.body === 'string' && Buffer.byteLength(init.body) <= TEST_OWNER_DRAFT_SAVE_CAPS.contentBytes + 4096)
      assert(Object.keys(init).every(k => ['method', 'headers', 'body', 'signal', 'redirect'].includes(k))); assert(init.redirect === undefined || init.redirect === 'error')
      assert(!init.signal || init.signal instanceof AbortSignal); assert(!init.signal?.aborted)
      const headers = new Headers(init.headers)
      assert.equal(headers.get('authorization'), `Bearer ${target.SERVICE_ROLE_KEY}`); assert.equal(headers.get('apikey'), target.SERVICE_ROLE_KEY)
      const allowed: Record<string, readonly string[]> = { authorization: [`Bearer ${target.SERVICE_ROLE_KEY}`], apikey: [target.SERVICE_ROLE_KEY], 'x-client-info': ['supabase-js-node/2.93.3'], accept: ['application/json'], 'accept-profile': ['public'], 'content-profile': ['public'], 'content-type': ['application/json'] }
      for (const [name, value] of headers) assert(allowed[name]?.includes(value))
      const body: Record<string, unknown> = JSON.parse(init.body)
      assert(typeof body.p_deadline === 'string' && Number.isFinite(Date.parse(body.p_deadline)))
      const remaining = Date.parse(body.p_deadline) - Date.now(); assert(remaining > 0 && remaining <= TEST_OWNER_DRAFT_SAVE_CAPS.requestMs)
      if (url.pathname === paths[0]) {
        assert.equal(dispatched, 0); assert.deepEqual(Object.keys(body).sort(), [...manifest.snapshotKeys].sort())
        assert.deepEqual(body, { p_actor_id: context.actorId, p_test_id: context.testId, p_deadline: body.p_deadline }); deadline = body.p_deadline
        operation = 'snapshot'
      } else {
        assert.equal(dispatched,1);assert(source && expectedInput);assert.equal(body.p_deadline,deadline)
        assert.deepEqual(Object.keys(body).sort(),[...manifest.finalKeys].sort())
        const valid=source.draft && source.test.status==='draft'?validateTestDraftContent(source.draft.content,{allowEmptyQuestionText:true,requirePortableQuestionIdentity:true}):null
        const baseline=source.draft && !(source.test.status==='draft' && !valid?.valid)?candidate(source):null
        const locked=source.test.questions_locked_at!==null
        const conflict=baseline===null || expectedInput.version!==source.draft?.version || context.kind==='structure'
        const built=conflict?null:buildNextDraftContent(baseline!,expectedInput,value=>validateTestDraftContent(value,{allowEmptyQuestionText:source!.test.status==='draft',requirePortableQuestionIdentity:true}))
        assert(!built || built.ok);const next=conflict?baseline:built!.ok?built!.content:null
        const docs=expectedInput.documents?preserveCurrentTestDocumentSnapshots(source.test.documents,stripTestDocumentSnapshots(expectedInput.documents)).map((d,i)=>d.source==='upload'?{...d,upload_content_type:expectedInput!.documents![i].upload_content_type}:d):null
        assert.deepEqual(body,{p_actor_id:context.actorId,p_test_id:context.testId,p_classroom_id:context.classroomId,
          p_expected_source_sha256:source.source_sha256,p_expected_version:source.draft?.version??null,
          p_operation:conflict?'inspect':'save',p_content:next,p_documents:conflict?null:docs,p_update_documents:!conflict && expectedInput.documents!==undefined,p_deadline:deadline})
        assert(!locked || context.kind!=='structure' || body.p_operation==='inspect');operation=String(body.p_operation)
      }
      assert(++counts.network <= TEST_OWNER_DRAFT_SAVE_CAPS.networkRequests); assert(++counts.rpc <= TEST_OWNER_DRAFT_SAVE_CAPS.rpcRequests); assert(++dispatched <= 2)
      phase = 'guard'; await guard()
      assert(!init.signal?.aborted && Date.now() < Date.parse(deadline!))
      phase = 'dispatch'; const timeout = AbortSignal.timeout(Math.max(1, Date.parse(deadline!) - Date.now()))
      const response = await original(resource, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([timeout, init.signal]) : timeout })
      assert(response.status < 300 || response.status >= 400); assert(!response.headers.has('location'))
      phase = 'decode'; const chunks: Uint8Array[] = []; let bytes = 0; const reader = response.body?.getReader()
      if (reader) for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length
        if (bytes > TEST_OWNER_DRAFT_SAVE_CAPS.responseBytes || bytes > TEST_OWNER_DRAFT_SAVE_CAPS.exchangeBytes - counts.exchangeBytes) { await reader.cancel(); throw new Error('Response cap') }; chunks.push(part.value) }
      counts.exchangeBytes += bytes; const data = Buffer.concat(chunks)
      // Transport observes all successful first-phase sources before final
      // authority. Rejected service responses are left to the real helper.
      if (response.ok && url.pathname === paths[0]) bindSnapshot(JSON.parse(data.toString('utf8')))
      if (!response.ok) {
        const rejected: unknown = JSON.parse(data.toString('utf8'))
        if (rejected && typeof rejected === 'object' && !Array.isArray(rejected)
          && (rejected as Record<string, unknown>).code === '42501') evidence.rawPrivilegeFailures++
      }
      phase = 'complete'; return new Response(data, { status: response.status, headers: response.headers })
    } catch { throw new Error('Test owner draft save proof transport rejected; private details withheld') }
  }
  return { target, fetch: safeFetch, counts, evidence, readContext, diagnostic: () => `DIAG test-owner-draft-save transport phase=${['idle', 'context', 'validate', 'guard', 'dispatch', 'decode', 'complete'].includes(phase) ? phase : 'unknown'} operation=${['unknown', 'snapshot', 'inspect', 'create', 'repair'].includes(operation) ? operation : 'unknown'} requests=${Math.min(counts.network, TEST_OWNER_DRAFT_SAVE_CAPS.networkRequests + 1)}.\n` }
}
export function testOwnerDraftSaveForcedReceipt(mode: string, error: unknown, complete: boolean) {
  if (complete && ['after-fixture', 'before-capture'].includes(mode) && error instanceof AssignmentListLifecycleError && error.primary?.stage === mode
    && error.primary.error instanceof Error && error.primary.error.message === 'Forced isolated lifecycle failure' && !error.cleanupFailures.length)
    return { stdout: cleanupMarker, stderr: `FAIL forced isolated test-owner-draft-save lifecycle: ${mode}.\n`, exitCode: 1 }
  return null
}
export function testOwnerDraftSaveSetupDiagnostic(stage: unknown, error: unknown) {
  const stages = ['pending', 'app-guard', 'app-write', 'app-snapshot', 'app-verify', 'sql-prepare', 'sql-setup', 'complete']
  const phase = typeof stage === 'string' && stages.includes(stage) ? stage : 'unknown'
  const lifecycle = error instanceof AssignmentListLifecycleError ? error : undefined
  const primaryStages = ['canonical-before', 'preflight', 'prepare', 'pre-start', 'start', 'capture', 'status', 'fixture', 'cases', 'revocations', 'after-fixture', 'before-capture']
  const primary = lifecycle?.primary?.stage
  const inherited = typeof primary === 'string' && primaryStages.includes(primary) ? primary : 'unknown'
  const cleanup = lifecycle ? lifecycle.cleanupFailures.length ? 'present' : 'none' : 'unknown'
  const cause = lifecycle ? lifecycle.primary?.error : error
  const kind = cause instanceof assert.AssertionError ? 'assertion'
    : cause instanceof Error && cause.message === 'Private platform command failed' ? 'platform-command' : 'unknown'
  return `DIAG test-owner-draft-save setup=${phase} lifecycle=${inherited} cleanup=${cleanup} failure=${kind}.\n`
}
export function parseTestOwnerDraftSaveLifecycleArgs(args: string[]) {
  const generateTypes = args.length === 5 && args[4] === '--generate-types'
  const input = parseAssignmentListLifecycleArgs(generateTypes ? args.slice(0, 4) : args)
  assert(!generateTypes || input.mode === 'normal')
  return { ...input, generateTypes }
}
export function testOwnerDraftSaveUnionManifest(original: ReturnType<typeof newAssignmentListProofFixture>, f: TestOwnerDraftSaveFixture, reviewedHead: string, repository: string) {
  const sql = buildDraftSaveNativeContractsManifest(original, reviewedHead, repository)
  const appIds = new Set(f.allocatedIds), originalIds = new Set(original.allocatedIds)
  assert(sql.fixture.allowedFixtureIds.every(id => !appIds.has(id) && !originalIds.has(id)))
  return Object.freeze({ version: 1, reviewedHead, originalSha256: testOwnerDigest(JSON.stringify(original.manifest)),
    application: testOwnerDraftSaveRequestManifest(f), sql,
    inventory: Object.freeze({ actors: 7, classes: 5, tests: 16, questions: 1010, initialDrafts: 11, enrollments: 5,
      triggerCategories: 15, archiveRevisionRows: 5, activeGenerations: 5, managedObjects:4,sdkCases: 24, sdkCreates: 0, sdkRepairs: 0, privilegeDriftProbes: 1, sqlBaseAllocatedIds: 16, sqlRollbackBulkIds: 10001 }) })
}
export function validateTestOwnerDraftSaveSetupSnapshot(f:TestOwnerDraftSaveFixture,input:unknown):Rows {
 assert(input && typeof input==='object' && !Array.isArray(input));const rows=input as Rows
 for(const [table,plans] of [['public.users',f.actors],['public.tests',f.tests],['public.test_questions',f.questions],['public.assessment_drafts',f.drafts],['public.classroom_enrollments',f.enrollments]] as const) {
  assert.equal(rows[table].length,plans.length)
  for(const plan of plans){const row=rows[table].find(r=>r.id===plan.id);assert(row);for(const [key,value] of Object.entries(plan)){
   if(value!==null && ['blueprint_archived_at','questions_locked_at'].includes(key))assert.equal(new Date(String(row[key])).toISOString(),value)
   else assert.deepEqual(row[key],value)
  }}
 }
 assert.equal(rows['public.managed_storage_objects'].length,3);assert.equal(rows['public.managed_storage_json_references'].length,1)
 assert(rows.__nontarget_fingerprints.length>0);return rows
}
export function verifyTestOwnerDraftSaveEffects(f:TestOwnerDraftSaveFixture,c:TestOwnerDraftSaveFixture['cases'][number],before:Rows,after:Rows,response:unknown) {
 if(c.status!==200){assert.deepEqual(after,before);return}
 assert(response && typeof response==='object');const result=response as {draft:Record<string,unknown>;test:Record<string,unknown>;editingPolicy:{structureLocked:boolean}}
 const prior=before['public.assessment_drafts'].find(r=>r.assessment_id===c.testId)!,row=after['public.assessment_drafts'].find(r=>r.assessment_id===c.testId)!;
 assert(prior && row);assert.deepEqual(row,result.draft);assert.equal(row.id,prior.id);assert.equal(row.version,Number(prior.version)+1)
 for(const key of ['created_by','created_at','assessment_id','assessment_type','classroom_id'])assert.deepEqual(row[key],prior[key])
 assert.equal(row.updated_by,c.actorId);assert(Date.parse(String(row.updated_at))>=Date.parse(String(prior.updated_at)))
 const a=before['public.tests'].find(r=>r.id===c.testId)!,b=after['public.tests'].find(r=>r.id===c.testId)!
 for(const [key,value] of Object.entries(result.test))assert.deepEqual(b[key],value)
 const changedTest=['title','show_results','documents'].some(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]))?1:0
 const priorQ=before['public.test_questions'].filter(r=>r.test_id===c.testId),afterQ=after['public.test_questions'].filter(r=>r.test_id===c.testId)
 const questions=assignmentListRowChanges({'public.test_questions':priorQ},{'public.test_questions':afterQ}).length
 const draftContent=row.content as {questions:Array<Record<string,unknown>>}
 if(b.status==='draft')assert.deepEqual(afterQ,priorQ)
 else {assert.equal(afterQ.length,draftContent.questions.length);for(const [index,p] of draftContent.questions.entries()){
  const q=afterQ.find(r=>(r.source_artifact_id??r.artifact_id)===p.id);assert(q);assert.equal(q.position,index)
  for(const key of ['question_text','question_type','options','correct_option','answer_key','sample_solution','points','response_max_chars','response_monospace'])assert.deepEqual(q[key],p[key])
 }}
 for(const [table,identity,column,delta] of [['public.classrooms','id','blueprint_source_revision',1+questions+changedTest],['public.classroom_archive_revisions','classroom_id','revision',3+2*questions+changedTest]] as const) {
  assert.equal(Number(after[table].find(r=>r[identity]===c.classroomId)![column])-Number(before[table].find(r=>r[identity]===c.classroomId)![column]),delta)
 }
 assert.deepEqual(after.__nontarget_fingerprints,before.__nontarget_fingerprints)
 const allowed=new Set(['public.assessment_drafts','public.tests','public.test_questions','public.classrooms','public.classroom_archive_revisions','public.managed_storage_objects','public.managed_storage_json_references','public.test_document_snapshot_storage_cleanup','__nontarget_fingerprints'])
 for(const table of Object.keys(before))if(!allowed.has(table))assert.deepEqual(after[table],before[table])
 for(const [table,key,target] of [['public.assessment_drafts','assessment_id',c.testId],['public.tests','id',c.testId],['public.test_questions','test_id',c.testId],['public.classrooms','id',c.classroomId],['public.classroom_archive_revisions','classroom_id',c.classroomId]] as const)assert.deepEqual(after[table].filter(r=>r[key]!==target),before[table].filter(r=>r[key]!==target))
 const expectedColumns:Record<string,string[]>={'public.assessment_drafts':['content','version','updated_by','updated_at'],'public.tests':['title','show_results','documents','updated_at'],'public.test_questions':['question_text','question_type','options','correct_option','answer_key','sample_solution','points','response_max_chars','response_monospace','position','updated_at'],'public.classrooms':['blueprint_source_revision','updated_at'],'public.classroom_archive_revisions':['revision','updated_at']}
 for(const [table,columns] of Object.entries(expectedColumns))assert(assignmentListRowChanges({[table]:before[table]},{[table]:after[table]}).every(change=>change.columns.every(k=>columns.includes(k)||(table==='public.test_questions'&&k==='__row__'))))
 for(const object of after['public.managed_storage_objects']) {
  const prior=before['public.managed_storage_objects'].find(r=>r.id===object.id);assert(prior)
  for(const key of ['id','storage_bucket','storage_path','classroom_id','created_by_user_id','purpose','resource_id','resource_type','verified_at','content_type','byte_size'])assert.deepEqual(object[key],prior[key])
  assert(['verified','ready','cleanup_pending'].includes(String(object.status)))
  const changed=Object.keys(object).filter(k=>JSON.stringify(object[k])!==JSON.stringify(prior[k]));assert(changed.every(k=>['status','ready_at','updated_at','cleanup_reason_code','next_attempt_at','attempt_count','lease_token','lease_expires_at','last_error_code'].includes(k)))
  if(object.id===f.managedObjects[2].id)assert.deepEqual(object,prior)
 }
 assert.deepEqual(after['public.managed_storage_json_references'].filter(r=>r.test_id!==c.testId),before['public.managed_storage_json_references'].filter(r=>r.test_id!==c.testId))
 for(const ref of after['public.managed_storage_json_references'].filter(r=>r.test_id===c.testId)){const object=after['public.managed_storage_objects'].find(r=>r.id===ref.managed_object_id);assert(object);assert.equal(object.classroom_id,c.classroomId);assert.equal(ref.storage_bucket,object.storage_bucket);assert.equal(ref.storage_path,object.storage_path);assert.equal(ref.reference_role,'teacher_document');assert.match(String(ref.evidence_sha256),/^[a-f0-9]{64}$/)}
 const queue=after['public.test_document_snapshot_storage_cleanup'];assert(queue.length<=1)
 if(c.kind==='doc-url'){assert.equal(queue.length,1);assert.equal(queue[0].storage_path,f.managedObjects[0].storage_path);assert.equal(queue[0].managed_object_id,f.managedObjects[0].id);assert.equal(queue[0].status,'pending');assert.equal(queue[0].lease_token,null)}
}
export function testOwnerDraftSaveCaseInput(f:TestOwnerDraftSaveFixture,c:TestOwnerDraftSaveFixture['cases'][number],rows:Rows):ContextualTestDraftSaveInput {
 const test=rows['public.tests'].find(r=>r.id===c.testId)!,draft=rows['public.assessment_drafts'].find(r=>r.assessment_id===c.testId)
 let content:unknown=draft?.content
 if(test.status!=='draft')content=buildTestDraftContentFromRows(test as never,rows['public.test_questions'].filter(r=>r.test_id===c.testId) as never)
 const version=c.kind==='stale'?1:Number(draft?.version??7)
 const validated=validateTestDraftContent(content,{allowEmptyQuestionText:true})
 const payload:Record<string,unknown>={version,content:validated.valid?validated.value:{question_identity_version:1,title:'Synthetic candidate',show_results:false,questions:[]}}
 if(c.kind==='content'){const v=payload.content as {questions:Array<Record<string,unknown>>};payload.content={...v,title:String(test.title)+(test.status==='active'?'':' saved'),...(test.status==='active'?{questions:v.questions.map(q=>({...q,question_text:String(q.question_text)+' corrected'}))}:{})}}
 if(c.kind==='patch') {delete payload.content;payload.patch=[{op:'replace',path:'/title',value:String(test.title)+' patched'}]}
 if(c.kind==='choice') {delete payload.content;payload.patch=[{op:'replace',path:'/questions/0/options/0',value:'Corrected choice'}]}
 if(c.kind==='structure'){delete payload.content;payload.patch=[{op:'replace',path:'/questions/0/points',value:2}]}
 if(c.kind.startsWith('doc-'))payload.documents=(test.documents as Array<Record<string,unknown>>).map(d=>({...d,title:String(d.title)+' revised',...(c.kind==='doc-url'?{url:'https://example.invalid/revised'}:{}),snapshot_path:'forged-path',snapshot_managed_object_id:f.managedObjects[2].id}))
 if(c.kind==='upload'||c.kind==='foreign-upload'){const m=f.managedObjects[c.kind==='upload'?1:2];payload.documents=[{id:m.id,title:'Synthetic upload',source:'upload',url:`https://example.invalid/storage/v1/object/public/test-documents/${m.storage_path}`,storage_bucket:m.storage_bucket,storage_path:m.storage_path,managed_object_id:m.id,upload_content_type:'application/pdf'}]}
 // Exercise the active editor's real wire shape before the named decoder,
 // rather than testing only its already-stripped canonical representation.
 if(payload.content){const v=payload.content as {questions:Array<Record<string,unknown>>};payload.content={...v,questions:v.questions.map((q,index)=>({...q,test_id:c.testId,position:index,created_at:f.now,updated_at:f.now}))}}
 return contextualTestDraftSaveRequestSchema.parse(payload)
}

/** The SQL adapter restores its grant/catalog/fixture in its own finally. The
 * application fixture has a different scope, so its comparison must run even
 * when the SDK callback or adapter restoration rejects. No writes or SQL here. */
export async function verifyTestOwnerDraftSavePrivilegeRestoration(
  before: Rows, snapshot: () => Promise<Rows>,
  probe: () => Promise<{ privilegeRestored: boolean; fixtureUnchanged: boolean; snapshotAclSha256: string }>,
) {
  try {
    const receipt = await probe()
    assert(receipt.privilegeRestored && receipt.fixtureUnchanged)
    assert.match(receipt.snapshotAclSha256, /^[a-f0-9]{64}$/)
    return receipt
  } finally {
    assert.deepEqual(await snapshot(), before, 'Application privilege-probe rows changed')
  }
}

export async function testOwnerDraftSaveLifecycleMain(args = process.argv.slice(2)) {
  const input = parseTestOwnerDraftSaveLifecycleArgs(args)
  const git = (values: string[]) => execFileSync('git', values, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['status', '--porcelain']), ''); const repository = git(['rev-parse', '--show-toplevel']); assert.equal(repository, process.cwd())
  const migrations = loadAssignmentListReviewedMigrations(repository); assert(migrations.length >= 249, 'Complete schema must include the 001–249 baseline')
  const original = newAssignmentListProofFixture(); const f = newTestOwnerDraftSaveFixture(original); const projectId = `pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`
  const native = createAssignmentListNativeAdapters(original); const originalSetup = assignmentListFixtureSetupSql(original, projectId)
  const setupSql = testOwnerDraftSaveSetupSql(f, projectId); const snapshotSql = testOwnerDraftSaveSnapshotSql(f)
  const setupHash = testOwnerDigest(setupSql); const snapshotHash = testOwnerDigest(snapshotSql)
  const union = testOwnerDraftSaveUnionManifest(original, f, input.head, repository); const unionHash = testOwnerDigest(JSON.stringify(union))
  let target: ReturnType<typeof validateAssignmentListProofTarget> | undefined; let session: Session | undefined; let complete = false; let matrixComplete = false
  let closure: Awaited<ReturnType<typeof assignmentListDockerInventory>> | undefined
  let transport: ReturnType<typeof createTestOwnerDraftSaveProofTransport> | undefined; let client: ReturnType<typeof createClient<Database>> | undefined
  let sqlContracts: ReturnType<typeof createDraftSaveNativeContracts> | undefined; let sqlComplete = false
  let nativeReceipt: Awaited<ReturnType<NonNullable<typeof sqlContracts>['run']>> | undefined
  let setupStage = 'pending'
  let typesReceipt: Awaited<ReturnType<typeof generateTestDraftSaveTypes>> | undefined
  const originalPal = process.env.PAL_ENABLED; process.env.PAL_ENABLED = 'false'
  function privateSql(sql: string) {
    assert(session && [testOwnerGuardSql(projectId), snapshotSql].includes(sql))
    return execFileSync('docker', ['exec', '-i', '-e', `PGAPPNAME=${projectId}_fixture`, session.containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000, maxBuffer: TEST_OWNER_DRAFT_SAVE_CAPS.responseBytes }).trim()
  }
  async function guard() {
    assert(target && session); closure = validateIntegratedGuardResources(await testOwnerListDockerInventory(), projectId, session.containerId, closure)
    assert.equal(privateSql(testOwnerGuardSql(projectId)), 'ok')
  }
  async function snapshot(): Promise<Rows> {
    assert.equal(testOwnerDigest(snapshotSql), snapshotHash); await guard(); const captured = privateSql(snapshotSql)
    assert(Buffer.byteLength(captured) <= TEST_OWNER_DRAFT_SAVE_CAPS.responseBytes); return JSON.parse(captured)
  }
  async function setup() {
    setupStage = 'app-guard'; assert.equal(testOwnerDigest(setupSql), setupHash); await guard(); assert(session)
    setupStage = 'app-write'; await native.executeSql({ ...session, sql: setupSql })
    setupStage = 'app-snapshot'; const setupRows = await snapshot()
    setupStage = 'app-verify'; validateTestOwnerDraftSaveSetupSnapshot(f, setupRows); assert(closure)
    assert.equal(testOwnerDigest(JSON.stringify(union)), unionHash)
    setupStage = 'sql-prepare'
    sqlContracts = createDraftSaveNativeContracts({ repository, reviewedHead: input.head, original, capturedResources: closure, containerId: session.containerId,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(union.sql)) })
    setupStage = 'sql-setup'; const receipt = await sqlContracts.setup(); assert.equal(receipt.fixtureSha256, testOwnerDigest(JSON.stringify(union.sql.fixture)))
    assert.equal(receipt.setupSha256, testOwnerDigest(union.sql.setup)); complete = true; setupStage = 'complete'
  }
  async function matrix() {
    assert(complete && !matrixComplete && client && transport)
    const { saveContextualTestDraft } = await import('../src/lib/server/contextual-test-draft-save')
    for(const proofCase of f.cases) {
     const before=await snapshot(),proofInput=testOwnerDraftSaveCaseInput(f,proofCase,before),count=transport.counts.rpc
     transport.readContext(proofCase.testId,proofCase.actorId,before,proofInput,proofCase.label)
     const read=()=>saveContextualTestDraft({supabase:client!,actorId:proofCase.actorId,testId:proofCase.testId,input:proofInput})
     let body:unknown
     if([400,403,503].includes(proofCase.status))await assert.rejects(read,e=>e instanceof ApiError && e.statusCode===proofCase.status)
     else {const result=await read();assert.equal(result.status,proofCase.status);body=result.body}
     assert.equal(transport.counts.rpc-count,proofCase.status===403?1:2);verifyTestOwnerDraftSaveEffects(f,proofCase,before,await snapshot(),body)
    }
    assert.equal(transport.counts.storage,0);assert.equal(transport.counts.rpc,41);assert.equal(transport.evidence.complete1001Source,1);assert(sqlContracts)
    const beforePrivilege=await snapshot(),privilegeCase=f.cases.find(c=>c.label==='draft-json-patch')!;const proofInput=testOwnerDraftSaveCaseInput(f,privilegeCase,beforePrivilege)
    await verifyTestOwnerDraftSavePrivilegeRestoration(beforePrivilege,snapshot,()=>sqlContracts!.probeSnapshotPrivilegeDrift(async()=>{
     const count=transport!.counts.rpc,raw=transport!.evidence.rawPrivilegeFailures
     transport!.readContext(privilegeCase.testId,privilegeCase.actorId,beforePrivilege,proofInput,privilegeCase.label)
     await assert.rejects(()=>saveContextualTestDraft({supabase:client!,actorId:privilegeCase.actorId,testId:privilegeCase.testId,input:proofInput}),e=>e instanceof ApiError&&e.statusCode===503)
     assert.equal(transport!.counts.rpc-count,1);assert.equal(transport!.evidence.rawPrivilegeFailures-raw,1)
     return {status:503 as const,rpcCalls:1 as const,rawCode:'42501' as const}
    }))
    assert.equal(transport.counts.rpc,42)
    assert(sqlContracts); const beforeContracts = await snapshot(); const receipt = await sqlContracts.run()
    nativeReceipt=receipt
    assert(receipt.fixtureUnchanged); assert.equal(receipt.manifestSha256, testOwnerDigest(JSON.stringify(union.sql)))
    assert.deepEqual(await snapshot(), beforeContracts); sqlComplete = true; matrixComplete = true
    if (input.generateTypes) {
      assert(input.mode === 'normal' && complete && matrixComplete && sqlComplete)
      typesReceipt = await generateTestDraftSaveTypes({ repository, reviewedHead: input.head, projectId, guard })
    }
  }
  try {
    await runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir: assignmentListProofWorkdir(projectId), migrations, mode: input.mode,
      expectedResources: assignmentListExpectedResources(projectId), reviewedManifestSha256: testOwnerDigest(JSON.stringify(original.manifest)),
      restorationPolicies: assignmentListRevocationPlans(original).map(plan => assignmentListRestorationPolicy(original, plan)) },
    { ...native, async command(request) { const result = await native.command(request); if (request.args[0] === 'status') target = validateAssignmentListProofTarget(result, projectId); return result },
      async executeSql(request) { await native.executeSql(request); if (request.sql === originalSetup) { assert(!session && target); session = { ...request }
        transport = createTestOwnerDraftSaveProofTransport(f, target, projectId, fetch, guard)
        client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } }); await setup() } },
      async runCase(request) { const result = await native.runCase(request); if (!matrixComplete) await matrix(); return result } })
    assert(complete && matrixComplete && sqlComplete)
    process.stdout.write(`PASS isolated test-owner-draft-save twenty-four actual installed-SDK helper/RPC cases including complete 1001-question source; exact restored privilege-drift probe; rollback SQL contracts and two-session schedules.\n${cleanupMarker}`)
    return Object.freeze({ types: typesReceipt ?? null,proof:Object.freeze({reviewedHead:input.head,manifestSha256:unionHash,
      sdkCases:f.cases.length,rpcRequests:transport!.counts.rpc,storageRequests:transport!.counts.storage,exchangeBytes:transport!.counts.exchangeBytes,native:nativeReceipt}) })
  } catch (error) {
    const receipt = testOwnerDraftSaveForcedReceipt(input.mode, error, complete)
    if (receipt) { process.stdout.write(receipt.stdout); process.stderr.write(receipt.stderr); process.exitCode = receipt.exitCode; return }
    process.stderr.write(testOwnerDraftSaveSetupDiagnostic(setupStage, error))
    if (transport) process.stderr.write(transport.diagnostic()); throw new Error('Test owner draft save lifecycle failed; private details withheld')
  } finally { if (originalPal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = originalPal }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) testOwnerDraftSaveLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated test-owner-draft-save lifecycle; private details withheld.\n'); process.exitCode = 1
})
