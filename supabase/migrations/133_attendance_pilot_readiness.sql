-- Atomic, aggregate-only readiness inventory for the entitled-teacher pilot.
-- The operator transport permits only this exact read RPC in production.

create function public.get_attendance_pilot_readiness_v1(
  p_teacher_id uuid,
  p_at timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with effective_entitlement as (
    select 1
    from public.attendance_teacher_entitlements entitlement
    where entitlement.teacher_id = p_teacher_id
      and entitlement.status = 'active'
      and entitlement.valid_from <= p_at
      and (entitlement.valid_until is null or entitlement.valid_until > p_at)
  ),
  active_classrooms as (
    select classroom.id
    from public.classrooms classroom
    where classroom.teacher_id = p_teacher_id
      and classroom.archived_at is null
  ),
  configured_policies as (
    select policy.classroom_id, policy.enabled
    from public.attendance_window_policies policy
    join active_classrooms classroom on classroom.id = policy.classroom_id
  ),
  scoped_mappings as (
    select mapping.*
    from public.attendance_roster_mappings mapping
    join active_classrooms classroom on classroom.id = mapping.classroom_id
  )
  select jsonb_build_object(
    'effective_entitlement_count', (select count(*)::integer from effective_entitlement),
    'active_classrooms', (select count(*)::integer from active_classrooms),
    'configured_classrooms', (select count(*)::integer from configured_policies),
    'enabled_policies', (
      select count(*)::integer from configured_policies policy where policy.enabled
    ),
    'unconfigured_classrooms', (
      select count(*)::integer
      from active_classrooms classroom
      where not exists (
        select 1 from configured_policies policy
        where policy.classroom_id = classroom.id
      )
    ),
    'roster_mappings', (select count(*)::integer from scoped_mappings),
    'active_mappings', (
      select count(*)::integer
      from scoped_mappings mapping
      where mapping.integration_state = 'active'
    ),
    'fully_synced_configured_classrooms', (
      select count(*)::integer
      from configured_policies policy
      where exists (
        select 1
        from scoped_mappings mapping
        where mapping.classroom_id = policy.classroom_id
          and mapping.integration_state = 'active'
          and mapping.synced_revision is not null
          and mapping.synced_revision >= mapping.source_revision
          and mapping.schedule_synced_revision is not null
          and mapping.schedule_synced_revision >= mapping.schedule_source_revision
      )
    )
  );
$$;

revoke all on function public.get_attendance_pilot_readiness_v1(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_attendance_pilot_readiness_v1(uuid, timestamptz)
  to service_role;

comment on function public.get_attendance_pilot_readiness_v1(uuid, timestamptz) is
  'Returns one snapshot-consistent, identifier-free attendance pilot readiness aggregate.';
