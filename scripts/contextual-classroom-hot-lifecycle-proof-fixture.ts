/** Closed synthetic268 fixture. Importing/generating this source executes nothing. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
export const hotLifecycleDigest=(v:string)=>createHash('sha256').update(v).digest('hex')
export function freezeHot<T>(v:T):T {if(v&&typeof v==='object'){Object.values(v).forEach(freezeHot);Object.freeze(v)}return v}
export const HOT_LIFECYCLE_CAPS=freezeHot({sqlBytes:524288,responseBytes:8388608,requestMs:12000,totalMs:180000,dispatches:80,closeMs:12000})
export const hotQuote=(s:string)=>`'${s.replaceAll("'","''")}'`
const q=hotQuote
export function newClassroomHotLifecycleFixture(original:AssignmentListProofFixture) {
  const suffix=original.manifest.syntheticTag.slice(-12);assert.match(suffix,/^[a-f0-9]{12}$/)
  const tag=`classroomhot_${suffix}`,id=(s:string)=>{const h=hotLifecycleDigest(`${tag}:${s}`);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
  const actors=(['teacher','student','student','teacher']as const).map((role,i)=>({id:id(`actor${i}`),role,email:`${tag}_${i}@example.invalid`}))
  const classes=Array.from({length:6},(_,i)=>({id:id(`class${i}`),owner:actors[i===1||i===5?1:0].id,
    title:`${tag} Class${i}`,code:`${tag}_${i}`,archived:i>=3,position:i===2?-7:i}))
  const testId=id('test'),questionId=id('question'),enrollment=id('enrollment'),announcement=id('announcement'),operation=id('create-operation')
  const grants=actors.filter((_,i)=>i!==2).map(a=>({id:id(`grant:${a.id}`),actor:a.id,capacity:a.id===actors[0].id?3:2}))
  const allocatedIds=[...actors,...classes,...grants].map(a=>a.id).concat([testId,questionId,enrollment,announcement,operation])
  assert.equal(new Set(allocatedIds).size,allocatedIds.length);assert(allocatedIds.every(id=>!(original.allocatedIds as readonly string[]).includes(id)))
  return freezeHot({version:1,tag,now:original.manifest.now,projectId:`pika_assignment_list_${suffix}`,actors,classes,grants,testId,questionId,enrollment,announcement,operation,allocatedIds})
}
export type HotLifecycleFixture=ReturnType<typeof newClassroomHotLifecycleFixture>
export const hotGraphFunctions=`create or replace function pg_temp.hot_graph() returns jsonb language plpgsql as $graph$
declare t record;v jsonb;g jsonb:='{}';begin
for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','private','storage') order by n.nspname,c.relname loop
 execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r',t.nspname,t.relname) into v;
 g:=g||jsonb_build_object(t.nspname||'.'||t.relname,v);end loop;
return g||jsonb_build_object('__catalog',(select md5(coalesce(string_agg(x.definition,'' order by x.definition),'')) from (
 select pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'') definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'
 union all select pg_get_triggerdef(t.oid)||t.tgenabled::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and not t.tgisinternal) x));end;$graph$;`
export const hotSnapshotSelect=`select pg_temp.hot_graph() as result;`
export function hotLifecycleSnapshotSql(){return `${hotGraphFunctions}begin read only;set local statement_timeout='8s';${hotSnapshotSelect}rollback;`}
export function hotLifecycleSetupSql(f:HotLifecycleFixture) {
  const ids=f.allocatedIds.map(q).join(',')
  return `${testOwnerGuardSql(f.projectId)}
begin;set local lock_timeout='1s';set local statement_timeout='12s';
do $collision$ begin if exists(select 1 from public.users where id in (${ids}) or email like ${q(f.tag+'%')})
 or exists(select 1 from public.classrooms where id in (${ids}) or class_code like ${q(f.tag+'%')})
 then raise exception 'Hot lifecycle synthetic namespace collision';end if;end;$collision$;
insert into public.users(id,email,role) values ${f.actors.map(a=>`(${q(a.id)},${q(a.email)},${q(a.role)})`).join(',')};
do $grants$ begin ${f.grants.map(g=>`perform public.set_effective_feature_entitlement_v1(${q(g.id)},${q(g.actor)},'classrooms.create','manual',true,clock_timestamp(),null,${g.capacity},'test:classroom-hot-lifecycle',${q(f.tag)},0);`).join('\n')} end;$grants$;
insert into public.classrooms(id,teacher_id,title,class_code,position,archived_at,feature_visibility) values ${f.classes.map(c=>`(${q(c.id)},${q(c.owner)},${q(c.title)},${q(c.code)},${c.position},${c.archived?`${q(f.now)}::timestamptz`:'null'},'{"tests":true}'::jsonb)`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values (${q(f.enrollment)},${q(f.classes[0].id)},${q(f.actors[2].id)});
insert into public.announcements(id,classroom_id,created_by,content) values (${q(f.announcement)},${q(f.classes[0].id)},${q(f.actors[0].id)},'Preserved hot lifecycle content');
insert into public.tests(id,classroom_id,created_by,title,status) values (${q(f.testId)},${q(f.classes[0].id)},${q(f.actors[0].id)},'Synthetic hot lifecycle Test','active');
insert into public.test_questions(id,artifact_id,test_id,question_type,question_text,options,correct_option,points,position) values
 (${q(f.questionId)},${q(f.questionId)},${q(f.testId)},'multiple_choice','Synthetic hot lifecycle question','["A","B"]'::jsonb,1,5,0);
commit;`
}
export type HotGraph=Record<string,Record<string,unknown>[]|string>
/** Preserve every non-target table/row and every non-lifecycle Classroom field. */
export function assertHotLifecycleGraphChange(before:HotGraph,after:HotGraph,classroomId:string,archived:boolean) {
  const copy=structuredClone(before),rows=after['public.classrooms'] as Record<string,unknown>[],old=(before['public.classrooms'] as Record<string,unknown>[]).find(r=>r.id===classroomId)!,fresh=rows.find(r=>r.id===classroomId)!
  assert(old&&fresh&&old.teacher_id===fresh.teacher_id)
  assert.equal(fresh.archived_at===null,!archived);assert(typeof fresh.updated_at==='string'&&Number.isFinite(Date.parse(fresh.updated_at)))
  if(archived){assert(typeof fresh.archived_at==='string'&&Number.isFinite(Date.parse(fresh.archived_at)));assert.equal(fresh.position,old.position)}
  else {const peers=(before['public.classrooms'] as Record<string,unknown>[]).filter(c=>c.teacher_id===old.teacher_id&&c.archived_at===null);assert.equal(fresh.position,peers.length?Math.min(...peers.map(c=>Number(c.position)))-1:0)}
  assert.deepEqual(fresh,{...old,archived_at:fresh.archived_at,position:fresh.position,updated_at:fresh.updated_at})
  copy['public.classrooms']=(copy['public.classrooms'] as Record<string,unknown>[]).map(r=>r.id===classroomId?fresh:r)
  const previous=(before['public.classroom_archive_revisions'] as Record<string,unknown>[]).find(r=>r.classroom_id===classroomId)!,next=(after['public.classroom_archive_revisions'] as Record<string,unknown>[]).find(r=>r.classroom_id===classroomId)!
  assert(previous&&next);assert.equal(Number(next.revision),Number(previous.revision)+1);assert.equal(next.updated_at,fresh.updated_at)
  assert.deepEqual(next,{...previous,revision:next.revision,updated_at:next.updated_at})
  copy['public.classroom_archive_revisions']=(copy['public.classroom_archive_revisions'] as Record<string,unknown>[]).map(r=>r.classroom_id===classroomId?next:r)
  // SQL JSON aggregation orders by the complete row, not only its id.
  const normalizedAfter=structuredClone(after)
  for(const graph of [copy,normalizedAfter])for(const [key,value]of Object.entries(graph))if(Array.isArray(value))graph[key]=[...value].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
  assert.deepEqual(normalizedAfter,copy)
}
