/** Inert synthetic owner session-read manifest. Execution belongs to the root. */
import assert from 'node:assert/strict'
import type { TeacherAttendanceView } from '../src/lib/teacher-attendance'
import { validateV1Message } from '../src/vendor/attendance-contract/v1/validate'
import { attendancePolicyWriteFreeze as freeze,attendancePolicyWriteHash as hash,attendancePolicyWriteGraphSql } from './contextual-attendance-policy-write-native-fixture'
export { attendancePolicyWriteFreeze as attendanceSessionFreeze,attendancePolicyWriteHash as attendanceSessionHash } from './contextual-attendance-policy-write-native-fixture'
export const ATTENDANCE_SESSION_CAPS=freeze({sdkRequests:16,sqlFrames:26,sqlBytes:65536,requestBytes:4096,responseBytes:16384,
  bytes:1048576,sessions:1,controls:2048,requestMs:8000,workMs:720000,cleanupMs:180000})
export const ATTENDANCE_SESSION_ACCOUNTING=freeze({sqlFrames:26,http:16,fullGuards:84,leafActions:126})
const q=(v:string)=>`'${v.replaceAll("'","''")}'`,json=(v:unknown)=>`${q(JSON.stringify(v))}::jsonb`
export function newAttendanceSessionFixture(tag:string){
  assert.match(tag,/^assignmentlist_[a-f0-9]{12}$/);const name=`attendance_session_${tag.slice(-12)}`
  const id=(label:string)=>{const h=hash(`${name}:${label}`);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
  const actors=(['student','teacher','teacher','student','teacher']as const).map((role,n)=>({id:id(`actor:${n}`),role,email:`${name}_${n}@example.invalid`}))
  const classes=['ready','policy-only','archived','purge-free'].map((label,n)=>({id:id(`class:${n}`),label,owner:actors[n===1?1:0].id,code:`${name}_${n}`}))
  const enrollments=[[0,0],[0,2],[2,3]].map(([ci,ai],n)=>({id:id(`enrollment:${n}`),actorId:actors[ai].id,classroomId:classes[ci].id}))
  const profiles=[0,2,3].map((ai,n)=>({id:id(`profile:${n}`),user_id:actors[ai].id,first_name:['Owner','Member','Archived'][n],last_name:'Synthetic'}))
  const installationRef='pika-attendance-session-proof',classDate='2026-09-02',occurrenceRef=`occurrence_${classes[0].id.replaceAll('-','')}`
  const rosterRef=`roster_${classes[0].id.replaceAll('-','')}`,principalRef=`principal_${actors[0].id.replaceAll('-','')}`
  const time={opens:'2026-09-02T12:50:00+00:00',closes:'2026-09-02T13:50:00+00:00',starts:'2026-09-02T13:00:00+00:00',
    ends:'2026-09-02T14:00:00+00:00',present:'2026-09-02T13:05:00+00:00',accepted:'2026-09-02T13:01:00+00:00',updated:'2026-09-02T13:20:00+00:00'}
  const participants=[0,2].map(ai=>({student_id:actors[ai].id,participant_ref:`participant_${actors[ai].id.replaceAll('-','')}`})).sort((a,b)=>a.student_id.localeCompare(b.student_id))
  const facts=[0,2].map((ai,n)=>({id:id(`fact:${n}`),student_id:actors[ai].id,check_in_ref:`check_in_${name}_${n}`,check_in_revision:n+1,
    accepted_at:time.accepted,invalidated_at:n?time.updated:null,updated_at:time.updated,participant_ref:participants.find(p=>p.student_id===actors[ai].id)!.participant_ref}))
  const override={id:id('override'),student_id:actors[2].id,status:'late' as const,active:true,revision:3,updated_at:time.updated}
  const outbox=[0,1,2,3].map(n=>{
    const invalidation=n>=2,type=invalidation?'check_in.invalidate':'session.command',key=`${name}:${n}`
    const payload={schema_version:1,message_type:type,idempotency_key:key,correlation_ref:`correlation_${name}_${n}`,installation_ref:installationRef,
      roster_ref:rosterRef,occurrence_ref:occurrenceRef,actor_principal_ref:principalRef,actor_display_name:'Synthetic Owner',
      ...(invalidation?{invalidations:facts.map((f,i)=>({command_ref:`command_${name}_${n}_${i}`,check_in_ref:f.check_in_ref,reason_code:'staff_reset'}))}:{command:n?'close':'open'})}
    assert(validateV1Message(payload).ok)
    return{id:id(`outbox:${n}`),message_type:type,payload,status:n%2?'non_retryable':'pending',lease_expires_at:null,updated_at:time.updated}
  }).sort((a,b)=>a.id.localeCompare(b.id))
  const allocatedIds=[...actors.map(r=>r.id),...classes.map(r=>r.id),...enrollments.map(r=>r.id),...profiles.map(r=>r.id),...facts.map(r=>r.id),override.id,...outbox.map(r=>r.id),id('session'),id('purge')]
  assert.equal(new Set(allocatedIds).size,allocatedIds.length)
  return freeze({version:1 as const,tag:name,projectId:`pika_assignment_list_${tag.slice(-12)}`,actors,classes,enrollments,profiles,allocatedIds,
    baseline:`private.${name}_baseline`,installationRef,classDate,occurrenceRef,rosterRef,principalRef,time,participants,facts,override,outbox,sessionId:id('session'),purgeId:id('purge')})
}
export type AttendanceSessionFixture=ReturnType<typeof newAttendanceSessionFixture>
export function assertAttendanceSessionFixture(f:AttendanceSessionFixture){assert.deepEqual(f,newAttendanceSessionFixture(`assignmentlist_${f.tag.slice(-12)}`));assert(Object.isFrozen(f.actors))}
export type AttendanceSessionSqlName='prepare'|'setup'|'witness'|'policy-disabled'|'entitlement-expired'|'entitlement-revoked'|'roster-deactivating'|'purge-fenced'|'restore-baseline'|'preservation'|`observe-${number}`
export type AttendanceSessionSqlDescriptor=Readonly<{name:AttendanceSessionSqlName;profile:'baseline-off';sql:string;sha256:string;nativeVerified:false}>
export type AttendanceSessionSdkCall=Readonly<{label:string;adapter:boolean;status:'ok'|'forbidden'|'blocked';integration:'ready'|'disabled';
  view:'full'|'empty-ready'|'empty-disabled'|'empty-not-configured'|'none';transition?:AttendanceSessionSqlName;args:{p_actor_id:string;p_classroom_id:string;p_class_date:string;
    p_runtime_integration:'ready';p_scope_mode:'teacher_entitlements'|'exact_canary';p_installation_ref:string;p_canary_actor_id:string|null;p_canary_classroom_id:string|null}}>
export function attendanceSessionSdkInventory(f:AttendanceSessionFixture):readonly AttendanceSessionSdkCall[]{
  assertAttendanceSessionFixture(f);const[o,t,m,s,old]=f.actors,[a,b,archived,purge]=f.classes
  const call=(label:string,actor:string,classroom:string,status:AttendanceSessionSdkCall['status']='ok',integration:AttendanceSessionSdkCall['integration']='ready',
    view:AttendanceSessionSdkCall['view']='full',transition?:AttendanceSessionSqlName):AttendanceSessionSdkCall=>({label,adapter:true,status,integration,view,...(transition?{transition}:{}),
    args:{p_actor_id:actor,p_classroom_id:classroom,p_class_date:f.classDate,p_runtime_integration:'ready',p_scope_mode:'teacher_entitlements',p_installation_ref:f.installationRef,p_canary_actor_id:null,p_canary_classroom_id:null}})
  const canary=(label:string,actor:string,classroom:string,match=false):AttendanceSessionSdkCall=>({...call(label,o.id,a.id,'ok',match?'ready':'disabled',match?'full':'empty-disabled'),adapter:false,
    args:{...call(label,o.id,a.id).args,p_scope_mode:'exact_canary',p_canary_actor_id:actor,p_canary_classroom_id:classroom}})
  const off=call('policy-disabled-not-scheduled',o.id,a.id,'ok','ready','empty-not-configured','policy-disabled')
  return freeze([call('student-owner-full-ready',o.id,a.id),call('teacher-owner-policy-no-occurrence',t.id,b.id,'ok','ready','empty-ready'),
    call('current-teacher-member-denied',m.id,a.id,'forbidden','disabled','none'),call('stranger-denied',s.id,a.id,'forbidden','disabled','none'),
    call('stale-old-owner-denied',old.id,a.id,'forbidden','disabled','none'),call('cross-class-owner-denied',t.id,a.id,'forbidden','disabled','none'),
    call('archived-owner-roster-only',o.id,archived.id,'ok','disabled','empty-disabled'),canary('exact-canary-match',o.id,a.id,true),
    canary('exact-canary-actor-mismatch',t.id,a.id),canary('exact-canary-classroom-mismatch',o.id,b.id),
    {...off,args:{...off.args,p_class_date:'2026-09-03'}},call('expired-entitlement',o.id,a.id,'ok','disabled','empty-disabled','entitlement-expired'),
    call('revoked-entitlement',o.id,a.id,'ok','disabled','empty-disabled','entitlement-revoked'),call('deactivating-roster',o.id,a.id,'ok','disabled','empty-disabled','roster-deactivating'),
    call('attendance-free-purge-fenced',o.id,purge.id,'blocked','disabled','none','purge-fenced'),call('restored-owner-full-ready',o.id,a.id,'ok','ready','full','restore-baseline')])
}
const studentsFor=(f:AttendanceSessionFixture,classroom:string)=>f.enrollments.filter(e=>e.classroomId===classroom).map(e=>{
  const a=f.actors.find(a=>a.id===e.actorId)!,p=f.profiles.find(p=>p.user_id===e.actorId)!;return{id:a.id,email:a.email,first_name:p.first_name,last_name:p.last_name,enrollment:e.id}
}).sort((a,b)=>a.enrollment.localeCompare(b.enrollment)).map(({enrollment:_e,...s})=>s)
// The existing native witness proves these exact synthetic enrollment IDs have
// active168 generations and matching scopes. No provider reference or date is
// used to attribute membership, and self-owner enrollment is not a learner.
const membershipTargetsFor=(f:AttendanceSessionFixture,call:AttendanceSessionSdkCall)=>
  call.status==='ok'&&call.integration==='ready'?f.enrollments
    .filter(e=>e.classroomId===call.args.p_classroom_id&&e.actorId!==f.classes.find(c=>c.id===e.classroomId)!.owner)
    .map(e=>({student_id:e.actorId,generation_id:e.id})).sort((a,b)=>a.student_id.localeCompare(b.student_id)):[]
export function attendanceSessionExpectedSnapshot(f:AttendanceSessionFixture,call:AttendanceSessionSdkCall,observedAt:string){
  const empty={participants:[],occurrence:null,policy:null,session:null,check_ins:[],overrides:[],outbox:[]}
  const full=call.view==='full',ready=call.integration==='ready',policyOnly=call.view==='empty-ready'||call.view==='empty-not-configured'
  const rows=!ready?empty:full?{participants:f.participants,occurrence:{occurrence_ref:f.occurrenceRef,opens_at:f.time.opens,closes_at:f.time.closes,
    session_starts_at:f.time.starts,session_ends_at:f.time.ends,present_through_at:f.time.present,absent_at:f.time.ends},policy:{enabled:true},
    session:{occurrence_ref:f.occurrenceRef,status:'open',opens_at:f.time.opens,closes_at:f.time.closes,session_revision:4,updated_at:f.time.updated},
    check_ins:f.facts.map(({student_id,check_in_ref,check_in_revision,accepted_at,invalidated_at,updated_at})=>({student_id,check_in_ref,check_in_revision,accepted_at,invalidated_at,updated_at})).sort((a,b)=>a.check_in_ref.localeCompare(b.check_in_ref)),
    overrides:[{student_id:f.override.student_id,status:f.override.status,active:true,revision:3,updated_at:f.time.updated}],outbox:f.outbox.map(({id:_id,...r})=>r)}:
    {...empty,participants:policyOnly&&call.args.p_classroom_id===f.classes[0].id?f.participants:[],policy:policyOnly?{enabled:call.view!=='empty-not-configured'}:null}
  return{actor_id:call.args.p_actor_id,classroom_id:call.args.p_classroom_id,class_date:call.args.p_class_date,runtime_integration:call.args.p_runtime_integration,
    scope_mode:call.args.p_scope_mode,installation_ref:call.args.p_installation_ref,observed_at:observedAt,status:call.status,integration:call.integration,
    students:call.status==='ok'?studentsFor(f,call.args.p_classroom_id):[],rows,
    ...(call.adapter?{membership_targets:membershipTargetsFor(f,call)}:{})}
}
/** Independent complete browser DTO oracle; never calls the production builder. */
export function attendanceSessionExpectedView(f:AttendanceSessionFixture,call:AttendanceSessionSdkCall):TeacherAttendanceView|null{
  if(call.view==='none')return null;const full=call.view==='full'
  const integration=call.view==='empty-not-configured'?'not_configured':call.integration
  return{classroomId:call.args.p_classroom_id,classDate:call.args.p_class_date,integration,...(call.adapter?{membershipAware:true as const}:{}),
    session:{state:full?'open':'not_scheduled',opensAt:full?f.time.opens:null,closesAt:full?f.time.closes:null,sessionStartsAt:full?f.time.starts:null,
      sessionEndsAt:full?f.time.ends:null,presentThroughAt:full?f.time.present:null,absentAt:full?f.time.ends:null,revision:full?4:null,pendingCommand:full,commandFailed:false},
    sync:{state:full?'pending':integration==='ready'?'current':'unavailable',confirmedAt:full?f.time.updated:null},
    students:studentsFor(f,call.args.p_classroom_id).sort((a,b)=>a.email.localeCompare(b.email)||a.id.localeCompare(b.id)).map(s=>{
      const owner=s.id===f.actors[0].id
      return{studentId:s.id,firstName:s.first_name,lastName:s.last_name,status:full?(owner?'present':'late'):'unmarked',source:full?(owner?'student_qr':'staff'):null,
        checkedInAt:full&&owner?f.time.accepted:null,revision:full?(owner?1:3):null,hasQrCheckIn:full&&owner,hasManualOverride:full&&!owner,pendingCommand:full&&owner,commandFailed:false,
        ...(call.adapter?{membershipGenerationId:membershipTargetsFor(f,call).find(target=>target.student_id===s.id)?.generation_id??null}:{})}
    })}
}
export function attendanceSessionGraphSql(f:AttendanceSessionFixture,synthetic:boolean){
  const actors=f.actors.map(a=>q(a.id)).join(',')
  return`(${attendancePolicyWriteGraphSql(f,synthetic)})||jsonb_build_object('student_profiles',coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.student_profiles r where ${synthetic?'':'not '}(coalesce((user_id in (${actors})),false))),'[]'::jsonb))`
}
export function attendanceSessionSqlDescriptors(f:AttendanceSessionFixture):readonly AttendanceSessionSqlDescriptor[]{
  assertAttendanceSessionFixture(f);const graph=attendanceSessionGraphSql(f,true),original=`encode(extensions.digest((${attendanceSessionGraphSql(f,false)})::text,'sha256'),'hex')`
  const calls=attendanceSessionSdkInventory(f),a=q(f.classes[0].id),o=q(f.actors[0].id),classes=f.classes.map(c=>q(c.id)).join(',')
  const prefix="begin;set local lock_timeout='1s';set local statement_timeout='8s';",stage=(name:string)=>`commit;select jsonb_build_object('stage',${q(name)},'nativeVerified',false);`
  const checkpoint=`update ${f.baseline} set checkpoint=${graph};`
  const restoreGrant=`update public.attendance_teacher_entitlements e set(status,valid_from,valid_until,revision,source,created_at,updated_at)=(select r.status,r.valid_from,r.valid_until,r.revision,r.source,r.created_at,r.updated_at from ${f.baseline} b,lateral jsonb_populate_recordset(null::public.attendance_teacher_entitlements,b.graph->'attendance_teacher_entitlements') r where r.teacher_id=e.teacher_id) where teacher_id=${o};`
  const prepare=`${prefix}do $collision$ begin if to_regclass(${q(f.baseline)}) is not null or exists(select 1 from jsonb_each(${graph}) where value<>'[]'::jsonb) then raise exception 'attendance_session_fixture_collision';end if;end;$collision$;
 create table ${f.baseline}(singleton boolean primary key check(singleton),original_sha256 text not null,graph jsonb,checkpoint jsonb,observed integer not null default -1);
 revoke all on ${f.baseline} from public,anon,authenticated,service_role;insert into ${f.baseline}(singleton,original_sha256) values(true,${original});${stage('prepare')}`
  const setup=`${prefix}insert into public.users(id,email,role) values ${f.actors.map(r=>`(${q(r.id)},${q(r.email)},${q(r.role)})`).join(',')};
 insert into public.student_profiles(id,user_id,first_name,last_name) values ${f.profiles.map(r=>`(${q(r.id)},${q(r.user_id)},${q(r.first_name)},${q(r.last_name)})`).join(',')};
 insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision) values ${[0,1,4].map(n=>`(${q(f.actors[n].id)},'classrooms.create','manual',true,'2020-01-01',10,1)`).join(',')} on conflict(subject_user_id,feature_key) do update set enabled=true,quota_limit=10,starts_at='2020-01-01',expires_at=null;
 insert into public.classrooms(id,teacher_id,title,class_code) values ${f.classes.map((r,n)=>`(${q(r.id)},${q(n===0?f.actors[4].id:r.owner)},${q(f.tag)},${q(r.code)})`).join(',')};update public.classrooms set teacher_id=${o} where id=${a};
 insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(e=>`(${q(e.id)},${q(e.classroomId)},${q(e.actorId)})`).join(',')};update public.classrooms set archived_at='2026-10-19T00:00:00Z' where id=${q(f.classes[2].id)};
 insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source) values ${[0,1].map(n=>`(${q(f.actors[n].id)},'active','2020-01-01',1,'native_fixture')`).join(',')};
 insert into public.attendance_window_policies(classroom_id,opens_local,closes_local,enabled,policy_revision) values(${a},'09:00','10:00',true,7),(${q(f.classes[1].id)},'09:00','10:00',true,3);
 insert into public.attendance_roster_mappings(classroom_id,roster_ref) values(${a},${q(f.rosterRef)});
 insert into public.attendance_participant_mappings(classroom_id,student_id,participant_ref) values ${f.participants.map(r=>`(${a},${q(r.student_id)},${q(r.participant_ref)})`).join(',')};
 insert into public.attendance_occurrence_mappings(classroom_id,class_date,occurrence_ref,opens_at,closes_at,session_starts_at,session_ends_at,present_through_at,absent_at,policy_revision)
 values(${a},${q(f.classDate)},${q(f.occurrenceRef)},${q(f.time.opens)},${q(f.time.closes)},${q(f.time.starts)},${q(f.time.ends)},${q(f.time.present)},${q(f.time.ends)},7);
 insert into public.attendance_session_projection(id,classroom_id,installation_ref,roster_ref,occurrence_ref,session_revision,status,opens_at,closes_at,last_event_id,last_event_at,updated_at)
 values(${q(f.sessionId)},${a},${q(f.installationRef)},${q(f.rosterRef)},${q(f.occurrenceRef)},4,'open',${q(f.time.opens)},${q(f.time.closes)},'synthetic_event',${q(f.time.updated)},${q(f.time.updated)});
 insert into public.attendance_check_in_facts(id,classroom_id,student_id,installation_ref,roster_ref,occurrence_ref,participant_ref,check_in_ref,check_in_revision,accepted_at,invalidated_at,updated_at)
 values ${f.facts.map(r=>`(${q(r.id)},${a},${q(r.student_id)},${q(f.installationRef)},${q(f.rosterRef)},${q(f.occurrenceRef)},${q(r.participant_ref)},${q(r.check_in_ref)},${r.check_in_revision},${q(r.accepted_at)},${r.invalidated_at?q(r.invalidated_at):'null'},${q(r.updated_at)})`).join(',')};
 insert into public.attendance_status_overrides(id,classroom_id,student_id,occurrence_ref,status,active,revision,updated_by,updated_at) values(${q(f.override.id)},${a},${q(f.override.student_id)},${q(f.occurrenceRef)},'late',true,3,${o},${q(f.time.updated)});
 insert into public.attendance_integration_outbox(id,classroom_id,idempotency_key,message_type,payload,status,updated_at) values ${f.outbox.map(r=>`(${q(r.id)},${a},${q(r.payload.idempotency_key)},${q(r.message_type)},${json(r.payload)},${q(r.status)},${q(r.updated_at)})`).join(',')};
 update ${f.baseline} set graph=${graph};update ${f.baseline} set checkpoint=graph;${stage('setup')}`
  const transition=(name:string,sql:string)=>`${prefix}${sql}${checkpoint}${stage(name)}`
  const frames:[AttendanceSessionSqlName,string][]=[['prepare',prepare],['setup',setup],['witness',`begin read only;set local statement_timeout='8s';select jsonb_build_object('studentOwner',exists(select 1 from public.classrooms c join public.users u on u.id=c.teacher_id where c.id=${a} and u.id=${o} and u.role='student'),
 'membershipGenerationRows',(select count(*) from private.pal_membership_generations g join public.classroom_enrollments e on e.id=g.generation_id where(e.id,e.classroom_id,e.student_id)in(${f.enrollments.map(e=>`(${q(e.id)}::uuid,${q(e.classroomId)}::uuid,${q(e.actorId)}::uuid)`).join(',')}) and g.state='active' and g.scope_digest=private.pal_membership_scope(e.classroom_id,e.student_id)),
 'facts',(select count(*) from public.attendance_check_in_facts where classroom_id=${a}),'outbox',(select count(*) from public.attendance_integration_outbox where classroom_id=${a}),'nativeVerified',false);rollback;`]]
  for(const[n,call]of calls.entries())frames.push([`observe-${n}`,`${prefix}do $observe$ begin if (select observed from ${f.baseline})<>${n-1} or (${graph}) is distinct from (select checkpoint from ${f.baseline}) or ${original} is distinct from (select original_sha256 from ${f.baseline}) then raise exception 'attendance_session_read_changed_graph';end if;update ${f.baseline} set observed=${n};end;$observe$;
 select jsonb_build_object('case',${q(call.label)},'preserved',true,'nativeVerified',false);commit;`])
  frames.push(['policy-disabled',transition('policy-disabled',`update public.attendance_window_policies set enabled=false where classroom_id=${a};`)],
    ['entitlement-expired',transition('entitlement-expired',`update public.attendance_teacher_entitlements set valid_until='2020-01-02' where teacher_id=${o};`)],
    ['entitlement-revoked',transition('entitlement-revoked',`${restoreGrant}update public.attendance_teacher_entitlements set status='revoked' where teacher_id=${o};`)],
    ['roster-deactivating',transition('roster-deactivating',`${restoreGrant}update public.attendance_roster_mappings set integration_state='deactivating' where classroom_id=${a};`)],
    ['purge-fenced',transition('purge-fenced',`insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary) values(${q(f.purgeId)},${o},${q(f.classes[3].id)},'${'0'.repeat(64)}',1,'{}');insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values(${q(f.classes[3].id)},${q(f.purgeId)},${o});`)],
    ['restore-baseline',`${prefix}do $unseeded$ declare v_graph jsonb;begin if(select graph from ${f.baseline})is null then v_graph:=${graph};
 if exists(select 1 from jsonb_each(v_graph) where value<>'[]'::jsonb) then raise exception 'attendance_session_partial_setup';end if;
 update ${f.baseline} set graph=v_graph,checkpoint=v_graph;end if;end;$unseeded$;
 delete from public.classroom_purge_fences where operation_id=${q(f.purgeId)};delete from public.classroom_purge_operations where id=${q(f.purgeId)};${restoreGrant}
 update public.attendance_window_policies e set(enabled,updated_at)=(select r.enabled,r.updated_at from ${f.baseline} b,lateral jsonb_populate_recordset(null::public.attendance_window_policies,b.graph->'attendance_window_policies') r where r.classroom_id=e.classroom_id) where classroom_id=${a};
 update public.attendance_roster_mappings e set(integration_state,updated_at)=(select r.integration_state,r.updated_at from ${f.baseline} b,lateral jsonb_populate_recordset(null::public.attendance_roster_mappings,b.graph->'attendance_roster_mappings') r where r.classroom_id=e.classroom_id) where classroom_id=${a};
 do $restore$ begin if (${graph}) is distinct from(select graph from ${f.baseline}) or ${original} is distinct from(select original_sha256 from ${f.baseline}) then raise exception 'attendance_session_restore_mismatch';end if;end;$restore$;update ${f.baseline} set checkpoint=graph;${stage('restore-baseline')}`],
    ['preservation',`begin read only;set local statement_timeout='8s';select jsonb_build_object('sourcePreserved',(${graph})is not distinct from(select graph from ${f.baseline}),'originalsPreserved',${original}is not distinct from(select original_sha256 from ${f.baseline}),'nativeVerified',false);rollback;`])
  assert.equal(frames.length,ATTENDANCE_SESSION_CAPS.sqlFrames)
  return freeze(frames.map(([name,sql])=>{assert(Buffer.byteLength(sql)<=ATTENDANCE_SESSION_CAPS.sqlBytes,`${name}:SQL cap`);return{name,profile:'baseline-off'as const,sql,sha256:hash(sql),nativeVerified:false as const}}))
}
export function assertAttendanceSessionSqlDescriptor(f:AttendanceSessionFixture,frame:AttendanceSessionSqlDescriptor){const expected=attendanceSessionSqlDescriptors(f).find(r=>r.name===frame.name);assert(expected);assert.deepEqual(frame,expected)}
