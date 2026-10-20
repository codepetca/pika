/** Inert 280 contention plans; the existing carrier alone owns execution and positive process joins. */
import assert from 'node:assert/strict'
import {z} from 'zod'
import {assertClassroomGuidanceAdoptionFixture,classroomGuidanceAdoptionFreeze as freeze,classroomGuidanceAdoptionHash as hash,
 classroomGuidanceAdoptionGraphSql,classroomGuidanceAdoptionCanonical,classroomGuidanceAdoptionSnapshotHash,
 type ClassroomGuidanceAdoptionFixture as Fixture} from './contextual-classroom-guidance-adoption-native-fixture'
export const CLASSROOM_GUIDANCE_ADOPTION_LOCK_LABELS=['classroom-operation-advisory','blueprint-purge-advisory','classroom-row-nowait']as const
export type ClassroomGuidanceAdoptionLockLabel=typeof CLASSROOM_GUIDANCE_ADOPTION_LOCK_LABELS[number]
export const CLASSROOM_GUIDANCE_ADOPTION_LOCK_CAPS=freeze({pairs:3,sessions:2,requests:0,sqlBytes:262144,replyBytes:4096,observationMs:750,polls:150,cadenceMs:5,sqlMs:8000,lockMs:1000,automaticRetries:0})
const q=(v:string)=>`'${v.replaceAll("'","''")}'`,json=(v:unknown)=>`${q(JSON.stringify(v))}::jsonb`
const digest=(v:string)=>`encode(sha256(convert_to(${v}::text,'UTF8')),'hex')`
const begin="begin;set local timezone='UTC';set local statement_timeout='8s';set local lock_timeout='1s';"
const self="(select jsonb_build_object('pid',pid,'started',backend_start::text,'xact',xact_start::text) from pg_stat_activity where pid=pg_backend_pid())"
const lockWhere=(pid:string,k:string)=>`pid=${pid} and locktype='advisory' and granted and mode='ExclusiveLock' and objsubid=1 and classid::bigint=((${k}>>32)&4294967295) and objid::bigint=(${k}&4294967295)`
function names(f:Fixture,index:number){const p=`guidance_adopt_lock_${index}_${f.tag.slice(-12)}`;return{A:`${p}_A`,B:`${p}_B`,ready:`${p}_A_ready`,seen:`${p}_B_seen`}}
function pin(f:Fixture,index:number,role:'A'|'B'){const tag=`gal_${index}_${role}_${f.tag.slice(-12)}`,prefix=`do $${tag}$`;return{tag,prefix,sha256:hash(prefix)}}
function pollPeer(app:string,p:ReturnType<typeof pin>){return`v_until:=clock_timestamp()+interval '750 milliseconds';v_attempts:=0;
 loop perform pg_stat_clear_snapshot();
 if (select count(*) from pg_stat_activity where application_name=${q(app)})>1 then raise exception 'Guidance adoption lock ambiguous peer';end if;
 select pid,backend_start::text started,xact_start::text xact into v_peer from pg_stat_activity where application_name=${q(app)}
 and datname=current_database() and usename='postgres' and backend_type='client backend' and client_addr is null and pid<>pg_backend_pid()
 and state='active' and backend_start is not null and xact_start is not null and query_start>=backend_start
 and left(ltrim(query,E' \\n\\r\\t'),${p.prefix.length})=${q(p.prefix)}
 and encode(sha256(convert_to(left(ltrim(query,E' \\n\\r\\t'),${p.prefix.length}),'UTF8')),'hex')=${q(p.sha256)};
 exit when found;v_attempts:=v_attempts+1;if v_attempts>=150 or clock_timestamp()>=v_until then raise exception 'Guidance adoption lock peer absent';end if;perform pg_sleep(0.005);end loop;`}
function stateSql(f:Fixture){return`create function pg_temp.guidance_adoption_lock_state() returns jsonb language sql set search_path='' as $state$
 select jsonb_build_object('fixture',${classroomGuidanceAdoptionGraphSql(f,true)},'complementSha256',${digest(`(${classroomGuidanceAdoptionGraphSql(f,false)})`)});$state$;`}
function profile(app:string){return`if current_user<>'postgres' or current_setting('application_name') is distinct from ${q(app)}
 or exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and application_name=${q(app)}) then raise exception 'Guidance adoption lock session profile differs';end if;`}
function baseline(f:Fixture){const c=f.classes[2],d=f.blueprints[2];return`select * into strict b from ${f.baseline};
 if b.observed<>5 or b.source_flow is not null or b.recovery_kind is not null or b.recovery_before is not null
 or v_before->'fixture' is distinct from b.checkpoint or v_before->>'complementSha256' is distinct from b.original_sha256
 or jsonb_array_length(v_before#>'{fixture,course_blueprint_versions}')<>6
 or not exists(select 1 from public.classrooms where id=${q(c.id)}::uuid and teacher_id=${q(c.owner)}::uuid and archived_at is null
 and source_blueprint_id=${q(d.id)}::uuid and source_blueprint_version_id=${q(d.structuralVersionId)}::uuid and authoring_guidance_version_id=${q(f.dedupVersionId)}::uuid)
 or not exists(select 1 from public.course_blueprints where id=${q(d.id)}::uuid and teacher_id=${q(d.owner)}::uuid and content_revision=${d.revision} and latest_version_number=2)
 or not exists(select 1 from public.course_blueprint_versions where id=${q(f.dedupVersionId)}::uuid and course_blueprint_id=${q(d.id)}::uuid and version_number=2
 and snapshot_sha256=${q(classroomGuidanceAdoptionSnapshotHash(f,2))} and snapshot_json=${q(classroomGuidanceAdoptionCanonical(f,2))}::jsonb)
 then raise exception 'Guidance adoption lock postSDK checkpoint differs';end if;
 v_source_sha:=private.classroom_guidance_adoption_source_v1(${q(d.id)}::uuid)->>'source_sha256';
 if v_source_sha is distinct from b.source_sha256 then raise exception 'Guidance adoption lock source digest differs';end if;`}
const declarations=`declare b record;v_peer record;v_self jsonb;v_until timestamptz;v_attempts integer;v_before jsonb;v_after jsonb;
 v_result jsonb;v_expected jsonb;v_message text;v_probe boolean:=false;v_source_sha text;v_fresh_succeeded boolean:=false;
 v_fresh_rolled_back boolean:=false;v_fresh_hash text;v_fresh_self jsonb;begin `
function effect(f:Fixture){const c=f.classes[2];return`v_expected:=jsonb_set(v_before,'{fixture,classrooms}',(select jsonb_agg(r order by r::text) from
 (select case when value->>'id'=${q(c.id)} then value||jsonb_build_object('updated_at',transaction_timestamp()) else value end r from jsonb_array_elements(v_before#>'{fixture,classrooms}')) x));
 v_expected:=jsonb_set(v_expected,'{fixture,classroom_archive_revisions}',(select jsonb_agg(r order by r::text) from
 (select case when value->>'classroom_id'=${q(c.id)} then value||jsonb_build_object('revision',(value->>'revision')::bigint+1,'updated_at',transaction_timestamp()) else value end r from jsonb_array_elements(v_before#>'{fixture,classroom_archive_revisions}')) x));
 if v_after is distinct from v_expected then raise exception 'Guidance adoption lock fresh complete graph effect differs';end if;`}
function pairSql(f:Fixture,label:ClassroomGuidanceAdoptionLockLabel){
 const index=CLASSROOM_GUIDANCE_ADOPTION_LOCK_LABELS.indexOf(label),app=names(f,index),pins={A:pin(f,index,'A'),B:pin(f,index,'B')},c=f.classes[2],d=f.blueprints[2]
 const classKey=`hashtextextended(${q(`pika-classroom-operation:${c.id}`)},0)`,bpKey=`hashtextextended(jsonb_build_array('course_blueprint_purge',${q(d.id)}::uuid)::text,0)`,k=index===1?bpKey:classKey
 const bindingSha256=hash(JSON.stringify({tag:f.tag,label,classroom:c,blueprint:d,guidance:f.dedupVersionId,snapshotSha256:classroomGuidanceAdoptionSnapshotHash(f,2),caps:CLASSROOM_GUIDANCE_ADOPTION_LOCK_CAPS}))
 const state='pg_temp.guidance_adoption_lock_state()',peer="jsonb_build_object('pid',v_peer.pid,'started',v_peer.started,'xact',v_peer.xact)"
 const header=`${begin}create temp table guidance_adoption_lock_result(result jsonb not null) on commit preserve rows;${stateSql(f)}`
 const base=(role:'A'|'B')=>`jsonb_build_object('version',1,'scope','classroom-guidance-adoption-lock-pair-v1','label',${q(label)},'bindingSha256',${q(bindingSha256)},
 'role',${q(role)},'self',v_self,'peer',${peer},'beforeSha256',${digest('v_before')},'afterBusySha256',${digest('v_after')},'terminalSha256',${digest('v_before')},
 'holderWitnessed',${role==='B'},'conflict',${q(role==='A'?'acknowledged':'PT409')},'busy',${role==='B'},'partialLocksReleased',${role==='B'},
 'freshSucceeded',false,'freshRolledBack',false,'freshSha256',null,'freshSelf',null,'sentinel',null,'requests',0,'sessions',2,'executionEnabled',false,'nativeVerified',false)`
 const acquire=index===0?`if not public.classroom_purge_try_lock(${q(c.id)}::uuid) then raise exception 'Guidance adoption lock holder unavailable';end if;`
 :index===1?`perform public.guard_course_blueprint_purge_lifecycle(${q(d.id)}::uuid);`
 :`perform 1 from public.classrooms where id=${q(c.id)}::uuid for update nowait;if not found then raise exception 'Guidance adoption lock class absent';end if;`
 const owned=index===2?'':`if not exists(select 1 from pg_locks where ${lockWhere('pg_backend_pid()',k)}) then raise exception 'Guidance adoption lock owned key absent';end if;`
 // The last-row conflict must also release the Blueprint row acquired before
 // that conflict. The holder probes it only after B acknowledges the catch;
 // its own diagnostic row lock is rolled back before either session proceeds.
 const releasedParent=index===2?`begin perform 1 from public.course_blueprints where id=${q(d.id)}::uuid for update nowait;
 if not found then raise exception 'Guidance adoption lock parent absent';end if;
 raise exception using errcode='PZ282',message='classroom_guidance_adoption_parent_probe';
 exception when sqlstate 'PZ282' then get stacked diagnostics v_message=message_text;
 if v_message is distinct from 'classroom_guidance_adoption_parent_probe' then raise;end if;end;`:''
 const a=`${header}${pins.A.prefix} ${declarations}${profile(app.A)}v_self:=${self};v_before:=${state};${baseline(f)}${acquire}${owned}
 perform set_config('application_name',${q(app.ready)},true);${pollPeer(app.seen,pins.B)}
 ${releasedParent}
 v_after:=${state};if v_after is distinct from v_before then raise exception 'Guidance adoption lock holder graph differs';end if;
 insert into guidance_adoption_lock_result values(${base('A')});end;$${pins.A.tag}$;commit;select result from guidance_adoption_lock_result;`
 const probe=index===2?`begin perform 1 from public.classrooms where id=${q(c.id)}::uuid for update nowait;
 raise exception 'Guidance adoption lock exact row unexpectedly available';exception when sqlstate '55P03' then v_probe:=true;end;
 if v_probe is distinct from true then raise exception 'Guidance adoption lock exact row conflict absent';end if;`
 :`if not exists(select 1 from pg_locks where ${lockWhere('v_peer.pid',k)}) then raise exception 'Guidance adoption lock advisory holder absent';end if;`
 const rpc=`public.save_and_adopt_classroom_guidance_for_owner_v1(${q(c.owner)}::uuid,${q(c.id)}::uuid,${q(d.id)}::uuid,${q(d.structuralVersionId)}::uuid,${q(f.dedupVersionId)}::uuid,${d.revision},v_source_sha,${q(classroomGuidanceAdoptionCanonical(f,2))},${q(classroomGuidanceAdoptionSnapshotHash(f,2))})`
 const busy=`begin set local role service_role;if current_user<>'service_role' then raise exception 'Guidance adoption lock wrong RPC role';end if;
 perform ${rpc};raise exception 'Guidance adoption lock RPC unexpectedly succeeded';exception when sqlstate 'PT409' then get stacked diagnostics v_message=message_text;
 if v_message is distinct from 'class_guidance_adoption_busy' then raise exception 'Guidance adoption lock wrong conflict';end if;end;
 reset role;if current_user<>'postgres' then raise exception 'Guidance adoption lock observer role differs';end if;
 if exists(select 1 from pg_locks where (${lockWhere('pg_backend_pid()',classKey)}) or (${lockWhere('pg_backend_pid()',bpKey)})) then raise exception 'Guidance adoption lock partial advisory locks retained';end if;`
 // Exact-row availability probes always roll back, before the actual writer.
 const rowAvailable=`v_probe:=false;begin perform 1 from public.classrooms where id=${q(c.id)}::uuid for update nowait;
 if not found then raise exception 'Guidance adoption lock released row absent';end if;
 raise exception using errcode='PZ281',message='classroom_guidance_adoption_row_probe';
 exception when sqlstate 'PZ281' then get stacked diagnostics v_message=message_text;if v_message is distinct from 'classroom_guidance_adoption_row_probe' then raise;end if;v_probe:=true;
 when sqlstate '55P03' then v_probe:=false;end;`
 const released=index===2?`${rowAvailable}exit when v_probe;`:`exit when not exists(select 1 from pg_locks where ${lockWhere('v_peer.pid',k)});`
 const releasePoll=`v_until:=clock_timestamp()+interval '750 milliseconds';v_attempts:=0;loop perform pg_stat_clear_snapshot();${released}
 v_attempts:=v_attempts+1;if v_attempts>=150 or clock_timestamp()>=v_until then raise exception 'Guidance adoption lock release absent';end if;perform pg_sleep(0.005);end loop;`
 const freshReleased=index===2?`${rowAvailable}if not v_probe then raise exception 'Guidance adoption lock fresh row still busy';end if;`
 :`if exists(select 1 from pg_locks where ${lockWhere("(select (result#>>'{peer,pid}')::integer from guidance_adoption_lock_result)",k)}) then raise exception 'Guidance adoption lock fresh advisory still held';end if;`
 const dto={actor_id:c.owner,classroom_id:c.id,blueprint_id:d.id,content_version_id:d.structuralVersionId,previous_guidance_version_id:f.dedupVersionId,
 guidance_version:{id:f.dedupVersionId,course_blueprint_id:d.id,version_number:2,source_draft_revision:d.revision,snapshot_sha256:classroomGuidanceAdoptionSnapshotHash(f,2)}}
 const fresh=`${begin}do $gal_fresh_${index}_${f.tag.slice(-12)}$ ${declarations}${profile(app.B)}v_before:=${state};${baseline(f)}v_fresh_self:=${self};
 if (v_fresh_self->>'pid')::integer is distinct from (select (result#>>'{self,pid}')::integer from guidance_adoption_lock_result)
 or v_fresh_self->>'started' is distinct from (select result#>>'{self,started}' from guidance_adoption_lock_result)
 or (v_fresh_self->>'xact')::timestamptz<=(select (result#>>'{self,xact}')::timestamptz from guidance_adoption_lock_result) then raise exception 'Guidance adoption lock fresh transaction identity differs';end if;${freshReleased}
 begin set local role service_role;if current_user<>'service_role' then raise exception 'Guidance adoption lock wrong fresh RPC role';end if;
 v_result:=${rpc};reset role;v_expected:=${json(dto)}||jsonb_build_object('source_sha256',v_source_sha);
 if v_result is distinct from v_expected then raise exception 'Guidance adoption lock fresh DTO differs';end if;
 v_after:=${state};${effect(f)}v_fresh_hash:=${digest('v_after')};v_fresh_succeeded:=true;
 raise exception using errcode='PZ280',message='classroom_guidance_adoption_fresh_rollback';
 exception when sqlstate 'PZ280' then get stacked diagnostics v_message=message_text;
 if v_message is distinct from 'classroom_guidance_adoption_fresh_rollback' or not v_fresh_succeeded or v_fresh_hash is null then raise;end if;v_fresh_rolled_back:=true;end;
 reset role;if current_user<>'postgres' or not v_fresh_succeeded or not v_fresh_rolled_back then raise exception 'Guidance adoption lock fresh rollback absent';end if;
 v_after:=${state};if v_after is distinct from v_before then raise exception 'Guidance adoption lock fresh rollback graph differs';end if;
 update guidance_adoption_lock_result set result=result||jsonb_build_object('terminalSha256',${digest('v_after')},'freshSucceeded',v_fresh_succeeded,'freshRolledBack',v_fresh_rolled_back,'freshSha256',v_fresh_hash,'freshSelf',v_fresh_self,'sentinel','classroom_guidance_adoption_fresh_rollback');
 end;$gal_fresh_${index}_${f.tag.slice(-12)}$;commit;select result from guidance_adoption_lock_result;`
 const b=`${header}${pins.B.prefix} ${declarations}${profile(app.B)}v_self:=${self};${pollPeer(app.ready,pins.A)}v_before:=${state};${baseline(f)}${probe}${busy}v_after:=${state};
 if v_after is distinct from v_before then raise exception 'Guidance adoption lock busy graph differs';end if;
 insert into guidance_adoption_lock_result values(${base('B')});perform set_config('application_name',${q(app.seen)},true);${releasePoll}end;$${pins.B.tag}$;commit;${fresh}`
 for(const sql of[a,b])assert(Buffer.byteLength(sql)<=CLASSROOM_GUIDANCE_ADOPTION_LOCK_CAPS.sqlBytes)
 return{label,a,b,sha256:hash(JSON.stringify({a,b})),bindingSha256,applications:app,profile:'baseline-off' as const,sessions:2 as const,requests:0 as const,executionEnabled:false as const,nativeVerified:false as const}
}
export function classroomGuidanceAdoptionConcurrencyDescriptors(f:Fixture){
 assertClassroomGuidanceAdoptionFixture(f)
 const bindingSha256=hash(JSON.stringify({tag:f.tag,scope:'classroom-guidance-adoption-lock-postflight-v1',caps:CLASSROOM_GUIDANCE_ADOPTION_LOCK_CAPS}))
 const sql=`begin read only;set local timezone='UTC';set local statement_timeout='8s';set local lock_timeout='1s';
 with measured as(select jsonb_build_object('fixture',${classroomGuidanceAdoptionGraphSql(f,true)},'complementSha256',${digest(`(${classroomGuidanceAdoptionGraphSql(f,false)})`)}) s),
 checked as(select s,b.* from measured cross join ${f.baseline} b)
 select jsonb_build_object('version',1,'scope','classroom-guidance-adoption-lock-postflight-v1','bindingSha256',${q(bindingSha256)},'terminalSha256',${digest('s')},
 'sourcePreserved',s->>'complementSha256'=original_sha256,'originalsPreserved',s->'fixture'=checkpoint,
 'postSdkCheckpoint',observed=5 and source_flow is null and recovery_kind is null and recovery_before is null and jsonb_array_length(s#>'{fixture,course_blueprint_versions}')=6
 and private.classroom_guidance_adoption_source_v1(${q(f.blueprints[2].id)}::uuid)->>'source_sha256'=source_sha256,
 'requests',0,'sessions',0,'executionEnabled',false,'nativeVerified',false) from checked;commit;`
 assert(Buffer.byteLength(sql)<=CLASSROOM_GUIDANCE_ADOPTION_LOCK_CAPS.sqlBytes)
 return freeze({version:1 as const,scope:'classroom-guidance-adoption-lock-v1' as const,pairs:CLASSROOM_GUIDANCE_ADOPTION_LOCK_LABELS.map(label=>pairSql(f,label)),
 postflight:{name:'postflight' as const,sql,sha256:hash(sql),bindingSha256,profile:'baseline-off' as const,nativeVerified:false as const},caps:CLASSROOM_GUIDANCE_ADOPTION_LOCK_CAPS,
 profile:'baseline-off' as const,sessions:2 as const,requests:0 as const,executionEnabled:false as const,nativeVerified:false as const})
}
export function assertClassroomGuidanceAdoptionConcurrencyDescriptors(f:Fixture,input:unknown):true{assert.deepEqual(input,classroomGuidanceAdoptionConcurrencyDescriptors(f));return true}
const timestamp=z.string().max(80).regex(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::\d\d)?)$/).refine(v=>Number.isFinite(Date.parse(v)))
const micros=(v:string)=>BigInt(Date.parse(v))*BigInt(1000)+BigInt((v.match(/\.(\d{1,6})/)?.[1]??'').padEnd(6,'0').slice(3))
const backend=z.object({pid:z.number().int().min(2).max(2147483647),started:timestamp,xact:timestamp}).strict().refine(v=>micros(v.xact)>=micros(v.started))
const sha=z.string().regex(/^[a-f0-9]{64}$/)
const receipt=z.object({version:z.literal(1),scope:z.literal('classroom-guidance-adoption-lock-pair-v1'),label:z.enum(CLASSROOM_GUIDANCE_ADOPTION_LOCK_LABELS),bindingSha256:sha,
 role:z.enum(['A','B']),self:backend,peer:backend,beforeSha256:sha,afterBusySha256:sha,terminalSha256:sha,holderWitnessed:z.boolean(),conflict:z.enum(['acknowledged','PT409']),
 busy:z.boolean(),partialLocksReleased:z.boolean(),freshSucceeded:z.boolean(),freshRolledBack:z.boolean(),freshSha256:sha.nullable(),freshSelf:backend.nullable(),
 sentinel:z.literal('classroom_guidance_adoption_fresh_rollback').nullable(),requests:z.literal(0),sessions:z.literal(2),executionEnabled:z.literal(false),nativeVerified:z.literal(false)}).strict()
function plain(value:unknown,seen=new Set<object>()):void{
 if(value===null||typeof value!=='object')return;assert(!seen.has(value));seen.add(value);assert(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)
 for(const key of Reflect.ownKeys(value)){assert(typeof key==='string');const d=Object.getOwnPropertyDescriptor(value,key)!;assert(d.enumerable&&'value'in d);plain(d.value,seen)}seen.delete(value)
}
function jsonReceipt(output:string):unknown{
 assert(typeof output==='string'&&Buffer.byteLength(output)<=4096&&!/[\r\n]/.test(output.trim()));const value:unknown=JSON.parse(output);plain(value);const expected:string[]=[]
 const keys=(v:unknown):void=>{if(v&&typeof v==='object')for(const[k,child]of Object.entries(v)){expected.push(k);keys(child)}};keys(value)
 const raw=[...output.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(m=>JSON.parse(m[1]) as string);assert.deepEqual(raw.sort(),expected.sort());return value
}
export function parseClassroomGuidanceAdoptionConcurrencyReceipt(output:string){try{return freeze(receipt.parse(jsonReceipt(output)))}catch{throw new Error('Guidance adoption lock receipt rejected')}}
const summarySchema=z.object({label:z.enum(CLASSROOM_GUIDANCE_ADOPTION_LOCK_LABELS),bindingSha256:sha,beforeSha256:sha,terminalSha256:sha,holderWitnessed:z.literal(true),busy:z.literal(true),partialLocksReleased:z.literal(true),freshAuthorization:z.literal(true),freshRolledBack:z.literal(true),exactGraphEffect:z.literal(true),requests:z.literal(0),sessions:z.literal(2),executionEnabled:z.literal(false),nativeVerified:z.literal(false)}).strict()
export function validateClassroomGuidanceAdoptionConcurrencyPair(f:Fixture,label:ClassroomGuidanceAdoptionLockLabel,aRaw:unknown,bRaw:unknown){try{
 plain(aRaw);plain(bRaw);const a=receipt.parse(aRaw),b=receipt.parse(bRaw),pair=classroomGuidanceAdoptionConcurrencyDescriptors(f).pairs.find(p=>p.label===label);assert(pair)
 assert(a.label===label&&b.label===label&&a.role==='A'&&b.role==='B'&&a.self.pid!==b.self.pid);assert.deepEqual(a.peer,b.self);assert.deepEqual(b.peer,a.self)
 for(const r of[a,b])assert(r.bindingSha256===pair.bindingSha256&&r.beforeSha256===r.afterBusySha256&&r.beforeSha256===r.terminalSha256);assert.equal(a.beforeSha256,b.beforeSha256)
 assert(!a.holderWitnessed&&a.conflict==='acknowledged'&&!a.busy&&!a.partialLocksReleased&&!a.freshSucceeded&&!a.freshRolledBack&&a.freshSha256===null&&a.freshSelf===null&&a.sentinel===null)
 assert(b.holderWitnessed&&b.conflict==='PT409'&&b.busy&&b.partialLocksReleased&&b.freshSucceeded&&b.freshRolledBack&&b.freshSha256!==null&&b.freshSha256!==b.beforeSha256)
 assert(b.sentinel==='classroom_guidance_adoption_fresh_rollback'&&b.freshSelf&&b.freshSelf.pid===b.self.pid&&b.freshSelf.started===b.self.started&&micros(b.freshSelf.xact)>micros(b.self.xact))
 return freeze(summarySchema.parse({label,bindingSha256:pair.bindingSha256,beforeSha256:b.beforeSha256,terminalSha256:b.terminalSha256,holderWitnessed:true,busy:true,partialLocksReleased:true,freshAuthorization:true,freshRolledBack:true,exactGraphEffect:true,requests:0,sessions:2,executionEnabled:false,nativeVerified:false}))
 }catch{throw new Error('Guidance adoption lock pair rejected')}}
const postflight=z.object({version:z.literal(1),scope:z.literal('classroom-guidance-adoption-lock-postflight-v1'),bindingSha256:sha,terminalSha256:sha,sourcePreserved:z.literal(true),originalsPreserved:z.literal(true),postSdkCheckpoint:z.literal(true),requests:z.literal(0),sessions:z.literal(0),executionEnabled:z.literal(false),nativeVerified:z.literal(false)}).strict()
export function parseClassroomGuidanceAdoptionPostflightReceipt(output:string){try{return freeze(postflight.parse(jsonReceipt(output)))}catch{throw new Error('Guidance adoption lock postflight receipt rejected')}}
export function validateClassroomGuidanceAdoptionPostflight(f:Fixture,lastRaw:unknown,input:unknown){try{
 plain(lastRaw);plain(input);const last=summarySchema.parse(lastRaw),r=postflight.parse(input),plan=classroomGuidanceAdoptionConcurrencyDescriptors(f)
 assert(last.label===CLASSROOM_GUIDANCE_ADOPTION_LOCK_LABELS[2]&&last.bindingSha256===plan.pairs[2].bindingSha256&&last.beforeSha256===last.terminalSha256)
 assert(r.bindingSha256===plan.postflight.bindingSha256&&r.terminalSha256===last.terminalSha256);return freeze(r)
 }catch{throw new Error('Guidance adoption lock postflight rejected')}}
