/** Inert migration252 two-session manifests. No connection, SQL, process or
 * filesystem mutation occurs on import. Only exact source-sealed statements may
 * be dispatched by the caller-owned verified disposable native driver. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { testOwnerPublicationSnapshotSql, verifyTestOwnerPublicationTransitionEffects,
  type TestOwnerPublicationFixture, type TestOwnerPublicationSnapshot,
  type TestOwnerPublicationTransitionEvidence, type TestOwnerPublicationWitness } from './contextual-test-publication-proof-fixture'
import { TEST_OWNER_PUBLICATION_SOURCE_SHA256 } from './contextual-test-publication-db-contracts'
import { draftSaveMigrationManifestSha256, type DraftSaveDriver, type DraftSaveSession,
  type DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'

export const TEST_OWNER_PUBLICATION_CONCURRENCY_CAPS = Object.freeze({ totalMs: 180_000, dispatches: 180,
  requestMs: 12_000, closeMs: 12_000, sessions: 2, rollbackSchedules: 12, committedTransitions: 5,
  sqlBytes: 256 * 1024, responseBytes: 8 * 1024 * 1024 })
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_PUBLICATION_CONCURRENCY_CAPS.sqlBytes); return sql }
function project(f: TestOwnerPublicationFixture) { return `pika_assignment_list_${f.tag.slice(-12)}` }
function validateFixture(f: TestOwnerPublicationFixture) {
  assert(Object.isFrozen(f)); assert.equal(f.version, 1); assert.match(f.tag, /^testownerpublication_[a-f0-9]{12}$/)
  assert.equal(f.tests.length, 16); assert.equal(f.drafts.length, 15); assert.equal(f.questions.length, 1019)
  assert.equal(f.transitions.length, 5); assert.equal(new Set(f.allocatedIds).size, f.allocatedIds.length)
}
function validateTarget(target: DraftSaveTarget, f: TestOwnerPublicationFixture, repository: string) {
  validateFixture(f); assert(Object.isFrozen(target)); assert.equal(target.projectId, project(f)); assert.equal(target.containerProjectLabel, project(f))
  assert.equal(target.disposable, true); assert.equal(target.apiUrl, 'http://127.0.0.1:54331'); assert.equal(target.databaseHost, '127.0.0.1')
  assert.equal(target.databasePort, 54332); assert.match(target.containerId, /^[a-f0-9]{64}$/); assert.match(target.reviewedHead, /^[a-f0-9]{40}$/)
  assert.equal(target.migrationManifestSha256, draftSaveMigrationManifestSha256(repository))
  assert.equal(hash(readFileSync(resolve(repository,'supabase/migrations/252_contextual_test_owner_publication.sql'),'utf8')), TEST_OWNER_PUBLICATION_SOURCE_SHA256)
  assert.equal(target.reviewedSourceSha256, TEST_OWNER_PUBLICATION_SOURCE_SHA256); assert.match(target.acceptedManifestSha256, /^[a-f0-9]{64}$/)
}
function guard(f: TestOwnerPublicationFixture) {
  return `do $guard$ begin if current_setting('application_name') not in (${q(project(f)+'_draft_holder')},${q(project(f)+'_draft_contender')}) or current_database()<>'postgres' or current_user<>'postgres' or to_regprocedure('public.publish_test_from_draft_for_owner_v1(uuid,uuid,uuid,text,integer,jsonb,timestamp with time zone)') is null then raise exception 'Migration252 contention target differs';end if;end;$guard$;`
}
function begin(f: TestOwnerPublicationFixture) { return bounded(`begin;set local lock_timeout='1s';set local statement_timeout='12s';${guard(f)}`) }
function publish(actorId: string, testId: string, classroomId: string, content: unknown, version: number) {
  // Every sealed holder is reached before migration252 recomputes authoring
  // source. A valid deliberately stale digest avoids a second snapshot/lock
  // path and cannot authorize a write if the intended holder were absent.
  return `public.publish_test_from_draft_for_owner_v1(${q(actorId)}::uuid,${q(testId)}::uuid,${q(classroomId)}::uuid,${q('0'.repeat(64))},${version},${q(JSON.stringify(content))}::jsonb,pg_catalog.clock_timestamp()+interval '8 seconds')`
}
function graph(testId: string, classroomId: string) {
  const scoped = (table: string, predicate: string) => `${q(table)},(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text),'[]'::jsonb) from ${table} r where ${predicate})`
  const tid=`${q(testId)}::uuid`; const cid=`${q(classroomId)}::uuid`
  return `pg_catalog.jsonb_build_object(${[
    scoped('public.classrooms',`id=${cid}`),scoped('public.classroom_archive_revisions',`classroom_id=${cid}`),scoped('public.tests',`id=${tid}`),
    scoped('public.assessment_drafts',`assessment_type='test' and assessment_id=${tid}`),scoped('public.test_questions',`test_id=${tid}`),
    scoped('public.test_attempts',`test_id=${tid}`),scoped('public.test_responses',`test_id=${tid}`),scoped('public.test_focus_events',`test_id=${tid}`),
    scoped('public.test_student_availability',`test_id=${tid}`),scoped('public.test_ai_grading_runs',`test_id=${tid}`),scoped('public.test_ai_grading_run_items',`test_id=${tid}`),
    scoped('public.gradebook_score_overrides',`assessment_type='test' and assessment_id=${tid}`),scoped('public.classroom_guided_draft_provenance',`test_id=${tid}`),
    scoped('public.managed_storage_json_references',`test_id=${tid}`),scoped('public.managed_storage_objects',`resource_type='test' and resource_id=${tid}`),
    `${q('settings')},(select pg_catalog.to_jsonb(s) from public.managed_storage_settings s where singleton)`,
  ].join(',')})`
}
type RollbackSchedule = Readonly<{ label: string; holderSql: string; rejectSql: string }>
function exactOne(sql: string) { return `do $hold$ declare n integer;begin ${sql};get diagnostics n=row_count;if n<>1 then raise exception 'Exact publication holder scope differs';end if;end;$hold$;` }
function observer(f: TestOwnerPublicationFixture, label: string, relation: string, lockKey: string, scope: string, advisoryKey?: string) {
  const held=advisoryKey?`exists(select 1 from pg_catalog.pg_locks l cross join lateral(select (${advisoryKey})::bigint k) key where l.pid=pg_catalog.pg_backend_pid() and l.granted and l.locktype='advisory' and l.classid::bigint=((key.k>>32)&4294967295) and l.objid::bigint=(key.k&4294967295) and l.objsubid=1)`:`exists(select 1 from pg_catalog.pg_locks l where l.pid=pg_catalog.pg_backend_pid() and l.granted and l.locktype='relation' and l.relation=${q(relation)}::regclass and l.mode in ('RowShareLock','RowExclusiveLock'))`
  return `select pg_catalog.jsonb_build_object('held',${held},'transaction',exists(select 1 from pg_catalog.pg_stat_activity a where a.pid=pg_catalog.pg_backend_pid() and a.xact_start is not null and a.application_name=${q(project(f)+'_draft_holder')}),'backend_pid',pg_catalog.pg_backend_pid(),'application_name',current_setting('application_name'),'relation',${q(relation)},'lock_key',${q(lockKey)},'scope',(${scope}),'label',${q(label)}) as result;`
}
function reject(f: TestOwnerPublicationFixture, label: string, actor: string, testId: string, classroomId: string, content: unknown, version: number) {
  const g=graph(testId,classroomId)
  return bounded(`${begin(f)}do $reject$ declare baseline jsonb;code text;succeeded boolean:=false;begin baseline:=${g};begin perform ${publish(actor,testId,classroomId,content,version)};succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;if succeeded or code is distinct from 'PT409' then raise exception 'Publication contention code differs';end if;if ${g} is distinct from baseline then raise exception 'Rejected publication changed rows';end if;end;$reject$;select pg_catalog.jsonb_build_object('rejected',true,'code','PT409','rows_unchanged',true,'label',${q(label)}) as result;`)
}

export function testOwnerPublicationConcurrencyManifest(f: TestOwnerPublicationFixture) {
  validateFixture(f)
  const c=f.cases[0]; const t=f.tests.find(row=>row.id===c.testId)!; const d=f.drafts.find(row=>row.assessment_id===c.testId)!; const question=f.questions.find(row=>row.test_id===c.testId)!
  const tid=`${q(t.id)}::uuid`; const cid=`${q(t.classroom_id)}::uuid`; const actor=`${q(c.actorId)}::uuid`; const did=`${q(d.id)}::uuid`; const qid=`${q(question.id)}::uuid`
  const testAdvisory=`pg_catalog.hashtextextended(${tid}::text,0)`;const classAdvisory=`pg_catalog.hashtextextended('pika-classroom-operation:'||${cid}::text,0)`
  const make=(label:string,lockSql:string,relation:string,key:string,scope:string,advisoryKey?:string):RollbackSchedule=>freeze({label,
    holderSql:bounded(`${begin(f)}${lockSql}${observer(f,label,relation,key,scope,advisoryKey)}`),rejectSql:reject(f,label,c.actorId,t.id,t.classroom_id,d.content,d.version)})
  const schedules:RollbackSchedule[]=[
    make('actor-row',exactOne(`perform id from public.users where id=${actor} for update nowait`),'public.users',c.actorId,`exists(select 1 from public.users where id=${actor})`),
    make('classroom-row',exactOne(`perform id from public.classrooms where id=${cid} for update nowait`),'public.classrooms',t.classroom_id,`exists(select 1 from public.classrooms where id=${cid})`),
    make('test-row',exactOne(`perform id from public.tests where id=${tid} for update nowait`),'public.tests',t.id,`exists(select 1 from public.tests where id=${tid})`),
    make('draft-row',exactOne(`perform id from public.assessment_drafts where id=${did} and assessment_id=${tid} for update nowait`),'public.assessment_drafts',d.id,`exists(select 1 from public.assessment_drafts where id=${did})`),
    make('question-row',exactOne(`perform id from public.test_questions where id=${qid} and test_id=${tid} for update nowait`),'public.test_questions',question.id,`exists(select 1 from public.test_questions where id=${qid})`),
    make('archive-revision-row',exactOne(`perform classroom_id from public.classroom_archive_revisions where classroom_id=${cid} for update nowait`),'public.classroom_archive_revisions',t.classroom_id,`exists(select 1 from public.classroom_archive_revisions where classroom_id=${cid})`),
    make('managed-settings-row',exactOne(`perform singleton from public.managed_storage_settings where singleton for update nowait`),'public.managed_storage_settings','singleton',`exists(select 1 from public.managed_storage_settings where singleton)`),
    make('test-advisory',`do $hold$ begin if not pg_catalog.pg_try_advisory_xact_lock(${testAdvisory}) then raise exception 'Test advisory holder differs';end if;end;$hold$;`,'public.tests',t.id,`exists(select 1 from public.tests where id=${tid})`,testAdvisory),
    make('class-operation-advisory',`do $hold$ begin if not public.classroom_purge_try_lock(${cid}) then raise exception 'Class operation holder differs';end if;end;$hold$;`,'public.classrooms',t.classroom_id,`exists(select 1 from public.classrooms where id=${cid})`,classAdvisory),
    make('membership-operation-advisory',`do $hold$ begin perform private.try_lock_classroom_membership_change(${cid});end;$hold$;`,'public.classrooms',`${t.classroom_id}:membership`, `exists(select 1 from public.classrooms where id=${cid})`,classAdvisory),
    make('legacy-publication',`do $hold$ begin perform public.publish_test_from_draft_atomic(${actor},${tid},${d.version});end;$hold$;`,'public.tests',t.id,`exists(select 1 from public.tests where id=${tid} and status='closed')`),
    make('raw-question-writer',exactOne(`update public.test_questions set question_text=${q(f.transitions[1].authoredText)} where id=${qid} and test_id=${tid}`),'public.test_questions',question.id,`exists(select 1 from public.test_questions where id=${qid} and question_text=${q(f.transitions[1].authoredText)})`),
  ]
  assert.equal(schedules.length,TEST_OWNER_PUBLICATION_CONCURRENCY_CAPS.rollbackSchedules)
  return freeze({version:1 as const,fixture:f,sourceFile:'252_contextual_test_owner_publication.sql' as const,sourceSha256:TEST_OWNER_PUBLICATION_SOURCE_SHA256,
    caps:TEST_OWNER_PUBLICATION_CONCURRENCY_CAPS,begin:begin(f),rollback:'rollback;' as const,schedules,
    reservedIds:freeze({...f.reservedIds}),limitations:freeze(['Malformed wrong-Class no-FK score override insertion is not claimed fenced.','All schedules are rollback-only source until independently executed.'])})
}
export type TestOwnerPublicationConcurrencyManifest=ReturnType<typeof testOwnerPublicationConcurrencyManifest>
export function validateTestOwnerPublicationConcurrencySql(m:TestOwnerPublicationConcurrencyManifest,sql:string){return Buffer.byteLength(sql)<=m.caps.sqlBytes&&[m.begin,m.rollback,...m.schedules.flatMap(s=>[s.holderSql,s.rejectSql])].includes(sql)}

function snapshotSql(f:TestOwnerPublicationFixture) {
  const original=testOwnerPublicationSnapshotSql(f)
  assert(original.endsWith(';rollback;'));return bounded(original.slice(0,-';rollback;'.length)+' as result;rollback;')
}
function cacheSql(f:TestOwnerPublicationFixture,t:TestOwnerPublicationFixture['transitions'][number]) {
  return bounded(`${begin(f)}create temp table if not exists owner_publication_transition_source(label text primary key,source jsonb not null) on commit preserve rows;delete from owner_publication_transition_source;insert into owner_publication_transition_source values(${q(t.label)},public.snapshot_test_draft_for_owner_v1(${q(t.actorId)}::uuid,${q(t.testId)}::uuid,pg_catalog.clock_timestamp()+interval '8 seconds'));commit;select pg_catalog.jsonb_build_object('cached',true,'label',${q(t.label)},'source_sha256',(select source->>'source_sha256' from owner_publication_transition_source where label=${q(t.label)})) as result;`)
}
function committedWriter(f:TestOwnerPublicationFixture,t:TestOwnerPublicationFixture['transitions'][number]) {
  const test=`${q(t.testId)}::uuid`,question=`${q(t.questionId)}::uuid`,classroom=`${q(t.classroomId)}::uuid`
  let body:string
  if(t.label==='stale-draft')body=`update public.assessment_drafts set content=content||pg_catalog.jsonb_build_object('title',${q(t.authoredTitle)}),version=version+1 where assessment_type='test' and assessment_id=${test};`
  else if(t.label==='stale-authoring')body=`update public.test_questions set question_text=${q(t.authoredText)} where id=${question} and test_id=${test};`
  else if(t.label==='metadata-preserved')body=`update public.tests set documents=${q(JSON.stringify(t.documents))}::jsonb where id=${test};update public.test_questions set ai_reference_cache_key=${q(t.cacheKey)},ai_reference_cache_answers=${q(JSON.stringify(t.cacheAnswers))}::jsonb,ai_reference_cache_model=${q(t.cacheModel)},ai_reference_cache_generated_at=pg_catalog.transaction_timestamp() where id=${question} and test_id=${test};`
  else if(t.label==='owner-transfer')body=`update public.classrooms set teacher_id=${q(t.nextOwnerId)}::uuid where id=${classroom} and teacher_id=${q(t.actorId)}::uuid;`
  else body=`do $start$ declare code text;succeeded boolean:=false;begin begin perform public.start_test_attempt_revision_atomic(${test},${q(f.actors[2].id)}::uuid);succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;if succeeded or code is distinct from '42501' then raise exception 'Draft Start denial differs';end if;if exists(select 1 from public.test_attempts where test_id=${test} and student_id=${q(f.actors[2].id)}::uuid) then raise exception 'Draft Start wrote attempt';end if;end;$start$;`
  return bounded(`${begin(f)}${body}select pg_catalog.jsonb_build_object('phase','writerCommit','label',${q(t.label)},'writerTimestamp',${t.label==='publication-start'?'null':'pg_catalog.transaction_timestamp()'},'code',${t.label==='publication-start'?q('draft-start-denied'):'null'}) as result;commit;`)
}
function finalSql(f:TestOwnerPublicationFixture,t:TestOwnerPublicationFixture['transitions'][number],leaveOpen=false) {
  const d=f.drafts.find(row=>row.assessment_id===t.testId)!;const success=t.expectedHTTP===200
  return bounded(`${begin(f)}do $final$ declare s jsonb;r jsonb;code text;begin select source into strict s from owner_publication_transition_source where label=${q(t.label)};
 begin r:=public.publish_test_from_draft_for_owner_v1(${q(t.actorId)}::uuid,${q(t.testId)}::uuid,${q(t.classroomId)}::uuid,s->>'source_sha256',(s->'draft'->>'version')::integer,s->'draft'->'content',pg_catalog.clock_timestamp()+interval '8 seconds');${success?"if r->'test'->>'status'<>'closed' then raise exception 'Committed publication result differs';end if;":"raise exception 'Stale committed publication succeeded';"}
 exception when others then get stacked diagnostics code=returned_sqlstate;${success?'raise;':`if code<>${q(t.expectedHTTP===403?'PT403':'PT409')} then raise exception 'Committed publication denial differs';end if;`}end;
 create temp table if not exists owner_publication_transition_result(value jsonb not null) on commit preserve rows;delete from owner_publication_transition_result;
 insert into owner_publication_transition_result values(pg_catalog.jsonb_build_object('phase','after','label',${q(t.label)},'source_sha256',s->>'source_sha256','envelope',${success?'r':'null'},'code',${success?'null':'code'},'publicationTimestamp',${success?"r->'test'->>'updated_at'":'null'}));end;$final$;
select value as result from owner_publication_transition_result;${leaveOpen?'':'commit;'}`)
}
function fullSnapshot(value:unknown):TestOwnerPublicationSnapshot { assert(value&&typeof value==='object'&&!Array.isArray(value));return value as TestOwnerPublicationSnapshot }
type CommittedSchedule=Readonly<{label:TestOwnerPublicationFixture['transitions'][number]['label'];beforeSql:string;cacheSql:string;writerSql:string;writerCommitSql:string;finalSql:string;afterSql:string;duringSql?:string;commitSql?:string;postStartSql?:string}>
export function testOwnerPublicationCommittedManifest(f:TestOwnerPublicationFixture){validateFixture(f);const snap=snapshotSql(f)
  const schedules:CommittedSchedule[]=f.transitions.map(t=>freeze({label:t.label,beforeSql:snap,cacheSql:cacheSql(f,t),writerSql:committedWriter(f,t),writerCommitSql:snap,
    finalSql:finalSql(f,t,t.label==='publication-start'),afterSql:snap,...(t.label==='publication-start'?{
      duringSql:bounded(`${begin(f)}do $during$ declare code text;succeeded boolean:=false;begin begin perform public.start_test_attempt_revision_atomic(${q(t.testId)}::uuid,${q(f.actors[2].id)}::uuid);succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;if succeeded or code is distinct from '55P03' then raise exception 'Concurrent Start lock denial differs';end if;if exists(select 1 from public.test_attempts where test_id=${q(t.testId)}::uuid and student_id=${q(f.actors[2].id)}::uuid) then raise exception 'Concurrent Start wrote attempt';end if;end;$during$;select pg_catalog.jsonb_build_object('during',true,'attempt',false,'code','55P03') as result;rollback;`),
      commitSql:bounded(`commit;select pg_catalog.jsonb_build_object('committed',true,'label',${q(t.label)}) as result;`),
      postStartSql:bounded(`begin;set local statement_timeout='12s';do $post$ declare code text;succeeded boolean:=false;begin begin perform public.start_test_attempt_revision_atomic(${q(t.testId)}::uuid,${q(f.actors[2].id)}::uuid);succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;if succeeded or code is distinct from '42501' then raise exception 'Closed Start denial differs';end if;if exists(select 1 from public.test_attempts where test_id=${q(t.testId)}::uuid and student_id=${q(f.actors[2].id)}::uuid) then raise exception 'Closed Start wrote attempt';end if;end;$post$;select pg_catalog.jsonb_build_object('denied',true,'attempt',false,'code','42501') as result;rollback;`) }: {})}))
  return freeze({version:1 as const,fixture:f,sourceFile:'252_contextual_test_owner_publication.sql' as const,sourceSha256:TEST_OWNER_PUBLICATION_SOURCE_SHA256,
    caps:TEST_OWNER_PUBLICATION_CONCURRENCY_CAPS,schedules,reservedIds:freeze({...f.reservedIds}),limitations:freeze(['Malformed wrong-Class no-FK score override concurrent insertion remains outside the closed schedules.','Committed transitions are destructive only inside the independently disposable fixture project and are never compensated.'])})}
export type TestOwnerPublicationCommittedManifest=ReturnType<typeof testOwnerPublicationCommittedManifest>
export function validateTestOwnerPublicationCommittedSql(m:TestOwnerPublicationCommittedManifest,sql:string){return Buffer.byteLength(sql)<=m.caps.sqlBytes&&m.schedules.flatMap(s=>[s.beforeSql,s.cacheSql,s.writerSql,s.writerCommitSql,s.finalSql,s.afterSql,...(s.duringSql?[s.duringSql]:[]),...(s.commitSql?[s.commitSql]:[]),...(s.postStartSql?[s.postStartSql]:[])]).includes(sql)}

async function settle(sessions:(DraftSaveSession|undefined)[],timeout:number,primary?:unknown){const settled=await Promise.allSettled(sessions.filter((s):s is DraftSaveSession=>Boolean(s)).map(s=>s.rollbackAndClose(timeout)));const errors=settled.flatMap(r=>r.status==='rejected'?[r.reason]:[]);if(errors.length)throw new AggregateError([...(primary?[primary]:[]),...errors],'Exact publication session cleanup failed')}
function one(rows:readonly {result?:unknown}[]){assert.equal(rows.length,1);assert('result'in rows[0]);return rows[0].result}

export async function runTestOwnerPublicationConcurrency(f:TestOwnerPublicationFixture,target:DraftSaveTarget,repository:string,driver:DraftSaveDriver){const started=Date.now();validateTarget(target,f,repository);const m=testOwnerPublicationConcurrencyManifest(f);const manifestSha256=hash(JSON.stringify(m));assert.equal(target.acceptedManifestSha256,manifestSha256);let dispatches=0
  const budget=()=>{const left=m.caps.totalMs-(Date.now()-started);assert(left>0,'Publication contention deadline exhausted');return left}
  const verify=async()=>{budget();assert.deepEqual(await driver.verifyTarget(),target);budget()};const run=async(s:DraftSaveSession,sql:string)=>{assert(validateTestOwnerPublicationConcurrencySql(m,sql));assert(++dispatches<=m.caps.dispatches);await verify();const rows=await s.execute(sql,Math.min(m.caps.requestMs,budget()));assert(Buffer.byteLength(JSON.stringify(rows))<=m.caps.responseBytes);return rows}
  const outcomes:string[]=[];for(const schedule of m.schedules){let holder:DraftSaveSession|undefined,contender:DraftSaveSession|undefined,primary:unknown
    try{await verify();holder=await driver.openSession(`${project(f)}_draft_holder`);contender=await driver.openSession(`${project(f)}_draft_contender`);assert.equal(holder.name,`${project(f)}_draft_holder`);assert.equal(contender.name,`${project(f)}_draft_contender`);const observed=one(await run(holder,schedule.holderSql)) as Record<string,unknown>;assert.equal(observed.held,true);assert.equal(observed.transaction,true);assert.equal(observed.scope,true);assert.equal(observed.label,schedule.label);assert.equal(observed.application_name,`${project(f)}_draft_holder`);const rejected=one(await run(contender,schedule.rejectSql));assert.deepEqual(rejected,{rejected:true,code:'PT409',rows_unchanged:true,label:schedule.label});outcomes.push(schedule.label)}catch(error){primary=error}finally{await settle([holder,contender],m.caps.closeMs,primary)}if(primary)throw primary}
  return freeze({kind:'rollback-publication-contention' as const,schedules:outcomes,dispatches,elapsedMs:Date.now()-started,sourceSha256:target.reviewedSourceSha256,manifestSha256})}

export async function runTestOwnerPublicationCommittedTransitions(f:TestOwnerPublicationFixture,target:DraftSaveTarget,repository:string,driver:DraftSaveDriver){const started=Date.now();validateTarget(target,f,repository);const m=testOwnerPublicationCommittedManifest(f);const manifestSha256=hash(JSON.stringify(m));assert.equal(target.acceptedManifestSha256,manifestSha256);let dispatches=0;let issuedLedger:TestOwnerPublicationWitness[]=[],holder:DraftSaveSession|undefined,contender:DraftSaveSession|undefined
  const budget=()=>{const left=m.caps.totalMs-(Date.now()-started);assert(left>0,'Committed publication deadline exhausted');return left};const verify=async()=>{budget();assert.deepEqual(await driver.verifyTarget(),target);budget()};const run=async(s:DraftSaveSession,sql:string)=>{assert(validateTestOwnerPublicationCommittedSql(m,sql));assert(++dispatches<=m.caps.dispatches);await verify();const rows=await s.execute(sql,Math.min(m.caps.requestMs,budget()));assert(Buffer.byteLength(JSON.stringify(rows))<=m.caps.responseBytes);return one(rows)}
  const receipts:Array<{label:string;before:TestOwnerPublicationSnapshot;writerCommit:TestOwnerPublicationSnapshot;after:TestOwnerPublicationSnapshot;evidence:TestOwnerPublicationTransitionEvidence}>=[]
  try{await verify();holder=await driver.openSession(`${project(f)}_draft_holder`);contender=await driver.openSession(`${project(f)}_draft_contender`)
    for(const schedule of m.schedules){const before=fullSnapshot(await run(holder,schedule.beforeSql));const cached=await run(holder,schedule.cacheSql) as {source_sha256:string};assert.match(cached.source_sha256,/^[a-f0-9]{64}$/);const writer=await run(contender,schedule.writerSql) as {writerTimestamp?:string};const writerCommit=fullSnapshot(await run(contender,schedule.writerCommitSql));const final=await run(holder,schedule.finalSql) as {source_sha256:string;envelope?:unknown;code?:'PT409'|'PT403';publicationTimestamp?:string}
      if(schedule.duringSql){const during=await run(contender,schedule.duringSql) as {during:boolean;attempt:boolean;code:string};assert.deepEqual(during,{during:true,attempt:false,code:'55P03'});assert(schedule.commitSql&&schedule.postStartSql);await run(holder,schedule.commitSql);const post=await run(contender,schedule.postStartSql);assert.deepEqual(post,{denied:true,attempt:false,code:'42501'})}
      const after=fullSnapshot(await run(holder,schedule.afterSql));const evidence:TestOwnerPublicationTransitionEvidence=freeze({...(writer.writerTimestamp?{writerTimestamp:writer.writerTimestamp}:{}),...(final.publicationTimestamp?{publicationTimestamp:final.publicationTimestamp}:{}),sourceSha256:final.source_sha256,...(final.envelope?{envelope:final.envelope}:{}),...(final.code?{code:final.code}:{})});issuedLedger=verifyTestOwnerPublicationTransitionEffects(f,before,writerCommit,after,schedule.label,issuedLedger,evidence) as TestOwnerPublicationWitness[];receipts.push(freeze({label:schedule.label,before,writerCommit,after,evidence}))}
  }catch(error){await settle([holder,contender],m.caps.closeMs,error);throw error}await settle([holder,contender],m.caps.closeMs)
  return freeze({kind:'committed-transitions' as const,schedules:m.schedules.length,receipts,dispatches,elapsedMs:Date.now()-started,sourceSha256:target.reviewedSourceSha256,manifestSha256})}
