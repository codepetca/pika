/** Inert finite rollback schedules. Importing this source starts no process,
 * database connection or cleanup. Native acceptance requires the reviewed
 * exact-project driver and the source-sealed manifest below. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { testOwnerReorderRequest, type TestOwnerReorderFixture } from './contextual-test-reorder-proof-fixture'
import type { DraftSaveDriver, DraftSaveSession, DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'

const SOURCE_SHA = '6c58370f3234cce74a767cde1819a4d6af0265725cb69b843f54b4e8a9b55c6e'
export const TEST_OWNER_REORDER_CONCURRENCY_CAPS = Object.freeze({ sqlBytes: 256 * 1024, responseBytes: 8 * 1024 * 1024,
  requestMs: 12000, closeMs: 12000, totalMs: 180000, sessions: 2, dispatches: 42, rollbackSchedules: 21 })
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_REORDER_CONCURRENCY_CAPS.sqlBytes); return sql }
function uuids(ids: readonly string[]) { return `array[${ids.map(id => `${q(id)}::uuid`).join(',')}]::uuid[]` }
function exactOne(sql: string) { return `do $one$ declare n integer;begin ${sql};get diagnostics n=row_count;if n<>1 then raise exception 'Exact reorder holder scope differs';end if;end;$one$;` }

function graph(classroomId: string) {
  const cid = `${q(classroomId)}::uuid`
  const ids = `select id from public.tests where classroom_id=${cid}`
  const scoped = (table: string, predicate: string) => `${q(table)},(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text),'[]'::jsonb) from ${table} r where ${predicate})`
  return `pg_catalog.jsonb_build_object(${[
    scoped('public.classrooms', `id=${cid}`), scoped('public.classroom_archive_revisions', `classroom_id=${cid}`),
    scoped('public.tests', `classroom_id=${cid}`), scoped('public.assessment_drafts', `classroom_id=${cid} or (assessment_type='test' and assessment_id in (${ids}))`),
    ...['test_questions', 'test_attempts', 'test_responses', 'test_student_availability', 'test_focus_events', 'test_ai_grading_runs', 'test_ai_grading_run_items'].map(table => scoped(`public.${table}`, `test_id in (${ids})`)),
    scoped('public.test_attempt_history', `test_attempt_id in (select id from public.test_attempts where test_id in (${ids}))`),
    scoped('public.gradebook_score_overrides', `classroom_id=${cid} or (assessment_type='test' and assessment_id in (${ids}))`),
    scoped('public.classroom_guided_draft_provenance', `classroom_id=${cid} or test_id in (${ids})`),
    scoped('public.managed_storage_objects', `classroom_id=${cid} or (resource_type='test' and resource_id in (${ids}))`),
    scoped('public.managed_storage_json_references', `test_id in (${ids})`),
    scoped('public.test_document_snapshot_storage_cleanup', 'true'), scoped('public.managed_storage_settings', 'true'),
  ].join(',')})`
}

export function testOwnerReorderConcurrencyManifest(fixture: TestOwnerReorderFixture) {
  assert(Object.isFrozen(fixture)); assert.match(fixture.tag, /^testownerreorder_[a-f0-9]{12}$/)
  const ownerCase = fixture.cases.find(row => row.label === 'teacher-owner'); assert(ownerCase && ownerCase.expectedHTTP === 200)
  const c = ownerCase
  const request = testOwnerReorderRequest(fixture, c.label)
  const test = fixture.tests.find(row => row.classroom_id === c.classroomId && row.status === 'draft' && row.blueprint_archived_at === null); assert(test)
  const draft = fixture.drafts.find(row => row.assessment_id === test.id); assert(draft)
  const projectId = `pika_assignment_list_${fixture.tag.slice(-12)}`
  const actor = `${q(c.actorId)}::uuid`, cid = `${q(c.classroomId)}::uuid`, tid = `${q(test.id)}::uuid`
  const otherClass = fixture.classes.find(row => row.label === 'student-owner'); assert(otherClass)
  const key = `pg_catalog.hashtextextended('pika-classroom-operation:'||${cid}::text,0)`
  const begin = `${testOwnerGuardSql(projectId)}\nbegin;set local lock_timeout='1s';set local statement_timeout='12s';set local idle_in_transaction_session_timeout='180s';`
  const call = `public.reorder_tests_for_owner_v1(${actor},${cid},${uuids(request.test_ids)},pg_catalog.clock_timestamp()+interval '8 seconds')`
  const rowScope = `exists(select 1 from public.classrooms where id=${cid})`
  function make(label: string, holder: string, relation: string, scope = rowScope, advisory = false,
    rejectedCall = call, rejectedCode = 'PT409') {
    const lock = advisory
      ? `exists(select 1 from pg_catalog.pg_locks l cross join lateral(select (${key})::bigint value) k where l.pid=pg_catalog.pg_backend_pid() and l.granted and l.locktype='advisory' and l.classid::bigint=((k.value>>32)&4294967295) and l.objid::bigint=(k.value&4294967295) and l.objsubid=1)`
      : `exists(select 1 from pg_catalog.pg_locks l where l.pid=pg_catalog.pg_backend_pid() and l.granted and l.locktype='relation' and l.relation=${q(relation)}::regclass and l.mode in ('RowShareLock','RowExclusiveLock'))`
    return freeze({ label,
      holderSql: bounded(`${begin}\n${holder}\nselect pg_catalog.jsonb_build_object('held',${lock},'transaction',exists(select 1 from pg_catalog.pg_stat_activity a where a.pid=pg_catalog.pg_backend_pid() and a.xact_start is not null and a.application_name=${q(projectId + '_draft_holder')}),'backend_pid',pg_catalog.pg_backend_pid(),'application_name',current_setting('application_name'),'relation',${q(relation)},'scope',(${scope}),'label',${q(label)}) as result;`),
      rejectedCode,
      rejectSql: bounded(`${begin}\ndo $reject$ declare baseline jsonb;code text;succeeded boolean:=false;begin baseline:=${graph(c.classroomId)};begin perform ${rejectedCall};succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;if succeeded or code is distinct from ${q(rejectedCode)} then raise exception 'Reorder contention code differs';end if;if ${graph(c.classroomId)} is distinct from baseline then raise exception 'Rejected reorder changed rows';end if;end;$reject$;select pg_catalog.jsonb_build_object('rejected',true,'code',${q(rejectedCode)},'rows_unchanged',true,'label',${q(label)}) as result;`),
    })
  }
  const create = `public.create_test_for_owner_v1(${actor},${cid},'Synthetic reorder race',pg_catalog.clock_timestamp()+interval '8 seconds')`
  const schedules = [
    make('actor-row', exactOne(`perform id from public.users where id=${actor} for update nowait`), 'public.users'),
    make('classroom-row', exactOne(`perform id from public.classrooms where id=${cid} for update nowait`), 'public.classrooms'),
    make('test-row', exactOne(`perform id from public.tests where id=${tid} for update nowait`), 'public.tests'),
    make('settings-row', exactOne('perform singleton from public.managed_storage_settings where singleton for update nowait'), 'public.managed_storage_settings'),
    make('archive-revision-row', exactOne(`perform classroom_id from public.classroom_archive_revisions where classroom_id=${cid} for update nowait`), 'public.classroom_archive_revisions'),
    make('class-operation-key', `do $hold$ begin if not public.classroom_purge_try_lock(${cid}) then raise exception 'Class key busy';end if;end;$hold$;`, 'public.classrooms', rowScope, true),
    make('membership-operation-key', `do $hold$ begin perform private.try_lock_classroom_membership_change(${cid});end;$hold$;`, 'public.classrooms', rowScope, true),
    make('second-reorder', `do $hold$ begin perform ${call};end;$hold$;`, 'public.classrooms', rowScope, true),
    make('contextual-create250', `do $hold$ begin perform ${create};end;$hold$;`, 'public.classrooms', rowScope, true),
    make('contextual-discard251', `do $hold$ declare created jsonb;begin created:=${create};perform public.discard_pristine_test_draft_for_owner_v1(${actor},(created->>'test_id')::uuid,1,(created->'test'->>'updated_at')::timestamptz,pg_catalog.clock_timestamp()+interval '8 seconds');end;$hold$;`, 'public.classrooms', rowScope, true),
    make('contextual-save249', `do $hold$ declare source jsonb;begin source:=public.snapshot_test_draft_save_for_owner_v1(${actor},${tid},pg_catalog.clock_timestamp()+interval '8 seconds');perform public.finish_test_draft_save_for_owner_v1(${actor},${tid},${cid},source->>'source_sha256',(source->'draft'->>'version')::integer,'save',source->'draft'->'content','[]'::jsonb,false,pg_catalog.clock_timestamp()+interval '8 seconds');end;$hold$;`, 'public.classrooms', rowScope, true),
    make('contextual-publication252', `do $hold$ declare source jsonb;begin source:=public.snapshot_test_draft_for_owner_v1(${actor},${tid},pg_catalog.clock_timestamp()+interval '8 seconds');perform public.publish_test_from_draft_for_owner_v1(${actor},${tid},${cid},source->>'source_sha256',(source->'draft'->>'version')::integer,source->'draft'->'content',pg_catalog.clock_timestamp()+interval '8 seconds');end;$hold$;`, 'public.classrooms', rowScope, true),
    make('legacy-position-update', exactOne(`update public.tests set position=position+19 where id=${tid} and classroom_id=${cid}`), 'public.tests', rowScope, true),
    make('legacy-insert', `insert into public.tests(classroom_id,title,created_by,position) values(${cid},'Synthetic legacy reorder race',${actor},319);`, 'public.tests', rowScope, true),
    make('legacy-delete', exactOne(`delete from public.tests where id=${tid} and classroom_id=${cid}`), 'public.tests', rowScope, true),
    make('legacy-reparent', exactOne(`update public.tests set classroom_id=${q(otherClass.id)}::uuid,gradebook_category_id=null where id=${tid} and classroom_id=${cid}`), 'public.tests', rowScope, true),
    make('owner-transition', exactOne(`update public.classrooms set teacher_id=${q(fixture.actors[4].id)}::uuid where id=${cid} and teacher_id=${actor}`), 'public.classrooms'),
    make('archive-transition', exactOne(`update public.classrooms set archived_at=pg_catalog.transaction_timestamp() where id=${cid} and archived_at is null`), 'public.classrooms'),
    // This real entrypoint takes the Class row lock before declining active-Class
    // reuse. It is not evidence of successful Blueprint creation or proposal.
    make('declined-archived-blueprint-reuse114', `do $blueprint$ declare baseline jsonb;result jsonb;begin baseline:=${graph(c.classroomId)};result:=public.create_archived_classroom_blueprint_atomic(${q(fixture.classes[6].id)}::uuid,${actor},${q('0'.repeat(64))},${cid},(select blueprint_source_revision from public.classrooms where id=${cid}),'{}'::jsonb);if result->>'error_code' is distinct from 'source_classroom_not_archived' or (result->>'status')::integer is distinct from 409 then raise exception 'Declined Blueprint reuse differs';end if;if ${graph(c.classroomId)} is distinct from baseline then raise exception 'Declined Blueprint reuse changed rows';end if;end;$blueprint$;`, 'public.classrooms'),
    make('actual-purge-lifecycle-guard122', `do $purge$ begin perform public.guard_classroom_purge_lifecycle(${cid});end;$purge$;`, 'public.classrooms', rowScope, true),
    make('reorder-versus-actual-purge-guard122', `do $hold$ begin perform ${call};end;$hold$;`, 'public.classrooms', rowScope, true,
      `public.guard_classroom_purge_lifecycle(${cid})`, '40001'),
  ]
  assert.equal(schedules.length, TEST_OWNER_REORDER_CONCURRENCY_CAPS.rollbackSchedules)
  return freeze({ version: 1 as const, projectId, sourceFile: '253_contextual_test_owner_reorder.sql' as const,
    sourceSha256: SOURCE_SHA, caps: TEST_OWNER_REORDER_CONCURRENCY_CAPS, schedules, limitations: [
      'Rollback contention is not a committed freshness or last-writer proof; committed schedules remain a separate gate.',
      'Declined active-Class Blueprint reuse and the actual purge lifecycle guard are covered; successful Blueprint/proposal and enabled purge workflows are not claimed covered.',
      'Legacy cached MAX insertion after-commit, disabled triggers and maintenance writers remain existing residuals.',
      'Create/discard holders consume nontransactional writer sequence values; they are never reset or compared as rollback equality.',
    ] })
}
export type TestOwnerReorderConcurrencyManifest = ReturnType<typeof testOwnerReorderConcurrencyManifest>
export function validateTestOwnerReorderConcurrencySql(manifest: TestOwnerReorderConcurrencyManifest, sql: string) {
  return Buffer.byteLength(sql) <= manifest.caps.sqlBytes && manifest.schedules.some(schedule => schedule.holderSql === sql || schedule.rejectSql === sql)
}
function one(rows: readonly { result?: unknown }[]) { assert.equal(rows.length, 1); assert('result' in rows[0]); return rows[0].result }

export async function runTestOwnerReorderConcurrency(manifest: TestOwnerReorderConcurrencyManifest, target: DraftSaveTarget, driver: DraftSaveDriver) {
  assert(Object.isFrozen(manifest) && Object.isFrozen(target)); assert.equal(target.projectId, manifest.projectId)
  assert.equal(target.containerProjectLabel, manifest.projectId); assert.equal(target.disposable, true)
  assert.equal(target.apiUrl, 'http://127.0.0.1:54331'); assert.equal(target.databaseHost, '127.0.0.1'); assert.equal(target.databasePort, 54332)
  assert.match(target.containerId, /^[a-f0-9]{64}$/); assert.match(target.reviewedHead, /^[a-f0-9]{40}$/)
  assert.equal(target.reviewedSourceSha256, SOURCE_SHA); assert.equal(target.acceptedManifestSha256, hash(JSON.stringify(manifest)))
  const started = Date.now(); let dispatches = 0
  const remaining = () => { const value = manifest.caps.totalMs - (Date.now() - started); assert(value > 0); return value }
  const verify = async () => { remaining(); assert.deepEqual(await driver.verifyTarget(), target); remaining() }
  async function execute(session: DraftSaveSession, sql: string) {
    assert(validateTestOwnerReorderConcurrencySql(manifest, sql)); assert(++dispatches <= manifest.caps.dispatches); await verify()
    const rows = await session.execute(sql, Math.min(manifest.caps.requestMs, remaining()))
    assert(Buffer.byteLength(JSON.stringify(rows)) <= manifest.caps.responseBytes); remaining(); return one(rows)
  }
  const outcomes: string[] = []
  for (const schedule of manifest.schedules) {
    let holder: DraftSaveSession | undefined, contender: DraftSaveSession | undefined, primary: unknown; let failed = false
    try {
      await verify(); holder = await driver.openSession(`${manifest.projectId}_draft_holder`); contender = await driver.openSession(`${manifest.projectId}_draft_contender`)
      assert.equal(holder.name, `${manifest.projectId}_draft_holder`); assert.equal(contender.name, `${manifest.projectId}_draft_contender`)
      const observed = await execute(holder, schedule.holderSql) as Record<string, unknown>
      assert.equal(observed.held, true); assert.equal(observed.transaction, true); assert.equal(observed.scope, true)
      assert(Number.isInteger(observed.backend_pid) && Number(observed.backend_pid) > 0)
      assert.equal(observed.application_name, holder.name); assert.equal(observed.label, schedule.label)
      assert.deepEqual(await execute(contender, schedule.rejectSql), { rejected: true, code: schedule.rejectedCode, rows_unchanged: true, label: schedule.label })
      outcomes.push(schedule.label)
    } catch (error) { primary = error; failed = true }
    finally {
      const settled = await Promise.allSettled([holder, contender].filter((s): s is DraftSaveSession => Boolean(s)).map(s => s.rollbackAndClose(manifest.caps.closeMs)))
      const failures = settled.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
      if (failures.length) throw new AggregateError([...(failed ? [primary] : []), ...failures], 'Exact reorder session cleanup failed')
    }
    if (failed) throw primary
  }
  return freeze({ kind: 'rollback-test-owner-reorder-contention' as const, schedules: outcomes, dispatches, elapsedMs: Date.now() - started,
    sourceSha256: SOURCE_SHA, manifestSha256: target.acceptedManifestSha256 })
}
