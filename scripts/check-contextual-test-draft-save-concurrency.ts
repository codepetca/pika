/** SOURCE PREPARATION ONLY. Root-invokable two-session real SQL schedules.
 * Import is inert. Root owns independently verified disposable fixture setup and
 * whole-project disposal; every schedule rolls back both sessions. These bounds
 * establish mixed-writer rejection, not universal deadlock-free convergence. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DRAFT_SAVE_CAPS, draftSaveCandidate, draftSaveFinishSql, draftSaveGuardSql, draftSaveJson, draftSaveQuote as q,
  draftSaveSnapshotSql, draftSaveManagedPath, draftSaveManagedDocuments, validateDraftSaveTarget, type DraftSaveDriver, type DraftSaveFixture,
  type DraftSaveSession, type DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'

type Schedule = Readonly<{label:string;testId:string;holderSql:string;operation:'save';afterSql?:string}>
const digest=(text:string)=>createHash('sha256').update(text).digest('hex')
export function draftSaveConcurrencySchedules(f:DraftSaveFixture):readonly Schedule[] {
 const raw=(id:string)=>`update public.assessment_drafts set version=version+1,updated_by=${q(f.owner)} where id=${q(id)};`
 const save=`select public.save_test_draft_atomic(${q(f.owner)},${q(f.repairTest)},7,${draftSaveJson(draftSaveCandidate(f))},false,'[]'::jsonb,'[]'::jsonb);`
 const afterStart=`do $started$ declare s jsonb;r jsonb;c jsonb;begin
 s:=public.snapshot_test_draft_save_for_owner_v1(${q(f.owner)},${q(f.activeTest)},clock_timestamp()+interval '8 seconds');
 if s->'test'->>'questions_locked_at' is null then raise exception 'Actual Start marker missing before snapshot';end if;
 c:=jsonb_set(jsonb_set(${draftSaveJson(draftSaveCandidate(f))},'{title}',s->'test'->'title'),'{show_results}',s->'test'->'show_results');
 r:=public.finish_test_draft_save_for_owner_v1(${q(f.owner)},${q(f.activeTest)},${q(f.classroom)},s->>'source_sha256',3,'save',jsonb_set(c,'{questions,0,question_text}','"Allowed after actual Start"'::jsonb),null,false,clock_timestamp()+interval '8 seconds');
 if r->'editingPolicy'->>'structureLocked'<>'true' or r->'draft'->>'version'<>'4' then raise exception 'After-Start wording save differs';end if;
 s:=public.snapshot_test_draft_save_for_owner_v1(${q(f.owner)},${q(f.activeTest)},clock_timestamp()+interval '8 seconds');
 begin perform public.finish_test_draft_save_for_owner_v1(${q(f.owner)},${q(f.activeTest)},${q(f.classroom)},s->>'source_sha256',4,'save',jsonb_set(r->'draft'->'content','{questions,0,points}','2'::jsonb),null,false,clock_timestamp()+interval '8 seconds');
 raise exception 'Actual Start structural mutation accepted';exception when sqlstate 'PT409' then null;end;
end;$started$;`
 return Object.freeze([
 {label:'contextual_save',testId:f.repairTest,holderSql:'contextual'},
 {label:'contextual_get',testId:f.repairTest,holderSql:`select public.snapshot_test_draft_for_owner_v1(${q(f.owner)},${q(f.repairTest)},clock_timestamp()+interval '8 seconds');`},
 {label:'legacy_same_draft',testId:f.repairTest,holderSql:`select id from public.assessment_drafts where id=${q(f.repairDraft)} for update;`,afterSql:raw(f.repairDraft)},
 {label:'legacy_other_draft_revision',testId:f.repairTest,holderSql:`select id from public.assessment_drafts where id=${q(f.otherDraft)} for update;select revision from public.classroom_archive_revisions where classroom_id=${q(f.classroom)} for update;`,afterSql:raw(f.otherDraft)},
 {label:'legacy_question_tuple',testId:f.activeTest,holderSql:`select id from public.test_questions where id=${q(f.artifact)} for update;`,afterSql:`update public.test_questions set question_text='Synthetic correction' where id=${q(f.artifact)};`},
 {label:'start_before_and_after_snapshot',testId:f.activeTest,holderSql:`set local role service_role;select public.start_test_attempt_revision_atomic(${q(f.activeTest)},${q(f.student)});reset role;`,afterSql:afterStart},
 {label:'legacy_save',testId:f.repairTest,holderSql:`set local role service_role;${save}reset role;`},
 {label:'legacy_publish',testId:f.repairTest,holderSql:`set local role service_role;${save}select public.publish_test_from_draft_atomic(${q(f.owner)},${q(f.repairTest)},8);reset role;`},
 {label:'archive',testId:f.repairTest,holderSql:`update public.classrooms set archived_at=clock_timestamp() where id=${q(f.classroom)};`},
 {label:'owner_transfer',testId:f.repairTest,holderSql:`update public.classrooms set teacher_id=${q(f.outsider)} where id=${q(f.classroom)};`},
 {label:'test_move',testId:f.repairTest,holderSql:`update public.tests set classroom_id=${q(f.otherClassroom)},gradebook_category_id=null where id=${q(f.repairTest)};`},
 {label:'test_delete',testId:f.repairTest,holderSql:`delete from public.tests where id=${q(f.repairTest)};`},
 {label:'purge_fence',testId:f.repairTest,holderSql:`do $fence$ begin if not public.classroom_purge_try_lock(${q(f.classroom)}) then raise exception 'Holder fence unavailable';end if;end;$fence$;`},
 {label:'document_snapshot_sync',testId:f.repairTest,holderSql:`update public.tests set documents=jsonb_set(documents,'{0,synced_at}','"2026-10-05T01:00:00Z"'::jsonb) where id=${q(f.repairTest)};`},
 {label:'document_metadata_save',testId:f.repairTest,holderSql:`select id from public.tests where id=${q(f.repairTest)} for update;update public.tests set title=title||' metadata' where id=${q(f.repairTest)};`},
 {label:'managed_identity_contention',testId:f.repairTest,holderSql:`select id from public.managed_storage_objects where id=${q(f.managedObject)} for update;select public.managed_storage_exact_lock('test-documents',${q(draftSaveManagedPath(f))});`,afterSql:`update public.managed_storage_objects set status=status where id=${q(f.managedObject)};`},
 ].map(row=>Object.freeze({...row,operation:'save' as const})))
}

/** This exact manifest is reviewed before any openSession. Opaque source SHA is
 * the sole runtime substitution, restricted to a snapshot's lowercase64hex.
 * No caller-supplied SQL or actor/Class/resource substitution is accepted. */
export function draftSaveConcurrencyManifest(f: DraftSaveFixture) {
  const schedules = draftSaveConcurrencySchedules(f)
  const begin = `begin;set local lock_timeout='1s';set local statement_timeout='8s';${draftSaveGuardSql(f)}`
  return Object.freeze({ version: 1, fixture: f, begin, rollback: 'rollback;', observe: `select jsonb_build_object('held',exists(select 1 from pg_locks where pid=pg_backend_pid() and granted and (locktype='advisory' or mode in ('RowExclusiveLock','RowShareLock'))),'transaction',exists(select 1 from pg_stat_activity where pid=pg_backend_pid() and xact_start is not null)) as result;`,
    schedules: schedules.map(schedule => ({ ...schedule, snapshotSql: draftSaveSnapshotSql(f, schedule.testId),
      finalTemplate: draftSaveFinishSql(f, schedule.testId, '0'.repeat(64), schedule.operation),
      rejectTemplate: `do $race$ begin perform ${draftSaveFinishSql(f,schedule.testId,'0'.repeat(64)).replace(/^select /,'').replace(/ as result;$/,'')};raise exception 'Contender unexpectedly succeeded';exception when sqlstate 'PT409' then null;end;$race$;` })) })
}

function snapshotSha(rows: readonly { result?: unknown }[], f: DraftSaveFixture, testId: string) {
  assert.equal(rows.length, 1)
  const raw = rows[0].result
  assert(raw && typeof raw === 'object' && !Array.isArray(raw))
  const source = raw as Record<string, unknown>
  assert.equal(source.version, 1); assert.equal(source.actor_id, f.owner)
  const test = source.test as Record<string, unknown>
  const classroom = source.classroom as Record<string, unknown>
  assert.equal(test.id, testId); assert.equal(test.classroom_id, f.classroom)
  assert.equal(classroom.id, f.classroom); assert.equal(classroom.teacher_id, f.owner)
  assert.equal(typeof source.source_sha256, 'string'); assert.match(source.source_sha256 as string, /^[a-f0-9]{64}$/)
  return source.source_sha256 as string
}

export async function runDraftSaveConcurrency(f: DraftSaveFixture, target: DraftSaveTarget, repository: string, driver: DraftSaveDriver) {
  validateDraftSaveTarget(target, f, repository)
  const manifest = draftSaveConcurrencyManifest(f)
  assert.equal(target.acceptedManifestSha256, digest(JSON.stringify(manifest)))
  assert.equal(manifest.schedules.length, DRAFT_SAVE_CAPS.schedules)
  const started = Date.now()
  let dispatches = 0
  async function run(session: DraftSaveSession, sql: string) {
    assert(Date.now() - started < DRAFT_SAVE_CAPS.totalMs, 'Finite total harness budget exhausted')
    assert(++dispatches <= 180, 'Finite dispatch cap exhausted')
    assert(Buffer.byteLength(sql) <= DRAFT_SAVE_CAPS.sqlBytes)
    assert.deepEqual(await driver.verifyTarget(), target)
    return session.execute(sql, DRAFT_SAVE_CAPS.requestMs)
  }
  const outcomes: string[] = []
  for (const schedule of manifest.schedules) {
    let holder: DraftSaveSession | undefined
    let contender: DraftSaveSession | undefined
    const cleanupErrors: unknown[] = []
    try {
      assert.deepEqual(await driver.verifyTarget(), target)
      holder = await driver.openSession(`${f.projectId}_draft_holder`)
      assert.equal(holder.name, `${f.projectId}_draft_holder`)
      contender = await driver.openSession(`${f.projectId}_draft_contender`)
      assert.equal(contender.name, `${f.projectId}_draft_contender`)
      // Snapshot ends its transaction before a different writer holds a lock.
      await run(contender, manifest.begin)
      const sha = snapshotSha(await run(contender, schedule.snapshotSql), f, schedule.testId)
      await run(contender, manifest.rollback)
      await run(holder, manifest.begin)
      if (schedule.holderSql === 'contextual') {
        const holderSha = snapshotSha(await run(holder, schedule.snapshotSql), f, schedule.testId)
        const rows = await run(holder, schedule.finalTemplate.replace(q('0'.repeat(64)), q(holderSha)))
        assert.equal(rows.length, 1)
        const final = rows[0].result as Record<string, unknown>
        assert(final && final.operation === schedule.operation && final.test_id === schedule.testId)
      } else await run(holder, schedule.holderSql)
      const observed = await run(holder, manifest.observe); assert.equal(observed.length,1); assert.deepEqual(observed[0].result,{held:true,transaction:true})
      await run(contender, manifest.begin)
      await run(contender, schedule.rejectTemplate.replace(q('0'.repeat(64)), q(sha)))
      // Raw writer progresses after the rejected contender releases parents.
      if (schedule.afterSql) await run(holder, schedule.afterSql)
      outcomes.push(schedule.label)
    } finally {
      // Always close both, even when one rollback/close fails. Driver must cancel
      // or terminate its exact session on timeout; Promise.race alone is unsafe.
      const results = await Promise.allSettled([holder, contender].filter((s): s is DraftSaveSession => Boolean(s))
        .map(s => s.rollbackAndClose(DRAFT_SAVE_CAPS.requestMs)))
      for (const result of results) if (result.status === 'rejected') cleanupErrors.push(result.reason)
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Exact session cleanup failed; root must dispose verified project')
    }
  }
  return Object.freeze({ kind: 'two-session-contention', schedules: Object.freeze(outcomes), dispatches,
    elapsedMs: Date.now() - started, sourceSha256: target.reviewedSourceSha256 })
}
