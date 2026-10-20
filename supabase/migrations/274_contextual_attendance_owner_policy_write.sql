-- Dormant owner policy write. Existing138 owns timing, revision and row mutation.
begin;

create function public.save_attendance_policy_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_scope_mode text, p_policy jsonb,
  p_canary_actor_id uuid default null, p_canary_classroom_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
declare
  v_classroom public.classrooms%rowtype;
  v_before public.attendance_window_policies%rowtype;
  v_after public.attendance_window_policies%rowtype;
  v_result jsonb;
  v_expected jsonb;
  v_key text;
  v_message text;
  v_expected_revision bigint;
  v_duration numeric;
begin
  if p_actor_id is null or p_classroom_id is null or p_scope_mode is null
    or p_scope_mode not in ('exact_canary','teacher_entitlements')
    or p_policy is null or pg_catalog.jsonb_typeof(p_policy) is distinct from 'object' then
    raise exception using errcode='PT400',message='attendance_policy_write_invalid';
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(p_policy)) <> 9
    or not p_policy ?& array['session_starts_local','session_ends_local','session_end_day_offset',
      'entry_opens_minutes_before','present_grace_minutes','entry_closes_minutes_before_end',
      'absent_minutes_before_end','enabled','expected_revision'] then
    raise exception using errcode='PT400',message='attendance_policy_write_invalid';
  end if;
  foreach v_key in array array['session_starts_local','session_ends_local'] loop
    if pg_catalog.jsonb_typeof(p_policy->v_key) is distinct from 'string'
      or (p_policy->>v_key) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using errcode='PT400',message='attendance_policy_write_invalid';
    end if;
  end loop;
  foreach v_key in array array['entry_opens_minutes_before','present_grace_minutes',
    'entry_closes_minutes_before_end','absent_minutes_before_end'] loop
    if pg_catalog.jsonb_typeof(p_policy->v_key) is distinct from 'number'
      or (p_policy->>v_key) !~ '^(0|[1-9][0-9]{0,2})$' then
      raise exception using errcode='PT400',message='attendance_policy_write_invalid';
    end if;
  end loop;
  if pg_catalog.jsonb_typeof(p_policy->'session_end_day_offset') is distinct from 'number'
    or (p_policy->>'session_end_day_offset') not in ('0','1')
    or pg_catalog.jsonb_typeof(p_policy->'enabled') is distinct from 'boolean'
    or (p_policy->>'entry_opens_minutes_before')::integer > 120 then
    raise exception using errcode='PT400',message='attendance_policy_write_invalid';
  end if;
  if p_policy->'expected_revision' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_policy->'expected_revision') is distinct from 'number'
      or (p_policy->>'expected_revision') !~ '^[1-9][0-9]{0,15}$'
      or (p_policy->>'expected_revision')::numeric > 9007199254740991 then
      raise exception using errcode='PT400',message='attendance_policy_write_invalid';
    end if;
    v_expected_revision := (p_policy->>'expected_revision')::bigint;
  end if;
  v_duration := extract(epoch from ((p_policy->>'session_ends_local')::time - (p_policy->>'session_starts_local')::time))/60
    + (p_policy->>'session_end_day_offset')::integer * 1440;
  if v_duration <= 0 or v_duration > 720
    or (p_policy->>'present_grace_minutes')::integer > 720
    or (p_policy->>'entry_closes_minutes_before_end')::integer > v_duration
    or (p_policy->>'absent_minutes_before_end')::integer > v_duration
    or (p_policy->>'present_grace_minutes')::integer >= v_duration - (p_policy->>'entry_closes_minutes_before_end')::integer
    or (p_policy->>'entry_closes_minutes_before_end')::integer < (p_policy->>'absent_minutes_before_end')::integer then
    raise exception using errcode='PT400',message='attendance_policy_write_invalid';
  end if;

  -- Same operation-before-classroom-row order as238. Never queue with a
  -- conflicting classroom row held; the inherited writer takes it reentrantly.
  if not public.classroom_purge_try_lock(p_classroom_id) then
    raise exception using errcode='PT409',message='attendance_policy_write_busy';
  end if;
  select c.* into v_classroom from public.classrooms c where c.id=p_classroom_id for update nowait;
  if not found or v_classroom.teacher_id is distinct from p_actor_id then
    raise exception using errcode='PT403',message='attendance_policy_write_forbidden';
  end if;
  if v_classroom.archived_at is not null then
    raise exception using errcode='PT403',message='attendance_policy_write_archived';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off')='on' then
    raise exception using errcode='PT503',message='attendance_policy_write_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);

  --132's setter and outbox protocol serialize entitlement revisions on this
  --exact actor key. The classroom row is already held, matching snapshot
  --writers; a competing lock is a conflict, never a hidden wait or retry.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_id::text,13220260823)) then
    raise exception using errcode='PT409',message='attendance_policy_write_busy';
  end if;
  perform 1 from public.attendance_teacher_entitlements e where e.teacher_id=p_actor_id for share nowait;
  perform 1 from public.attendance_roster_mappings r where r.classroom_id=p_classroom_id for share nowait;
  if not public.attendance_teacher_entitled_v1(p_actor_id,pg_catalog.statement_timestamp())
    or exists(select 1 from public.attendance_roster_mappings r
      where r.classroom_id=p_classroom_id and r.integration_state <> 'active')
    or (p_scope_mode='exact_canary' and
      (p_canary_actor_id is distinct from p_actor_id or p_canary_classroom_id is distinct from p_classroom_id)) then
    -- GET exact-canary readiness is not a writer entitlement.138 always
    --requires this grant, independent of historical users.role labels.
    raise exception using errcode='PT404',message='attendance_policy_write_disabled';
  end if;
  select p.* into v_before from public.attendance_window_policies p where p.classroom_id=p_classroom_id for update nowait;
  v_result := public.upsert_attendance_timing_policy_v1(
    p_actor_id,p_classroom_id,(p_policy->>'session_starts_local')::time,
    (p_policy->>'session_ends_local')::time,(p_policy->>'session_end_day_offset')::smallint,
    (p_policy->>'entry_opens_minutes_before')::integer,(p_policy->>'present_grace_minutes')::integer,
    (p_policy->>'entry_closes_minutes_before_end')::integer,(p_policy->>'absent_minutes_before_end')::integer,
    (p_policy->>'enabled')::boolean,v_expected_revision,pg_catalog.statement_timestamp()
  );
  select p.* into v_after from public.attendance_window_policies p where p.classroom_id=p_classroom_id;
  v_expected := p_policy - 'expected_revision' || pg_catalog.jsonb_build_object(
    'classroom_id',p_classroom_id,'timezone','America/Toronto',
    'revision',coalesce(v_before.policy_revision,0)+1,'updated_at',v_after.updated_at);
  if v_after.classroom_id is distinct from p_classroom_id or v_result is distinct from v_expected
    or v_after.policy_revision is distinct from coalesce(v_before.policy_revision,0)+1
    or v_after.timezone is distinct from 'America/Toronto'
    or (v_before.classroom_id is not null and v_after.created_at is distinct from v_before.created_at)
    or (pg_catalog.to_jsonb(v_after) - array['classroom_id','timezone','opens_local','closes_local','close_day_offset',
      'entry_opens_minutes_before','present_grace_minutes','entry_closes_minutes_before_end','absent_minutes_before_end',
      'enabled','policy_revision','created_at','updated_at']) <> '{}'::jsonb then
    raise exception using errcode='PT503',message='attendance_policy_write_postcondition';
  end if;
  return pg_catalog.jsonb_build_object('actor_id',p_actor_id,'classroom_id',p_classroom_id,
    'scope_mode',p_scope_mode,'policy',v_result);
exception when serialization_failure or deadlock_detected or lock_not_available then
  get stacked diagnostics v_message=message_text;
  if sqlstate='40001' and v_message not in ('classroom_operation_busy','attendance_policy_revision_conflict') then raise; end if;
  raise exception using errcode='PT409',message='attendance_policy_write_conflict';
when invalid_parameter_value then
  get stacked diagnostics v_message=message_text;
  if v_message not in ('attendance_policy_invalid','attendance_policy_timing_invalid') then raise; end if;
  raise exception using errcode='PT400',message='attendance_policy_write_invalid';
when insufficient_privilege then
  get stacked diagnostics v_message=message_text;
  if v_message='attendance_classroom_not_entitled' then
    raise exception using errcode='PT404',message='attendance_policy_write_disabled';
  elsif v_message in ('attendance_classroom_forbidden','attendance_classroom_archived') then
    raise exception using errcode='PT403',message='attendance_policy_write_forbidden';
  else raise;
  end if;
when sqlstate '55000' then
  get stacked diagnostics v_message=message_text;
  if v_message not in ('classroom_purge_active','attendance_decommission_active') then raise; end if;
  raise exception using errcode='PT503',message='attendance_policy_write_fenced';
end;
$function$;

alter function public.save_attendance_policy_for_owner_v1(uuid,uuid,text,jsonb,uuid,uuid) owner to postgres;
revoke all on function public.save_attendance_policy_for_owner_v1(uuid,uuid,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_attendance_policy_for_owner_v1(uuid,uuid,text,jsonb,uuid,uuid) to service_role;
comment on function public.save_attendance_policy_for_owner_v1(uuid,uuid,text,jsonb,uuid,uuid) is
  'Service-only locked current-owner wrapper of the unchanged138 timing writer; no grant, principal, outbox or provider operation.';
commit;
