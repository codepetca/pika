/** Inert source preparation. No import-time IO, connection, CLI or SQL execution.
 * Native acceptance requires a separately reviewed disposable target and driver.
 * Every fixed batch rolls back and compares the complete fixture/non-target graph.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  testOwnerReorderRequest, testOwnerReorderSnapshotExpressionSql,
  type TestOwnerReorderFixture,
} from './contextual-test-reorder-proof-fixture'
import type { DraftSaveDriver, DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'

export const TEST_OWNER_REORDER_SOURCE_SHA256 = '71ed984850fdcf7205ddf9245f4dfc89dc8102caf3dcee0772104eb0f0e94006' as const
// Proof-only SQLSTATEs: never print PostgreSQL messages, rows or query context.
// Unknown PT503 messages propagate unchanged; every mapped failure still aborts.
export const TEST_OWNER_REORDER_BULK_FAILURE_CODES = Object.freeze({
  PRD01: 'test_reorder_deadline', PRD02: 'test_reorder_source_limit',
  PRD03: 'test_reorder_catalog_changed', PRD04: 'test_reorder_invalid_source',
  PRD05: 'test_reorder_revision_limit', PRD06: 'test_reorder_postcondition_failed',
  PRD07: 'test_reorder_result_limit',
} as const)
// Cumulative deadline checkpoints, NOT per-query timings. Body-relative RAISE
// lines are bound to the exact migration SHA and verified during manifest build.
export const TEST_OWNER_REORDER_DEADLINE_PHASE_CODES = Object.freeze({
  PRD11: 50, PRD12: 121, PRD13: 212, PRD14: 229, PRD15: 288, PRD16: 298,
} as const)
export const TEST_OWNER_REORDER_DB_CAPS = Object.freeze({ sqlBytes: 262144, responseBytes: 1048576, actionMs: 35000, requestMs: 12000,
  logicalGroups: 9, batches: 27, probesPerBatch: 2 })
export const TEST_OWNER_REORDER_TEST_COLUMNS = Object.freeze(['id','classroom_id','title','status','show_results','position',
  'points_possible','include_in_final','created_by','created_at','updated_at','documents','gradebook_weight','artifact_id','source_artifact_id',
  'blueprint_archived_at','source_blueprint_version_id','questions_locked_at','gradebook_category_id','gradebook_maximum_override','gradebook_score_scale'] as const)
export const TEST_OWNER_REORDER_DB_LIMITATIONS = Object.freeze([
  'Inert source assertions are not native SQL, lock-race, SDK or preservation acceptance.',
  'Managed writer sequence consumption is nontransactional: never reset it or claim rollback equality; root separately attests no operation-caused calls.',
  'Legacy cached MAX(position) insertion after commit and nonconforming disabled-trigger writers remain residuals.',
  'Catalog routine-source equality seals the listed position path and immediate trigger entrypoints; native full-project receipts remain required.',
])
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const md5 = (value: string) => createHash('md5').update(value).digest('hex')
const j = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
function bounded(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_REORDER_DB_CAPS.sqlBytes, 'Reorder SQL action exceeds fixed cap'); return sql }
const issued = new WeakSet<object>()
const deadlineFrame = (line: number, schema = '') =>
  `PL/pgSQL function ${schema}reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamp with time zone) line ${line} at RAISE`
// SQL-only private context: exact first frame, never later query text/frames.
// Unknown/localized/oversized context keeps the original generic deadline code.
function deadlineCodeSql() {
  return `case when pg_catalog.octet_length(deadline_context)<=8192 then case pg_catalog.split_part(deadline_context,E'\\n',1)
 ${Object.entries(TEST_OWNER_REORDER_DEADLINE_PHASE_CODES).flatMap(([code, line]) =>
   ['', 'public.'].map(schema => `when ${q(deadlineFrame(line, schema))} then ${q(code)}`)).join('\n')}
 else 'PRD01' end else 'PRD01' end`
}
function deadlineCalibration(rpc: string) {
  const positive = Object.entries(TEST_OWNER_REORDER_DEADLINE_PHASE_CODES).flatMap(([code, line]) =>
    ['', 'public.'].map(schema => `(${q(deadlineFrame(line, schema))},${q(code)})`))
  const frame = deadlineFrame(50)
  const rejected = [null, '', 'forged prefix'+frame, frame.replace('line 50','line 51'),
    frame.replace('at RAISE','at PERFORM'), frame.replace('reorder_tests','private.reorder_tests'),
    frame.replace('uuid,uuid,uuid[]','uuid,uuid,text[]'), `foreign frame\n${frame}`,
    `${frame} trailing private data`, frame.replace('line 50', 'line 050')]
  const cases = [...positive, ...rejected.map(context => `(${context === null ? 'null::text' : q(context)},'PRD01')`),
    `(repeat('x',8193),'PRD01')`, `(${q(frame)}||E'\\n'||repeat('x',8193),'PRD01')`,
    `(${q(frame)}||E'\\nprivate caller query','PRD11')`]
  return probe('deadline-reached', `declare deadline_context text;deadline_code text;sample record;begin
 for sample in select * from(values ${cases.join(',')}) samples(context,code) loop
 deadline_context:=sample.context;deadline_code:=${deadlineCodeSql()};deadline_context:=null;
 if deadline_code is distinct from sample.code then raise exception 'Deadline classifier rejection differs';end if;end loop;
 begin perform ${rpc};raise exception 'Denied reorder succeeded';
 exception when sqlstate 'PT503' then
 if sqlerrm is distinct from 'test_reorder_deadline' then raise;end if;
 get stacked diagnostics deadline_context=pg_exception_context;
 deadline_code:=${deadlineCodeSql()};deadline_context:=null;
 if deadline_code is distinct from 'PRD11' then raise exception 'Deadline classifier calibration differs';end if;end;end;`)
}

// [trigger, function schema, function, type, UPDATE OF columns, WHEN predicate].
// Qualifiers are normalized only for PostgreSQL's whitespace/parentheses/casts.
const authored = ['title','show_results','documents','position','points_possible','include_in_final','gradebook_weight','artifact_id','source_artifact_id']
const triggers = [
  ['assign_test_default_gradebook_category','public','assign_default_gradebook_category',23,['gradebook_category_id','classroom_id'],''],
  ['car_tests','public','bump_classroom_archive_revision_from_resource',31,[],''],
  ['classroom_purge_fence_tests','public','reject_classroom_resource_change_during_purge',31,[],''],
  ['delete_test_gradebook_score_overrides','public','delete_gradebook_overrides_for_assessment',9,[],''],
  ['enqueue_obsolete_test_document_snapshots','public','enqueue_obsolete_test_document_snapshots',25,['documents'],"current_setting'pika.classroom_purge_finalize',trueisdistinctfrom'on'"],
  ['preserve_test_question_lock','private','preserve_test_question_lock',19,[],''],
  ['removed_academic_parent','private','guard_removed_academic_parent',27,['id','classroom_id'],''],
  ['tests_blueprint_purge_lineage_fence','public','guard_course_blueprint_version_lineage_write',31,['source_blueprint_version_id'],''],
  ['tests_managed_storage_remove','public','remove_managed_storage_json_host',11,[],''],
  ['tests_managed_storage_sync','public','sync_managed_storage_json_host',21,['documents'],''],
  ['touch_classroom_blueprint_source_from_tests_insert_delete','public','touch_classroom_blueprint_source_revision',13,[],''],
  ['touch_classroom_blueprint_source_from_tests_update','public','touch_classroom_blueprint_source_revision',17,authored,
    authored.map(column => `old.${column}isdistinctfromnew.${column}`).join('or')],
  ['update_tests_updated_at','public','update_tests_updated_at',19,[],''],
] as const
const routineSignatures = [
  ...new Set(triggers.map(t => `${t[1]}.${t[2]}()`)),
  'public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamptz)',
  'public.is_classroom_archive_maintenance_mode(text)',
  'public.resolve_classroom_archive_resource_classroom_id(text,uuid)',
  'public.bump_classroom_archive_revision_from_classroom()',
  'public.bump_classroom_blueprint_source_revision()',
  'public.update_updated_at_column()',
  'public.guard_classroom_purge_lifecycle(uuid)',
  'public.classroom_purge_try_lock(uuid)',
  'private.try_lock_classroom_membership_change(uuid,uuid)',
  'public.create_archived_classroom_blueprint_atomic(uuid,uuid,text,uuid,bigint,jsonb)',
] as const

/** Read immutable migration source only when explicitly building a manifest.
 * Compare exact prosrc hashes, including comments, without dumping routine text.
 */
function reachableFunctions(repository: string) {
  const directory = resolve(repository, 'supabase/migrations')
  const names = readdirSync(directory).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort()
  const latest = new Map<string, { sourceFile: string; body: string; header:string; suffix:string }>()
  for (const name of names) {
    const sql = readFileSync(resolve(directory, name), 'utf8')
    const pattern = /(?:^|\n)[ \t]*create(?:\s+or\s+replace)?\s+function\s+((?:(?:public|private)\.)?[a-z_0-9]+)\s*\([\s\S]*?\)\s*returns\b[\s\S]*?\bas\s+(\$[a-z_0-9]*\$)/gi
    let match: RegExpExecArray | null
    while ((match = pattern.exec(sql))) {
      const end = sql.indexOf(match[2], pattern.lastIndex); assert(end >= 0, 'Unclosed source routine')
      const qualifiedName = match[1].includes('.') ? match[1].toLowerCase() : `public.${match[1].toLowerCase()}`
      latest.set(qualifiedName, { sourceFile: name, body: sql.slice(pattern.lastIndex, end),header:sql.slice(match.index,pattern.lastIndex),
        suffix:sql.slice(end+match[2].length,sql.indexOf(';',end+match[2].length)) })
      pattern.lastIndex = end + match[2].length
    }
  }
  return freeze(routineSignatures.map(signature => {
    const source = latest.get(signature.split('(')[0]); assert(source, `Missing closed routine source: ${signature}`)
    const settings=[...source.header.matchAll(/\bset\s+(search_path|lock_timeout)\s*=\s*('(?:[^']|'')*'|[a-z_0-9]+)/gi)]
      .map(match=>`${match[1].toLowerCase()}=${match[2]==="''"?'""':match[2].replace(/^'|'$/g,'')}`)
    //075 hardens these early unqualified declarations without replacing prosrc.
    if(signature==='public.update_tests_updated_at()'||signature==='public.update_updated_at_column()') settings.push('search_path=public')
    const language=/\blanguage\s+'?(sql|plpgsql)'?/i.exec(source.header+source.suffix)?.[1]?.toLowerCase();assert(language)
    return { signature, sourceFile: source.sourceFile, prosrcMd5: md5(source.body), sourceSha256: hash(source.body),
      language,securityDefiner:/\bsecurity\s+definer\b/i.test(source.header),volatility:/\bstable\b/i.test(source.header)?'s':/\bimmutable\b/i.test(source.header)?'i':'v',proconfig:settings }
  }))
}

function catalogSql(routines: ReturnType<typeof reachableFunctions>) {
  const triggerArgs = (name:string) => name==='car_tests'||name==='classroom_purge_fence_tests' ? Buffer.from('classrooms\0classroom_id\0').toString('hex')
    :name==='delete_test_gradebook_score_overrides'?Buffer.from('test\0').toString('hex'):''
  const expectedTriggers = triggers.map(t => `(${q(t[0])},${q(t[1])},${q(t[2])},${t[3]},array[${t[4].map(q).join(',')}]::text[],${q(t[5])},${q(triggerArgs(t[0]))})`).join(',')
  // pg_get_expr cannot resolve both OLD/NEW namespaces in a trigger WHEN.
  // A non-null qualifier with a missing delimiter stays NULL and fails EXCEPT.
  const actualTriggers = `select t.tgname::text,nf.nspname::text,fn.proname::text,t.tgtype::integer,
 coalesce((select array_agg(a.attname::text order by cols.ordinality) from unnest(t.tgattr::smallint[]) with ordinality cols(attnum,ordinality) join pg_catalog.pg_attribute a on a.attrelid=t.tgrelid and a.attnum=cols.attnum),array[]::text[]),
 lower(regexp_replace(replace(replace(case when t.tgqual is null then '' else
 pg_catalog.substring(pg_catalog.pg_get_triggerdef(t.oid,false),' WHEN [(](.*)[)] EXECUTE FUNCTION ') end,'::text',''),'"',''),'[()[:space:]]','','g')),pg_catalog.encode(t.tgargs,'hex')
 from pg_catalog.pg_trigger t join pg_catalog.pg_proc fn on fn.oid=t.tgfoid join pg_catalog.pg_namespace nf on nf.oid=fn.pronamespace
 where t.tgrelid='public.tests'::regclass and not t.tgisinternal`
  return `do $catalog$ declare p pg_catalog.pg_proc;actual text[];checks jsonb;begin
 select proc.* into strict p from pg_catalog.pg_proc proc where proc.oid='public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamptz)'::regprocedure;
 if p.proargnames is distinct from array['p_actor_id','p_classroom_id','p_test_ids','p_deadline']::text[] or p.pronargs<>4 or p.prorettype<>'jsonb'::regtype
 or not p.prosecdef or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
 or cardinality(p.proconfig)<>2 or not(p.proconfig @> array['search_path=""','lock_timeout=1s']::text[])
 or not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
 or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
 where acl.privilege_type='EXECUTE' and acl.grantee not in (p.proowner,(select oid from pg_catalog.pg_roles where rolname='service_role')))
 then raise exception 'Exact reorder function capability differs';end if;
 select array_agg(a.attname::text order by a.attnum) into actual from pg_catalog.pg_attribute a where a.attrelid='public.tests'::regclass and a.attnum>0 and not a.attisdropped;
 if actual is distinct from array[${TEST_OWNER_REORDER_TEST_COLUMNS.map(q).join(',')}]::text[] then raise exception 'Exact21 Test columns differ';end if;
 if exists((${actualTriggers}) except (select * from (values ${expectedTriggers}) e(name,fn_schema,fn_name,tgtype,update_columns,qualifier,args)))
 or exists((select * from (values ${expectedTriggers}) e(name,fn_schema,fn_name,tgtype,update_columns,qualifier,args)) except (${actualTriggers}))
 or exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='public.tests'::regclass and not t.tgisinternal and(t.tgenabled<>'O' or t.tgdeferrable or t.tginitdeferred))
 then raise exception 'Exact13 Test trigger closure differs';end if;
 ${routines.map(r => `if not exists(select 1 from pg_catalog.pg_proc proc where proc.oid=${q(r.signature)}::regprocedure and pg_catalog.md5(proc.prosrc)=${q(r.prosrcMd5)}
 and pg_catalog.pg_get_userbyid(proc.proowner)='postgres' and proc.prolang=(select oid from pg_catalog.pg_language where lanname=${q(r.language)})
 and proc.prosecdef=${r.securityDefiner} and proc.provolatile=${q(r.volatility)} and coalesce(proc.proconfig,array[]::text[]) is not distinct from array[${r.proconfig.map(q).join(',')}]::text[])
 then raise exception 'Reachable routine source differs';end if;`).join('\n')}
 end;$catalog$;`
}

function inputSql(f: TestOwnerReorderFixture, label: string) {
  const c = f.cases.find(c => c.label === label); assert(c)
  if (c.bulkClassLabel) return `(select coalesce(array_agg(test.id order by test.position,test.id),array[]::uuid[]) from public.tests test where test.classroom_id=${q(c.classroomId)}::uuid)`
  return `array[${testOwnerReorderRequest(f,label).test_ids.map(id => `${q(id)}::uuid`).join(',')}]::uuid[]`
}
function call(actorId: string, classroomId: string, ids: string, deadline = "pg_catalog.clock_timestamp()+interval '8 seconds'") {
  return `public.reorder_tests_for_owner_v1(${q(actorId)}::uuid,${q(classroomId)}::uuid,${ids},${deadline})`
}
type Probe = Readonly<{ label: string; sql: string }>
function probe(label: string, body: string): Probe {
  return { label, sql: `do $probe$ declare before_graph jsonb;after_graph jsonb;begin
 before_graph:=pg_temp.owner_reorder_graph();begin ${body}
 raise exception using errcode='PT499',message=${q(label)};exception when sqlstate 'PT499' then if sqlerrm<>${q(label)} then raise;end if;end;
 after_graph:=pg_temp.owner_reorder_graph();if after_graph is distinct from before_graph then raise exception 'Rollback graph differs: ${label}';end if;
 insert into pg_temp.owner_reorder_checks values(${q(label)});end;$probe$;` }
}
function denial(label: string, rpc: string, expected: string, setup = '') {
  return probe(label, `declare code text;begin ${setup} begin perform ${rpc};raise exception 'Denied reorder succeeded';exception when others then get stacked diagnostics code=returned_sqlstate;if code is distinct from ${q(expected)} then raise exception 'Denied reorder SQLSTATE differs: ${label}';end if;end;end;`)
}
function success(f: TestOwnerReorderFixture, label: string, noop = false) {
  const c = f.cases.find(c => c.label === label); assert(c)
  const input = inputSql(f,label)
  return probe(label, `declare ids uuid[];r jsonb;operation_before jsonb;expected_graph jsonb;after_graph jsonb;expected_rows jsonb;table_name text;n bigint;c bigint;${label === 'bulk-10000' ? 'deadline_context text;deadline_code text;' : ''}begin
 ids:=${input};n:=cardinality(ids);operation_before:=before_graph;${noop ? `perform ${call(c.actorId,c.classroomId,'ids')};operation_before:=pg_temp.owner_reorder_graph();` : ''}
 select count(*) into c from public.tests test join unnest(ids) with ordinality desired(id,ordinality) on desired.id=test.id where test.classroom_id=${q(c.classroomId)}::uuid and test.position is distinct from (n-desired.ordinality)::integer;
 ${label === 'bulk-10000' ? `begin r:=${call(c.actorId,c.classroomId,'ids')};
 exception when sqlstate 'PT503' then case sqlerrm
 when 'test_reorder_deadline' then get stacked diagnostics deadline_context=pg_exception_context;
 deadline_code:=${deadlineCodeSql()};deadline_context:=null;raise exception using errcode=deadline_code,message='Reorder bulk-capacity proof failed';
 ${Object.entries(TEST_OWNER_REORDER_BULK_FAILURE_CODES).filter(([code]) => code !== 'PRD01').map(([code, message]) =>
   `when ${q(message)} then raise exception using errcode=${q(code)},message='Reorder bulk-capacity proof failed';`).join('\n')}
 else raise;end case;end;` : `r:=${call(c.actorId,c.classroomId,'ids')};`}
 if r is distinct from jsonb_build_object('version',1,'actor_id',${q(c.actorId)}::uuid,'classroom_id',${q(c.classroomId)}::uuid,'test_ids',to_jsonb(ids),
 'positions',(select coalesce(jsonb_agg((n-ordinality)::integer order by ordinality),'[]'::jsonb) from unnest(ids) with ordinality d(id,ordinality)),'count',n,'changed_count',c)
 ${noop ? 'or c<>0' : ''} then raise exception 'Reorder exact witness differs';end if;
 expected_graph:=operation_before;after_graph:=pg_temp.owner_reorder_graph();
 foreach table_name in array array['public.tests','__bulk_tests'] loop
 select coalesce(jsonb_agg(case when desired.id is not null and (item.value->>'position')::integer is distinct from (n-desired.ordinality)::integer
 then item.value||jsonb_build_object('position',(n-desired.ordinality)::integer,'updated_at',pg_catalog.transaction_timestamp()) else item.value end
 order by item.value->>'classroom_id',item.value->>'id'),'[]'::jsonb) into expected_rows
 from jsonb_array_elements(operation_before->table_name) item(value) left join unnest(ids) with ordinality desired(id,ordinality) on desired.id=(item.value->>'id')::uuid;
 expected_graph:=jsonb_set(expected_graph,array[table_name],expected_rows);
 select coalesce(jsonb_agg(item.value order by item.value->>'classroom_id',item.value->>'id'),'[]'::jsonb) into expected_rows from jsonb_array_elements(after_graph->table_name) item(value);
 after_graph:=jsonb_set(after_graph,array[table_name],expected_rows);end loop;
 foreach table_name in array array['public.classrooms','public.classroom_archive_revisions'] loop
 select jsonb_agg(expected.value order by expected.value::text) into expected_rows from(select case when c>0 and item.value->>(case when table_name='public.classrooms' then 'id' else 'classroom_id' end)=${q(c.classroomId)}
 then item.value||jsonb_build_object(case when table_name='public.classrooms' then 'blueprint_source_revision' else 'revision' end,
 (item.value->>(case when table_name='public.classrooms' then 'blueprint_source_revision' else 'revision' end))::bigint+c*(case when table_name='public.classrooms' then 1 else 2 end),
 'updated_at',pg_catalog.transaction_timestamp()) else item.value end as value from jsonb_array_elements(operation_before->table_name) item(value)) expected;
 expected_graph:=jsonb_set(expected_graph,array[table_name],expected_rows);
 select jsonb_agg(item.value order by item.value::text) into expected_rows from jsonb_array_elements(after_graph->table_name) item(value);
 after_graph:=jsonb_set(after_graph,array[table_name],expected_rows);end loop;
 if after_graph is distinct from expected_graph then raise exception 'Reorder full effect graph differs';end if;end;`)
}

function fault(f: TestOwnerReorderFixture, label: string, timing: 'before'|'after', action: string,
  expected = 'PT503', deadline = "pg_catalog.clock_timestamp()+interval '8 seconds'") {
  const c = f.cases.find(c => c.label === 'teacher-owner'); assert(c)
  const t = f.tests.find(t => t.classroom_id === c.classroomId); assert(t)
  const name = `p253_${f.tag.slice(-12)}_${label.replaceAll('-','_')}`; assert(name.length < 60)
  const seq = `${name}_hit`
  return probe(label, `declare code text;succeeded boolean:=false;begin
 create temp sequence ${seq};create function private.${name}() returns trigger language plpgsql set search_path='' as $fault$
 begin if new.id=${q(t.id)}::uuid then perform pg_catalog.nextval(${q(`pg_temp.${seq}`)}::regclass);${action}end if;return new;end;$fault$;
 revoke all on function private.${name}() from public,anon,authenticated,service_role;
 create trigger ${name} ${timing} update of position on public.tests for each row execute function private.${name}();
 begin perform ${call(c.actorId,c.classroomId,inputSql(f,c.label),deadline)};succeeded:=true;exception when others then get stacked diagnostics code=returned_sqlstate;end;
 if succeeded or code is distinct from ${q(expected)} then raise exception 'Reorder fault SQLSTATE differs: ${label}';end if;
 if pg_catalog.currval(${q(`pg_temp.${seq}`)}::regclass)<1 then raise exception 'Reorder fault trigger was not reached';end if;end;`)
}

export function testOwnerReorderDbContractsManifest(f: TestOwnerReorderFixture, projectId: string, repository = process.cwd()) {
  assert(Object.isFrozen(f));assert.equal(f.version,1);assert.equal(projectId,`pika_assignment_list_${f.tag.slice(-12)}`)
  assert.equal(f.tests.length,12);assert.deepEqual(f.bulkClasses.map(c => c.count),[1001,10000,10001])
  const source = readFileSync(resolve(repository,'supabase/migrations/253_contextual_test_owner_reorder.sql'),'utf8')
  assert.equal(hash(source),TEST_OWNER_REORDER_SOURCE_SHA256)
  const body = source.split('as $function$')[1]?.split('$function$')[0];assert(body)
  assert.deepEqual(body.split('\n').flatMap((line,index) =>
    line.includes("raise exception using errcode = 'PT503', message = 'test_reorder_deadline'") ? [index+1] : []),
    Object.values(TEST_OWNER_REORDER_DEADLINE_PHASE_CODES), 'Deadline checkpoint source differs')
  // Fixture creation has no persistence; retain the finite source identity and
  // cardinality bounds within the separately reviewed and accepted manifest.
  assert.match(f.tag,/^testownerreorder_[a-f0-9]{12}$/);assert(f.cases.length<=24)
  assert(f.allocatedIds.every(id=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/.test(id)))
  assert.equal(new Set(f.allocatedIds).size,f.allocatedIds.length)
  const routines = reachableFunctions(repository)
  const teacher = f.cases.find(c => c.label==='teacher-owner');assert(teacher)
  const ids=inputSql(f,teacher.label);const baseCall=(input=ids,deadline?:string)=>call(teacher.actorId,teacher.classroomId,input,deadline)
  const target=f.tests.find(t=>t.classroom_id===teacher.classroomId);assert(target)
  const former=f.classes.find(c=>c.label==='student-owner');assert(former)
  const reserve=(label:string)=>{const h=hash(`${f.tag}:db-contract:${label}`);const id=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;assert(!f.allocatedIds.includes(id));return id}
  const reservedIds=freeze({classroomPurgeOperation:reserve('classroom-purge-operation'),providerPurgeOperation:reserve('provider-purge-operation')})
  const cases=f.cases.filter(c=>!c.bulkClassLabel&&c.label!=='duplicate-membership')
    .map(c=>c.expectedHTTP===200?success(f,c.label,c.label==='teacher-noop'):
      denial(c.label,call(c.actorId,c.classroomId,inputSql(f,c.label)),`PT${c.expectedHTTP}`))
  const memberChecks=[
    denial('duplicate-membership',baseCall(`(${ids})||array[${q(target.id)}::uuid]`),'PT400'),
    denial('null-array',baseCall('null::uuid[]'),'PT400'),
    denial('null-member',baseCall(`(${ids})||array[null::uuid]`),'PT400'),
    denial('multidimensional-array',baseCall(`array[[${q(target.id)}::uuid],[${q(target.id)}::uuid]]`),'PT400'),
    denial('nonstandard-array-bound',baseCall(`array_fill(${q(target.id)}::uuid,array[1],array[0])`),'PT400'),
    denial('null-actor',`public.reorder_tests_for_owner_v1(null::uuid,${q(teacher.classroomId)}::uuid,${ids},clock_timestamp()+interval '8 seconds')`,'PT400'),
  ]
  const boundChecks=[
    denial('row-byte-limit',baseCall(),'PT503',`update public.tests set title=repeat('x',2097152) where id=${q(target.id)}::uuid;`),
    denial('class-byte-limit',baseCall(),'PT503',`update public.classrooms set title=repeat('x',2097152) where id=${q(teacher.classroomId)}::uuid;`),
    denial('revision-limit',baseCall(),'PT503',`update public.classrooms set blueprint_source_revision=9223372036854775807 where id=${q(teacher.classroomId)}::uuid;`),
    denial('archive-revision-limit',baseCall(),'PT503',`update public.classroom_archive_revisions set revision=9223372036854775807 where classroom_id=${q(teacher.classroomId)}::uuid;`),
    deadlineCalibration(baseCall(ids,"clock_timestamp()-interval '1 millisecond'")),
    denial('deadline-nonfinite',baseCall(ids,"'infinity'::timestamptz"),'PT400'),
    denial('deadline-too-far',baseCall(ids,"clock_timestamp()+interval '21 seconds'"),'PT400'),
    denial('null-deadline',baseCall(ids,'null::timestamptz'),'PT400'),
  ]
  const gucs=[['maintenance-restore','pika.classroom_archive_restore'],['maintenance-compaction','pika.classroom_archive_compaction'],
    ['identity-mapping','pika.identity_mapping'],['classroom-finalize','pika.classroom_purge_finalize'],
    ['blueprint-finalize','pika.course_blueprint_purge_finalize'],['student-finalize','pika.student_purge_finalize']] as const
  const guards=gucs.map(([label,guc])=>denial(label,baseCall(),'PT403',`perform set_config(${q(guc)},'on',true);`))
  guards.push(denial('classroom-purge-fence',baseCall(),'PT403',`
 if exists(select 1 from public.classroom_purge_operations where id=${q(reservedIds.classroomPurgeOperation)}::uuid) then raise exception 'Reorder rollback operation collision';end if;
 insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary)
 values(${q(reservedIds.classroomPurgeOperation)}::uuid,${q(teacher.actorId)}::uuid,${q(teacher.classroomId)}::uuid,${q('0'.repeat(64))},1,'{}'::jsonb);
 insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id)
 values(${q(teacher.classroomId)}::uuid,${q(reservedIds.classroomPurgeOperation)}::uuid,${q(teacher.actorId)}::uuid);`))
  const enrollment=f.enrollments.find(row=>row.classroom_id===teacher.classroomId&&row.student_id===f.actors[2].id);assert(enrollment)
  guards.push(denial('provider-cleanup-binding',baseCall(),'PT403',`
 if exists(select 1 from public.student_purge_operations where id=${q(reservedIds.providerPurgeOperation)}::uuid)
 or exists(select 1 from private.student_provider_cleanup_bindings where operation_id=${q(reservedIds.providerPurgeOperation)}::uuid or generation_id=${q(enrollment.id)}::uuid)
 then raise exception 'Reorder rollback operation collision';end if;
 if not exists(select 1 from private.pal_membership_generations where generation_id=${q(enrollment.id)}::uuid) then raise exception 'Reorder membership generation absent';end if;
 insert into private.student_provider_cleanup_bindings(operation_id,generation_id,scope_digest,pal_reference,pal_origin,pal_integration_id,
 bara_origin,installation_ref,roster_ref,participant_ref,actor_principal_ref)
 select ${q(reservedIds.providerPurgeOperation)}::uuid,generation_id,scope_digest,${q('pika-membership-v1-'+md5(reservedIds.providerPurgeOperation))},
 'https://example.invalid',${q(reservedIds.providerPurgeOperation)}::uuid,'https://example.invalid','synthetic-reorder',
 ${q('roster_'+md5(reservedIds.providerPurgeOperation))},${q('participant_'+md5(reservedIds.providerPurgeOperation))},${q('principal_'+md5(reservedIds.providerPurgeOperation))}
 from private.pal_membership_generations where generation_id=${q(enrollment.id)}::uuid;
 insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_binding_sha256,request_sha256,status,source_revision)
 values(${q(reservedIds.providerPurgeOperation)}::uuid,${q(teacher.actorId)}::uuid,${q(teacher.classroomId)}::uuid,${q(f.actors[2].id)}::uuid,
 ${q('0'.repeat(64))},${q('1'.repeat(64))},'provider_pending',1);`))
  const faults=[
    fault(f,'suppress-write','before','return null;'),
    fault(f,'alter-position','before','new.position:=new.position+10;return new;'),
    fault(f,'alter-title','before',"new.title:=new.title||' changed';return new;"),
    fault(f,'reparent-write','after',`update public.tests set classroom_id=${q(former.id)}::uuid,gradebook_category_id=null where id=new.id;return new;`),
    fault(f,'revision-drift','after',`update public.classroom_archive_revisions set revision=revision+1 where classroom_id=new.classroom_id;return new;`),
    fault(f,'settings-drift','after',"update public.managed_storage_settings set updated_at=clock_timestamp() where singleton;return new;"),
    fault(f,'raw-42501','after',"raise exception using errcode='42501',message='reorder raw privilege probe';",'42501'),
    fault(f,'unknown-55000','after',"raise exception using errcode='55000',message='reorder unknown probe';"),
    fault(f,'deadline-after-write','after','perform pg_catalog.pg_sleep(0.1);return new;','PT503',"clock_timestamp()+interval '50 milliseconds'"),
  ]
  const b1001=f.bulkClasses[0];const b10001=f.bulkClasses[2]
  const bulkSource=inputSql(f,'bulk-10001')
  const groups: Array<{name:string;probes:Probe[]}>=[
    {name:'catalog',probes:[probe('catalog-function-columns-triggers-routines',catalogSql(routines))]},
    {name:'authority-effects',probes:cases},
    {name:'input-membership',probes:memberChecks},
    {name:'bounds',probes:boundChecks},
    {name:'lifecycle-guards',probes:guards},
    {name:'injected-faults',probes:faults},
    {name:'bulk-1001',probes:[success(f,'bulk-1001'),denial('state-byte-limit',call(teacher.actorId,b1001.classroomId,inputSql(f,'bulk-1001')),'PT503',
      `update public.tests set title=repeat('x',1048576) where id in(select id from public.tests where classroom_id=${q(b1001.classroomId)}::uuid order by id limit 33);`)]},
    {name:'bulk-10000',probes:[success(f,'bulk-10000')]},
    {name:'bulk-10001',probes:[denial('source-10001-limit',call(teacher.actorId,b10001.classroomId,`(${bulkSource})[1:10000]`),'PT503'),
      denial('full-10001-input',call(teacher.actorId,b10001.classroomId,bulkSource),'PT400')]},
  ]
  assert.equal(groups.length,TEST_OWNER_REORDER_DB_CAPS.logicalGroups)
  const graph=testOwnerReorderSnapshotExpressionSql(f)
  // Bound cumulative native frame work, not just PostgreSQL's per-statement
  // timeout. Every frame remains a complete standalone rollback transaction;
  // no probe, full-graph comparison, product deadline or runtime cap is removed.
  const contracts=groups.flatMap(group=>{
    const chunkCount=Math.ceil(group.probes.length/TEST_OWNER_REORDER_DB_CAPS.probesPerBatch)
    return Array.from({length:chunkCount},(_,index)=>{
    const probes=group.probes.slice(index*TEST_OWNER_REORDER_DB_CAPS.probesPerBatch,(index+1)*TEST_OWNER_REORDER_DB_CAPS.probesPerBatch)
    assert(probes.length>0&&probes.length<=TEST_OWNER_REORDER_DB_CAPS.probesPerBatch)
    const name=chunkCount===1?group.name:`${group.name}-${index+1}`
    const labels=probes.map(p=>p.label);assert.equal(new Set(labels).size,labels.length)
    const expectedResult=freeze({version:1 as const,batch:name,checks:[...labels,'final-fixture-equality'].sort(),rolledBack:true as const})
    const sql=bounded(`begin;set local lock_timeout='1s';set local statement_timeout='35s';
 do $guard$ begin if current_setting('application_name')<>${q(projectId+'_draft_contracts')} or current_database()<>'postgres' or current_user<>'postgres'
 or to_regprocedure('public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamptz)') is null then raise exception 'Migration253 disposable source differs';end if;end;$guard$;
 create temp table owner_reorder_checks(label text not null unique) on commit drop;
 create function pg_temp.owner_reorder_graph() returns jsonb language sql stable set search_path='' as $snapshot$ select ${graph} $snapshot$;
 create temp table owner_reorder_baseline(value jsonb not null) on commit drop;insert into owner_reorder_baseline select pg_temp.owner_reorder_graph();
 ${probes.map(p=>p.sql).join('\n')}
 do $final$ declare baseline_graph jsonb;begin select value into strict baseline_graph from pg_temp.owner_reorder_baseline;
 if baseline_graph is distinct from pg_temp.owner_reorder_graph() then raise exception 'Reorder final fixture differs';end if;
 if(select count(*) from pg_temp.owner_reorder_checks)<>${labels.length} then raise exception 'Reorder check count differs';end if;
 insert into pg_temp.owner_reorder_checks values('final-fixture-equality');end;$final$;
 select jsonb_build_object('version',1,'batch',${q(name)},'checks',(select jsonb_agg(label order by label) from pg_temp.owner_reorder_checks),'rolledBack',true) as result;rollback;`)
    return freeze({name,logicalGroup:group.name,sql,expectedResult})
    })
  })
  assert.equal(contracts.length,TEST_OWNER_REORDER_DB_CAPS.batches)
  assert.equal(new Set(contracts.map(batch=>batch.name)).size,contracts.length)
  const checkLabels=groups.flatMap(g=>g.probes.map(p=>p.label));assert.equal(new Set(checkLabels).size,checkLabels.length)
  const expectedResult=freeze({version:1 as const,checks:[...checkLabels].sort(),rolledBack:true as const})
  const manifest=freeze({version:1 as const,fixture:f,projectId,sourceFile:'253_contextual_test_owner_reorder.sql' as const,
    sourceSha256:TEST_OWNER_REORDER_SOURCE_SHA256,caps:TEST_OWNER_REORDER_DB_CAPS,contracts,checkLabels,expectedResult,
    reachableFunctions:routines,reservedIds,limitations:TEST_OWNER_REORDER_DB_LIMITATIONS})
  issued.add(manifest);return manifest
}
export type TestOwnerReorderDbContractsManifest=ReturnType<typeof testOwnerReorderDbContractsManifest>

export async function runTestOwnerReorderDbContracts(manifest:TestOwnerReorderDbContractsManifest,target:DraftSaveTarget,driver:DraftSaveDriver,absoluteDeadline:number) {
  assert(Number.isSafeInteger(absoluteDeadline)&&absoluteDeadline>Date.now(),'Reorder driver requires existing absolute deadline')
  const remaining=()=>{const value=absoluteDeadline-Date.now();assert(value>0,'Reorder driver absolute deadline elapsed');return value}
  assert(issued.has(manifest),'Unissued reorder manifest');assert(Object.isFrozen(manifest));assert(Object.isFrozen(target))
  assert.equal(manifest.sourceSha256,TEST_OWNER_REORDER_SOURCE_SHA256);assert.equal(manifest.contracts.length,TEST_OWNER_REORDER_DB_CAPS.batches)
  assert.equal(target.projectId,manifest.projectId);assert.equal(target.containerProjectLabel,manifest.projectId);assert.equal(target.disposable,true)
  assert.equal(target.apiUrl,'http://127.0.0.1:54331');assert.equal(target.databaseHost,'127.0.0.1');assert.equal(target.databasePort,54332)
  assert.match(target.containerId,/^[a-f0-9]{64}$/);assert.match(target.reviewedHead,/^[a-f0-9]{40}$/);assert.match(target.migrationManifestSha256,/^[a-f0-9]{64}$/)
  assert.equal(target.reviewedSourceSha256,TEST_OWNER_REORDER_SOURCE_SHA256);assert.equal(target.acceptedManifestSha256,hash(JSON.stringify(manifest)))
  remaining();assert.deepEqual(await driver.verifyTarget(),target);remaining()
  const name=`${manifest.projectId}_draft_contracts`;const session=await driver.openSession(name)
  try {
    remaining()
    assert.equal(session.name,name)
    for(const batch of manifest.contracts) {
      remaining();assert.deepEqual(await driver.verifyTarget(),target)
      const rows=await session.execute(batch.sql,Math.min(manifest.caps.actionMs,remaining()))
      remaining()
      assert(Buffer.byteLength(JSON.stringify(rows))<=manifest.caps.responseBytes,'Reorder driver response byte limit')
      assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]),['result']);assert.deepEqual(rows[0].result,batch.expectedResult)
    }
  } finally {await session.rollbackAndClose(manifest.caps.requestMs)}
  return freeze({kind:'rollback-test-owner-reorder-contracts' as const,sourceSha256:target.reviewedSourceSha256,
    manifestSha256:target.acceptedManifestSha256,checks:manifest.expectedResult.checks})
}
