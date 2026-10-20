/** Inert 274 contention pairs. No executor, process, IO or native admission.
 * The existing carrier owns fixed SQL argv, guards, two slots and positive joins. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import { assertAttendancePolicyWriteFixture,attendancePolicyWriteFreeze as freeze,attendancePolicyWriteHash as hash,
  attendancePolicyWriteGraphSql,attendancePolicyWriteSdkInventory,type AttendancePolicyWriteFixture } from './contextual-attendance-policy-write-native-fixture'

export const ATTENDANCE_POLICY_WRITE_LOCK_LABELS=['classroom-operation-advisory','classroom-owner-nowait','entitlement-actor-advisory'] as const
export type AttendancePolicyWriteLockLabel=typeof ATTENDANCE_POLICY_WRITE_LOCK_LABELS[number]
export const ATTENDANCE_POLICY_WRITE_LOCK_CAPS=freeze({pairs:3,sessions:2,requests:0,sqlBytes:262144,replyBytes:4096,
  observationMs:750,polls:150,cadenceMs:5,sqlMs:8000,lockMs:1000,automaticRetries:0})
const q=(v:string)=>`'${v.replaceAll("'","''")}'`
const json=(v:unknown)=>`${q(JSON.stringify(v))}::jsonb`
const digest=(v:string)=>`encode(sha256(convert_to(${v}::text,'UTF8')),'hex')`
const begin="begin;set local timezone='UTC';set local statement_timeout='8s';set local lock_timeout='1s';"
const self="(select jsonb_build_object('pid',pid,'started',backend_start::text,'xact',xact_start::text) from pg_stat_activity where pid=pg_backend_pid())"
const lockWhere=(pid:string,k:string)=>`pid=${pid} and locktype='advisory' and granted and mode='ExclusiveLock' and objsubid=1
 and classid::bigint=((${k}>>32)&4294967295) and objid::bigint=(${k}&4294967295)`
function names(f:AttendancePolicyWriteFixture,index:number){const p=`attendance_write_lock_${index}_${f.tag.slice(-12)}`;return{A:`${p}_A`,B:`${p}_B`,ready:`${p}_A_ready`,seen:`${p}_B_seen`}}
function pin(f:AttendancePolicyWriteFixture,index:number,role:'A'|'B'){
  const tag=`awl_${index}_${role}_${f.tag.slice(-12)}`,prefix=`do $${tag}$`;return{tag,prefix,sha256:hash(prefix)}
}
function pollPeer(app:string,p:ReturnType<typeof pin>){
  return `v_until:=clock_timestamp()+interval '750 milliseconds';v_attempts:=0;
 loop perform pg_stat_clear_snapshot();
 if (select count(*) from pg_stat_activity where application_name=${q(app)})>1 then raise exception 'Attendance write lock ambiguous peer';end if;
 select pid,backend_start::text started,xact_start::text xact into v_peer from pg_stat_activity where application_name=${q(app)}
 and datname=current_database() and usename='postgres' and backend_type='client backend' and client_addr is null
 and pid<>pg_backend_pid() and state='active' and backend_start is not null and xact_start is not null and query_start>=backend_start
 and left(ltrim(query,E' \\n\\r\\t'),${p.prefix.length})=${q(p.prefix)}
 and encode(sha256(convert_to(left(ltrim(query,E' \\n\\r\\t'),${p.prefix.length}),'UTF8')),'hex')=${q(p.sha256)};
 exit when found;v_attempts:=v_attempts+1;
 if v_attempts>=150 or clock_timestamp()>=v_until then raise exception 'Attendance write lock peer absent';end if;perform pg_sleep(0.005);end loop;`
}
function stateSql(f:AttendancePolicyWriteFixture){
  return `create function pg_temp.attendance_write_lock_state() returns jsonb language sql set search_path='' as $state$
 select jsonb_build_object('fixture',${attendancePolicyWriteGraphSql(f,true)},'complementSha256',${digest(`(${attendancePolicyWriteGraphSql(f,false)})`)});$state$;`
}
function profile(f:AttendancePolicyWriteFixture,app:string){
  return `if current_user<>'postgres' or current_setting('application_name') is distinct from ${q(app)}
 or exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and application_name=${q(app)})
 then raise exception 'Attendance write lock session profile differs';end if;`
}
function baseline(f:AttendancePolicyWriteFixture){
  return `select * into strict b from ${f.baseline};
 if b.observed<>15 or v_before->'fixture' is distinct from b.graph or v_before->>'complementSha256' is distinct from b.original_sha256
 or v_before#>'{fixture,attendance_window_policies}' is distinct from '[]'::jsonb
 then raise exception 'Attendance write lock restored baseline differs';end if;`
}
const declarations=`declare b record;v_peer record;v_self jsonb;v_until timestamptz;v_attempts integer;v_before jsonb;v_after jsonb;
 v_result jsonb;v_row jsonb;v_expected jsonb;v_message text;v_probe boolean:=false;v_fresh_succeeded boolean:=false;
 v_fresh_rolled_back boolean:=false;v_fresh_hash text;v_fresh_self jsonb;begin `
function pairSql(f:AttendancePolicyWriteFixture,label:AttendancePolicyWriteLockLabel){
  const index=ATTENDANCE_POLICY_WRITE_LOCK_LABELS.indexOf(label),app=names(f,index),pins={A:pin(f,index,'A'),B:pin(f,index,'B')}
  const call=attendancePolicyWriteSdkInventory(f)[0],c=q(call.args.p_classroom_id),actor=q(call.args.p_actor_id)
  const classKey=`hashtextextended(${q(`pika-classroom-operation:${call.args.p_classroom_id}`)},0)`
  const actorKey=`hashtextextended(${actor},13220260823)`,k=index===2?actorKey:classKey
  const bindingSha256=hash(JSON.stringify({tag:f.tag,label,args:call.args,caps:ATTENDANCE_POLICY_WRITE_LOCK_CAPS}))
  const state='pg_temp.attendance_write_lock_state()',peer="jsonb_build_object('pid',v_peer.pid,'started',v_peer.started,'xact',v_peer.xact)"
  const header=`${begin}create temp table attendance_write_lock_result(result jsonb not null) on commit preserve rows;${stateSql(f)}`
  const base=(role:'A'|'B')=>`jsonb_build_object('version',1,'scope','attendance-policy-write-lock-pair-v1','label',${q(label)},'bindingSha256',${q(bindingSha256)},
 'role',${q(role)},'self',v_self,'peer',${peer},'beforeSha256',${digest('v_before')},'afterBusySha256',${digest('v_after')},'terminalSha256',${digest('v_before')},
 'holderWitnessed',${role==='B'},'conflict',${q(role==='A'?'acknowledged':'PT409')},'busy',${role==='B'},'partialLocksReleased',${role==='B'},
 'freshSucceeded',false,'freshRolledBack',false,'freshSha256',null,'freshSelf',null,'sentinel',null,'requests',0,'sessions',2,'executionEnabled',false,'nativeVerified',false)`
  const acquire=index===0?`if not public.classroom_purge_try_lock(${c}::uuid) then raise exception 'Attendance write lock holder unavailable';end if;`
    :index===1?`perform 1 from public.classrooms where id=${c}::uuid for update nowait;if not found then raise exception 'Attendance write lock class absent';end if;`
    :`perform pg_advisory_xact_lock(${actorKey});`
  const ownAdvisory=index===1?'':`if not exists(select 1 from pg_locks where ${lockWhere('pg_backend_pid()',k)}) then raise exception 'Attendance write lock owned key absent';end if;`
  const a=`${header}${pins.A.prefix} ${declarations}${profile(f,app.A)}v_self:=${self};v_before:=${state};${baseline(f)}${acquire}${ownAdvisory}
 perform set_config('application_name',${q(app.ready)},true);${pollPeer(app.seen,pins.B)}
 v_after:=${state};if v_after is distinct from v_before then raise exception 'Attendance write lock holder graph differs';end if;
 insert into attendance_write_lock_result values(${base('A')});end;$${pins.A.tag}$;commit;select result from attendance_write_lock_result;`
  const probe=index===1?`begin
 perform 1 from public.classrooms where id=${c}::uuid for update nowait;
 raise exception 'Attendance write lock exact row unexpectedly available';exception when sqlstate '55P03' then v_probe:=true;end;
 if v_probe is distinct from true then raise exception 'Attendance write lock exact row conflict absent';end if;`
    :`if not exists(select 1 from pg_locks where ${lockWhere('v_peer.pid',k)}) then raise exception 'Attendance write lock advisory holder absent';end if;`
  const rpc=`public.save_attendance_policy_for_owner_v1(${actor}::uuid,${c}::uuid,'teacher_entitlements',${json(call.args.p_policy)},null,null)`
  const busy=`begin set local role service_role;
 if current_user<>'service_role' then raise exception 'Attendance write lock wrong RPC role';end if;
 perform ${rpc};raise exception 'Attendance write lock RPC unexpectedly succeeded';
 exception when sqlstate 'PT409' then get stacked diagnostics v_message=message_text;
 if v_message is distinct from ${q(index===1?'attendance_policy_write_conflict':'attendance_policy_write_busy')} then raise exception 'Attendance write lock wrong conflict';end if;end;
 reset role;if current_user<>'postgres' then raise exception 'Attendance write lock observer role differs';end if;
 if exists(select 1 from pg_locks where (${lockWhere('pg_backend_pid()',classKey)}) or (${lockWhere('pg_backend_pid()',actorKey)}))
 then raise exception 'Attendance write lock partial advisory locks retained';end if;`
  // Row probes deliberately roll back their subtransaction so they do not
  // pre-acquire the row needed by the actual writer. No pgrowlocks attribution.
  const rowAvailable=`v_probe:=false;begin
 perform 1 from public.classrooms where id=${c}::uuid for update nowait;
 if not found then raise exception 'Attendance write lock released row absent';end if;
 raise exception using errcode='PZ275',message='attendance_policy_write_row_probe';
 exception when sqlstate 'PZ275' then get stacked diagnostics v_message=message_text;
 if v_message is distinct from 'attendance_policy_write_row_probe' then raise;end if;v_probe:=true;
 when sqlstate '55P03' then v_probe:=false;end;`
  const released=index===1?`${rowAvailable}exit when v_probe;`:`exit when not exists(select 1 from pg_locks where ${lockWhere('v_peer.pid',k)});`
  const releasePoll=`v_until:=clock_timestamp()+interval '750 milliseconds';v_attempts:=0;
 loop perform pg_stat_clear_snapshot();${released}v_attempts:=v_attempts+1;
 if v_attempts>=150 or clock_timestamp()>=v_until then raise exception 'Attendance write lock release absent';end if;perform pg_sleep(0.005);end loop;`
  const p=call.args.p_policy,{expected_revision:_revision,...policy}=p
  const fullRow={classroom_id:call.args.p_classroom_id,timezone:'America/Toronto',opens_local:p.session_starts_local+':00',closes_local:p.session_ends_local+':00',
    close_day_offset:p.session_end_day_offset,entry_opens_minutes_before:p.entry_opens_minutes_before,present_grace_minutes:p.present_grace_minutes,
    entry_closes_minutes_before_end:p.entry_closes_minutes_before_end,absent_minutes_before_end:p.absent_minutes_before_end,enabled:p.enabled,policy_revision:1}
  const dto={...policy,classroom_id:call.args.p_classroom_id,timezone:'America/Toronto',revision:1}
  const freshReleased=index===1?`${rowAvailable}if not v_probe then raise exception 'Attendance write lock fresh row still busy';end if;`
    :`if exists(select 1 from pg_locks where ${lockWhere("(select (result#>>'{peer,pid}')::integer from attendance_write_lock_result)",k)})
 then raise exception 'Attendance write lock fresh advisory still held';end if;`
  const fresh=`${begin}do $awl_fresh_${index}_${f.tag.slice(-12)}$ ${declarations}${profile(f,app.B)}v_before:=${state};${baseline(f)}
 v_fresh_self:=${self};
 if (v_fresh_self->>'pid')::integer is distinct from (select (result#>>'{self,pid}')::integer from attendance_write_lock_result)
 or v_fresh_self->>'started' is distinct from (select result#>>'{self,started}' from attendance_write_lock_result)
 or (v_fresh_self->>'xact')::timestamptz<=(select (result#>>'{self,xact}')::timestamptz from attendance_write_lock_result)
 then raise exception 'Attendance write lock fresh transaction identity differs';end if;${freshReleased}
 -- This exception block is a real PostgreSQL savepoint: only the exact sentinel
 -- raised after both real-RPC and full-row validation can record fresh success.
 begin set local role service_role;if current_user<>'service_role' then raise exception 'Attendance write lock wrong fresh RPC role';end if;
 v_result:=${rpc};reset role;
 select to_jsonb(r) into strict v_row from public.attendance_window_policies r where classroom_id=${c}::uuid;
 if (v_row-array['created_at','updated_at']) is distinct from ${json(fullRow)} or v_row->>'created_at' is null or v_row->>'updated_at' is null
 or (v_row->>'created_at')::timestamptz<statement_timestamp() or (v_row->>'updated_at')::timestamptz<(v_row->>'created_at')::timestamptz
 then raise exception 'Attendance write lock fresh complete row differs';end if;
 v_expected:=jsonb_build_object('actor_id',${actor}::uuid,'classroom_id',${c}::uuid,'scope_mode','teacher_entitlements','policy',
 ${json(dto)}||jsonb_build_object('updated_at',v_row->'updated_at'));
 if v_result is distinct from v_expected then raise exception 'Attendance write lock fresh DTO differs';end if;
 v_after:=${state};
 if v_after->>'complementSha256' is distinct from v_before->>'complementSha256'
 or ((v_after->'fixture')-'attendance_window_policies') is distinct from ((v_before->'fixture')-'attendance_window_policies')
 or v_after#>'{fixture,attendance_window_policies}' is distinct from jsonb_build_array(v_row)
 then raise exception 'Attendance write lock fresh other graph differs';end if;
 v_fresh_hash:=${digest('v_after')};v_fresh_succeeded:=true;
 raise exception using errcode='PZ274',message='attendance_policy_write_fresh_rollback';
 exception when sqlstate 'PZ274' then get stacked diagnostics v_message=message_text;
 if v_message is distinct from 'attendance_policy_write_fresh_rollback' or v_fresh_succeeded is distinct from true or v_fresh_hash is null then raise;end if;
 v_fresh_rolled_back:=true;end;
 reset role;if current_user<>'postgres' or not v_fresh_succeeded or not v_fresh_rolled_back then raise exception 'Attendance write lock fresh rollback absent';end if;
 v_after:=${state};if v_after is distinct from v_before then raise exception 'Attendance write lock fresh rollback graph differs';end if;
 update attendance_write_lock_result set result=result||jsonb_build_object('terminalSha256',${digest('v_after')},
 'freshSucceeded',v_fresh_succeeded,'freshRolledBack',v_fresh_rolled_back,'freshSha256',v_fresh_hash,'freshSelf',v_fresh_self,'sentinel','attendance_policy_write_fresh_rollback');
 end;$awl_fresh_${index}_${f.tag.slice(-12)}$;commit;select result from attendance_write_lock_result;`
  const b=`${header}${pins.B.prefix} ${declarations}${profile(f,app.B)}v_self:=${self};${pollPeer(app.ready,pins.A)}
 v_before:=${state};${baseline(f)}${probe}${busy}v_after:=${state};
 if v_after is distinct from v_before then raise exception 'Attendance write lock busy graph differs';end if;
 insert into attendance_write_lock_result values(${base('B')});perform set_config('application_name',${q(app.seen)},true);
 ${releasePoll}end;$${pins.B.tag}$;commit;${fresh}`
  for(const sql of[a,b])assert(Buffer.byteLength(sql)<=ATTENDANCE_POLICY_WRITE_LOCK_CAPS.sqlBytes)
  return{label,a,b,sha256:hash(JSON.stringify({a,b})),bindingSha256,applications:app,profile:'baseline-off' as const,sessions:2 as const,requests:0 as const,executionEnabled:false as const,nativeVerified:false as const}
}
export function attendancePolicyWriteConcurrencyDescriptors(f:AttendancePolicyWriteFixture){
  assertAttendancePolicyWriteFixture(f)
  return freeze({version:1 as const,scope:'attendance-policy-write-lock-v1' as const,pairs:ATTENDANCE_POLICY_WRITE_LOCK_LABELS.map(label=>pairSql(f,label)),
    caps:ATTENDANCE_POLICY_WRITE_LOCK_CAPS,profile:'baseline-off' as const,sessions:2 as const,requests:0 as const,executionEnabled:false as const,nativeVerified:false as const})
}
export function assertAttendancePolicyWriteConcurrencyDescriptors(f:AttendancePolicyWriteFixture,input:unknown):true{
  assert.deepEqual(input,attendancePolicyWriteConcurrencyDescriptors(f));return true
}

const timestamp=z.string().max(80).regex(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::\d\d)?)$/).refine(v=>Number.isFinite(Date.parse(v)))
// Preserve PostgreSQL microseconds when consecutive transactions share a JS
// millisecond; a merely reformatted equal instant is still rejected.
const micros=(v:string)=>BigInt(Date.parse(v))*BigInt(1000)+BigInt((v.match(/\.(\d{1,6})/)?.[1]??'').padEnd(6,'0').slice(3))
const backend=z.object({pid:z.number().int().min(2).max(2147483647),started:timestamp,xact:timestamp}).strict().refine(v=>micros(v.xact)>=micros(v.started))
const sha=z.string().regex(/^[a-f0-9]{64}$/)
const receipt=z.object({version:z.literal(1),scope:z.literal('attendance-policy-write-lock-pair-v1'),label:z.enum(ATTENDANCE_POLICY_WRITE_LOCK_LABELS),bindingSha256:sha,
  role:z.enum(['A','B']),self:backend,peer:backend,beforeSha256:sha,afterBusySha256:sha,terminalSha256:sha,
  holderWitnessed:z.boolean(),conflict:z.enum(['acknowledged','PT409']),busy:z.boolean(),partialLocksReleased:z.boolean(),freshSucceeded:z.boolean(),freshRolledBack:z.boolean(),
  freshSha256:sha.nullable(),freshSelf:backend.nullable(),sentinel:z.literal('attendance_policy_write_fresh_rollback').nullable(),requests:z.literal(0),sessions:z.literal(2),
  executionEnabled:z.literal(false),nativeVerified:z.literal(false)}).strict()
function plain(value:unknown,seen=new Set<object>()):void{
  if(value===null||typeof value!=='object')return
  assert(!seen.has(value));seen.add(value);assert(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)
  for(const key of Reflect.ownKeys(value)){assert(typeof key==='string');const d=Object.getOwnPropertyDescriptor(value,key)!;assert(d.enumerable&&'value'in d);plain(d.value,seen)}seen.delete(value)
}
function jsonReceipt(output:string):unknown{
  assert(typeof output==='string'&&Buffer.byteLength(output)<=4096&&!/[\r\n]/.test(output.trim()))
  const value:unknown=JSON.parse(output);plain(value);const expected:string[]=[]
  const keys=(v:unknown):void=>{if(v&&typeof v==='object')for(const[k,child]of Object.entries(v)){expected.push(k);keys(child)}};keys(value)
  const raw=[...output.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(m=>JSON.parse(m[1]) as string)
  assert.deepEqual(raw.sort(),expected.sort());return value
}
export function parseAttendancePolicyWriteConcurrencyReceipt(output:string){
  try{return freeze(receipt.parse(jsonReceipt(output)))}catch{throw new Error('Attendance write lock receipt rejected')}
}
export function validateAttendancePolicyWriteConcurrencyPair(f:AttendancePolicyWriteFixture,label:AttendancePolicyWriteLockLabel,aRaw:unknown,bRaw:unknown){
  try{
    plain(aRaw);plain(bRaw);const a=receipt.parse(aRaw),b=receipt.parse(bRaw),pair=attendancePolicyWriteConcurrencyDescriptors(f).pairs.find(p=>p.label===label);assert(pair)
    assert(a.label===label&&b.label===label&&a.role==='A'&&b.role==='B'&&a.self.pid!==b.self.pid)
    assert.deepEqual(a.peer,b.self);assert.deepEqual(b.peer,a.self)
    for(const r of[a,b])assert(r.bindingSha256===pair.bindingSha256&&r.beforeSha256===r.afterBusySha256&&r.beforeSha256===r.terminalSha256)
    assert.equal(a.beforeSha256,b.beforeSha256)
    assert(!a.holderWitnessed&&a.conflict==='acknowledged'&&!a.busy&&!a.partialLocksReleased&&!a.freshSucceeded&&!a.freshRolledBack&&a.freshSha256===null&&a.freshSelf===null&&a.sentinel===null)
    assert(b.holderWitnessed&&b.conflict==='PT409'&&b.busy&&b.partialLocksReleased&&b.freshSucceeded&&b.freshRolledBack&&b.freshSha256!==null&&b.freshSha256!==b.beforeSha256)
    assert(b.sentinel==='attendance_policy_write_fresh_rollback'&&b.freshSelf&&b.freshSelf.pid===b.self.pid&&b.freshSelf.started===b.self.started&&micros(b.freshSelf.xact)>micros(b.self.xact))
    return freeze({label,bindingSha256:pair.bindingSha256,holderWitnessed:true,busy:true,partialLocksReleased:true,freshAuthorization:true,
      freshRolledBack:true,exactGraphEffect:true,requests:0 as const,sessions:2 as const,executionEnabled:false as const,nativeVerified:false as const})
  }catch{throw new Error('Attendance write lock pair rejected')}
}
