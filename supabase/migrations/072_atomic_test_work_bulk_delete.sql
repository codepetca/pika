-- Atomically delete selected students' test work for one test.

create or replace function public.delete_student_test_attempts_atomic(
  p_test_id uuid,
  p_student_ids uuid[]
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_requested_count integer := 0;
  v_student_ids uuid[] := array[]::uuid[];
  v_deleted_student_ids uuid[] := array[]::uuid[];
  v_deleted_student_count integer := 0;
  v_deleted_ai_items integer := 0;
  v_deleted_responses integer := 0;
  v_deleted_focus_events integer := 0;
  v_deleted_attempts integer := 0;
  v_deleted_ids uuid[] := array[]::uuid[];
begin
  with requested as (
    select distinct student_id
    from unnest(coalesce(p_student_ids, array[]::uuid[])) as requested(student_id)
  )
  select
    count(*),
    coalesce(array_agg(student_id), array[]::uuid[])
  into v_requested_count, v_student_ids
  from requested;

  if v_requested_count = 0 then
    return jsonb_build_object(
      'requested_count', 0,
      'deleted_student_count', 0,
      'deleted_attempts', 0,
      'deleted_responses', 0,
      'deleted_focus_events', 0,
      'deleted_ai_grading_items', 0
    );
  end if;

  with deleted_ai_items as (
    delete from public.test_ai_grading_run_items
    where test_id = p_test_id
      and student_id = any(v_student_ids)
    returning student_id
  )
  select
    count(*),
    coalesce(array_agg(distinct student_id), array[]::uuid[])
  into v_deleted_ai_items, v_deleted_ids
  from deleted_ai_items;
  v_deleted_student_ids := v_deleted_student_ids || v_deleted_ids;

  with deleted_responses as (
    delete from public.test_responses
    where test_id = p_test_id
      and student_id = any(v_student_ids)
    returning student_id
  )
  select
    count(*),
    coalesce(array_agg(distinct student_id), array[]::uuid[])
  into v_deleted_responses, v_deleted_ids
  from deleted_responses;
  v_deleted_student_ids := v_deleted_student_ids || v_deleted_ids;

  with deleted_focus_events as (
    delete from public.test_focus_events
    where test_id = p_test_id
      and student_id = any(v_student_ids)
    returning student_id
  )
  select
    count(*),
    coalesce(array_agg(distinct student_id), array[]::uuid[])
  into v_deleted_focus_events, v_deleted_ids
  from deleted_focus_events;
  v_deleted_student_ids := v_deleted_student_ids || v_deleted_ids;

  with deleted_attempts as (
    delete from public.test_attempts
    where test_id = p_test_id
      and student_id = any(v_student_ids)
    returning student_id
  )
  select
    count(*),
    coalesce(array_agg(distinct student_id), array[]::uuid[])
  into v_deleted_attempts, v_deleted_ids
  from deleted_attempts;
  v_deleted_student_ids := v_deleted_student_ids || v_deleted_ids;

  select count(distinct student_id)
  into v_deleted_student_count
  from unnest(v_deleted_student_ids) as deleted(student_id);

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'deleted_student_count', v_deleted_student_count,
    'deleted_attempts', v_deleted_attempts,
    'deleted_responses', v_deleted_responses,
    'deleted_focus_events', v_deleted_focus_events,
    'deleted_ai_grading_items', v_deleted_ai_items
  );
end;
$$;

revoke all on function public.delete_student_test_attempts_atomic(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.delete_student_test_attempts_atomic(uuid, uuid[]) to service_role;
