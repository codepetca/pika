import { validateLifecycleServicesReviewedMigrations } from './lifecycle-services-reviewed-migrations'
import { validateGradebookWorkflowReviewedMigration } from './gradebook-workflow-reviewed-migration'
import { validateGradebookCompactZeroWeightAssessmentsReviewedMigration } from './gradebook-compact-zero-weight-assessments-reviewed-migration'
import { validateClassroomHotLifecycleReviewedMigration } from './classroom-hot-lifecycle-reviewed-migration'
import { validateSurveyWorkflowReviewedMigration } from './survey-workflow-reviewed-migration'
import { validateGradebookZeroWeightStudentVisibilityReviewedMigration } from './gradebook-zero-weight-student-visibility-reviewed-migration'
import { validateTestReturnUngradedWorkReviewedMigration } from './test-return-ungraded-work-reviewed-migration'
import { validateTestAiGradingSavedWorkReviewedMigration } from './test-ai-grading-saved-work-reviewed-migration'
import { validateTestCalendarDateReviewedMigration } from './test-calendar-date-reviewed-migration'
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
import { validateTestOwnerDeletionReviewedMigration } from './test-owner-deletion-reviewed-migration'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import type { DraftSaveDriver, DraftSaveSession, DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'
import { freezeOwnerGrading as freeze, ownerGradingDigest as hash } from './contextual-test-owner-grading-proof-fixture'
import { newTestOwnerUnpublicationFixture, testOwnerUnpublicationSetupSql, testOwnerUnpublicationSnapshotSql,
  TEST_OWNER_UNPUBLICATION_PROOF_CAPS as caps, TEST_OWNER_UNPUBLICATION_PROOF_CHECKS as checks } from './contextual-test-owner-unpublication-proof-fixture'

const q = (v: string) => `'${v.replaceAll("'", "''")}'`
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`
const bounded = (sql: string) => { assert(Buffer.byteLength(sql) <= caps.sqlBytes); return sql }
// Closed top-level source boundaries only: no SQL parser or caller selectors.
// Each complete top-level statement and surrounding role changes stay byte-identical.
const contractBoundaries = Object.freeze([
  '\n-- Invoke the success path as the actual granted role; the definer function\n',
  '\ndo $reject_cases$\n',
  '\n-- Additional255/261 parity limits run before the intentional late status fault.\n',
  '\n-- Count-only fixture rows2501-5000.\n',
  '\n-- Count-only fixture rows5001-7500.\n',
  '\n-- Count-only fixture rows7501-10000.\n',
  '\n-- Count-only fixture rejection and savepoint restoration.\n',
  '\n-- Pending provider cleanup is only a relational fence; no provider is called.\n',
  '\n-- service-only-empty-search-path / private-core-service-denial\n',
  '\n-- mixed-role-current-owner / current-member-former-owner-foreign-creator-denial\n',
])
const contractLabels = Object.freeze(['initialize','success','rejections','limits','limits-count-2501-5000',
  'limits-count-5001-7500','limits-count-7501-10000','limits-count-restore','provider','acl','contextual'] as const)
const plans = new WeakMap<object, TestOwnerUnpublicationNativePlan>()
export function testOwnerUnpublicationNativePlan(original: AssignmentListProofFixture, reviewedHead: string, repository: string) {
  assert.match(reviewedHead, /^[a-f0-9]{40}$/)
  const f = newTestOwnerUnpublicationFixture(original), inventory = loadAssignmentListReviewedMigrations(repository)
  assert([261,262,263, 264, 265, 266, 267, 268, 269,270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291].includes(inventory.length)); validateAssignmentListMigrationChain(inventory)
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
  if (inventory.length >= 262) validateTestOwnerDeletionReviewedMigration(inventory[261])
  if (inventory.length >= 263) validateTestCalendarDateReviewedMigration(inventory[262])
  if (inventory.length >= 264) validateTestAiGradingSavedWorkReviewedMigration(inventory[263])
  if (inventory.length >= 265) validateTestReturnUngradedWorkReviewedMigration(inventory[264])
  if (inventory.length >= 266) validateGradebookZeroWeightStudentVisibilityReviewedMigration(inventory[265])
  if (inventory.length >= 267) validateGradebookCompactZeroWeightAssessmentsReviewedMigration(inventory[266])
  if (inventory.length >= 268) validateClassroomHotLifecycleReviewedMigration(inventory[267])
  if (inventory.length >= 269) validateSurveyWorkflowReviewedMigration(inventory[268])
  if (inventory.length >= 270) validateGradebookWorkflowReviewedMigration(inventory[269])
  validateLifecycleServicesReviewedMigrations(inventory)
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
  assert(template.indexOf(marker)<template.indexOf(end),'Unpublication contract source marker order differs')
  let body = template.split(marker)[1].split(end)[0]
  for (const [number, id] of Object.entries(f.rollbackIds)) body = body.replaceAll(`a2610000-0000-4000-8000-${number.padStart(12, '0')}`, id)
  assert(!body.includes('a2610000-'))
  const positions = contractBoundaries.map(marker => {
    assert.equal(body.split(marker).length, 2, 'Unpublication fixed contract boundary differs')
    return body.indexOf(marker)
  })
  assert(positions.every((position,index) => position > (index === 0 ? 0 : positions[index-1])), 'Unpublication contract boundary order differs')
  const contractTerminal = `\nselect jsonb_build_object('checks',${json(checks)}) as result;rollback;`
  const sourceSlices = [0,...positions].map((position,index) =>
    `${index === 0 ? begin+'\n' : ''}${body.slice(position,positions[index] ?? body.length)}${index === contractLabels.length-1 ? contractTerminal : ''}`)
  const frames = sourceSlices.map((sourceSql,index) => ({ label:contractLabels[index],sql:bounded(sourceSql+(index === contractLabels.length-1 ? ''
    : `\nselect jsonb_build_object('frame',${q(contractLabels[index])},'transaction',txid_current()::text) as result;`)) }))
  assert.equal(frames.length,contractLabels.length)
  // The monolith is a reconstruction oracle only, never an executable frame.
  const contracts = freeze({ checks,sql:bounded(`${begin}\n${body}${contractTerminal}`),frames })
  assert.equal(sourceSlices.join(''),contracts.sql)
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
  const workHolder = `do $write$ begin perform public.update_test_student_access_atomic(${tid},array[${member}]::uuid[],'open',${owner});end;$write$;`
  const aiCreate = `public.create_test_ai_grading_run_atomic(${tid},${owner},'synthetic-contract',array[${member}]::uuid[],array[]::uuid[],'held-unpublication-source',0,0,0,'[]'::jsonb,'[]'::jsonb,null)`
  // The actual no-work AI writer retains its lifecycle lock without creating a run.
  const aiHolder = `do $write$ declare acknowledgment jsonb;begin acknowledgment:=${aiCreate};if acknowledgment is distinct from jsonb_build_object('outcome','noop','run_id',null) then raise exception 'Unpublication AI holder no-work outcome differs';end if;end;$write$;`
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
    schedule('work-access-before-unpublish',workHolder,'public.test_student_availability',call,testKey),
    schedule('ai-before-unpublish',aiHolder,'public.test_ai_grading_runs',call,testKey),
    schedule('unpublish-before-work-access',`do $write$ begin perform ${call};end;$write$;`,'public.tests',`public.start_test_attempt_revision_atomic(${tid},${member})`,testKey,'55P03'),
    schedule('unpublish-before-ai-create',`do $write$ begin perform ${call};end;$write$;`,'public.tests',aiCreate,testKey,'55P03'),
  ] })
  assert(frames.length+2*concurrency.schedules.length<=caps.dispatches)
  const plan = freeze({ version:1,reviewedHead,projectId,fixture:f,migrations,migrationManifestSha256,sourceSha256,guard,setup,preparation,snapshot,contracts,concurrency,caps,nativeVerified:false as const,
    limitations:['Source/mock evidence is not native acceptance.','Committed SDK freshness, cancellation and generated types require independent exact-bound native evidence.'] })
  plans.set(plan.contracts,plan);return plan
}
export type TestOwnerUnpublicationNativePlan = ReturnType<typeof testOwnerUnpublicationNativePlan>
function sourcePlan(m:TestOwnerUnpublicationNativePlan) { const p=plans.get(m.contracts);return p!==undefined&&Object.isFrozen(m)&&Object.keys(p).every(key=>m[key as keyof typeof m]===p[key as keyof typeof p]) }
export function validateTestOwnerUnpublicationNativePlanSql(m:TestOwnerUnpublicationNativePlan,sql:string) {
  return sourcePlan(m)&&Buffer.byteLength(sql)<=caps.sqlBytes&&[m.setup,m.snapshot,...m.contracts.frames.map(frame=>frame.sql),...m.concurrency.schedules.flatMap(s=>[s.holderSql,s.rejectSql])].includes(sql)
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
  try {assert.equal(session.name,name);let transaction:string|undefined
    // One session, one transaction, one driver/180s clock for all eleven frames.
    // Failure stops the loop; the original owned-session closure still runs.
    for(const [index,frame] of m.contracts.frames.entries()) {
      const raw=await r.execute(session,frame.sql)
      if(index === m.contracts.frames.length-1) assert.deepEqual(raw,{checks:m.contracts.checks})
      else {
        assert(raw&&typeof raw==='object'&&!Array.isArray(raw));const row=raw as Record<string,unknown>
        assert.deepEqual(Object.keys(row).sort(),['frame','transaction']);assert.equal(row.frame,frame.label)
        assert(typeof row.transaction==='string'&&/^[1-9][0-9]{0,19}$/.test(row.transaction))
        if(transaction === undefined) transaction=row.transaction
        else assert.equal(row.transaction,transaction,'Unpublication contract transaction differs')
      }
    }
    return freeze({checks:m.contracts.checks,nativeVerified:false as const})}
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
