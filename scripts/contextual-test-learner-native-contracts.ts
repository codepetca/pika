/** Inert, source-sealed learner schedules. This module opens no process, SDK,
 * SQL connection or Storage resource. Mock receipts never prove native acceptance. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { loadAssignmentListReviewedMigrations } from './contextual-assignment-list-proof-platform'
import { validateTestOwnerGradingReviewedMigration } from './test-owner-grading-reviewed-migration'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { newTestLearnerWorkflowFixture, type TestLearnerObservedAttempt } from './contextual-test-learner-proof-fixture'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import type { DraftSaveDriver, DraftSaveSession, DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'
import { normalizeTestResponses, buildTestAttemptHistoryMetrics } from '../src/lib/test-attempts'

export const TEST_LEARNER_NATIVE_SOURCE_SHA256 = 'd4f12d17b79e4800e5bdd6ea7db2c0fee7cf51d19a5dfde93084c243b22c1e2a'
const caps = Object.freeze({ sqlBytes: 256*1024, responseBytes: 8*1024*1024, requestMs: 12000, closeMs: 12000, totalMs: 180000, dispatches: 20 })
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const json = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function freeze<T>(value: T): T { if (value && typeof value==='object') { Object.values(value).forEach(freeze);Object.freeze(value) } return value }
function bounded(sql: string) { assert(Buffer.byteLength(sql)<=caps.sqlBytes);return sql }
const sourcePlans = new WeakMap<object, TestLearnerNativePlan>()

export function testLearnerNativePlan(original: AssignmentListProofFixture, observedAttempts: readonly TestLearnerObservedAttempt[], reviewedHead: string, repository: string) {
  assert.match(reviewedHead,/^[a-f0-9]{40}$/)
  const fixture = newTestLearnerWorkflowFixture(original), f=fixture
  assert(Object.isFrozen(observedAttempts) && observedAttempts.length===2)
  const observed = [1,2].map(index=>{
    const row=observedAttempts[index-1]
    assert(Object.isFrozen(row));assert.deepEqual(Object.keys(row).sort(),['actorId','attemptId','revision'])
    assert.equal(row.actorId,f.actors[index].id);assert.match(row.attemptId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    assert(!f.allocatedIds.includes(row.attemptId) && !new Set<string>(original.allocatedIds).has(row.attemptId))
    assert(Number.isSafeInteger(row.revision) && row.revision>=1)
    return {...row}
  })
  assert.notEqual(observed[0].attemptId,observed[1].attemptId)
  const reviewedMigrations=loadAssignmentListReviewedMigrations(repository)
  assert([257,258].includes(reviewedMigrations.length),'Unreviewed learner migration profile')
  if(reviewedMigrations.length===258)validateTestOwnerGradingReviewedMigration(reviewedMigrations[257])
  const migrations=reviewedMigrations.map(({name,sha256})=>({name,sha256}))
  assert.deepEqual(migrations[256],{name:'257_contextual_test_learner_workflow.sql',sha256:TEST_LEARNER_NATIVE_SOURCE_SHA256})
  const projectId=`pika_assignment_list_${f.tag.slice(-12)}`, guard=testOwnerGuardSql(projectId)
  const actor=`${q(f.actors[1].id)}::uuid`, tid=`${q(f.testId)}::uuid`, cid=`${q(f.classroomId)}::uuid`, aid=`${q(observed[0].attemptId)}::uuid`
  const response={[f.questions[0].id]:{question_type:'open_response',response_text:'Synthetic native CAS response'},
    [f.questions[1].id]:{question_type:'multiple_choice',selected_option:0}}
  const metrics=buildTestAttemptHistoryMetrics(normalizeTestResponses(response),0,1)
  const payload={responses:response,expected_revision:observed[0].revision,trigger:'autosave',paste_word_count:0,keystroke_count:1}
  const call=(operation: string, body: string)=>`public.test_learner_workflow_v1(${actor},${tid},${cid},${q(operation)},${body},pg_catalog.clock_timestamp()+interval '30 seconds')`
  const save=call('save',json(payload)), submit=call('submit',json({responses:response,expected_revision:observed[0].revision}))
  const historyPlan=call('history-plan',`pg_catalog.jsonb_build_object('attempt_id',${aid},'draft_revision',(select draft_revision from public.test_attempts where id=${aid}))`)
  const historyWrite=call('history-write',`pg_catalog.jsonb_build_object('attempt_id',${aid},'draft_revision',(select draft_revision from public.test_attempts where id=${aid}),'expected_last',plan->'result'->'last_history','collapse',false,'patch',null,'snapshot',(select responses from public.test_attempts where id=${aid}),'trigger','baseline','word_count',${metrics.word_count},'char_count',${metrics.char_count},'paste_word_count',0,'keystroke_count',1)`)
  function scoped(table: string,predicate: string) { return `${q(table)},(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text),'[]'::jsonb) from ${table} r where ${predicate})` }
  const tests=`select id from public.tests where classroom_id=${cid}`
  const graph=`pg_catalog.jsonb_build_object(${[
    scoped('public.users',`id in (${f.actors.map(row=>q(row.id)).join(',')})`),scoped('public.classrooms',`id in (${q(f.classroomId)},${q(f.wrongClassroomId)})`),
    scoped('public.classroom_enrollments',`classroom_id=${cid}`),scoped('public.classroom_archive_revisions',`classroom_id=${cid}`),
    scoped('public.tests',`classroom_id=${cid}`),scoped('public.assessment_drafts',`classroom_id=${cid}`),
    ...['test_questions','test_attempts','test_responses','test_student_availability','test_focus_events','test_ai_grading_runs','test_ai_grading_run_items'].map(table=>scoped(`public.${table}`,`test_id in (${tests})`)),
    scoped('public.test_attempt_history',`test_attempt_id in (select id from public.test_attempts where test_id in (${tests}))`),
    scoped('public.managed_storage_objects',`classroom_id=${cid}`),scoped('public.managed_storage_json_references',`test_id in (${tests})`),
    scoped('public.test_document_snapshot_storage_cleanup','true'),scoped('public.managed_storage_settings','true'),
    scoped('storage.objects',"bucket_id='test-documents'"),scoped('storage.buckets',"id='test-documents'"),
  ].join(',')})`
  const snapshot=bounded(`begin read only;set local statement_timeout='8s';set local lock_timeout='1s';select ${graph} as result;rollback;`)
  const setup=bounded(`${guard}\nbegin read only;set local statement_timeout='8s';set local lock_timeout='1s';
do $presence$ begin
 if ${f.actors.map(row=>`not exists(select 1 from public.users where id=${q(row.id)} and role=${q(row.role)} and email=${q(row.email)})`).join('\n or ')}
 or not exists(select 1 from public.classrooms where id=${cid} and teacher_id=${q(f.actors[0].id)} and archived_at is null)
 or not exists(select 1 from public.tests where id=${tid} and classroom_id=${cid} and status='active')
 or not exists(select 1 from public.tests test cross join lateral pg_catalog.jsonb_array_elements(test.documents) document where test.id=${tid} and document->>'id'=${q(f.materials[0].id)} and document->>'source'='upload' and document->>'storage_path'=${q(f.materials[0].path)} and document->>'managed_object_id'=${q(f.materials[0].objectId)})
 or ${f.enrollments.map(row=>`not exists(select 1 from public.classroom_enrollments where id=${q(row.id)} and classroom_id=${cid} and student_id=${q(row.actorId)})`).join('\n or ')}
 or ${f.questions.map(row=>`not exists(select 1 from public.test_questions where id=${q(row.id)} and test_id=${tid})`).join('\n or ')}
 or ${observed.map(row=>`not exists(select 1 from public.test_attempts where id=${q(row.attemptId)} and test_id=${tid} and student_id=${q(row.actorId)} and draft_revision=${row.revision} and not is_submitted and returned_at is null and closed_for_grading_at is null)`).join('\n or ')}
 or not exists(select 1 from public.test_attempt_history where test_attempt_id=${aid})
 or not exists(select 1 from public.managed_storage_objects object join public.managed_storage_json_references reference on reference.managed_object_id=object.id where object.id=${q(f.materials[0].objectId)} and object.classroom_id=${cid} and object.storage_path=${q(f.materials[0].path)} and object.status='ready' and object.purpose='teacher_test_material' and object.content_type is null and reference.test_id=${tid} and reference.storage_bucket='test-documents' and reference.storage_path=object.storage_path)
 then raise exception 'Migration257 learner fixture presence differs';end if;
end;$presence$;rollback;`)
  const prefix="begin read only;set local lock_timeout='3s';set local statement_timeout='30s';",terminal="end;$guard$;select 'ok';rollback;"
  const identity=`current_setting('application_name')<>${q(projectId+'_fixture')}`
  assert(guard.startsWith(prefix)&&guard.endsWith(terminal));assert.equal(guard.split(identity).length,2)
  const inherited=guard.slice(prefix.length,-terminal.length).replace(identity,`current_setting('application_name') not in (${q(projectId+'_draft_holder')},${q(projectId+'_draft_contender')},${q(projectId+'_draft_contracts')})`)
  const begin=`begin;set local lock_timeout='1s';set local statement_timeout='12s';set local idle_in_transaction_session_timeout='180s';${inherited}
 if current_database()<>'postgres' or current_user<>'postgres' or to_regprocedure('public.test_learner_workflow_v1(uuid,uuid,uuid,text,jsonb,timestamptz)') is null then raise exception 'Migration257 disposable source differs';end if;end;$guard$;`
  const contracts=freeze({checks:['same-attempt-save-cas','same-attempt-submit-cas','same-attempt-history-cas'],sql:bounded(`${begin}
do $cas$ declare first jsonb;second jsonb;plan jsonb;baseline jsonb;code text;succeeded boolean:=false;begin
 first:=${save};if first->'result'->'conflict'='true'::jsonb or not coalesce((first->'result'->'attempt'->>'draft_revision')::bigint>${observed[0].revision},false) or first->'result'->'attempt'->>'id' is distinct from ${q(observed[0].attemptId)} or first->'result'->'attempt'->'responses' is distinct from ${json(response)} then raise exception 'First save differs';end if;
 baseline:=${graph};second:=${save};if second->'result'->'conflict' is distinct from 'true'::jsonb or ${graph} is distinct from baseline then raise exception 'same-attempt-save-cas differs';end if;
 second:=${submit};if second->'result'->'conflict' is distinct from 'true'::jsonb or ${graph} is distinct from baseline then raise exception 'same-attempt-submit-cas differs';end if;
 plan:=${historyPlan};perform ${historyWrite};baseline:=${graph};begin perform ${historyWrite};succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;
 if succeeded or code is distinct from 'PT409' then raise exception 'same-attempt-history-cas differs';end if;
 if ${graph} is distinct from baseline then raise exception 'Rejected history CAS changed rows';end if;
end;$cas$;select pg_catalog.jsonb_build_object('checks',${json(['same-attempt-save-cas','same-attempt-submit-cas','same-attempt-history-cas'])}) as result;rollback;`)})
  function exact(sql: string) { return `do $one$ declare n integer;begin ${sql};get diagnostics n=row_count;if n<>1 then raise exception 'Exact learner holder scope differs';end if;end;$one$;` }
  const advisoryKey=`pg_catalog.hashtextextended(${q(f.testId)},0)`
  const make=(label: string, holder: string, relation: string, rejectedCall: string,advisory=false)=>{
    const held=advisory?`exists(select 1 from pg_catalog.pg_locks l cross join lateral(select (${advisoryKey})::bigint value) k where l.pid=pg_catalog.pg_backend_pid() and l.granted and l.locktype='advisory' and l.classid::bigint=((k.value>>32)&4294967295) and l.objid::bigint=(k.value&4294967295) and l.objsubid=1)`
      :`exists(select 1 from pg_catalog.pg_locks l where l.pid=pg_catalog.pg_backend_pid() and l.granted and l.locktype='relation' and l.relation=${q(relation)}::regclass and l.mode in ('RowShareLock','RowExclusiveLock'))`
    return {label,relation,holderSql:bounded(`${begin}\n${holder}\nselect pg_catalog.jsonb_build_object('held',${held},'transaction',exists(select 1 from pg_catalog.pg_stat_activity where pid=pg_catalog.pg_backend_pid() and xact_start is not null),'scope',exists(select 1 from public.test_attempts where id=${aid} and test_id=${tid} and student_id=${actor}),'backend_pid',pg_catalog.pg_backend_pid(),'application_name',current_setting('application_name'),'relation',${q(relation)},'label',${q(label)}) as result;`),
      rejectSql:bounded(`${begin}\ndo $reject$ declare baseline jsonb;code text;succeeded boolean:=false;begin baseline:=${graph};begin perform ${rejectedCall};succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;if succeeded or code is distinct from 'PT409' then raise exception 'Learner contention code differs';end if;if ${graph} is distinct from baseline then raise exception 'Rejected learner changed rows';end if;end;$reject$;select pg_catalog.jsonb_build_object('rejected',true,'code','PT409','rows_unchanged',true,'label',${q(label)}) as result;`)}
  }
  const detail=call('detail',"'{}'::jsonb")
  const concurrency=freeze({schedules:[
    make('test-advisory',`select pg_catalog.pg_advisory_xact_lock(${advisoryKey});`,'public.tests',detail,true),
    make('classroom',exact(`perform id from public.classrooms where id=${cid} for update nowait`),'public.classrooms',detail),
    make('test',exact(`perform id from public.tests where id=${tid} for update nowait`),'public.tests',detail),
    make('enrollment',exact(`perform id from public.classroom_enrollments where id=${q(f.enrollments[1].id)} and classroom_id=${cid} and student_id=${actor} for update nowait`),'public.classroom_enrollments',detail),
    make('attempt',exact(`perform id from public.test_attempts where id=${aid} and test_id=${tid} and student_id=${actor} for update nowait`),'public.test_attempts',detail),
    make('history',exact(`perform id from public.test_attempt_history where id=(select id from public.test_attempt_history where test_attempt_id=${aid} order by created_at desc,id desc limit 1) for update nowait`),'public.test_attempt_history',historyPlan),
    make('document-object',exact(`perform id from public.managed_storage_objects where id=${q(f.materials[0].objectId)} and classroom_id=${cid} and storage_path=${q(f.materials[0].path)} for update nowait`),'public.managed_storage_objects',call('document',json({document_id:f.materials[0].id,source:'upload'}))),
    make('save-competitor',`do $write$ begin perform ${save};end;$write$;`,'public.test_attempts',save,true),
    make('submit-competitor',`do $write$ begin perform ${submit};end;$write$;`,'public.test_attempts',submit,true),
    make('history-cas-competitor',`do $write$ declare plan jsonb;begin plan:=${historyPlan};perform ${historyWrite};end;$write$;`,'public.test_attempt_history',historyPlan,true),
  ]})
  const trigger=`${f.tag}_cancel`, fn=`private.${trigger}`
  const cancellation=freeze({actorId:f.actors[1].id,testId:f.testId,classroomId:f.classroomId,operation:'save' as const,payload,
    catalog:bounded(`begin read only;set local statement_timeout='8s';select pg_catalog.jsonb_build_object('function',to_regprocedure(${q(fn+'()')})::text,'triggers',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(oid) order by oid),'[]'::jsonb) from pg_catalog.pg_trigger where tgrelid='public.test_attempts'::regclass and tgname=${q(trigger)})) as result;rollback;`),
    install:bounded(`${guard}\nbegin;set local statement_timeout='8s';set local lock_timeout='1s';do $absent$ begin if to_regprocedure(${q(fn+'()')}) is not null or exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.test_attempts'::regclass and tgname=${q(trigger)}) then raise exception 'Cancellation fault already exists';end if;end;$absent$;
create function ${fn}() returns trigger language plpgsql set search_path='' as $fault$ begin perform pg_catalog.pg_sleep(9);return new;end;$fault$;
revoke all on function ${fn}() from public,anon,authenticated,service_role;
create trigger ${trigger} before update on public.test_attempts for each row when (old.id=${aid} and old.test_id=${tid} and old.student_id=${actor}) execute function ${fn}();commit;`),
    installed:bounded(`begin read only;set local statement_timeout='8s';do $catalog$ declare definition text;trigger_definition text;begin
 select pg_catalog.pg_get_functiondef(p.oid) into strict definition from pg_catalog.pg_proc p where p.oid=${q(fn+'()')}::regprocedure and p.proowner='postgres'::regrole and not p.prosecdef and p.proconfig=array['search_path=""']::text[];
 if position('perform pg_catalog.pg_sleep(9);return new;' in definition)=0 or exists(select 1 from pg_catalog.aclexplode((select proacl from pg_catalog.pg_proc where oid=${q(fn+'()')}::regprocedure)) acl where acl.grantee<>'postgres'::regrole::oid) then raise exception 'Cancellation function differs';end if;
 select pg_catalog.pg_get_triggerdef(t.oid) into strict trigger_definition from pg_catalog.pg_trigger t where t.tgrelid='public.test_attempts'::regclass and t.tgname=${q(trigger)} and t.tgfoid=${q(fn+'()')}::regprocedure and t.tgenabled='O';
 if position('BEFORE UPDATE ON public.test_attempts FOR EACH ROW WHEN' in trigger_definition)=0 or ${[observed[0].attemptId,f.testId,f.actors[1].id].map(id=>`position(${q(id)} in trigger_definition)=0`).join(' or ')} then raise exception 'Cancellation trigger differs';end if;
end;$catalog$;select pg_catalog.jsonb_build_object('installed',true) as result;rollback;`),
    restore:bounded(`${guard}\nbegin;set local statement_timeout='8s';set local lock_timeout='1s';drop trigger if exists ${trigger} on public.test_attempts;drop function if exists ${fn}();commit;`),
  })
  const plan=freeze({version:1,reviewedHead,projectId,fixture,observedAttempts:observed,migrations,migrationManifestSha256:hash(JSON.stringify(migrations)),sourceSha256:TEST_LEARNER_NATIVE_SOURCE_SHA256,guard,setup,snapshot,contracts,concurrency,cancellation,caps,nativeVerified:false as const,
    limitations:['Rollback schedules prove held contention and in-transaction CAS; committed cross-session freshness is not claimed.','Eight-second PostgREST cancellation requires an observed 57014 receipt; NOWAIT PT409 is separate.']})
  sourcePlans.set(plan.contracts,plan)
  return plan
}
export type TestLearnerNativePlan = ReturnType<typeof testLearnerNativePlan>
function sourcePlan(m: TestLearnerNativePlan) {
  const expected=sourcePlans.get(m.contracts)
  return expected!==undefined&&Object.isFrozen(m)&&Object.keys(expected).every(key=>m[key as keyof TestLearnerNativePlan]===expected[key as keyof TestLearnerNativePlan])
}
export function validateTestLearnerNativePlanSql(m: TestLearnerNativePlan, sql: string) {
  return sourcePlan(m)&&typeof sql==='string'&&Buffer.byteLength(sql)<=caps.sqlBytes&&[m.setup,m.snapshot,m.contracts.sql,m.cancellation.catalog,m.cancellation.install,m.cancellation.installed,...m.concurrency.schedules.flatMap(s=>[s.holderSql,s.rejectSql])].includes(sql)
}
function validateTarget(m: TestLearnerNativePlan,t: DraftSaveTarget,phase:'contracts'|'concurrency') {
  assert(sourcePlan(m)&&Object.isFrozen(t));assert.equal(t.projectId,m.projectId);assert.equal(t.containerProjectLabel,m.projectId)
  assert.equal(t.disposable,true);assert.equal(t.apiUrl,'http://127.0.0.1:54331');assert.equal(t.databaseHost,'127.0.0.1');assert.equal(t.databasePort,54332)
  assert.match(t.containerId,/^[a-f0-9]{64}$/);assert.equal(t.reviewedHead,m.reviewedHead);assert.equal(t.reviewedSourceSha256,m.sourceSha256)
  assert.equal(t.migrationManifestSha256,m.migrationManifestSha256);assert.equal(t.acceptedManifestSha256,hash(JSON.stringify(m[phase])))
}
function runner(m:TestLearnerNativePlan,t:DraftSaveTarget,d:DraftSaveDriver) {
  const started=Date.now();let dispatches=0
  const remaining=()=>{const value=caps.totalMs-(Date.now()-started);assert(value>0);return value}
  const verify=async()=>{remaining();assert.deepEqual(await d.verifyTarget(),t);remaining()}
  return {verify,async execute(s:DraftSaveSession,sql:string){assert(validateTestLearnerNativePlanSql(m,sql));assert(++dispatches<=caps.dispatches);await verify();const rows=await s.execute(sql,Math.min(caps.requestMs,remaining()));remaining();assert(Buffer.byteLength(JSON.stringify(rows))<=caps.responseBytes);assert.equal(rows.length,1);assert('result' in rows[0]);return rows[0].result}}
}
export async function runTestLearnerNativeContracts(m:TestLearnerNativePlan,t:DraftSaveTarget,d:DraftSaveDriver) {
  validateTarget(m,t,'contracts');const r=runner(m,t,d);await r.verify();const s=await d.openSession(`${m.projectId}_draft_contracts`)
  try {assert.equal(s.name,`${m.projectId}_draft_contracts`);assert.deepEqual(await r.execute(s,m.contracts.sql),{checks:m.contracts.checks});return freeze({checks:m.contracts.checks,nativeVerified:false as const})}
  finally {await s.rollbackAndClose(caps.closeMs)}
}
export async function runTestLearnerNativeRaces(m:TestLearnerNativePlan,t:DraftSaveTarget,d:DraftSaveDriver) {
  validateTarget(m,t,'concurrency');const r=runner(m,t,d),outcomes:string[]=[]
  for(const schedule of m.concurrency.schedules){let holder:DraftSaveSession|undefined,contender:DraftSaveSession|undefined
    try {await r.verify();holder=await d.openSession(`${m.projectId}_draft_holder`);contender=await d.openSession(`${m.projectId}_draft_contender`)
      assert.equal(holder.name,`${m.projectId}_draft_holder`);assert.equal(contender.name,`${m.projectId}_draft_contender`)
      const raw=await r.execute(holder,schedule.holderSql);assert(raw&&typeof raw==='object'&&!Array.isArray(raw));const row=raw as Record<string,unknown>
      assert.deepEqual(Object.keys(row).sort(),['application_name','backend_pid','held','label','relation','scope','transaction'])
      assert.equal(row.held,true);assert.equal(row.scope,true);assert.equal(row.transaction,true);assert(Number.isSafeInteger(row.backend_pid)&&Number(row.backend_pid)>0)
      assert.equal(row.application_name,holder.name);assert.equal(row.label,schedule.label);assert.equal(row.relation,schedule.relation)
      assert.deepEqual(await r.execute(contender,schedule.rejectSql),{rejected:true,code:'PT409',rows_unchanged:true,label:schedule.label});outcomes.push(schedule.label)
    } finally {const closed=await Promise.allSettled([holder,contender].filter((s):s is DraftSaveSession=>Boolean(s)).map(s=>s.rollbackAndClose(caps.closeMs)));const bad=closed.find(s=>s.status==='rejected');if(bad?.status==='rejected')throw bad.reason}
  }
  return freeze({outcomes,nativeVerified:false as const})
}
