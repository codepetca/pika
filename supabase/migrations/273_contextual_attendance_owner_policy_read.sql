-- Dormant owner policy projection. No role, entitlement, provider or rollout mutation.
begin;

--153 intentionally withheld the operational ledger. The invoker needs only its
--classroom fence identity, never installation/principal/provider fields.
grant select (classroom_id) on public.attendance_decommission_operations to service_role;

create function public.read_attendance_policy_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_scope_mode text,
  p_canary_actor_id uuid default null,
  p_canary_classroom_id uuid default null
) returns jsonb
language sql stable security invoker
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
  with decision as materialized (
    select case
      when p_actor_id is null or p_classroom_id is null
        or p_scope_mode is null or p_scope_mode not in ('exact_canary', 'teacher_entitlements') then 'blocked'
      when c.id is null or c.teacher_id is distinct from p_actor_id then 'forbidden'
      when c.archived_at is not null then 'archived'
      when coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
        or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false)
        or coalesce(pg_catalog.current_setting('pika.identity_mapping', true), 'off') = 'on'
        or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize', true), 'off') = 'on'
        or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize', true), 'off') = 'on'
        or coalesce(pg_catalog.current_setting('pika.student_purge_finalize', true), 'off') = 'on'
        or exists (select 1 from public.classroom_purge_fences f where f.classroom_id = c.id)
        or exists (select 1 from public.cold_classroom_purge_fences f where f.classroom_id = c.id)
        or exists (select 1 from public.attendance_decommission_operations d where d.classroom_id = c.id)
        then 'blocked'
      when p_scope_mode = 'exact_canary' then case
        when p_canary_actor_id = p_actor_id and p_canary_classroom_id = p_classroom_id then 'ready'
        else 'disabled' end
      --132's STABLE helper retains the exact entitlement validity and roster
      --policy in this same statement snapshot. It creates no grants/mappings.
      when public.get_attendance_classroom_access_v1(p_actor_id, p_classroom_id, pg_catalog.statement_timestamp())->>'state' = 'ready' then 'ready'
      else 'disabled'
    end as status
    from (select 1) seed
    left join public.classrooms c on c.id = p_classroom_id
  ), payload as materialized (
    select pg_catalog.jsonb_build_object(
      'actor_id', p_actor_id, 'classroom_id', p_classroom_id, 'scope_mode', p_scope_mode,
      'status', decision.status,
      'policy', case when decision.status = 'ready' then (
        select pg_catalog.jsonb_build_object(
          'classroom_id', p.classroom_id, 'timezone', p.timezone,
          'opens_local', p.opens_local, 'closes_local', p.closes_local,
          'close_day_offset', p.close_day_offset,
          'entry_opens_minutes_before', p.entry_opens_minutes_before,
          'present_grace_minutes', p.present_grace_minutes,
          'entry_closes_minutes_before_end', p.entry_closes_minutes_before_end,
          'absent_minutes_before_end', p.absent_minutes_before_end,
          'enabled', p.enabled, 'policy_revision', p.policy_revision, 'updated_at', p.updated_at
        ) from public.attendance_window_policies p where p.classroom_id = p_classroom_id
      ) else null end
    ) as result from decision
  )
  select case when pg_catalog.octet_length(pg_catalog.convert_to(result::text, 'UTF8')) > 4096
    then null else result end from payload;
$function$;

alter function public.read_attendance_policy_for_owner_v1(uuid,uuid,text,uuid,uuid) owner to postgres;
revoke all on function public.read_attendance_policy_for_owner_v1(uuid,uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_attendance_policy_for_owner_v1(uuid,uuid,text,uuid,uuid) to service_role;
comment on function public.read_attendance_policy_for_owner_v1(uuid,uuid,text,uuid,uuid) is
  'Service-only current-owner attendance policy snapshot; scope parameters are server-owned. No attendance grant or provider operation.';
commit;
