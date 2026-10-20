/** Inert owner-policy write manifest. Only the outer native owner may execute it. */
import assert from 'node:assert/strict'
import { attendancePolicyFreeze as freeze, attendancePolicyHash as hash } from './contextual-attendance-policy-native-fixture'
export { attendancePolicyFreeze as attendancePolicyWriteFreeze, attendancePolicyHash as attendancePolicyWriteHash } from './contextual-attendance-policy-native-fixture'

export const ATTENDANCE_POLICY_WRITE_CAPS = Object.freeze({ sdkRequests: 16, sqlFrames: 23, sqlBytes: 65536,
  requestBytes: 4096, responseBytes: 16384, bytes: 1048576, sessions: 1, controls: 2048,
  requestMs: 8000, workMs: 720000, cleanupMs: 180000 })
// 23 SQL + 16 HTTP + two full guards around each operation. The carrier adds
// its own finite startup/cleanup actions under the unchanged 200-action ceiling.
export const ATTENDANCE_POLICY_WRITE_ACCOUNTING = Object.freeze({ sqlFrames: 23, http: 16, fullGuards: 78, leafActions: 117 })
const q = (v: string) => `'${v.replaceAll("'", "''")}'`
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`
export function newAttendancePolicyWriteFixture(tag: string) {
  assert.match(tag, /^assignmentlist_[a-f0-9]{12}$/)
  const name = `attendance_policy_write_${tag.slice(-12)}`
  const id = (label: string) => { const h = hash(`${name}:${label}`); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}` }
  const actors = (['student','teacher','teacher','student','teacher'] as const).map((role,n) => ({ id: id(`actor:${n}`), role, email: `${name}_${n}@example.invalid` }))
  const classes = ['student-owner','teacher-owner','archived'].map((label,n) => ({ id: id(`class:${n}`), label, owner: actors[n===1?1:0].id, code: `${name}_${n}` }))
  const enrollments = [0,2].map(n => ({ id: id(`enrollment:${n}`), actorId: actors[n].id, classroomId: classes[0].id }))
  const allocatedIds = [...actors.map(r=>r.id),...classes.map(r=>r.id),...enrollments.map(r=>r.id)]
  assert.equal(new Set(allocatedIds).size,allocatedIds.length)
  return freeze({ version: 1 as const, tag: name, projectId: `pika_assignment_list_${tag.slice(-12)}`, actors, classes, enrollments,
    allocatedIds, baseline: `private.${name}_baseline` })
}
export type AttendancePolicyWriteFixture = ReturnType<typeof newAttendancePolicyWriteFixture>
export function assertAttendancePolicyWriteFixture(f: AttendancePolicyWriteFixture) {
  assert.deepEqual(f,newAttendancePolicyWriteFixture(`assignmentlist_${f.tag.slice(-12)}`)); assert(Object.isFrozen(f.actors))
}
export type AttendancePolicyWriteInput = { session_starts_local: string; session_ends_local: string; session_end_day_offset: 0 | 1;
  entry_opens_minutes_before: number; present_grace_minutes: number; entry_closes_minutes_before_end: number;
  absent_minutes_before_end: number; enabled: boolean; expected_revision: number | null }
export type AttendancePolicyWriteSqlName = 'setup' | 'witness' | 'entitlement-expired' | 'entitlement-revoked' | 'roster-deactivating' | 'restore-baseline' | 'preservation' | `observe-${number}`
export type AttendancePolicyWriteSqlDescriptor = Readonly<{ name: AttendancePolicyWriteSqlName; profile: 'baseline-off'; sql: string; sha256: string; nativeVerified: false }>
export type AttendancePolicyWriteSdkCall = Readonly<{ label: string; adapter: boolean; status: 200 | 403 | 404 | 409;
  transition?: AttendancePolicyWriteSqlName; args: { p_actor_id: string; p_classroom_id: string; p_scope_mode: 'teacher_entitlements' | 'exact_canary';
    p_policy: AttendancePolicyWriteInput; p_canary_actor_id: string | null; p_canary_classroom_id: string | null } }>
export function attendancePolicyWriteSdkInventory(f: AttendancePolicyWriteFixture): readonly AttendancePolicyWriteSdkCall[] {
  assertAttendancePolicyWriteFixture(f)
  const [owner,teacher,member,stranger,stale]=f.actors,[a,b,archived]=f.classes
  const policy = (revision: number|null, update=false): AttendancePolicyWriteInput => ({ session_starts_local: update?'09:10':'09:05', session_ends_local: update?'10:35':'10:25',
    session_end_day_offset:0,entry_opens_minutes_before:update?12:11,present_grace_minutes:update?8:7,entry_closes_minutes_before_end:update?10:9,
    absent_minutes_before_end:update?5:4,enabled:!update,expected_revision:revision })
  const call=(label:string, actor:string, classroom:string, status:AttendancePolicyWriteSdkCall['status'], revision:number|null=2,
    update=false,transition?:AttendancePolicyWriteSqlName):AttendancePolicyWriteSdkCall=>({label,adapter:true,status,...(transition?{transition}:{}),
    args:{p_actor_id:actor,p_classroom_id:classroom,p_scope_mode:'teacher_entitlements',p_policy:policy(revision,update),p_canary_actor_id:null,p_canary_classroom_id:null}})
  const canary=(label:string,actor:string,classroom:string,status:AttendancePolicyWriteSdkCall['status']):AttendancePolicyWriteSdkCall=>({
    ...call(label,owner.id,a.id,status,2),adapter:false,args:{p_actor_id:owner.id,p_classroom_id:a.id,p_scope_mode:'exact_canary',p_policy:policy(2),p_canary_actor_id:actor,p_canary_classroom_id:classroom}})
  return freeze([
    call('student-owner-create',owner.id,a.id,200,null),call('student-owner-update',owner.id,a.id,200,1,true),
    call('teacher-owner-create',teacher.id,b.id,200,null),call('teacher-owner-update',teacher.id,b.id,200,1,true),
    call('stale-revision',owner.id,a.id,409,1),call('missing-revision-existing',owner.id,a.id,409,null),
    call('current-teacher-member-denied',member.id,a.id,403),call('stranger-denied',stranger.id,a.id,403),
    call('cross-class-stale-owner-denied',stale.id,a.id,403),call('archived-owner-denied',owner.id,archived.id,403),
    canary('exact-canary-match',owner.id,a.id,200),canary('exact-canary-actor-mismatch',teacher.id,a.id,404),
    canary('exact-canary-classroom-mismatch',owner.id,b.id,404),
    call('expired-entitlement',owner.id,a.id,404,3,false,'entitlement-expired'),
    call('revoked-entitlement',owner.id,a.id,404,3,false,'entitlement-revoked'),
    call('deactivating-roster',owner.id,a.id,404,3,false,'roster-deactivating'),
  ])
}
/** Whole rows in both partitions include automatic Free provisioning and actual
 * Pal generation triggers, plus the attendance/principal/history footprint. */
export function attendancePolicyWriteGraphSql(f: AttendancePolicyWriteFixture, synthetic: boolean) {
  const actors=f.actors.map(r=>q(r.id)).join(','),classes=f.classes.map(r=>q(r.id)).join(',')
  const scopes: [string,string][]=[['public.users',`id in (${actors})`],
    ...['effective_feature_entitlements','account_plans','account_plan_audit','effective_feature_entitlement_audit'].map(t=>[`public.${t}`,`subject_user_id in (${actors})`] as [string,string]),
    ['public.classrooms',`id in (${classes})`],['private.pal_membership_generations',`generation_id in (${f.enrollments.map(r=>q(r.id)).join(',')}) or scope_digest in (${f.classes.flatMap(c=>f.actors.map(a=>`private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')})`],
    ...['classroom_enrollments','classroom_roster','classroom_roster_student_bindings','classroom_archive_revisions','gradebook_categories','gradebook_settings','class_days','entries',
      'attendance_window_policies','attendance_roster_mappings','attendance_participant_mappings','attendance_occurrence_mappings','attendance_integration_outbox','attendance_integration_inbox',
      'attendance_session_projection','attendance_record_projection','attendance_check_in_facts','attendance_status_overrides','attendance_status_override_events','attendance_override_requests',
      'classroom_purge_operations','classroom_purge_fences','attendance_decommission_operations'].map(t=>[`public.${t}`,`classroom_id in (${classes})`] as [string,string]),
    ['public.attendance_principal_mappings',`user_id in (${actors})`],['public.attendance_teacher_entitlements',`teacher_id in (${actors})`],
    ['public.attendance_teacher_entitlement_audit',`teacher_id in (${actors})`],['public.attendance_outbox_epoch_recovery_audit',`teacher_id in (${actors})`],
    ['public.pal_event_outbox',`student_id in (${actors})`],['private.pal_membership_outbox',`classroom_id in (${classes}) or student_id in (${actors})`],
    ['private.attendance_membership_generations',`generation_id in (${f.enrollments.map(r=>q(r.id)).join(',')}) or scope_digest in (${f.classes.flatMap(c=>f.actors.map(a=>`private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')})`]]
  return `jsonb_build_object(${scopes.map(([table,predicate])=>`${q(table.split('.')[1])},coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from ${table} r where ${synthetic?'':'not '}(coalesce((${predicate}),false))),'[]'::jsonb)`).join(',')})`
}
export function attendancePolicyWriteSqlDescriptors(f: AttendancePolicyWriteFixture): readonly AttendancePolicyWriteSqlDescriptor[] {
  assertAttendancePolicyWriteFixture(f)
  const calls=attendancePolicyWriteSdkInventory(f),actors=f.actors.map(r=>q(r.id)).join(','),classes=f.classes.map(r=>q(r.id)).join(',')
  const owner=q(f.actors[0].id),a=q(f.classes[0].id),graph=attendancePolicyWriteGraphSql(f,true)
  const original=`encode(extensions.digest((${attendancePolicyWriteGraphSql(f,false)})::text,'sha256'),'hex')`
  const prefix="begin;set local lock_timeout='1s';set local statement_timeout='8s';"
  const stage=(name:string)=>`commit;select jsonb_build_object('stage',${q(name)},'nativeVerified',false);`
  const unchanged=`${original} is not distinct from (select original_sha256 from ${f.baseline})`
  const checkpoint=`update ${f.baseline} set checkpoint=${graph};`
  const restoreEntitlement=`update public.attendance_teacher_entitlements e set (status,valid_from,valid_until,revision,source,created_at,updated_at)=
    (select r.status,r.valid_from,r.valid_until,r.revision,r.source,r.created_at,r.updated_at from ${f.baseline} b,lateral jsonb_populate_recordset(null::public.attendance_teacher_entitlements,b.graph->'attendance_teacher_entitlements') r where r.teacher_id=e.teacher_id) where e.teacher_id=${owner};`
  const setup=`${prefix}do $collision$ begin if to_regclass(${q(f.baseline)}) is not null
    or exists(select 1 from public.users where id in (${f.allocatedIds.map(q).join(',')}) or email like ${q(f.tag+'%')})
    or exists(select 1 from public.classrooms where id in (${classes}) or class_code like ${q(f.tag+'%')})
    or exists(select 1 from public.classroom_enrollments where id in (${f.enrollments.map(r=>q(r.id)).join(',')}) or classroom_id in (${classes}) or student_id in (${actors}))
    or exists(select 1 from private.pal_membership_generations where generation_id in (${f.enrollments.map(r=>q(r.id)).join(',')}))
    or exists(select 1 from jsonb_each(${graph}) where value<>'[]'::jsonb)
    then raise exception 'attendance_write_fixture_collision';end if;end;$collision$;
    create table ${f.baseline}(singleton boolean primary key check(singleton),original_sha256 text not null,graph jsonb,checkpoint jsonb,observed integer not null default -1);
    revoke all on ${f.baseline} from public,anon,authenticated,service_role;insert into ${f.baseline}(singleton,original_sha256) values(true,${original});
    insert into public.users(id,email,role) values ${f.actors.map(r=>`(${q(r.id)},${q(r.email)},${q(r.role)})`).join(',')};
    insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision)
      values ${[0,1,4].map(n=>`(${q(f.actors[n].id)},'classrooms.create','manual',true,'2020-01-01',10,1)`).join(',')}
      on conflict(subject_user_id,feature_key) do update set enabled=true,quota_limit=10,starts_at='2020-01-01',expires_at=null;
    insert into public.classrooms(id,teacher_id,title,class_code) values ${f.classes.map((r,n)=>`(${q(r.id)},${q(n===0?f.actors[4].id:r.owner)},${q(f.tag)},${q(r.code)})`).join(',')};
    update public.classrooms set teacher_id=${owner} where id=${a};
    insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(r=>`(${q(r.id)},${q(r.classroomId)},${q(r.actorId)})`).join(',')};
    update public.classrooms set archived_at='2026-10-19T00:00:00Z' where id=${q(f.classes[2].id)};
    insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source) values ${[0,1].map(n=>`(${q(f.actors[n].id)},'active','2020-01-01',1,'native_fixture')`).join(',')};
    insert into public.attendance_roster_mappings(classroom_id,roster_ref) values(${a},'roster_${f.classes[0].id.replaceAll('-','')}');
    update ${f.baseline} set graph=${graph};update ${f.baseline} set checkpoint=graph;${stage('setup')}`
  const transition=(name:string,sql:string)=>`${prefix}${sql}${checkpoint}${stage(name)}`
  const frames: [AttendancePolicyWriteSqlName,string][]=[['setup',setup],['witness',`begin read only;set local statement_timeout='8s';select jsonb_build_object(
    'studentOwner',exists(select 1 from public.classrooms c join public.users u on u.id=c.teacher_id where c.id=${a} and u.id=${owner} and u.role='student'),
    'selfEnrollment',exists(select 1 from public.classroom_enrollments where classroom_id=${a} and student_id=${owner}),
    'membershipGenerationRows',(select count(*) from private.pal_membership_generations g join public.classroom_enrollments e on e.id=g.generation_id where (e.id,e.classroom_id,e.student_id) in (${f.enrollments.map(e=>`(${q(e.id)}::uuid,${q(e.classroomId)}::uuid,${q(e.actorId)}::uuid)`).join(',')}) and g.state='active' and g.scope_digest=private.pal_membership_scope(e.classroom_id,e.student_id)),
    'policyRows',(select count(*) from public.attendance_window_policies where classroom_id in (${classes})),'nativeVerified',false);rollback;`]]
  for (const [n,call] of calls.entries()) {
    const p=call.args.p_policy,c=q(call.args.p_classroom_id),positive=call.status===200
    const expected={classroom_id:call.args.p_classroom_id,timezone:'America/Toronto',opens_local:p.session_starts_local+':00',closes_local:p.session_ends_local+':00',close_day_offset:p.session_end_day_offset,
      entry_opens_minutes_before:p.entry_opens_minutes_before,present_grace_minutes:p.present_grace_minutes,entry_closes_minutes_before_end:p.entry_closes_minutes_before_end,absent_minutes_before_end:p.absent_minutes_before_end,enabled:p.enabled,policy_revision:(p.expected_revision??0)+1}
    const saved=`jsonb_build_object('classroom_id',r.classroom_id,'timezone',r.timezone,'session_starts_local',to_char(r.opens_local,'HH24:MI'),'session_ends_local',to_char(r.closes_local,'HH24:MI'),'session_end_day_offset',r.close_day_offset,'entry_opens_minutes_before',r.entry_opens_minutes_before,'present_grace_minutes',r.present_grace_minutes,'entry_closes_minutes_before_end',r.entry_closes_minutes_before_end,'absent_minutes_before_end',r.absent_minutes_before_end,'enabled',r.enabled,'revision',r.policy_revision,'updated_at',r.updated_at)`
    const check=positive?`v_before:=b.checkpoint->'attendance_window_policies';select value into v_old from jsonb_array_elements(v_before) where value->>'classroom_id'=${c};
      select to_jsonb(r),${saved} into v_row,v_saved from public.attendance_window_policies r where classroom_id=${c};
      if (v_row-array['created_at','updated_at']) is distinct from ${json(expected)} or v_row->>'created_at' is null or v_row->>'updated_at' is null
        or (v_old is null and ${p.expected_revision===null?'false':'true'})
        or (v_old is not null and ((v_old->>'policy_revision')::bigint<>${p.expected_revision??0} or v_row->'created_at' is distinct from v_old->'created_at' or (v_row->>'updated_at')::timestamptz<=(v_old->>'updated_at')::timestamptz))
        or (v_graph-'attendance_window_policies') is distinct from (b.checkpoint-'attendance_window_policies')
        or (select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from jsonb_array_elements(v_graph->'attendance_window_policies') where value->>'classroom_id'<>${c}) is distinct from (select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from jsonb_array_elements(v_before) where value->>'classroom_id'<>${c})
        then raise exception 'attendance_write_positive_postcondition';end if;`
      :`if v_graph is distinct from b.checkpoint then raise exception 'attendance_write_negative_mutated';end if;`
    frames.push([`observe-${n}`,`${prefix}do $observe$ declare b record;v_graph jsonb;v_row jsonb;v_old jsonb;v_before jsonb;v_saved jsonb;begin
      select * into b from ${f.baseline};if b.observed<>${n-1} then raise exception 'attendance_write_observation_order';end if;v_graph:=${graph};
      if not (${unchanged}) then raise exception 'attendance_write_original_drift';end if;${check}
      update ${f.baseline} set checkpoint=v_graph,observed=${n};end;$observe$;
      select jsonb_build_object('case',${q(call.label)},'preserved',true,'saved',${positive?`(select ${saved} from public.attendance_window_policies r where classroom_id=${c})`:'null'},'nativeVerified',false);commit;`])
  }
  frames.push(['entitlement-expired',transition('entitlement-expired',`update public.attendance_teacher_entitlements set valid_until='2020-01-02' where teacher_id=${owner};`)],
    ['entitlement-revoked',transition('entitlement-revoked',`${restoreEntitlement}update public.attendance_teacher_entitlements set status='revoked' where teacher_id=${owner};`)],
    ['roster-deactivating',transition('roster-deactivating',`${restoreEntitlement}update public.attendance_roster_mappings set integration_state='deactivating' where classroom_id=${a};`)],
    ['restore-baseline',`${prefix}${restoreEntitlement}delete from public.attendance_window_policies where classroom_id in (${classes});
      update public.attendance_roster_mappings e set (integration_state,updated_at)=(select r.integration_state,r.updated_at from ${f.baseline} b,lateral jsonb_populate_recordset(null::public.attendance_roster_mappings,b.graph->'attendance_roster_mappings') r where r.classroom_id=e.classroom_id) where e.classroom_id=${a};
      do $restore$ begin if (${graph}) is distinct from (select graph from ${f.baseline}) or not (${unchanged}) then raise exception 'attendance_write_restore_mismatch';end if;end;$restore$;${stage('restore-baseline')}`],
    ['preservation',`begin read only;set local statement_timeout='8s';select jsonb_build_object('sourcePreserved',(${graph}) is not distinct from (select graph from ${f.baseline}),'originalsPreserved',${unchanged},'nativeVerified',false);rollback;`])
  assert.equal(frames.length,ATTENDANCE_POLICY_WRITE_CAPS.sqlFrames)
  return freeze(frames.map(([name,sql])=>{assert(Buffer.byteLength(sql)<=ATTENDANCE_POLICY_WRITE_CAPS.sqlBytes);return{name,profile:'baseline-off' as const,sql,sha256:hash(sql),nativeVerified:false as const}}))
}
export function assertAttendancePolicyWriteSqlDescriptor(f:AttendancePolicyWriteFixture,frame:AttendancePolicyWriteSqlDescriptor) {
  const expected=attendancePolicyWriteSqlDescriptors(f).find(r=>r.name===frame.name);assert(expected);assert.deepEqual(frame,expected)
}
