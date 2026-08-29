-- Publish a Test without exposing the legacy active-state default between
-- draft materialization and the teacher's explicit student-access decision.
-- PostgreSQL function calls share the caller transaction, so any failure while
-- closing the newly materialized Test rolls back activation and question writes.

create or replace function public.publish_test_from_draft_atomic(
  p_teacher_id uuid,
  p_test_id uuid,
  p_expected_draft_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_test public.tests%rowtype;
begin
  v_result := public.activate_test_from_draft_atomic(
    p_teacher_id,
    p_test_id,
    p_expected_draft_version
  );

  update public.tests test
  set status = 'closed'
  where test.id = p_test_id
    and test.status = 'active'
  returning test.* into v_test;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'publish_transition_failed';
  end if;

  return jsonb_set(v_result, '{test}', to_jsonb(v_test), true);
end;
$$;

revoke all on function public.publish_test_from_draft_atomic(
  uuid,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.publish_test_from_draft_atomic(
  uuid,
  uuid,
  integer
) to service_role;
