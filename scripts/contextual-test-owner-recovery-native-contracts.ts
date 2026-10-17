import { validateGradebookCompactZeroWeightAssessmentsReviewedMigration } from './gradebook-compact-zero-weight-assessments-reviewed-migration'
import { validateClassroomHotLifecycleReviewedMigration } from './classroom-hot-lifecycle-reviewed-migration'
import { validateGradebookZeroWeightStudentVisibilityReviewedMigration } from './gradebook-zero-weight-student-visibility-reviewed-migration'
import { validateTestReturnUngradedWorkReviewedMigration } from './test-return-ungraded-work-reviewed-migration'
import { validateTestAiGradingSavedWorkReviewedMigration } from './test-ai-grading-saved-work-reviewed-migration'
import { validateTestCalendarDateReviewedMigration } from './test-calendar-date-reviewed-migration'
/** Finite recovery frames for the existing closed native engine. Import is inert. */
import assert from 'node:assert/strict'
import { validateTestOwnerUnpublicationReviewedMigration } from './test-owner-unpublication-reviewed-migration'
import { validateTestOwnerDeletionReviewedMigration } from './test-owner-deletion-reviewed-migration'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { loadAssignmentListReviewedMigrations } from './contextual-assignment-list-proof-platform'
import { validateTestOwnerGradingReviewedMigration } from './test-owner-grading-reviewed-migration'
import { validateStudentTestSessionStatusReviewedMigration } from './student-test-session-status-reviewed-migration'
import { TEST_OWNER_RECOVERY_REVIEWED_MIGRATION, validateTestOwnerRecoveryReviewedMigration } from './test-owner-recovery-reviewed-migration'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import type { TestLearnerObservedAttempt } from './contextual-test-learner-proof-fixture'
import type { DraftSaveDriver, DraftSaveSession, DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'
import { freezeOwnerGrading as freeze, ownerGradingDigest as hash } from './contextual-test-owner-grading-proof-fixture'
import { newTestOwnerRecoveryFixture, TEST_OWNER_RECOVERY_PROOF_CAPS as caps, TEST_OWNER_RECOVERY_PROOF_CHECKS as checks } from './contextual-test-owner-recovery-proof-fixture'

const q = (v: string) => `'${v.replaceAll("'", "''")}'`
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`
const bounded = (sql: string) => { assert(Buffer.byteLength(sql) <= caps.sqlBytes); return sql }
const plans = new WeakMap<object, TestOwnerRecoveryNativePlan>()
export function testOwnerRecoveryNativePlan(original: AssignmentListProofFixture, observed: readonly TestLearnerObservedAttempt[], reviewedHead: string, repository: string) {
  assert.match(reviewedHead, /^[a-f0-9]{40}$/)
  const fixture = newTestOwnerRecoveryFixture(original), f = fixture
  assert(Object.isFrozen(observed) && observed.length === 2)
  observed.forEach((row, i) => {
    assert(Object.isFrozen(row)); assert.deepEqual(Object.keys(row).sort(), ['actorId', 'attemptId', 'revision'])
    assert.equal(row.actorId, f.actors[i + 1].id); assert.match(row.attemptId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    assert(!f.allocatedIds.includes(row.attemptId)); assert(Number.isSafeInteger(row.revision) && row.revision > 0)
  })
  assert.notEqual(observed[0].attemptId, observed[1].attemptId)
  const inventory = loadAssignmentListReviewedMigrations(repository)
  assert([260,261,262,263, 264, 265, 266, 267, 268].includes(inventory.length)); validateStudentTestSessionStatusReviewedMigration(inventory[257])
  validateTestOwnerGradingReviewedMigration(inventory[258]); validateTestOwnerRecoveryReviewedMigration(inventory[259]); if (inventory.length >= 261) validateTestOwnerUnpublicationReviewedMigration(inventory[260])
  if (inventory.length >= 262) validateTestOwnerDeletionReviewedMigration(inventory[261])
  if (inventory.length >= 263) validateTestCalendarDateReviewedMigration(inventory[262])
  if (inventory.length >= 264) validateTestAiGradingSavedWorkReviewedMigration(inventory[263])
  if (inventory.length >= 265) validateTestReturnUngradedWorkReviewedMigration(inventory[264])
  if (inventory.length >= 266) validateGradebookZeroWeightStudentVisibilityReviewedMigration(inventory[265])
  if (inventory.length >= 267) validateGradebookCompactZeroWeightAssessmentsReviewedMigration(inventory[266])
  if (inventory.length === 268) validateClassroomHotLifecycleReviewedMigration(inventory[267])
  const source = readFileSync(resolve(repository, 'supabase/migrations', TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.name), 'utf8')
  validateTestOwnerRecoveryReviewedMigration({ name: TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.name, sql: source, sha256: hash(source) })
  assert.equal(source, inventory[259].sql)
  const migrations = inventory.map(({ name, sha256 }) => ({ name, sha256 })), sourceSha256 = hash(source), migrationManifestSha256 = hash(JSON.stringify(migrations))
  const projectId = `pika_assignment_list_${f.tag.slice(-12)}`, guard = testOwnerGuardSql(projectId)
  const prefix = "begin read only;set local lock_timeout='3s';set local statement_timeout='30s';", terminal = "end;$guard$;select 'ok';rollback;"
  const identity = `current_setting('application_name')<>${q(projectId + '_fixture')}`
  assert(guard.startsWith(prefix) && guard.endsWith(terminal) && guard.split(identity).length === 2)
  const inherited = guard.slice(prefix.length, -terminal.length).replace(identity,
    `current_setting('application_name') not in (${q(projectId + '_draft_holder')},${q(projectId + '_draft_contender')},${q(projectId + '_draft_contracts')})`)
  const begin = `begin;set local lock_timeout='1s';set local statement_timeout='12s';set local idle_in_transaction_session_timeout='180s';${inherited}
if current_database()<>'postgres' or current_user<>'postgres' or to_regprocedure('public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)') is null then raise exception 'Recovery260 disposable source differs';end if;end;$guard$;`
  const tid = `${q(f.testId)}::uuid`, cid = `${q(f.classroomId)}::uuid`, owner = `${q(f.actors[0].id)}::uuid`, member = `${q(f.actors[1].id)}::uuid`
  const classes = `${cid},${q(f.wrongClassroomId)}::uuid`
  const tables = [
    ['public.users', `id in (${f.actors.map(a => q(a.id)).join(',')})`], ['public.classrooms', `id in (${classes})`],
    ['public.classroom_enrollments', `classroom_id in (${classes})`], ['public.classroom_archive_revisions', `classroom_id in (${classes})`],
    ['public.gradebook_categories', `classroom_id in (${classes})`], ['public.gradebook_score_overrides', `assessment_type='test' and assessment_id=${tid}`],
    ['public.managed_storage_settings', 'true'], ['public.managed_storage_objects', `classroom_id in (${classes}) or resource_id=${tid}`],
    ['public.managed_storage_json_references', `test_id=${tid}`], ['public.assessment_drafts', `assessment_type='test' and assessment_id=${tid}`],
    ['public.test_attempt_history', `test_attempt_id in (select id from public.test_attempts where test_id=${tid})`],
    ...['tests', 'test_questions', 'test_attempts', 'test_responses', 'test_student_availability', 'test_focus_events', 'test_ai_grading_runs', 'test_ai_grading_run_items']
      .map(table => [`public.${table}`, `${table === 'tests' ? 'id' : 'test_id'}=${tid}`]),
  ]
  const graph = `jsonb_build_object(${tables.map(([table, predicate]) => `${q(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from ${table} r where ${predicate})`).join(',')})`
  const snapshot = bounded(`begin read only;set local lock_timeout='1s';set local statement_timeout='8s';select ${graph} as result;rollback;`)
  const presence = `do $presence$ begin if not exists(select 1 from public.classrooms where id=${cid} and teacher_id=${owner} and archived_at is null)
or not exists(select 1 from public.tests where id=${tid} and classroom_id=${cid} and status='active' and blueprint_archived_at is null and questions_locked_at is not null)
or ${f.actors.map(a => `not exists(select 1 from public.users where id=${q(a.id)} and role=${q(a.role)} and email=${q(a.email)})`).join(' or ')}
or ${observed.map(a => `not exists(select 1 from public.test_attempts where id=${q(a.attemptId)} and test_id=${tid} and student_id=${q(a.actorId)} and draft_revision>0)`).join(' or ')}
or (select count(*) from public.test_responses where test_id=${tid} and id in (${f.responses.map(r => q(r.id)).join(',')}))<>4
then raise exception 'Recovery260 fixture presence differs';end if;end;$presence$;`
  const setup = bounded(`${guard}\nbegin read only;set local statement_timeout='8s';${presence}rollback;`)
  const template = readFileSync(resolve(repository, 'scripts/check-contextual-test-owner-recovery.sql'), 'utf8')
  const marker = '-- owner-recovery-contracts-begin\n', end = '-- owner-recovery-contracts-end'
  assert(template.split(marker).length === 2 && template.split(end).length === 2)
  let body = template.split(marker)[1].split(end)[0]
  const replacement = new Map<string, string>([
    ...f.actors.map((a, i) => [`a2600000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, a.id] as [string, string]),
    ['a2600000-0000-4000-8000-000000000010', f.classroomId], ['a2600000-0000-4000-8000-000000000019', f.wrongClassroomId], ['a2600000-0000-4000-8000-000000000011', f.testId],
    ...f.questions.map((a, i) => [`a2600000-0000-4000-8000-${String(101 + i).padStart(12, '0')}`, a.id] as [string, string]),
    ...f.responses.map((a, i) => [`a2600000-0000-4000-8000-${String(301 + i).padStart(12, '0')}`, a.id] as [string, string]),
    ['a2600000-0000-4000-8000-000000000401', f.runId], ['a2600000-0000-4000-8000-000000000501', f.itemIds[0]],
  ])
  for (const [before, after] of replacement) body = body.replaceAll(before, after)
  assert(!body.includes('a2600000-'))
  const contracts = freeze({ checks, sql: bounded(`${begin}\n${presence}\n${body}\nselect jsonb_build_object('checks',${json(checks)}) as result;rollback;`) })
  const expected = `(select to_jsonb(t) from public.tests t where id=${tid})`, selected = `jsonb_build_object('student_ids',jsonb_build_array(${member}))`
  const call = (operation: string) => `public.test_owner_workflow_v1(${owner},${tid},${cid},${q(operation)},${selected},${expected},clock_timestamp()+interval '25 seconds')`
  const key = `hashtextextended(${q(f.testId)},0)`
  const locked = (table: string, predicate: string) => `do $hold$ declare n integer;begin perform 1 from ${table} where ${predicate} for update nowait;get diagnostics n=row_count;if n<>1 then raise exception 'Recovery holder scope differs';end if;end;$hold$;`
  function schedule(label: string, holder: string, relation: string, rejectedCall = call('delete-bulk'), advisory: boolean | 'classroom' = false, code = 'PT409') {
    const held = advisory ? `exists(select 1 from pg_locks l cross join lateral(select (${advisory === 'classroom' ? `hashtextextended(${q('pika-classroom-operation:' + f.classroomId)},0)` : key})::bigint value) k where l.pid=pg_backend_pid() and l.granted and l.locktype='advisory' and l.classid::bigint=((k.value>>32)&4294967295) and l.objid::bigint=(k.value&4294967295) and l.objsubid=1)`
      : `exists(select 1 from pg_locks where pid=pg_backend_pid() and granted and locktype='relation' and relation=${q(relation)}::regclass and mode in('RowShareLock','RowExclusiveLock'))`
    return { label, relation, code, holderSql: bounded(`${begin}\n${holder}\nselect jsonb_build_object('held',${held},'transaction',exists(select 1 from pg_stat_activity where pid=pg_backend_pid() and xact_start is not null),'scope',exists(select 1 from public.tests where id=${tid} and classroom_id=${cid}),'backend_pid',pg_backend_pid(),'application_name',current_setting('application_name'),'label',${q(label)},'relation',${q(relation)}) as result;`),
      rejectSql: bounded(`${begin}\ndo $reject$ declare baseline jsonb;code text;succeeded boolean:=false;begin baseline:=${graph};begin perform ${rejectedCall};succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;if succeeded or code is distinct from ${q(code)} then raise exception 'Recovery contention code differs';end if;if ${graph} is distinct from baseline then raise exception 'Rejected recovery changed rows';end if;end;$reject$;select jsonb_build_object('rejected',true,'code',${q(code)},'rows_unchanged',true,'label',${q(label)}) as result;`) }
  }
  const response = `${q(f.responses[0].id)}::uuid`, question = `${q(f.questions[0].id)}::uuid`
  const ai = `public.create_test_ai_grading_run_atomic(${tid},${owner},'synthetic-contract',array[${member}],array[${member}],'held-recovery-source',1,0,0,jsonb_build_array(jsonb_build_object('student_id',${member},'question_id',${question},'response_id',${response},'response_revision',(select revision from public.test_responses where id=${response}),'queue_position',0)),'[]'::jsonb,null)`
  const concurrency = freeze({ schedules: [
    schedule('test-advisory', `select pg_advisory_xact_lock(${key});`, 'public.tests', call('delete-bulk'), true),
    schedule('owner-transfer', locked('public.classrooms', `id=${cid}`), 'public.classrooms'),
    schedule('parent-transfer', locked('public.tests', `id=${tid}`), 'public.tests'),
    schedule('membership', locked('public.classroom_enrollments', `id=${q(f.enrollments[1].id)} and classroom_id=${cid}`), 'public.classroom_enrollments', call('unsubmit-plan')),
    schedule('archive', locked('public.classrooms', `id=${cid}`), 'public.classrooms'),
    schedule('protocol', locked('public.managed_storage_settings', 'singleton'), 'public.managed_storage_settings'),
    schedule('purge', `select public.classroom_purge_lock(${cid});`, 'public.classrooms', call('delete-bulk'), 'classroom'),
    schedule('recovery-before-ai-create', `do $write$ begin perform ${call('unsubmit-plan')};end;$write$;`, 'public.test_attempts', ai, true, '55P03'),
    schedule('ai-create-before-recovery', `do $write$ begin perform ${ai};end;$write$;`, 'public.test_ai_grading_runs', call('delete-bulk'), true),
    schedule('reset-before-learner-save', `do $write$ begin perform ${call('delete-bulk')};end;$write$;`, 'public.test_attempts',
      `public.start_test_attempt_revision_atomic(${tid},${member})`, true, '55P03'),
  ] })
  // Same bounded baseline as the accepted grading profile; actual Start identities
  // and revisions remain mandatory, not guessed from fixture UUIDs.
  const preparation = bounded(`${guard}\nbegin;set local lock_timeout='1s';set local statement_timeout='12s';
    do $exact$ declare n integer;begin
    if exists(select 1 from public.test_responses where id in (${f.responses.map(r => q(r.id)).join(',')}) or test_id=${tid}) then raise exception 'Owner recovery response collision';end if;
    ${observed.map(row => `update public.test_attempts set is_submitted=true,submitted_at=clock_timestamp() where id=${q(row.attemptId)} and test_id=${tid} and student_id=${q(row.actorId)} and not is_submitted and draft_revision=${row.revision};get diagnostics n=row_count;if n<>1 then raise exception 'Observed Start binding differs';end if;`).join('\n')}
    end;$exact$;
    insert into public.test_responses(id,test_id,question_id,student_id,response_text,selected_option,score,graded_at) values ${f.responses.map(r => `(${q(r.id)},${tid},${q(r.questionId)},${q(r.studentId)},${r.question === 0 ? "'Synthetic grading answer'" : 'null'},${r.question === 0 ? 'null' : '0'},${r.question === 0 ? 'null' : '1'},${r.question === 0 ? 'null' : 'clock_timestamp()'})`).join(',')};
    insert into public.test_student_availability(test_id,student_id,state,updated_by) values ${f.actors.slice(1,3).map(a => `(${tid},${q(a.id)},'closed',${owner})`).join(',')};
    update public.tests set questions_locked_at=coalesce(questions_locked_at,clock_timestamp()),show_results=false where id=${tid} and classroom_id=${cid};commit;`)
  const plan = freeze({ version: 1, reviewedHead, projectId, fixture, observedAttempts: observed, migrations, migrationManifestSha256, sourceSha256,
    guard, setup, snapshot, preparation, contracts, concurrency, caps, nativeVerified: false as const,
    limitations: ['Source seals/mock drivers do not establish native acceptance.', 'Held rollback races are not committed freshness or SDK/cancellation evidence.'] })
  plans.set(plan.contracts, plan); return plan
}
export type TestOwnerRecoveryNativePlan = ReturnType<typeof testOwnerRecoveryNativePlan>
function sourcePlan(m: TestOwnerRecoveryNativePlan) { const p = plans.get(m.contracts); return p !== undefined && Object.isFrozen(m) && Object.keys(p).every(key => m[key as keyof typeof m] === p[key as keyof typeof p]) }
export function validateTestOwnerRecoveryNativePlanSql(m: TestOwnerRecoveryNativePlan, sql: string) {
  return sourcePlan(m) && Buffer.byteLength(sql) <= caps.sqlBytes && [m.setup, m.snapshot, m.contracts.sql, ...m.concurrency.schedules.flatMap(s => [s.holderSql, s.rejectSql])].includes(sql)
}
function target(m: TestOwnerRecoveryNativePlan, t: DraftSaveTarget, phase: 'contracts' | 'concurrency') {
  assert(sourcePlan(m)); assert.equal(m.sourceSha256, TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.sha256); assert(Object.isFrozen(t))
  assert.equal(t.projectId, m.projectId); assert.equal(t.containerProjectLabel, m.projectId); assert.equal(t.disposable, true)
  assert.equal(t.apiUrl, 'http://127.0.0.1:54331'); assert.equal(t.databaseHost, '127.0.0.1'); assert.equal(t.databasePort, 54332)
  assert.match(t.containerId, /^[a-f0-9]{64}$/); assert.equal(t.reviewedHead, m.reviewedHead); assert.equal(t.reviewedSourceSha256, m.sourceSha256)
  assert.equal(t.migrationManifestSha256, m.migrationManifestSha256); assert.equal(t.acceptedManifestSha256, hash(JSON.stringify(m[phase])))
}
function driverRun(m: TestOwnerRecoveryNativePlan, t: DraftSaveTarget, d: DraftSaveDriver) {
  const started = Date.now(); let dispatches = 0
  const remaining = () => { const n = caps.totalMs - (Date.now() - started); assert(n > 0); return n }
  const verify = async () => { remaining(); assert.deepEqual(await d.verifyTarget(), t); remaining() }
  return { verify, async execute(s: DraftSaveSession, sql: string) {
    assert(validateTestOwnerRecoveryNativePlanSql(m, sql)); assert(++dispatches <= caps.dispatches); await verify()
    const rows = await s.execute(sql, Math.min(caps.requestMs, remaining())); remaining(); assert(Buffer.byteLength(JSON.stringify(rows)) <= caps.responseBytes)
    assert.equal(rows.length, 1); assert.deepEqual(Object.keys(rows[0]), ['result']); return rows[0].result
  } }
}
export async function runTestOwnerRecoveryNativeContracts(m: TestOwnerRecoveryNativePlan, t: DraftSaveTarget, d: DraftSaveDriver) {
  target(m, t, 'contracts'); const r = driverRun(m, t, d); await r.verify(); const name = `${m.projectId}_draft_contracts`, session = await d.openSession(name)
  try { assert.equal(session.name, name); assert.deepEqual(await r.execute(session, m.contracts.sql), { checks: m.contracts.checks }); return freeze({ checks: m.contracts.checks, nativeVerified: false as const }) }
  finally { await session.rollbackAndClose(caps.closeMs) }
}
export async function runTestOwnerRecoveryNativeRaces(m: TestOwnerRecoveryNativePlan, t: DraftSaveTarget, d: DraftSaveDriver) {
  target(m, t, 'concurrency'); const r = driverRun(m, t, d), outcomes: string[] = []
  for (const s of m.concurrency.schedules) {
    let holder: DraftSaveSession | undefined, contender: DraftSaveSession | undefined
    try {
      await r.verify(); const hn = `${m.projectId}_draft_holder`, cn = `${m.projectId}_draft_contender`
      holder = await d.openSession(hn); contender = await d.openSession(cn); assert.equal(holder.name, hn); assert.equal(contender.name, cn)
      const raw = await r.execute(holder, s.holderSql); assert(raw && typeof raw === 'object' && !Array.isArray(raw)); const row = raw as Record<string, unknown>
      assert.deepEqual(Object.keys(row).sort(), ['application_name', 'backend_pid', 'held', 'label', 'relation', 'scope', 'transaction'])
      assert.equal(row.held, true); assert.equal(row.transaction, true); assert.equal(row.scope, true); assert(Number.isSafeInteger(row.backend_pid) && Number(row.backend_pid) > 0)
      assert.equal(row.application_name, hn); assert.equal(row.label, s.label); assert.equal(row.relation, s.relation)
      assert.deepEqual(await r.execute(contender, s.rejectSql), { rejected: true, code: s.code, rows_unchanged: true, label: s.label }); outcomes.push(s.label)
    } finally {
      const closes = await Promise.allSettled([...(contender ? [contender.rollbackAndClose(caps.closeMs)] : []), ...(holder ? [holder.rollbackAndClose(caps.closeMs)] : [])])
      const bad = closes.find(row => row.status === 'rejected'); if (bad?.status === 'rejected') throw bad.reason
    }
  }
  return freeze({ outcomes, nativeVerified: false as const })
}
