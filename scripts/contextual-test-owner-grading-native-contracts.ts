/** Fixed inert SQL frames for the existing closed native engine. This module
 * opens no process, SQL connection, SDK, Storage or network resource. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { loadAssignmentListReviewedMigrations } from './contextual-assignment-list-proof-platform'
import { TEST_OWNER_GRADING_REVIEWED_MIGRATION, validateTestOwnerGradingReviewedMigration } from './test-owner-grading-reviewed-migration'
import type { TestLearnerObservedAttempt } from './contextual-test-learner-proof-fixture'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import type { DraftSaveDriver, DraftSaveSession, DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'
import { newTestOwnerGradingFixture, freezeOwnerGrading as freeze, ownerGradingDigest as hash,
  TEST_OWNER_GRADING_PROOF_CAPS as caps } from './contextual-test-owner-grading-proof-fixture'

const q=(value:string)=>`'${value.replaceAll("'","''")}'`
const json=(value:unknown)=>`${q(JSON.stringify(value))}::jsonb`
const plans=new WeakMap<object,TestOwnerGradingNativePlan>()
const checks=freeze(['current-nonowner-roster','late-batch-rollback','answered-mc-clear','revision-provenance-review','zero-return-idempotent',
  'clear-retracts-return','empty-roster-source','logical-source-bound','no-question-return','nonfinite-eligibility-or-constraint',
  'global-closed-finalization','authority-freshness','active-ai-both-orders'])
function bounded(sql:string){assert(Buffer.byteLength(sql)<=caps.sqlBytes);return sql}
/** Only the coordinator-owned exact source constant can bind this candidate.
 * Neither this function nor any mock runner can establish native acceptance. */
export function testOwnerGradingNativePlan(original:AssignmentListProofFixture,observed:readonly TestLearnerObservedAttempt[],
  reviewedHead:string,repository:string) {
  assert.match(reviewedHead,/^[a-f0-9]{40}$/);const f=newTestOwnerGradingFixture(original)
  assert(Object.isFrozen(observed)&&observed.length===2)
  observed.forEach((row,i)=>{assert(Object.isFrozen(row));assert.deepEqual(Object.keys(row).sort(),['actorId','attemptId','revision'])
    assert.equal(row.actorId,f.actors[i+1].id);assert.match(row.attemptId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    assert(!f.allocatedIds.includes(row.attemptId));assert(Number.isSafeInteger(row.revision)&&row.revision>=1)})
  assert.notEqual(observed[0].attemptId,observed[1].attemptId)
  const sql=readFileSync(resolve(repository,'supabase/migrations',TEST_OWNER_GRADING_REVIEWED_MIGRATION.name),'utf8')
  const sourceSha256=hash(sql);validateTestOwnerGradingReviewedMigration({name:TEST_OWNER_GRADING_REVIEWED_MIGRATION.name,sql,sha256:sourceSha256})
  const inventory=loadAssignmentListReviewedMigrations(repository);assert.equal(inventory.length,258)
  validateTestOwnerGradingReviewedMigration(inventory[257])
  const migrations=inventory.map(({name,sha256})=>({name,sha256}));const migrationManifestSha256=hash(JSON.stringify(migrations))
  const projectId=`pika_assignment_list_${f.tag.slice(-12)}`,guard=testOwnerGuardSql(projectId)
  const prefix="begin read only;set local lock_timeout='3s';set local statement_timeout='30s';",terminal="end;$guard$;select 'ok';rollback;"
  const identity=`current_setting('application_name')<>${q(projectId+'_fixture')}`
  assert(guard.startsWith(prefix)&&guard.endsWith(terminal)&&guard.split(identity).length===2)
  const inherited=guard.slice(prefix.length,-terminal.length).replace(identity,`current_setting('application_name') not in (${q(projectId+'_draft_holder')},${q(projectId+'_draft_contender')},${q(projectId+'_draft_contracts')})`)
  const begin=`begin;set local lock_timeout='1s';set local statement_timeout='12s';set local idle_in_transaction_session_timeout='180s';${inherited}\nif current_database()<>'postgres' or current_user<>'postgres' or to_regprocedure('public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)') is null then raise exception 'Migration258 disposable source differs';end if;end;$guard$;`
  const tid=`${q(f.testId)}::uuid`,cid=`${q(f.classroomId)}::uuid`,owner=`${q(f.actors[0].id)}::uuid`,member=`${q(f.actors[1].id)}::uuid`
  const response=`${q(f.responses[0].id)}::uuid`,question=`${q(f.questions[0].id)}::uuid`
  const tables=[['public.users',`id in (${f.actors.map(a=>q(a.id)).join(',')})`],['public.classrooms',`id in (${q(f.classroomId)},${q(f.wrongClassroomId)})`],
    ['public.classroom_enrollments',`classroom_id=${cid}`],['public.managed_storage_settings','true'],
    ...['tests','test_questions','test_attempts','test_responses','test_student_availability','test_focus_events','test_ai_grading_runs','test_ai_grading_run_items']
      .map(table=>[`public.${table}`,`${table==='tests'?'id':'test_id'} in (${tid},${q(f.emptyTestId)}::uuid)`])]
  const graph=`pg_catalog.jsonb_build_object(${tables.map(([table,predicate])=>`${q(table)},(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text),'[]'::jsonb) from ${table} r where ${predicate})`).join(',')})`
  const snapshot=bounded(`begin read only;set local lock_timeout='1s';set local statement_timeout='8s';select ${graph} as result;rollback;`)
  const presence=`do $presence$ begin if not exists(select 1 from public.classrooms where id=${cid} and teacher_id=${owner} and archived_at is null)
    or not exists(select 1 from public.tests where id=${tid} and classroom_id=${cid} and created_by=${q(f.actors[3].id)} and status='active' and blueprint_archived_at is null and show_results=false)
    or ${f.actors.map(a=>`not exists(select 1 from public.users where id=${q(a.id)} and role=${q(a.role)} and email=${q(a.email)})`).join(' or ')}
    or ${observed.map(row=>`not exists(select 1 from public.test_attempts where id=${q(row.attemptId)} and test_id=${tid} and student_id=${q(row.actorId)} and is_submitted and returned_at is null)`).join(' or ')}
    or ${f.responses.map(r=>`not exists(select 1 from public.test_responses where id=${q(r.id)} and test_id=${tid} and student_id=${q(r.studentId)} and question_id=${q(r.questionId)} and revision=1)`).join(' or ')}
    or not exists(select 1 from public.test_questions where id=${question} and test_id=${tid} and question_type='open_response' and points=1 and btrim(answer_key)<>'')
    or not exists(select 1 from public.test_questions where id=${q(f.questions[1].id)} and test_id=${tid} and question_type='multiple_choice' and points=1 and correct_option=0)
    or (select count(*) from public.classroom_enrollments where classroom_id=${cid} and student_id in (${f.actors.slice(0,3).map(a=>q(a.id)).join(',')}))<>3
    or (select count(*) from public.test_student_availability where test_id=${tid} and student_id in (${f.actors.slice(1,3).map(a=>q(a.id)).join(',')}) and state='closed')<>2
    then raise exception 'Migration258 grading fixture presence differs';end if;end;$presence$;`
  const setup=bounded(`${guard}\nbegin read only;set local statement_timeout='8s';${presence}rollback;`)
  const template=readFileSync(resolve(repository,'scripts/check-contextual-test-owner-grading.sql'),'utf8')
  const marker='-- owner-grading-contracts-begin\n',end='-- owner-grading-contracts-end'
  assert(template.split(marker).length===2&&template.split(end).length===2)
  let body=template.split(marker)[1].split(end)[0]
  const replacement=new Map<string,string>([
    ...f.actors.map((a,i)=>[`a2580000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,a.id] as [string,string]),
    ['a2580000-0000-4000-8000-000000000010',f.classroomId],['a2580000-0000-4000-8000-000000000019',f.wrongClassroomId],['a2580000-0000-4000-8000-000000000011',f.testId],
    ...f.questions.map((r,i)=>[`a2580000-0000-4000-8000-${String(101+i).padStart(12,'0')}`,r.id] as [string,string]),
    ...f.responses.map((r,i)=>[`a2580000-0000-4000-8000-${String(301+i).padStart(12,'0')}`,r.id] as [string,string]),
    ['a2580000-0000-4000-8000-000000000401',f.runId],
    ['a2580000-0000-4000-8000-000000000012',f.emptyTestId],
    ...f.emptyAttemptIds.map((id,i)=>[`a2580000-0000-4000-8000-${String(211+i).padStart(12,'0')}`,id] as [string,string]),
  ])
  for(const [before,after]of replacement)body=body.replaceAll(before,after)
  assert(!body.includes('a2580000-'))
  const contracts=freeze({checks,sql:bounded(`${begin}\n${presence}\n${body}\nselect pg_catalog.jsonb_build_object('checks',${json(checks)}) as result;rollback;`)})
  const expected=`(select pg_catalog.to_jsonb(t) from public.tests t where id=${tid})`
  const grade=`pg_catalog.jsonb_build_object('student_id',${member},'grades',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('response_id',${response},'question_id',${question},'expected_response_revision',(select revision from public.test_responses where id=${response}),'clear_grade',false,'score',0,'feedback','Synthetic manual feedback')))`
  const clear=`pg_catalog.jsonb_build_object('student_ids',pg_catalog.jsonb_build_array(${member}),'responses',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('response_id',${response},'expected_response_revision',(select revision from public.test_responses where id=${response}))))`
  const selected=`pg_catalog.jsonb_build_object('student_ids',pg_catalog.jsonb_build_array(${member}))`
  const call=(operation:string,payload:string)=>`public.test_owner_workflow_v1(${owner},${tid},${cid},${q(operation)},${payload},${expected},pg_catalog.clock_timestamp()+interval '30 seconds')`
  const ai=`public.create_test_ai_grading_run_atomic(${tid},${owner},'synthetic-contract',array[${member}],array[${member}],'held-ai-source',1,0,0,pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('student_id',${member},'question_id',${question},'response_id',${response},'response_revision',(select revision from public.test_responses where id=${response}),'queue_position',0)),'[]'::jsonb,null)`
  const advisoryKey=`pg_catalog.hashtextextended(${q(f.testId)},0)`
  function schedule(label:string,holder:string,relation:string,rejectedCall:string,advisory:false|true|'classroom'=false,code='PT409') {
    const held=advisory?`exists(select 1 from pg_catalog.pg_locks l cross join lateral(select (${advisory==='classroom'?`pg_catalog.hashtextextended(${q('pika-classroom-operation:'+f.classroomId)},0)`:advisoryKey})::bigint value) k where l.pid=pg_catalog.pg_backend_pid() and l.granted and l.locktype='advisory' and l.classid::bigint=((k.value>>32)&4294967295) and l.objid::bigint=(k.value&4294967295) and l.objsubid=1)`
      :`exists(select 1 from pg_catalog.pg_locks where pid=pg_catalog.pg_backend_pid() and granted and locktype='relation' and relation=${q(relation)}::regclass and mode in('RowShareLock','RowExclusiveLock'))`
    return {label,relation,code,holderSql:bounded(`${begin}\n${holder}\nselect pg_catalog.jsonb_build_object('held',${held},'transaction',exists(select 1 from pg_catalog.pg_stat_activity where pid=pg_catalog.pg_backend_pid() and xact_start is not null),'scope',exists(select 1 from public.tests where id=${tid} and classroom_id=${cid}),'backend_pid',pg_catalog.pg_backend_pid(),'application_name',current_setting('application_name'),'label',${q(label)},'relation',${q(relation)}) as result;`),
      rejectSql:bounded(`${begin}\ndo $reject$ declare baseline jsonb;code text;succeeded boolean:=false;begin baseline:=${graph};begin perform ${rejectedCall};succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;if succeeded or code is distinct from ${q(code)} then raise exception 'Owner grading contention code differs';end if;if ${graph} is distinct from baseline then raise exception 'Rejected owner grading changed rows';end if;end;$reject$;select pg_catalog.jsonb_build_object('rejected',true,'code',${q(code)},'rows_unchanged',true,'label',${q(label)}) as result;`)}
  }
  const locked=(table:string,predicate:string)=>`do $hold$ declare n integer;begin perform 1 from ${table} where ${predicate} for update nowait;get diagnostics n=row_count;if n<>1 then raise exception 'Exact owner grade holder scope differs';end if;end;$hold$;`
  const concurrency=freeze({schedules:[
    schedule('test-advisory',`select pg_catalog.pg_advisory_xact_lock(${advisoryKey});`,'public.tests',call('manual-save',grade),true),
    schedule('owner-transfer',locked('public.classrooms',`id=${cid}`),'public.classrooms',call('return',selected)),
    schedule('parent-transfer',locked('public.tests',`id=${tid}`),'public.tests',call('manual-save',grade)),
    schedule('membership',locked('public.classroom_enrollments',`id=${q(f.enrollments[1].id)} and classroom_id=${cid}`),'public.classroom_enrollments',call('clear-open-grades',clear)),
    schedule('archive',locked('public.classrooms',`id=${cid}`),'public.classrooms',call('clear-open-grades',clear)),
    schedule('protocol',locked('public.managed_storage_settings','singleton'),'public.managed_storage_settings',call('return',selected)),
    schedule('purge',`select public.classroom_purge_lock(${cid});`,'public.classrooms',call('return',selected),'classroom'),
    schedule('membership-fence',`select private.try_lock_classroom_membership_change(${cid});`,'public.classroom_enrollments',call('return',selected),'classroom'),
    // The untouched inherited creator blocks on the advisory key and reports
    // native55P03 under the one-second lock timeout; contextual mutations use PT409.
    schedule('manual-before-ai-create',`do $write$ begin perform ${call('manual-save',grade)};end;$write$;`,'public.test_responses',ai,true,'55P03'),
    schedule('ai-create-before-manual',`do $write$ begin perform ${ai};end;$write$;`,'public.test_ai_grading_runs',call('manual-save',grade),true),
    schedule('return-before-clear',`do $write$ begin perform ${call('return',selected)};end;$write$;`,'public.test_attempts',call('clear-open-grades',clear),true),
    schedule('clear-before-return',`do $write$ begin perform ${call('clear-open-grades',clear)};end;$write$;`,'public.test_responses',call('return',selected),true),
  ]})
  const preparation=bounded(`${guard}\nbegin;set local lock_timeout='1s';set local statement_timeout='12s';
    do $exact$ declare n integer;begin
    if exists(select 1 from public.test_responses where id in (${f.responses.map(r=>q(r.id)).join(',')}) or test_id=${tid}) then raise exception 'Owner grading response collision';end if;
    ${observed.map(row=>`update public.test_attempts set is_submitted=true,submitted_at=clock_timestamp() where id=${q(row.attemptId)} and test_id=${tid} and student_id=${q(row.actorId)} and not is_submitted and draft_revision=${row.revision};get diagnostics n=row_count;if n<>1 then raise exception 'Observed Start binding differs';end if;`).join('\n')}
    end;$exact$;
    insert into public.test_responses(id,test_id,question_id,student_id,response_text,selected_option,score,graded_at) values ${f.responses.map(r=>`(${q(r.id)},${tid},${q(r.questionId)},${q(r.studentId)},${r.question===0?"'Synthetic grading answer'":'null'},${r.question===0?'null':'0'},${r.question===0?'null':'1'},${r.question===0?'null':'clock_timestamp()'})`).join(',')};
    insert into public.test_student_availability(test_id,student_id,state,updated_by) values ${f.actors.slice(1,3).map(a=>`(${tid},${q(a.id)},'closed',${owner})`).join(',')};
    update public.tests set questions_locked_at=coalesce(questions_locked_at,clock_timestamp()),show_results=false where id=${tid} and classroom_id=${cid};commit;`)
  const plan=freeze({version:1,reviewedHead,projectId,fixture:f,observedAttempts:observed,migrations,migrationManifestSha256,sourceSha256,
    guard,setup,snapshot,preparation,contracts,concurrency,caps,nativeVerified:false as const,
    limitations:['The source candidate seal grants no native execution authority or independent review acceptance.',
      'Held rollback schedules are not committed cross-session freshness proof. SDK/PostgREST abort evidence is separate.']})
  plans.set(plan.contracts,plan);return plan
}
export type TestOwnerGradingNativePlan=ReturnType<typeof testOwnerGradingNativePlan>
function sourcePlan(m:TestOwnerGradingNativePlan){const p=plans.get(m.contracts);return p!==undefined&&Object.isFrozen(m)&&Object.keys(p).every(key=>m[key as keyof typeof m]===p[key as keyof typeof p])}
export function validateTestOwnerGradingNativePlanSql(m:TestOwnerGradingNativePlan,sql:string){return sourcePlan(m)&&Buffer.byteLength(sql)<=caps.sqlBytes&&[m.setup,m.snapshot,m.contracts.sql,...m.concurrency.schedules.flatMap(s=>[s.holderSql,s.rejectSql])].includes(sql)}
function target(m:TestOwnerGradingNativePlan,t:DraftSaveTarget,phase:'contracts'|'concurrency') {
  assert(sourcePlan(m));assert.equal(m.sourceSha256,TEST_OWNER_GRADING_REVIEWED_MIGRATION.sha256);assert(Object.isFrozen(t))
  assert.equal(t.projectId,m.projectId);assert.equal(t.containerProjectLabel,m.projectId);assert.equal(t.disposable,true)
  assert.equal(t.apiUrl,'http://127.0.0.1:54331');assert.equal(t.databaseHost,'127.0.0.1');assert.equal(t.databasePort,54332)
  assert.match(t.containerId,/^[a-f0-9]{64}$/);assert.equal(t.reviewedHead,m.reviewedHead);assert.equal(t.reviewedSourceSha256,m.sourceSha256)
  assert.equal(t.migrationManifestSha256,m.migrationManifestSha256);assert.equal(t.acceptedManifestSha256,hash(JSON.stringify(m[phase])))
}
function runner(m:TestOwnerGradingNativePlan,t:DraftSaveTarget,d:DraftSaveDriver){const started=Date.now();let dispatches=0
  const remaining=()=>{const n=caps.totalMs-(Date.now()-started);assert(n>0);return n}
  const verify=async()=>{remaining();assert.deepEqual(await d.verifyTarget(),t);remaining()}
  return {verify,async execute(s:DraftSaveSession,sql:string){assert(validateTestOwnerGradingNativePlanSql(m,sql));assert(++dispatches<=caps.dispatches);await verify()
    const rows=await s.execute(sql,Math.min(caps.requestMs,remaining()));remaining();assert(Buffer.byteLength(JSON.stringify(rows))<=caps.responseBytes)
    assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]),['result']);return rows[0].result}}
}
export async function runTestOwnerGradingNativeContracts(m:TestOwnerGradingNativePlan,t:DraftSaveTarget,d:DraftSaveDriver){target(m,t,'contracts');const r=runner(m,t,d);await r.verify();const name=`${m.projectId}_draft_contracts`,s=await d.openSession(name)
  try{assert.equal(s.name,name);assert.deepEqual(await r.execute(s,m.contracts.sql),{checks:m.contracts.checks});return freeze({checks:m.contracts.checks,nativeVerified:false as const})}finally{await s.rollbackAndClose(caps.closeMs)}}
export async function runTestOwnerGradingNativeRaces(m:TestOwnerGradingNativePlan,t:DraftSaveTarget,d:DraftSaveDriver){target(m,t,'concurrency');const r=runner(m,t,d),outcomes:string[]=[]
  for(const schedule of m.concurrency.schedules){let holder:DraftSaveSession|undefined,contender:DraftSaveSession|undefined
    try{await r.verify();const holderName=`${m.projectId}_draft_holder`,contenderName=`${m.projectId}_draft_contender`;holder=await d.openSession(holderName);contender=await d.openSession(contenderName)
      assert.equal(holder.name,holderName);assert.equal(contender.name,contenderName);const raw=await r.execute(holder,schedule.holderSql)
      assert(raw&&typeof raw==='object'&&!Array.isArray(raw));const row=raw as Record<string,unknown>;assert.deepEqual(Object.keys(row).sort(),['application_name','backend_pid','held','label','relation','scope','transaction'])
      assert.equal(row.held,true);assert.equal(row.transaction,true);assert.equal(row.scope,true);assert(Number.isSafeInteger(row.backend_pid)&&Number(row.backend_pid)>0)
      assert.equal(row.application_name,holderName);assert.equal(row.label,schedule.label);assert.equal(row.relation,schedule.relation)
      assert.deepEqual(await r.execute(contender,schedule.rejectSql),{rejected:true,code:schedule.code,rows_unchanged:true,label:schedule.label});outcomes.push(schedule.label)
    }finally{const closes=await Promise.allSettled([...(contender?[contender.rollbackAndClose(caps.closeMs)]:[]),...(holder?[holder.rollbackAndClose(caps.closeMs)]:[])]);const bad=closes.find(row=>row.status==='rejected');if(bad?.status==='rejected')throw bad.reason}}
  return freeze({outcomes,nativeVerified:false as const})}
