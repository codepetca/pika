/** Inert, finite migration250 source manifest. Root alone runs these statements
 * through the bounded native engine inside the original disposable lifecycle.
 * Both sessions roll back: this proves rejection, not committed position order. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { draftSaveMigrationManifestSha256, draftSaveQuote as q, draftSaveWholeFingerprintSql,
  type DraftSaveDriver, type DraftSaveSession, type DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'
import { newTestOwnerCreateFixture, type TestOwnerCreateFixture } from './contextual-test-owner-create-proof-fixture'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'

export const TEST_OWNER_CREATE_CONCURRENCY_CAPS = Object.freeze({ totalMs: 180000, dispatches: 180,
  requestMs: 12000, sessions: 2, schedules: 9, sqlBytes: 256 * 1024, responseBytes: 8 * 1024 * 1024 })
const SOURCE = '250_contextual_test_owner_create.sql' as const
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
function assertFrozen(value: unknown) {
  if (value && typeof value === 'object') { assert(Object.isFrozen(value), 'Accepted fixture must be deeply frozen'); for (const child of Object.values(value)) assertFrozen(child) }
}
function validateFixture(f: TestOwnerCreateFixture) {
  assertFrozen(f); assert.match(f.tag, /^testownercreate_[a-f0-9]{12}$/)
  assert(f.forbiddenWitnessIds.length <= 23000)
  const originalIds = f.forbiddenWitnessIds.slice(0, f.forbiddenWitnessIds.length - f.allocatedIds.length)
  assert(originalIds.length <= 20000)
  const original = { manifest: { syntheticTag: `assignmentlist_${f.tag.slice(-12)}`, now: f.now }, allocatedIds: originalIds }
  // Constructor's only inputs are these two fields. Reconstruct rather than
  // trusting an arbitrary frozen object bearing a synthetic-looking tag.
  assert.deepEqual(f, newTestOwnerCreateFixture(original as unknown as Parameters<typeof newTestOwnerCreateFixture>[0]))
}
function project(f: TestOwnerCreateFixture) { return `pika_assignment_list_${f.tag.slice(-12)}` }
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_CREATE_CONCURRENCY_CAPS.sqlBytes); return sql }

/** Inventory must already have been independently obtained by root's engine.
 * This is source/resource validation, never a live verification substitute. */
export function validateOwnerCreateTarget(target: DraftSaveTarget, f: TestOwnerCreateFixture, repository: string) {
  validateFixture(f)
  assert(Object.isFrozen(target), 'Target inventory must be sealed after independent verification')
  assert.equal(target.projectId, project(f)); assert.equal(target.containerProjectLabel, project(f))
  assert.match(target.containerId, /^[a-f0-9]{64}$/); assert.equal(target.disposable, true)
  assert.equal(target.apiUrl, 'http://127.0.0.1:54331'); assert.equal(target.databaseHost, '127.0.0.1'); assert.equal(target.databasePort, 54332)
  assert.match(target.reviewedHead, /^[a-f0-9]{40}$/)
  assert.equal(target.migrationManifestSha256, draftSaveMigrationManifestSha256(repository))
  assert.equal(target.reviewedSourceSha256, hash(readFileSync(resolve(repository, 'supabase/migrations', SOURCE), 'utf8')))
  assert.match(target.acceptedManifestSha256, /^[a-f0-9]{64}$/)
  return target
}

type Schedule = Readonly<{ label: string; holderSql: string; holderWitnessSql?: readonly string[]; observeSql: string; rejectSql: string; afterSql?: string }>
function guard(f: TestOwnerCreateFixture) {
  const p = project(f)
  const prefix = "begin read only;set local lock_timeout='3s';set local statement_timeout='30s';"
  const terminal = "end;$guard$;select 'ok';rollback;"
  const original = testOwnerGuardSql(p)
  assert(original.startsWith(prefix) && original.endsWith(terminal))
  const identity = `current_setting('application_name')<>${q(p + '_fixture')}`
  assert(original.includes(identity))
  // All provider/purge/private control predicates remain inherited verbatim.
  const inherited = original.slice(prefix.length, -terminal.length).replace(identity,
    `current_setting('application_name') not in (${q(p + '_draft_holder')},${q(p + '_draft_contender')})`)
  return bounded(`begin;set local lock_timeout='1s';set local statement_timeout='8s';${inherited}
 if current_database()<>'postgres' or current_user<>'postgres'
 or to_regprocedure('public.create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)') is null
 then raise exception 'Migration250 disposable source differs';end if;
end;$guard$;`)
}
function scopedLock(select: string) {
  return `do $holder$ declare n integer;begin ${select};get diagnostics n=row_count;
 if n<>1 then raise exception 'Exact holder row differs';end if;end;$holder$;`
}
function rowWrite(statement: string) { return scopedLock(statement) }
function observe(table: string, scope: string, mode = 'RowShareLock') {
  // Row locks are not generally exposed as tuple locks in pg_locks. Observe
  // the exact relation lock and transaction, after the sealed scoped statement
  // has asserted one row; do not claim pg_locks identified the physical tuple.
  return `select jsonb_build_object('held',exists(select 1 from pg_locks where pid=pg_backend_pid()
 and granted and relation=${q(table)}::regclass and mode=${q(mode)}),
 'transaction',exists(select 1 from pg_stat_activity where pid=pg_backend_pid() and xact_start is not null),
 'scope',(${scope})) as result;`
}
function rpc(f: TestOwnerCreateFixture, title: string) {
  return `public.create_test_for_owner_v1(${q(f.actors[0].id)},${q(f.classes[0].id)},${q(title)},clock_timestamp()+interval '8 seconds')`
}

export function testOwnerCreateConcurrencyManifest(f: TestOwnerCreateFixture) {
  validateFixture(f)
  const classroom = q(f.classes[0].id); const actor = q(f.actors[0].id)
  const id = (label: string) => { const h = hash(`${f.tag}:${label}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
  const extraAllocatedIds = [id('concurrency-legacy-holder-test'), id('concurrency-legacy-holder-artifact')]
  assert.equal(new Set(extraAllocatedIds).size, 2)
  assert(extraAllocatedIds.every(value => UUID.test(value) && !f.forbiddenWitnessIds.includes(value)))
  const whole = draftSaveWholeFingerprintSql()
  const classScope = `exists(select 1 from public.classrooms where id=${classroom})`
  const categoryScope = `classroom_id=${classroom} order by is_default desc,position,id limit 1`
  const make = (label: string, holderSql: string, observeSql: string, afterSql?: string): Schedule => ({ label,
    holderSql: bounded(holderSql), observeSql: bounded(observeSql), ...(afterSql ? { afterSql: bounded(afterSql) } : {}),
    rejectSql: bounded(`do $race$ declare owner_create_before jsonb;begin owner_create_before:=${whole};
 begin perform ${rpc(f, `${f.tag} rejected ${label}`)};raise exception 'Contender unexpectedly succeeded';
 exception when sqlstate 'PT409' then null;end;
 if owner_create_before is distinct from ${whole} then raise exception 'Rejected CREATE changed table rows';end if;
end;$race$;select jsonb_build_object('rejected',true,'code','PT409','rowsUnchanged',true) as result;`) })
  const legacyTest = q(extraAllocatedIds[0]); const legacyArtifact = q(extraAllocatedIds[1])
  const schedules: Schedule[] = [
    make('contextual_create', `do $holder_create$ declare r jsonb;t public.tests%rowtype;d public.assessment_drafts%rowtype;
 ids uuid[];prior_ids uuid[];begin
 select coalesce(array_agg(previous.id),'{}'::uuid[]) into prior_ids from (
 select id from public.tests where classroom_id in (${f.classes.map(c => q(c.id)).join(',')})
 union all select artifact_id as id from public.tests where classroom_id in (${f.classes.map(c => q(c.id)).join(',')})
 union all select id from public.assessment_drafts where classroom_id in (${f.classes.map(c => q(c.id)).join(',')})
 ) previous;
 if array_length(prior_ids,1)>2050 then raise exception 'Finite committed CREATE identity source differs';end if;
 r:=${rpc(f, `${f.tag} rollback holder`)};
 if jsonb_typeof(r)<>'object' or r->>'version'<>'1' or r->>'actor_id'<>${actor}
 or r->>'classroom_id'<>${classroom} or r->>'test_id'<>r->'test'->>'id'
 then raise exception 'Holder CREATE envelope differs';end if;
 select * into strict t from public.tests where id=(r->>'test_id')::uuid and classroom_id=${classroom} and created_by=${actor};
 select * into strict d from public.assessment_drafts where id=(r->'draft'->>'id')::uuid and assessment_id=t.id
 and assessment_type='test' and classroom_id=${classroom} and created_by=${actor} and updated_by=${actor} and version=1;
 if r->'test' is distinct from to_jsonb(t) or r->'draft' is distinct from to_jsonb(d)
 or d.content is distinct from jsonb_build_object('title',t.title,'show_results',false,'question_identity_version',1,'questions','[]'::jsonb,'source_format','markdown')
 then raise exception 'Holder CREATE pair differs';end if;
 ids:=array[t.id,t.artifact_id,d.id];
 if (select count(distinct x) from unnest(ids) x)<>3 or ids && prior_ids or ids && array[${extraAllocatedIds.map(q).join(',')}]::uuid[]
 then raise exception 'Holder CREATE identity differs';end if;
 perform set_config('pika.proof_test_owner_create_holder_ids',ids::text,true);
end;$holder_create$;`, observe('public.classrooms', classScope, 'RowExclusiveLock')),
    make('owner_transfer', rowWrite(`update public.classrooms set teacher_id=${q(f.actors[1].id)} where id=${classroom} and teacher_id=${actor} and archived_at is null`),
      observe('public.classrooms', `exists(select 1 from public.classrooms where id=${classroom} and teacher_id=${q(f.actors[1].id)})`, 'RowExclusiveLock')),
    make('archive', rowWrite(`update public.classrooms set archived_at=clock_timestamp() where id=${classroom} and teacher_id=${actor} and archived_at is null`),
      observe('public.classrooms', `exists(select 1 from public.classrooms where id=${classroom} and archived_at is not null)`, 'RowExclusiveLock')),
    make('purge_fence', `do $holder$ begin if not public.classroom_purge_try_lock(${classroom}) then raise exception 'Holder fence unavailable';end if;end;$holder$;`,
      `select jsonb_build_object('held',exists(select 1 from pg_locks where pid=pg_backend_pid() and granted and locktype='advisory'
 and mode='ExclusiveLock' and objsubid=1 and database=(select oid from pg_database where datname=current_database())
 and classid::bigint=((hashtextextended('pika-classroom-operation:'||${classroom}::uuid::text,0)>>32)&4294967295::bigint)
 and objid::bigint=(hashtextextended('pika-classroom-operation:'||${classroom}::uuid::text,0)&4294967295::bigint)),
 'transaction',exists(select 1 from pg_stat_activity where pid=pg_backend_pid() and xact_start is not null),'scope',${classScope}) as result;`),
    make('archive_revision', scopedLock(`perform revision from public.classroom_archive_revisions where classroom_id=${classroom} for update nowait`),
      observe('public.classroom_archive_revisions', `exists(select 1 from public.classroom_archive_revisions where classroom_id=${classroom})`),
      rowWrite(`update public.classroom_archive_revisions set revision=revision+1 where classroom_id=${classroom}`)),
    make('category_replacement_row', scopedLock(`perform id from public.gradebook_categories where ${categoryScope} for update nowait`),
      observe('public.gradebook_categories', `exists(select 1 from public.gradebook_categories where classroom_id=${classroom})`),
      rowWrite(`update public.gradebook_categories set default_assessment_weight=default_assessment_weight where id=(select id from public.gradebook_categories where ${categoryScope}) and classroom_id=${classroom}`)),
    make('managed_settings', scopedLock(`perform singleton from public.managed_storage_settings where singleton and ${classScope} for update nowait`),
      observe('public.managed_storage_settings', `exists(select 1 from public.managed_storage_settings where singleton) and ${classScope}`),
      rowWrite(`update public.managed_storage_settings set mode=mode where singleton and ${classScope}`)),
    make('legacy_test_insert', `do $legacy$ declare n integer;begin
 if exists(select 1 from public.tests where id in (${legacyTest},${legacyArtifact}) or artifact_id in (${legacyTest},${legacyArtifact}))
 then raise exception 'Legacy holder identity already exists';end if;
 insert into public.tests(id,artifact_id,classroom_id,created_by,title,position)
 select ${legacyTest},${legacyArtifact},${classroom},${actor},${q(f.tag + ' rollback legacy holder')},coalesce(max(position),-1)+1
 from public.tests where classroom_id=${classroom};get diagnostics n=row_count;
 if n<>1 then raise exception 'Legacy holder insert differs';end if;end;$legacy$;`,
      observe('public.tests', `exists(select 1 from public.tests where id=${legacyTest} and artifact_id=${legacyArtifact} and classroom_id=${classroom} and created_by=${actor})`, 'RowExclusiveLock'),
      rowWrite(`update public.tests set title=title where id=${legacyTest} and classroom_id=${classroom}`)),
    make('actor_row', scopedLock(`perform id from public.users where id=${actor} and ${classScope} for update nowait`),
      observe('public.users', `exists(select 1 from public.users where id=${actor}) and ${classScope}`),
      rowWrite(`update public.users set role=role where id=${actor} and ${classScope}`)),
  ]
  // The original allocated-ID closure can exceed one SQL request. Retain every
  // forbidden identity in finite exact chunks, never a cap exemption or a
  // source/runtime substitution. This local proof-only GUC holds precisely the
  // three returned IDs, resets on rollback, and is not an application bypass.
  const witnessChecks: string[] = []
  for (let offset = 0; offset < f.forbiddenWitnessIds.length; offset += 4000) {
    witnessChecks.push(bounded(`do $holder_ids$ declare ids uuid[];begin
 ids:=current_setting('pika.proof_test_owner_create_holder_ids',true)::uuid[];
 if ids is null or array_length(ids,1)<>3 or (select count(distinct x) from unnest(ids) x)<>3
 or ids && array[${f.forbiddenWitnessIds.slice(offset, offset + 4000).map(q).join(',')}]::uuid[]
 then raise exception 'Holder CREATE forbidden identity';end if;end;$holder_ids$;`))
  }
  assert(witnessChecks.length > 0 && witnessChecks.length <= 6)
  schedules[0] = { ...schedules[0], holderWitnessSql: witnessChecks }
  assert.equal(schedules.length, TEST_OWNER_CREATE_CONCURRENCY_CAPS.schedules)
  return freeze({ version: 1 as const, sourceFile: SOURCE, fixture: f, caps: TEST_OWNER_CREATE_CONCURRENCY_CAPS,
    extraAllocatedIds, begin: guard(f), rollback: 'rollback;', schedules,
    evidence: 'Nine rollback holder/rejected-contender schedules; no durable CREATE position or sequence rollback claim' })
}
export type TestOwnerCreateConcurrencyManifest = ReturnType<typeof testOwnerCreateConcurrencyManifest>

/** No runtime substitutions, arbitrary SQL, public cleanup or discovery. */
export function validateTestOwnerCreateConcurrencySql(manifest: TestOwnerCreateConcurrencyManifest, sql: string) {
  if (Buffer.byteLength(sql) > TEST_OWNER_CREATE_CONCURRENCY_CAPS.sqlBytes) return false
  return [manifest.begin, manifest.rollback, ...manifest.schedules.flatMap(s =>
    [s.holderSql, ...(s.holderWitnessSql ?? []), s.observeSql, s.rejectSql, ...(s.afterSql ? [s.afterSql] : [])])].includes(sql)
}

export async function runTestOwnerCreateConcurrency(f: TestOwnerCreateFixture, target: DraftSaveTarget,
  repository: string, driver: DraftSaveDriver) {
  const started = Date.now()
  validateOwnerCreateTarget(target, f, repository)
  const manifest = testOwnerCreateConcurrencyManifest(f)
  const manifestSha256 = hash(JSON.stringify(manifest))
  assert.equal(target.acceptedManifestSha256, manifestSha256)
  let dispatches = 0
  const budget = () => { const remaining = manifest.caps.totalMs - (Date.now() - started); assert(remaining > 0, 'Finite total harness budget exhausted'); return remaining }
  async function verify() { budget(); assert.deepEqual(await driver.verifyTarget(), target); budget() }
  async function run(session: DraftSaveSession, sql: string) {
    budget(); assert(++dispatches <= manifest.caps.dispatches, 'Finite dispatch cap exhausted')
    assert(validateTestOwnerCreateConcurrencySql(manifest, sql), 'Statement differs from accepted source manifest')
    await verify()
    const rows = await session.execute(sql, Math.min(manifest.caps.requestMs, budget()))
    budget(); assert(Buffer.byteLength(JSON.stringify(rows)) <= manifest.caps.responseBytes, 'Response budget exhausted')
    return rows
  }
  const outcomes: string[] = []
  for (const schedule of manifest.schedules) {
    let holder: DraftSaveSession | undefined; let contender: DraftSaveSession | undefined; let primary: unknown; let failed = false
    try {
      await verify()
      holder = await driver.openSession(`${project(f)}_draft_holder`)
      assert.equal(holder.name, `${project(f)}_draft_holder`); budget()
      await verify()
      contender = await driver.openSession(`${project(f)}_draft_contender`)
      assert.equal(contender.name, `${project(f)}_draft_contender`); budget()
      await run(holder, manifest.begin); await run(holder, schedule.holderSql)
      for (const sql of schedule.holderWitnessSql ?? []) await run(holder, sql)
      const observed = await run(holder, schedule.observeSql)
      assert.equal(observed.length, 1); assert.deepEqual(observed[0].result, { held: true, transaction: true, scope: true })
      await run(contender, manifest.begin)
      const rejected = await run(contender, schedule.rejectSql)
      assert.equal(rejected.length, 1); assert.deepEqual(rejected[0].result, { rejected: true, code: 'PT409', rowsUnchanged: true })
      // Rejected function's exception block released its own acquired locks.
      // Only now may a raw holder progress, before both sessions roll back.
      if (schedule.afterSql) await run(holder, schedule.afterSql)
      outcomes.push(schedule.label)
    } catch (error) { failed = true; primary = error }
    finally {
      // Driver owns cancellation/termination of each exact session. Racing an
      // unresolved execute/open promise would orphan a backend and is forbidden.
      const closed = await Promise.allSettled([holder, contender].filter((s): s is DraftSaveSession => Boolean(s))
        .map(s => s.rollbackAndClose(manifest.caps.requestMs)))
      const errors = closed.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
      if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Exact session cleanup failed; root must dispose verified project')
    }
    if (failed) throw primary
  }
  assert.equal(outcomes.length, manifest.caps.schedules)
  return freeze({ kind: 'two-session-contention' as const, schedules: outcomes, dispatches,
    elapsedMs: Date.now() - started, sourceSha256: target.reviewedSourceSha256, manifestSha256 })
}
