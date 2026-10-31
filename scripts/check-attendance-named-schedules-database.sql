-- SOURCE ONLY. Run with psql ON_ERROR_STOP on an explicitly authorized isolated
-- local target already containing migration 296. This script does not apply it.
-- All synthetic rows, changes to settings, and operations are transaction-local.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '45s';

do $catalog$
declare r text; f text;
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='296') then
    raise exception 'Migration 296 must already be present on the approved isolated target';
  end if;
  foreach f in array array[
    'public.read_attendance_schedules_for_owner_v1(uuid,uuid,text,date,uuid,uuid)',
    'public.mutate_attendance_schedule_v1(uuid,uuid,text,uuid,date,text,jsonb,bigint)'] loop
    if has_function_privilege('anon',f,'execute') or has_function_privilege('authenticated',f,'execute')
      or not has_function_privilege('service_role',f,'execute') then
      raise exception 'Unexpected function ACL: %',f;
    end if;
  end loop;
  foreach r in array array['attendance_named_schedules','attendance_day_schedules'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=r and c.relrowsecurity)
      or has_table_privilege('anon','public.'||r,'select,insert,update,delete')
      or has_table_privilege('authenticated','public.'||r,'select,insert,update,delete')
      or has_table_privilege('service_role','public.'||r,'insert,update,delete')
      or not has_table_privilege('service_role','public.'||r,'select') then
      raise exception 'Unexpected table ACL or RLS: %',r;
    end if;
  end loop;
end;
$catalog$;

-- The owner has a student label intentionally: ownership and a pre-existing
-- grant, not a role label or membership, authorize the contextual workflow.
insert into public.users(id,email,role) values
 ('f2960000-0000-4000-8000-000000000001','named-owner@example.invalid','student'),
 ('f2960000-0000-4000-8000-000000000002','named-other@example.invalid','teacher');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('f2960000-0000-4000-8000-000000000010','f2960000-0000-4000-8000-000000000001','Named A','N296A'),
 ('f2960000-0000-4000-8000-000000000011','f2960000-0000-4000-8000-000000000002','Named B','N296B');
insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source) values
 ('f2960000-0000-4000-8000-000000000001','active',now()-interval '1 day',1,'synthetic-test');
insert into public.attendance_window_policies(classroom_id,opens_local,closes_local) values
 ('f2960000-0000-4000-8000-000000000010','09:00','10:00'),
 ('f2960000-0000-4000-8000-000000000011','09:00','10:00');
insert into public.class_days(classroom_id,date,is_class_day)
 select c,d,true from unnest(array['f2960000-0000-4000-8000-000000000010'::uuid,
   'f2960000-0000-4000-8000-000000000011'::uuid]) c
 cross join unnest(array[(now() at time zone 'America/Toronto')::date+30,
   (now() at time zone 'America/Toronto')::date+31]) d;

set local role service_role;
do $owner_matrix$
declare
 a uuid:='f2960000-0000-4000-8000-000000000001'; b uuid:='f2960000-0000-4000-8000-000000000002';
 c uuid:='f2960000-0000-4000-8000-000000000010'; other uuid:='f2960000-0000-4000-8000-000000000011';
 day date:=(now() at time zone 'America/Toronto')::date+30;
 p jsonb:='{"session_starts_local":"08:45","session_ends_local":"09:45","session_end_day_offset":0,"entry_opens_minutes_before":10,"present_grace_minutes":5,"entry_closes_minutes_before_end":5,"absent_minutes_before_end":0}';
 s uuid; v jsonb; state text;
begin
  v:=public.read_attendance_schedules_for_owner_v1(a,c,'teacher_entitlements',day,null,null);
  if v->>'status' is distinct from 'ready' or v->'selected_id' is distinct from 'null'::jsonb
    or v->'schedules' is distinct from '[]'::jsonb or (v->'policy'->>'policy_revision')::int<>1 then
    raise exception 'Regular schedule snapshot mismatch: %',v;
  end if;
  v:=public.mutate_attendance_schedule_v1(a,c,'upsert',null,null,'Short day',p,1);
  s:=(v->>'id')::uuid;
  if s is null or (v->>'revision')::int<>2 then raise exception 'Schedule create failed: %',v; end if;
  v:=public.mutate_attendance_schedule_v1(a,c,'assign',s,day,null,null,2);
  if (v->>'revision')::int<>3 or v->>'id'<>s::text then raise exception 'Assignment failed'; end if;
  v:=public.read_attendance_schedules_for_owner_v1(a,c,'teacher_entitlements',day,null,null);
  if v->>'status' is distinct from 'ready' or v->>'selected_id' is distinct from s::text
    or jsonb_array_length(v->'schedules')<>1 or v->'schedules'->0->'policy' is distinct from p then
    raise exception 'Named schedule snapshot mismatch: %',v;
  end if;
  state:=null;
  begin perform public.mutate_attendance_schedule_v1(a,c,'assign',null,day,null,null,2);
  exception when others then get stacked diagnostics state=returned_sqlstate; end;
  if state is distinct from '40001' then raise exception 'Stale revision was not rejected: %',state; end if;
  state:=null;
  begin perform public.mutate_attendance_schedule_v1(b,c,'assign',null,day,null,null,3);
  exception when others then get stacked diagnostics state=returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'Cross-owner mutation was not rejected: %',state; end if;
  state:=null;
  begin perform public.mutate_attendance_schedule_v1(a,other,'assign',s,day,null,null,1);
  exception when others then get stacked diagnostics state=returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'Cross-class mutation was not rejected: %',state; end if;
  v:=public.read_attendance_schedules_for_owner_v1(b,c,'teacher_entitlements',day,null,null);
  if v->>'status' is distinct from 'forbidden' or v->'schedules' is distinct from '[]'::jsonb
    or v->'policy' is distinct from 'null'::jsonb or v->'selected_id' is distinct from 'null'::jsonb then
    raise exception 'Cross-owner read leaked data: %',v;
  end if;
  v:=public.read_attendance_schedules_for_owner_v1(a,c,'exact_canary',day,b,c);
  if v->>'status' is distinct from 'disabled' or v->'schedules' is distinct from '[]'::jsonb then
    raise exception 'Canary read not fenced: %',v;
  end if;
  v:=public.mutate_attendance_schedule_v1(a,c,'assign',null,day,null,null,3);
  if v->'id' is distinct from 'null'::jsonb or (v->>'revision')::int<>4 then raise exception 'Default selection failed'; end if;
  v:=public.read_attendance_schedules_for_owner_v1(a,c,'teacher_entitlements',day,null,null);
  if v->'selected_id' is distinct from 'null'::jsonb then raise exception 'Default selection not read'; end if;
  perform public.mutate_attendance_schedule_v1(a,c,'assign',s,day,null,null,4);
end;
$owner_matrix$;
reset role;

-- A frozen occurrence must resist reassignment even on a future class date.
savepoint frozen_fixture;
insert into public.attendance_occurrence_mappings(classroom_id,class_date,policy_frozen_at)
 values('f2960000-0000-4000-8000-000000000010',(now() at time zone 'America/Toronto')::date+30,now());
set local role service_role;
do $frozen$
declare state text; v jsonb; day date:=(now() at time zone 'America/Toronto')::date+30;
begin
  begin perform public.mutate_attendance_schedule_v1('f2960000-0000-4000-8000-000000000001',
    'f2960000-0000-4000-8000-000000000010','assign',null,day,null,null,5);
  exception when others then get stacked diagnostics state=returned_sqlstate; end;
  if state is distinct from '40001' then raise exception 'Frozen assignment not rejected: %',state; end if;
  v:=public.read_attendance_schedules_for_owner_v1('f2960000-0000-4000-8000-000000000001',
    'f2960000-0000-4000-8000-000000000010','teacher_entitlements',day,null,null);
  if v->'selected_id' is null or v->'selected_id'='null'::jsonb or (v->'policy'->>'policy_revision')::int<>5 then
    raise exception 'Frozen rejection changed selection or revision';
  end if;
end;
$frozen$;
reset role;
rollback to frozen_fixture;

savepoint revoked;
update public.attendance_teacher_entitlements set status='revoked' where teacher_id='f2960000-0000-4000-8000-000000000001';
set local role service_role;
do $no_entitlement$
declare v jsonb; state text;
begin
  v:=public.read_attendance_schedules_for_owner_v1('f2960000-0000-4000-8000-000000000001',
    'f2960000-0000-4000-8000-000000000010','teacher_entitlements',(now() at time zone 'America/Toronto')::date+30,null,null);
  if v->>'status' is distinct from 'disabled' or v->'schedules' is distinct from '[]'::jsonb then raise exception 'Revoked read leaked data'; end if;
  begin perform public.mutate_attendance_schedule_v1('f2960000-0000-4000-8000-000000000001',
    'f2960000-0000-4000-8000-000000000010','assign',null,(now() at time zone 'America/Toronto')::date+31,null,null,5);
  exception when others then get stacked diagnostics state=returned_sqlstate; end;
  if state is distinct from '42501' then raise exception 'Revoked write not rejected: %',state; end if;
end;
$no_entitlement$;
reset role;
rollback to revoked;

-- Synthetic already-verified remote deletion; no provider call is made. Start at
-- phase 13 to exercise the new pre-finalization cleanup with an in-flight op.
update public.classrooms set archived_at=now() where id='f2960000-0000-4000-8000-000000000010';
update public.attendance_decommission_settings set mode='canary',installation_ref='fixture_296',
 canary_teacher_id='f2960000-0000-4000-8000-000000000001',canary_classroom_id='f2960000-0000-4000-8000-000000000010';
insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,installation_ref,roster_ref,actor_principal_ref,state,phase)
 values('f2960000-0000-4000-8000-000000000020','f2960000-0000-4000-8000-000000000010',
 'f2960000-0000-4000-8000-000000000001','fixture_296','roster_fixture_296','principal_fixture_296','remote_deleted',13);
set local role service_role;
do $cleanup$
declare v jsonb; i integer;
begin
  for i in 1..20 loop
    v:=public.tick_attendance_decommission('f2960000-0000-4000-8000-000000000001',
      'f2960000-0000-4000-8000-000000000010','f2960000-0000-4000-8000-000000000020');
    exit when v->>'state'='local_deleted';
  end loop;
  if v->>'state' is distinct from 'local_deleted' then raise exception 'Decommission did not finish: %',v; end if;
end;
$cleanup$;
reset role;
do $absence$
begin
  if exists(select 1 from public.attendance_named_schedules where classroom_id='f2960000-0000-4000-8000-000000000010')
    or exists(select 1 from public.attendance_day_schedules where classroom_id='f2960000-0000-4000-8000-000000000010') then
    raise exception 'Named schedule decommission left rows behind';
  end if;
end;
$absence$;
rollback;
\echo 'PASS named attendance schedule database fixture (rolled back)'
