-- Contextual owner-only day/session read. No provider operation or historical
-- learner-generation inference. Existing owner projection semantics are retained.
begin;
create function public.read_attendance_session_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_class_date date,
  p_runtime_integration text,
  p_scope_mode text,
  p_installation_ref text,
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
      -- Relationship precedes integration, roster and projection disclosure.
      when c.id is null or c.teacher_id is distinct from p_actor_id then 'forbidden'
      when p_actor_id is null or p_class_date is null
        or p_runtime_integration is null or p_runtime_integration not in ('disabled','not_configured','ready')
        or p_scope_mode is null or p_scope_mode not in ('exact_canary','teacher_entitlements')
        or (p_runtime_integration = 'ready' and (p_installation_ref is null or p_installation_ref !~ '^[A-Za-z0-9._~-]{1,128}$'))
        or coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
        or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
        or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off') = 'on'
        or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off') = 'on'
        or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off') = 'on'
        or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off') = 'on'
        or exists(select 1 from public.classroom_purge_fences f where f.classroom_id = c.id)
        or exists(select 1 from public.cold_classroom_purge_fences f where f.classroom_id = c.id)
        or exists(select 1 from public.attendance_decommission_operations d where d.classroom_id = c.id)
        then 'blocked'
      else 'ok' end as status, c.archived_at
    from (select 1) seed left join public.classrooms c on c.id = p_classroom_id
  ), access as materialized (
    select status, case
      when status <> 'ok' or archived_at is not null then 'disabled'
      when p_runtime_integration <> 'ready' then p_runtime_integration
      when p_scope_mode = 'exact_canary' then case
        when p_canary_actor_id = p_actor_id and p_canary_classroom_id = p_classroom_id then 'ready' else 'disabled' end
      -- Existing132 read scope; exact-canary reads intentionally require no grant.
      when public.get_attendance_classroom_access_v1(p_actor_id,p_classroom_id,pg_catalog.statement_timestamp())->>'state' = 'ready' then 'ready'
      else 'disabled' end as integration
    from decision
  ), roster as materialized (
    select e.id as enrollment_id, e.student_id as id, coalesce(u.email,'') as email,
      coalesce(p.first_name,'') as first_name, coalesce(p.last_name,'') as last_name
    from access a join public.classroom_enrollments e on a.status = 'ok' and e.classroom_id = p_classroom_id
    left join public.users u on u.id = e.student_id
    left join public.student_profiles p on p.user_id = e.student_id
  ), occurrence as materialized (
    select o.occurrence_ref,o.opens_at,o.closes_at,o.session_starts_at,o.session_ends_at,o.present_through_at,o.absent_at
    from access a join public.attendance_occurrence_mappings o
      on a.integration = 'ready' and o.classroom_id = p_classroom_id and o.class_date = p_class_date
  ), complete_occurrence as materialized (
    select o.occurrence_ref from occurrence o where o.opens_at is not null and o.closes_at is not null
      and o.session_starts_at is not null and o.session_ends_at is not null and o.present_through_at is not null and o.absent_at is not null
  ), payload as materialized (
    select pg_catalog.jsonb_build_object(
      'actor_id',p_actor_id,'classroom_id',p_classroom_id,'class_date',p_class_date,
      'runtime_integration',p_runtime_integration,'scope_mode',p_scope_mode,'installation_ref',p_installation_ref,
      'observed_at',pg_catalog.statement_timestamp(),'status',a.status,'integration',a.integration,
      -- Aggregate every current enrollment; no PostgREST page/1000-row limit.
      -- The adapter applies the exact existing JS email.localeCompare/id order.
      'students',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',r.id,'email',r.email,
        'first_name',r.first_name,'last_name',r.last_name) order by r.enrollment_id) from roster r),'[]'::jsonb),
      'rows',pg_catalog.jsonb_build_object(
        'participants',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('student_id',p.student_id,'participant_ref',p.participant_ref) order by p.student_id)
          from public.attendance_participant_mappings p where a.integration = 'ready' and p.classroom_id = p_classroom_id),'[]'::jsonb),
        'occurrence',(select pg_catalog.jsonb_build_object('occurrence_ref',o.occurrence_ref,'opens_at',o.opens_at,'closes_at',o.closes_at,
          'session_starts_at',o.session_starts_at,'session_ends_at',o.session_ends_at,'present_through_at',o.present_through_at,'absent_at',o.absent_at) from occurrence o),
        'policy',(select pg_catalog.jsonb_build_object('enabled',p.enabled) from public.attendance_window_policies p where a.integration = 'ready' and p.classroom_id = p_classroom_id),
        'session',(select pg_catalog.jsonb_build_object('occurrence_ref',s.occurrence_ref,'status',s.status,'opens_at',s.opens_at,'closes_at',s.closes_at,
          'session_revision',s.session_revision,'updated_at',s.updated_at) from public.attendance_session_projection s
          join complete_occurrence o on s.occurrence_ref = o.occurrence_ref where s.installation_ref = p_installation_ref),
        'check_ins',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('student_id',f.student_id,'check_in_ref',f.check_in_ref,
          'check_in_revision',f.check_in_revision,'accepted_at',f.accepted_at,'invalidated_at',f.invalidated_at,'updated_at',f.updated_at) order by f.check_in_ref)
          from public.attendance_check_in_facts f join complete_occurrence o on f.occurrence_ref = o.occurrence_ref where f.installation_ref = p_installation_ref),'[]'::jsonb),
        'overrides',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('student_id',v.student_id,'status',v.status,'active',v.active,
          'revision',v.revision,'updated_at',v.updated_at) order by v.student_id) from public.attendance_status_overrides v
          join complete_occurrence o on v.occurrence_ref = o.occurrence_ref where v.classroom_id = p_classroom_id),'[]'::jsonb),
        -- Existing classroom-wide queue semantics and V1 validation remain in
        -- the server converter. These payloads never enter the browser DTO.
        'outbox',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('message_type',b.message_type,'payload',b.payload,'status',b.status,
          'lease_expires_at',b.lease_expires_at,'updated_at',b.updated_at) order by b.id) from public.attendance_integration_outbox b
          where exists(select 1 from complete_occurrence) and b.classroom_id = p_classroom_id and b.status in ('pending','processing','non_retryable')),'[]'::jsonb)
      )
    ) as result from access a
  )
  -- Fail closed rather than truncate an otherwise complete roster/projection.
  select case when pg_catalog.octet_length(pg_catalog.convert_to(result::text,'UTF8')) <= 8388608 then result else null end from payload;
$function$;
alter function public.read_attendance_session_for_owner_v1(uuid,uuid,date,text,text,text,uuid,uuid) owner to postgres;
revoke all on function public.read_attendance_session_for_owner_v1(uuid,uuid,date,text,text,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_attendance_session_for_owner_v1(uuid,uuid,date,text,text,text,uuid,uuid) to service_role;
comment on function public.read_attendance_session_for_owner_v1(uuid,uuid,date,text,text,text,uuid,uuid) is
  'Service-only owner attendance session snapshot. No grants, provider commands, history mutations or learner-generation attribution.';
commit;
