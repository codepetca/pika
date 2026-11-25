-- Compute the mixed-role learner's sidebar state in one statement snapshot.
-- The server authenticates the actor and checks classroom-experience admission.
begin;

create function public.read_student_notification_counts_v1(
  p_actor_id uuid,
  p_classroom_id uuid
) returns jsonb
language sql stable security invoker
set search_path = ''
as $function$
  with request_time as (
    select date_trunc('milliseconds', statement_timestamp()) as cutoff
  )
  select coalesce((
    select case
      when p_actor_id is null or c.teacher_id = p_actor_id or c.archived_at is not null
        or not exists (
          select 1 from public.classroom_enrollments e
          where e.classroom_id = c.id and e.student_id = p_actor_id
        )
      then jsonb_build_object('ok', false, 'status', 403)
      when not case jsonb_typeof(c.feature_visibility)
        when 'object' then (
          -- jsonb text adds one space after each colon and comma. The existing
          -- reader's 4096-byte bound is on compact JSON.
          select coalesce(bool_and(jsonb_typeof(flag.value) = 'boolean'), true)
            and octet_length(c.feature_visibility::text) - greatest(2 * count(*) - 1, 0) <= 4096
          from jsonb_each(c.feature_visibility) flag
        )
        else c.feature_visibility is null
      end
      then jsonb_build_object('ok', false, 'status', 503)
      else jsonb_build_object(
        'ok', true,
        'hasTodayEntry', not exists (
          select 1 from public.class_days d
          where d.classroom_id = c.id and d.date = local_day.today and d.is_class_day
        ) or exists (
          select 1 from public.entries e
          where e.classroom_id = c.id and e.student_id = p_actor_id and e.date = local_day.today
        ),
        'unviewedAssignmentsCount', case when c.feature_visibility -> 'classwork' = 'false'::jsonb
          then 0 else (
            select count(*)
            from public.assignments a
            left join public.assignment_docs d on d.assignment_id = a.id and d.student_id = p_actor_id
            where a.classroom_id = c.id and not a.is_draft
              and (a.released_at is null or a.released_at <= rt.cutoff)
              and (d.viewed_at is null or greatest(
                date_trunc('milliseconds', d.returned_at),
                date_trunc('milliseconds', d.feedback_returned_at)
              ) > date_trunc('milliseconds', d.viewed_at))
          ) end,
        'activeTestsCount', case when c.feature_visibility -> 'tests' = 'false'::jsonb
          then 0 else (
            select count(*)
            from public.tests t
            left join public.test_student_availability s on s.test_id = t.id and s.student_id = p_actor_id
            where t.classroom_id = c.id and t.status in ('active', 'closed')
              and coalesce(s.state = 'open', t.status = 'active')
              and not exists (
                select 1 from public.test_attempts a
                where a.test_id = t.id and a.student_id = p_actor_id
                  and (a.is_submitted or a.closed_for_grading_at is not null)
              )
              and not exists (
                select 1 from public.test_responses r
                where r.test_id = t.id and r.student_id = p_actor_id
                  and case when r.selected_option is not null then r.selected_option >= 0
                    -- ECMAScript String.trim whitespace, as in migration 258.
                    else length(btrim(r.response_text,
                      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0 end
              )
          ) end,
        'unreadAnnouncementsCount', case when c.feature_visibility -> 'announcements' = 'false'::jsonb
          then 0 else (
            select count(*) from public.announcements a
            where a.classroom_id = c.id and not a.is_draft
              and (a.scheduled_for is null or a.scheduled_for <= rt.cutoff)
              and not exists (
                select 1 from public.announcement_reads r
                where r.announcement_id = a.id and r.user_id = p_actor_id
              )
          ) end
      )
    end
    from public.classrooms c
    cross join request_time rt
    cross join lateral (select (rt.cutoff at time zone 'America/Toronto')::date as today) local_day
    where c.id = p_classroom_id
  ), jsonb_build_object('ok', false, 'status', 404));
$function$;

revoke all on function public.read_student_notification_counts_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_student_notification_counts_v1(uuid, uuid) to service_role;

commit;
