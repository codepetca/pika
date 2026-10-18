/** Closed synthetic wire fixture and pure invariants. No executor/admission or IO. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {surveyCancellationProofDescriptor,surveyWirePrivateStateSql} from './contextual-surveys-cancellation-proof'
import type {SurveyNativeFixture} from './contextual-surveys-native-contracts'
import type {SurveyCommittedProofManifest} from './contextual-surveys-committed-proof'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const q=(s:string)=>`'${s.replaceAll("'","''")}'`
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v}
const issued=new WeakSet<object>()
export function surveyWireProofDescriptor(f:SurveyNativeFixture){
  const c=surveyCancellationProofDescriptor(f),table=`private.${f.tag}_wire_baseline`,sid=f.surveys[1].id,cid=f.classes[1].id,owner=f.actors[1].id
  const request={origin:'http://127.0.0.1:54331',path:'/rest/v1/rpc/get_survey_for_owner_v1',method:'POST' as const,body:{p_actor_id:owner,p_survey_id:sid}}
  const descriptorSha256=hash(JSON.stringify({fixture:c.binding.fixtureSha256,request,table,version:1}))
  const state=surveyWirePrivateStateSql(f),stateStart=c.frames.prepare.indexOf('create or replace function pg_temp.survey_cancel_state()')
  assert(stateStart>0)
  // Reuse the complete source-owned project/database/settings guard, not just
  // the timeout prelude. Each frame independently authenticates its target.
  const begin=c.frames.prepare.slice(0,stateStart)
  const check=`if (select count(*) from ${table})<>1 or not exists(select 1 from ${table} where singleton and descriptor_sha256=${q(descriptorSha256)})
 or not exists(select 1 from pg_class where oid=${q(table)}::regclass and relowner='postgres'::regrole and relkind='r' and not relrowsecurity and not relforcerowsecurity)
 or exists(select 1 from pg_class r cross join lateral aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) a where r.oid=${q(table)}::regclass and a.grantee<>'postgres'::regrole)
 then raise exception 'Survey wire baseline differs';end if;`
  const prepare=`${begin}${state}
 do $absent$ begin if to_regclass(${q(table)}) is not null then raise exception 'Survey wire namespace occupied';end if;
 if not exists(select 1 from public.surveys where id=${q(sid)} and classroom_id=${q(cid)} and created_by=${q(owner)} and title=${q(f.tag)} and status='active' and position=0)
 or not exists(select 1 from public.classrooms where id=${q(cid)} and teacher_id=${q(owner)} and archived_at is null)
 or exists(select 1 from public.survey_questions where survey_id=${q(sid)}) or exists(select 1 from public.survey_responses where survey_id=${q(sid)})
 then raise exception 'Survey wire fixed fixture differs';end if;end;$absent$;
 create temporary table survey_wire_before(state jsonb not null) on commit drop;insert into survey_wire_before values(pg_temp.survey_cancel_state());
 create table ${table}(singleton boolean primary key check(singleton),descriptor_sha256 text not null,state jsonb not null,prepared_at timestamptz not null,inner_bytes integer,minimum_wire_bytes integer,sql_wire_bytes integer);
 revoke all on table ${table} from public,anon,authenticated,service_role;
 insert into ${table} select true,${q(descriptorSha256)},state,transaction_timestamp(),null,null,null from survey_wire_before;
 do $prepare$ declare empty_size integer;inner_size integer;payload jsonb;minimum_size integer;begin ${check}
 -- Read-only row projection predicts the same transaction now() timestamp
 -- the ordinary updated_at trigger will write. No measurement UPDATE occurs.
 select octet_length(jsonb_set(jsonb_set(to_jsonb(s),'{title}','""'::jsonb),'{updated_at}',to_jsonb(transaction_timestamp()))::text)+4 into strict empty_size from public.surveys s where id=${q(sid)};
 update public.surveys set title=repeat('x',8388608-empty_size) where id=${q(sid)};
 select octet_length(to_jsonb(s)::text)+4 into strict inner_size from public.surveys s where id=${q(sid)};
 assert inner_size=8388608,'Wire SQL inner size differs';
 execute 'set local role service_role';payload:=public.get_survey_for_owner_v1(${q(owner)},${q(sid)});execute 'reset role';
 assert payload->'questions'='[]'::jsonb and payload->'responses'='[]'::jsonb and payload->'survey'->>'position'='0';
 assert payload::text !~ '[^ -~]' and position(chr(92) in payload::text)=0,'Wire lower-bound scalar encoding differs';
 -- No escapes, non-ASCII bytes, or reducible nonzero numeric scalar occurs.
 -- Removing ALL whitespace can only lower a valid JSON serialization's size.
 minimum_size:=octet_length(translate(payload::text,chr(32)||chr(9)||chr(13)||chr(10),''));
 assert minimum_size>8388608 and octet_length(payload::text)<=8388608+4096,'Wire wrapper bounds differ';
 update ${table} set inner_bytes=inner_size,minimum_wire_bytes=minimum_size,sql_wire_bytes=octet_length(payload::text) where singleton;
 end;$prepare$;commit;
 select jsonb_build_object('stage','wire-prepared','descriptorSha256',descriptor_sha256,'innerBytes',inner_bytes,'minimumWireBytes',minimum_wire_bytes,'sqlWireBytes',sql_wire_bytes,'nativeVerified',false) as result from ${table};`
  const restore=`${begin}${state}
 create temporary table survey_wire_receipt(result jsonb not null) on commit preserve rows;
 do $restore$ declare captured jsonb;actual jsonb;normalized jsonb;record_row jsonb;rows jsonb;key text;seen integer;prepared timestamptz;begin
 if to_regclass(${q(table)}) is null then
 insert into survey_wire_receipt values(jsonb_build_object('stage','absent-unverified','descriptorSha256',${q(descriptorSha256)},'nativeVerified',false));return;end if;
 ${check} select state,prepared_at into strict captured,prepared from ${table};
 update public.surveys set title=(select r->>'title' from jsonb_array_elements(captured->'rows'->'public.surveys') r where r->>'id'=${q(sid)}) where id=${q(sid)};
 actual:=pg_temp.survey_cancel_state();normalized:=actual;
 foreach key in array array['public.surveys','public.classrooms','public.classroom_archive_revisions'] loop rows:='[]'::jsonb;seen:=0;
 for record_row in select value from jsonb_array_elements(actual->'rows'->key) loop
 if key='public.surveys' and record_row->>'id'=${q(sid)} then
 assert (record_row->>'updated_at')::timestamptz between prepared and clock_timestamp();
 record_row:=jsonb_set(record_row,'{updated_at}',(select r->'updated_at' from jsonb_array_elements(captured->'rows'->key) r where r->>'id'=${q(sid)}));seen:=seen+1;
 elsif key='public.classrooms' and record_row->>'id'=${q(cid)} then
 assert (record_row->>'blueprint_source_revision')::bigint=(select (r->>'blueprint_source_revision')::bigint+2 from jsonb_array_elements(captured->'rows'->key) r where r->>'id'=${q(cid)});
 assert (record_row->>'updated_at')::timestamptz between prepared and clock_timestamp();
 record_row:=record_row||(select jsonb_build_object('blueprint_source_revision',r->'blueprint_source_revision','updated_at',r->'updated_at') from jsonb_array_elements(captured->'rows'->key) r where r->>'id'=${q(cid)});seen:=seen+1;
 elsif key='public.classroom_archive_revisions' and record_row->>'classroom_id'=${q(cid)} then
 assert (record_row->>'revision')::bigint=(select (r->>'revision')::bigint+4 from jsonb_array_elements(captured->'rows'->key) r where r->>'classroom_id'=${q(cid)});
 assert (record_row->>'updated_at')::timestamptz between prepared and clock_timestamp();
 record_row:=record_row||(select jsonb_build_object('revision',r->'revision','updated_at',r->'updated_at') from jsonb_array_elements(captured->'rows'->key) r where r->>'classroom_id'=${q(cid)});seen:=seen+1;
 end if;rows:=rows||jsonb_build_array(record_row);end loop;
 assert seen=1,'Wire restored target cardinality differs';
 select jsonb_agg(r order by r::text) into rows from jsonb_array_elements(rows) r;normalized:=jsonb_set(normalized,array['rows',key],rows);end loop;
 assert normalized=captured,'Wire full rows/catalog restoration differs';drop table ${table};
 assert pg_temp.survey_cancel_state()=actual,'Wire final rows/catalog after DROP differ';
 insert into survey_wire_receipt values(jsonb_build_object('stage','wire-restored','descriptorSha256',${q(descriptorSha256)},'archiveRevisionDelta',4,'blueprintRevisionDelta',2,'stateSha256',encode(sha256(convert_to(captured::text,'UTF8')),'hex'),'nativeVerified',false));
 end;$restore$;commit;select result from survey_wire_receipt;`
  const d=freeze({kind:'survey-wire-source-only' as const,descriptorSha256,baselineTable:table,request,frames:{prepare,restore},
    caps:{sqlBytes:262144,responseBytes:8388608,crossingBytes:65536,requestBytes:4096},nativeVerified:false as const,executionEnabled:false as const})
  Object.values(d.frames).forEach(sql=>assert(Buffer.byteLength(sql)<=d.caps.sqlBytes));issued.add(d);return d
}
export type SurveyWireProofDescriptor=ReturnType<typeof surveyWireProofDescriptor>
export function validateSurveyWireSql(d:SurveyWireProofDescriptor,frame:keyof SurveyWireProofDescriptor['frames'],sql:string){return issued.has(d)&&Object.hasOwn(d.frames,frame)&&d.frames[frame]===sql}
/** Shape only: native provenance remains the lexical session carrier. */
export function inspectSurveyWireReceipt(d:SurveyWireProofDescriptor,stage:'wire-prepared'|'wire-restored',raw:unknown){
  assert(issued.has(d)&&raw&&Object.getPrototypeOf(raw)===Object.prototype)
  assert(Object.values(Object.getOwnPropertyDescriptors(raw)).every(x=>'value' in x))
  const r=raw as Record<string,unknown>;assert(Buffer.byteLength(JSON.stringify(r))<=4096)
  const fields=stage==='wire-prepared'?['innerBytes','minimumWireBytes','sqlWireBytes']:['archiveRevisionDelta','blueprintRevisionDelta','stateSha256']
  assert.deepEqual(Object.keys(r).sort(),['stage','descriptorSha256','nativeVerified',...fields].sort())
  assert(r.stage===stage&&r.descriptorSha256===d.descriptorSha256&&r.nativeVerified===false)
  if(stage==='wire-prepared'){
    assert(r.innerBytes===8388608&&Number.isSafeInteger(r.minimumWireBytes)&&Number(r.minimumWireBytes)>8388608)
    assert(Number.isSafeInteger(r.sqlWireBytes)&&Number(r.sqlWireBytes)>=Number(r.minimumWireBytes)&&Number(r.sqlWireBytes)<=8388608+4096)
  }else{assert(r.archiveRevisionDelta===4&&r.blueprintRevisionDelta===2);assert(typeof r.stateSha256==='string'&&/^[a-f0-9]{64}$/.test(r.stateSha256))}
  return freeze({sourceShapeMatches:true as const,nativeVerified:false as const})
}

/** Scope-only oracle. The native engine must supply actual private seed/final
 * carriers and retain the existing authenticated two removed-cohort PT403s. */
export function verifySurveyPrimaryMembership(f:SurveyNativeFixture,m:SurveyCommittedProofManifest,rawSeed:unknown,rawFinal:unknown){
  surveyCancellationProofDescriptor(f);assert.equal(m.originalFixtureSha256,hash(JSON.stringify(f)))
  const graph=(v:unknown)=>{assert(v&&typeof v==='object'&&!Array.isArray(v));return v as Record<string,unknown>}
  const seed=graph(rawSeed),final=graph(rawFinal)
  const rows=(g:Record<string,unknown>,key:string)=>{const v=g[key];assert(Array.isArray(v)&&v.every(r=>r&&typeof r==='object'&&!Array.isArray(r)));return v as Record<string,unknown>[]}
  const scope=(classroom:string,actor:string)=>hash(`pika-membership-scope-v1:${classroom}:${actor}`)
  const primary=f.enrollments[1]
  const pick=(g:Record<string,unknown>,table:string,predicate:(r:Record<string,unknown>)=>boolean)=>rows(g,table).filter(predicate)
  const enrollment=(r:Record<string,unknown>)=>r.classroom_id===primary.classroomId&&r.student_id===primary.actorId
  const generation=(r:Record<string,unknown>)=>r.scope_digest===scope(primary.classroomId,primary.actorId)
  const before=pick(seed,'public.classroom_enrollments',enrollment),generations=pick(seed,'private.pal_membership_generations',generation)
  assert(before.length===1&&before[0].id===primary.id&&generations.length===1&&generations[0].generation_id===primary.id&&generations[0].state==='active')
  assert(isDeepStrictEqual(pick(final,'public.classroom_enrollments',enrollment),before)&&isDeepStrictEqual(pick(final,'private.pal_membership_generations',generation),generations),'Primary membership changed')
  const removed=m.schedules.filter(s=>s.effects.membershipRemoved);assert(removed.length===2)
  for(const s of removed){const c=s.cohort;assert(!rows(final,'public.classroom_enrollments').some(r=>r.classroom_id===c.classroomId&&r.student_id===f.actors[1].id))
    const prior=rows(seed,'private.pal_membership_generations').filter(r=>r.generation_id===c.enrollmentId);assert(prior.length===1&&prior[0].state==='active')
    assert(isDeepStrictEqual(rows(final,'private.pal_membership_generations').filter(r=>r.scope_digest===c.scopeDigest),[{...prior[0],state:'removed'}]),'Committed removed generation changed')}
  const removedIds=new Set(removed.map(s=>s.cohort.enrollmentId))
  const sorted=(values:Record<string,unknown>[],key:string)=>[...values].sort((a,b)=>String(a[key]).localeCompare(String(b[key])))
  assert(isDeepStrictEqual(sorted(rows(final,'public.classroom_enrollments'),'id'),sorted(rows(seed,'public.classroom_enrollments').filter(r=>!removedIds.has(String(r.id))),'id')),'Other enrollment changed')
  assert(isDeepStrictEqual(sorted(rows(final,'private.pal_membership_generations'),'generation_id'),sorted(rows(seed,'private.pal_membership_generations').map(r=>removedIds.has(String(r.generation_id))?{...r,state:'removed'}:r),'generation_id')),'Other generation changed')
  return freeze({primaryUnchanged:true as const,removedCohorts:2,nativeVerified:false as const})
}
