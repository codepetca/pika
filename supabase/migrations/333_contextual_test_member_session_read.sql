-- Additive contextual poll boundary. Authority and own status share one MVCC
-- statement snapshot. No exclusive/advisory/row locks or writes; a committed
-- revocation is observed by the next poll. Existing write protocols are intact.
begin;
create function public.read_test_session_for_member_v1(
  p_actor_id uuid, p_test_id uuid, p_deadline timestamptz
) returns jsonb
language sql stable security definer
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
  with parent as materialized (
    select t.id, t.classroom_id, t.status, t.blueprint_archived_at,
      c.teacher_id, c.archived_at, c.feature_visibility
    from public.tests t join public.classrooms c on c.id = t.classroom_id
    where t.id = p_test_id
  ), authority as materialized (
    select p.classroom_id, p.status as test_status,
      case
        when p_actor_id is null or p_test_id is null or p_deadline is null
          or not pg_catalog.isfinite(p_deadline)
          or p_deadline > pg_catalog.clock_timestamp() + interval '30 seconds'
          or pg_catalog.clock_timestamp() >= p_deadline
          or not exists(select 1 from public.managed_storage_settings where singleton)
          then 'unavailable'
        when p.id is null then 'not_found'
        when not exists(select 1 from public.users where id = p_actor_id)
          or p.teacher_id = p_actor_id or p.archived_at is not null
          or (pg_catalog.jsonb_typeof(p.feature_visibility) = 'object'
            and p.feature_visibility->'tests' = 'false'::jsonb)
          or not exists(select 1 from public.classroom_enrollments e
            where e.classroom_id = p.classroom_id and e.student_id = p_actor_id)
          then 'forbidden'
        when coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
          or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
          or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off') = 'on'
          or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off') = 'on'
          or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off') = 'on'
          or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off') = 'on'
          -- Read the same lifecycle fences as guard_classroom_purge_lifecycle,
          -- without invoking its exclusive classroom advisory-lock protocol.
          or exists(select 1 from public.classroom_purge_fences f where f.classroom_id = p.classroom_id)
          or exists(select 1 from public.cold_classroom_purge_fences f where f.classroom_id = p.classroom_id)
          or exists(select 1 from public.attendance_decommission_operations d where d.classroom_id = p.classroom_id)
          or exists(select 1 from public.student_purge_operations operation
            join private.student_provider_cleanup_bindings binding on binding.operation_id = operation.id
            where operation.classroom_id = p.classroom_id and operation.student_id = p_actor_id
              and operation.status <> 'completed') then 'forbidden'
        when p.status = 'draft' or p.blueprint_archived_at is not null then 'not_found'
        else 'ok'
      end as outcome
    from (select 1) seed left join parent p on true
  ), own_state as materialized (
    select a.classroom_id, a.test_status, coalesce(t.is_submitted,false) as is_submitted,
      t.returned_at, t.closed_for_grading_at, s.state as access_state,
      -- Preserve the current contextual263 response predicate, including
      -- selected option zero and PostgreSQL btrim's space-only behavior.
      coalesce(t.is_submitted,false) or (t.closed_for_grading_at is null and exists(
        select 1 from public.test_responses r where r.test_id = p_test_id and r.student_id = p_actor_id
          and (r.selected_option is not null or pg_catalog.length(pg_catalog.btrim(coalesce(r.response_text,''))) > 0)
      )) as has_submitted
    from authority a
    left join public.test_attempts t on t.test_id = p_test_id and t.student_id = p_actor_id
    left join public.test_student_availability s on s.test_id = p_test_id and s.student_id = p_actor_id
    where a.outcome = 'ok'
  ), decision as materialized (
    select a.classroom_id,
      case when a.outcome <> 'ok' then a.outcome
        when not (coalesce(o.access_state,case when o.test_status = 'active' then 'open' else 'closed' end) = 'open'
          and not o.has_submitted and o.returned_at is null and o.closed_for_grading_at is null)
          and not (o.has_submitted or o.returned_at is not null or o.closed_for_grading_at is not null)
          and o.access_state is null then 'not_found'
        else 'ok' end as outcome,
      pg_catalog.jsonb_build_object('test_status',o.test_status,'is_submitted',o.is_submitted,
        'returned_at',o.returned_at,'closed_for_grading_at',o.closed_for_grading_at,
        'access_state',o.access_state,'has_submitted',o.has_submitted) as projection
    from authority a left join own_state o on true
  )
  select pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'test_id',p_test_id,
    'classroom_id',d.classroom_id,
    'outcome',case when pg_catalog.clock_timestamp() >= p_deadline then 'unavailable' else d.outcome end,
    'projection',case when d.outcome = 'ok' and pg_catalog.clock_timestamp() < p_deadline then d.projection else null end)
  from decision d;
$function$;
alter function public.read_test_session_for_member_v1(uuid,uuid,timestamptz) owner to postgres;
revoke all on function public.read_test_session_for_member_v1(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.read_test_session_for_member_v1(uuid,uuid,timestamptz) to service_role;
comment on function public.read_test_session_for_member_v1(uuid,uuid,timestamptz) is
  'Service-only contextual member session snapshot. Caller freshly authenticates actor; no answers, documents, peers, writes or exclusive locks.';
commit;
