/** SOURCE PREPARATION ONLY. Import is inert; no CLI, SDK, SQL or process execution.
 * Root must first accept the frozen source/request manifest and independently
 * verify a disposable synthetic project. These are rollback-only contracts,
 * never migration application or evidence until an authorized driver runs them. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const DRAFT_SAVE_CAPS = Object.freeze({ sqlBytes: 256 * 1024, responseBytes: 8 * 1024 * 1024,
  requestMs: 12000, totalMs: 180000, sessionCount: 2, schedules: 16 })
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export const draftSaveQuote = (value: string) => `'${value.replaceAll("'", "''")}'`
const q = draftSaveQuote

export type DraftSaveFixture = Readonly<{
  tag: string; projectId: string; owner: string; outsider: string; student: string;
  classroom: string; otherClassroom: string; missingTest: string; repairTest: string;
  otherTest: string; activeTest: string; repairDraft: string; otherDraft: string;
  activeDraft: string; enrollment: string; question: string; artifact: string; managedObject:string;
  bulkQuestionIds: readonly string[]; allowedFixtureIds: readonly string[];
}>
export function newDraftSaveFixture(suffix: string): DraftSaveFixture {
  assert.match(suffix, /^[a-f0-9]{12}$/)
  const tag = `testdraftsave_${suffix}`
  const labels = ['owner','outsider','student','classroom','otherClassroom','missingTest','repairTest','otherTest',
    'activeTest','repairDraft','otherDraft','activeDraft','enrollment','question','artifact','managedObject'] as const
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

export type DraftSaveTarget = Readonly<{
  projectId: string; apiUrl: string; databaseHost: string; databasePort: number;
  containerId: string; containerProjectLabel: string; disposable: true;
  reviewedHead: string; migrationManifestSha256: string;
  reviewedSourceSha256: string; acceptedManifestSha256: string;
}>
export function draftSaveMigrationManifestSha256(repository: string) {
  const directory = resolve(repository, 'supabase/migrations')
  const names = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
  assert(names.length >= 249, 'Complete schema must include the 001–249 baseline')
  names.forEach((name, index) => assert(name.startsWith(`${String(index + 1).padStart(3, '0')}_`), 'Migration history differs'))
  return hash(JSON.stringify(names.map(name => ({ name, sha256: hash(readFileSync(resolve(directory, name), 'utf8')) }))))
}
/** Driver must obtain this from live inventory, never configuration alone. */
export function validateDraftSaveTarget(target: DraftSaveTarget, f: DraftSaveFixture, repository: string) {
  assert(Object.isFrozen(target), 'Target inventory must be sealed after independent verification')
  assert.equal(target.projectId, f.projectId)
  assert.equal(target.containerProjectLabel, f.projectId)
  assert.match(target.containerId, /^[a-f0-9]{64}$/)
  assert.equal(target.disposable, true)
  assert.equal(target.apiUrl, 'http://127.0.0.1:54331')
  assert.equal(target.databaseHost, '127.0.0.1')
  assert.equal(target.databasePort, 54332) // canonical local port 54322 is forbidden
  assert.match(target.reviewedHead, /^[a-f0-9]{40}$/)
  assert.equal(target.migrationManifestSha256, draftSaveMigrationManifestSha256(repository))
  const source = readFileSync(resolve(repository, 'supabase/migrations/249_contextual_test_draft_owner_save.sql'), 'utf8')
  assert.equal(hash(source), target.reviewedSourceSha256)
  assert.match(target.acceptedManifestSha256, /^[a-f0-9]{64}$/)
  const expected = newDraftSaveFixture(f.tag.slice(-12))
  assert.deepEqual(f, expected)
  assert(f.allowedFixtureIds.every(id => UUID.test(id)))
  return target
}

export function draftSaveCandidate(f: DraftSaveFixture) {
  return Object.freeze({ question_identity_version: 1, title: `${f.tag} baseline`, show_results: true,
    questions: [{ id: f.artifact, question_type: 'open_response', question_text: 'Synthetic question',
      options: [], correct_option: null, answer_key: 'Synthetic answer', sample_solution: null,
      points: 1, response_max_chars: 5000, response_monospace: false }] })
}
export const draftSaveJson = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= DRAFT_SAVE_CAPS.sqlBytes); return sql }

/** Root fixture lifecycle may use this exact setup inside an accepted disposable
 * project. The generator performs no operation. Caller owns whole-project disposal.
 * Contracts below nest it in a rollback transaction, without durable setup. */
export function draftSaveFixtureStatements(f: DraftSaveFixture) {
  const ids = f.allowedFixtureIds.slice(0, 16).map(q).join(',')
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
insert into public.managed_storage_objects(id,storage_bucket,storage_path,classroom_id,purpose,status,created_by_user_id,resource_type,resource_id,content_type,byte_size,verified_at)
values (${q(f.managedObject)},'test-documents',${q(draftSaveManagedPath(f))},${q(f.classroom)},'test_execution_snapshot','verified',${q(f.owner)},'test',${q(f.repairTest)},'text/html',4,clock_timestamp());
insert into public.tests(id,classroom_id,created_by,title,status,documents) values
 ${[f.missingTest,f.repairTest,f.otherTest].map(id => `(${q(id)},${q(f.classroom)},${q(f.owner)},${q(f.tag)},'draft',${id===f.repairTest?draftSaveJson(draftSaveManagedDocuments(f)):"'[]'::jsonb"})`).join(',')},
 (${q(f.activeTest)},${q(f.classroom)},${q(f.owner)},${q(f.tag)},'active','[]'::jsonb);
insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,answer_key,points,response_max_chars,response_monospace,position)
 values (${q(f.question)},${q(f.artifact)},${q(f.repairTest)},'open_response','Synthetic question','[]'::jsonb,'Synthetic answer',1,5000,false,0);
insert into public.assessment_drafts(id,assessment_type,assessment_id,classroom_id,content,version,created_by,updated_by) values
 (${q(f.repairDraft)},'test',${q(f.repairTest)},${q(f.classroom)},${draftSaveJson(draftSaveCandidate(f))},7,${q(f.outsider)},${q(f.owner)}),
 (${q(f.otherDraft)},'test',${q(f.otherTest)},${q(f.classroom)},${draftSaveJson(draftSaveCandidate(f))},2,${q(f.owner)},${q(f.owner)}),
 (${q(f.activeDraft)},'test',${q(f.activeTest)},${q(f.classroom)},${draftSaveJson(draftSaveCandidate(f))},3,${q(f.owner)},${q(f.owner)});
insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,answer_key,points,response_max_chars,response_monospace,position)
 values (${q(f.artifact)},${q(f.artifact)},${q(f.activeTest)},'open_response','Synthetic question','[]'::jsonb,'Synthetic answer',1,5000,false,0);`)
}
export function draftSaveManagedPath(f:DraftSaveFixture) {return `link-docs/${f.repairTest}/snapshots/${f.tag}.html`}
export function draftSaveManagedDocuments(f:DraftSaveFixture) {return [{id:'synthetic-link',title:'Synthetic link',source:'link',url:'https://example.invalid/proof',snapshot_path:draftSaveManagedPath(f),snapshot_managed_object_id:f.managedObject,snapshot_content_type:'text/html',synced_at:'2026-10-05T00:00:00Z'}]}

export function draftSaveGuardSql(f: DraftSaveFixture) {
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
 if to_regprocedure('public.snapshot_test_draft_save_for_owner_v1(uuid,uuid,timestamp with time zone)') is null
 or to_regprocedure('public.finish_test_draft_save_for_owner_v1(uuid,uuid,uuid,text,integer,text,jsonb,jsonb,boolean,timestamp with time zone)') is null
 then raise exception 'Migration249 required; harness never applies it';end if;
end;$guard$;`)
}

export function draftSaveFixturePresenceSql(f: DraftSaveFixture) {
  return bounded(`do $fixture$ begin
 if (select count(*) from public.users where id in (${[f.owner,f.outsider,f.student].map(q).join(',')}) and email like ${q(f.tag + '%@example.invalid')})<>3
 or (select count(*) from public.classrooms where id in (${q(f.classroom)},${q(f.otherClassroom)}) and teacher_id=${q(f.owner)} and archived_at is null)<>2
 or (select count(*) from public.tests where id in (${[f.missingTest,f.repairTest,f.otherTest,f.activeTest].map(q).join(',')}) and classroom_id=${q(f.classroom)} and blueprint_archived_at is null)<>4
 or exists(select 1 from public.assessment_drafts where assessment_type='test' and assessment_id=${q(f.missingTest)})
 or not exists(select 1 from public.assessment_drafts where id=${q(f.repairDraft)} and assessment_id=${q(f.repairTest)} and classroom_id=${q(f.classroom)} and version=7 and content=${draftSaveJson(draftSaveCandidate(f))} and created_by=${q(f.outsider)})
 or not exists(select 1 from public.assessment_drafts where id=${q(f.otherDraft)} and assessment_id=${q(f.otherTest)} and classroom_id=${q(f.classroom)} and version=2)
 or not exists(select 1 from public.assessment_drafts where id=${q(f.activeDraft)} and assessment_id=${q(f.activeTest)} and classroom_id=${q(f.classroom)} and version=3)
 or not exists(select 1 from public.test_questions where id=${q(f.question)} and artifact_id=${q(f.artifact)} and test_id=${q(f.repairTest)})
 then raise exception 'Exact synthetic draft save fixture differs';end if;
end;$fixture$;`)
}

/** Exact root baseline for pre/post contracts, races and forced cleanup proof.
 * Covers naturally created archive revisions and enrollment side effects. */
export function draftSaveFixtureSnapshotSql(f: DraftSaveFixture) {
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
    ['public.test_student_availability',`test_id in (${tests})`],
    ['public.test_document_snapshot_storage_cleanup',`storage_path=${q(draftSaveManagedPath(f))}`],
    ['public.managed_storage_objects',`classroom_id in (${classes}) or resource_id in (${tests})`],
    ['public.managed_storage_json_references',`test_id in (${tests})`],
    ['public.pal_event_outbox',`student_id in (${actors})`],
    ['private.pal_membership_outbox',`classroom_id in (${classes}) or student_id in (${actors})`],
    ['private.pal_membership_generations',`generation_id=${q(f.enrollment)} or scope_digest in (${[f.classroom,f.otherClassroom].flatMap(c => [f.owner,f.outsider,f.student].map(a => `private.pal_membership_scope(${q(c)}::uuid,${q(a)}::uuid)`)).join(',')})`],
  ]
  return bounded(`begin read only;set local lock_timeout='1s';set local statement_timeout='8s';${draftSaveGuardSql(f)}
select jsonb_build_object(${scopes.map(([table,predicate]) => `${q(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t where ${predicate})`).join(',')},'__whole_fingerprints',${draftSaveWholeFingerprintSql()}) as result;rollback;`)
}

export function draftSaveSnapshotSql(f: DraftSaveFixture, testId: string) {
  assert([f.missingTest,f.repairTest,f.otherTest,f.activeTest].includes(testId))
  return `select public.snapshot_test_draft_save_for_owner_v1(${q(f.owner)},${q(testId)},clock_timestamp()+interval '8 seconds') as result;`
}

/** Table rows only: inherited managed_storage_writer_revision_seq is a
 * nontransactional invalidation watermark, not rollback-owned application data. */
export function draftSaveWholeFingerprintSql() {
  return `(select coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'fingerprint',
 query_to_xml(format('select count(*) as count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) as digest from %I.%I r',n.nspname,c.relname),true,false,'')::text)
 order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','private','storage'))`
}
export function draftSaveFinishSql(f: DraftSaveFixture, testId: string, digest: string, operation: 'inspect'|'save' = 'save') {
  assert([f.repairTest,f.otherTest,f.activeTest,f.missingTest].includes(testId)); assert.match(digest,/^[a-f0-9]{64}$/)
  const version = testId === f.activeTest ? 3 : testId === f.otherTest ? 2 : testId === f.missingTest ? 'null' : 7
  return `select public.finish_test_draft_save_for_owner_v1(${q(f.owner)},${q(testId)},${q(f.classroom)},${q(digest)},${version},${q(operation)},${testId === f.missingTest ? 'null' : draftSaveJson(draftSaveCandidate(f))},null,false,clock_timestamp()+interval '8 seconds') as result;`
}
function calls(f: DraftSaveFixture) {
  const snapshot = `public.snapshot_test_draft_save_for_owner_v1(${q(f.owner)},${q(f.repairTest)},clock_timestamp()+interval '8 seconds')`
  const finish = (content=draftSaveJson(draftSaveCandidate(f)), sha="s->>'source_sha256'", version='7', deadline="clock_timestamp()+interval '8 seconds'") =>
    `public.finish_test_draft_save_for_owner_v1(${q(f.owner)},${q(f.repairTest)},${q(f.classroom)},${sha},${version},'save',${content},null,false,${deadline})`
  return { snapshot, finish }
}
/** Each rejected call is a nested PostgreSQL subtransaction. Full graph and
 * all public/private/Storage TABLE fingerprints are compared after exceptions. */
export function draftSaveContractsSql(f: DraftSaveFixture) {
  const {snapshot,finish}=calls(f), graph=draftSaveWholeFingerprintSql()
  return bounded(`begin;set local lock_timeout='1s';set local statement_timeout='30s';
${draftSaveGuardSql(f)}${draftSaveFixturePresenceSql(f)}
do $contracts$ declare s jsonb;b jsonb;r jsonb;c jsonb;begin
 b:=${graph};s:=${snapshot};
 begin perform ${finish(undefined, q('0'.repeat(64)))};raise exception 'Stale source accepted';exception when sqlstate 'PT409' then null;end;
 begin perform ${finish(undefined,undefined,'6')};raise exception 'Stale version accepted';exception when sqlstate 'PT409' then null;end;
 begin perform ${finish(undefined,undefined,undefined,"clock_timestamp()-interval '1 second'")};raise exception 'Expired save accepted';exception when sqlstate 'PT503' then null;end;
 begin perform public.snapshot_test_draft_save_for_owner_v1(${q(f.student)},${q(f.repairTest)},clock_timestamp()+interval '8 seconds');raise exception 'Member authoring accepted';exception when sqlstate 'PT403' then null;end;
 if ${graph} is distinct from b then raise exception 'Denied/stale graph or revisions changed';end if;
 begin
 update public.tests set documents=jsonb_set(documents,'{0,synced_at}','"2026-10-05T01:00:00Z"'::jsonb) where id=${q(f.repairTest)};
 c:=${graph};
 begin perform ${finish()};raise exception 'Document snapshot CAS accepted';exception when sqlstate 'PT409' then null;end;
 if ${graph} is distinct from c then raise exception 'Rejected document CAS changed graph';end if;
 raise exception using errcode='PT499',message='sealed_document_fixture_rollback';
 exception when sqlstate 'PT499' then if sqlerrm<>'sealed_document_fixture_rollback' then raise;end if;end;
 if ${graph} is distinct from b then raise exception 'Document CAS fixture rollback changed graph';end if;
 begin
  r:=${finish()};
  if r->>'operation'<>'save' or (r->'draft'->>'version')::integer<>8
   or r->'draft'->'content'<>${draftSaveJson(draftSaveCandidate(f))}
   or r->'draft'->>'created_by'<>${q(f.outsider)} or r->'draft'->>'updated_by'<>${q(f.owner)}
   then raise exception 'Actual save/stamps differ';end if;
  raise exception using errcode='PT499',message='sealed_save_rollback';
 exception when sqlstate 'PT499' then if sqlerrm<>'sealed_save_rollback' then raise;end if;end;
 if ${graph} is distinct from b then raise exception 'Successful save rollback graph differs';end if;
end;$contracts$;
set local role anon;do $anon$ begin begin perform ${snapshot};raise exception 'anon granted';exception when sqlstate '42501' then null;end;end;$anon$;reset role;
set local role authenticated;do $auth$ begin begin perform ${snapshot};raise exception 'authenticated granted';exception when sqlstate '42501' then null;end;end;$auth$;reset role;
do $private$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname like '%test_draft%save%'
 and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
 then raise exception 'Private helper callable';end if;end;$private$;
rollback;`)
}
export function draftSaveBoundsAndDriftSql(f: DraftSaveFixture) {
 const {snapshot,finish}=calls(f), graph=draftSaveWholeFingerprintSql(),suffix=f.tag.slice(-12)
 const checks = [
  ['draft_suppress','assessment_drafts',`if new.id=${q(f.repairDraft)}::uuid then return null;end if;return new;`,'before'],
  ['draft_alter','assessment_drafts',`if new.id=${q(f.repairDraft)}::uuid then new.content:=jsonb_set(new.content,'{title}','"Altered"');end if;return new;`,'before'],
  ['test_alter','tests',`if new.id=${q(f.repairTest)}::uuid then new.show_results:=not new.show_results;end if;return new;`,'before'],
  ['test_suppress','tests',`if new.id=${q(f.repairTest)}::uuid then return null;end if;return new;`,'before'],
  ['question_alter','test_questions',`if new.id=${q(f.artifact)}::uuid then new.question_text:=new.question_text||' altered';end if;return new;`,'before'],
  ['reference_suppress','managed_storage_json_references',`if new.test_id=${q(f.repairTest)}::uuid then return null;end if;return new;`,'before'],
  ['queue_suppress','test_document_snapshot_storage_cleanup',`if new.storage_path=${q(draftSaveManagedPath(f))} then return null;end if;return new;`,'before'],
  ['clock','tests',`if new.id=${q(f.repairTest)}::uuid then perform pg_catalog.nextval('private.proof_save_reached_${suffix}');perform pg_catalog.pg_sleep(2.1);end if;return new;`,'after'],
 ]
 const faults=checks.map(([label,table,body,timing])=>`create function private.proof_save_${label}_${suffix}() returns trigger language plpgsql set search_path='' as $fault$ begin ${body} end;$fault$;
revoke all on function private.proof_save_${label}_${suffix}() from public,anon,authenticated,service_role;
create trigger zzz_proof_save_${label}_${suffix} ${timing} ${['reference_suppress','queue_suppress'].includes(label)?'insert':'update'} on public.${table} for each row execute function private.proof_save_${label}_${suffix}();
do $faultcheck$ declare s jsonb;b jsonb;marker bigint;begin
 b:=${graph};s:=${label==='question_alter'?`public.snapshot_test_draft_save_for_owner_v1(${q(f.owner)},${q(f.activeTest)},clock_timestamp()+interval '8 seconds')`:snapshot};${label==='clock'?`select last_value into marker from private.proof_save_reached_${suffix};`:''}
 begin perform ${label==='question_alter'?draftSaveFinishSql(f,f.activeTest,'0'.repeat(64)).replace(q('0'.repeat(64)),"s->>'source_sha256'").replace(draftSaveJson(draftSaveCandidate(f)),`jsonb_set(${draftSaveJson(draftSaveCandidate(f))},'{questions,0,question_text}','"Intended question correction"'::jsonb)`).replace(/^select /,'').replace(/ as result;$/,''):label==='queue_suppress'?finish().replace('null,false',`${draftSaveJson([{id:'synthetic-link',title:'Synthetic link',source:'link',url:'https://example.invalid/revised'}])},true`):finish(undefined,undefined,undefined,label==='clock'?"clock_timestamp()+interval '2 seconds'":undefined)};
 raise exception 'Post-trigger invalid write accepted';exception when sqlstate 'PT503' then null;end;
 ${label==='clock'?`if (select last_value from private.proof_save_reached_${suffix})<=marker then raise exception 'Deadline trigger never reached';end if;`:''}
 if ${graph} is distinct from b then raise exception 'Post-trigger graph or revisions leaked';end if;end;$faultcheck$;
drop trigger zzz_proof_save_${label}_${suffix} on public.${table};drop function private.proof_save_${label}_${suffix}();`).join('\n')
 return bounded(`begin;set local lock_timeout='1s';set local statement_timeout='30s';${draftSaveGuardSql(f)}${draftSaveFixturePresenceSql(f)}
create sequence private.proof_save_reached_${suffix} start with 1;
revoke all on sequence private.proof_save_reached_${suffix} from public,anon,authenticated,service_role;
do $prime$ begin perform nextval('private.proof_save_reached_${suffix}');end;$prime$;
${faults}
create function private.proof_save_future_${suffix}() returns trigger language plpgsql set search_path='' as $future$ begin if new.id=${q(f.repairDraft)}::uuid then new.updated_at:=clock_timestamp()+interval '1 day';end if;return new;end;$future$;
revoke all on function private.proof_save_future_${suffix}() from public,anon,authenticated,service_role;
create trigger zzz_proof_save_future_${suffix} before update on public.assessment_drafts for each row execute function private.proof_save_future_${suffix}();
do $futurecheck$ declare s jsonb;b jsonb;c jsonb;begin
 b:=${graph};
 begin
 update public.assessment_drafts set updated_by=${q(f.owner)} where id=${q(f.repairDraft)};
 drop trigger zzz_proof_save_future_${suffix} on public.assessment_drafts;
 s:=${snapshot};c:=${graph};
 if (s->'draft'->>'updated_at')::timestamptz<=clock_timestamp() then raise exception 'Future prior stamp never established';end if;
 begin perform ${finish()};raise exception 'Future prior stamp accepted';exception when sqlstate 'PT503' then null;end;
 if ${graph} is distinct from c then raise exception 'Future prior stamp failure changed graph';end if;
 raise exception using errcode='PT499',message='sealed_future_fixture_rollback';
 exception when sqlstate 'PT499' then if sqlerrm<>'sealed_future_fixture_rollback' then raise;end if;end;
 if ${graph} is distinct from b then raise exception 'Future prior fixture rollback changed graph';end if;
end;$futurecheck$;
drop trigger zzz_proof_save_future_${suffix} on public.assessment_drafts;drop function private.proof_save_future_${suffix}();
do $bounds$ declare s jsonb;b jsonb;c jsonb;begin
 b:=${graph};s:=${snapshot};
 begin perform ${finish(`jsonb_set(${draftSaveJson(draftSaveCandidate(f))},'{title}',to_jsonb(repeat('é',2097152)))`)};raise exception 'UTF8 candidate limit accepted';exception when sqlstate 'PT400' then null;when sqlstate 'PT503' then null;end;
 begin perform ${finish(`jsonb_set(${draftSaveJson(draftSaveCandidate(f))},'{questions,0,id}','"bad"'::jsonb)`)};raise exception 'Identity accepted';exception when sqlstate 'PT400' then null;end;
 if ${graph} is distinct from b then raise exception 'Bound failure changed graph';end if;
 begin
 update public.assessment_drafts set version=2147483647 where id=${q(f.repairDraft)};
 s:=${snapshot};c:=${graph};
 begin perform ${finish(undefined,undefined,'2147483647')};raise exception 'Version overflow accepted';exception when sqlstate 'PT503' then null;end;
 if ${graph} is distinct from c then raise exception 'Rejected overflow changed graph';end if;
 raise exception using errcode='PT499',message='sealed_overflow_fixture_rollback';
 exception when sqlstate 'PT499' then if sqlerrm<>'sealed_overflow_fixture_rollback' then raise;end if;end;
 if ${graph} is distinct from b then raise exception 'Overflow fixture rollback changed graph';end if;
end;$bounds$;
insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,points,response_max_chars,response_monospace,position)
select id,id,${q(f.missingTest)},'open_response','Synthetic finite bulk source','[]'::jsonb,1,5000,false,n
from (select n,(substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid id
 from (select n,encode(extensions.digest(${q(f.tag+':bulk')}||n::text,'sha256'),'hex') h from generate_series(0,10000) n) hashes) ids;
do $bulk$ begin
 if (select count(*) from public.test_questions where test_id=${q(f.missingTest)})<>10001 then raise exception 'Finite10001 fixture differs';end if;
 begin perform public.snapshot_test_draft_save_for_owner_v1(${q(f.owner)},${q(f.missingTest)},clock_timestamp()+interval '8 seconds');raise exception '10001 source truncation accepted';exception when sqlstate 'PT503' then null;end;
end;$bulk$;rollback;`)
}
export interface DraftSaveSession { readonly name:string;execute(sql:string,timeoutMs:number):Promise<readonly {result?:unknown}[]>;rollbackAndClose(timeoutMs:number):Promise<void> }
export interface DraftSaveDriver { verifyTarget():Promise<DraftSaveTarget>;openSession(name:string):Promise<DraftSaveSession> }
export function draftSaveContractsManifest(f:DraftSaveFixture) { return Object.freeze({version:1,fixture:f,contracts:draftSaveContractsSql(f),boundsAndDrift:draftSaveBoundsAndDriftSql(f)}) }
export async function runDraftSaveContracts(f:DraftSaveFixture,target:DraftSaveTarget,repository:string,driver:DraftSaveDriver) {
 validateDraftSaveTarget(target,f,repository);const m=draftSaveContractsManifest(f)
 assert.equal(target.acceptedManifestSha256,hash(JSON.stringify(m)));assert.deepEqual(await driver.verifyTarget(),target)
 const session=await driver.openSession(`${f.projectId}_draft_contracts`)
 try { for(const sql of [m.contracts,m.boundsAndDrift]) {assert.deepEqual(await driver.verifyTarget(),target);await session.execute(sql,35000)} }
 finally {await session.rollbackAndClose(DRAFT_SAVE_CAPS.requestMs)}
 return Object.freeze({kind:'rollback-contracts',sourceSha256:target.reviewedSourceSha256})
}
