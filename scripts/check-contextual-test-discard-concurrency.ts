/** Inert migration251 two-session source manifest. Importing this module opens
 * no session and runs no SQL. Root alone may execute the sealed statements in
 * the independently verified disposable lifecycle; every schedule rolls back. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TestOwnerPristineDiscardFixture } from './contextual-test-pristine-discard-proof-fixture'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { draftSaveMigrationManifestSha256, type DraftSaveDriver, type DraftSaveSession,
  type DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'

export const TEST_OWNER_PRISTINE_DISCARD_CONCURRENCY_CAPS = Object.freeze({ totalMs: 180_000, dispatches: 180,
  requestMs: 12_000, closeMs: 12_000, sessions: 2, schedules: 14, sqlBytes: 256 * 1024, responseBytes: 8 * 1024 * 1024 })
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const SOURCE = '251_contextual_test_pristine_owner_discard.sql' as const
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_PRISTINE_DISCARD_CONCURRENCY_CAPS.sqlBytes); return sql }
function validateFixture(f: TestOwnerPristineDiscardFixture) {
  assert(Object.isFrozen(f)); assert.equal(f.version, 1); assert.match(f.tag, /^testownerpristinediscard_[a-f0-9]{12}$/)
  assert.equal(f.tests.length, 1001); assert.equal(f.cases.length, 18); assert.equal(f.privilegeProbes.length, 2)
  assert.equal(new Set(f.allocatedIds).size, f.allocatedIds.length)
}
function project(f: TestOwnerPristineDiscardFixture) { return `pika_assignment_list_${f.tag.slice(-12)}` }
export function validateTestOwnerPristineDiscardTarget(target: DraftSaveTarget, f: TestOwnerPristineDiscardFixture, repository: string) {
  validateFixture(f); assert(Object.isFrozen(target), 'Target inventory must be sealed after independent verification')
  assert.equal(target.projectId, project(f)); assert.equal(target.containerProjectLabel, project(f))
  assert.match(target.containerId, /^[a-f0-9]{64}$/); assert.equal(target.disposable, true)
  assert.equal(target.apiUrl, 'http://127.0.0.1:54331'); assert.equal(target.databaseHost, '127.0.0.1'); assert.equal(target.databasePort, 54332)
  assert.match(target.reviewedHead, /^[a-f0-9]{40}$/)
  assert.equal(target.migrationManifestSha256, draftSaveMigrationManifestSha256(repository))
  assert.equal(target.reviewedSourceSha256, hash(readFileSync(resolve(repository, 'supabase/migrations', SOURCE), 'utf8')))
  assert.match(target.acceptedManifestSha256, /^[a-f0-9]{64}$/)
  return target
}
function beginSql(f: TestOwnerPristineDiscardFixture) {
  const original = testOwnerGuardSql(project(f))
  const prefix = "begin read only;set local lock_timeout='3s';set local statement_timeout='30s';"
  const terminal = "end;$guard$;select 'ok';rollback;"
  assert(original.startsWith(prefix) && original.endsWith(terminal))
  const identity = `current_setting('application_name')<>${q(project(f) + '_fixture')}`
  assert(original.includes(identity))
  const inherited = original.slice(prefix.length, -terminal.length).replace(identity,
    `current_setting('application_name') not in (${q(project(f) + '_draft_holder')},${q(project(f) + '_draft_contender')})`)
  return bounded(`begin;set local lock_timeout='1s';set local statement_timeout='12s';${inherited}
 if current_database()<>'postgres' or current_user<>'postgres'
 or to_regprocedure('public.discard_pristine_test_draft_for_owner_v1(uuid,uuid,integer,timestamp with time zone,timestamp with time zone)') is null
 then raise exception 'Migration251 disposable source differs';end if;end;$guard$;`)
}
function snapshot(testId: string, classroomId: string) {
  const tables: Array<[string, string]> = [
    ['public.users', `id=(select teacher_id from public.classrooms where id=${q(classroomId)}::uuid)`],
    ['public.classrooms', `id=${q(classroomId)}::uuid`], ['public.classroom_archive_revisions', `classroom_id=${q(classroomId)}::uuid`],
    ['public.tests', `id=${q(testId)}::uuid`], ['public.assessment_drafts', `assessment_type='test' and assessment_id=${q(testId)}::uuid`],
    ['public.test_questions', `test_id=${q(testId)}::uuid`], ['public.test_attempts', `test_id=${q(testId)}::uuid`],
    ['public.test_responses', `test_id=${q(testId)}::uuid`], ['public.test_focus_events', `test_id=${q(testId)}::uuid`],
    ['public.test_student_availability', `test_id=${q(testId)}::uuid`], ['public.test_ai_grading_runs', `test_id=${q(testId)}::uuid`],
    ['public.test_ai_grading_run_items', `test_id=${q(testId)}::uuid`], ['public.managed_storage_json_references', `test_id=${q(testId)}::uuid`],
    ['public.classroom_guided_draft_provenance', `test_id=${q(testId)}::uuid`],
    ['public.gradebook_score_overrides', `assessment_type='test' and assessment_id=${q(testId)}::uuid`],
    ['public.managed_storage_objects', `resource_type='test' and resource_id=${q(testId)}::uuid`],
  ]
  return `pg_catalog.jsonb_build_object(${tables.map(([table, predicate]) => `${q(table)},(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text),'[]'::jsonb) from ${table} r where ${predicate})`).join(',')},'settings',(select pg_catalog.to_jsonb(s) from public.managed_storage_settings s where singleton))`
}
function rpc(actorId: string, testId: string, version: number, stamp: string) {
  return `public.discard_pristine_test_draft_for_owner_v1(${q(actorId)}::uuid,${q(testId)}::uuid,${version},${q(stamp)}::timestamptz,pg_catalog.clock_timestamp()+interval '8 seconds')`
}
function exactOne(statement: string) {
  return `do $holder$ declare affected integer;begin ${statement};get diagnostics affected=row_count;if affected<>1 then raise exception 'Exact pristine-discard holder scope differs';end if;end;$holder$;`
}
type Schedule = Readonly<{ label: string; holderSql: string; observeSql: string; rejectSql: string; afterSql?: string }>

export function testOwnerPristineDiscardConcurrencyManifest(f: TestOwnerPristineDiscardFixture) {
  validateFixture(f)
  const target = f.cases.find(c => c.expectedDiscarded === true && c.label === 'student-owner')!
  const test = f.tests.find(row => row.id === target.testId)!; const draft = f.drafts.find(row => row.assessment_id === target.testId)!
  assert(test && draft)
  const id = (label: string) => { const h = hash(`${f.tag}:${label}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
  const extraAllocatedIds = [id('concurrency-focus-event')]
  assert(extraAllocatedIds.every(value => UUID.test(value) && !f.allocatedIds.includes(value)))
  const before = snapshot(target.testId, test.classroom_id)
  const call = rpc(target.actorId, target.testId, target.input.expected_draft_version, target.input.expected_test_updated_at)
  const reject = (label: string) => bounded(`do $race$ declare before_rows jsonb;code text;begin before_rows:=${before};
 begin perform ${call};raise exception 'Contender unexpectedly succeeded';exception when sqlstate 'PT409' then get stacked diagnostics code=returned_sqlstate;end;
 if code is distinct from 'PT409' or before_rows is distinct from ${before} then raise exception 'Rejected discard race differs: ${label}';end if;
end;$race$;select jsonb_build_object('rejected',true,'code','PT409','rows_unchanged',true) as result;`)
  const observe = (scope: string) => bounded(`select pg_catalog.jsonb_build_object('held',exists(select 1 from pg_catalog.pg_locks where pid=pg_catalog.pg_backend_pid() and granted and (locktype='advisory' or mode in ('RowExclusiveLock','RowShareLock'))),'transaction',exists(select 1 from pg_catalog.pg_stat_activity where pid=pg_catalog.pg_backend_pid() and xact_start is not null),'scope',(${scope})) as result;`)
  const make = (label: string, holderSql: string, scope = `exists(select 1 from public.tests where id=${q(target.testId)}::uuid)`, afterSql?: string): Schedule => freeze({
    label, holderSql: bounded(holderSql), observeSql: observe(scope), rejectSql: reject(label), ...(afterSql ? { afterSql: bounded(afterSql) } : {}),
  })
  const testId = `${q(target.testId)}::uuid`; const classId = `${q(test.classroom_id)}::uuid`; const actorId = `${q(target.actorId)}::uuid`
  const schedules: Schedule[] = [
    make('contextual-discard', `select ${call} as result;`, `not exists(select 1 from public.tests where id=${testId})`),
    make('legacy-156-discard', `set local role service_role;select public.discard_pristine_test_draft_atomic(${testId},${actorId},${target.input.expected_draft_version},${q(target.input.expected_test_updated_at)}::timestamptz);reset role;`, `not exists(select 1 from public.tests where id=${testId})`),
    make('test-row', exactOne(`perform id from public.tests where id=${testId} for update nowait`)),
    make('draft-row', exactOne(`perform id from public.assessment_drafts where id=${q(draft.id)}::uuid and assessment_id=${testId} for update nowait`)),
    make('classroom-row', exactOne(`perform id from public.classrooms where id=${classId} and exists(select 1 from public.tests where id=${testId}) for update nowait`)),
    make('archive-revision', exactOne(`perform classroom_id from public.classroom_archive_revisions where classroom_id=${classId} and exists(select 1 from public.tests where id=${testId}) for update nowait`)),
    make('managed-settings', exactOne(`perform singleton from public.managed_storage_settings where singleton and exists(select 1 from public.tests where id=${testId}) for update nowait`)),
    make('actor-row', exactOne(`perform id from public.users where id=${actorId} and exists(select 1 from public.tests where id=${testId}) for update nowait`)),
    make('owner-transfer', exactOne(`update public.classrooms set teacher_id=${q(f.actors[1].id)}::uuid where id=${classId} and teacher_id=${actorId} and exists(select 1 from public.tests where id=${testId})`), `exists(select 1 from public.classrooms where id=${classId} and teacher_id=${q(f.actors[1].id)}::uuid)`),
    make('archive-class', exactOne(`update public.classrooms set archived_at=pg_catalog.clock_timestamp() where id=${classId} and archived_at is null and exists(select 1 from public.tests where id=${testId})`), `exists(select 1 from public.classrooms where id=${classId} and archived_at is not null)`),
    make('test-advisory', `do $holder$ begin if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(${testId}::text,0)) then raise exception 'Test holder unavailable';end if;if not exists(select 1 from public.tests where id=${testId}) then raise exception 'Test holder scope differs';end if;end;$holder$;`),
    make('class-operation-advisory', `do $holder$ begin if not public.classroom_purge_try_lock(${classId}) then raise exception 'Class holder unavailable';end if;if not exists(select 1 from public.tests where id=${testId}) then raise exception 'Class holder scope differs';end if;end;$holder$;`),
    make('membership-operation-advisory', `do $holder$ begin perform private.try_lock_classroom_membership_change(${classId});if not exists(select 1 from public.tests where id=${testId}) then raise exception 'Membership holder scope differs';end if;end;$holder$;`),
    make('direct-fk-child-insert', exactOne(`insert into public.test_focus_events(id,test_id,student_id,session_id,event_type,occurred_at) values(${q(extraAllocatedIds[0])}::uuid,${testId},${q(f.actors[2].id)}::uuid,${q(f.tag + '_race')},'away_start',pg_catalog.clock_timestamp())`), `exists(select 1 from public.test_focus_events where id=${q(extraAllocatedIds[0])}::uuid and test_id=${testId})`),
  ]
  assert.equal(schedules.length, TEST_OWNER_PRISTINE_DISCARD_CONCURRENCY_CAPS.schedules)
  return freeze({ version: 1 as const, sourceFile: SOURCE, fixture: f,
    caps: TEST_OWNER_PRISTINE_DISCARD_CONCURRENCY_CAPS, extraAllocatedIds, begin: beginSql(f), rollback: 'rollback;', schedules,
    limitations: ['legacy no-FK gradebook override writer can insert after discard commit; no orphan-proof claim',
      'managed-resource partial index requires actual planner evidence; catalog shape alone is not a plan claim'],
    evidence: 'Fourteen sealed two-session rollback schedules; no durable deletion, sequence equality, or universal stale-writer claim' })
}
export type TestOwnerPristineDiscardConcurrencyManifest = ReturnType<typeof testOwnerPristineDiscardConcurrencyManifest>

export function validateTestOwnerPristineDiscardConcurrencySql(manifest: TestOwnerPristineDiscardConcurrencyManifest, sql: string) {
  if (Buffer.byteLength(sql) > manifest.caps.sqlBytes) return false
  return [manifest.begin, manifest.rollback, ...manifest.schedules.flatMap(s => [s.holderSql, s.observeSql, s.rejectSql, ...(s.afterSql ? [s.afterSql] : [])])].includes(sql)
}

/** Executes only statements sealed into the source manifest through the
 * caller-owned bounded driver. The driver remains responsible for cancelling
 * and reaping each exact backend before rollbackAndClose resolves. */
export async function runTestOwnerPristineDiscardConcurrency(f: TestOwnerPristineDiscardFixture, target: DraftSaveTarget,
  repository: string, driver: DraftSaveDriver) {
  const started = Date.now()
  validateTestOwnerPristineDiscardTarget(target, f, repository)
  const manifest = testOwnerPristineDiscardConcurrencyManifest(f)
  const manifestSha256 = hash(JSON.stringify(manifest))
  assert.equal(target.acceptedManifestSha256, manifestSha256)
  let dispatches = 0
  const budget = () => {
    const remaining = manifest.caps.totalMs - (Date.now() - started)
    assert(remaining > 0, 'Finite pristine-discard contention budget exhausted')
    return remaining
  }
  async function verify() { budget(); assert.deepEqual(await driver.verifyTarget(), target); budget() }
  async function run(session: DraftSaveSession, sql: string) {
    budget(); assert(++dispatches <= manifest.caps.dispatches, 'Finite pristine-discard dispatch cap exhausted')
    assert(validateTestOwnerPristineDiscardConcurrencySql(manifest, sql), 'Statement differs from accepted pristine-discard manifest')
    await verify()
    const rows = await session.execute(sql, Math.min(manifest.caps.requestMs, budget()))
    budget(); assert(Buffer.byteLength(JSON.stringify(rows)) <= manifest.caps.responseBytes, 'Pristine-discard response cap exhausted')
    return rows
  }
  const outcomes: string[] = []
  for (const schedule of manifest.schedules) {
    let holder: DraftSaveSession | undefined; let contender: DraftSaveSession | undefined; let primary: unknown; let failed = false
    try {
      await verify(); holder = await driver.openSession(`${project(f)}_draft_holder`)
      assert.equal(holder.name, `${project(f)}_draft_holder`); budget()
      await verify(); contender = await driver.openSession(`${project(f)}_draft_contender`)
      assert.equal(contender.name, `${project(f)}_draft_contender`); budget()
      await run(holder, manifest.begin); await run(holder, schedule.holderSql)
      const observed = await run(holder, schedule.observeSql)
      assert.equal(observed.length, 1); assert.deepEqual(observed[0].result, { held: true, transaction: true, scope: true })
      await run(contender, manifest.begin)
      const rejected = await run(contender, schedule.rejectSql)
      assert.equal(rejected.length, 1); assert.deepEqual(rejected[0].result, { rejected: true, code: 'PT409', rows_unchanged: true })
      if (schedule.afterSql) await run(holder, schedule.afterSql)
      outcomes.push(schedule.label)
    } catch (error) { failed = true; primary = error }
    finally {
      const settled = await Promise.allSettled([holder, contender].filter((session): session is DraftSaveSession => Boolean(session))
        .map(session => session.rollbackAndClose(manifest.caps.closeMs)))
      const closeErrors = settled.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
      if (closeErrors.length) throw new AggregateError([...(failed ? [primary] : []), ...closeErrors],
        'Exact pristine-discard session cleanup failed; root must dispose the verified project')
    }
    if (failed) throw primary
  }
  assert.equal(outcomes.length, manifest.caps.schedules)
  return freeze({ kind: 'two-session-pristine-discard-contention' as const, schedules: outcomes, dispatches,
    elapsedMs: Date.now() - started, sourceSha256: target.reviewedSourceSha256, manifestSha256 })
}
