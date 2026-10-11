/** Inert finite261 rollback frames. Mock receipts never establish native acceptance. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { loadAssignmentListReviewedMigrations } from './contextual-assignment-list-proof-platform'
import { validateAssignmentListMigrationChain } from './contextual-assignment-list-proof-lifecycle'
import { validateTestUnpublicationReviewedMigration } from './test-unpublication-reviewed-migration'
import { validateTestOwnerWorkflowReviewedMigration } from './test-owner-workflow-reviewed-migration'
import { validateTestLearnerWorkflowReviewedMigration } from './test-learner-workflow-reviewed-migration'
import { validateStudentTestSessionStatusReviewedMigration } from './student-test-session-status-reviewed-migration'
import { validateTestOwnerGradingReviewedMigration } from './test-owner-grading-reviewed-migration'
import { validateTestOwnerRecoveryReviewedMigration } from './test-owner-recovery-reviewed-migration'
import { TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION, validateTestOwnerUnpublicationReviewedMigration } from './test-owner-unpublication-reviewed-migration'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import type { DraftSaveDriver, DraftSaveSession, DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'
import { freezeOwnerGrading as freeze, ownerGradingDigest as hash } from './contextual-test-owner-grading-proof-fixture'
import { newTestOwnerUnpublicationFixture, testOwnerUnpublicationSetupSql, testOwnerUnpublicationSnapshotSql,
  TEST_OWNER_UNPUBLICATION_PROOF_CAPS as caps, TEST_OWNER_UNPUBLICATION_PROOF_CHECKS as checks } from './contextual-test-owner-unpublication-proof-fixture'

const q = (v: string) => `'${v.replaceAll("'", "''")}'`
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`
const bounded = (sql: string) => { assert(Buffer.byteLength(sql) <= caps.sqlBytes); return sql }
const plans = new WeakMap<object, TestOwnerUnpublicationNativePlan>()
export function testOwnerUnpublicationNativePlan(original: AssignmentListProofFixture, reviewedHead: string, repository: string) {
  assert.match(reviewedHead, /^[a-f0-9]{40}$/)
  const f = newTestOwnerUnpublicationFixture(original), inventory = loadAssignmentListReviewedMigrations(repository)
  assert.equal(inventory.length, 261); validateAssignmentListMigrationChain(inventory)
  assert.equal(inventory[252].name, '253_classroom_test_tier_caps.sql')
  assert.equal(inventory[252].sha256, '076bb9775a6959ecfc1012a652205968fda74b601daaad3ba6ef0e8f9975cc09')
  assert.equal(hash(inventory[252].sql), inventory[252].sha256)
  assert.equal(inventory[253].name, '254_contextual_test_owner_reorder.sql')
  assert.equal(inventory[253].sha256, '7439de12a4c0721d52f529180b545e8076bd5d9a8884b2efb2c2f04f522b5eea')
  assert.equal(hash(inventory[253].sql), inventory[253].sha256)
  validateTestUnpublicationReviewedMigration(inventory[254]);validateTestOwnerWorkflowReviewedMigration(inventory[255])
  validateTestLearnerWorkflowReviewedMigration(inventory[256]);validateStudentTestSessionStatusReviewedMigration(inventory[257])
  validateTestOwnerGradingReviewedMigration(inventory[258]);validateTestOwnerRecoveryReviewedMigration(inventory[259])
  validateTestOwnerUnpublicationReviewedMigration(inventory[260])
  const source = readFileSync(resolve(repository, 'supabase/migrations', TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION.name), 'utf8')
  validateTestOwnerUnpublicationReviewedMigration({ name: TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION.name, sql: source, sha256: hash(source) })
  assert.equal(source, inventory[260].sql)
  const migrations = inventory.map(({ name, sha256 }) => ({ name, sha256 })), sourceSha256 = hash(source), migrationManifestSha256 = hash(JSON.stringify(migrations))
  const projectId = `pika_assignment_list_${f.tag.slice(-12)}`, guard = testOwnerGuardSql(projectId)
  const prefix = "begin read only;set local lock_timeout='3s';set local statement_timeout='30s';", terminal = "end;$guard$;select 'ok';rollback;"
  const identity = `current_setting('application_name')<>${q(projectId + '_fixture')}`
  assert(guard.startsWith(prefix) && guard.endsWith(terminal) && guard.split(identity).length === 2)
  const inherited = guard.slice(prefix.length, -terminal.length).replace(identity,
    `current_setting('application_name') not in (${q(projectId + '_draft_holder')},${q(projectId + '_draft_contender')},${q(projectId + '_draft_contracts')})`)
  const begin = `begin;set local lock_timeout='1s';set local statement_timeout='12s';set local idle_in_transaction_session_timeout='180s';${inherited}
if current_database()<>'postgres' or current_user<>'postgres' or to_regprocedure('private.return_test_to_draft_core_v1(uuid,uuid,boolean)') is null then raise exception 'Unpublication261 disposable source differs';end if;end;$guard$;`
  const tid = `${q(f.testId)}::uuid`, cid = `${q(f.classroomId)}::uuid`, owner = `${q(f.actors[0].id)}::uuid`, member = `${q(f.actors[2].id)}::uuid`
  const presence = `do $presence$ begin if not exists(select 1 from public.classrooms where id=${cid} and teacher_id=${owner} and archived_at is null)
or ${f.tests.map(t => `not exists(select 1 from public.tests where id=${q(t.id)} and classroom_id=${q(t.classroom_id)} and status='closed' and questions_locked_at is null)`).join(' or ')}
or ${f.actors.map(a => `not exists(select 1 from public.users where id=${q(a.id)} and role=${q(a.role)} and email=${q(a.email)})`).join(' or ')}
or exists(select 1 from public.test_attempts where test_id in (${f.tests.map(t=>q(t.id)).join(',')}))
or not exists(select 1 from public.classroom_enrollments where id=${q(f.selfEnrollmentId)} and classroom_id=${q(f.classes[1].id)} and student_id=${q(f.actors[1].id)})
then raise exception 'Unpublication261 no-work fixture presence differs';end if;end;$presence$;`
  const setup = bounded(`${guard}\nbegin read only;set local statement_timeout='8s';${presence}rollback;`)
  const preparation = bounded(testOwnerUnpublicationSetupSql(f, projectId)), snapshot = bounded(testOwnerUnpublicationSnapshotSql(f))
  const template = readFileSync(resolve(repository, 'scripts/check-contextual-test-owner-unpublication.sql'), 'utf8')
  const marker = '-- owner-unpublication-contracts-begin\n', end = '-- owner-unpublication-contracts-end'
  assert(template.split(marker).length === 2 && template.split(end).length === 2)
  let body = template.split(marker)[1].split(end)[0]
  for (const [number, id] of Object.entries(f.rollbackIds)) body = body.replaceAll(`a2610000-0000-4000-8000-${number.padStart(12, '0')}`, id)
  assert(!body.includes('a2610000-'))
  const contracts = freeze({ checks, sql: bounded(`${begin}\n${body}\nselect jsonb_build_object('checks',${json(checks)}) as result;rollback;`) })
  const classes = f.classes.map(c => q(c.id)).join(','), tests = f.tests.map(t => q(t.id)).join(',')
  const tables = [
    ['public.users', `id in (${f.actors.map(a=>q(a.id)).join(',')})`], ['public.classrooms', `id in (${classes})`],
    ['public.classroom_enrollments', `classroom_id in (${classes})`], ['public.classroom_archive_revisions', `classroom_id in (${classes})`],
    ['public.gradebook_categories', `classroom_id in (${classes})`], ['public.gradebook_score_overrides', `assessment_type='test' and assessment_id in (${tests})`],
    ['public.managed_storage_settings', 'true'], ['public.managed_storage_objects', `classroom_id in (${classes}) or resource_id in (${tests})`],
    ['public.managed_storage_json_references', `test_id in (${tests})`], ['public.classroom_guided_draft_provenance', `classroom_id in (${classes})`],
    ['public.assessment_drafts', `classroom_id in (${classes})`], ['public.course_blueprints', `id=${q(f.blueprint.id)}`],
    ['public.course_blueprint_versions', `course_blueprint_id=${q(f.blueprint.id)}`], ['public.test_document_snapshot_storage_cleanup', 'true'],
    ['public.test_attempt_history', `test_attempt_id in(select id from public.test_attempts where test_id in (${tests}))`],
    ...['tests','test_questions','test_attempts','test_responses','test_student_availability','test_focus_events','test_ai_grading_runs','test_ai_grading_run_items']
      .map(t=>[`public.${t}`, `${t==='tests'?'id':'test_id'} in (${tests})`]),
  ]
  const graph = `jsonb_build_object(${tables.map(([table,predicate])=>`${q(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from ${table} r where ${predicate})`).join(',')})`
  const expected = `(select to_jsonb(t) from public.tests t where id=${tid})`
  const call = `public.test_owner_workflow_v1(${owner},${tid},${cid},'unpublish','{}',${expected},clock_timestamp()+interval '25 seconds')`
  const testKey = `hashtextextended(${q(f.testId)},0)`, classKey = `hashtextextended(${q('pika-classroom-operation:'+f.classroomId)},0)`
  const locked = (table:string,predicate:string) => `do $hold$ declare n integer;begin perform 1 from ${table} where ${predicate} for update nowait;get diagnostics n=row_count;if n<>1 then raise exception 'Unpublication holder scope differs';end if;end;$hold$;`
  function schedule(label:string,holder:string,relation:string,rejectedCall=call,key:string|null=null,code='PT409') {
    const held = key ? `exists(select 1 from pg_locks l cross join lateral(select (${key})::bigint value) k where l.pid=pg_backend_pid() and l.granted and l.locktype='advisory' and l.classid::bigint=((k.value>>32)&4294967295) and l.objid::bigint=(k.value&4294967295) and l.objsubid=1)`
      : `exists(select 1 from pg_locks where pid=pg_backend_pid() and granted and locktype='relation' and relation=${q(relation)}::regclass and mode in('RowShareLock','RowExclusiveLock'))`
    return { label,relation,code,holderSql:bounded(`${begin}\n${holder}\nselect jsonb_build_object('held',${held},'transaction',exists(select 1 from pg_stat_activity where pid=pg_backend_pid() and xact_start is not null),'scope',exists(select 1 from public.tests where id=${tid} and classroom_id=${cid}),'backend_pid',pg_backend_pid(),'application_name',current_setting('application_name'),'label',${q(label)},'relation',${q(relation)}) as result;`),
      rejectSql:bounded(`${begin}\ndo $reject$ declare baseline jsonb;code text;succeeded boolean:=false;begin baseline:=${graph};begin perform ${rejectedCall};succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;if succeeded or code is distinct from ${q(code)} then raise exception 'Unpublication contention code differs';end if;if ${graph} is distinct from baseline then raise exception 'Rejected unpublication changed whole graph';end if;end;$reject$;select jsonb_build_object('rejected',true,'code',${q(code)},'rows_unchanged',true,'label',${q(label)}) as result;`) }
  }
  const aiInsert = `insert into public.test_ai_grading_runs(id,test_id,triggered_by,selection_hash,status) values(${q(f.rollbackIds['401'])},${tid},${owner},'unpublication-held','completed');`
  const workInsert = `insert into public.test_student_availability(test_id,student_id,state,updated_by) values(${tid},${member},'open',${owner});`
  const aiCreate = `public.create_test_ai_grading_run_atomic(${tid},${owner},'synthetic-contract',array[${member}],array[${member}],'held-unpublication-source',1,0,0,'[]'::jsonb,'[]'::jsonb,null)`
  const concurrency = freeze({ schedules: [
    schedule('settings',locked('public.managed_storage_settings','singleton'),'public.managed_storage_settings'),
    schedule('test-advisory',`select pg_advisory_xact_lock(${testKey});`,'public.tests',call,testKey),
    schedule('classroom-operation',`select public.classroom_purge_lock(${cid});`,'public.classrooms',call,classKey),
    schedule('membership-operation',`select private.try_lock_classroom_membership_change(${cid});`,'public.classrooms',call,classKey),
    schedule('owner-parent-archive',locked('public.classrooms',`id=${cid}`),'public.classrooms'),
    schedule('archive-revision',locked('public.classroom_archive_revisions',`classroom_id=${cid}`),'public.classroom_archive_revisions'),
    schedule('actor',locked('public.users',`id=${owner}`),'public.users'),
    schedule('test-parent',locked('public.tests',`id=${tid}`),'public.tests'),
    schedule('draft',locked('public.assessment_drafts',`assessment_type='test' and assessment_id=${tid}`),'public.assessment_drafts'),
    schedule('question',locked('public.test_questions',`id=${q(f.questions.find(x=>x.test_id===f.testId)!.id)}`),'public.test_questions'),
    schedule('work-access-before-unpublish',workInsert,'public.test_student_availability',call,testKey),
    schedule('ai-before-unpublish',aiInsert,'public.test_ai_grading_runs',call,testKey),
    schedule('unpublish-before-work-access',`do $write$ begin perform ${call};end;$write$;`,'public.tests',`public.start_test_attempt_revision_atomic(${tid},${member})`,testKey,'55P03'),
    schedule('unpublish-before-ai-create',`do $write$ begin perform ${call};end;$write$;`,'public.tests',aiCreate,testKey,'55P03'),
  ] })
  const plan = freeze({ version:1,reviewedHead,projectId,fixture:f,migrations,migrationManifestSha256,sourceSha256,guard,setup,preparation,snapshot,contracts,concurrency,caps,nativeVerified:false as const,
    limitations:['Source/mock evidence is not native acceptance.','Committed SDK freshness, cancellation and generated types require independent exact-bound native evidence.'] })
  plans.set(plan.contracts,plan);return plan
}
export type TestOwnerUnpublicationNativePlan = ReturnType<typeof testOwnerUnpublicationNativePlan>
function sourcePlan(m:TestOwnerUnpublicationNativePlan) { const p=plans.get(m.contracts);return p!==undefined&&Object.isFrozen(m)&&Object.keys(p).every(key=>m[key as keyof typeof m]===p[key as keyof typeof p]) }
export function validateTestOwnerUnpublicationNativePlanSql(m:TestOwnerUnpublicationNativePlan,sql:string) {
  return sourcePlan(m)&&Buffer.byteLength(sql)<=caps.sqlBytes&&[m.setup,m.snapshot,m.contracts.sql,...m.concurrency.schedules.flatMap(s=>[s.holderSql,s.rejectSql])].includes(sql)
}
function target(m:TestOwnerUnpublicationNativePlan,t:DraftSaveTarget,phase:'contracts'|'concurrency') {
  assert(sourcePlan(m));assert.equal(m.sourceSha256,TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION.sha256);assert(Object.isFrozen(t))
  assert.equal(t.projectId,m.projectId);assert.equal(t.containerProjectLabel,m.projectId);assert.equal(t.disposable,true)
  assert.equal(t.apiUrl,'http://127.0.0.1:54331');assert.equal(t.databaseHost,'127.0.0.1');assert.equal(t.databasePort,54332)
  assert.match(t.containerId,/^[a-f0-9]{64}$/);assert.equal(t.reviewedHead,m.reviewedHead);assert.equal(t.reviewedSourceSha256,m.sourceSha256)
  assert.equal(t.migrationManifestSha256,m.migrationManifestSha256);assert.equal(t.acceptedManifestSha256,hash(JSON.stringify(m[phase])))
}
function driverRun(m:TestOwnerUnpublicationNativePlan,t:DraftSaveTarget,d:DraftSaveDriver) {
  const started=Date.now();let dispatches=0
  const remaining=()=>{const n=caps.totalMs-(Date.now()-started);assert(n>0);return n}
  const verify=async()=>{remaining();assert.deepEqual(await d.verifyTarget(),t);remaining()}
  return {verify,async execute(s:DraftSaveSession,sql:string){assert(validateTestOwnerUnpublicationNativePlanSql(m,sql));assert(++dispatches<=caps.dispatches);await verify()
    const rows=await s.execute(sql,Math.min(caps.requestMs,remaining()));remaining();assert(Buffer.byteLength(JSON.stringify(rows))<=caps.responseBytes)
    assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]),['result']);return rows[0].result}}
}
export async function runTestOwnerUnpublicationNativeContracts(m:TestOwnerUnpublicationNativePlan,t:DraftSaveTarget,d:DraftSaveDriver) {
  target(m,t,'contracts');const r=driverRun(m,t,d);await r.verify();const name=`${m.projectId}_draft_contracts`,session=await d.openSession(name)
  try {assert.equal(session.name,name);assert.deepEqual(await r.execute(session,m.contracts.sql),{checks:m.contracts.checks});return freeze({checks:m.contracts.checks,nativeVerified:false as const})}
  finally {await session.rollbackAndClose(caps.closeMs)}
}
export async function runTestOwnerUnpublicationNativeRaces(m:TestOwnerUnpublicationNativePlan,t:DraftSaveTarget,d:DraftSaveDriver) {
  target(m,t,'concurrency');const r=driverRun(m,t,d),outcomes:string[]=[]
  for(const s of m.concurrency.schedules){let holder:DraftSaveSession|undefined,contender:DraftSaveSession|undefined
    try {await r.verify();const hn=`${m.projectId}_draft_holder`,cn=`${m.projectId}_draft_contender`
      holder=await d.openSession(hn);contender=await d.openSession(cn);assert.equal(holder.name,hn);assert.equal(contender.name,cn)
      const raw=await r.execute(holder,s.holderSql);assert(raw&&typeof raw==='object'&&!Array.isArray(raw));const row=raw as Record<string,unknown>
      assert.deepEqual(Object.keys(row).sort(),['application_name','backend_pid','held','label','relation','scope','transaction'])
      assert.equal(row.held,true);assert.equal(row.transaction,true);assert.equal(row.scope,true);assert(Number.isSafeInteger(row.backend_pid)&&Number(row.backend_pid)>0)
      assert.equal(row.application_name,hn);assert.equal(row.label,s.label);assert.equal(row.relation,s.relation)
      assert.deepEqual(await r.execute(contender,s.rejectSql),{rejected:true,code:s.code,rows_unchanged:true,label:s.label});outcomes.push(s.label)
    } finally {const closes=await Promise.allSettled([...(contender?[contender.rollbackAndClose(caps.closeMs)]:[]),...(holder?[holder.rollbackAndClose(caps.closeMs)]:[])])
      const bad=closes.find(row=>row.status==='rejected');if(bad?.status==='rejected')throw bad.reason}}
  return freeze({outcomes,nativeVerified:false as const})
}
