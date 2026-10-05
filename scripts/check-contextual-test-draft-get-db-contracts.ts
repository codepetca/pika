/** SOURCE PREPARATION ONLY. Import is inert; no CLI, SDK, SQL or process execution.
 * Root must first accept the frozen source/request manifest and independently
 * verify a disposable synthetic project. These are rollback-only contracts,
 * never migration application or evidence until an authorized driver runs them. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const DRAFT_GET_CAPS = Object.freeze({ sqlBytes: 256 * 1024, responseBytes: 8 * 1024 * 1024,
  requestMs: 12000, totalMs: 180000, sessionCount: 2, schedules: 12 })
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export const draftGetQuote = (value: string) => `'${value.replaceAll("'", "''")}'`
const q = draftGetQuote

export type DraftGetFixture = Readonly<{
  tag: string; projectId: string; owner: string; outsider: string; student: string;
  classroom: string; otherClassroom: string; missingTest: string; repairTest: string;
  otherTest: string; activeTest: string; repairDraft: string; otherDraft: string;
  activeDraft: string; enrollment: string; question: string; artifact: string;
  bulkQuestionIds: readonly string[]; allowedFixtureIds: readonly string[];
}>
export function newDraftGetFixture(suffix: string): DraftGetFixture {
  assert.match(suffix, /^[a-f0-9]{12}$/)
  const tag = `testdraftget_${suffix}`
  const labels = ['owner','outsider','student','classroom','otherClassroom','missingTest','repairTest','otherTest',
    'activeTest','repairDraft','otherDraft','activeDraft','enrollment','question','artifact'] as const
  const rows = Object.fromEntries(labels.map(label => {
    const hex = hash(`${tag}:${label}`)
    return [label, `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`]
  })) as Record<typeof labels[number], string>
  const bulkQuestionIds = Object.freeze(Array.from({ length: 10001 }, (_, index) => {
    const hex = hash(`${tag}:bulk${index}`)
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`
  }))
  const allowedFixtureIds = Object.freeze([...labels.map(label => rows[label]), ...bulkQuestionIds])
  assert.equal(new Set(allowedFixtureIds).size, labels.length + bulkQuestionIds.length)
  return Object.freeze({ tag, projectId: `pika_assignment_list_${suffix}`, ...rows, bulkQuestionIds, allowedFixtureIds })
}

export type DraftGetTarget = Readonly<{
  projectId: string; apiUrl: string; databaseHost: string; databasePort: number;
  containerId: string; containerProjectLabel: string; disposable: true;
  reviewedHead: string; migrationManifestSha256: string;
  reviewedSourceSha256: string; acceptedManifestSha256: string;
}>
export function draftGetMigrationManifestSha256(repository: string) {
  const directory = resolve(repository, 'supabase/migrations')
  const names = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
  assert.equal(names.length, 247, 'Exact complete schema 001–247 required')
  names.forEach((name, index) => assert(name.startsWith(`${String(index + 1).padStart(3, '0')}_`), 'Migration history differs'))
  return hash(JSON.stringify(names.map(name => ({ name, sha256: hash(readFileSync(resolve(directory, name), 'utf8')) }))))
}
/** Driver must obtain this from live inventory, never configuration alone. */
export function validateDraftGetTarget(target: DraftGetTarget, f: DraftGetFixture, repository: string) {
  assert(Object.isFrozen(target), 'Target inventory must be sealed after independent verification')
  assert.equal(target.projectId, f.projectId)
  assert.equal(target.containerProjectLabel, f.projectId)
  assert.match(target.containerId, /^[a-f0-9]{64}$/)
  assert.equal(target.disposable, true)
  assert.equal(target.apiUrl, 'http://127.0.0.1:54331')
  assert.equal(target.databaseHost, '127.0.0.1')
  assert.equal(target.databasePort, 54332) // canonical local port 54322 is forbidden
  assert.match(target.reviewedHead, /^[a-f0-9]{40}$/)
  assert.equal(target.migrationManifestSha256, draftGetMigrationManifestSha256(repository))
  const source = readFileSync(resolve(repository, 'supabase/migrations/247_contextual_test_draft_owner_get.sql'), 'utf8')
  assert.equal(hash(source), target.reviewedSourceSha256)
  assert.match(target.acceptedManifestSha256, /^[a-f0-9]{64}$/)
  const expected = newDraftGetFixture(f.tag.slice(-12))
  assert.deepEqual(f, expected)
  assert(f.allowedFixtureIds.every(id => UUID.test(id)))
  return target
}

export function draftGetCandidate(f: DraftGetFixture) {
  return Object.freeze({ question_identity_version: 1, title: `${f.tag} baseline`, show_results: true,
    questions: [{ id: f.artifact, question_type: 'open_response', question_text: 'Synthetic question',
      options: [], correct_option: null, answer_key: 'Synthetic answer', sample_solution: null,
      points: 1, response_max_chars: 5000, response_monospace: false }] })
}
export const draftGetJson = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= DRAFT_GET_CAPS.sqlBytes); return sql }

/** Root fixture lifecycle may use this exact setup inside an accepted disposable
 * project. The generator performs no operation. Caller owns whole-project disposal.
 * Contracts below nest it in a rollback transaction, without durable setup. */
export function draftGetFixtureStatements(f: DraftGetFixture) {
  const ids = f.allowedFixtureIds.slice(0, 15).map(q).join(',')
  return bounded(`do $collision$ begin
 if exists(select 1 from public.users where id in (${ids}) or email like ${q(f.tag + '%')})
 or exists(select 1 from public.classrooms where id in (${ids}) or class_code like ${q(f.tag + '%')})
 or exists(select 1 from public.tests where id in (${ids}) or classroom_id in (${ids}))
 or exists(select 1 from public.assessment_drafts where id in (${ids}) or assessment_id in (${ids}))
 or exists(select 1 from public.test_questions where id in (${ids}) or artifact_id in (${ids}) or test_id in (${ids}))
 then raise exception 'Synthetic namespace collision';end if;
end;$collision$;
insert into public.users(id,email,role) values
 (${q(f.owner)},${q(f.tag + '_owner@example.invalid')},'student'),
 (${q(f.outsider)},${q(f.tag + '_outsider@example.invalid')},'teacher'),
 (${q(f.student)},${q(f.tag + '_student@example.invalid')},'student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 (${q(f.classroom)},${q(f.owner)},${q(f.tag)},${q(f.tag + '_a')}),
 (${q(f.otherClassroom)},${q(f.owner)},${q(f.tag)},${q(f.tag + '_b')});
insert into public.classroom_enrollments(id,classroom_id,student_id) values (${q(f.enrollment)},${q(f.classroom)},${q(f.student)});
insert into public.tests(id,classroom_id,created_by,title,status,documents) values
 ${[f.missingTest,f.repairTest,f.otherTest].map(id => `(${q(id)},${q(f.classroom)},${q(f.owner)},${q(f.tag)},'draft','[]'::jsonb)`).join(',')},
 (${q(f.activeTest)},${q(f.classroom)},${q(f.owner)},${q(f.tag)},'active','[]'::jsonb);
insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,answer_key,points,response_max_chars,response_monospace,position)
 values (${q(f.question)},${q(f.artifact)},${q(f.repairTest)},'open_response','Synthetic question','[]'::jsonb,'Synthetic answer',1,5000,false,0);
insert into public.assessment_drafts(id,assessment_type,assessment_id,classroom_id,content,version,created_by,updated_by) values
 (${q(f.repairDraft)},'test',${q(f.repairTest)},${q(f.classroom)},'{"question_identity_version":1}'::jsonb,7,${q(f.outsider)},${q(f.owner)}),
 (${q(f.otherDraft)},'test',${q(f.otherTest)},${q(f.classroom)},${draftGetJson(draftGetCandidate(f))},2,${q(f.owner)},${q(f.owner)}),
 (${q(f.activeDraft)},'test',${q(f.activeTest)},${q(f.classroom)},'{"question_identity_version":1}'::jsonb,3,${q(f.owner)},${q(f.owner)});`)
}

export function draftGetGuardSql(f: DraftGetFixture) {
  return bounded(`do $guard$ begin
 if current_setting('application_name') not in (${q(f.projectId + '_draft_contracts')},${q(f.projectId + '_draft_holder')},${q(f.projectId + '_draft_contender')})
 or current_database()<>'postgres'
 or exists(select 1 from vault.secrets)
 or exists(select 1 from public.test_ai_grading_runs)
 or exists(select 1 from public.test_ai_grading_run_items)
 or coalesce((select enabled from private.pal_membership_settings where singleton),true)
 or coalesce((select enabled from private.pal_classroom_signal_settings where singleton),true)
 or coalesce((select enabled or live_enabled or automatic_enabled from private.student_provider_cleanup_settings where singleton),true)
 or coalesce((select enabled from private.removed_student_academic_settings where singleton),true)
 then raise exception 'Disposable fixture guard differs';end if;
 if to_regprocedure('public.snapshot_test_draft_for_owner_v1(uuid,uuid,timestamp with time zone)') is null
 or to_regprocedure('public.finish_test_draft_get_for_owner_v1(uuid,uuid,uuid,text,text,jsonb,timestamp with time zone)') is null
 then raise exception 'Migration247 required; harness never applies it';end if;
end;$guard$;`)
}

export function draftGetFixturePresenceSql(f: DraftGetFixture) {
  return bounded(`do $fixture$ begin
 if (select count(*) from public.users where id in (${[f.owner,f.outsider,f.student].map(q).join(',')}) and email like ${q(f.tag + '%@example.invalid')})<>3
 or (select count(*) from public.classrooms where id in (${q(f.classroom)},${q(f.otherClassroom)}) and teacher_id=${q(f.owner)} and archived_at is null)<>2
 or (select count(*) from public.tests where id in (${[f.missingTest,f.repairTest,f.otherTest,f.activeTest].map(q).join(',')}) and classroom_id=${q(f.classroom)} and blueprint_archived_at is null)<>4
 or exists(select 1 from public.assessment_drafts where assessment_type='test' and assessment_id=${q(f.missingTest)})
 or not exists(select 1 from public.assessment_drafts where id=${q(f.repairDraft)} and assessment_id=${q(f.repairTest)} and classroom_id=${q(f.classroom)} and version=7 and content='{"question_identity_version":1}'::jsonb and created_by=${q(f.outsider)})
 or not exists(select 1 from public.assessment_drafts where id=${q(f.otherDraft)} and assessment_id=${q(f.otherTest)} and classroom_id=${q(f.classroom)} and version=2)
 or not exists(select 1 from public.assessment_drafts where id=${q(f.activeDraft)} and assessment_id=${q(f.activeTest)} and classroom_id=${q(f.classroom)} and version=3 and content='{"question_identity_version":1}'::jsonb)
 or not exists(select 1 from public.test_questions where id=${q(f.question)} and artifact_id=${q(f.artifact)} and test_id=${q(f.repairTest)})
 then raise exception 'Exact synthetic draft GET fixture differs';end if;
end;$fixture$;`)
}

/** Exact root baseline for pre/post contracts, races and forced cleanup proof.
 * Covers naturally created archive revisions and enrollment side effects. */
export function draftGetFixtureSnapshotSql(f: DraftGetFixture) {
  const actors = [f.owner,f.outsider,f.student].map(q).join(',')
  const classes = [f.classroom,f.otherClassroom].map(q).join(',')
  const tests = [f.missingTest,f.repairTest,f.otherTest,f.activeTest].map(q).join(',')
  const scopes = [
    ['public.users',`id in (${actors})`], ['public.classrooms',`id in (${classes})`],
    ['public.tests',`id in (${tests})`], ['public.test_questions',`test_id in (${tests})`],
    ['public.assessment_drafts',`assessment_type='test' and assessment_id in (${tests})`],
    ['public.classroom_archive_revisions',`classroom_id in (${classes})`],
    ['public.classroom_enrollments',`classroom_id in (${classes})`],
    ['public.test_attempts',`test_id in (${tests})`], ['public.test_responses',`test_id in (${tests})`],
    ['public.managed_storage_objects',`classroom_id in (${classes}) or resource_id in (${tests})`],
    ['public.managed_storage_json_references',`test_id in (${tests})`],
    ['public.pal_event_outbox',`student_id in (${actors})`],
    ['private.pal_membership_outbox',`classroom_id in (${classes}) or student_id in (${actors})`],
    ['private.pal_membership_generations',`generation_id=${q(f.enrollment)} or scope_digest in (${[f.classroom,f.otherClassroom].flatMap(c => [f.owner,f.outsider,f.student].map(a => `private.pal_membership_scope(${q(c)}::uuid,${q(a)}::uuid)`)).join(',')})`],
  ]
  return bounded(`begin read only;set local lock_timeout='1s';set local statement_timeout='8s';${draftGetGuardSql(f)}
select jsonb_build_object(${scopes.map(([table,predicate]) => `${q(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t where ${predicate})`).join(',')}) as result;rollback;`)
}

export function draftGetSnapshotSql(f: DraftGetFixture, testId: string) {
  assert([f.missingTest,f.repairTest,f.otherTest,f.activeTest].includes(testId))
  return `select public.snapshot_test_draft_for_owner_v1(${q(f.owner)},${q(testId)},clock_timestamp()+interval '8 seconds') as result;`
}
export function draftGetFinishSql(f: DraftGetFixture, testId: string, digest: string, operation: 'inspect' | 'create' | 'repair') {
  assert([f.missingTest,f.repairTest,f.otherTest,f.activeTest].includes(testId)); assert.match(digest, /^[a-f0-9]{64}$/)
  return `select public.finish_test_draft_get_for_owner_v1(${q(f.owner)},${q(testId)},${q(f.classroom)},${q(digest)},${q(operation)},${draftGetJson(draftGetCandidate(f))},clock_timestamp()+interval '8 seconds') as result;`
}

export function draftGetContractsSql(f: DraftGetFixture) {
  const content = draftGetJson(draftGetCandidate(f))
  const snapshot = (id: string, actor = f.owner) => `public.snapshot_test_draft_for_owner_v1(${q(actor)},${q(id)},clock_timestamp()+interval '8 seconds')`
  const finish = (id: string, op: string, digest = "s->>'source_sha256'", body = content) => `public.finish_test_draft_get_for_owner_v1(${q(f.owner)},${q(id)},${q(f.classroom)},${digest},${q(op)},${body},clock_timestamp()+interval '8 seconds')`
  return bounded(`begin;set local lock_timeout='1s';set local statement_timeout='30s';
${draftGetGuardSql(f)}
${draftGetFixturePresenceSql(f)}
-- Actual role/capability failures remain raw42501. This grant drift and its
-- restoration exist only in the surrounding rollback transaction.
revoke execute on function public.snapshot_test_draft_for_owner_v1(uuid,uuid,timestamptz) from service_role;
revoke execute on function public.finish_test_draft_get_for_owner_v1(uuid,uuid,uuid,text,text,jsonb,timestamptz) from service_role;
set local role service_role;
do $privilege$ begin
 begin
  perform ${snapshot(f.repairTest)};
  raise exception 'Actual42501 missing for snapshot grant drift';
 exception when sqlstate '42501' then null;end;
 begin
  perform ${finish(f.repairTest,'repair',q('0'.repeat(64)))};
  raise exception 'Actual42501 missing for final grant drift';
 exception when sqlstate '42501' then null;end;
end;$privilege$;
reset role;
grant execute on function public.snapshot_test_draft_for_owner_v1(uuid,uuid,timestamptz) to service_role;
grant execute on function public.finish_test_draft_get_for_owner_v1(uuid,uuid,uuid,text,text,jsonb,timestamptz) to service_role;
-- 045's automatic stamp trigger would overwrite a direct UPDATE. This sealed
-- fixture-only later BEFORE trigger establishes a future invalid preimage.
create function private.proof_draft_get_future_stamp_${f.tag.slice(-12)}() returns trigger language plpgsql set search_path='' as $future$
begin if new.id=${q(f.repairDraft)}::uuid then new.updated_at:=pg_catalog.transaction_timestamp()+interval '1 day';end if;return new;end;$future$;
revoke all on function private.proof_draft_get_future_stamp_${f.tag.slice(-12)}() from public,anon,authenticated,service_role;
create trigger z_proof_draft_get_future_stamp_${f.tag.slice(-12)} before update on public.assessment_drafts
for each row execute function private.proof_draft_get_future_stamp_${f.tag.slice(-12)}();
do $future_contract$ declare s jsonb;b jsonb;c jsonb;a jsonb;original_draft jsonb;original_class jsonb;original_archive jsonb;begin
 select to_jsonb(d) into original_draft from public.assessment_drafts d where id=${q(f.repairDraft)};
 select to_jsonb(classroom) into original_class from public.classrooms classroom where id=${q(f.classroom)};
 select to_jsonb(revision) into original_archive from public.classroom_archive_revisions revision where classroom_id=${q(f.classroom)};
 begin
  update public.assessment_drafts set updated_at=pg_catalog.transaction_timestamp()+interval '1 day' where id=${q(f.repairDraft)};
  drop trigger z_proof_draft_get_future_stamp_${f.tag.slice(-12)} on public.assessment_drafts;
  s:=${snapshot(f.repairTest)};b:=s->'draft';
  if (b->>'updated_at')::timestamptz<=pg_catalog.transaction_timestamp()
   or b->'content'<>'{"question_identity_version":1}'::jsonb then raise exception 'Future prior stamp not established';end if;
  select to_jsonb(classroom) into c from public.classrooms classroom where id=${q(f.classroom)};
  select to_jsonb(revision) into a from public.classroom_archive_revisions revision where classroom_id=${q(f.classroom)};
  begin perform ${finish(f.repairTest,'repair')};raise exception 'Future prior repair stamp accepted';exception when sqlstate 'PT503' then null;end;
  if (select to_jsonb(d) from public.assessment_drafts d where id=${q(f.repairDraft)}) is distinct from b
  or (select to_jsonb(classroom) from public.classrooms classroom where id=${q(f.classroom)}) is distinct from c
  or (select to_jsonb(revision) from public.classroom_archive_revisions revision where classroom_id=${q(f.classroom)}) is distinct from a
  then raise exception 'Future prior stamp leaked draft/Class/revision';end if;
  -- Roll back only the synthetic future-stamp setup after its assertions pass.
  raise exception using errcode='PT499',message='synthetic_future_stamp_fixture_rollback';
 exception when sqlstate 'PT499' then
  if sqlerrm<>'synthetic_future_stamp_fixture_rollback' then raise;end if;
 end;
 if (select to_jsonb(d) from public.assessment_drafts d where id=${q(f.repairDraft)}) is distinct from original_draft
 or (select to_jsonb(classroom) from public.classrooms classroom where id=${q(f.classroom)}) is distinct from original_class
 or (select to_jsonb(revision) from public.classroom_archive_revisions revision where classroom_id=${q(f.classroom)}) is distinct from original_archive
 then raise exception 'Future stamp fixture teardown differs';end if;
end;$future_contract$;
drop trigger z_proof_draft_get_future_stamp_${f.tag.slice(-12)} on public.assessment_drafts;
-- Unrelated object-state faults must be preserved, not reported as owner denial.
create function private.proof_draft_get_object_state_${f.tag.slice(-12)}() returns trigger language plpgsql set search_path='' as $state$
begin if new.id=${q(f.repairDraft)}::uuid then raise exception using errcode='55000',message='synthetic_unrelated_object_state';end if;return new;end;$state$;
revoke all on function private.proof_draft_get_object_state_${f.tag.slice(-12)}() from public,anon,authenticated,service_role;
create trigger z_proof_draft_get_object_state_${f.tag.slice(-12)} after update on public.assessment_drafts
for each row execute function private.proof_draft_get_object_state_${f.tag.slice(-12)}();
do $object_state$ declare s jsonb;b jsonb;c jsonb;a jsonb;begin
 s:=${snapshot(f.repairTest)};b:=s->'draft';
 select to_jsonb(classroom) into c from public.classrooms classroom where id=${q(f.classroom)};
 select to_jsonb(revision) into a from public.classroom_archive_revisions revision where classroom_id=${q(f.classroom)};
 begin
  perform ${finish(f.repairTest,'repair')};raise exception 'Unrelated55000 was remapped or suppressed';
 exception
  when sqlstate '55000' then if sqlerrm<>'synthetic_unrelated_object_state' then raise;end if;
  when sqlstate 'PT403' then raise exception 'Unrelated55000 was remapped';
 end;
 if (select to_jsonb(d) from public.assessment_drafts d where id=${q(f.repairDraft)}) is distinct from b
 or (select to_jsonb(classroom) from public.classrooms classroom where id=${q(f.classroom)}) is distinct from c
 or (select to_jsonb(revision) from public.classroom_archive_revisions revision where classroom_id=${q(f.classroom)}) is distinct from a
 then raise exception 'Unrelated55000 leaked draft/Class/revision';end if;
end;$object_state$;
drop trigger z_proof_draft_get_object_state_${f.tag.slice(-12)} on public.assessment_drafts;
do $contracts$ declare s jsonb;r jsonb;before_row jsonb;bp bigint;ar bigint;n integer;begin
 -- Privileges bind entrypoints and the sealed common helper independently.
 foreach n in array array[1,2] loop
  if exists(select 1 from unnest(array['anon','authenticated']) as roles(role_name) where has_function_privilege(role_name,
   case n when 1 then 'public.snapshot_test_draft_for_owner_v1(uuid,uuid,timestamptz)' else 'public.finish_test_draft_get_for_owner_v1(uuid,uuid,uuid,text,text,jsonb,timestamptz)' end,'execute'))
  then raise exception 'Unexpected public entrypoint privilege';end if;
 end loop;
 if not has_function_privilege('service_role','public.snapshot_test_draft_for_owner_v1(uuid,uuid,timestamptz)','execute')
 or not has_function_privilege('service_role','public.finish_test_draft_get_for_owner_v1(uuid,uuid,uuid,text,text,jsonb,timestamptz)','execute')
 or has_function_privilege('service_role','private.test_draft_owner_source_v1(uuid,uuid,uuid,timestamptz,timestamptz)','execute')
 then raise exception 'Service/private privilege differs';end if;
 begin perform ${snapshot(f.repairTest, f.outsider)};raise exception 'Nonowner accepted';exception when sqlstate 'PT403' then null;end;
 s:=${snapshot(f.missingTest)};
 if s->'draft'<>'null'::jsonb or s->>'question_count'<>'0' then raise exception 'Missing/empty snapshot differs';end if;
 begin perform ${finish(f.missingTest,'inspect')};raise exception 'Inspect absence accepted';exception when sqlstate 'PT409' then null;end;
 begin perform ${finish(f.missingTest,'repair')};raise exception 'Repair absence accepted';exception when sqlstate 'PT409' then null;end;
 select blueprint_source_revision into bp from public.classrooms where id=${q(f.classroom)};
 select revision into ar from public.classroom_archive_revisions where classroom_id=${q(f.classroom)};
 r:=${finish(f.missingTest,'create')};
 if r->'draft'->>'version'<>'1' or r->'draft'->>'created_by'<>${q(f.owner)} or r->'draft'->>'updated_by'<>${q(f.owner)}
 or (select blueprint_source_revision from public.classrooms where id=${q(f.classroom)})<>bp+1
 or (select revision from public.classroom_archive_revisions where classroom_id=${q(f.classroom)})<>ar+2 then raise exception 'Create/revisions differ';end if;
 begin perform ${finish(f.missingTest,'create')};raise exception 'Duplicate create accepted';exception when sqlstate 'PT409' then null;end;
 s:=${snapshot(f.repairTest)};before_row:=s->'draft';
 r:=${finish(f.repairTest,'repair')};
 if r->'draft'->>'version'<>'8' or r->'draft'->>'created_by'<>before_row->>'created_by'
 or r->'draft'->>'created_at'<>before_row->>'created_at' or r->'draft'->>'updated_by'<>${q(f.owner)} then raise exception 'Repair stamps differ';end if;
 s:=${snapshot(f.repairTest)};before_row:=s->'draft';
 select blueprint_source_revision into bp from public.classrooms where id=${q(f.classroom)};
 select revision into ar from public.classroom_archive_revisions where classroom_id=${q(f.classroom)};
 r:=${finish(f.repairTest,'inspect')};
 if (select to_jsonb(d) from public.assessment_drafts d where id=${q(f.repairDraft)})<>before_row
 or (select blueprint_source_revision from public.classrooms where id=${q(f.classroom)})<>bp
 or (select revision from public.classroom_archive_revisions where classroom_id=${q(f.classroom)})<>ar then raise exception 'Inspect mutated rows';end if;
 begin perform ${finish(f.repairTest,'inspect', q('0'.repeat(64)))};raise exception 'Wrong hash accepted';exception when sqlstate 'PT409' then null;end;
 update public.tests set blueprint_archived_at=clock_timestamp() where id=${q(f.repairTest)};
 s:=${snapshot(f.repairTest)};perform ${finish(f.repairTest,'inspect')};
 begin perform ${finish(f.repairTest,'repair')};raise exception 'Retired repair accepted';exception when sqlstate 'PT403' then null;end;
 s:=${snapshot(f.activeTest)};before_row:=s->'draft';r:=${finish(f.activeTest,'inspect')};
 if (select to_jsonb(d) from public.assessment_drafts d where id=${q(f.activeDraft)})<>before_row then raise exception 'Active invalid draft repaired';end if;
 begin perform ${finish(f.activeTest,'repair')};raise exception 'Active repair accepted';exception when sqlstate 'PT409' then null;end;
 update public.assessment_drafts set classroom_id=${q(f.otherClassroom)} where id=${q(f.otherDraft)};
 begin perform ${snapshot(f.otherTest)};raise exception 'Wrong-Class draft accepted';exception when sqlstate 'PT503' then null;end;
 update public.classrooms set archived_at=clock_timestamp() where id=${q(f.classroom)};
 begin perform ${snapshot(f.repairTest)};raise exception 'Archived accepted';exception when sqlstate 'PT403' then null;end;
end;$contracts$;
-- Deliberate fixture-scoped failure injection. DDL and effects are rolled back.
update public.classrooms set archived_at=null where id=${q(f.classroom)};
update public.tests set blueprint_archived_at=null where id=${q(f.repairTest)};
create function private.proof_draft_get_suppress_${f.tag.slice(-12)}() returns trigger language plpgsql set search_path='' as $suppress$
begin if new.id=${q(f.repairDraft)}::uuid then return null;end if;return new;end;$suppress$;
revoke all on function private.proof_draft_get_suppress_${f.tag.slice(-12)}() from public,anon,authenticated,service_role;
create trigger a_proof_draft_get_suppress_${f.tag.slice(-12)} before update on public.assessment_drafts
for each row execute function private.proof_draft_get_suppress_${f.tag.slice(-12)}();
do $suppressed$ declare s jsonb;b jsonb;bp bigint;ar bigint;begin
 s:=${snapshot(f.repairTest)};b:=s->'draft';
 select blueprint_source_revision into bp from public.classrooms where id=${q(f.classroom)};
 select revision into ar from public.classroom_archive_revisions where classroom_id=${q(f.classroom)};
 begin perform ${finish(f.repairTest,'repair')};raise exception 'Suppressed write accepted';exception when sqlstate 'PT503' then null;end;
 if (select to_jsonb(d) from public.assessment_drafts d where id=${q(f.repairDraft)})<>b
 or (select blueprint_source_revision from public.classrooms where id=${q(f.classroom)})<>bp
 or (select revision from public.classroom_archive_revisions where classroom_id=${q(f.classroom)})<>ar
 then raise exception 'Suppressed write leaked effects';end if;
end;$suppressed$;
drop trigger a_proof_draft_get_suppress_${f.tag.slice(-12)} on public.assessment_drafts;
create function private.proof_draft_get_mutate_${f.tag.slice(-12)}() returns trigger language plpgsql set search_path='' as $mutate$
begin if new.id=${q(f.repairDraft)}::uuid then new.created_by:=${q(f.owner)}::uuid;end if;return new;end;$mutate$;
revoke all on function private.proof_draft_get_mutate_${f.tag.slice(-12)}() from public,anon,authenticated,service_role;
create trigger z_proof_draft_get_mutate_${f.tag.slice(-12)} before update on public.assessment_drafts
for each row execute function private.proof_draft_get_mutate_${f.tag.slice(-12)}();
do $postcondition$ declare s jsonb;b jsonb;bp bigint;ar bigint;begin
 s:=${snapshot(f.repairTest)};b:=s->'draft';
 select blueprint_source_revision into bp from public.classrooms where id=${q(f.classroom)};
 select revision into ar from public.classroom_archive_revisions where classroom_id=${q(f.classroom)};
 begin perform ${finish(f.repairTest,'repair')};raise exception 'Posttrigger mutation accepted';exception when sqlstate 'PT503' then null;end;
 if (select to_jsonb(d) from public.assessment_drafts d where id=${q(f.repairDraft)})<>b
 or (select blueprint_source_revision from public.classrooms where id=${q(f.classroom)})<>bp
 or (select revision from public.classroom_archive_revisions where classroom_id=${q(f.classroom)})<>ar
 then raise exception 'Posttrigger failure leaked natural revisions';end if;
end;$postcondition$;
drop trigger z_proof_draft_get_mutate_${f.tag.slice(-12)} on public.assessment_drafts;
-- This new sequence exists only in the outer rollback transaction. nextval's
-- nontransactional increment survives the inner failed RPC savepoint, proving
-- the AFTER target-draft trigger ran before the commit deadline rejected it.
create sequence private.proof_draft_get_deadline_${f.tag.slice(-12)} start with 1 minvalue 1 maxvalue 2 no cycle;
revoke all on sequence private.proof_draft_get_deadline_${f.tag.slice(-12)} from public,anon,authenticated,service_role;
do $sequence$ begin perform pg_catalog.setval('private.proof_draft_get_deadline_${f.tag.slice(-12)}'::regclass,1,true);end;$sequence$;
create function private.proof_draft_get_deadline_${f.tag.slice(-12)}() returns trigger language plpgsql set search_path='' as $delay$
begin
 if new.id=${q(f.repairDraft)}::uuid then
  perform pg_catalog.nextval('private.proof_draft_get_deadline_${f.tag.slice(-12)}'::regclass);
  perform pg_catalog.pg_sleep(0.15);
 end if;return new;
end;$delay$;
revoke all on function private.proof_draft_get_deadline_${f.tag.slice(-12)}() from public,anon,authenticated,service_role;
create trigger z_proof_draft_get_deadline_${f.tag.slice(-12)} after update on public.assessment_drafts
for each row execute function private.proof_draft_get_deadline_${f.tag.slice(-12)}();
do $deadline$ declare s jsonb;b jsonb;c jsonb;a jsonb;deadline timestamptz;marker bigint;begin
 s:=${snapshot(f.repairTest)};b:=s->'draft';
 select to_jsonb(classroom) into c from public.classrooms classroom where id=${q(f.classroom)};
 select to_jsonb(revision) into a from public.classroom_archive_revisions revision where classroom_id=${q(f.classroom)};
 select last_value into marker from private.proof_draft_get_deadline_${f.tag.slice(-12)};
 if marker<>1 then raise exception 'Post-DML instrumentation differs';end if;
 deadline:=clock_timestamp()+interval '100 milliseconds';
 begin
  perform public.finish_test_draft_get_for_owner_v1(${q(f.owner)},${q(f.repairTest)},${q(f.classroom)},s->>'source_sha256','repair',${content},deadline);
  raise exception 'Post-DML deadline accepted';
 exception when sqlstate 'PT503' then null;end;
 select last_value into marker from private.proof_draft_get_deadline_${f.tag.slice(-12)};
 if marker<>2 then raise exception 'Post-DML deadline did not reach trigger';end if;
 if clock_timestamp()<deadline then raise exception 'Post-DML deadline not exhausted';end if;
 if (select to_jsonb(d) from public.assessment_drafts d where id=${q(f.repairDraft)}) is distinct from b
 or (select to_jsonb(classroom) from public.classrooms classroom where id=${q(f.classroom)}) is distinct from c
 or (select to_jsonb(revision) from public.classroom_archive_revisions revision where classroom_id=${q(f.classroom)}) is distinct from a
 then raise exception 'Post-DML deadline leaked draft/Class/revision';end if;
end;$deadline$;
rollback;`)
}

/** Independently bounded rollback phase for source CAS, cache compatibility,
 * 1000+ completeness, exact10000/sentinel10001, raw/candidate UTF-8 limits and
 * full-source rejection before aggregation. Bulk UUIDs are all in the manifest. */
export function draftGetBoundsAndDriftSql(f: DraftGetFixture) {
  const content = draftGetJson(draftGetCandidate(f))
  const snap = (id: string) => `public.snapshot_test_draft_for_owner_v1(${q(f.owner)},${q(id)},clock_timestamp()+interval '8 seconds')`
  const finish = (id: string, op = 'inspect', candidate = content) => `public.finish_test_draft_get_for_owner_v1(${q(f.owner)},${q(id)},${q(f.classroom)},s->>'source_sha256',${q(op)},${candidate},clock_timestamp()+interval '8 seconds')`
  const sourceRaces = [
    { label: 'question_insert', mutation: `insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,points,response_max_chars,response_monospace,position)
values (${q(f.bulkQuestionIds[0])},${q(f.bulkQuestionIds[0])},${q(f.repairTest)},'open_response','Synthetic inserted question','[]'::jsonb,1,5000,false,1);` },
    { label: 'question_delete', mutation: `delete from public.test_questions where id=${q(f.question)} and test_id=${q(f.repairTest)};` },
    { label: 'question_move', mutation: `update public.test_questions set test_id=${q(f.otherTest)} where id=${q(f.question)} and test_id=${q(f.repairTest)};` },
    { label: 'question_reorder', mutation: `update public.test_questions set position=position+1 where id=${q(f.question)} and test_id=${q(f.repairTest)};` },
    { label: 'question_mc_choice', beforeSnapshot: `update public.test_questions set question_type='multiple_choice',options='["A","B"]'::jsonb,correct_option=0,
answer_key=null,sample_solution=null,ai_reference_cache_key=null,ai_reference_cache_answers=null,ai_reference_cache_model=null,ai_reference_cache_generated_at=null
where id=${q(f.question)} and test_id=${q(f.repairTest)};`,
      mutation: `update public.test_questions set options='["Changed A","B"]'::jsonb where id=${q(f.question)} and test_id=${q(f.repairTest)};` },
    { label: 'test_delete', mutation: `delete from public.tests where id=${q(f.repairTest)} and classroom_id=${q(f.classroom)};` },
  ]
  const racesSql = sourceRaces.map(({ label, mutation, beforeSnapshot }) => `
do $${label}$ declare s jsonb;b jsonb;c jsonb;a jsonb;t jsonb;question_before jsonb;begin
 select to_jsonb(d) into b from public.assessment_drafts d where id=${q(f.repairDraft)};
 select to_jsonb(classroom) into c from public.classrooms classroom where id=${q(f.classroom)};
 select to_jsonb(revision) into a from public.classroom_archive_revisions revision where classroom_id=${q(f.classroom)};
 select to_jsonb(test) into t from public.tests test where id=${q(f.repairTest)};
 select to_jsonb(question) into question_before from public.test_questions question where id=${q(f.question)};
 begin
  ${beforeSnapshot ?? ''}
  s:=${snap(f.repairTest)};
  ${mutation}
  perform ${finish(f.repairTest,'repair')};
  raise exception '${label} stale source accepted';
 exception when sqlstate 'PT409' then null;end;
 if (select to_jsonb(d) from public.assessment_drafts d where id=${q(f.repairDraft)}) is distinct from b
 or (select to_jsonb(classroom) from public.classrooms classroom where id=${q(f.classroom)}) is distinct from c
 or (select to_jsonb(revision) from public.classroom_archive_revisions revision where classroom_id=${q(f.classroom)}) is distinct from a
 or (select to_jsonb(test) from public.tests test where id=${q(f.repairTest)}) is distinct from t
 or (select to_jsonb(question) from public.test_questions question where id=${q(f.question)}) is distinct from question_before
 or exists(select 1 from public.test_questions where id=${q(f.bulkQuestionIds[0])})
 then raise exception '${label} rollback differs';end if;
end;$${label}$;`).join('\n')
  return bounded(`begin;set local lock_timeout='1s';set local statement_timeout='30s';
${draftGetGuardSql(f)}
${draftGetFixturePresenceSql(f)}
do $drift$ declare s jsonb;next_s jsonb;b jsonb;candidate jsonb;padding_bytes integer;original_category uuid;begin
 s:=${snap(f.repairTest)};
 update public.test_questions set ai_reference_cache_key='synthetic',ai_reference_cache_answers='["synthetic"]'::jsonb,
 ai_reference_cache_model='synthetic',ai_reference_cache_generated_at=clock_timestamp() where id=${q(f.question)};
 next_s:=${snap(f.repairTest)};
 if s->>'source_sha256'<>next_s->>'source_sha256' then raise exception 'Cache-only digest drift';end if;
 perform ${finish(f.repairTest)};
 s:=${snap(f.repairTest)};
 update public.test_questions set question_text='Changed authored text' where id=${q(f.question)};
 begin perform ${finish(f.repairTest,'repair')};raise exception 'Question drift accepted';exception when sqlstate 'PT409' then null;end;
 s:=${snap(f.repairTest)};
 update public.tests set title='Changed title',show_results=false where id=${q(f.repairTest)};
 begin perform ${finish(f.repairTest,'repair')};raise exception 'Test control drift accepted';exception when sqlstate 'PT409' then null;end;
 s:=${snap(f.repairTest)};
 update public.assessment_drafts set content='{"question_identity_version":1,"title":"changed"}'::jsonb,version=version+1,updated_by=${q(f.outsider)} where id=${q(f.repairDraft)};
 begin perform ${finish(f.repairTest,'repair')};raise exception 'Draft drift accepted';exception when sqlstate 'PT409' then null;end;
 s:=${snap(f.repairTest)};
 update public.classrooms set teacher_id=${q(f.outsider)} where id=${q(f.classroom)};
 begin perform ${finish(f.repairTest,'repair')};raise exception 'Owner loss accepted';exception when sqlstate 'PT403' then null;end;
 update public.classrooms set teacher_id=${q(f.owner)} where id=${q(f.classroom)};
 s:=${snap(f.repairTest)};
 update public.classrooms set archived_at=clock_timestamp() where id=${q(f.classroom)};
 begin perform ${finish(f.repairTest,'repair')};raise exception 'Archive after snapshot accepted';exception when sqlstate 'PT403' then null;end;
 update public.classrooms set archived_at=null where id=${q(f.classroom)};
 s:=${snap(f.repairTest)};
 select gradebook_category_id into original_category from public.tests where id=${q(f.repairTest)};
 update public.tests set classroom_id=${q(f.otherClassroom)},gradebook_category_id=null where id=${q(f.repairTest)};
 begin perform ${finish(f.repairTest,'repair')};raise exception 'Moved Test followed';exception when sqlstate 'PT409' then null;end;
 update public.tests set classroom_id=${q(f.classroom)},gradebook_category_id=original_category where id=${q(f.repairTest)};
 update public.assessment_drafts set version=2147483647 where id=${q(f.repairDraft)};
 s:=${snap(f.repairTest)};
 begin perform ${finish(f.repairTest,'repair')};raise exception 'Integer overflow accepted';exception when sqlstate 'PT503' then null;end;
 update public.assessment_drafts set version=7 where id=${q(f.repairDraft)};
 update public.tests set blueprint_archived_at=clock_timestamp() where id=${q(f.missingTest)};
 s:=${snap(f.missingTest)};
 begin perform ${finish(f.missingTest,'create')};raise exception 'Retired create accepted';exception when sqlstate 'PT403' then null;end;
 update public.tests set blueprint_archived_at=null where id=${q(f.missingTest)};
 -- Exactly2MiB serialized raw JSON, including multibyte UTF-8.
 candidate:=jsonb_build_object('question_identity_version',1,'padding','');
 padding_bytes:=2097152-octet_length(candidate::text);
 candidate:=jsonb_set(candidate,'{padding}',to_jsonb(repeat('é',padding_bytes/2)||repeat('x',padding_bytes%2)));
 if octet_length(candidate::text)<>2097152 then raise exception 'Exact raw UTF-8 fixture differs';end if;
 update public.assessment_drafts set content=candidate where id=${q(f.otherDraft)};
 perform ${snap(f.otherTest)};
 candidate:=jsonb_set(candidate,'{padding}',to_jsonb((candidate->>'padding')||'é'));
 update public.assessment_drafts set content=candidate where id=${q(f.otherDraft)};
 begin perform ${snap(f.otherTest)};raise exception 'Raw UTF-8 limit accepted';exception when sqlstate 'PT503' then null;end;
 s:=${snap(f.repairTest)};candidate:=jsonb_build_object('title',repeat('é',1048576),'show_results',true,'questions','[]'::jsonb);
 begin perform ${finish(f.repairTest,'repair','candidate')};raise exception 'Candidate UTF-8 limit accepted';exception when sqlstate 'PT503' then null;end;
 candidate:=jsonb_build_object('title','Synthetic candidate','show_results',true,'questions',
  (select jsonb_agg('{}'::jsonb) from generate_series(1,10001)));
 begin perform ${finish(f.repairTest,'repair','candidate')};raise exception '10001 candidate accepted';exception when sqlstate 'PT503' then null;end;
 update public.test_questions set question_text=repeat('é',4194304) where id=${q(f.question)};
 begin perform ${snap(f.repairTest)};raise exception 'Full UTF-8 source limit accepted';exception when sqlstate 'PT503' then null;end;
 update public.test_questions set question_text='Synthetic question' where id=${q(f.question)};
 begin perform public.snapshot_test_draft_for_owner_v1(${q(f.owner)},${q(f.repairTest)},clock_timestamp()-interval '1 second');raise exception 'Expired snapshot accepted';exception when sqlstate 'PT503' then null;end;
end;$drift$;
${racesSql}
-- Finite exact UUID derivation equals newDraftGetFixture's frozen allowlist.
insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,points,response_max_chars,response_monospace,position)
select id,id,${q(f.missingTest)},'open_response','Synthetic bulk question','[]'::jsonb,1,5000,false,n
from (select n,(substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid id
 from (select n,encode(extensions.digest(${q(f.tag + ':bulk')}||n::text,'sha256'),'hex') h from generate_series(0,9999) n) hashes) ids;
do $complete$ declare s jsonb;begin
 s:=${snap(f.missingTest)};
 if s->>'question_count'<>'10000' or jsonb_array_length(s->'questions')<>10000
 or s->'questions'->0->>'id'<>${q(f.bulkQuestionIds[0])}
 or s->'questions'->9999->>'id'<>${q(f.bulkQuestionIds[9999])}
 then raise exception 'Complete10000 aggregate differs';end if;
end;$complete$;
insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,points,response_max_chars,response_monospace,position)
 values (${q(f.bulkQuestionIds[10000])},${q(f.bulkQuestionIds[10000])},${q(f.missingTest)},'open_response','Sentinel','[]'::jsonb,1,5000,false,10000);
do $sentinel$ begin
 begin perform ${snap(f.missingTest)};raise exception '10001 truncation accepted';exception when sqlstate 'PT503' then null;end;
end;$sentinel$;
rollback;`)
}

/** Root passes a reviewed finite transport; each SQL dispatch is guarded. No
 * arbitrary SQL argument is exported by the runner and failures close sessions. */
export interface DraftGetSession {
  readonly name: string
  execute(sql: string, timeoutMs: number): Promise<readonly { result?: unknown }[]>
  rollbackAndClose(timeoutMs: number): Promise<void>
}
export interface DraftGetDriver {
  verifyTarget(): Promise<DraftGetTarget>
  openSession(name: string): Promise<DraftGetSession>
}
export function draftGetContractsManifest(f: DraftGetFixture) {
  return Object.freeze({ version: 1, fixture: f, contracts: draftGetContractsSql(f), boundsAndDrift: draftGetBoundsAndDriftSql(f) })
}
export async function runDraftGetContracts(f: DraftGetFixture, target: DraftGetTarget, repository: string, driver: DraftGetDriver) {
  validateDraftGetTarget(target, f, repository)
  const sql = draftGetContractsSql(f)
  const boundsAndDrift = draftGetBoundsAndDriftSql(f)
  assert.equal(target.acceptedManifestSha256, hash(JSON.stringify(draftGetContractsManifest(f))))
  assert.deepEqual(await driver.verifyTarget(), target)
  const session = await driver.openSession(`${f.projectId}_draft_contracts`)
  try {
    assert.equal(session.name, `${f.projectId}_draft_contracts`)
    assert.deepEqual(await driver.verifyTarget(), target)
    await session.execute(sql, 35000)
    assert.deepEqual(await driver.verifyTarget(), target)
    await session.execute(boundsAndDrift, 90000)
  } finally { await session.rollbackAndClose(DRAFT_GET_CAPS.requestMs) }
  return Object.freeze({ kind: 'rollback-contracts', sourceSha256: target.reviewedSourceSha256 })
}
