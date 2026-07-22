-- Restrict the assignment grading lease claim to trusted server workers.
create or replace function public.claim_assignment_ai_grading_run(
  p_run_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns setof public.assignment_ai_grading_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_run_id is null
    or p_lease_token is null
    or p_lease_seconds is null
    or p_lease_seconds < 1
  then
    raise exception 'Assignment AI grading lease claim is invalid' using errcode = '22023';
  end if;

  return query
    update public.assignment_ai_grading_runs run
    set
      status = case when run.status = 'queued' then 'running' else run.status end,
      lease_token = p_lease_token,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(run.started_at, clock_timestamp()),
      completed_at = null
    where run.id = p_run_id
      and run.status in ('queued', 'running')
      and (run.lease_expires_at is null or run.lease_expires_at <= clock_timestamp())
    returning run.*;
end;
$$;

revoke all on function public.claim_assignment_ai_grading_run(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_assignment_ai_grading_run(uuid, uuid, integer)
  to service_role;
