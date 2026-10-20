/** Inert attendance leaf: deterministic synthetic data and a closed SQL inventory. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const ATTENDANCE_POLICY_CAPS = Object.freeze({ sdkRequests: 16, sqlFrames: 7, sqlBytes: 65536,
  requestBytes: 4096, responseBytes: 16384, bytes: 1024 * 1024, sessions: 1, controls: 2048,
  requestMs: 8000, workMs: 720000, cleanupMs: 180000 })
export const attendancePolicyHash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export function attendancePolicyFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(attendancePolicyFreeze); Object.freeze(value) }
  return value
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
export function newAttendancePolicyFixture(tag: string) {
  assert.match(tag, /^assignmentlist_[a-f0-9]{12}$/)
  const name = `attendance_policy_${tag.slice(-12)}`
  const id = (label: string) => { const h = attendancePolicyHash(`${name}:${label}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
  const actors = (['student', 'teacher', 'teacher', 'student', 'teacher'] as const).map((role, n) => ({ id: id(`actor:${n}`), role, email: `${name}_${n}@example.invalid` }))
  const classes = ['policy', 'null-policy', 'archived', 'purge', 'decommission'].map((label, n) => ({
    id: id(`class:${n}`), label, owner: actors[n === 1 ? 1 : 0].id, code: `${name}_${n}`,
  }))
  const enrollments = [0, 2].map(n => ({ id: id(`enrollment:${n}`), actorId: actors[n].id, classroomId: classes[0].id }))
  const operations = [id('purge-operation'), id('decommission-operation')]
  const policy = { classroom_id: classes[0].id, timezone: 'America/Toronto' as const, opens_local: '09:05:00', closes_local: '10:25:00',
    close_day_offset: 0 as const, entry_opens_minutes_before: 11, present_grace_minutes: 7,
    entry_closes_minutes_before_end: 9, absent_minutes_before_end: 4, enabled: true, policy_revision: 7,
    updated_at: '2026-10-19T00:00:00+00:00' }
  const allocatedIds = [...actors.map(a => a.id), ...classes.map(c => c.id), ...enrollments.map(e => e.id), ...operations]
  assert.equal(new Set(allocatedIds).size, allocatedIds.length)
  return attendancePolicyFreeze({ version: 1 as const, tag: name, projectId: `pika_assignment_list_${tag.slice(-12)}`,
    actors, classes, enrollments, operations, policy, baseline: `private.${name}_baseline`, allocatedIds })
}
export type AttendancePolicyFixture = ReturnType<typeof newAttendancePolicyFixture>
export function assertAttendancePolicyFixture(f: AttendancePolicyFixture) {
  assert.deepEqual(f, newAttendancePolicyFixture(`assignmentlist_${f.tag.slice(-12)}`)); assert(Object.isFrozen(f.actors))
}
export type AttendancePolicyStatus = 'ready' | 'forbidden' | 'archived' | 'blocked' | 'disabled'
export type AttendancePolicySqlName = 'setup' | 'entitlement-expired' | 'entitlement-revoked' | 'roster-deactivating' | 'restore-baseline' | 'witness' | 'preservation'
export type AttendancePolicySqlDescriptor = Readonly<{ name: AttendancePolicySqlName; profile: 'baseline-off'; sql: string; sha256: string; nativeVerified: false }>
export type AttendancePolicySdkCall = Readonly<{ label: string; adapter: boolean; status: AttendancePolicyStatus; policy: boolean;
  transition?: AttendancePolicySqlName; args: { p_actor_id: string; p_classroom_id: string; p_scope_mode: 'teacher_entitlements' | 'exact_canary'; p_canary_actor_id: string | null; p_canary_classroom_id: string | null } }>
export function attendancePolicySdkInventory(f: AttendancePolicyFixture): readonly AttendancePolicySdkCall[] {
  assertAttendancePolicyFixture(f)
  const [owner, teacher, member, stranger, stale] = f.actors, [a, b, archived, purge, decommission] = f.classes
  const call = (label: string, actor: string, classroom: string, status: AttendancePolicyStatus, policy = false,
    transition?: AttendancePolicySqlName): AttendancePolicySdkCall => ({ label, adapter: true, status, policy, ...(transition ? { transition } : {}),
    args: { p_actor_id: actor, p_classroom_id: classroom, p_scope_mode: 'teacher_entitlements', p_canary_actor_id: null, p_canary_classroom_id: null } })
  const canary = (label: string, actor: string, classroom: string, status: AttendancePolicyStatus): AttendancePolicySdkCall => ({
    ...call(label, owner.id, a.id, status, status === 'ready'), adapter: false,
    args: { p_actor_id: owner.id, p_classroom_id: a.id, p_scope_mode: 'exact_canary', p_canary_actor_id: actor, p_canary_classroom_id: classroom },
  })
  return attendancePolicyFreeze([
    call('student-owner-self-enrollment-policy', owner.id, a.id, 'ready', true), call('teacher-owner-null-policy', teacher.id, b.id, 'ready'),
    call('current-teacher-member-denied', member.id, a.id, 'forbidden'), call('stranger-denied', stranger.id, a.id, 'forbidden'),
    call('stale-owner-denied', stale.id, a.id, 'forbidden'), call('cross-class-owner-denied', teacher.id, a.id, 'forbidden'),
    call('archived-owner-denied', owner.id, archived.id, 'archived'), call('purge-owner-blocked', owner.id, purge.id, 'blocked'),
    call('decommission-owner-blocked', owner.id, decommission.id, 'blocked'),
    canary('exact-canary-match', owner.id, a.id, 'ready'), canary('exact-canary-actor-mismatch', teacher.id, a.id, 'disabled'),
    canary('exact-canary-classroom-mismatch', owner.id, b.id, 'disabled'),
    call('expired-entitlement', owner.id, a.id, 'disabled', false, 'entitlement-expired'),
    call('revoked-entitlement', owner.id, a.id, 'disabled', false, 'entitlement-revoked'),
    call('deactivating-roster', owner.id, a.id, 'disabled', false, 'roster-deactivating'),
    call('restored-owner-policy', owner.id, a.id, 'ready', true, 'restore-baseline'),
  ])
}

// Closed table set: original rows are retained and compared by complete-row digest.
// Synthetic graph equality is checked as complete rows, not selected fields.
function graphSql(f: AttendancePolicyFixture, synthetic: boolean) {
  const actors = f.actors.map(a => quote(a.id)).join(','), classes = f.classes.map(c => quote(c.id)).join(','), ops = f.operations.map(quote).join(',')
  const tables = [
    ['users', `id in (${actors})`], ['effective_feature_entitlements', `subject_user_id in (${actors})`],
    ['classrooms', `id in (${classes})`], ['classroom_enrollments', `classroom_id in (${classes})`],
    ['classroom_archive_revisions', `classroom_id in (${classes})`], ['gradebook_categories', `classroom_id in (${classes})`],
    ['gradebook_settings', `classroom_id in (${classes})`], ['attendance_teacher_entitlements', `teacher_id in (${actors})`],
    ['attendance_window_policies', `classroom_id in (${classes})`], ['attendance_roster_mappings', `classroom_id in (${classes})`],
    ['classroom_purge_operations', `id in (${ops})`], ['classroom_purge_fences', `classroom_id in (${classes})`],
    ['attendance_decommission_operations', `id in (${ops})`],
  ]
  return `jsonb_build_object(${tables.map(([table, predicate]) => `${quote(table)},coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.${table} r where ${synthetic ? '' : 'not '}(${predicate})),'[]'::jsonb)`).join(',')})`
}
export function attendancePolicySqlDescriptors(f: AttendancePolicyFixture): readonly AttendancePolicySqlDescriptor[] {
  assertAttendancePolicyFixture(f)
  const q = quote, owner = q(f.actors[0].id), a = q(f.classes[0].id), purge = q(f.classes[3].id), decommission = q(f.classes[4].id)
  const original = `encode(extensions.digest((${graphSql(f, false)})::text,'sha256'),'hex')`
  const prefix = "begin;set local lock_timeout='1s';set local statement_timeout='8s';"
  const stage = (name: string) => `commit;select jsonb_build_object('stage',${q(name)},'nativeVerified',false);`
  const restoreEntitlement = `update public.attendance_teacher_entitlements e set (status,valid_from,valid_until,revision,source,created_at,updated_at)=
    (select r.status,r.valid_from,r.valid_until,r.revision,r.source,r.created_at,r.updated_at from ${f.baseline} b,
    lateral jsonb_populate_recordset(null::public.attendance_teacher_entitlements,b.graph->'attendance_teacher_entitlements') r where r.teacher_id=e.teacher_id) where e.teacher_id=${owner};`
  const setup = `${prefix}
  do $collision$ begin if to_regclass(${q(f.baseline)}) is not null
    or exists(select 1 from public.users where id in (${f.allocatedIds.map(q).join(',')}))
    or exists(select 1 from public.classrooms where id in (${f.allocatedIds.map(q).join(',')}))
    or exists(select 1 from public.classroom_purge_operations where id in (${f.operations.map(q).join(',')}))
    or exists(select 1 from public.attendance_decommission_operations where id in (${f.operations.map(q).join(',')})) then raise exception 'attendance_fixture_collision';end if;end;$collision$;
  create table ${f.baseline}(singleton boolean primary key check(singleton),original_sha256 text not null,graph jsonb);
  revoke all on ${f.baseline} from public,anon,authenticated,service_role;
  insert into ${f.baseline} values(true,${original},null);
  insert into public.users(id,email,role) values ${f.actors.map(r => `(${q(r.id)},${q(r.email)},${q(r.role)})`).join(',')};
  insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision)
    values ${f.actors.filter((_, n) => [0,1,4].includes(n)).map(r => `(${q(r.id)},'classrooms.create','manual',true,'2020-01-01',10,1)`).join(',')}
    on conflict(subject_user_id,feature_key) do update set enabled=true,quota_limit=10,starts_at='2020-01-01',expires_at=null;
  insert into public.classrooms(id,teacher_id,title,class_code) values ${f.classes.map((r, n) => `(${q(r.id)},${q(n === 0 ? f.actors[4].id : r.owner)},${q(f.tag)},${q(r.code)})`).join(',')};
  update public.classrooms set teacher_id=${owner} where id=${a};
  insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(e => `(${q(e.id)},${q(e.classroomId)},${q(e.actorId)})`).join(',')};
  update public.classrooms set archived_at='2026-10-19T00:00:00Z' where id=${q(f.classes[2].id)};
  insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source) values
    (${owner},'active','2020-01-01',1,'native_fixture'),(${q(f.actors[1].id)},'active','2020-01-01',1,'native_fixture');
  insert into public.attendance_window_policies(classroom_id,opens_local,closes_local,close_day_offset,entry_opens_minutes_before,present_grace_minutes,entry_closes_minutes_before_end,absent_minutes_before_end,enabled,policy_revision,updated_at)
    values(${a},'09:05','10:25',0,11,7,9,4,true,7,${q(f.policy.updated_at)});
  insert into public.attendance_roster_mappings(classroom_id,roster_ref) values(${a},'roster_${f.classes[0].id.replaceAll('-', '')}');
  insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary)
    values(${q(f.operations[0])},${owner},${purge},'${'0'.repeat(64)}',1,'{}');
  insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values(${purge},${q(f.operations[0])},${owner});
  insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,installation_ref,roster_ref,actor_principal_ref)
    values(${q(f.operations[1])},${decommission},${owner},'native_fixture','roster_${f.classes[4].id.replaceAll('-', '')}','principal_${f.actors[0].id.replaceAll('-', '')}');
  update ${f.baseline} set graph=${graphSql(f, true)};${stage('setup')}`
  const expired = `${prefix}update public.attendance_teacher_entitlements set valid_from='2020-01-01',valid_until='2020-01-02' where teacher_id=${owner};${stage('entitlement-expired')}`
  const revoked = `${prefix}${restoreEntitlement}update public.attendance_teacher_entitlements set status='revoked' where teacher_id=${owner};${stage('entitlement-revoked')}`
  const deactivating = `${prefix}${restoreEntitlement}update public.attendance_roster_mappings set integration_state='deactivating' where classroom_id=${a};${stage('roster-deactivating')}`
  const restore = `${prefix}${restoreEntitlement}update public.attendance_roster_mappings e set (integration_state,updated_at)=
    (select r.integration_state,r.updated_at from ${f.baseline} b,lateral jsonb_populate_recordset(null::public.attendance_roster_mappings,b.graph->'attendance_roster_mappings') r where r.classroom_id=e.classroom_id) where e.classroom_id=${a};
    do $restore$ begin if (${graphSql(f, true)}) is distinct from (select graph from ${f.baseline}) then raise exception 'attendance_graph_restore_mismatch';end if;end;$restore$;${stage('restore-baseline')}`
  const preservation = `begin read only;set local statement_timeout='8s';select jsonb_build_object('sourcePreserved',(${graphSql(f, true)}) is not distinct from (select graph from ${f.baseline}),
    'originalsPreserved',${original} is not distinct from (select original_sha256 from ${f.baseline}),'nativeVerified',false);rollback;`
  const witness = `begin read only;set local statement_timeout='8s';select jsonb_build_object('studentOwner',exists(select 1 from public.classrooms c join public.users u on u.id=c.teacher_id where c.id=${a} and u.id=${owner} and u.role='student'),
    'selfEnrollment',exists(select 1 from public.classroom_enrollments where classroom_id=${a} and student_id=${owner}),
    'policyRows',(select count(*) from public.attendance_window_policies where classroom_id in (${f.classes.map(c => q(c.id)).join(',')})),'nativeVerified',false);rollback;`
  return attendancePolicyFreeze(([
    ['setup', setup], ['entitlement-expired', expired], ['entitlement-revoked', revoked], ['roster-deactivating', deactivating],
    ['restore-baseline', restore], ['witness', witness], ['preservation', preservation],
  ] as const).map(([name, sql]) => { assert(Buffer.byteLength(sql) <= ATTENDANCE_POLICY_CAPS.sqlBytes); return { name, profile: 'baseline-off' as const, sql, sha256: attendancePolicyHash(sql), nativeVerified: false as const } }))
}
export function assertAttendancePolicySqlDescriptor(f: AttendancePolicyFixture, frame: AttendancePolicySqlDescriptor) {
  const expected = attendancePolicySqlDescriptors(f).find(candidate => candidate.name === frame.name)
  assert(expected); assert.deepEqual(frame, expected)
}
