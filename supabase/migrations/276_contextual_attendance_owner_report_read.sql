-- Daily Log-derived owner report. Independent of Bara rollout/provider state.
begin;
create function public.read_attendance_report_for_owner_v1(p_actor_id uuid,p_classroom_id uuid)
returns jsonb
language sql stable security invoker
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
  with decision as materialized (
    select case
      -- Missing and nonowner requests disclose no roster, days or entries.
      when c.id is null or c.teacher_id is distinct from p_actor_id then 'forbidden'
      when p_actor_id is null
        or coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
        or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
        or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off') = 'on'
        or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off') = 'on'
        or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off') = 'on'
        or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off') = 'on'
        or exists(select 1 from public.classroom_purge_fences f where f.classroom_id = c.id)
        or exists(select 1 from public.cold_classroom_purge_fences f where f.classroom_id = c.id)
        then 'blocked'
      -- Archived ownership intentionally remains readable, matching the report.
      else 'ok' end as status
    from (select 1) seed left join public.classrooms c on c.id = p_classroom_id
  ), roster as materialized (
    select e.id as enrollment_id,e.student_id as id,coalesce(u.email,'') as email,
      coalesce(p.first_name,'') as first_name,coalesce(p.last_name,'') as last_name
    from decision d join public.classroom_enrollments e on d.status = 'ok' and e.classroom_id = p_classroom_id
    left join public.users u on u.id = e.student_id
    left join public.student_profiles p on p.user_id = e.student_id
  ), payload as materialized (
    select pg_catalog.jsonb_build_object(
      'actor_id',p_actor_id,'classroom_id',p_classroom_id,'observed_at',pg_catalog.statement_timestamp(),'status',d.status,
      'students',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',r.id,'email',r.email,
        'first_name',r.first_name,'last_name',r.last_name) order by r.enrollment_id) from roster r),'[]'::jsonb),
      'class_days',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('classroom_id',c.classroom_id,
        'date',c.date,'is_class_day',c.is_class_day) order by c.date) from public.class_days c
        where d.status = 'ok' and c.classroom_id = p_classroom_id),'[]'::jsonb),
      'entries',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id,'classroom_id',e.classroom_id,
        'student_id',e.student_id,'date',e.date,'text',e.text) order by e.id) from public.entries e
        where d.status = 'ok' and e.classroom_id = p_classroom_id and exists(select 1 from roster r where r.id = e.student_id)),'[]'::jsonb)
    ) as result from decision d
  )
  -- Complete aggregation; oversized reports fail closed, never silently truncate.
  select case when pg_catalog.octet_length(pg_catalog.convert_to(result::text,'UTF8')) <= 8388608 then result else null end from payload;
$function$;
alter function public.read_attendance_report_for_owner_v1(uuid,uuid) owner to postgres;
revoke all on function public.read_attendance_report_for_owner_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_attendance_report_for_owner_v1(uuid,uuid) to service_role;
comment on function public.read_attendance_report_for_owner_v1(uuid,uuid) is
  'Service-only current-owner Daily Log attendance report snapshot; archived owners allowed; no provider or grant dependency, writes or learner-generation inference.';
commit;
