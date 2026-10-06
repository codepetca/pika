/** Inert rollback-SQL source preparation for migration251. Importing this file
 * performs no IO or database operation. Root must separately accept and run the
 * frozen SQL against its sealed disposable target. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { TestOwnerPristineDiscardFixture } from './contextual-test-pristine-discard-proof-fixture'

export const TEST_OWNER_PRISTINE_DISCARD_DB_CAPS = Object.freeze({ sqlBytes: 256 * 1024, actionMs: 35_000, requestMs: 12_000 })
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const labels = Object.freeze(['catalog-function','catalog-legacy-capability','catalog-triggers','catalog-direct-fks','catalog-managed-index',
  'student-owner','teacher-owner','self-enrolled-owner','later-version-pristine','different-historical-creator','stale-version',
  'stale-test-cas','title-changed','missing-draft','availability-child','retained-override','student-member-denied','teacher-member-denied',
  'unrelated-owner-denied','archived-class-denied','retired-test-denied','missing-test','restored-privilege-success',
  'block-test-questions','block-test-attempts','block-test-responses','block-test-focus-events','block-test-student-availability',
  'block-test-ai-grading-runs','block-test-ai-grading-run-items','block-managed-storage-json-references',
  'block-classroom-guided-draft-provenance','block-gradebook-score-overrides','block-managed-storage-objects',
  'suppress-draft-delete','suppress-test-delete','reinsert-draft-after-delete','reinsert-test-after-delete','wrong-draft-binding',
  'drift-settings','drift-revision','fence-archive-restore','fence-archive-compaction','fence-identity-mapping',
  'fence-classroom-purge-finalize','fence-blueprint-purge-finalize','fence-student-purge-finalize',
  'deadline-after-draft-delete','deadline-after-test-delete','known-classroom-purge-active','known-attendance-decommission-active',
  'known-attendance-decommission-irreversible','known-academic-cleanup-parent-fenced','unknown-55000','raw-42501','plan-fixture',
  'final-fixture-equality','evidence-bound'] as const)
export const TEST_OWNER_PRISTINE_DISCARD_DB_CHECK_LABELS = Object.freeze([...labels.slice(0, -2)].sort())
export const TEST_OWNER_PRISTINE_DISCARD_DB_LIMITATIONS = Object.freeze([
  'legacy no-FK gradebook override writer may insert after commit',
  'managed writer sequence is nontransactional and never compared',
  'real purge, decommission, and provider-bound operation states remain lifecycle-profile obligations',
  'cross-session held-lock rejection remains the sealed concurrency-manifest obligation',
] as const)
export const TEST_OWNER_PRISTINE_DISCARD_FAILURE_LABELS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  labels.map((label, index) => [`PCD${String(index + 1).padStart(2, '0')}`, label]),
))
function failureCode(label: string) { const found = Object.entries(TEST_OWNER_PRISTINE_DISCARD_FAILURE_LABELS).find(([, value]) => value === label); assert(found); return found[0] }
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_PRISTINE_DISCARD_DB_CAPS.sqlBytes, 'Pristine discard SQL exceeds cap'); return sql }
function validateFixture(f: TestOwnerPristineDiscardFixture, projectId: string) {
  assert(Object.isFrozen(f)); assert.equal(f.version, 1); assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  assert.equal(f.tests.length, 1001); assert.equal(f.cases.length, 18); assert.equal(f.privilegeProbes.length, 2)
  assert.equal(new Set(f.allocatedIds).size, f.allocatedIds.length)
}
const triggerPairs = [
  ['tests','assign_test_default_gradebook_category','public','assign_default_gradebook_category',23],
  ['tests','car_tests','public','bump_classroom_archive_revision_from_resource',31],
  ['tests','classroom_purge_fence_tests','public','reject_classroom_resource_change_during_purge',31],
  ['tests','delete_test_gradebook_score_overrides','public','delete_gradebook_overrides_for_assessment',9],
  ['tests','enqueue_obsolete_test_document_snapshots','public','enqueue_obsolete_test_document_snapshots',25],
  ['tests','preserve_test_question_lock','private','preserve_test_question_lock',19],
  ['tests','removed_academic_parent','private','guard_removed_academic_parent',27],
  ['tests','tests_blueprint_purge_lineage_fence','public','guard_course_blueprint_version_lineage_write',31],
  ['tests','tests_managed_storage_remove','public','remove_managed_storage_json_host',11],
  ['tests','tests_managed_storage_sync','public','sync_managed_storage_json_host',21],
  ['tests','touch_classroom_blueprint_source_from_tests_insert_delete','public','touch_classroom_blueprint_source_revision',13],
  ['tests','touch_classroom_blueprint_source_from_tests_update','public','touch_classroom_blueprint_source_revision',17],
  ['tests','update_tests_updated_at','public','update_tests_updated_at',19],
  ['assessment_drafts','car_assessment_drafts','public','bump_classroom_archive_revision_from_resource',31],
  ['assessment_drafts','classroom_purge_fence_assessment_drafts','public','reject_classroom_resource_change_during_purge',31],
  ['assessment_drafts','touch_classroom_blueprint_source_from_drafts','public','touch_classroom_blueprint_source_from_assessment_draft',29],
  ['assessment_drafts','update_assessment_drafts_updated_at','public','update_assessment_drafts_updated_at',19],
] as const
const directFks = ['test_questions_test_id_fkey','test_attempts_test_id_fkey','test_responses_test_id_fkey','test_focus_events_test_id_fkey',
  'test_student_availability_test_id_fkey','test_ai_grading_runs_test_id_fkey','test_ai_grading_run_items_test_id_fkey',
  'managed_storage_json_references_test_id_fkey','classroom_guided_draft_provenance_test_id_fkey'] as const
export const TEST_OWNER_PRISTINE_DISCARD_TEST_COLUMNS = Object.freeze(['id','classroom_id','title','status','show_results','position',
  'points_possible','include_in_final','created_by','created_at','updated_at','documents','artifact_id','source_artifact_id',
  'blueprint_archived_at','source_blueprint_version_id','questions_locked_at','gradebook_category_id','gradebook_weight',
  'gradebook_maximum_override','gradebook_score_scale'] as const)
export const TEST_OWNER_PRISTINE_DISCARD_DRAFT_COLUMNS = Object.freeze(['id','assessment_type','assessment_id','classroom_id','content',
  'version','created_by','updated_by','created_at','updated_at'] as const)

function id(f: TestOwnerPristineDiscardFixture, label: string) {
  const h = hash(`${f.tag}:db-contract:${label}`); const value = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
  assert(!f.allocatedIds.includes(value)); return value
}
export function testOwnerPristineDiscardDbPlanObjectIds(f: TestOwnerPristineDiscardFixture) {
  validateFixture(f, `pika_assignment_list_${f.tag.slice(-12)}`)
  const values = Array.from({ length: 1001 }, (_, index) => id(f, `managed-plan-object:${index}`))
  assert.equal(new Set(values).size, values.length)
  return Object.freeze(values)
}
function targetIds(f: TestOwnerPristineDiscardFixture) { return f.cases.filter(c => c.label !== 'missing-test').map(c => c.testId) }
function snapshotFunction(f: TestOwnerPristineDiscardFixture) {
  const tests = targetIds(f).map(v => `${q(v)}::uuid`).join(','); const classes = f.classes.map(c => `${q(c.id)}::uuid`).join(',')
  const scopes: Array<[string, string]> = [
    ['users', `id=any(array[${f.actors.map(a => `${q(a.id)}::uuid`).join(',')}])`], ['classrooms', `id=any(array[${classes}])`],
    ['classroom_archive_revisions', `classroom_id=any(array[${classes}])`], ['tests', `id=any(array[${tests}])`],
    ['assessment_drafts', `assessment_type='test' and assessment_id=any(array[${tests}])`],
    ['test_questions', `test_id=any(array[${tests}])`], ['test_attempts', `test_id=any(array[${tests}])`],
    ['test_responses', `test_id=any(array[${tests}])`], ['test_focus_events', `test_id=any(array[${tests}])`],
    ['test_student_availability', `test_id=any(array[${tests}])`], ['test_ai_grading_runs', `test_id=any(array[${tests}])`],
    ['test_ai_grading_run_items', `test_id=any(array[${tests}])`], ['managed_storage_json_references', `test_id=any(array[${tests}])`],
    ['classroom_guided_draft_provenance', `test_id=any(array[${tests}]) or classroom_id=any(array[${classes}])`],
    ['gradebook_categories', `classroom_id=any(array[${classes}])`],
    ['gradebook_score_overrides', `classroom_id=any(array[${classes}]) or (assessment_type='test' and assessment_id=any(array[${tests}]))`],
    ['managed_storage_objects', `classroom_id=any(array[${classes}]) or (resource_type='test' and resource_id=any(array[${tests}]))`],
    ['classroom_retired_assessment_records', `classroom_id=any(array[${classes}]) or source_row_id=any(array[${tests}])`],
    ['course_blueprint_versions', `id in (select source_blueprint_version_id from public.tests where id=any(array[${tests}]) and source_blueprint_version_id is not null)`],
  ]
  return `create function pg_temp.owner_discard_snapshot() returns jsonb language sql stable set search_path='' as $snapshot$
 select pg_catalog.jsonb_build_object(${scopes.map(([table, predicate]) => `${q(table)},(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text),'[]'::jsonb) from public.${table} r where ${predicate})`).join(',')},
 'managed_storage_settings',(select pg_catalog.to_jsonb(s) from public.managed_storage_settings s where singleton),
 'test_document_snapshot_storage_cleanup',(select pg_catalog.jsonb_build_object('count',count(*),'digest',pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(q)::text),'' order by pg_catalog.md5(pg_catalog.to_jsonb(q)::text)),''))) from public.test_document_snapshot_storage_cleanup q))$snapshot$;`
}
function note(label: string) { return `perform pg_temp.owner_discard_note(${q(label)},true,'00000');` }
function closedProbe(label: string, body: string) {
  return `do $probe$ declare baseline jsonb;begin baseline:=pg_temp.owner_discard_snapshot();
 begin ${body} raise exception using errcode='PT499',message=${q(`owner_discard_probe:${label}`)};
 exception when sqlstate 'PT499' then if sqlerrm<>${q(`owner_discard_probe:${label}`)} then raise;end if;end;
 if pg_temp.owner_discard_snapshot() is distinct from baseline then raise exception 'Rollback scope differs: ${label}';end if;${note(label)}
 exception when others then raise exception using errcode=${q(failureCode(label))},message='Closed pristine-discard proof failure';end;$probe$;`
}
function rpc(caseRow: TestOwnerPristineDiscardFixture['cases'][number], deadline = "pg_catalog.clock_timestamp()+interval '8 seconds'") {
  return `public.discard_pristine_test_draft_for_owner_v1(${q(caseRow.actorId)}::uuid,${q(caseRow.testId)}::uuid,${caseRow.input.expected_draft_version},${q(caseRow.input.expected_test_updated_at)}::timestamptz,${deadline})`
}
function caseProbe(f: TestOwnerPristineDiscardFixture, c: TestOwnerPristineDiscardFixture['cases'][number]) {
  const test = f.tests.find(row => row.id === c.testId); const draft = f.drafts.find(row => row.assessment_id === c.testId)
  if (c.expectedHTTP !== 200) {
    const expected = c.expectedHTTP === 403 ? 'PT403' : c.expectedHTTP === 404 ? 'PT404' : 'PT503'
    return closedProbe(c.label, `declare code text;begin perform ${rpc(c)};raise exception 'Denied case succeeded';exception when others then get stacked diagnostics code=returned_sqlstate;if code<>${q(expected)} then raise exception 'Denied code differs';end if;end;`)
  }
  assert(test)
  const expectedDiscarded = c.expectedDiscarded === true
  const body = `declare r jsonb;test_before public.tests;draft_before public.assessment_drafts;class_before public.classrooms;class_after public.classrooms;archive_before public.classroom_archive_revisions;archive_after public.classroom_archive_revisions;settings_before jsonb;categories_before jsonb;begin
 select * into strict test_before from public.tests where id=${q(c.testId)}::uuid;
 select * into draft_before from public.assessment_drafts where assessment_type='test' and assessment_id=${q(c.testId)}::uuid;
 select * into strict class_before from public.classrooms where id=test_before.classroom_id;
 select * into strict archive_before from public.classroom_archive_revisions where classroom_id=test_before.classroom_id;
 select pg_catalog.to_jsonb(s) into strict settings_before from public.managed_storage_settings s where singleton;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(category) order by pg_catalog.to_jsonb(category)::text),'[]'::jsonb) into strict categories_before from public.gradebook_categories category where classroom_id=test_before.classroom_id;
 r:=${rpc(c)};
 if (select count(*) from pg_catalog.jsonb_object_keys(r))<>${expectedDiscarded ? 7 : 8}
 or r->>'version' is distinct from '1' or r->>'actor_id' is distinct from ${q(c.actorId)} or r->>'test_id' is distinct from ${q(c.testId)}
 or r->'classroom' is distinct from pg_catalog.jsonb_build_object('id',test_before.classroom_id,'teacher_id',${q(c.actorId)}::uuid,'archived_at',null)
 or r->'test' is distinct from pg_catalog.to_jsonb(test_before) or r->'draft' is distinct from ${draft ? 'pg_catalog.to_jsonb(draft_before)' : "'null'::jsonb"}
 or r->>'discarded' is distinct from ${q(String(expectedDiscarded))}${expectedDiscarded ? '' : " or r->>'reason' is distinct from 'draft_changed'"}
 then raise exception 'Private discard envelope differs';end if;
 ${expectedDiscarded ? `if exists(select 1 from public.tests where id=test_before.id) or exists(select 1 from public.assessment_drafts where id=draft_before.id or (assessment_type='test' and assessment_id=test_before.id)) then raise exception 'Discarded pair survived';end if;
 select * into strict class_after from public.classrooms where id=test_before.classroom_id;
 select * into strict archive_after from public.classroom_archive_revisions where classroom_id=test_before.classroom_id;
 if pg_catalog.to_jsonb(class_after) is distinct from pg_catalog.to_jsonb(class_before)||pg_catalog.jsonb_build_object('blueprint_source_revision',class_before.blueprint_source_revision+2,'updated_at',pg_catalog.transaction_timestamp())
 or pg_catalog.to_jsonb(archive_after) is distinct from pg_catalog.to_jsonb(archive_before)||pg_catalog.jsonb_build_object('revision',archive_before.revision + 4,'updated_at',pg_catalog.transaction_timestamp())
 or (select pg_catalog.to_jsonb(s) from public.managed_storage_settings s where singleton) is distinct from settings_before then raise exception 'Successful discard effects differ';end if;`
    + `if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(category) order by pg_catalog.to_jsonb(category)::text),'[]'::jsonb) from public.gradebook_categories category where classroom_id=test_before.classroom_id) is distinct from categories_before then raise exception 'Successful discard category effects differ';end if;`
    : `if pg_temp.owner_discard_snapshot() is distinct from baseline then raise exception 'False discard changed rows';end if;`}
 end;`
  return closedProbe(c.label, body)
}
function catalogProbe() {
  const triggers = `values ${triggerPairs.map(([table,name,schema,fn,type]) => `(${q(table)},${q(name)},${q(schema)},${q(fn)},${type})`).join(',')}`
  const fks = `values ${directFks.map(name => `(${q(name)})`).join(',')}`
  const functionBody = `declare p pg_proc;actual text[];begin select proc.* into p from pg_proc proc where proc.oid='public.discard_pristine_test_draft_for_owner_v1(uuid,uuid,integer,timestamp with time zone,timestamp with time zone)'::regprocedure;
 if not found or p.proowner::regrole::text<>'postgres' or not p.prosecdef or p.prorettype::regtype::text<>'jsonb' or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.proconfig is null or pg_catalog.cardinality(p.proconfig)<>2
 or not p.proconfig @> array['search_path=""','lock_timeout=1s'] or pg_catalog.has_function_privilege('anon',p.oid,'execute')
 or pg_catalog.has_function_privilege('authenticated',p.oid,'execute') or not pg_catalog.has_function_privilege('service_role',p.oid,'execute')
 or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl where acl.privilege_type='EXECUTE' and acl.grantee not in (p.proowner,'service_role'::regrole))
 then raise exception 'Contextual discard function catalog differs';end if;
 select pg_catalog.array_agg(a.attname::text order by a.attnum) into actual from pg_attribute a where a.attrelid='public.tests'::regclass and a.attnum>0 and not a.attisdropped;
 if actual is distinct from array[${TEST_OWNER_PRISTINE_DISCARD_TEST_COLUMNS.map(q).join(',')}]::text[] then raise exception 'Exact21 Test columns differ';end if;
 select pg_catalog.array_agg(a.attname::text order by a.attnum) into actual from pg_attribute a where a.attrelid='public.assessment_drafts'::regclass and a.attnum>0 and not a.attisdropped;
 if actual is distinct from array[${TEST_OWNER_PRISTINE_DISCARD_DRAFT_COLUMNS.map(q).join(',')}]::text[] then raise exception 'Exact10 draft columns differ';end if;end;`
  const legacyBody = `begin if not pg_catalog.has_function_privilege('service_role','public.discard_pristine_test_draft_atomic(uuid,uuid,integer,timestamp with time zone)','EXECUTE')
 or pg_catalog.has_function_privilege('anon','public.discard_pristine_test_draft_atomic(uuid,uuid,integer,timestamp with time zone)','EXECUTE')
 or pg_catalog.has_function_privilege('authenticated','public.discard_pristine_test_draft_atomic(uuid,uuid,integer,timestamp with time zone)','EXECUTE') then raise exception 'Legacy discard capability differs';end if;end;`
  const triggerBody = `declare bad integer;begin select count(*) into bad from (((select c.relname::text,t.tgname::text,nf.nspname::text,p.proname::text,t.tgtype::integer from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace nf on nf.oid=p.pronamespace where n.nspname='public' and c.relname in ('tests','assessment_drafts') and not t.tgisinternal) except (select * from (${triggers}) expected(table_name,trigger_name,function_schema,function_name,trigger_type))) union all ((select * from (${triggers}) expected(table_name,trigger_name,function_schema,function_name,trigger_type)) except (select c.relname::text,t.tgname::text,nf.nspname::text,p.proname::text,t.tgtype::integer from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace nf on nf.oid=p.pronamespace where n.nspname='public' and c.relname in ('tests','assessment_drafts') and not t.tgisinternal))) delta;
 if bad<>0 or exists(select 1 from pg_trigger where tgrelid in ('public.tests'::regclass,'public.assessment_drafts'::regclass) and not tgisinternal and (tgenabled<>'O' or tgdeferrable or tginitdeferred)) then raise exception 'Exact17 trigger closure differs';end if;end;`
  const fkBody = `declare bad integer;begin select count(*) into bad from (((select c.conname::text from pg_constraint c where c.confrelid='public.tests'::regclass and c.contype='f') except (select * from (${fks}) expected(name))) union all ((select * from (${fks}) expected(name)) except (select c.conname::text from pg_constraint c where c.confrelid='public.tests'::regclass and c.contype='f'))) delta;
 if bad<>0 or exists(select 1 from pg_constraint c where c.confrelid='public.tests'::regclass and c.contype='f' and (not (c.confdeltype='c') or c.condeferrable or c.condeferred))
 or exists(select 1 from pg_constraint c where c.conrelid='public.assessment_drafts'::regclass and c.confrelid='public.tests'::regclass) then raise exception 'Exact direct Test FK actions differ; confdeltype=''c'' required';end if;end;`
  const indexBody = `declare i pg_index;predicate text;method text;begin select x.* into i from pg_index x where x.indexrelid='public.idx_managed_storage_test_resource_owner_discard'::regclass;if not found then raise exception 'Managed Test resource partial btree index missing';end if;
 select am.amname into strict method from pg_class c join pg_am am on am.oid=c.relam where c.oid=i.indexrelid;predicate:=pg_catalog.pg_get_expr(i.indpred,i.indrelid);
 if i.indisunique or not i.indisvalid or not i.indisready or i.indnkeyatts<>1 or i.indnatts<>1 or i.indexprs is not null
 or method<>'btree' or pg_catalog.pg_get_indexdef(i.indexrelid,1,true)<>'resource_id' or predicate not in ('(resource_type = ''test''::text)','resource_type = ''test''::text') then raise exception 'Managed Test resource partial btree index differs';end if;end;`
  return [['catalog-function',functionBody],['catalog-legacy-capability',legacyBody],['catalog-triggers',triggerBody],['catalog-direct-fks',fkBody],['catalog-managed-index',indexBody]]
    .map(([label, body]) => closedProbe(label, body)).join('\n')
}
function insertBlocker(f: TestOwnerPristineDiscardFixture, label: string, testId: string, actor: string, classId: string) {
  const uid = (part: string) => q(id(f, `${label}:${part}`)); const question = uid('question'); const response = uid('response'); const run = uid('run'); const object = uid('object')
  const inserts: Record<string, string> = {
    'block-test-questions': `insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,correct_option,points,position) values(${uid('row')},${uid('artifact')},${q(testId)},'open_response','proof','[]',null,1,0);`,
    'block-test-attempts': `insert into public.test_attempts(id,test_id,student_id) values(${uid('row')},${q(testId)},${q(f.actors[2].id)});`,
    'block-test-responses': `insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,correct_option,points,position) values(${question},${uid('artifact')},${q(testId)},'open_response','proof','[]',null,1,0);insert into public.test_responses(id,test_id,question_id,student_id,response_text) values(${uid('row')},${q(testId)},${question},${q(f.actors[2].id)},'proof');`,
    'block-test-focus-events': `insert into public.test_focus_events(id,test_id,student_id,session_id,event_type) values(${uid('row')},${q(testId)},${q(f.actors[2].id)},${q(f.tag + '_proof')},'away_start');`,
    'block-test-student-availability': `insert into public.test_student_availability(id,test_id,student_id,state,updated_by) values(${uid('row')},${q(testId)},${q(f.actors[2].id)},'closed',${q(actor)});`,
    'block-test-ai-grading-runs': `insert into public.test_ai_grading_runs(id,test_id,status,triggered_by,selection_hash) values(${uid('row')},${q(testId)},'completed',${q(actor)},${q('a'.repeat(64))});`,
    'block-test-ai-grading-run-items': `insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,correct_option,points,position) values(${question},${uid('artifact')},${q(testId)},'open_response','proof','[]',null,1,0);insert into public.test_responses(id,test_id,question_id,student_id,response_text) values(${response},${q(testId)},${question},${q(f.actors[2].id)},'proof');insert into public.test_ai_grading_runs(id,test_id,status,triggered_by,selection_hash) values(${run},${q(testId)},'completed',${q(actor)},${q('b'.repeat(64))});insert into public.test_ai_grading_run_items(id,run_id,test_id,student_id,question_id,response_id,response_revision,question_grading_snapshot,status) values(${uid('row')},${run},${q(testId)},${q(f.actors[2].id)},${question},${response},1,null,'completed');`,
    'block-managed-storage-json-references': `insert into public.managed_storage_objects(id,storage_bucket,storage_path,classroom_id,purpose,status,created_by_user_id,resource_type,resource_id) values(${object},'test-documents',${q(f.tag + '/' + label)},${q(classId)},'teacher_test_material','reserved',${q(actor)},'proof-host',${uid('unrelated')});insert into public.managed_storage_json_references(id,managed_object_id,storage_bucket,storage_path,test_id,reference_role,evidence_sha256) values(${uid('row')},${object},'test-documents',${q(f.tag + '/' + label)},${q(testId)},'teacher_document',${q('c'.repeat(64))});`,
    'block-classroom-guided-draft-provenance': `insert into public.classroom_guided_draft_provenance(id,draft_id,classroom_id,test_id,source_blueprint_version_id,source_blueprint_version_number,source_draft_revision,rules_markdown,seed_sha256,created_content_sha256,created_by) values(${uid('row')},${uid('draft')},${q(f.classes[1].id)},${q(testId)},${uid('version')},1,1,'proof',${q('d'.repeat(64))},${q('e'.repeat(64))},${q(actor)});`,
    'block-gradebook-score-overrides': `insert into public.gradebook_score_overrides(id,classroom_id,student_id,assessment_type,assessment_id,earned,created_by) values(${uid('row')},${q(classId)},${q(f.actors[1].id)},'test',${q(testId)},0,${q(actor)});`,
    'block-managed-storage-objects': `insert into public.managed_storage_objects(id,storage_bucket,storage_path,classroom_id,purpose,status,created_by_user_id,resource_type,resource_id) values(${uid('row')},'test-documents',${q(f.tag + '/' + label)},${q(f.classes[1].id)},'teacher_test_material','reserved',${q(actor)},'test',${q(testId)});`,
  }
  return inserts[label]
}
function blockerProbes(f: TestOwnerPristineDiscardFixture) {
  const c = f.cases.find(row => row.label === 'restored-privilege-success')!; const test = f.tests.find(row => row.id === c.testId)!
  const blockerLabels = labels.filter(label => label.startsWith('block-'))
  return blockerLabels.map(label => closedProbe(label, `declare r jsonb;begin ${insertBlocker(f,label,c.testId,c.actorId,test.classroom_id)}r:=${rpc(c)};
 if r->>'discarded'<>'false' or r->>'reason'<>'draft_changed' or r->'test' is distinct from (select pg_catalog.to_jsonb(t) from public.tests t where id=${q(c.testId)}::uuid) then raise exception 'Dependent blocker differed: ${label}';end if;end;`)).join('\n')
}
function faultProbe(f: TestOwnerPristineDiscardFixture, label: string, table: 'tests'|'assessment_drafts', timing: 'before'|'after', action: string, expected: string, deadline?: string, marker = false) {
  const c = f.cases.find(row => row.label === 'restored-privilege-success')!; const suffix = f.tag.slice(-12); const name = `zzz_discard_${suffix}_${label.replaceAll('-', '_')}`
  const testScope = table === 'tests' ? `old.id=${q(c.testId)}::uuid` : `old.assessment_type='test' and old.assessment_id=${q(c.testId)}::uuid`
  const sequence = `discard_${suffix}_${label.replaceAll('-', '_')}_hit`
  const setup = `${marker ? `create temp sequence ${sequence};` : ''}create function private.${name}() returns trigger language plpgsql set search_path='' as $fault$ begin if not (${testScope}) then return old;end if;${marker ? `perform pg_catalog.nextval(${q(`pg_temp.${sequence}`)}::regclass);` : ''}${action}end;$fault$;
 revoke all on function private.${name}() from public,anon,authenticated,service_role;create trigger ${name} ${timing} delete on public.${table} for each row execute function private.${name}();`
  const verify = marker ? `if pg_catalog.currval(${q(`pg_temp.${sequence}`)}::regclass) is distinct from 1::bigint then raise exception 'Deadline trigger was not reached';end if;` : ''
  return closedProbe(label, `declare code text;begin ${setup}begin perform ${rpc(c, deadline)};raise exception 'Fault unexpectedly succeeded';exception when others then get stacked diagnostics code=returned_sqlstate;if code<>${q(expected)} then raise exception 'Fault code differs';end if;end;${verify}end;`)
}
function fencedModeProbe(f: TestOwnerPristineDiscardFixture, label: string, setting: string) {
  const c = f.cases.find(row => row.label === 'restored-privilege-success')!
  return closedProbe(label, `declare code text;begin perform pg_catalog.set_config(${q(setting)},'on',true);begin perform ${rpc(c)};raise exception 'Fenced mode unexpectedly succeeded';exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'PT403' then raise exception 'Fenced mode code differs';end if;end;end;`)
}
function faultProbes(f: TestOwnerPristineDiscardFixture) {
  const c = f.cases.find(row => row.label === 'restored-privilege-success')!; const draft = f.drafts.find(row => row.assessment_id === c.testId)!
  return [
    faultProbe(f,'suppress-draft-delete','assessment_drafts','before','return null;','PT503'),
    faultProbe(f,'suppress-test-delete','tests','before','return null;','PT503'),
    faultProbe(f,'reinsert-draft-after-delete','assessment_drafts','after','insert into public.assessment_drafts select old.*;return old;','PT503'),
    faultProbe(f,'reinsert-test-after-delete','tests','after','insert into public.tests select old.*;return old;','PT503'),
    closedProbe('wrong-draft-binding',`declare code text;begin update public.assessment_drafts set classroom_id=${q(f.classes[1].id)}::uuid where id=${q(draft.id)}::uuid;begin perform ${rpc(c)};raise exception 'Wrong binding succeeded';exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'PT503' then raise exception 'Wrong binding code differs';end if;end;end;`),
    faultProbe(f,'drift-settings','assessment_drafts','after','update public.managed_storage_settings set updated_at=pg_catalog.clock_timestamp() where singleton;return old;','PT503'),
    faultProbe(f,'drift-revision','assessment_drafts','after',`update public.classroom_archive_revisions set revision=revision+1 where classroom_id=${q(f.classes[0].id)}::uuid;return old;`,'PT503'),
    fencedModeProbe(f,'fence-archive-restore','pika.classroom_archive_restore'),
    fencedModeProbe(f,'fence-archive-compaction','pika.classroom_archive_compaction'),
    fencedModeProbe(f,'fence-identity-mapping','pika.identity_mapping'),
    fencedModeProbe(f,'fence-classroom-purge-finalize','pika.classroom_purge_finalize'),
    fencedModeProbe(f,'fence-blueprint-purge-finalize','pika.course_blueprint_purge_finalize'),
    fencedModeProbe(f,'fence-student-purge-finalize','pika.student_purge_finalize'),
    faultProbe(f,'deadline-after-draft-delete','assessment_drafts','after','perform pg_catalog.pg_sleep(0.1);return old;','PT503',"pg_catalog.clock_timestamp()+interval '50 milliseconds'",true),
    faultProbe(f,'deadline-after-test-delete','tests','after','perform pg_catalog.pg_sleep(0.1);return old;','PT503',"pg_catalog.clock_timestamp()+interval '50 milliseconds'",true),
    faultProbe(f,'known-classroom-purge-active','assessment_drafts','before',"raise exception using errcode='55000',message='classroom_purge_active';",'PT403'),
    faultProbe(f,'known-attendance-decommission-active','assessment_drafts','before',"raise exception using errcode='55000',message='attendance_decommission_active';",'PT403'),
    faultProbe(f,'known-attendance-decommission-irreversible','assessment_drafts','before',"raise exception using errcode='55000',message='attendance_decommission_irreversible';",'PT403'),
    faultProbe(f,'known-academic-cleanup-parent-fenced','assessment_drafts','before',"raise exception using errcode='55000',message='academic_cleanup_parent_fenced';",'PT403'),
    faultProbe(f,'unknown-55000','assessment_drafts','before',"raise exception using errcode='55000',message='discard_unknown_probe';",'55000'),
    faultProbe(f,'raw-42501','assessment_drafts','before',"raise exception using errcode='42501',message='discard_raw_privilege_probe';",'42501'),
  ].join('\n')
}

export function testOwnerPristineDiscardDbContractsSql(f: TestOwnerPristineDiscardFixture, projectId: string) {
  validateFixture(f, projectId)
  const planCase = f.cases.find(c => c.label === 'restored-privilege-success')!
  const planObjectIds = testOwnerPristineDiscardDbPlanObjectIds(f)
  const planIdsSha256 = hash(planObjectIds.join('\n'))
  return bounded(`begin;set local lock_timeout='1s';set local statement_timeout='35s';
create temp table owner_discard_evidence(label text primary key,ok boolean not null,code text not null) on commit drop;
create function pg_temp.owner_discard_note(p_label text,p_ok boolean,p_code text) returns void language plpgsql set search_path='' as $note$ begin if pg_catalog.octet_length(p_label)>80 or p_code!~'^[A-Z0-9]{5}$' then raise exception 'Evidence bound differs';end if;insert into pg_temp.owner_discard_evidence values(p_label,p_ok,p_code);end;$note$;
${snapshotFunction(f)}create temp table owner_discard_initial on commit drop as select pg_temp.owner_discard_snapshot() value;
${catalogProbe()}${f.cases.map(c => caseProbe(f,c)).join('\n')}${blockerProbes(f)}${faultProbes(f)}
do $final$ begin if pg_temp.owner_discard_snapshot() is distinct from (select value from pg_temp.owner_discard_initial) then raise exception using errcode=${q(failureCode('final-fixture-equality'))},message='Final rollback scope differs';end if;end;$final$;
insert into public.managed_storage_objects(id,storage_bucket,storage_path,classroom_id,purpose,status,created_by_user_id,resource_type,resource_id)
select object_id,'test-documents',${q(f.tag + '/managed-plan/')}||ordinality::text,
 case when ordinality=1 then ${q(f.classes[1].id)}::uuid else ${q(f.classes[3].id)}::uuid end,
 'teacher_test_material','reserved',${q(f.actors[0].id)}::uuid,
 case when ordinality=1 then 'test' else 'owner-discard-plan-control' end,
 case when ordinality=1 then ${q(planCase.testId)}::uuid else object_id end
from pg_catalog.unnest(array[${planObjectIds.map(value => `${q(value)}::uuid`).join(',')}]) with ordinality fixture(object_id,ordinality);
do $plan_fixture$ begin if (select count(*) from public.managed_storage_objects where id=any(array[${planObjectIds.map(value => `${q(value)}::uuid`).join(',')}]))<>1001
 or not exists(select 1 from public.managed_storage_objects where id=${q(planObjectIds[0])}::uuid and classroom_id=${q(f.classes[1].id)}::uuid and resource_type='test' and resource_id=${q(planCase.testId)}::uuid)
 then raise exception using errcode=${q(failureCode('plan-fixture'))},message='Selective managed resource plan fixture differs';end if;perform pg_temp.owner_discard_note('plan-fixture',true,'00000');end;$plan_fixture$;
create function pg_temp.owner_discard_explain() returns jsonb language plpgsql set search_path='' as $plan$ declare plan json;begin execute ${q(`explain (format json, costs false) select id from public.managed_storage_objects where resource_type='test' and resource_id=${q(planCase.testId)}::uuid`)} into plan;return plan::jsonb;end;$plan$;
create temp table owner_discard_result on commit drop as select pg_catalog.jsonb_build_object('version',1,'native_execution',true,'rollback_only',true,'fixture_tag',${q(f.tag)},'checks',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('label',label,'ok',ok,'code',code) order by label) from pg_temp.owner_discard_evidence),'check_count',(select count(*) from pg_temp.owner_discard_evidence),
'managed_resource_plan',pg_temp.owner_discard_explain(),'managed_resource_plan_fixture_count',1001,'managed_resource_plan_ids_sha256',${q(planIdsSha256)},
'test_columns',(select pg_catalog.jsonb_agg(a.attname order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid='public.tests'::regclass and a.attnum>0 and not a.attisdropped),
'draft_columns',(select pg_catalog.jsonb_agg(a.attname order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid='public.assessment_drafts'::regclass and a.attnum>0 and not a.attisdropped),
'limitations',pg_catalog.jsonb_build_array(${TEST_OWNER_PRISTINE_DISCARD_DB_LIMITATIONS.map(q).join(',')})) value;
do $bound$ begin if (select pg_catalog.octet_length(value::text) from pg_temp.owner_discard_result)>65536 then raise exception using errcode=${q(failureCode('evidence-bound'))},message='Evidence result exceeds64KiB';end if;end;$bound$;
select value as result from pg_temp.owner_discard_result;rollback;`)
}
