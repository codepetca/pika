/** SOURCE PREPARATION ONLY. Root-invokable two-session real SQL schedules.
 * Import is inert. Root owns independently verified disposable fixture setup and
 * whole-project disposal; every schedule rolls back both sessions. These bounds
 * establish mixed-writer rejection, not universal deadlock-free convergence. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DRAFT_GET_CAPS, draftGetCandidate, draftGetFinishSql, draftGetGuardSql, draftGetJson, draftGetQuote as q,
  draftGetSnapshotSql, validateDraftGetTarget, observeDraftGetProof, observeDraftGetProofFailure, type DraftGetDriver, type DraftGetFixture,
  type DraftGetSession, type DraftGetTarget } from './check-contextual-test-draft-get-db-contracts'

type Schedule = Readonly<{ label: string; testId: string; holderSql: string; operation: 'create' | 'repair' | 'inspect'; afterSql?: string }>
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

export function draftGetConcurrencySchedules(f: DraftGetFixture): readonly Schedule[] {
  const rawUpdate = (id: string) => `update public.assessment_drafts set content=${draftGetJson(draftGetCandidate(f))},version=version+1,updated_by=${q(f.owner)} where id=${q(id)};`
  const save = `select public.save_test_draft_atomic(${q(f.owner)},${q(f.repairTest)},7,${draftGetJson(draftGetCandidate(f))},false,'[]'::jsonb,'[]'::jsonb);`
  return Object.freeze([
    { label: 'contextual_create', testId: f.missingTest, operation: 'create', holderSql: 'contextual' },
    { label: 'contextual_repair', testId: f.repairTest, operation: 'repair', holderSql: 'contextual' },
    { label: 'legacy_raw_insert', testId: f.missingTest, operation: 'create',
      holderSql: `insert into public.assessment_drafts(assessment_type,assessment_id,classroom_id,content,version,created_by,updated_by)
values ('test',${q(f.missingTest)},${q(f.classroom)},${draftGetJson(draftGetCandidate(f))},1,${q(f.owner)},${q(f.owner)});` },
    // Decisively pause at the raw writer's pre-trigger tuple/revision order.
    // Continue its real raw UPDATE only after contextual rejection has returned.
    { label: 'legacy_same_draft', testId: f.repairTest, operation: 'repair',
      holderSql: `select id from public.assessment_drafts where id=${q(f.repairDraft)} for update;`, afterSql: rawUpdate(f.repairDraft) },
    { label: 'legacy_other_draft_revision', testId: f.repairTest, operation: 'repair',
      holderSql: `select id from public.assessment_drafts where id=${q(f.otherDraft)} for update;
select revision from public.classroom_archive_revisions where classroom_id=${q(f.classroom)} for update;`, afterSql: rawUpdate(f.otherDraft) },
    { label: 'start', testId: f.activeTest, operation: 'inspect',
      holderSql: `set local role service_role;select public.start_test_attempt_revision_atomic(${q(f.activeTest)},${q(f.student)});reset role;` },
    { label: 'save', testId: f.repairTest, operation: 'repair', holderSql: `set local role service_role;${save}reset role;` },
    { label: 'publish', testId: f.repairTest, operation: 'repair',
      holderSql: `set local role service_role;${save}select public.publish_test_from_draft_atomic(${q(f.owner)},${q(f.repairTest)},8);reset role;` },
    { label: 'archive', testId: f.repairTest, operation: 'repair', holderSql: `update public.classrooms set archived_at=clock_timestamp() where id=${q(f.classroom)};` },
    { label: 'owner_transfer', testId: f.repairTest, operation: 'repair', holderSql: `update public.classrooms set teacher_id=${q(f.outsider)} where id=${q(f.classroom)};` },
    { label: 'test_move', testId: f.repairTest, operation: 'repair', holderSql: `update public.tests set classroom_id=${q(f.otherClassroom)},gradebook_category_id=null where id=${q(f.repairTest)};` },
    { label: 'purge_fence', testId: f.repairTest, operation: 'repair',
      holderSql: `do $fence$ begin if not public.classroom_purge_try_lock(${q(f.classroom)}) then raise exception 'Holder fence unavailable';end if;end;$fence$;` },
  ].map(row => Object.freeze(row as Schedule)))
}

/** This exact manifest is reviewed before any openSession. Opaque source SHA is
 * the sole runtime substitution, restricted to a snapshot's lowercase64hex.
 * No caller-supplied SQL or actor/Class/resource substitution is accepted. */
export function draftGetConcurrencyManifest(f: DraftGetFixture) {
  const schedules = draftGetConcurrencySchedules(f)
  const begin = `begin;set local lock_timeout='1s';set local statement_timeout='8s';${draftGetGuardSql(f)}`
  return Object.freeze({ version: 1, fixture: f, begin, rollback: 'rollback;',
    schedules: schedules.map(schedule => ({ ...schedule, snapshotSql: draftGetSnapshotSql(f, schedule.testId),
      finalTemplate: draftGetFinishSql(f, schedule.testId, '0'.repeat(64), schedule.operation),
      rejectTemplate: `do $race$ begin perform public.finish_test_draft_get_for_owner_v1(${q(f.owner)},${q(schedule.testId)},${q(f.classroom)},${q('0'.repeat(64))},${q(schedule.operation)},${draftGetJson(draftGetCandidate(f))},clock_timestamp()+interval '8 seconds');raise exception 'Contender unexpectedly succeeded';exception when sqlstate 'PT409' then null;end;$race$;` })) })
}

function snapshotSha(rows: readonly { result?: unknown }[], f: DraftGetFixture, testId: string) {
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

export async function runDraftGetConcurrency(f: DraftGetFixture, target: DraftGetTarget, repository: string, driver: DraftGetDriver) {
  validateDraftGetTarget(target, f, repository)
  const manifest = draftGetConcurrencyManifest(f)
  assert.equal(target.acceptedManifestSha256, digest(JSON.stringify(manifest)))
  assert.equal(manifest.schedules.length, DRAFT_GET_CAPS.schedules)
  const started = Date.now()
  let dispatches = 0
  async function run(session: DraftGetSession, sql: string) {
    assert(Date.now() - started < DRAFT_GET_CAPS.totalMs, 'Finite total harness budget exhausted')
    assert(++dispatches <= 120, 'Finite dispatch cap exhausted')
    assert(Buffer.byteLength(sql) <= DRAFT_GET_CAPS.sqlBytes)
    assert.deepEqual(await driver.verifyTarget(), target)
    return session.execute(sql, DRAFT_GET_CAPS.requestMs)
  }
  const outcomes: string[] = []
  for (const [index, schedule] of manifest.schedules.entries()) {
    let holder: DraftGetSession | undefined
    let contender: DraftGetSession | undefined
    const cleanupErrors: unknown[] = []
    try {
      observeDraftGetProof(driver, { event: 'schedule-start', index })
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
      await run(contender, manifest.begin)
      await run(contender, schedule.rejectTemplate.replace(q('0'.repeat(64)), q(sha)))
      await run(contender, manifest.rollback)
      // Raw writer progresses after the rejected contender releases parents.
      if (schedule.afterSql) await run(holder, schedule.afterSql)
      await run(holder, manifest.rollback)
      outcomes.push(schedule.label)
    } catch (error) { observeDraftGetProofFailure(driver, error); throw error
    } finally {
      // Always close both, even when one rollback/close fails. Driver must cancel
      // or terminate its exact session on timeout; Promise.race alone is unsafe.
      const results = await Promise.allSettled([holder, contender].filter((s): s is DraftGetSession => Boolean(s))
        .map(s => s.rollbackAndClose(DRAFT_GET_CAPS.requestMs)))
      for (const result of results) if (result.status === 'rejected') cleanupErrors.push(result.reason)
      observeDraftGetProof(driver, { event: 'schedule-end' })
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Exact session cleanup failed; root must dispose verified project')
    }
  }
  return Object.freeze({ kind: 'two-session-contention', schedules: Object.freeze(outcomes), dispatches,
    elapsedMs: Date.now() - started, sourceSha256: target.reviewedSourceSha256 })
}
