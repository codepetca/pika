/** Inert277 concurrency descriptors and strict receipts only. The existing
 * carrier owns processes, two slots, guards, joins and original deadlines.
 * Subject serialization is NOT evidence of a performed classroom creation. */
import assert from 'node:assert/strict'
import {z} from 'zod'
import {assertClassroomListReorderFixture,classroomListReorderFreeze as freeze,classroomListReorderHash as hash,
  classroomListReorderGraphSql,type ClassroomListReorderFixture} from './contextual-classroom-list-reorder-native-fixture'
export const CLASSROOM_LIST_REORDER_LOCK_LABELS=['subject-serialization','classroom-operation-archive','classroom-owner-nowait-transfer']as const
export type ClassroomListReorderLockLabel=typeof CLASSROOM_LIST_REORDER_LOCK_LABELS[number]
export const CLASSROOM_LIST_REORDER_LOCK_CAPS=freeze({pairs:3,sessions:2,requests:0,sqlBytes:262144,replyBytes:4096,observationMs:750,polls:150,cadenceMs:5,sqlMs:8000,lockMs:1000,automaticRetries:0})
const q=(v:string)=>`'${v.replaceAll("'","''")}'`,json=(v:unknown)=>`${q(JSON.stringify(v))}::jsonb`
const digest=(v:string)=>`encode(sha256(convert_to(${v}::text,'UTF8')),'hex')`
const begin="begin;set local timezone='UTC';set local statement_timeout='8s';set local lock_timeout='1s';"
const state='pg_temp.clr_lock_state()'
const self="(select jsonb_build_object('pid',pid,'started',backend_start::text,'xact',xact_start::text) from pg_stat_activity where pid=pg_backend_pid())"
const peer="jsonb_build_object('pid',v_peer.pid,'started',v_peer.started,'xact',v_peer.xact)"
const lockWhere=(pid:string,k:string,granted=true)=>`pid=${pid} and locktype='advisory' and ${granted?'granted':'not granted'} and mode='ExclusiveLock' and objsubid=1 and classid::bigint=((${k}>>32)&4294967295) and objid::bigint=(${k}&4294967295)`
const subjectKey=(actor:string)=>`hashtextextended(${q(`${actor}:classrooms.create`)},16620260912)`
const classKey=(id:string)=>`hashtextextended(${q(`pika-classroom-operation:${id}`)},0)`
function names(f:ClassroomListReorderFixture,n:number){const p=`clr_lock_${n}_${f.tag.slice(-12)}`;return{A:`${p}_A`,B:`${p}_B`,ready:`${p}_A_ready`,seen:`${p}_B_seen`}}
function pin(f:ClassroomListReorderFixture,n:number,role:'A'|'B'){const tag=`clr_${n}_${role}_${f.tag.slice(-12)}`,prefix=`do $${tag}$`;return{tag,prefix,sha256:hash(prefix)}}
function poll(condition:string,error:string){return`v_until:=clock_timestamp()+interval '750 milliseconds';v_attempts:=0;loop perform pg_stat_clear_snapshot();exit when ${condition};v_attempts:=v_attempts+1;if v_attempts>=150 or clock_timestamp()>=v_until then raise exception ${q(error)};end if;perform pg_sleep(0.005);end loop;`}
function pollPeer(app:string,p:ReturnType<typeof pin>){return`v_until:=clock_timestamp()+interval '750 milliseconds';v_attempts:=0;loop perform pg_stat_clear_snapshot();
 if (select count(*) from pg_stat_activity where application_name=${q(app)})>1 then raise exception 'Reorder ambiguous peer';end if;
 select pid,backend_start::text started,xact_start::text xact into v_peer from pg_stat_activity where application_name=${q(app)} and datname=current_database() and usename='postgres'
 and backend_type='client backend' and client_addr is null and pid<>pg_backend_pid() and state='active' and backend_start is not null and xact_start is not null and query_start>=backend_start
 and left(ltrim(query,E' \\n\\r\\t'),${p.prefix.length})=${q(p.prefix)} and encode(sha256(convert_to(left(ltrim(query,E' \\n\\r\\t'),${p.prefix.length}),'UTF8')),'hex')=${q(p.sha256)};
 exit when found;v_attempts:=v_attempts+1;if v_attempts>=150 or clock_timestamp()>=v_until then raise exception 'Reorder peer absent';end if;perform pg_sleep(0.005);end loop;`}
function profile(app:string){return`if current_user<>'postgres' or current_setting('application_name') is distinct from ${q(app)} or exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and application_name=${q(app)}) then raise exception 'Reorder session profile differs';end if;`}
/** Complete rows, including automatic Free/audit/Pal evidence and the untouched
 * complement. Temporary oracle functions do not execute application writes. */
function stateSql(f:ClassroomListReorderFixture){return`create function pg_temp.clr_lock_state() returns jsonb language sql set search_path='' as $state$ select jsonb_build_object('fixture',${classroomListReorderGraphSql(f,true)},'complementSha256',${digest(`(${classroomListReorderGraphSql(f,false)})`)});$state$;
 create function pg_temp.clr_assert_effect(p_before jsonb,p_after jsonb,p_order jsonb,p_kind text,p_target uuid,p_owner uuid) returns void language plpgsql set search_path='' as $oracle$
 declare v_expected jsonb:=p_before;v_classes jsonb;v_revisions jsonb;v_archived jsonb;v_row jsonb;begin
 if p_kind not in ('reorder','archive','transfer') then raise exception 'Reorder effect kind differs';end if;
 if p_kind='archive' then select value->'archived_at' into strict v_archived from jsonb_array_elements(p_after#>'{fixture,classrooms}') where value->>'id'=p_target::text;
 if v_archived='null'::jsonb or (v_archived#>>'{}')::timestamptz<statement_timestamp() or (v_archived#>>'{}')::timestamptz>clock_timestamp() then raise exception 'Reorder archive clock differs';end if;end if;
 select jsonb_agg(r order by r::text) into v_classes from (select case
 when p_kind='reorder' and p_order ? (value->>'id') then value||jsonb_build_object('position',(p_order->>(value->>'id'))::integer,'updated_at',transaction_timestamp())
 when p_kind='archive' and value->>'id'=p_target::text then value||jsonb_build_object('archived_at',v_archived,'updated_at',transaction_timestamp())
 when p_kind='transfer' and value->>'id'=p_target::text then value||jsonb_build_object('teacher_id',p_owner,'updated_at',transaction_timestamp()) else value end r
 from jsonb_array_elements(p_before#>'{fixture,classrooms}')) rows;
 select jsonb_agg(r order by r::text) into v_revisions from (select case when (p_kind='reorder' and p_order ? (value->>'classroom_id')) or (p_kind<>'reorder' and value->>'classroom_id'=p_target::text)
 then value||jsonb_build_object('revision',(value->>'revision')::bigint+1,'updated_at',transaction_timestamp()) else value end r from jsonb_array_elements(p_before#>'{fixture,classroom_archive_revisions}')) rows;
 v_expected:=jsonb_set(jsonb_set(v_expected,'{fixture,classrooms}',v_classes),'{fixture,classroom_archive_revisions}',v_revisions);
 if p_after is distinct from v_expected then raise exception 'Reorder complete graph effect differs';end if;
 end;$oracle$;`}
function baseline(f:ClassroomListReorderFixture,phase:number){return`select * into strict b from ${f.baseline};
 if b.observed<>${phase} or v_before->'fixture' is distinct from b.checkpoint or v_before->>'complementSha256' is distinct from b.original_sha256
 or v_before#>'{fixture,classroom_purge_fences}' is distinct from '[]'::jsonb or v_before#>'{fixture,classroom_purge_operations}' is distinct from '[]'::jsonb
 or not exists(select 1 from public.effective_feature_entitlements where subject_user_id=${q(f.actors[0].id)}::uuid and feature_key='classrooms.create' and not enabled)
 then raise exception 'Reorder committed baseline differs';end if;`}
const declarations=`declare b record;v_peer record;v_self jsonb;v_until timestamptz;v_attempts integer;v_before jsonb;v_after jsonb;v_result jsonb;v_message text;v_actor uuid;v_probe boolean:=false;
 v_fresh_self jsonb;v_fresh_succeeded boolean:=false;v_fresh_rolled_back boolean:=false;v_fresh_hash text;begin `
function rpc(actor:string,ids:string[]){return`public.reorder_classrooms_for_owner_v1(${q(actor)}::uuid,array[${ids.map(id=>`${q(id)}::uuid`).join(',')}]::uuid[])`}
function success(actor:string,ids:string[]){return`set local role service_role;if current_user<>'service_role' then raise exception 'Reorder RPC role differs';end if;v_result:=${rpc(actor,ids)};reset role;
 if current_user<>'postgres' or v_result is distinct from ${json({actor_id:actor,classroom_ids:ids,reordered:true})} then raise exception 'Reorder complete RPC vector differs';end if;
 v_after:=${state};perform pg_temp.clr_assert_effect(v_before,v_after,${json(Object.fromEntries(ids.map((id,n)=>[id,n])))},'reorder',null,null);`}
function denial(actor:string,ids:string[],code:'PT409'|'PT400'){return`begin set local role service_role;if current_user<>'service_role' then raise exception 'Reorder denial role differs';end if;
 perform ${rpc(actor,ids)};raise exception 'Reorder denial unexpectedly succeeded';exception when sqlstate ${q(code)} then get stacked diagnostics v_message=message_text;
 if v_message is distinct from ${q(code==='PT409'?'classroom_list_reorder_busy':'classroom_list_reorder_invalid_set')} then raise exception 'Reorder exact conflict differs';end if;end;reset role;
 if current_user<>'postgres' then raise exception 'Reorder observer role differs';end if;`}
function partialReleased(f:ClassroomListReorderFixture){const keys=[subjectKey(f.actors[0].id),...f.classes.slice(0,2).map(c=>classKey(c.id))];return`if exists(select 1 from pg_locks where ${keys.map(k=>`(${lockWhere('pg_backend_pid()',k)})`).join(' or ')}) then raise exception 'Reorder partial advisory locks retained';end if;`}
function pairSql(f:ClassroomListReorderFixture,label:ClassroomListReorderLockLabel){
  const n=CLASSROOM_LIST_REORDER_LOCK_LABELS.indexOf(label),app=names(f,n),pins={A:pin(f,n,'A'),B:pin(f,n,'B')},[owner,teacher]=f.actors,[a,cB,c,d]=f.classes
  const initial=n===2?[a.id]:[cB.id,a.id],fresh=n===0?[a.id,cB.id]:n===1?[a.id]:[c.id,d.id,a.id],freshActor=n===2?teacher.id:owner.id
  const bindingSha256=hash(JSON.stringify({tag:f.tag,label,initial:{actor:owner.id,ids:initial},fresh:{actor:freshActor,ids:fresh},caps:CLASSROOM_LIST_REORDER_LOCK_CAPS}))
  const header=`${begin}create temp table clr_lock_result(result jsonb not null,before_state jsonb not null) on commit preserve rows;${stateSql(f)}`
  const receipt=(role:'A'|'B')=>`jsonb_build_object('version',1,'scope','classroom-list-reorder-lock-pair-v1','label',${q(label)},'bindingSha256',${q(bindingSha256)},'role',${q(role)},'self',v_self,'peer',${peer},
 'beforeSha256',${digest('v_before')},'afterBusySha256',${role==='B'&&n===0?'null':digest('v_before')},'committedSha256',${role==='B'&&n===0?digest('v_after'):'null'},'terminalSha256',${role==='B'&&n===0?digest('v_after'):digest('v_before')},
 'holderWitnessed',${role==='B'},'blockedObserved',${role==='A'&&n===0},'conflict',${q(role==='A'?'acknowledged':n?'PT409':'success')},'busy',${role==='B'&&n!==0},'partialLocksReleased',${role==='B'&&n!==0},
 'freshDenied',false,'freshSucceeded',false,'freshRolledBack',false,'freshSha256',null,'freshSelf',null,'sentinel',null,'realRpcCalls',${role==='B'?1:0},'requests',0,'sessions',2,'executionEnabled',false,'nativeVerified',false)`
  const acquire=n===0?`perform public.lock_effective_feature_entitlement_v1(${q(owner.id)}::uuid,'classrooms.create');if not exists(select 1 from pg_locks where ${lockWhere('pg_backend_pid()',subjectKey(owner.id))}) then raise exception 'Reorder owned subject lock absent';end if;`
    :n===1?`if not public.classroom_purge_try_lock(${q(cB.id)}::uuid) then raise exception 'Reorder operation holder unavailable';end if;`
      :`perform 1 from public.classrooms where id=${q(a.id)}::uuid for update nowait;if not found then raise exception 'Reorder row holder absent';end if;`
  const observe=n===0?`${pollPeer(app.B,pins.B)}${poll(`pg_backend_pid()=any(pg_blocking_pids(v_peer.pid)) and exists(select 1 from pg_locks where ${lockWhere('v_peer.pid',subjectKey(owner.id),false)}) and exists(select 1 from pg_stat_activity where pid=v_peer.pid and backend_start::text=v_peer.started and xact_start::text=v_peer.xact and wait_event_type='Lock' and wait_event='advisory')`,'Reorder actual subject blocking absent')}`:pollPeer(app.seen,pins.B)
  const transition=n===0?'':`${begin}do $clr_transition_${n}_${f.tag.slice(-12)}$ ${declarations}${profile(app.A)}v_before:=${state};${baseline(f,11+n)}
 if v_before is distinct from (select before_state from clr_lock_result) then raise exception 'Reorder pretransition graph differs';end if;
 ${n===1?`set local role service_role;if current_user<>'service_role' then raise exception 'Reorder archive RPC role differs';end if;
 v_result:=public.set_classroom_hot_archive_for_owner_v1(${q(owner.id)}::uuid,${q(cB.id)}::uuid,true);reset role;
 v_after:=${state};if v_result is distinct from (select to_jsonb(r) from public.classrooms r where id=${q(cB.id)}::uuid) then raise exception 'Reorder archive complete result differs';end if;
 perform pg_temp.clr_assert_effect(v_before,v_after,'{}'::jsonb,'archive',${q(cB.id)}::uuid,null);`
 :`-- A separate transaction takes subject locks before operation and row, retaining normal ownership triggers.
 for v_actor in select actor from (values(${q(owner.id)}::uuid),(${q(teacher.id)}::uuid)) subjects(actor) order by actor loop perform public.lock_effective_feature_entitlement_v1(v_actor,'classrooms.create');end loop;
 if not public.classroom_purge_try_lock(${q(a.id)}::uuid) then raise exception 'Reorder transfer operation busy';end if;
 perform public.guard_classroom_purge_lifecycle(${q(a.id)}::uuid);perform 1 from public.classrooms where id=${q(a.id)}::uuid for update nowait;
 update public.classrooms set teacher_id=${q(teacher.id)}::uuid where id=${q(a.id)}::uuid and teacher_id=${q(owner.id)}::uuid and archived_at is null;
 if not found then raise exception 'Reorder ownership transition missed';end if;v_after:=${state};perform pg_temp.clr_assert_effect(v_before,v_after,'{}'::jsonb,'transfer',${q(a.id)}::uuid,${q(teacher.id)}::uuid);`}
 update ${f.baseline} set checkpoint=v_after->'fixture',window_start=statement_timestamp(),observed=${12+n};
 update clr_lock_result set result=result||jsonb_build_object('committedSha256',${digest('v_after')},'terminalSha256',${digest('v_after')});end;$clr_transition_${n}_${f.tag.slice(-12)}$;commit;`
  const aSql=`${header}${pins.A.prefix} ${declarations}${profile(app.A)}v_self:=${self};v_before:=${state};${baseline(f,11+n)}${acquire}
 perform set_config('application_name',${q(app.ready)},true);${observe}v_after:=${state};if v_after is distinct from v_before then raise exception 'Reorder holder graph changed';end if;
 insert into clr_lock_result values(${receipt('A')},v_before);end;$${pins.A.tag}$;commit;${transition}select result from clr_lock_result;`
  const probe=n===0?`if not exists(select 1 from pg_locks where ${lockWhere('v_peer.pid',subjectKey(owner.id))}) then raise exception 'Reorder subject holder absent';end if;`
    :n===1?`if not exists(select 1 from pg_locks where ${lockWhere('v_peer.pid',classKey(cB.id))}) then raise exception 'Reorder operation holder absent';end if;`
      :`begin perform 1 from public.classrooms where id=${q(a.id)}::uuid for update nowait;raise exception 'Reorder exact row unexpectedly available';exception when sqlstate '55P03' then v_probe:=true;end;
 if v_probe is distinct from true then raise exception 'Reorder exact row conflict absent';end if;`
  const initialCall=n===0?`${success(owner.id,initial)}update ${f.baseline} set checkpoint=v_after->'fixture',window_start=statement_timestamp(),observed=12;`
    :`${denial(owner.id,initial,'PT409')}${partialReleased(f)}v_after:=${state};if v_after is distinct from v_before then raise exception 'Reorder busy graph differs';end if;`
  const release=n===0?'':`perform set_config('application_name',${q(app.seen)},true);${poll(`(select observed from ${f.baseline})=${12+n} and ${n===1?`(select archived_at is not null from public.classrooms where id=${q(cB.id)}::uuid)`:`(select teacher_id=${q(teacher.id)}::uuid from public.classrooms where id=${q(a.id)}::uuid)`}`,'Reorder committed transition absent')}`
  const freshSql=`${begin}do $clr_fresh_${n}_${f.tag.slice(-12)}$ ${declarations}${profile(app.B)}v_before:=${state};${baseline(f,12+n)}v_fresh_self:=${self};
 if (v_fresh_self->>'pid')::integer is distinct from (select (result#>>'{self,pid}')::integer from clr_lock_result)
 or v_fresh_self->>'started' is distinct from (select result#>>'{self,started}' from clr_lock_result)
 or (v_fresh_self->>'xact')::timestamptz<=(select (result#>>'{self,xact}')::timestamptz from clr_lock_result) then raise exception 'Reorder fresh transaction identity differs';end if;
 ${n?`${denial(owner.id,n===1?[a.id,cB.id]:[a.id],'PT400')}${partialReleased(f)}v_after:=${state};if v_after is distinct from v_before then raise exception 'Reorder fresh denial changed graph';end if;`:''}
 begin ${success(freshActor,fresh)}v_fresh_hash:=${digest('v_after')};v_fresh_succeeded:=true;
 raise exception using errcode='PZ277',message='classroom_list_reorder_fresh_rollback';exception when sqlstate 'PZ277' then get stacked diagnostics v_message=message_text;
 if v_message is distinct from 'classroom_list_reorder_fresh_rollback' or not v_fresh_succeeded or v_fresh_hash is null then raise;end if;v_fresh_rolled_back:=true;end;
 reset role;if current_user<>'postgres' or not v_fresh_succeeded or not v_fresh_rolled_back then raise exception 'Reorder fresh rollback absent';end if;
 v_after:=${state};if v_after is distinct from v_before then raise exception 'Reorder fresh rollback graph differs';end if;
 update clr_lock_result set result=result||jsonb_build_object('committedSha256',${digest('v_before')},'terminalSha256',${digest('v_after')},'freshDenied',${n!==0},'freshSucceeded',true,'freshRolledBack',true,'freshSha256',v_fresh_hash,'freshSelf',v_fresh_self,'sentinel','classroom_list_reorder_fresh_rollback','realRpcCalls',${n?3:2});
 end;$clr_fresh_${n}_${f.tag.slice(-12)}$;commit;select result from clr_lock_result;`
  const bSql=`${header}${pins.B.prefix} ${declarations}${profile(app.B)}v_self:=${self};${pollPeer(app.ready,pins.A)}v_before:=${state};${baseline(f,11+n)}${probe}${initialCall}
 insert into clr_lock_result values(${receipt('B')},v_before);${release}end;$${pins.B.tag}$;commit;${freshSql}`
  for(const sql of[aSql,bSql])assert(Buffer.byteLength(sql)<=CLASSROOM_LIST_REORDER_LOCK_CAPS.sqlBytes)
  return{label,a:aSql,b:bSql,sha256:hash(JSON.stringify({a:aSql,b:bSql})),bindingSha256,applications:app,profile:'baseline-off'as const,sessions:2 as const,requests:0 as const,executionEnabled:false as const,nativeVerified:false as const}
}
function postflight(f:ClassroomListReorderFixture){
  const[owner,teacher]=f.actors,[a,b,c,d]=f.classes,active=[a,b,c,d],deltas=Object.fromEntries(active.map((r,n)=>[r.id,n<2?6:1]))
  const bindingSha256=hash(JSON.stringify({tag:f.tag,stage:'postflight',deltas,caps:CLASSROOM_LIST_REORDER_LOCK_CAPS}))
  const actual=classroomListReorderGraphSql(f,true),original=digest(`(${classroomListReorderGraphSql(f,false)})`)
  const sql=`begin read only;set local timezone='UTC';set local statement_timeout='8s';set local lock_timeout='1s';
 with measured as materialized(select ${actual} as g,${original} as complement),baseline as materialized(select * from ${f.baseline}),
 expected_classes as materialized(select jsonb_agg(r order by r::text) as rows from (select case
 when old->>'id'=${q(a.id)} then old||jsonb_build_object('teacher_id',${q(teacher.id)}::uuid,'position',1,'updated_at',cur_row->'updated_at')
 when old->>'id'=${q(b.id)} then old||jsonb_build_object('position',0,'archived_at',cur_row->'archived_at','updated_at',cur_row->'updated_at')
 when old->>'id' in (${q(c.id)},${q(d.id)}) then old||jsonb_build_object('updated_at',cur_row->'updated_at') else old end r
 from baseline,measured,lateral jsonb_array_elements(graph->'classrooms') old
 join lateral jsonb_array_elements(g->'classrooms') cur_row on cur_row->>'id'=old->>'id') expected),
 expected_revisions as materialized(select jsonb_agg(r order by r::text) as rows from (select case when ${json(deltas)} ? (old->>'classroom_id') then
 old||jsonb_build_object('revision',(old->>'revision')::bigint+(${json(deltas)}->>(old->>'classroom_id'))::bigint,'updated_at',cur_row->'updated_at') else old end r
 from baseline,measured,lateral jsonb_array_elements(graph->'classroom_archive_revisions') old
 join lateral jsonb_array_elements(g->'classrooms') cur_row on cur_row->>'id'=old->>'classroom_id') expected)
 select jsonb_build_object('version',1,'scope','classroom-list-reorder-lock-postflight-v1','bindingSha256',${q(bindingSha256)},
 'terminalSha256',${digest("jsonb_build_object('fixture',g,'complementSha256',complement)")},
 'sourcePreserved',observed=14 and g is not distinct from checkpoint and g is not distinct from (graph||jsonb_build_object('classrooms',ec.rows,'classroom_archive_revisions',er.rows)),
 'originalsPreserved',complement=original_sha256,'disabledCreationGrant',exists(select 1 from public.effective_feature_entitlements where subject_user_id=${q(owner.id)}::uuid and feature_key='classrooms.create' and not enabled),
 'completeOwnedSets',not exists(select 1 from public.classrooms where teacher_id=${q(owner.id)}::uuid and archived_at is null)
 and array(select id from public.classrooms where teacher_id=${q(teacher.id)}::uuid and archived_at is null order by id)=array[${[a.id,c.id,d.id].sort().map(id=>`${q(id)}::uuid`).join(',')}]::uuid[]
 and (select archived_at is not null and teacher_id=${q(owner.id)}::uuid from public.classrooms where id=${q(b.id)}::uuid),
 'legitimateVersions',(g->'classroom_archive_revisions') is not distinct from er.rows and not exists(select 1 from jsonb_array_elements(g->'classrooms') r where r->>'id' in (${active.map(r=>q(r.id)).join(',')}) and
 (r->>'updated_at' is null or (r->>'updated_at')::timestamptz>statement_timestamp() or (r->>'updated_at')::timestamptz<(select (old->>'updated_at')::timestamptz from jsonb_array_elements(graph->'classrooms') old where old->>'id'=r->>'id')
 or (r->>'id'=${q(b.id)} and (r->>'archived_at' is null or (r->>'archived_at')::timestamptz>statement_timestamp() or (r->>'archived_at')::timestamptz<(select (old->>'updated_at')::timestamptz from jsonb_array_elements(graph->'classrooms') old where old->>'id'=r->>'id'))))),
 'requests',0,'sessions',0,'executionEnabled',false,'nativeVerified',false) from measured,baseline,expected_classes ec,expected_revisions er;rollback;`
  assert(Buffer.byteLength(sql)<=65536)
  return{name:'postflight'as const,sql,sha256:hash(sql),bindingSha256,profile:'baseline-off'as const,nativeVerified:false as const}
}
export function classroomListReorderConcurrencyDescriptors(f:ClassroomListReorderFixture){
  assertClassroomListReorderFixture(f)
  return freeze({version:1 as const,scope:'classroom-list-reorder-lock-v1'as const,pairs:CLASSROOM_LIST_REORDER_LOCK_LABELS.map(label=>pairSql(f,label)),postflight:postflight(f),
    caps:CLASSROOM_LIST_REORDER_LOCK_CAPS,profile:'baseline-off'as const,sessions:2 as const,requests:0 as const,executionEnabled:false as const,nativeVerified:false as const})
}
export function assertClassroomListReorderConcurrencyDescriptors(f:ClassroomListReorderFixture,input:unknown):true{assert.deepEqual(input,classroomListReorderConcurrencyDescriptors(f));return true}

const timestamp=z.string().max(80).regex(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::\d\d)?)$/).refine(v=>Number.isFinite(Date.parse(v)))
const micros=(v:string)=>BigInt(Date.parse(v))*BigInt(1000)+BigInt((v.match(/\.(\d{1,6})/)?.[1]??'').padEnd(6,'0').slice(3))
const backend=z.object({pid:z.number().int().min(2).max(2147483647),started:timestamp,xact:timestamp}).strict().refine(v=>micros(v.xact)>=micros(v.started))
const sha=z.string().regex(/^[a-f0-9]{64}$/)
const receiptSchema=z.object({version:z.literal(1),scope:z.literal('classroom-list-reorder-lock-pair-v1'),label:z.enum(CLASSROOM_LIST_REORDER_LOCK_LABELS),bindingSha256:sha,role:z.enum(['A','B']),self:backend,peer:backend,
  beforeSha256:sha,afterBusySha256:sha.nullable(),committedSha256:sha.nullable(),terminalSha256:sha,holderWitnessed:z.boolean(),blockedObserved:z.boolean(),conflict:z.enum(['acknowledged','success','PT409']),busy:z.boolean(),partialLocksReleased:z.boolean(),
  freshDenied:z.boolean(),freshSucceeded:z.boolean(),freshRolledBack:z.boolean(),freshSha256:sha.nullable(),freshSelf:backend.nullable(),sentinel:z.literal('classroom_list_reorder_fresh_rollback').nullable(),
  realRpcCalls:z.union([z.literal(0),z.literal(2),z.literal(3)]),requests:z.literal(0),sessions:z.literal(2),executionEnabled:z.literal(false),nativeVerified:z.literal(false)}).strict()
function plain(value:unknown,seen=new Set<object>()):void{
  if(value===null||typeof value!=='object')return
  assert(!seen.has(value));seen.add(value);assert(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)
  for(const key of Reflect.ownKeys(value)){assert(typeof key==='string');const d=Object.getOwnPropertyDescriptor(value,key)!;assert(d.enumerable&&'value'in d);plain(d.value,seen)}seen.delete(value)
}
function jsonReceipt(output:string):unknown{
  assert(typeof output==='string'&&Buffer.byteLength(output)<=4096&&!/[\r\n]/.test(output.trim()));const value:unknown=JSON.parse(output);plain(value)
  const expected:string[]=[];const keys=(v:unknown):void=>{if(v&&typeof v==='object')for(const[k,child]of Object.entries(v)){expected.push(k);keys(child)}};keys(value)
  const raw=[...output.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(m=>JSON.parse(m[1]) as string);assert.deepEqual(raw.sort(),expected.sort());return value
}
export function parseClassroomListReorderConcurrencyReceipt(output:string){try{return freeze(receiptSchema.parse(jsonReceipt(output)))}catch{throw new Error('Classroom reorder lock receipt rejected')}}
const summarySchema=z.object({label:z.enum(CLASSROOM_LIST_REORDER_LOCK_LABELS),bindingSha256:sha,beforeSha256:sha,terminalSha256:sha,holderWitnessed:z.literal(true),blockedObserved:z.boolean(),busy:z.boolean(),partialLocksReleased:z.boolean(),
  freshAuthorization:z.literal(true),freshRolledBack:z.literal(true),committedState:z.literal(true),exactGraphEffect:z.literal(true),requests:z.literal(0),sessions:z.literal(2),executionEnabled:z.literal(false),nativeVerified:z.literal(false)}).strict()
export function validateClassroomListReorderConcurrencyPair(f:ClassroomListReorderFixture,label:ClassroomListReorderLockLabel,aRaw:unknown,bRaw:unknown){
  try{
    plain(aRaw);plain(bRaw);const a=receiptSchema.parse(aRaw),b=receiptSchema.parse(bRaw),n=CLASSROOM_LIST_REORDER_LOCK_LABELS.indexOf(label),pair=classroomListReorderConcurrencyDescriptors(f).pairs[n];assert(pair)
    assert(a.label===label&&b.label===label&&a.role==='A'&&b.role==='B'&&a.self.pid!==b.self.pid);assert.deepEqual(a.peer,b.self);assert.deepEqual(b.peer,a.self)
    assert(a.bindingSha256===pair.bindingSha256&&b.bindingSha256===pair.bindingSha256&&a.beforeSha256===b.beforeSha256&&a.afterBusySha256===a.beforeSha256)
    assert(!a.holderWitnessed&&a.blockedObserved===(n===0)&&a.conflict==='acknowledged'&&!a.busy&&!a.partialLocksReleased&&!a.freshDenied&&!a.freshSucceeded&&!a.freshRolledBack&&a.freshSha256===null&&a.freshSelf===null&&a.sentinel===null&&a.realRpcCalls===0)
    assert(b.holderWitnessed&&!b.blockedObserved&&b.conflict===(n?'PT409':'success')&&b.busy===(n!==0)&&b.partialLocksReleased===(n!==0)&&b.freshDenied===(n!==0)&&b.realRpcCalls===(n?3:2))
    assert(b.afterBusySha256===(n?b.beforeSha256:null)&&b.committedSha256!==null&&b.terminalSha256===b.committedSha256&&b.committedSha256!==b.beforeSha256)
    assert(n?a.committedSha256===b.committedSha256&&a.terminalSha256===b.terminalSha256:a.committedSha256===null&&a.terminalSha256===a.beforeSha256)
    assert(b.freshSucceeded&&b.freshRolledBack&&b.freshSha256!==null&&b.freshSha256!==b.committedSha256&&b.sentinel==='classroom_list_reorder_fresh_rollback'&&b.freshSelf)
    assert(b.freshSelf.pid===b.self.pid&&b.freshSelf.started===b.self.started&&micros(b.freshSelf.xact)>micros(b.self.xact))
    return freeze(summarySchema.parse({label,bindingSha256:pair.bindingSha256,beforeSha256:b.beforeSha256,terminalSha256:b.terminalSha256,holderWitnessed:true,blockedObserved:n===0,busy:n!==0,partialLocksReleased:n!==0,
      freshAuthorization:true,freshRolledBack:true,committedState:true,exactGraphEffect:true,requests:0,sessions:2,executionEnabled:false,nativeVerified:false}))
  }catch{throw new Error('Classroom reorder lock pair rejected')}
}
const postflightSchema=z.object({version:z.literal(1),scope:z.literal('classroom-list-reorder-lock-postflight-v1'),bindingSha256:sha,terminalSha256:sha,sourcePreserved:z.literal(true),originalsPreserved:z.literal(true),disabledCreationGrant:z.literal(true),
  completeOwnedSets:z.literal(true),legitimateVersions:z.literal(true),requests:z.literal(0),sessions:z.literal(0),executionEnabled:z.literal(false),nativeVerified:z.literal(false)}).strict()
export function parseClassroomListReorderPostflightReceipt(output:string){try{return freeze(postflightSchema.parse(jsonReceipt(output)))}catch{throw new Error('Classroom reorder postflight receipt rejected')}}
export function validateClassroomListReorderPostflight(f:ClassroomListReorderFixture,lastPair:unknown,input:unknown){
  try{plain(lastPair);plain(input);const last=summarySchema.parse(lastPair),value=postflightSchema.parse(input),plan=classroomListReorderConcurrencyDescriptors(f)
    assert(last.label===CLASSROOM_LIST_REORDER_LOCK_LABELS[2]&&last.bindingSha256===plan.pairs[2].bindingSha256&&last.terminalSha256===value.terminalSha256&&value.bindingSha256===plan.postflight.bindingSha256)
    assert(!last.blockedObserved&&last.busy&&last.partialLocksReleased);return freeze(value)
  }catch{throw new Error('Classroom reorder postflight rejected')}
}
