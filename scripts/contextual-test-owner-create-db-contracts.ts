/** Inert rollback-SQL source preparation. Importing this module performs no IO,
 * SQL, Docker, SDK, provider, or process operation. Native evidence exists only
 * after an independently accepted driver runs this against its sealed target. */
import assert from 'node:assert/strict'
import type { TestOwnerCreateFixture } from './contextual-test-owner-create-proof-fixture'

export const TEST_OWNER_CREATE_DB_CAPS = Object.freeze({ sqlBytes: 256 * 1024, actionMs: 35_000, requestMs: 12_000 })
const catalogFailures = Object.freeze({
  'catalog-function': 'Function owner/SECDEF/search_path/locktimeout/ACL catalog differs',
  'catalog-test-columns': 'Exact21 Test columns differ', 'catalog-draft-columns': 'Exact10 draft columns differ',
  'catalog-test-types': 'Test column types/nullability differ', 'catalog-draft-types': 'Draft column types/nullability differ',
  'catalog-test-defaults': 'Exact Test default columns differ', 'catalog-draft-defaults': 'Exact draft default columns differ',
  'catalog-default-values': 'Defaults differ', 'catalog-test-constraints': 'Exact Test constraints differ',
  'catalog-draft-constraints': 'Exact draft constraints differ', 'catalog-constraint-modes': 'Constraint validation/mode/body differs',
  'catalog-index': 'Position index differs', 'catalog-triggers': 'Exact noninternal trigger closure differs',
  'catalog-trigger-modes': 'Trigger enable/deferral mode differs',
})
const probeFailureLabels = Object.freeze([
  'student-owner-create', 'bulk-1001-retired-max', 'uncategorized-fallback', 'custom-category-default',
  'invalid-null-title', 'invalid-blank-title', 'invalid-long-title', 'invalid-deadline', 'expired-deadline', 'wrong-owner',
  'missing-classroom', 'archived-owner', 'restore-fence', 'compaction-fence', 'identity-fence', 'position-intmax',
  'missing-revision', 'missing-settings', 'hot-purge-fence-state', 'cold-purge-fence-state',
  'attendance-decommission-fenced', 'attendance-decommission-remote_deleted', 'attendance-decommission-local_deleted',
  'known-55000', 'unknown-55000', 'raw-42501', 'suppress-test', 'fail-test', 'suppress-draft', 'fail-draft',
  'drift-test-before', 'drift-test-after', 'drift-draft-before', 'drift-draft-after', 'drift-test-identity', 'drift-draft-identity',
  'drift-defaults', 'drift-parent', 'drift-revisions', 'drift-settings', 'drift-category', 'deadline-after-test', 'deadline-after-draft',
  'final-fixture-equality', 'evidence-bound',
])
/** Private proof diagnostics only: fixed labels, never exception text or rows. */
export const TEST_OWNER_CREATE_FAILURE_LABELS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  [...Object.keys(catalogFailures), ...probeFailureLabels].map((label, i) => [`PC${String(i + 1).padStart(3, '0')}`, label]),
))
function failureCode(label: string) {
  const entry = Object.entries(TEST_OWNER_CREATE_FAILURE_LABELS).find(([, known]) => known === label)
  assert(entry); return entry[0]
}
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function bounded(sql: string) {
  assert(Buffer.byteLength(sql) <= TEST_OWNER_CREATE_DB_CAPS.sqlBytes, 'Owner-create SQL exceeds cap')
  return sql
}
function validateFixture(f: TestOwnerCreateFixture) {
  assert.equal(f.version, 1); assert.match(f.tag, /^testownercreate_[a-f0-9]{12}$/)
  assert.equal(f.actors.length, 4); assert.deepEqual(f.actors.map(a => a.role), ['student', 'teacher', 'student', 'teacher'])
  assert.equal(f.classes.length, 4); assert.equal(f.tests.length, 1001); assert.equal(f.tests.at(-1)?.position, 1000)
  assert(f.tests.every((t, i) => t.classroom_id === f.classes[3].id && t.position === i))
  assert.equal(f.tests.at(-1)?.blueprint_archived_at, f.now)
  assert.equal(new Set(f.allocatedIds).size, f.allocatedIds.length)
}

const expectedTestColumns = ['id','classroom_id','title','status','show_results','position','points_possible','include_in_final','created_by','created_at','updated_at','documents','artifact_id','source_artifact_id','blueprint_archived_at','source_blueprint_version_id','questions_locked_at','gradebook_category_id','gradebook_weight','gradebook_maximum_override','gradebook_score_scale']
const expectedDraftColumns = ['id','assessment_type','assessment_id','classroom_id','content','version','created_by','updated_by','created_at','updated_at']
const expectedTestDefaultColumns = ['id','status','show_results','position','points_possible','include_in_final','created_at','updated_at','documents','artifact_id','gradebook_weight','gradebook_score_scale']
const expectedDraftDefaultColumns = ['id','content','version','created_at','updated_at']
const triggerPairs = [
  ['tests','assign_test_default_gradebook_category','public','assign_default_gradebook_category',23],
  ['tests','car_tests','public','bump_classroom_archive_revision_from_resource',31],
  ['tests','classroom_purge_fence_tests','public','reject_classroom_resource_change_during_purge',31],
  ['tests','enqueue_obsolete_test_document_snapshots','public','enqueue_obsolete_test_document_snapshots',25],
  ['tests','preserve_test_question_lock','private','preserve_test_question_lock',19],
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

const testColumnTypes = [
  ['id','uuid',true],['classroom_id','uuid',true],['title','text',true],['status','text',true],['show_results','boolean',true],
  ['position','integer',true],['points_possible','numeric(6,2)',true],['include_in_final','boolean',true],['created_by','uuid',true],
  ['created_at','timestamp with time zone',true],['updated_at','timestamp with time zone',true],['documents','jsonb',true],['artifact_id','uuid',true],
  ['source_artifact_id','uuid',false],['blueprint_archived_at','timestamp with time zone',false],['source_blueprint_version_id','uuid',false],
  ['questions_locked_at','timestamp with time zone',false],['gradebook_category_id','uuid',false],['gradebook_weight','integer',true],
  ['gradebook_maximum_override','numeric',false],['gradebook_score_scale','numeric',true],
] as const
const draftColumnTypes = [
  ['id','uuid',true],['assessment_type','text',true],['assessment_id','uuid',true],['classroom_id','uuid',true],['content','jsonb',true],
  ['version','integer',true],['created_by','uuid',true],['updated_by','uuid',true],['created_at','timestamp with time zone',true],
  ['updated_at','timestamp with time zone',true],
] as const
const testConstraints = [
  ['tests_pkey','p'],['tests_classroom_id_fkey','f'],['tests_status_check','c'],['tests_points_possible_check','c'],['tests_created_by_fkey','f'],
  ['tests_source_blueprint_version_id_fkey','f'],['tests_gradebook_category_id_fkey','f'],['tests_gradebook_weight_range_check','c'],
  ['tests_gradebook_maximum_valid','c'],['tests_gradebook_scale_valid','c'],
] as const
const draftConstraints = [
  ['assessment_drafts_pkey','p'],['assessment_drafts_assessment_type_check','c'],['assessment_drafts_classroom_id_fkey','f'],
  ['assessment_drafts_version_check','c'],['assessment_drafts_created_by_fkey','f'],['assessment_drafts_updated_by_fkey','f'],
  ['assessment_drafts_assessment_type_assessment_id_key','u'],['assessment_drafts_test_question_identity_version_check','c'],
] as const

function call(actor: string, classroom: string, title: string, deadline = "pg_catalog.clock_timestamp()+interval '2 seconds'") {
  return `public.create_test_for_owner_v1(${q(actor)}::uuid,${q(classroom)}::uuid,${title},${deadline})`
}
function rollbackProbe(label: string, body: string) {
  return `do $probe$ declare baseline jsonb;begin baseline:=pg_temp.owner_create_snapshot();
 begin ${body}
  raise exception using errcode='PT499',message=${q(`owner_create_probe:${label}`)};
 exception when sqlstate 'PT499' then if sqlerrm<>${q(`owner_create_probe:${label}`)} then raise;end if;end;
 if pg_temp.owner_create_snapshot() is distinct from baseline then raise exception 'Exact fixture rows changed between rollback probes: ${label}';end if;
 perform pg_temp.owner_create_note(${q(label)},true,'00000');
 exception when others then raise exception using errcode=${q(failureCode(label))},message='Closed owner-create proof failure';end;$probe$;`
}
function errorProbe(label: string, expression: string, expected: string, setup = '', verify = '') {
  return rollbackProbe(label, `${setup}
  begin perform ${expression};raise exception using errcode='P0001',message='Unexpected success: ${label}';
  exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text;
   if code<>${q(expected)} then raise exception 'Unexpected code for ${label}: % %',code,msg;end if;end;
  ${verify}`)
    .replace('declare baseline jsonb;', 'declare baseline jsonb;code text;msg text;')
}
function faultProbe(f: TestOwnerCreateFixture, label: string, table: 'tests'|'assessment_drafts', timing: 'before'|'after', body: string, expected: string, deadline?: string, proveReached = false) {
  const suffix = f.tag.slice(-12); const name = `zzz_owner_create_probe_${suffix}_${label.replaceAll('-', '_')}`
  const fn = `private.${name}`
  const marker = `owner_create_${suffix}_${label.replaceAll('-', '_')}_hit`
  const reached = proveReached ? `perform pg_catalog.nextval(${q(`pg_temp.${marker}`)}::regclass);` : ''
  const triggerBody = timing === 'after' ? `${reached}${body} return new;` : `${reached}${body}`
  const titleField = table === 'tests' ? 'new.title' : "new.content->>'title'"
  const scope = `if new.classroom_id is distinct from ${q(f.classes[0].id)}::uuid or ${titleField} is distinct from ${q(`${f.tag} ${label}`)} then return new;end if;`
  const setup = `${proveReached ? `create temp sequence ${marker};` : ''}create function ${fn}() returns trigger language plpgsql set search_path='' as $fault$ begin ${scope} ${triggerBody} end;$fault$;
  revoke all on function ${fn}() from public,anon,authenticated,service_role;
  create trigger ${name} ${timing} insert on public.${table} for each row execute function ${fn}();`
  const verify = proveReached ? `if pg_catalog.currval(${q(`pg_temp.${marker}`)}::regclass) is distinct from 1::bigint then raise exception 'Deadline trigger reach marker differs: ${label}';end if;` : ''
  return errorProbe(label, call(f.actors[0].id, f.classes[0].id, q(`${f.tag} ${label}`), deadline), expected, setup, verify)
}

function snapshotFunction(f: TestOwnerCreateFixture) {
  const classes = f.classes.map(c => q(c.id)).join(',')
  const actors = f.actors.map(a => q(a.id)).join(',')
  const tests = `select id from public.tests where classroom_id in (${classes})`
  const scopes: Array<[string,string]> = [
    ['users',`id in (${actors})`], ['classrooms',`id in (${classes})`], ['tests',`classroom_id in (${classes})`],
    ['gradebook_categories',`classroom_id in (${classes})`], ['assessment_drafts',`classroom_id in (${classes}) or assessment_id in (${tests})`],
    ['classroom_archive_revisions',`classroom_id in (${classes})`], ['classroom_enrollments',`classroom_id in (${classes})`],
    ['test_questions',`test_id in (${tests})`], ['test_attempts',`test_id in (${tests})`], ['test_responses',`test_id in (${tests})`],
    ['test_student_availability',`test_id in (${tests})`], ['test_focus_events',`test_id in (${tests})`],
    ['test_ai_grading_runs',`test_id in (${tests})`], ['test_ai_grading_run_items',`test_id in (${tests})`],
    ['gradebook_score_overrides',`classroom_id in (${classes}) and assessment_type='test'`],
    ['managed_storage_objects',`classroom_id in (${classes}) or resource_id in (${tests})`],
    ['managed_storage_json_references',`test_id in (${tests})`],
  ]
  return `create function pg_temp.owner_create_snapshot() returns jsonb language sql stable set search_path='' as $snap$
 select pg_catalog.jsonb_build_object(${scopes.map(([table,predicate]) => `${q(table)},(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value) order by pg_catalog.to_jsonb(row_value)::text),'[]'::jsonb) from public.${table} row_value where ${predicate})`).join(',')},
 'managed_storage_settings',(select pg_catalog.to_jsonb(settings) from public.managed_storage_settings settings where singleton))$snap$;`
}

function catalogSql() {
  const columnSet = (columns: string[]) => `(select pg_catalog.array_agg(column_name order by column_name collate "C") from pg_catalog.unnest(array[${columns.map(q).join(',')}]) column_name)`
  const tests = columnSet(expectedTestColumns)
  const drafts = columnSet(expectedDraftColumns)
  const testDefaults = columnSet(expectedTestDefaultColumns)
  const draftDefaults = columnSet(expectedDraftDefaultColumns)
  const types = (rows: readonly (readonly [string,string,boolean])[]) => `values ${rows.map(([name,type,notnull]) => `(${q(name)},${q(type)},${notnull})`).join(',')}`
  const constraints = (rows: readonly (readonly [string,string])[]) => `values ${rows.map(([name,type]) => `(${q(name)},${q(type)})`).join(',')}`
  const triggers = `values ${triggerPairs.map(([table,name,schema,fn,type]) => `(${q(table)},${q(name)},${q(schema)},${q(fn)},${type})`).join(',')}`
  const sql = `do $catalog$ declare p pg_proc;actual text[];bad integer;idx record;begin
 select proc.* into p from pg_proc proc join pg_namespace n on n.oid=proc.pronamespace
 where n.nspname='public' and proc.oid='public.create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)'::regprocedure;
 if not found or p.proowner::regrole::text<>'postgres' or not p.prosecdef or p.prorettype::regtype::text<>'jsonb'
 or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.proconfig is null or pg_catalog.cardinality(p.proconfig)<>2
 or not p.proconfig @> array['search_path=""','lock_timeout=1s']
 or pg_catalog.has_function_privilege('anon',p.oid,'execute') or pg_catalog.has_function_privilege('authenticated',p.oid,'execute')
 or not pg_catalog.has_function_privilege('service_role',p.oid,'execute')
 or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
   where acl.privilege_type='EXECUTE' and acl.grantee not in (p.proowner,'service_role'::regrole))
 then raise exception 'Function owner/SECDEF/search_path/locktimeout/ACL catalog differs';end if;
 select pg_catalog.array_agg(a.attname::text order by a.attname::text collate "C") into actual from pg_attribute a where a.attrelid='public.tests'::regclass and a.attnum>0 and not a.attisdropped;
 if actual is distinct from ${tests} then raise exception 'Exact21 Test columns differ';end if;
 select pg_catalog.array_agg(a.attname::text order by a.attname::text collate "C") into actual from pg_attribute a where a.attrelid='public.assessment_drafts'::regclass and a.attnum>0 and not a.attisdropped;
 if actual is distinct from ${drafts} then raise exception 'Exact10 draft columns differ';end if;
 select count(*) into bad from (${types(testColumnTypes)}) expected(name,type_name,not_null)
  left join pg_attribute a on a.attrelid='public.tests'::regclass and a.attname=expected.name and a.attnum>0 and not a.attisdropped
  where a.attname is null or pg_catalog.format_type(a.atttypid,a.atttypmod) is distinct from expected.type_name or a.attnotnull is distinct from expected.not_null;
 if bad<>0 then raise exception 'Test column types/nullability differ';end if;
 select count(*) into bad from (${types(draftColumnTypes)}) expected(name,type_name,not_null)
  left join pg_attribute a on a.attrelid='public.assessment_drafts'::regclass and a.attname=expected.name and a.attnum>0 and not a.attisdropped
  where a.attname is null or pg_catalog.format_type(a.atttypid,a.atttypmod) is distinct from expected.type_name or a.attnotnull is distinct from expected.not_null;
 if bad<>0 then raise exception 'Draft column types/nullability differ';end if;
 select pg_catalog.array_agg(a.attname::text order by a.attname::text collate "C") into actual from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.tests'::regclass;
 if actual is distinct from ${testDefaults} then raise exception 'Exact Test default columns differ';end if;
 select pg_catalog.array_agg(a.attname::text order by a.attname::text collate "C") into actual from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.assessment_drafts'::regclass;
 if actual is distinct from ${draftDefaults} then raise exception 'Exact draft default columns differ';end if;
 if (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.tests'::regclass and a.attname='gradebook_weight') not in ('-1','''-1''::integer')
 or (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.tests'::regclass and a.attname='gradebook_score_scale') not in ('1','''1''::numeric')
 or (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.tests'::regclass and a.attname='id') is distinct from 'gen_random_uuid()'
 or (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.tests'::regclass and a.attname='artifact_id') is distinct from 'gen_random_uuid()'
 or (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.tests'::regclass and a.attname='status') is distinct from '''draft''::text'
 or (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.tests'::regclass and a.attname='show_results') is distinct from 'false'
 or (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.tests'::regclass and a.attname='documents') is distinct from '''[]''::jsonb'
 or (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.assessment_drafts'::regclass and a.attname='content') is distinct from '''{}''::jsonb'
 or (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.assessment_drafts'::regclass and a.attname='version') not in ('1','''1''::integer')
 then raise exception 'Defaults differ';end if;
 select count(*) into bad from (
  ((select c.conname::text name,c.contype::text type from pg_constraint c where c.conrelid='public.tests'::regclass)
  except (select * from (${constraints(testConstraints)}) expected(name,type)))
  union all
  ((select * from (${constraints(testConstraints)}) expected(name,type))
  except (select c.conname::text,c.contype::text from pg_constraint c where c.conrelid='public.tests'::regclass))
 ) delta;if bad<>0 then raise exception 'Exact Test constraints differ';end if;
 select count(*) into bad from (
  ((select c.conname::text name,c.contype::text type from pg_constraint c where c.conrelid='public.assessment_drafts'::regclass)
  except (select * from (${constraints(draftConstraints)}) expected(name,type)))
  union all
  ((select * from (${constraints(draftConstraints)}) expected(name,type))
  except (select c.conname::text,c.contype::text from pg_constraint c where c.conrelid='public.assessment_drafts'::regclass))
 ) delta;if bad<>0 then raise exception 'Exact draft constraints differ';end if;
 if exists(select 1 from pg_constraint c where c.conrelid in ('public.tests'::regclass,'public.assessment_drafts'::regclass)
   and (not c.convalidated or c.condeferrable or c.condeferred))
 or (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid='public.tests'::regclass and c.conname='tests_gradebook_weight_range_check') not like '%gradebook_weight%0%999%'
 or (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid='public.assessment_drafts'::regclass and c.conname='assessment_drafts_assessment_type_assessment_id_key')<>'UNIQUE (assessment_type, assessment_id)'
 then raise exception 'Constraint validation/mode/body differs';end if;
 select i.indisunique,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) definition,
  (i.indrelid='public.tests'::regclass and i.indnkeyatts=3 and i.indnatts=3
   and i.indoption[0]=0 and i.indoption[1]=3 and i.indoption[2]=3
   and i.indpred is null and i.indexprs is null and am.amname='btree') exact_shape into idx from pg_index i
 join pg_class ix on ix.oid=i.indexrelid join pg_am am on am.oid=ix.relam
 where i.indexrelid='public.idx_tests_classroom_position_owner_create'::regclass;
 if not found or idx.indisunique or not idx.indisvalid or not idx.indisready
 or idx.exact_shape is distinct from true
 or pg_catalog.pg_get_indexdef('public.idx_tests_classroom_position_owner_create'::regclass,1,true)<>'classroom_id'
 or pg_catalog.pg_get_indexdef('public.idx_tests_classroom_position_owner_create'::regclass,2,true) not in ('position','"position"')
 or pg_catalog.pg_get_indexdef('public.idx_tests_classroom_position_owner_create'::regclass,3,true)<>'id'
 then raise exception 'Position index differs';end if;
 select count(*) into bad from (
  ((select c.relname::text,t.tgname::text,fnn.nspname::text,fn.proname::text,t.tgtype::integer from pg_trigger t join pg_class c on c.oid=t.tgrelid
   join pg_namespace n on n.oid=c.relnamespace join pg_proc fn on fn.oid=t.tgfoid join pg_namespace fnn on fnn.oid=fn.pronamespace
   where n.nspname='public' and c.relname in ('tests','assessment_drafts') and not t.tgisinternal)
  except (select * from (${triggers}) expected(table_name,trigger_name,function_schema,function_name,trigger_type)))
  union all
  ((select * from (${triggers}) expected(table_name,trigger_name,function_schema,function_name,trigger_type))
  except (select c.relname::text,t.tgname::text,fnn.nspname::text,fn.proname::text,t.tgtype::integer from pg_trigger t join pg_class c on c.oid=t.tgrelid
   join pg_namespace n on n.oid=c.relnamespace join pg_proc fn on fn.oid=t.tgfoid join pg_namespace fnn on fnn.oid=fn.pronamespace
   where n.nspname='public' and c.relname in ('tests','assessment_drafts') and not t.tgisinternal))
 ) delta;if bad<>0 then raise exception 'Exact noninternal trigger closure differs';end if;
 if exists(select 1 from pg_trigger t where t.tgrelid in ('public.tests'::regclass,'public.assessment_drafts'::regclass)
   and not t.tgisinternal and (t.tgenabled<>'O' or t.tgdeferrable or t.tginitdeferred))
 then raise exception 'Trigger enable/deferral mode differs';end if;
 perform pg_temp.owner_create_note('catalog-250',true,'00000');end;$catalog$;`
  return Object.entries(catalogFailures).reduce((statement, [label, message]) => {
    const needle = `raise exception ${q(message)};`
    assert.equal(statement.split(needle).length, 2)
    return statement.replace(needle, `raise exception using errcode=${q(failureCode(label))},message=${q(message)};`)
  }, sql)
}

function strictPairHelper() {
  return `create function pg_temp.owner_create_assert_pair(r jsonb,actor uuid,classroom uuid,title text,prior_position integer,blueprint_before bigint,archive_before bigint,settings_before jsonb,category_before jsonb)
 returns integer language plpgsql set search_path='' as $pair$ declare test_row public.tests;draft_row public.assessment_drafts;position_value integer;begin
 if r is null or (select count(*) from pg_catalog.jsonb_object_keys(r))<>6
 or r->>'version' is distinct from '1' or (r->>'actor_id')::uuid is distinct from actor or (r->>'classroom_id')::uuid is distinct from classroom or r->>'test_id' is distinct from r->'test'->>'id'
 then raise exception 'RPC envelope differs';end if;
 select t.* into strict test_row from public.tests t where t.id=(r->>'test_id')::uuid;
 select d.* into strict draft_row from public.assessment_drafts d where d.assessment_type='test' and d.assessment_id=test_row.id;
 if pg_catalog.to_jsonb(test_row) is distinct from r->'test' or pg_catalog.to_jsonb(draft_row) is distinct from r->'draft'
 or (select count(*) from pg_catalog.jsonb_object_keys(r->'test'))<>21 or (select count(*) from pg_catalog.jsonb_object_keys(r->'draft'))<>10
 or test_row.classroom_id is distinct from classroom or test_row.created_by is distinct from actor or test_row.title is distinct from title or test_row.status is distinct from 'draft' or test_row.show_results is distinct from false
 or test_row.position is distinct from prior_position+1 or test_row.points_possible is distinct from 100 or test_row.include_in_final is distinct from true or test_row.documents is distinct from '[]'::jsonb
 or draft_row.classroom_id is distinct from classroom or draft_row.created_by is distinct from actor or draft_row.updated_by is distinct from actor or draft_row.version is distinct from 1
 or draft_row.content is distinct from pg_catalog.jsonb_build_object('title',title,'show_results',false,'question_identity_version',1,'questions','[]'::jsonb,'source_format','markdown')
 or (select blueprint_source_revision from public.classrooms where id=classroom) is distinct from blueprint_before + 2
 or (select revision from public.classroom_archive_revisions where classroom_id=classroom) is distinct from archive_before + 4
 or (select pg_catalog.to_jsonb(s) from public.managed_storage_settings s where singleton) is distinct from settings_before
 then raise exception 'Strict full pair/default/revision/settings witness differs';end if;
 if category_before is null then
  if test_row.gradebook_category_id is not null or test_row.gradebook_weight is distinct from 10 then raise exception 'Uncategorized fallback differs';end if;
 else
  if test_row.gradebook_category_id is distinct from (category_before->>'id')::uuid or test_row.gradebook_weight is distinct from (category_before->>'default_assessment_weight')::integer
   or (select pg_catalog.to_jsonb(c) from public.gradebook_categories c where c.id=(category_before->>'id')::uuid) is distinct from category_before
  then raise exception 'Category default/equality differs';end if;
 end if;
 if exists(select 1 from public.test_questions where test_id=test_row.id) or exists(select 1 from public.test_attempts where test_id=test_row.id)
 or exists(select 1 from public.assessment_drafts where assessment_type='test' and assessment_id=test_row.id limit 1 offset 1)
 or exists(select 1 from public.managed_storage_json_references where test_id=test_row.id)
 or exists(select 1 from public.managed_storage_objects where classroom_id=classroom and resource_id=test_row.id)
 then raise exception 'Fresh pair side effects differ';end if;
 position_value:=test_row.position;return position_value;end;$pair$;`
}

function successProbe(f: TestOwnerCreateFixture) {
  const student=f.actors[0].id, teacher=f.actors[1].id, sc=f.classes[0].id, tc=f.classes[1].id, bulk=f.classes[3].id
  const title1=q(`${f.tag} student one`), title2=q(`${f.tag} student two`), title3=q(`${f.tag} teacher`), title4=q(`${f.tag} bulk`)
  return rollbackProbe('student-owner-create', `
  select coalesce(max(test.position),-1),classroom.blueprint_source_revision,(select revision from public.classroom_archive_revisions where classroom_id=${q(sc)}::uuid),
   (select pg_catalog.to_jsonb(s) from public.managed_storage_settings s where singleton),
   (select pg_catalog.to_jsonb(c) from public.gradebook_categories c where c.classroom_id=${q(sc)}::uuid order by c.is_default desc,c.position,c.id limit 1)
   into pos,bp,ar,settings,category from public.classrooms classroom left join public.tests test on test.classroom_id=classroom.id where classroom.id=${q(sc)}::uuid group by classroom.blueprint_source_revision;
  r1:=${call(student,sc,title1)};p1:=pg_temp.owner_create_assert_pair(r1,${q(student)},${q(sc)},${title1},pos,bp,ar,settings,category);
  select blueprint_source_revision into bp from public.classrooms where id=${q(sc)}::uuid;select revision into ar from public.classroom_archive_revisions where classroom_id=${q(sc)}::uuid;
  r2:=${call(student,sc,title2)};p2:=pg_temp.owner_create_assert_pair(r2,${q(student)},${q(sc)},${title2},p1,bp,ar,settings,category);
  if p2 is distinct from p1+1 then raise exception 'Same-transaction create position increment differs';end if;
  select coalesce(max(test.position),-1),classroom.blueprint_source_revision,(select revision from public.classroom_archive_revisions where classroom_id=${q(tc)}::uuid),
   (select pg_catalog.to_jsonb(s) from public.managed_storage_settings s where singleton),
   (select pg_catalog.to_jsonb(c) from public.gradebook_categories c where c.classroom_id=${q(tc)}::uuid order by c.is_default desc,c.position,c.id limit 1)
   into pos,bp,ar,settings,category from public.classrooms classroom left join public.tests test on test.classroom_id=classroom.id where classroom.id=${q(tc)}::uuid group by classroom.blueprint_source_revision;
  r3:=${call(teacher,tc,title3)};perform pg_temp.owner_create_assert_pair(r3,${q(teacher)},${q(tc)},${title3},pos,bp,ar,settings,category);`)
  .replace('declare baseline jsonb;', 'declare baseline jsonb;r1 jsonb;r2 jsonb;r3 jsonb;settings jsonb;category jsonb;pos integer;p1 integer;p2 integer;bp bigint;ar bigint;')
  +`do $teacher_evidence$ begin perform pg_temp.owner_create_note('teacher-owner-create',true,'00000');end;$teacher_evidence$;`
  + rollbackProbe('bulk-1001-retired-max', `
  if (select count(*) from (select 1 from public.tests where classroom_id=${q(bulk)}::uuid limit 1001) bounded)<>1001
   or not exists(select 1 from public.tests where classroom_id=${q(bulk)}::uuid and position=1000 and blueprint_archived_at is not null) then raise exception 'Finite1001 retired source differs';end if;
  select max(position) into pos from public.tests where classroom_id=${q(bulk)}::uuid;
  if pos<1000 then raise exception 'Complete bulk maximum differs';end if;
  select blueprint_source_revision into bp from public.classrooms where id=${q(bulk)}::uuid;select revision into ar from public.classroom_archive_revisions where classroom_id=${q(bulk)}::uuid;
  select pg_catalog.to_jsonb(s) into settings from public.managed_storage_settings s where singleton;
  select pg_catalog.to_jsonb(c) into category from public.gradebook_categories c where c.classroom_id=${q(bulk)}::uuid order by c.is_default desc,c.position,c.id limit 1;
  r:=${call(student,bulk,title4)};if pg_temp.owner_create_assert_pair(r,${q(student)},${q(bulk)},${title4},pos,bp,ar,settings,category) is distinct from pos+1 or (r->'test'->>'position')::integer is distinct from pos+1 then raise exception 'Bulk position differs';end if;`)
  .replace('declare baseline jsonb;', 'declare baseline jsonb;r jsonb;settings jsonb;category jsonb;pos integer;bp bigint;ar bigint;')
}

function categoryProbes(f: TestOwnerCreateFixture) {
  const actor=f.actors[0].id,c=f.classes[0].id
  const run=(label:string,setup:string,expected:string)=>rollbackProbe(label,`${setup}
   select coalesce(max(test.position),-1),classroom.blueprint_source_revision,(select revision from public.classroom_archive_revisions where classroom_id=${q(c)}::uuid),
    (select pg_catalog.to_jsonb(s) from public.managed_storage_settings s where singleton),
    (select pg_catalog.to_jsonb(g) from public.gradebook_categories g where g.classroom_id=${q(c)}::uuid order by g.is_default desc,g.position,g.id limit 1)
    into pos,bp,ar,settings,category from public.classrooms classroom left join public.tests test on test.classroom_id=classroom.id where classroom.id=${q(c)}::uuid group by classroom.blueprint_source_revision;
   r:=${call(actor,c,q(`${f.tag} ${label}`))};perform pg_temp.owner_create_assert_pair(r,${q(actor)},${q(c)},${q(`${f.tag} ${label}`)},pos,bp,ar,settings,category);
   if ${expected} then raise exception 'Category probe differs: ${label}';end if;`)
   .replace('declare baseline jsonb;', 'declare baseline jsonb;r jsonb;settings jsonb;category jsonb;pos integer;bp bigint;ar bigint;')
  return run('uncategorized-fallback',`delete from public.gradebook_categories where classroom_id=${q(c)}::uuid;`,`r->'test'->'gradebook_category_id' is distinct from 'null'::jsonb or r->'test'->>'gradebook_weight' is distinct from '10'`)
   +run('custom-category-default',`update public.gradebook_categories set percentage=0,default_assessment_weight=27 where id=(select id from public.gradebook_categories where classroom_id=${q(c)}::uuid order by is_default desc,position,id limit 1);`,`r->'test'->>'gradebook_weight' is distinct from '27'`)
}

function ordinaryErrors(f: TestOwnerCreateFixture) {
  const owner=f.actors[0].id, other=f.actors[1].id,c=f.classes[0].id,arch=f.classes[2].id,bulk=f.classes[3].id
  return [
    errorProbe('invalid-null-title',call(owner,c,'null'),'PT400'),
    errorProbe('invalid-blank-title',call(owner,c,q(' \t\n')),'PT400'),
    errorProbe('invalid-long-title',call(owner,c,`pg_catalog.repeat('x',501)`),'PT400'),
    errorProbe('invalid-deadline',call(owner,c,q('deadline'),"pg_catalog.clock_timestamp()+interval '30 seconds'"),'PT400'),
    errorProbe('expired-deadline',call(owner,c,q('expired'),"pg_catalog.clock_timestamp()-interval '1 millisecond'"),'PT503'),
    errorProbe('wrong-owner',call(other,c,q('wrong')),'PT403'),
    errorProbe('missing-classroom',call(owner,f.missingClassroomId,q('missing')),'PT404'),
    errorProbe('archived-owner',call(owner,arch,q('archived')),'PT403'),
    errorProbe('restore-fence',call(owner,c,q('restore')),'PT403',"perform pg_catalog.set_config('pika.classroom_archive_restore','on',true);"),
    errorProbe('compaction-fence',call(owner,c,q('compact')),'PT403',"perform pg_catalog.set_config('pika.classroom_archive_compaction','on',true);"),
    errorProbe('identity-fence',call(owner,c,q('identity')),'PT403',"perform pg_catalog.set_config('pika.identity_mapping','on',true);"),
    errorProbe('position-intmax',call(owner,bulk,q('overflow')),'PT503',`update public.tests set position=2147483647 where id=${q(f.tests[1000].id)}::uuid;`),
    errorProbe('missing-revision',call(owner,c,q('missing revision')),'PT503',`delete from public.classroom_archive_revisions where classroom_id=${q(c)}::uuid;`),
    errorProbe('missing-settings',call(owner,c,q('missing settings')),'PT503',`delete from public.managed_storage_settings where singleton;`),
  ].join('\n')
}

function lifecycleStateProbes(f: TestOwnerCreateFixture) {
  const owner=f.actors[0].id,c=f.classes[0].id
  const hot=`do $state$ declare operation_id uuid:=pg_catalog.gen_random_uuid();begin
   insert into public.classroom_purge_operations(id,teacher_id,classroom_id,classroom_title,request_sha256,status,source_revision,impact_summary)
    values(operation_id,${q(owner)}::uuid,${q(c)}::uuid,${q(f.tag + ' hot')},pg_catalog.repeat('a',64),'inventorying',1,'{}'::jsonb);
   insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values(${q(c)}::uuid,operation_id,${q(owner)}::uuid);
  end;$state$;`
  const cold=`do $state$ declare export_id uuid:=pg_catalog.gen_random_uuid();archive_id uuid:=pg_catalog.gen_random_uuid();object_id uuid:=pg_catalog.gen_random_uuid();operation_id uuid:=pg_catalog.gen_random_uuid();stamp timestamptz:=pg_catalog.clock_timestamp();path text:=${q(f.tag + '/cold-probe')};begin
   insert into public.managed_storage_objects(id,storage_bucket,storage_path,classroom_id,purpose,status,created_by_user_id,resource_type,resource_id,content_type,byte_size,content_sha256,verified_at,ready_at)
    values(object_id,'classroom-archives',path,${q(c)}::uuid,'classroom_archive','ready',${q(owner)}::uuid,'classroom_archive_operation',export_id,'application/gzip',1,pg_catalog.repeat('e',64),stamp,stamp);
   insert into public.classroom_archive_operations(id,teacher_id,classroom_id,operation_type,request_sha256,status,source_revision,source_schema_migration,source_app_commit,retention,snapshot_created_at,snapshot_expires_at,completed_at,storage_bucket,storage_path,managed_object_id)
    values(export_id,${q(owner)}::uuid,${q(c)}::uuid,'export',pg_catalog.repeat('b',64),'completed',1,'250_contextual_test_owner_create',pg_catalog.repeat('c',40),'{}'::jsonb,stamp,stamp+interval '1 hour',stamp,'classroom-archives',path,object_id);
   insert into public.classroom_archives(id,operation_id,classroom_id,teacher_id,format,format_version,source_revision,source_schema_migration,source_app_commit,storage_bucket,storage_path,artifact_sha256,content_sha256,compressed_byte_size,uncompressed_byte_size,resource_counts,storage_object_counts,verification,retention,created_at,verified_at)
    values(archive_id,export_id,${q(c)}::uuid,${q(owner)}::uuid,'pika.classroom-archive',1,1,'250_contextual_test_owner_create',pg_catalog.repeat('c',40),'classroom-archives',path,pg_catalog.repeat('d',64),pg_catalog.repeat('e',64),1,1,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,stamp,stamp);
   insert into public.classroom_cold_tombstones(classroom_id,teacher_id,archive_id,title,archived_at,compacted_at,source_revision)
    values(${q(c)}::uuid,${q(owner)}::uuid,archive_id,${q(f.tag + ' cold')},stamp,stamp,1);
   insert into public.classroom_purge_operations(id,teacher_id,classroom_id,classroom_title,request_sha256,status,source_revision,impact_summary,purge_scope,cold_archive_id)
    values(operation_id,${q(owner)}::uuid,${q(c)}::uuid,${q(f.tag + ' cold')},pg_catalog.repeat('f',64),'inventorying',1,'{}'::jsonb,'cold_classroom',archive_id);
   insert into public.cold_classroom_purge_fences(classroom_id,operation_id,teacher_id,archive_id) values(${q(c)}::uuid,operation_id,${q(owner)}::uuid,archive_id);
  end;$state$;`
  const attendance=(state:string)=>`insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,installation_ref,roster_ref,actor_principal_ref,state)
   values(pg_catalog.gen_random_uuid(),${q(c)}::uuid,${q(owner)}::uuid,${q(`${f.tag}_${state}`)},${q(`roster_${f.tag.slice(-12)}${state.replaceAll('_','')}`)},${q(`principal_${f.tag.slice(-12)}${state.replaceAll('_','')}`)},${q(state)});`
  return [
    errorProbe('hot-purge-fence-state',call(owner,c,q(`${f.tag} hot purge`)),'PT403',hot),
    errorProbe('cold-purge-fence-state',call(owner,c,q(`${f.tag} cold purge`)),'PT403',cold),
    ...['fenced','remote_deleted','local_deleted'].map(state => errorProbe(`attendance-decommission-${state}`,call(owner,c,q(`${f.tag} attendance ${state}`)),'PT403',attendance(state))),
  ].join('\n')
}

function faults(f: TestOwnerCreateFixture) {
  const otherClass=f.classes[1].id
  return [
    faultProbe(f,'known-55000','tests','before',"raise exception using errcode='55000',message='classroom_purge_active';",'PT403'),
    faultProbe(f,'unknown-55000','tests','before',"raise exception using errcode='55000',message='owner_create_unknown_probe';",'55000'),
    faultProbe(f,'raw-42501','tests','before',"raise exception using errcode='42501',message='owner_create_raw_privilege_probe';",'42501'),
    faultProbe(f,'suppress-test','tests','before','return null;','PT503'),
    faultProbe(f,'fail-test','tests','before',"raise exception using errcode='55000',message='owner_create_test_failure';",'55000'),
    faultProbe(f,'suppress-draft','assessment_drafts','before','return null;','PT503'),
    faultProbe(f,'fail-draft','assessment_drafts','before',"raise exception using errcode='55000',message='owner_create_draft_failure';",'55000'),
    faultProbe(f,'drift-test-before','tests','before',"new.title:=new.title||' drift';return new;",'PT503'),
    faultProbe(f,'drift-test-after','tests','after',"update public.tests set show_results=true where id=new.id;",'PT503'),
    faultProbe(f,'drift-draft-before','assessment_drafts','before',"new.content:=pg_catalog.jsonb_set(new.content,'{title}','\"drift\"'::jsonb);return new;",'PT503'),
    faultProbe(f,'drift-draft-after','assessment_drafts','after',"update public.assessment_drafts set version=version+1 where id=new.id;",'PT503'),
    faultProbe(f,'drift-test-identity','tests','before',"new.id:=pg_catalog.gen_random_uuid();return new;",'PT503'),
    faultProbe(f,'drift-draft-identity','assessment_drafts','before',"new.id:=pg_catalog.gen_random_uuid();return new;",'PT503'),
    faultProbe(f,'drift-defaults','tests','before',"new.status:='active';return new;",'PT503'),
    faultProbe(f,'drift-parent','tests','before',`new.classroom_id:=${q(otherClass)}::uuid;return new;`,'PT503'),
    faultProbe(f,'drift-revisions','assessment_drafts','after',"update public.classrooms set blueprint_source_revision=blueprint_source_revision+1 where id=new.classroom_id;",'PT503'),
    faultProbe(f,'drift-settings','assessment_drafts','after',"update public.managed_storage_settings set updated_at=pg_catalog.clock_timestamp() where singleton;",'PT503'),
    faultProbe(f,'drift-category','assessment_drafts','after',"update public.gradebook_categories set updated_at=pg_catalog.clock_timestamp() where id=(select gradebook_category_id from public.tests where id=new.assessment_id);",'PT503'),
    faultProbe(f,'deadline-after-test','tests','after','perform pg_catalog.pg_sleep(0.1);','PT503',"pg_catalog.clock_timestamp()+interval '50 milliseconds'",true),
    faultProbe(f,'deadline-after-draft','assessment_drafts','after','perform pg_catalog.pg_sleep(0.1);','PT503',"pg_catalog.clock_timestamp()+interval '50 milliseconds'",true),
  ].join('\n')
}

function contractsSql(f: TestOwnerCreateFixture) {
  const remaining = ['hot/cold purge and attendance-decommission concurrent races (single-transaction lifecycle row states are covered here)','settings/classroom/revision/actor/category/advisory held-lock races','two-session create serialization and legacy stale-MAX interaction','whole-project external pre/post rollback equality and installed-SDK execution']
  return bounded(`begin;set local lock_timeout='1s';set local statement_timeout='35s';
create temp table owner_create_evidence(label text primary key,ok boolean not null,code text not null) on commit drop;
create function pg_temp.owner_create_note(p_label text,p_ok boolean,p_code text) returns void language plpgsql set search_path='' as $note$ begin
 if pg_catalog.octet_length(p_label)>80 or p_code!~'^[A-Z0-9]{5}$' then raise exception 'Evidence bound differs';end if;
 insert into pg_temp.owner_create_evidence values(p_label,p_ok,p_code);end;$note$;
${snapshotFunction(f)}
create temp table owner_create_initial on commit drop as select pg_temp.owner_create_snapshot() value;
${strictPairHelper()}
${catalogSql()}
${successProbe(f)}
${categoryProbes(f)}
${ordinaryErrors(f)}
${lifecycleStateProbes(f)}
${faults(f)}
do $final$ begin
 if pg_temp.owner_create_snapshot() is distinct from (select value from pg_temp.owner_create_initial) then raise exception using errcode=${q(failureCode('final-fixture-equality'))},message='Exact fixture rows changed between rollback probes: final';end if;
 perform pg_temp.owner_create_note('missing-actor-skipped-fk',false,'SKIP0');
end;$final$;
create temp table owner_create_result on commit drop as select pg_catalog.jsonb_build_object('version',1,'native_execution',true,'rollback_only',true,'fixture_tag',${q(f.tag)},
 'checks',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('label',label,'ok',ok,'code',code) order by label) from pg_temp.owner_create_evidence),
 'check_count',(select count(*) from pg_temp.owner_create_evidence),'catalog_hashes',pg_catalog.jsonb_build_object(
  'function',pg_catalog.md5(pg_catalog.pg_get_functiondef('public.create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)'::regprocedure)),
  'tests',pg_catalog.md5((select pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text,',' order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid='public.tests'::regclass and a.attnum>0 and not a.attisdropped)),
  'drafts',pg_catalog.md5((select pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text,',' order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid='public.assessment_drafts'::regclass and a.attnum>0 and not a.attisdropped))),
 'counts',pg_catalog.jsonb_build_object('fixture_tests',(select count(*) from public.tests where classroom_id=any(array[${f.classes.map(c=>`${q(c.id)}::uuid`).join(',')}])),
  'fixture_classes',(select count(*) from public.classrooms where id=any(array[${f.classes.map(c=>`${q(c.id)}::uuid`).join(',')}]))),
 'missing_actor_probe','skipped: classroom teacher FK prevents isolating a missing actor without deleting/reparenting the owned Class',
 'deferred',${q(JSON.stringify(remaining))}::jsonb,'logical_deadline_only',true) value;
do $bound$ begin if (select pg_catalog.octet_length(value::text) from pg_temp.owner_create_result)>65536 then raise exception using errcode=${q(failureCode('evidence-bound'))},message='Evidence result exceeds 64KiB';end if;end;$bound$;
select value as result from pg_temp.owner_create_result;
rollback;`)
}

// Row-read-only catalog/plan inspection. The fixed pg_temp helper is transaction-
// local DDL, so this bundle deliberately does not claim READ ONLY transaction mode.
function catalogAndPlan(f: TestOwnerCreateFixture) {
  const bulk=f.classes[3].id
  return bounded(`begin;set local lock_timeout='1s';set local statement_timeout='12s';
create function pg_temp.owner_create_explain() returns jsonb language plpgsql set search_path='' as $plan$ declare plan json;begin
 execute ${q(`explain (format json, costs false) select test.position from public.tests test where test.classroom_id=${q(bulk)}::uuid order by test.position desc,test.id desc limit 1`)} into plan;
 return plan::jsonb;end;$plan$;
select pg_catalog.jsonb_build_object('function',pg_catalog.md5(pg_catalog.pg_get_functiondef('public.create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)'::regprocedure)),
 'index',pg_catalog.pg_get_indexdef('public.idx_tests_classroom_position_owner_create'::regclass),
 'test_columns',(select pg_catalog.jsonb_agg(a.attname order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid='public.tests'::regclass and a.attnum>0 and not a.attisdropped),
 'draft_columns',(select pg_catalog.jsonb_agg(a.attname order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid='public.assessment_drafts'::regclass and a.attnum>0 and not a.attisdropped),
 'plan',pg_temp.owner_create_explain()) as result;
rollback;`)
}

export function testOwnerCreateContractsManifest(f: TestOwnerCreateFixture) {
  validateFixture(f)
  return freeze({ version: 1 as const, caps: TEST_OWNER_CREATE_DB_CAPS, contracts: contractsSql(f),
    catalogAndPlan: catalogAndPlan(f), remainingNativeObligations: [
      'hot/cold purge and attendance-decommission concurrent races (single-transaction lifecycle row states are covered here)',
      'settings/classroom/revision/actor/category/advisory held-lock races',
      'two-session create serialization and legacy stale-MAX interaction',
      'whole-project external pre/post rollback equality and installed-SDK execution',
    ] as const })
}
