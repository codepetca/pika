/** Inert Daily Log owner report fixture. No executor or native admission. */
import assert from 'node:assert/strict'
import {attendancePolicyWriteFreeze as freeze,attendancePolicyWriteHash as hash,attendancePolicyWriteGraphSql} from './contextual-attendance-policy-write-native-fixture'
export {attendancePolicyWriteFreeze as attendanceReportFreeze,attendancePolicyWriteHash as attendanceReportHash} from './contextual-attendance-policy-write-native-fixture'
export const ATTENDANCE_REPORT_CAPS=freeze({sdkRequests:12,sqlFrames:18,sqlBytes:65536,requestBytes:4096,responseBytes:16384,
  bytes:1048576,sessions:1,controls:2048,requestMs:8000,workMs:720000,cleanupMs:180000})
export const ATTENDANCE_REPORT_ACCOUNTING=freeze({sqlFrames:18,http:12,fullGuards:60,leafActions:90})
const q=(v:string)=>`'${v.replaceAll("'","''")}'`
export function newAttendanceReportFixture(tag:string){
  assert.match(tag,/^assignmentlist_[a-f0-9]{12}$/);const name=`attendance_report_${tag.slice(-12)}`
  const id=(label:string)=>{const h=hash(`${name}:${label}`);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
  const actors=(['student','teacher','teacher','student','teacher']as const).map((role,n)=>({id:id(`actor:${n}`),role,email:`${name}_${n}@example.invalid`}))
  const classes=['student-owner','teacher-owner','archived-owner','empty-owner'].map((label,n)=>({id:id(`class:${n}`),label,owner:actors[n===1?1:0].id,code:`${name}_${n}`}))
  const enrollments=[[0,0],[0,2],[1,1],[2,3]].map(([ci,ai],n)=>({id:id(`enrollment:${n}`),actorId:actors[ai].id,classroomId:classes[ci].id}))
  const profiles=[0,2,3].map((ai,n)=>({id:id(`profile:${n}`),user_id:actors[ai].id,first_name:['Owner','Member','Archived'][n],last_name:'Synthetic'}))
  const days=[['2000-01-03','2000-01-04','2000-01-05','2000-01-06','2099-01-03','2099-01-04'],['2000-02-01','2099-02-01'],['2000-03-01','2000-03-02','2099-03-01']]
  const classDays=days.flatMap((dates,ci)=>dates.map((date,n)=>({id:id(`day:${ci}:${n}`),classroom_id:classes[ci].id,date,is_class_day:ci===0?n!==3:ci===2?n!==1:true})))
  const journalSentinel=`private_journal_sentinel_${name}`,whitespace='\u00a0\ufeff\u2003\r\n\t '
  const seeds:[number,number,string,string][]=[
    [0,0,'2000-01-03',journalSentinel],[0,0,'2000-01-04',whitespace],[0,0,'2000-01-05','\u200b'],[0,0,'2000-01-06','not-a-class-day'],
    [0,0,'2099-01-03',''],[0,0,'2099-01-04','Future qualifying log'],[0,2,'2000-01-03',''],[0,2,'2000-01-04','Member qualifying log'],
    [0,2,'2000-01-05','\u00a0'],[0,2,'2099-01-04',whitespace],[0,3,'2000-01-03',`nonroster_${journalSentinel}`],
    [1,1,'2000-02-01','\tTeacher qualifying log'],[1,1,'2099-02-01',''],[2,3,'2000-03-01',whitespace],[2,3,'2099-03-01','Archived future log']]
  const entries=seeds.map(([ci,ai,date,text],n)=>({id:id(`entry:${n}`),classroom_id:classes[ci].id,student_id:actors[ai].id,date,text}))
  const missingClassId=id('missing-class'),purgeId=id('purge')
  const allocatedIds=[...actors.map(r=>r.id),...classes.map(r=>r.id),...enrollments.map(r=>r.id),...profiles.map(r=>r.id),...classDays.map(r=>r.id),...entries.map(r=>r.id),missingClassId,purgeId]
  assert.equal(new Set(allocatedIds).size,allocatedIds.length)
  return freeze({version:1 as const,tag:name,projectId:`pika_assignment_list_${tag.slice(-12)}`,actors,classes,enrollments,profiles,classDays,entries,missingClassId,purgeId,
    allocatedIds,baseline:`private.${name}_baseline`,journalSentinel})
}
export type AttendanceReportFixture=ReturnType<typeof newAttendanceReportFixture>
export function assertAttendanceReportFixture(f:AttendanceReportFixture){assert.deepEqual(f,newAttendanceReportFixture(`assignmentlist_${f.tag.slice(-12)}`));assert(Object.isFrozen(f.entries))}
export type AttendanceReportSqlName='prepare'|'setup'|'witness'|'purge-fenced'|'restore-baseline'|'preservation'|`observe-${number}`
export type AttendanceReportSqlDescriptor=Readonly<{name:AttendanceReportSqlName;profile:'baseline-off';sql:string;sha256:string;nativeVerified:false}>
export type AttendanceReportSdkCall=Readonly<{label:string;status:'ok'|'forbidden'|'blocked';transition?:AttendanceReportSqlName;args:{p_actor_id:string;p_classroom_id:string}}>
export function attendanceReportSdkInventory(f:AttendanceReportFixture):readonly AttendanceReportSdkCall[]{
  assertAttendanceReportFixture(f);const[o,t,m,s,old]=f.actors,[a,b,c,d]=f.classes
  const call=(label:string,actor:string,classroom:string,status:AttendanceReportSdkCall['status']='ok',transition?:AttendanceReportSqlName):AttendanceReportSdkCall=>({label,status,...(transition?{transition}:{}),args:{p_actor_id:actor,p_classroom_id:classroom}})
  return freeze([call('student-owner-full',o.id,a.id),call('teacher-owner-full',t.id,b.id),call('archived-owner-full',o.id,c.id),call('empty-owner',o.id,d.id),
    call('teacher-member-denied',m.id,a.id,'forbidden'),call('stranger-denied',s.id,a.id,'forbidden'),call('cross-owner-denied',t.id,a.id,'forbidden'),
    call('old-owner-denied',old.id,a.id,'forbidden'),call('missing-class-denied',o.id,f.missingClassId,'forbidden'),
    call('attendance-free-purge-fenced',o.id,d.id,'blocked','purge-fenced'),call('restored-empty-owner',o.id,d.id,'ok','restore-baseline'),call('restored-full-owner',o.id,a.id)])
}
export function attendanceReportExpectedSnapshot(f:AttendanceReportFixture,call:AttendanceReportSdkCall,observedAt:string){
  const classroom=call.args.p_classroom_id,ok=call.status==='ok'
  const students=ok?f.enrollments.filter(e=>e.classroomId===classroom).map(e=>{const a=f.actors.find(a=>a.id===e.actorId)!,p=f.profiles.find(p=>p.user_id===a.id)
    return{id:a.id,email:a.email,first_name:p?.first_name??'',last_name:p?.last_name??''}}):[]
  return{actor_id:call.args.p_actor_id,classroom_id:classroom,observed_at:observedAt,status:call.status,students,
    class_days:ok?f.classDays.filter(d=>d.classroom_id===classroom).map(({id:_id,...d})=>d):[],
    entries:ok?f.entries.filter(e=>e.classroom_id===classroom&&students.some(s=>s.id===e.student_id)):[]}
}
/** Hand-coded complete DTO oracle. It never invokes production calculations. */
export function attendanceReportExpectedView(f:AttendanceReportFixture,call:AttendanceReportSdkCall){
  if(call.status!=='ok')return null
  const classroom=call.args.p_classroom_id,ci=f.classes.findIndex(c=>c.id===classroom)
  const dates=ci===0?['2000-01-03','2000-01-04','2000-01-05','2099-01-03','2099-01-04']:ci===1?['2000-02-01','2099-02-01']:ci===2?['2000-03-01','2099-03-01']:[]
  const record=(ai:number,statuses:('present'|'absent'|'pending')[],present:number,absent:number)=>{
    const a=f.actors[ai],p=f.profiles.find(p=>p.user_id===a.id)
    return{student_email:a.email,student_id:a.id,student_first_name:p?.first_name??'',student_last_name:p?.last_name??'',dates:Object.fromEntries(dates.map((d,n)=>[d,statuses[n]])),summary:{present,absent}}
  }
  const attendance=ci===0?[record(0,['present','absent','present','pending','present'],3,1),record(2,['absent','present','absent','pending','pending'],1,2)]:
    ci===1?[record(1,['present','pending'],1,0)]:ci===2?[record(3,['absent','present'],1,1)]:[]
  return{attendance,dates,classroom_id:classroom}
}
/** The reused whole-row graph already contains complete class_days/entries.
 * Extend it with complete profiles, preserving both synthetic and complement
 * partitions rather than replacing any table with selected report columns. */
export function attendanceReportGraphSql(f:AttendanceReportFixture,synthetic:boolean){
  return`(${attendancePolicyWriteGraphSql(f,synthetic)})||jsonb_build_object('student_profiles',coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.student_profiles r where ${synthetic?'':'not '}(coalesce((user_id in (${f.actors.map(a=>q(a.id)).join(',')})),false))),'[]'::jsonb))`
}
export function attendanceReportSqlDescriptors(f:AttendanceReportFixture):readonly AttendanceReportSqlDescriptor[]{
  assertAttendanceReportFixture(f);const graph=attendanceReportGraphSql(f,true),original=`encode(extensions.digest((${attendanceReportGraphSql(f,false)})::text,'sha256'),'hex')`
  const prefix="begin;set local lock_timeout='1s';set local statement_timeout='8s';",stage=(name:string)=>`commit;select jsonb_build_object('stage',${q(name)},'nativeVerified',false);`
  const classes=f.classes.map(c=>q(c.id)).join(','),owner=q(f.actors[0].id),empty=q(f.classes[3].id)
  const prepare=`${prefix}do $collision$ begin if to_regclass(${q(f.baseline)})is not null or exists(select 1 from jsonb_each(${graph}) where value<>'[]'::jsonb)
 or exists(select 1 from public.classrooms where id=${q(f.missingClassId)})then raise exception 'attendance_report_fixture_collision';end if;end;$collision$;
 create table ${f.baseline}(singleton boolean primary key check(singleton),original_sha256 text not null,graph jsonb,checkpoint jsonb,observed integer not null default -1);
 revoke all on ${f.baseline} from public,anon,authenticated,service_role;insert into ${f.baseline}(singleton,original_sha256)values(true,${original});${stage('prepare')}`
  const setup=`${prefix}insert into public.users(id,email,role)values${f.actors.map(a=>`(${q(a.id)},${q(a.email)},${q(a.role)})`).join(',')};
 insert into public.student_profiles(id,user_id,first_name,last_name)values${f.profiles.map(p=>`(${q(p.id)},${q(p.user_id)},${q(p.first_name)},${q(p.last_name)})`).join(',')};
 insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision)values${[0,1,4].map(n=>`(${q(f.actors[n].id)},'classrooms.create','manual',true,'2020-01-01',10,1)`).join(',')}on conflict(subject_user_id,feature_key)do update set enabled=true,quota_limit=10,starts_at='2020-01-01',expires_at=null;
 insert into public.classrooms(id,teacher_id,title,class_code)values${f.classes.map((c,n)=>`(${q(c.id)},${q(n===0?f.actors[4].id:c.owner)},${q(f.tag)},${q(c.code)})`).join(',')};update public.classrooms set teacher_id=${owner}where id=${q(f.classes[0].id)};
 insert into public.classroom_enrollments(id,classroom_id,student_id)values${f.enrollments.map(e=>`(${q(e.id)},${q(e.classroomId)},${q(e.actorId)})`).join(',')};
 insert into public.class_days(id,classroom_id,date,is_class_day)values${f.classDays.map(d=>`(${q(d.id)},${q(d.classroom_id)},${q(d.date)},${d.is_class_day})`).join(',')};
 insert into public.entries(id,classroom_id,student_id,date,text,on_time)values${f.entries.map(e=>`(${q(e.id)},${q(e.classroom_id)},${q(e.student_id)},${q(e.date)},${q(e.text)},true)`).join(',')};
 update public.classrooms set archived_at='2026-10-19T00:00:00Z'where id=${q(f.classes[2].id)};
 insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source)values(${owner},'revoked','2020-01-01',1,'native_fixture');
 update ${f.baseline} set graph=${graph};update ${f.baseline} set checkpoint=graph;${stage('setup')}`
  const witness=`begin read only;set local statement_timeout='8s';select jsonb_build_object('studentOwner',exists(select 1 from public.classrooms c join public.users u on u.id=c.teacher_id where c.id=${q(f.classes[0].id)}and u.id=${owner}and u.role='student'),
 'membershipGenerationRows',(select count(*)from private.pal_membership_generations g join public.classroom_enrollments e on e.id=g.generation_id where(e.id,e.classroom_id,e.student_id)in(${f.enrollments.map(e=>`(${q(e.id)}::uuid,${q(e.classroomId)}::uuid,${q(e.actorId)}::uuid)`).join(',')})and g.state='active'and g.scope_digest=private.pal_membership_scope(e.classroom_id,e.student_id)),
 'profiles',(select count(*)from public.student_profiles where user_id in(${f.actors.map(a=>q(a.id)).join(',')})),
 'classDays',(select count(*)from public.class_days where classroom_id in(${classes})),'entries',(select count(*)from public.entries where classroom_id in(${classes})),
 'nonRosterEntries',(select count(*)from public.entries r where classroom_id=${q(f.classes[0].id)}and student_id=${q(f.actors[3].id)}and not exists(select 1 from public.classroom_enrollments e where e.classroom_id=r.classroom_id and e.student_id=r.student_id)),
 'revokedBaraGrant',exists(select 1 from public.attendance_teacher_entitlements where teacher_id=${owner}and status='revoked'),'nativeVerified',false);rollback;`
  const frames:[AttendanceReportSqlName,string][]=[['prepare',prepare],['setup',setup],['witness',witness]]
  for(const[n,call]of attendanceReportSdkInventory(f).entries())frames.push([`observe-${n}`,`${prefix}do $observe$ begin if(select observed from ${f.baseline})<>${n-1}or(${graph})is distinct from(select checkpoint from ${f.baseline})or ${original}is distinct from(select original_sha256 from ${f.baseline})then raise exception 'attendance_report_read_changed_graph';end if;update ${f.baseline} set observed=${n};end;$observe$;select jsonb_build_object('case',${q(call.label)},'preserved',true,'nativeVerified',false);commit;`])
  frames.push(['purge-fenced',`${prefix}insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary)values(${q(f.purgeId)},${owner},${empty},'${'0'.repeat(64)}',1,'{}');insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id)values(${empty},${q(f.purgeId)},${owner});update ${f.baseline} set checkpoint=${graph};${stage('purge-fenced')}`],
    ['restore-baseline',`${prefix}do $unseeded$ declare v_graph jsonb;begin if(select graph from ${f.baseline})is null then v_graph:=${graph};if exists(select 1 from jsonb_each(v_graph)where value<>'[]'::jsonb)then raise exception 'attendance_report_partial_setup';end if;update ${f.baseline} set graph=v_graph,checkpoint=v_graph;end if;end;$unseeded$;
 delete from public.classroom_purge_fences where operation_id=${q(f.purgeId)};delete from public.classroom_purge_operations where id=${q(f.purgeId)};
 do $restore$ begin if(${graph})is distinct from(select graph from ${f.baseline})or ${original}is distinct from(select original_sha256 from ${f.baseline})then raise exception 'attendance_report_restore_mismatch';end if;end;$restore$;update ${f.baseline} set checkpoint=graph;${stage('restore-baseline')}`],
    ['preservation',`begin read only;set local statement_timeout='8s';select jsonb_build_object('sourcePreserved',(${graph})is not distinct from(select graph from ${f.baseline}),'originalsPreserved',${original}is not distinct from(select original_sha256 from ${f.baseline}),'nativeVerified',false);rollback;`])
  assert.equal(frames.length,ATTENDANCE_REPORT_CAPS.sqlFrames)
  return freeze(frames.map(([name,sql])=>{assert(Buffer.byteLength(sql)<=ATTENDANCE_REPORT_CAPS.sqlBytes,`${name}:SQL cap`);return{name,profile:'baseline-off'as const,sql,sha256:hash(sql),nativeVerified:false as const}}))
}
export function assertAttendanceReportSqlDescriptor(f:AttendanceReportFixture,frame:AttendanceReportSqlDescriptor){const expected=attendanceReportSqlDescriptors(f).find(r=>r.name===frame.name);assert(expected);assert.deepEqual(frame,expected)}
