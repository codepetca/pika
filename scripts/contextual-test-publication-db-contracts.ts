/** Inert rollback-only SQL source for migration252. Importing this module opens
 * no connection and performs no SQL. Execution is admitted only through the
 * fixed driver and exact manifest accepted by the owning native profile. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { TestOwnerPublicationFixture } from './contextual-test-publication-proof-fixture'
import type { DraftSaveDriver, DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'

export const TEST_OWNER_PUBLICATION_SOURCE_SHA256 = 'b506e610a5dbb020b0b9aba2f6092ef04319053d14c9ec1072e22af5e3e458f8' as const
export const TEST_OWNER_PUBLICATION_DB_CAPS = Object.freeze({ sqlBytes: 256 * 1024, actionMs: 35_000, requestMs: 12_000 })
export const TEST_OWNER_PUBLICATION_TEST_COLUMNS = Object.freeze(['id','classroom_id','title','status','show_results','position',
  'points_possible','include_in_final','created_by','created_at','updated_at','documents','gradebook_weight','artifact_id','source_artifact_id',
  'blueprint_archived_at','source_blueprint_version_id','questions_locked_at','gradebook_category_id','gradebook_maximum_override','gradebook_score_scale'] as const)
export const TEST_OWNER_PUBLICATION_DRAFT_COLUMNS = Object.freeze(['id','assessment_type','assessment_id','classroom_id','content',
  'version','created_by','updated_by','created_at','updated_at'] as const)
export const TEST_OWNER_PUBLICATION_QUESTION_COLUMNS = Object.freeze(['id','test_id','question_type','question_text','options','correct_option',
  'points','response_max_chars','position','created_at','updated_at','response_monospace','answer_key','ai_reference_cache_key',
  'ai_reference_cache_answers','ai_reference_cache_model','ai_reference_cache_generated_at','sample_solution','artifact_id',
  'source_artifact_id','source_blueprint_version_id'] as const)
export const TEST_OWNER_PUBLICATION_DB_CHECK_LABELS = Object.freeze([
  'catalog-function','catalog-columns','catalog-test-triggers','catalog-draft-triggers','catalog-question-triggers','catalog-nested-capabilities',
  'teacher-owner','student-owner-mixed','bulk-1001','student-member-denied','unrelated-owner-denied','archived-class-denied',
  'retired-test-denied','missing-draft','stale-version','noncanonical-content','stale-authoring-sha','wrong-classroom','active-test','closed-test',
  'block-test-attempts','block-test-responses','block-test-focus-events','block-test-student-availability','block-test-ai-grading-runs',
  'block-test-ai-grading-run-items','block-gradebook-score-overrides','drift-test-status','drift-draft','drift-question-cache',
  'drift-question-lineage','drift-settings','drift-provenance','suppress-question-insert','alter-question-insert',
  'suppress-question-update','alter-question-update','suppress-question-delete','suppress-test-active','suppress-test-closed',
  'drift-revision','detect-unrelated-row','drift-managed-object','drift-managed-reference','drift-document-cleanup',
  'deadline-reached','raw-42501','unknown-55000','final-fixture-equality',
] as const)
export const TEST_OWNER_PUBLICATION_DB_LIMITATIONS = Object.freeze([
  'A malformed wrong-Class no-FK gradebook override writer remains a declared concurrent race residual.',
  'Rollback source contracts do not constitute executable PostgreSQL, SDK, or catalog acceptance.',
  'The managed writer sequence is nontransactional and is never reset or claimed equal.',
] as const)

const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const j = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_PUBLICATION_DB_CAPS.sqlBytes); return sql }
function validateFixture(f: TestOwnerPublicationFixture, projectId: string) {
  assert(Object.isFrozen(f)); assert.equal(f.version, 1); assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  assert.equal(f.tests.length, 16); assert.equal(f.drafts.length, 15); assert.equal(f.questions.length, 1019)
  assert.equal(f.cases.length, 10); assert.equal(f.transitions.length, 5); assert.equal(new Set(f.allocatedIds).size, f.allocatedIds.length)
}

const testTriggers = [
  ['assign_test_default_gradebook_category','public','assign_default_gradebook_category',23],
  ['car_tests','public','bump_classroom_archive_revision_from_resource',31],
  ['classroom_purge_fence_tests','public','reject_classroom_resource_change_during_purge',31],
  ['delete_test_gradebook_score_overrides','public','delete_gradebook_overrides_for_assessment',9],
  ['enqueue_obsolete_test_document_snapshots','public','enqueue_obsolete_test_document_snapshots',25],
  ['preserve_test_question_lock','private','preserve_test_question_lock',19],
  ['removed_academic_parent','private','guard_removed_academic_parent',27],
  ['tests_blueprint_purge_lineage_fence','public','guard_course_blueprint_version_lineage_write',31],
  ['tests_managed_storage_remove','public','remove_managed_storage_json_host',11],
  ['tests_managed_storage_sync','public','sync_managed_storage_json_host',21],
  ['touch_classroom_blueprint_source_from_tests_insert_delete','public','touch_classroom_blueprint_source_revision',13],
  ['touch_classroom_blueprint_source_from_tests_update','public','touch_classroom_blueprint_source_revision',17],
  ['update_tests_updated_at','public','update_tests_updated_at',19],
] as const
const draftTriggers = [
  ['car_assessment_drafts','public','bump_classroom_archive_revision_from_resource',31],
  ['classroom_purge_fence_assessment_drafts','public','reject_classroom_resource_change_during_purge',31],
  ['touch_classroom_blueprint_source_from_drafts','public','touch_classroom_blueprint_source_from_assessment_draft',29],
  ['update_assessment_drafts_updated_at','public','update_assessment_drafts_updated_at',19],
] as const
const questionTriggers = [
  ['car_test_questions','public','bump_classroom_archive_revision_from_resource',31],
  ['classroom_purge_fence_test_questions','public','reject_classroom_resource_change_during_purge',31],
  ['lock_test_question_parent','public','lock_test_parent_for_child_mutation',31],
  ['test_questions_blueprint_purge_lineage_fence','public','guard_course_blueprint_version_lineage_write',31],
  ['touch_classroom_blueprint_source_from_test_questions_insert_del','public','touch_classroom_blueprint_source_from_test_question',13],
  ['touch_classroom_blueprint_source_from_test_questions_update','public','touch_classroom_blueprint_source_from_test_question',17],
  ['update_test_questions_updated_at','public','update_test_questions_updated_at',19],
] as const

function graph(f: TestOwnerPublicationFixture) {
  const tests = f.tests.map(row => `${q(row.id)}::uuid`).join(',')
  const classes = f.classes.map(row => `${q(row.id)}::uuid`).join(',')
  const scoped = (table: string, predicate: string) => `${q(table)},(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by pg_catalog.to_jsonb(r)::text),'[]'::jsonb) from ${table} r where ${predicate})`
  return `pg_catalog.jsonb_build_object(${[
    scoped('public.classrooms', `id=any(array[${classes}])`), scoped('public.classroom_archive_revisions', `classroom_id=any(array[${classes}])`),
    scoped('public.tests', `id=any(array[${tests}])`), scoped('public.assessment_drafts', `assessment_type='test' and assessment_id=any(array[${tests}])`),
    scoped('public.test_questions', `test_id=any(array[${tests}])`), scoped('public.test_attempts', `test_id=any(array[${tests}])`),
    scoped('public.test_responses', `test_id=any(array[${tests}])`), scoped('public.test_focus_events', `test_id=any(array[${tests}])`),
    scoped('public.test_student_availability', `test_id=any(array[${tests}])`), scoped('public.test_ai_grading_runs', `test_id=any(array[${tests}])`),
    scoped('public.test_ai_grading_run_items', `test_id=any(array[${tests}])`), scoped('public.gradebook_score_overrides', `assessment_type='test' and assessment_id=any(array[${tests}])`),
    scoped('public.classroom_guided_draft_provenance', `test_id=any(array[${tests}])`), scoped('public.managed_storage_json_references', `test_id=any(array[${tests}])`),
    scoped('public.managed_storage_objects', `resource_type='test' and resource_id=any(array[${tests}])`),
    scoped('public.test_document_snapshot_storage_cleanup', `managed_object_id in (select object.id from public.managed_storage_objects object where (object.resource_type='test' and object.resource_id=any(array[${tests}])) or object.id in (select reference.managed_object_id from public.managed_storage_json_references reference where reference.test_id=any(array[${tests}])))`),
    `${q('public.managed_storage_settings')},(select pg_catalog.to_jsonb(s) from public.managed_storage_settings s where singleton)`,
  ].join(',')})`
}

function exactTriggers(table: string, expected: readonly (readonly [string,string,string,number])[], message: string) {
  const tuples = expected.map(row => `(${q(row[0])},${q(row[1])},${q(row[2])},${row[3]})`).join(',')
  const actual = `select t.tgname::text,nf.nspname::text,catalog_proc.proname::text,t.tgtype::integer from pg_catalog.pg_trigger t join pg_catalog.pg_proc catalog_proc on catalog_proc.oid=t.tgfoid join pg_catalog.pg_namespace nf on nf.oid=catalog_proc.pronamespace where t.tgrelid=${q(`public.${table}`)}::regclass and not t.tgisinternal`
  return `if exists((${actual}) except (select * from (values ${tuples}) e(name,fn_schema,fn_name,tgtype))) or exists((select * from (values ${tuples}) e(name,fn_schema,fn_name,tgtype)) except (${actual})) or exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid=${q(`public.${table}`)}::regclass and not t.tgisinternal and (t.tgenabled<>'O' or t.tgdeferrable or t.tginitdeferred)) then raise exception ${q(message)};end if;`
}
function note(label: typeof TEST_OWNER_PUBLICATION_DB_CHECK_LABELS[number]) { return `checks:=checks||pg_catalog.jsonb_build_array(${q(label)});` }
function probe(label: typeof TEST_OWNER_PUBLICATION_DB_CHECK_LABELS[number], body: string) {
  return `do $probe$ declare before_graph jsonb;after_graph jsonb;checks jsonb;begin select value into checks from pg_temp.owner_publication_checks;before_graph:=${graphRef};begin ${body} raise exception using errcode='PT499',message=${q(label)};exception when sqlstate 'PT499' then if sqlerrm<>${q(label)} then raise;end if;end;after_graph:=${graphRef};if after_graph is distinct from before_graph then raise exception 'Publication rollback graph differs: ${label}';end if;${note(label)} update pg_temp.owner_publication_checks set value=checks;exception when others then raise exception using errcode='P25${String(TEST_OWNER_PUBLICATION_DB_CHECK_LABELS.indexOf(label) + 1).padStart(2,'0')}',message='Closed publication contract failure';end;$probe$;`
}
const graphRef = 'pg_temp.owner_publication_graph()'
function publicationCall(c: TestOwnerPublicationFixture['cases'][number], classroomId: string, content: unknown, sha = '0'.repeat(64), version = c.input.draft_version) {
  return `public.publish_test_from_draft_for_owner_v1(${q(c.actorId)}::uuid,${q(c.testId)}::uuid,${q(classroomId)}::uuid,${q(sha)},${version},${j(content)},pg_catalog.clock_timestamp()+interval '8 seconds')`
}
function catalogSql() {
  const columns = (table: string, expected: readonly string[], message: string) => `select pg_catalog.array_agg(a.attname::text order by a.attnum) into actual from pg_catalog.pg_attribute a where a.attrelid=${q(`public.${table}`)}::regclass and a.attnum>0 and not a.attisdropped;if actual is distinct from array[${expected.map(q).join(',')}]::text[] then raise exception ${q(message)};end if;`
  return `do $catalog$ declare p pg_catalog.pg_proc;actual text[];checks jsonb;begin select value into checks from pg_temp.owner_publication_checks;
 select proc.* into strict p from pg_catalog.pg_proc proc where proc.oid='public.publish_test_from_draft_for_owner_v1(uuid,uuid,uuid,text,integer,jsonb,timestamp with time zone)'::regprocedure;
 if p.proowner::regrole::text<>'postgres' or not p.prosecdef or p.prorettype::regtype::text<>'jsonb'
 or p.proargnames is distinct from array['p_actor_id','p_test_id','p_classroom_id','p_expected_authoring_sha256','p_expected_draft_version','p_validated_content','p_deadline']::text[]
 or p.proconfig is null or pg_catalog.cardinality(p.proconfig)<>2
 or not p.proconfig @> array['search_path=""','lock_timeout=1s']
 or pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') or pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
 or not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
 or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE' and a.grantee not in (p.proowner,'service_role'::regrole)) then raise exception 'Publication function catalog differs';end if;${note('catalog-function')}
 ${columns('tests',TEST_OWNER_PUBLICATION_TEST_COLUMNS,'Exact21 Test columns differ')}${columns('assessment_drafts',TEST_OWNER_PUBLICATION_DRAFT_COLUMNS,'Exact10 Draft columns differ')}${columns('test_questions',TEST_OWNER_PUBLICATION_QUESTION_COLUMNS,'Exact21 question columns differ')}${note('catalog-columns')}
 ${exactTriggers('tests',testTriggers,'Exact Test trigger closure differs')}${note('catalog-test-triggers')}
 ${exactTriggers('assessment_drafts',draftTriggers,'Exact Draft trigger closure differs')}${note('catalog-draft-triggers')}
 ${exactTriggers('test_questions',questionTriggers,'Exact question trigger closure differs')}${note('catalog-question-triggers')}
 if not pg_catalog.has_function_privilege('service_role','public.publish_test_from_draft_atomic(uuid,uuid,integer)','EXECUTE')
 or not pg_catalog.has_function_privilege('service_role','public.activate_test_from_draft_atomic(uuid,uuid,integer)','EXECUTE')
 or not pg_catalog.has_function_privilege('service_role','public.snapshot_test_draft_for_owner_v1(uuid,uuid,timestamp with time zone)','EXECUTE')
 or pg_catalog.has_function_privilege('anon','public.publish_test_from_draft_atomic(uuid,uuid,integer)','EXECUTE')
 or pg_catalog.has_function_privilege('authenticated','public.activate_test_from_draft_atomic(uuid,uuid,integer)','EXECUTE') then raise exception 'Nested publication capabilities differ';end if;${note('catalog-nested-capabilities')}
 update pg_temp.owner_publication_checks set value=checks;exception when others then raise exception using errcode='P2501',message='Closed publication catalog failure';end;$catalog$;`
}

function caseProbe(f: TestOwnerPublicationFixture, c: TestOwnerPublicationFixture['cases'][number]) {
  const test = f.tests.find(row => row.id === c.testId); const draft = f.drafts.find(row => row.assessment_id === c.testId)
  const classId = test?.classroom_id ?? f.classes[0].id
  // Isolate the absent persisted Draft with valid canonical fixture content;
  // an empty fallback would fail input validation before the final source fence.
  const content = draft?.content ?? f.drafts[0].content
  if (c.expectedHTTP === 200) {
    return probe(c.label, `declare s jsonb;r jsonb;test_before public.tests;draft_before public.assessment_drafts;class_before public.classrooms;archive_before public.classroom_archive_revisions;q_before integer;q_after integer;t integer;begin
 select * into strict test_before from public.tests where id=${q(c.testId)}::uuid;select * into strict draft_before from public.assessment_drafts where assessment_type='test' and assessment_id=test_before.id;
 select * into strict class_before from public.classrooms where id=test_before.classroom_id;select * into strict archive_before from public.classroom_archive_revisions where classroom_id=test_before.classroom_id;
 select count(*) into q_before from public.test_questions where test_id=test_before.id;s:=public.snapshot_test_draft_for_owner_v1(${q(c.actorId)}::uuid,${q(c.testId)}::uuid,pg_catalog.clock_timestamp()+interval '8 seconds');
 r:=public.publish_test_from_draft_for_owner_v1(${q(c.actorId)}::uuid,${q(c.testId)}::uuid,test_before.classroom_id,s->>'source_sha256',(s->'draft'->>'version')::integer,draft_before.content,pg_catalog.clock_timestamp()+interval '8 seconds');
 if r->>'version'<>'1' or r->>'actor_id'<>${q(c.actorId)} or r->>'test_id'<>${q(c.testId)} or r->>'classroom_id'<>test_before.classroom_id::text or r->'test'->>'status'<>'closed' or (select count(*) from pg_catalog.jsonb_object_keys(r))<>7 then raise exception 'Publication witness differs';end if;
 select count(*) into q_after from public.test_questions where test_id=test_before.id;t:=case when test_before.title is distinct from draft_before.content->>'title' or test_before.show_results is distinct from (draft_before.content->>'show_results')::boolean then 1 else 0 end;
 if (select blueprint_source_revision from public.classrooms where id=test_before.classroom_id)<>class_before.blueprint_source_revision+t+${c.Q}
 or (select revision from public.classroom_archive_revisions where classroom_id=test_before.classroom_id)<>archive_before.revision+2+t+2*${c.Q}
 or q_after<>pg_catalog.jsonb_array_length(draft_before.content->'questions') or (select pg_catalog.to_jsonb(d) from public.assessment_drafts d where d.id=draft_before.id) is distinct from pg_catalog.to_jsonb(draft_before) then raise exception 'Publication exact effects differ';end if;end;`)
  }
  // The SDK stops at snapshot with404; a Draft absent at the final CAS is409.
  const expected = c.label === 'missing-draft' ? 'PT409' : c.expectedHTTP === 400 ? 'PT400' : c.expectedHTTP === 403 ? 'PT403' : c.expectedHTTP === 404 ? 'PT404' : c.expectedHTTP === 409 ? 'PT409' : 'PT503'
  return probe(c.label, `declare code text;begin begin perform ${publicationCall(c,classId,content)};raise exception 'Denied publication succeeded';exception when others then get stacked diagnostics code=returned_sqlstate;if code<>${q(expected)} then raise exception 'Denied publication code differs';end if;end;end;`)
}

export function testOwnerPublicationDbContractsManifest(f: TestOwnerPublicationFixture, projectId: string) {
  validateFixture(f, projectId)
  const basicCases = f.cases.map(c => caseProbe(f,c)).join('\n')
  const target = f.cases[0]; const test = f.tests.find(row => row.id === target.testId)!; const draft = f.drafts.find(row => row.assessment_id === target.testId)!; const question = f.questions.find(row => row.test_id === target.testId)!
  const denied = (label: typeof TEST_OWNER_PUBLICATION_DB_CHECK_LABELS[number], mutation: string, expected = 'PT409') => probe(label, `declare s jsonb;code text;begin s:=public.snapshot_test_draft_for_owner_v1(${q(target.actorId)}::uuid,${q(target.testId)}::uuid,pg_catalog.clock_timestamp()+interval '8 seconds');${mutation}begin perform public.publish_test_from_draft_for_owner_v1(${q(target.actorId)}::uuid,${q(target.testId)}::uuid,${q(test.classroom_id)}::uuid,s->>'source_sha256',(s->'draft'->>'version')::integer,${j(draft.content)},pg_catalog.clock_timestamp()+interval '8 seconds');raise exception 'Drift publication succeeded';exception when others then get stacked diagnostics code=returned_sqlstate;if code<>${q(expected)} then raise exception 'Drift code differs';end if;end;end;`)
  const rid=f.reservedIds.rollbackQuestionIds.map(value=>`${q(value)}::uuid`)
  const blockers:[typeof TEST_OWNER_PUBLICATION_DB_CHECK_LABELS[number],string][]=[
    ['block-test-attempts',`insert into public.test_attempts(id,test_id,student_id) values(${rid[0]},${q(test.id)}::uuid,${q(f.actors[2].id)}::uuid);`],
    ['block-test-responses',`insert into public.test_responses(id,test_id,question_id,student_id,response_text) values(${rid[1]},${q(test.id)}::uuid,${q(question.id)}::uuid,${q(f.actors[2].id)}::uuid,'proof');`],
    ['block-test-focus-events',`insert into public.test_focus_events(id,test_id,student_id,session_id,event_type) values(${q(f.reservedIds.focusEventId)}::uuid,${q(test.id)}::uuid,${q(f.actors[2].id)}::uuid,${q(f.tag+'_proof')},'away_start');`],
    ['block-test-student-availability',`insert into public.test_student_availability(id,test_id,student_id,state,updated_by) values(${rid[2]},${q(test.id)}::uuid,${q(f.actors[2].id)}::uuid,'closed',${q(target.actorId)}::uuid);`],
    ['block-test-ai-grading-runs',`insert into public.test_ai_grading_runs(id,test_id,status,triggered_by,selection_hash) values(${rid[3]},${q(test.id)}::uuid,'completed',${q(target.actorId)}::uuid,${q('a'.repeat(64))});`],
    ['block-test-ai-grading-run-items',`insert into public.test_responses(id,test_id,question_id,student_id,response_text) values(${rid[5]},${q(test.id)}::uuid,${q(question.id)}::uuid,${q(f.actors[2].id)}::uuid,'proof');insert into public.test_ai_grading_runs(id,test_id,status,triggered_by,selection_hash) values(${rid[4]},${q(test.id)}::uuid,'completed',${q(target.actorId)}::uuid,${q('b'.repeat(64))});insert into public.test_ai_grading_run_items(id,run_id,test_id,student_id,question_id,response_id,response_revision,question_grading_snapshot,status) values(${rid[6]},${rid[4]},${q(test.id)}::uuid,${q(f.actors[2].id)}::uuid,${q(question.id)}::uuid,${rid[5]},1,null,'completed');`],
    ['block-gradebook-score-overrides',`insert into public.gradebook_score_overrides(id,classroom_id,student_id,assessment_type,assessment_id,earned,created_by) values(${rid[7]},${q(test.classroom_id)}::uuid,${q(f.actors[2].id)}::uuid,'test',${q(test.id)}::uuid,0,${q(target.actorId)}::uuid);`],
  ]
  const mixed=f.cases[1];const mixedTest=f.tests.find(row=>row.id===mixed.testId)!;const mixedDraft=f.drafts.find(row=>row.assessment_id===mixed.testId)!
  const fault=(label:typeof TEST_OWNER_PUBLICATION_DB_CHECK_LABELS[number],c:TestOwnerPublicationFixture['cases'][number],table:'tests'|'test_questions',timing:'before'|'after',event:'insert'|'update'|'delete',condition:string,action:string,deadline="pg_catalog.clock_timestamp()+interval '8 seconds'",setup='')=>{
    const currentTest=f.tests.find(row=>row.id===c.testId)!;const currentDraft=f.drafts.find(row=>row.assessment_id===c.testId)!;const suffix=`p252_${f.tag.slice(-12)}_${TEST_OWNER_PUBLICATION_DB_CHECK_LABELS.indexOf(label)}`;const seq=`${suffix}_hit`;const rowReturn=event==='delete'?'old':'new'
    const raises=/^\s*raise exception/i.test(action);const completed=raises?action:action.replace(/return (new|old|null);\s*$/i,`perform pg_catalog.nextval(${q(`pg_temp.${seq}`)}::regclass);return $1;`)
    const sealedAction=completed===action&&!raises?`${action}perform pg_catalog.nextval(${q(`pg_temp.${seq}`)}::regclass);`:completed
    // SQL preserves raw42501; only the server boundary maps it to HTTP503.
    const expectedCode=label==='raw-42501'?'42501':'PT503'
    return probe(label,`declare s jsonb;code text;succeeded boolean:=false;begin create temp sequence ${seq};create function private.${suffix}() returns trigger language plpgsql set search_path='' as $fault$ begin if ${condition} then perform pg_catalog.nextval(${q(`pg_temp.${seq}`)}::regclass);${sealedAction}end if;return ${rowReturn};end;$fault$;revoke all on function private.${suffix}() from public,anon,authenticated,service_role;create trigger ${suffix} ${timing} ${event} on public.${table} for each row execute function private.${suffix}();${setup}s:=public.snapshot_test_draft_for_owner_v1(${q(c.actorId)}::uuid,${q(c.testId)}::uuid,pg_catalog.clock_timestamp()+interval '8 seconds');begin perform public.publish_test_from_draft_for_owner_v1(${q(c.actorId)}::uuid,${q(c.testId)}::uuid,${q(currentTest.classroom_id)}::uuid,s->>'source_sha256',(s->'draft'->>'version')::integer,${j(currentDraft.content)},${deadline});succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;if succeeded or code is distinct from ${q(expectedCode)} then raise exception 'Publication fault code differs';end if;if pg_catalog.currval(${q(`pg_temp.${seq}`)}::regclass)<${raises?1:2} then raise exception 'Publication fault trigger was not reached';end if;end;`)
  }
  // Keep the external graph detector outside the target-Class revision fence.
  const unrelatedTest=f.tests.find(row=>row.classroom_id!==test.classroom_id && row.blueprint_archived_at===null
    && f.classes.some(classroom=>classroom.id===row.classroom_id && !classroom.archived))
  assert(unrelatedTest)
  const detectUnrelated=()=>{const label='detect-unrelated-row' as const;const suffix=`p252_${f.tag.slice(-12)}_${TEST_OWNER_PUBLICATION_DB_CHECK_LABELS.indexOf(label)}`;const seq=`${suffix}_hit`
    return probe(label,`declare s jsonb;r jsonb;inside_before jsonb;unrelated_before jsonb;unrelated_after jsonb;begin select pg_catalog.to_jsonb(other_test) into strict unrelated_before from public.tests other_test where other_test.id=${q(unrelatedTest.id)}::uuid;inside_before:=pg_temp.owner_publication_graph();create temp sequence ${seq};create function private.${suffix}() returns trigger language plpgsql set search_path='' as $fault$ begin if new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active' then perform pg_catalog.nextval(${q(`pg_temp.${seq}`)}::regclass);update public.tests set documents=documents||${j([{id:f.reservedIds.rollbackTestId,source:'link',title:'fault',url:'https://example.invalid/fault'}])} where id=${q(unrelatedTest.id)}::uuid;end if;return new;end;$fault$;revoke all on function private.${suffix}() from public,anon,authenticated,service_role;create trigger ${suffix} after update on public.tests for each row execute function private.${suffix}();s:=public.snapshot_test_draft_for_owner_v1(${q(target.actorId)}::uuid,${q(target.testId)}::uuid,pg_catalog.clock_timestamp()+interval '8 seconds');r:=public.publish_test_from_draft_for_owner_v1(${q(target.actorId)}::uuid,${q(target.testId)}::uuid,${q(test.classroom_id)}::uuid,s->>'source_sha256',(s->'draft'->>'version')::integer,${j(draft.content)},pg_catalog.clock_timestamp()+interval '8 seconds');select pg_catalog.to_jsonb(other_test) into strict unrelated_after from public.tests other_test where other_test.id=${q(unrelatedTest.id)}::uuid;if unrelated_after->'documents' is distinct from ((unrelated_before->'documents')||${j([{id:f.reservedIds.rollbackTestId,source:'link',title:'fault',url:'https://example.invalid/fault'}])}) or not (inside_before->'public.tests' @> pg_catalog.jsonb_build_array(unrelated_before)) or not (pg_temp.owner_publication_graph()->'public.tests' @> pg_catalog.jsonb_build_array(unrelated_after)) then raise exception 'Unrelated-row postimage differs';end if;if r->'test'->>'status'<>'closed' or pg_catalog.currval(${q(`pg_temp.${seq}`)}::regclass)<1 or pg_temp.owner_publication_graph() is not distinct from inside_before then raise exception 'Unrelated-row detector was not reached';end if;end;`)}
  const provenanceInsert=`insert into public.classroom_guided_draft_provenance(id,draft_id,classroom_id,test_id,source_blueprint_version_id,source_blueprint_version_number,source_draft_revision,rules_markdown,seed_sha256,created_content_sha256,created_by) values(${q(f.reservedIds.rollbackDraftId)}::uuid,${q(draft.id)}::uuid,${q(test.classroom_id)}::uuid,${q(test.id)}::uuid,${q(f.blueprintVersion.id)}::uuid,1,1,'proof',${q('d'.repeat(64))},${q('e'.repeat(64))},${q(target.actorId)}::uuid);return new;`
  const managedPath=`link-docs/${test.id}/snapshots/${f.reservedIds.rollbackTestId}.json`
  const managedSetup=`insert into public.managed_storage_objects(id,storage_bucket,storage_path,classroom_id,purpose,status,created_by_user_id,resource_type,resource_id) values(${q(f.reservedIds.rollbackTestId)}::uuid,'test-documents',${q(managedPath)},${q(test.classroom_id)}::uuid,'teacher_test_material','reserved',${q(target.actorId)}::uuid,'test',${q(test.id)}::uuid);`
  const probes = [
    denied('stale-authoring-sha',`update public.test_questions set question_text=question_text||' changed' where id=${q(question.id)}::uuid;`),
    denied('wrong-classroom','', 'PT409').replace(`${q(test.classroom_id)}::uuid`,`${q(f.classes[1].id)}::uuid`),
    denied('active-test',`update public.tests set status='active' where id=${q(test.id)}::uuid;`), denied('closed-test',`update public.tests set status='closed' where id=${q(test.id)}::uuid;`),
    ...blockers.map(([label,insert])=>denied(label,insert)),
    denied('drift-test-status',`update public.tests set status='active' where id=${q(test.id)}::uuid;`),
    denied('drift-draft',`update public.assessment_drafts set version=version+1 where id=${q(draft.id)}::uuid;`),
    fault('drift-question-cache',target,'tests','after','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,`update public.test_questions set ai_reference_cache_key='fault-cache',ai_reference_cache_answers='["fault"]'::jsonb,ai_reference_cache_model='FaultModel',ai_reference_cache_generated_at=pg_catalog.transaction_timestamp() where id=${q(question.id)}::uuid;return new;`),
    fault('drift-question-lineage',target,'tests','after','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,`update public.test_questions set source_artifact_id=artifact_id where id=${q(question.id)}::uuid;return new;`),
    fault('drift-settings',target,'tests','after','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,`update public.managed_storage_settings set updated_at=pg_catalog.clock_timestamp() where singleton;return new;`),
    fault('drift-provenance',target,'tests','after','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,provenanceInsert),
    fault('suppress-question-insert',mixed,'test_questions','before','insert',`new.test_id=${q(mixed.testId)}::uuid and new.artifact_id=${q(f.reservedIds.newQuestionPortableId)}::uuid`,'return null;'),
    fault('alter-question-insert',mixed,'test_questions','before','insert',`new.test_id=${q(mixed.testId)}::uuid and new.artifact_id=${q(f.reservedIds.newQuestionPortableId)}::uuid`,`new.question_text:=new.question_text||' fault';return new;`),
    fault('suppress-question-update',mixed,'test_questions','before','update',`new.test_id=${q(mixed.testId)}::uuid and new.question_text='Synthetic authored correction'`,'return old;'),
    fault('alter-question-update',mixed,'test_questions','before','update',`new.test_id=${q(mixed.testId)}::uuid and new.question_text='Synthetic authored correction'`,`new.question_text:=new.question_text||' fault';return new;`),
    fault('suppress-question-delete',mixed,'test_questions','before','delete',`old.test_id=${q(mixed.testId)}::uuid and old.position=3`,'return null;'),
    fault('suppress-test-active',target,'tests','before','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,'return old;'),
    fault('suppress-test-closed',target,'tests','before','update',`new.id=${q(test.id)}::uuid and old.status='active' and new.status='closed'`,'return old;'),
    fault('drift-revision',target,'tests','after','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,`update public.classroom_archive_revisions set revision=revision+1 where classroom_id=${q(test.classroom_id)}::uuid;return new;`),
    detectUnrelated(),
    fault('drift-managed-object',target,'tests','after','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,`insert into public.managed_storage_objects(id,storage_bucket,storage_path,classroom_id,purpose,status,created_by_user_id,resource_type,resource_id) values(${q(f.reservedIds.rollbackTestId)}::uuid,'test-documents',${q(f.tag+'/fault')},${q(test.classroom_id)}::uuid,'teacher_test_material','reserved',${q(target.actorId)}::uuid,'test',${q(test.id)}::uuid);return new;`),
    fault('drift-managed-reference',target,'tests','after','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,`insert into public.managed_storage_json_references(id,managed_object_id,storage_bucket,storage_path,test_id,reference_role,evidence_sha256) values(${q(f.reservedIds.rollbackDraftId)}::uuid,${q(f.reservedIds.rollbackTestId)}::uuid,'test-documents',${q(managedPath)},${q(test.id)}::uuid,'teacher_document',${q('f'.repeat(64))});return new;`,"pg_catalog.clock_timestamp()+interval '8 seconds'",managedSetup),
    fault('drift-document-cleanup',target,'tests','after','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,`insert into public.test_document_snapshot_storage_cleanup(id,storage_path,managed_object_id) values(${q(f.reservedIds.rollbackDraftId)}::uuid,${q(managedPath)},${q(f.reservedIds.rollbackTestId)}::uuid);return new;`,"pg_catalog.clock_timestamp()+interval '8 seconds'",managedSetup),
    fault('deadline-reached',target,'tests','after','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,`perform pg_catalog.pg_sleep(0.1);return new;`,"pg_catalog.clock_timestamp()+interval '50 milliseconds'"),
    fault('raw-42501',target,'tests','after','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,"raise exception using errcode='42501',message='publication raw privilege probe';"),
    fault('unknown-55000',target,'tests','after','update',`new.id=${q(test.id)}::uuid and old.status='draft' and new.status='active'`,"raise exception using errcode='55000',message='publication unknown probe';"),
  ].join('\n')
  const sql = bounded(`begin;set local lock_timeout='1s';set local statement_timeout='35s';
do $guard$ begin if current_setting('application_name')<>${q(projectId+'_draft_contracts')} or current_database()<>'postgres' or current_user<>'postgres' or to_regprocedure('public.publish_test_from_draft_for_owner_v1(uuid,uuid,uuid,text,integer,jsonb,timestamp with time zone)') is null then raise exception 'Migration252 disposable source differs';end if;end;$guard$;
create temp table owner_publication_checks(value jsonb not null) on commit drop;insert into owner_publication_checks values('[]'::jsonb);
create function pg_temp.owner_publication_graph() returns jsonb language sql stable set search_path='' as $snapshot$ select ${graph(f)} $snapshot$;
create temp table owner_publication_baseline(value jsonb not null) on commit drop;insert into owner_publication_baseline select pg_temp.owner_publication_graph();
${catalogSql()}${basicCases}${probes}
do $final$ declare checks jsonb;baseline_graph jsonb;begin select value into checks from pg_temp.owner_publication_checks;if (select pg_catalog.jsonb_array_length(checks))<>${TEST_OWNER_PUBLICATION_DB_CHECK_LABELS.length-1} then raise exception 'Publication check count differs';end if;select value into strict baseline_graph from pg_temp.owner_publication_baseline;if baseline_graph is distinct from pg_temp.owner_publication_graph() then raise exception 'Publication final fixture differs';end if;checks:=checks||pg_catalog.jsonb_build_array('final-fixture-equality');update pg_temp.owner_publication_checks set value=checks;end;$final$;
select pg_catalog.jsonb_build_object('version',1,'checks',(select pg_catalog.jsonb_agg(value order by value) from pg_catalog.jsonb_array_elements_text((select value from pg_temp.owner_publication_checks)) value),'rolledBack',true) as result;rollback;`)
  const expectedResult = freeze({ version: 1 as const, checks: [...TEST_OWNER_PUBLICATION_DB_CHECK_LABELS].sort(), rolledBack: true as const })
  return freeze({ version: 1 as const, fixture: f, projectId, sourceFile: '252_contextual_test_owner_publication.sql' as const,
    sourceSha256: TEST_OWNER_PUBLICATION_SOURCE_SHA256, caps: TEST_OWNER_PUBLICATION_DB_CAPS, contracts: sql,
    checkLabels: TEST_OWNER_PUBLICATION_DB_CHECK_LABELS, expectedResult, reservedIds: freeze({ ...f.reservedIds }),
    limitations: TEST_OWNER_PUBLICATION_DB_LIMITATIONS })
}
export type TestOwnerPublicationDbContractsManifest = ReturnType<typeof testOwnerPublicationDbContractsManifest>

export async function runTestOwnerPublicationDbContracts(manifest: TestOwnerPublicationDbContractsManifest, target: DraftSaveTarget, driver: DraftSaveDriver) {
  assert(Object.isFrozen(manifest)); assert(Object.isFrozen(target)); assert.equal(target.projectId, manifest.projectId)
  assert.equal(target.containerProjectLabel, manifest.projectId); assert.equal(target.disposable, true)
  assert.equal(target.reviewedSourceSha256, TEST_OWNER_PUBLICATION_SOURCE_SHA256)
  assert.equal(target.acceptedManifestSha256, hash(JSON.stringify(manifest)))
  assert.deepEqual(await driver.verifyTarget(), target)
  const session = await driver.openSession(`${manifest.projectId}_draft_contracts`)
  assert.equal(session.name, `${manifest.projectId}_draft_contracts`)
  try {
    assert.deepEqual(await driver.verifyTarget(), target)
    const rows = await session.execute(manifest.contracts, manifest.caps.actionMs)
    assert.equal(rows.length, 1); assert.deepEqual(rows[0].result, manifest.expectedResult)
  } finally { await session.rollbackAndClose(manifest.caps.requestMs) }
  return freeze({ kind: 'rollback-test-owner-publication-contracts' as const, sourceSha256: target.reviewedSourceSha256,
    manifestSha256: target.acceptedManifestSha256, checks: manifest.expectedResult.checks })
}
