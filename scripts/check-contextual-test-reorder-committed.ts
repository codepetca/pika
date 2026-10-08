/** Inert, fixed committed source preparation. No import-time IO or connections.
 * Runs ONLY after the SDK matrix, in the same disposable owner/engine/deadline.
 * Full catalog rows remain inside SQL; compact receipts are not native acceptance.
 * Failure never compensates committed writes: the owner disposes the target. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { assertIssuedTestOwnerReorderFixture, type TestOwnerReorderFixture } from './contextual-test-reorder-proof-fixture'
import { TEST_OWNER_REORDER_SOURCE_SHA256 } from './contextual-test-reorder-db-contracts'
import type { DraftSaveDriver, DraftSaveSession, DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'

export const TEST_OWNER_REORDER_COMMITTED_CAPS = Object.freeze({ sqlBytes: 262144, responseBytes: 8192,
  totalBytes: 67108864, requestMs: 12000, closeMs: 12000, sessions: 2, schedules: 7, dispatches: 31,
  // Admission ceiling only: the caller supplies the EXISTING engine deadline.
  totalMs: 900000 })
const q = (v: string) => `'${v.replaceAll("'", "''")}'`
const hash = (v: string) => createHash('sha256').update(v).digest('hex')
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } return v }
const issued = new WeakSet<object>()
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
function sourceId(tag:string,label:string) {const h=hash(`${tag}:${label}`);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
type Side = 'holder' | 'contender'
type Step = Readonly<{ label: string; side: Side; sql: string; actorId:string; classroomId:string; outcome: string; chain: 'prior' | 'cached' | 'same' }>
const SCHEDULES=Object.freeze(['create-freshness','delete-freshness','reparent-freshness','archive-freshness','last-writer','owner-freshness','legacy-max'])

function committedGuard(projectId:string,side:Side) {
  assert(side==='holder'||side==='contender')
  const prefix="begin read only;set local lock_timeout='3s';set local statement_timeout='30s';"
  const terminal="end;$guard$;select 'ok';rollback;"
  const original=testOwnerGuardSql(projectId)
  const identity=`current_setting('application_name')<>${q(projectId+'_fixture')}`
  assert(original.startsWith(prefix)&&original.endsWith(terminal))
  assert.equal(original.split(identity).length,2)
  // Preserve every inherited provider/purge/bucket/control predicate verbatim.
  // Only the setup-only identity and setup transaction/result are adapted:
  // each closed dispatch belongs to exactly its source-declared session side.
  const inherited=original.slice(prefix.length,-terminal.length).replace(identity,
    `current_setting('application_name')<>${q(projectId+'_draft_'+side)}`)
  return `begin;set local lock_timeout='1s';set local statement_timeout='12s';set local idle_in_transaction_session_timeout='30s';${inherited}
 if current_database()<>'postgres' or current_user<>'postgres'
 or to_regprocedure('public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamptz)') is null
 then raise exception 'Migration254 disposable source differs';end if;
end;$guard$;`
}

function functions() {
  return `create or replace function pg_temp.reorder_committed_graph() returns jsonb language plpgsql as $graph$
 declare catalog jsonb:='[]'::jsonb;g jsonb:='{}'::jsonb;rows jsonb;t record;begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','private','storage') order by n.nspname,c.relname loop
 execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r',t.nspname,t.relname) into rows;
 catalog:=catalog||jsonb_build_array(t.nspname||'.'||t.relname);g:=g||jsonb_build_object(t.nspname||'.'||t.relname,rows);end loop;
 return g||jsonb_build_object('__catalog',catalog);end;$graph$;
 create or replace function pg_temp.reorder_committed_sha(g jsonb) returns text language sql immutable as $sha$ select encode(extensions.digest(g::text,'sha256'),'hex') $sha$;
 create or replace function pg_temp.reorder_committed_row(g jsonb,t text,k text,v text) returns jsonb language plpgsql immutable as $row$
 declare result jsonb;n bigint;begin select count(*),jsonb_agg(x) into n,result from jsonb_array_elements(g->t) x where x->>k=v;
 if n<>1 then raise exception 'Exact source row missing or ambiguous';end if;return result->0;end;$row$;
 create or replace function pg_temp.reorder_committed_put(g jsonb,t text,k text,v text,r jsonb) returns jsonb language sql immutable as $put$
 select jsonb_set(g,array[t],(select coalesce(jsonb_agg(x order by x::text),'[]'::jsonb) from
 (select x from jsonb_array_elements(g->t) x where x->>k is distinct from v union all select r where r is not null) rows(x))) $put$;
 create or replace function pg_temp.reorder_committed_bump(g jsonb,c uuid,b bigint,a bigint,p jsonb default '{}'::jsonb) returns jsonb language plpgsql as $bump$
 declare r jsonb;begin
 if b<>0 or p<>'{}'::jsonb then r:=pg_temp.reorder_committed_row(g,'public.classrooms','id',c::text);
 g:=pg_temp.reorder_committed_put(g,'public.classrooms','id',c::text,r||p||jsonb_build_object('blueprint_source_revision',(r->>'blueprint_source_revision')::bigint+b,'updated_at',transaction_timestamp()));end if;
 if a<>0 then r:=pg_temp.reorder_committed_row(g,'public.classroom_archive_revisions','classroom_id',c::text);
 g:=pg_temp.reorder_committed_put(g,'public.classroom_archive_revisions','classroom_id',c::text,r||jsonb_build_object('revision',(r->>'revision')::bigint+a,'updated_at',transaction_timestamp()));end if;return g;end;$bump$;
 create or replace function pg_temp.reorder_committed_new_test(g jsonb,c uuid,u uuid,t uuid,a uuid,title text,pos integer) returns jsonb language plpgsql as $new$
 declare category jsonb;begin
 select x into category from jsonb_array_elements(g->'public.gradebook_categories') x where x->>'classroom_id'=c::text
 order by (x->>'is_default')::boolean desc,(x->>'position')::integer,x->>'id' limit 1;
 return jsonb_build_object('id',t,'classroom_id',c,'title',title,'status','draft','show_results',false,'position',pos,
 'points_possible',100,'include_in_final',true,'created_by',u,'created_at',transaction_timestamp(),'updated_at',transaction_timestamp(),
 'documents','[]'::jsonb,'gradebook_weight',coalesce((category->>'default_assessment_weight')::numeric,10),'artifact_id',a,'source_artifact_id',null,
 'blueprint_archived_at',null,'source_blueprint_version_id',null,'questions_locked_at',null,'gradebook_category_id',category->>'id',
 'gradebook_maximum_override',null,'gradebook_score_scale',1);end;$new$;
 create or replace function pg_temp.reorder_committed_create(g jsonb,c uuid,u uuid,title text) returns jsonb language plpgsql as $create$
 declare r jsonb;t jsonb;d jsonb;pos integer;begin
 select coalesce(max((x->>'position')::integer)+1,0) into pos from jsonb_array_elements(g->'public.tests') x where x->>'classroom_id'=c::text;
 r:=public.create_test_for_owner_v1(u,c,title,clock_timestamp()+interval '8 seconds');
 t:=pg_temp.reorder_committed_new_test(g,c,u,(r->>'test_id')::uuid,(r->'test'->>'artifact_id')::uuid,title,pos);
 d:=jsonb_build_object('id',(r->'draft'->>'id')::uuid,'assessment_type','test','assessment_id',(r->>'test_id')::uuid,'classroom_id',c,
 'content',jsonb_build_object('title',title,'show_results',false,'question_identity_version',1,'questions','[]'::jsonb,'source_format','markdown'),
 'version',1,'created_by',u,'updated_by',u,'created_at',transaction_timestamp(),'updated_at',transaction_timestamp());
 if r is distinct from jsonb_build_object('version',1,'actor_id',u,'classroom_id',c,'test_id',(r->>'test_id')::uuid,'test',t,'draft',d)
 or exists(select 1 from jsonb_array_elements(g->'public.tests') x where x->>'id'=t->>'id')
 or exists(select 1 from jsonb_array_elements(g->'public.assessment_drafts') x where x->>'id'=d->>'id') then raise exception 'Create witness differs';end if;
 g:=pg_temp.reorder_committed_put(g,'public.tests','id',t->>'id',t);
 g:=pg_temp.reorder_committed_put(g,'public.assessment_drafts','id',d->>'id',d);
 return pg_temp.reorder_committed_bump(g,c,2,4);end;$create$;
 create or replace function pg_temp.reorder_committed_reorder(g jsonb,c uuid,u uuid,ids uuid[]) returns jsonb language plpgsql as $reorder$
 declare r jsonb;expected jsonb;changes bigint;n bigint:=cardinality(ids);begin
 if n>1000 or n<>(select count(*) from jsonb_array_elements(g->'public.tests') x where x->>'classroom_id'=c::text)
 or n<>(select count(distinct id) from unnest(ids) d(id)) or exists(select 1 from unnest(ids) d(id) where not exists(select 1 from jsonb_array_elements(g->'public.tests') x where x->>'id'=d.id::text and x->>'classroom_id'=c::text))
 then raise exception 'Reorder request complete membership differs';end if;
 select count(*) into changes from jsonb_array_elements(g->'public.tests') x join unnest(ids) with ordinality d(id,ord) on x->>'id'=d.id::text where (x->>'position')::integer is distinct from (n-d.ord)::integer;
 r:=public.reorder_tests_for_owner_v1(u,c,ids,clock_timestamp()+interval '8 seconds');
 expected:=jsonb_build_object('version',1,'actor_id',u,'classroom_id',c,'test_ids',to_jsonb(ids),'positions',(select coalesce(jsonb_agg((n-ord)::integer order by ord),'[]'::jsonb) from unnest(ids) with ordinality d(id,ord)), 'count',n,'changed_count',changes);
 if r is distinct from expected then raise exception 'Reorder request-bound witness differs';end if;
 g:=jsonb_set(g,array['public.tests'],(select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from
 (select case when d.id is not null and (x->>'position')::integer is distinct from (n-d.ord)::integer then x||jsonb_build_object('position',(n-d.ord)::integer,'updated_at',transaction_timestamp()) else x end value
 from jsonb_array_elements(g->'public.tests') x left join unnest(ids) with ordinality d(id,ord) on x->>'id'=d.id::text) expected_rows));
 return pg_temp.reorder_committed_bump(g,c,changes,2*changes);end;$reorder$;`
}

/** The closed graph enumerates every live table and includes its catalog in the
 * pre/post hash. The native owner separately pins the canonical-issued catalog.
 * IDs come from the deterministic frozen fixture, not caller operational input. */
export function testOwnerReorderCommittedManifest(f: TestOwnerReorderFixture) {
  assertIssuedTestOwnerReorderFixture(f)
  assert(Object.isFrozen(f)); assert.match(f.tag,/^testownerreorder_[a-f0-9]{12}$/)
  assert(Number.isFinite(Date.parse(f.now)))
  assert.equal(f.actors.length,5);assert.equal(f.classes.length,7);assert.equal(f.tests.length,12)
  // The closed native owner additionally compares the complete fixture against
  // newTestOwnerReorderFixture(original). Here admit only exact source-derived
  // identities/relationships actually consumed by this inert manifest; never
  // regenerate AssignmentList entropy or forge a partial original fixture.
  f.actors.forEach((a,i)=>{assert(Object.isFrozen(a));assert.equal(a.id,sourceId(f.tag,`actor${i}`));assert.equal(a.role,['teacher','student','student','teacher','teacher'][i])})
  f.classes.forEach((c,i)=>{const label=['teacher-owner','student-owner','archived-owner','empty-owner','bulk-999','bulk-1000','bulk-1001'][i];
    assert(Object.isFrozen(c));assert.equal(c.label,label);assert.equal(c.id,sourceId(f.tag,`class:${label}`));assert.equal(c.owner,f.actors[i===1?1:0].id)})
  f.tests.forEach((t,i)=>{const classroom=f.classes[Math.floor(i/4)],label=['live','retired','started','closed'][i%4];
    assert(Object.isFrozen(t));assert.equal(t.id,sourceId(f.tag,`test:${classroom.label}:${label}`));assert.equal(t.classroom_id,classroom.id)})
  for (const id of [...f.actors.map(r=>r.id),...f.classes.map(r=>r.id),...f.tests.map(r=>r.id)]) assert.match(id,UUID)
  const projectId=`pika_assignment_list_${f.tag.slice(-12)}`
  const teacher=f.classes.find(c=>c.label==='teacher-owner')!, student=f.classes.find(c=>c.label==='student-owner')!, empty=f.classes.find(c=>c.label==='empty-owner')!
  assert(teacher&&student&&empty);assert.equal(teacher.owner,f.actors[0].id);assert.equal(empty.owner,teacher.owner);assert.equal(student.owner,f.actors[1].id)
  const u=`${q(teacher.owner)}::uuid`, ec=`${q(empty.id)}::uuid`, tc=`${q(teacher.id)}::uuid`, sc=`${q(student.id)}::uuid`
  const seedHex=hash(`${f.tag}:committed-seed`), seed=`${seedHex.slice(0,8)}-${seedHex.slice(8,12)}-4${seedHex.slice(13,16)}-8${seedHex.slice(17,20)}-${seedHex.slice(20,32)}`
  // The genuine156 discard requires BOTH Test/draft titles to stay Untitled;
  // its date-parenthesis form permits this fixed disposable namespace marker.
  const title=`Untitled (${f.now.slice(0,10)} ${f.tag} committed create)`, seedTitle=`${f.tag} committed seed`, legacyTitle=`${f.tag} committed cached MAX`, maxTitle=`${f.tag} committed MAX predecessor`
  const fn=functions()
  const steps:Step[]=[]
  function step(label:string,side:Side,outcome:string,body:string,chain:Step['chain']='prior') {
    const schedule=label.split(':')[0]
    const actorId=schedule==='legacy-max'?student.owner:teacher.owner
    const classroomId=schedule==='legacy-max'?student.id:['last-writer','owner-freshness'].includes(schedule)?teacher.id:empty.id
    const sql=`${committedGuard(projectId,side)}
 ${fn}
 create temporary table if not exists reorder_committed_cache(label text primary key,ids uuid[] not null,max_position integer,sha text not null) on commit preserve rows;
 create temporary table if not exists reorder_committed_result(result jsonb) on commit delete rows;
 do $phase$ declare before_graph jsonb;expected_graph jsonb;after_graph jsonb;ids uuid[];r jsonb;t jsonb;d jsonb;tid uuid;artifact uuid;code text;cached_sha text;pos integer;begin
 before_graph:=pg_temp.reorder_committed_graph();expected_graph:=before_graph;
 ${body}
 after_graph:=pg_temp.reorder_committed_graph();if after_graph is distinct from expected_graph then raise exception 'Committed full-row whole-project graph differs: ${label}';end if;
 insert into reorder_committed_result values(jsonb_build_object('label',${q(label)},'outcome',${q(outcome)},'before_sha256',pg_temp.reorder_committed_sha(before_graph),
 'after_sha256',pg_temp.reorder_committed_sha(after_graph),'cached_sha256',cached_sha,'actor_id',${q(actorId)}::uuid,'classroom_id',${q(classroomId)}::uuid,
 'test_ids',coalesce(to_jsonb(ids),'[]'::jsonb),'count',coalesce(cardinality(ids),0),'full_graph_verified',true));end;$phase$;
 select result from reorder_committed_result;commit;`
    assert(Buffer.byteLength(sql)<=TEST_OWNER_REORDER_COMMITTED_CAPS.sqlBytes)
    steps.push(freeze({label,side,sql,actorId,classroomId,outcome,chain}))
  }
  function cache(label:string,cid:string,reverse=false,side:Side='holder') {
    step(`${label}:cache${side==='contender'?'-b':''}`,side,'cached',`select coalesce(array_agg(id order by id ${reverse?'desc':'asc'}),array[]::uuid[]),coalesce(max(position),-1)+1 into ids,pos from public.tests where classroom_id=${cid};
 if cardinality(ids)>1000 then raise exception 'Finite membership limit';end if;
 insert into reorder_committed_cache values(${q(label)},ids,pos,pg_temp.reorder_committed_sha(before_graph));`,'same')
  }
  function denial(label:string,cid:string,expected:string) {
    step(`${label}:stale-reorder`,'holder',expected,`select c.ids,c.sha into strict ids,cached_sha from reorder_committed_cache c where c.label=${q(label)};
 begin perform public.reorder_tests_for_owner_v1(${u},${cid},ids,clock_timestamp()+interval '8 seconds');raise exception 'Stale reorder succeeded';
 exception when others then get stacked diagnostics code=returned_sqlstate;if code is distinct from ${q(expected)} then raise exception 'Stale reorder SQLSTATE differs';end if;end;`,'cached')
    step(`${label}:post-commit`,'contender','persisted','', 'same')
  }
  cache('create-freshness',ec)
  step('create-freshness:writer','contender','created',`expected_graph:=pg_temp.reorder_committed_create(before_graph,${ec},${u},${q(title)});`)
  denial('create-freshness',ec,'PT409')
  cache('delete-freshness',ec)
  step('delete-freshness:writer','contender','discarded',`select to_jsonb(x) into strict t from public.tests x where classroom_id=${ec} and title=${q(title)};
 select to_jsonb(x) into strict d from public.assessment_drafts x where assessment_type='test' and assessment_id=(t->>'id')::uuid;
 r:=public.discard_pristine_test_draft_for_owner_v1(${u},(t->>'id')::uuid,1,(t->>'updated_at')::timestamptz,clock_timestamp()+interval '8 seconds');
 if r is distinct from jsonb_build_object('version',1,'actor_id',${u},'test_id',(t->>'id')::uuid,'classroom',jsonb_build_object('id',${ec},'teacher_id',${u},'archived_at',null),'test',t,'draft',d,'discarded',true) then raise exception 'Discard witness differs';end if;
 expected_graph:=pg_temp.reorder_committed_put(before_graph,'public.tests','id',t->>'id',null);
 expected_graph:=pg_temp.reorder_committed_put(expected_graph,'public.assessment_drafts','id',d->>'id',null);
 expected_graph:=pg_temp.reorder_committed_bump(expected_graph,${ec},2,4);`)
  denial('delete-freshness',ec,'PT409')
  step('reparent-freshness:seed','contender','seeded',`tid:=${q(seed)}::uuid;artifact:=gen_random_uuid();
 if exists(select 1 from public.tests where id=tid or title=${q(seedTitle)}) then raise exception 'Seed collision';end if;
 t:=pg_temp.reorder_committed_new_test(before_graph,${ec},${u},tid,artifact,${q(seedTitle)},0);
 insert into public.tests(id,artifact_id,classroom_id,created_by,title,position) values(tid,artifact,${ec},${u},${q(seedTitle)},0);
 expected_graph:=pg_temp.reorder_committed_put(before_graph,'public.tests','id',tid::text,t);expected_graph:=pg_temp.reorder_committed_bump(expected_graph,${ec},1,2);`)
  cache('reparent-freshness',ec)
  step('reparent-freshness:writer','contender','reparented',`t:=pg_temp.reorder_committed_row(before_graph,'public.tests','id',${q(seed)});
 if t->>'classroom_id' is distinct from ${q(empty.id)} then raise exception 'Seed parent differs';end if;
 update public.tests set classroom_id=${sc},gradebook_category_id=null where id=${q(seed)}::uuid;
 expected_graph:=pg_temp.reorder_committed_put(before_graph,'public.tests','id',${q(seed)},t||jsonb_build_object('classroom_id',${sc},'gradebook_category_id',null,'updated_at',transaction_timestamp()));
 expected_graph:=pg_temp.reorder_committed_bump(expected_graph,${ec},0,1);expected_graph:=pg_temp.reorder_committed_bump(expected_graph,${sc},0,1);`)
  denial('reparent-freshness',ec,'PT409')
  cache('archive-freshness',ec)
  step('archive-freshness:writer','contender','archived',`if exists(select 1 from public.tests where classroom_id=${ec}) then raise exception 'Empty Class changed';end if;
 update public.classrooms set archived_at=transaction_timestamp() where id=${ec} and archived_at is null;
 if not found then raise exception 'Archive scope differs';end if;
 expected_graph:=pg_temp.reorder_committed_bump(before_graph,${ec},0,1,jsonb_build_object('archived_at',transaction_timestamp()));`)
  denial('archive-freshness',ec,'PT403')
  cache('last-writer',tc)
  cache('last-writer',tc,true,'contender')
  step('last-writer:apply-a','holder','reordered',`select c.ids,c.sha into strict ids,cached_sha from reorder_committed_cache c where c.label='last-writer';
 expected_graph:=pg_temp.reorder_committed_reorder(before_graph,${tc},${u},ids);`,'cached')
  step('last-writer:apply-b','contender','reordered',`select c.ids,c.sha into strict ids,cached_sha from reorder_committed_cache c where c.label='last-writer';
 expected_graph:=pg_temp.reorder_committed_reorder(before_graph,${tc},${u},ids);`,'cached')
  step('last-writer:post-commit','holder','persisted',`select coalesce(array_agg(id order by position desc,id desc),array[]::uuid[]) into ids from public.tests where classroom_id=${tc};
 if ids is distinct from (select array_agg(id order by id desc) from public.tests where classroom_id=${tc}) then raise exception 'Later unchanged-membership order not retained';end if;`,'same')
  cache('owner-freshness',tc)
  step('owner-freshness:writer','contender','owner-changed',`update public.classrooms set teacher_id=${q(f.actors[4].id)}::uuid where id=${tc} and teacher_id=${u};if not found then raise exception 'Owner scope differs';end if;
 expected_graph:=pg_temp.reorder_committed_bump(before_graph,${tc},0,1,jsonb_build_object('teacher_id',${q(f.actors[4].id)}::uuid));`)
  denial('owner-freshness',tc,'PT403')
  cache('legacy-max',sc)
  step('legacy-max:create','contender','created',`expected_graph:=pg_temp.reorder_committed_create(before_graph,${sc},${q(student.owner)}::uuid,${q(maxTitle)});`)
  step('legacy-max:reorder','contender','reordered',`select coalesce(array_agg(id order by id),array[]::uuid[]) into ids from public.tests where classroom_id=${sc};
 expected_graph:=pg_temp.reorder_committed_reorder(before_graph,${sc},${q(student.owner)}::uuid,ids);`)
  step('legacy-max:late-insert','holder','duplicate-position-retained',`select c.ids,c.max_position,c.sha into strict ids,pos,cached_sha from reorder_committed_cache c where c.label='legacy-max';
 tid:=gen_random_uuid();artifact:=gen_random_uuid();t:=pg_temp.reorder_committed_new_test(before_graph,${sc},${q(student.owner)}::uuid,tid,artifact,${q(legacyTitle)},pos);
 if not exists(select 1 from public.tests where classroom_id=${sc} and position=pos) then raise exception 'Cached MAX residual not representative';end if;
 insert into public.tests(id,artifact_id,classroom_id,created_by,title,position) values(tid,artifact,${sc},${q(student.owner)}::uuid,${q(legacyTitle)},pos);
 expected_graph:=pg_temp.reorder_committed_put(before_graph,'public.tests','id',tid::text,t);expected_graph:=pg_temp.reorder_committed_bump(expected_graph,${sc},1,2);`,'cached')
  step('legacy-max:post-commit','contender','persisted',`select to_jsonb(x) into strict t from public.tests x where classroom_id=${sc} and title=${q(legacyTitle)};
 if not exists(select 1 from public.tests where classroom_id=${sc} and id<>(t->>'id')::uuid and position=(t->>'position')::integer) then raise exception 'Legacy duplicate disappeared';end if;`,'same')
  assert.equal(steps.length,TEST_OWNER_REORDER_COMMITTED_CAPS.dispatches)
  const manifest=freeze({version:1 as const,projectId,sourceFile:'254_contextual_test_owner_reorder.sql' as const,sourceSha256:TEST_OWNER_REORDER_SOURCE_SHA256,
    sourceHashes:{'250_contextual_test_owner_create.sql':'58afc9d76d05f23166a76c59ae6d8b2e8b48aec49842671058ad57221ca0fbae',
      '251_contextual_test_pristine_owner_discard.sql':'3134f0d6bfdd7b80ee065c3f105a582aec8fa5105d81d3228089b3ca21cfdef0'},catalogSource:'Every public/private/storage ordinary or partitioned table' as const,caps:TEST_OWNER_REORDER_COMMITTED_CAPS,schedules:SCHEDULES,steps,
    limitations:['Source preparation and mocked receipts are not committed native acceptance.',
      'Run after every SDK context; do not reuse its initial effect ledger afterward.',
      'Managed writer sequence advances are nontransactional and deliberately not reset or attested as row equality.',
      'Actual inherited Blueprint/purge contention is owned by the rollback suite; enabled purge and successful Blueprint workflows are not claimed.',
      'Legacy cached MAX duplicates remain an explicitly demonstrated residual, not a uniqueness guarantee.']})
  issued.add(manifest);return manifest
}
export type TestOwnerReorderCommittedManifest = ReturnType<typeof testOwnerReorderCommittedManifest>
export function validateTestOwnerReorderCommittedSql(manifest:TestOwnerReorderCommittedManifest,sql:string) {
  return issued.has(manifest)&&Buffer.byteLength(sql)<=manifest.caps.sqlBytes&&manifest.steps.some(s=>s.sql===sql)
}

/** No new clock: all dispatches and verification use the existing engine deadline.
 * The outer engine separately accounts actions/control/output against its caps. */
export async function runTestOwnerReorderCommittedTransitions(manifest:TestOwnerReorderCommittedManifest,target:DraftSaveTarget,driver:DraftSaveDriver,absoluteDeadline:number) {
  assert(issued.has(manifest)&&Object.isFrozen(target));assert.equal(target.projectId,manifest.projectId)
  assert.equal(target.containerProjectLabel,manifest.projectId);assert.equal(target.disposable,true)
  assert.equal(target.apiUrl,'http://127.0.0.1:54331');assert.equal(target.databaseHost,'127.0.0.1');assert.equal(target.databasePort,54332)
  assert.match(target.containerId,/^[a-f0-9]{64}$/);assert.match(target.reviewedHead,/^[a-f0-9]{40}$/);assert.match(target.migrationManifestSha256,/^[a-f0-9]{64}$/)
  assert.equal(target.reviewedSourceSha256,manifest.sourceSha256);assert.equal(target.acceptedManifestSha256,hash(JSON.stringify(manifest)))
  assert(Number.isSafeInteger(absoluteDeadline)&&absoluteDeadline>Date.now()&&absoluteDeadline-Date.now()<=manifest.caps.totalMs)
  const started=Date.now();const remaining=()=>{const n=absoluteDeadline-Date.now();assert(n>0,'Existing native deadline exhausted');return n}
  const verify=async()=>{remaining();assert.deepEqual(await driver.verifyTarget(),target);remaining()}
  let holder:DraftSaveSession|undefined,contender:DraftSaveSession|undefined,primary:unknown,failed=false,bytes=0,dispatches=0,prior:string|undefined
  const caches=new Map<string,string>();const cachedIds=new Map<string,readonly unknown[]>();const receipts:Readonly<Record<string,unknown>>[]=[]
  try {
    await verify();holder=await driver.openSession(`${manifest.projectId}_draft_holder`);remaining()
    await verify();contender=await driver.openSession(`${manifest.projectId}_draft_contender`);remaining()
    assert.equal(holder.name,`${manifest.projectId}_draft_holder`);assert.equal(contender.name,`${manifest.projectId}_draft_contender`)
    for(const step of manifest.steps) {
      assert(validateTestOwnerReorderCommittedSql(manifest,step.sql));assert(++dispatches<=manifest.caps.dispatches);await verify()
      const rows:readonly {result?:unknown}[]=await (step.side==='holder'?holder:contender).execute(step.sql,Math.min(manifest.caps.requestMs,remaining()));remaining()
      const size=Buffer.byteLength(JSON.stringify(rows));assert(size<=manifest.caps.responseBytes);bytes+=size;assert(bytes<=manifest.caps.totalBytes)
      assert.equal(rows.length,1);const value=rows[0].result;assert(value&&typeof value==='object'&&!Array.isArray(value));
      const r=value as Record<string,unknown>
      assert.deepEqual(Object.keys(r).sort(),['label','outcome','before_sha256','after_sha256','cached_sha256','actor_id','classroom_id','test_ids','count','full_graph_verified'].sort())
      assert.equal(r.label,step.label);assert.equal(r.outcome,step.outcome);assert.equal(r.full_graph_verified,true)
      assert.match(String(r.before_sha256),/^[a-f0-9]{64}$/);assert.match(String(r.after_sha256),/^[a-f0-9]{64}$/);assert.equal(r.actor_id,step.actorId);assert.equal(r.classroom_id,step.classroomId)
      assert(Array.isArray(r.test_ids)&&r.test_ids.length<=1000&&new Set(r.test_ids).size===r.test_ids.length);r.test_ids.forEach(id=>assert(typeof id==='string'&&UUID.test(id)))
      assert.equal(r.count,r.test_ids.length);if(prior!==undefined)assert.equal(r.before_sha256,prior,'Cross-session committed preimage chain differs')
      const schedule=step.label.split(':')[0]
      if(step.outcome==='cached') {assert.equal(r.cached_sha256,null);caches.set(`${schedule}:${step.side}`,String(r.before_sha256));cachedIds.set(`${schedule}:${step.side}`,r.test_ids)}
      else if(step.chain==='cached') {assert.equal(r.cached_sha256,caches.get(`${schedule}:${step.side}`),'Captured pre-writer source differs');assert.deepEqual(r.test_ids,cachedIds.get(`${schedule}:${step.side}`),'Previously captured request IDs differ')}
      else assert.equal(r.cached_sha256,null)
      if(step.chain==='same'||/^PT/.test(step.outcome))assert.equal(r.after_sha256,r.before_sha256,'Read/denial changed complete graph')
      prior=String(r.after_sha256);receipts.push(freeze({...r}));await verify()
    }
  } catch(error) {primary=error;failed=true}
  finally {
    const settled=await Promise.allSettled([holder,contender].filter((s):s is DraftSaveSession=>Boolean(s)).map(s=>s.rollbackAndClose(manifest.caps.closeMs)))
    const errors=settled.flatMap(r=>r.status==='rejected'?[r.reason]:[])
    if(errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],'Committed session cleanup failed; dispose target without compensation')
  }
  if(failed)throw primary
  return freeze({kind:'committed-test-owner-reorder-transitions' as const,projectId:manifest.projectId,sourceSha256:manifest.sourceSha256,manifestSha256:target.acceptedManifestSha256,
    schedules:manifest.schedules,dispatches,bytes,receipts,remainingSessions:0 as const,elapsedMs:Date.now()-started,complete:true as const})
}
export type TestOwnerReorderCommittedReceipt = Awaited<ReturnType<typeof runTestOwnerReorderCommittedTransitions>>
