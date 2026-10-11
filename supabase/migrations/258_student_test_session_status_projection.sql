-- A read-only compact projection for the authenticated student polling route.
-- No draft/answer JSON or response text leaves the database. Domain decisions
-- (availability, submission/return/closure status) remain in the shared TS code.
begin;

create function public.get_student_test_session_status_projection(
  p_student_id uuid,
  p_test_id text
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $function$
declare
  v_test_id uuid;
  v_test record;
  v_snapshot jsonb;
  -- ECMAScript String.trim WhiteSpace + LineTerminator set, as in migration 250.
  v_trim_chars text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  begin
    v_test_id := p_test_id::uuid;
  exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('ok',false,'status',404,'error','Test not found');
  end;

  select t.id, t.classroom_id, t.status, c.archived_at
    into v_test from public.tests t
    join public.classrooms c on c.id=t.classroom_id
    where t.id=v_test_id;
  if not found then
    return pg_catalog.jsonb_build_object('ok',false,'status',404,'error','Test not found');
  end if;
  if v_test.archived_at is not null then
    return pg_catalog.jsonb_build_object('ok',false,'status',403,'error','Classroom is archived');
  end if;
  if not exists (select 1 from public.classroom_enrollments e
    where e.classroom_id=v_test.classroom_id and e.student_id=p_student_id) then
    return pg_catalog.jsonb_build_object('ok',false,'status',403,'error','Not enrolled in this classroom');
  end if;

  select pg_catalog.jsonb_build_object(
    'ok',true,'test',pg_catalog.jsonb_build_object('id',v_test.id,'status',v_test.status),
    'is_submitted',coalesce(a.is_submitted,false), 'returned_at',a.returned_at,
    'closed_for_grading_at',a.closed_for_grading_at,
    'access_state',s.state,
    'has_meaningful_response',exists (
      select 1 from public.test_responses r
      where r.test_id=v_test_id and r.student_id=p_student_id
      and case when r.selected_option is not null then r.selected_option >= 0
        else pg_catalog.length(pg_catalog.btrim(r.response_text,v_trim_chars)) > 0 end
    )
  ) into v_snapshot
  from (select 1) anchor
  left join public.test_attempts a on a.test_id=v_test_id and a.student_id=p_student_id
  left join public.test_student_availability s on s.test_id=v_test_id and s.student_id=p_student_id;
  return v_snapshot;
end;
$function$;
alter function public.get_student_test_session_status_projection(uuid,text) owner to postgres;
revoke all on function public.get_student_test_session_status_projection(uuid,text) from public, anon, authenticated;
grant execute on function public.get_student_test_session_status_projection(uuid,text) to service_role;
comment on function public.get_student_test_session_status_projection(uuid,text) is
  'Service-role-only student session-status projection; caller must freshly authenticate the supplied student.';

commit;
