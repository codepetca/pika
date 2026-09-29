-- Resume durable test grading after the teacher leaves the page. pg_net sends only
-- a run UUID to a protected worker; the worker still claims the existing run lease.
-- Vault values activate dispatch after the application worker is deployed.
begin;
set local lock_timeout = '5s';

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create index if not exists idx_test_ai_grading_runs_background_active
  on public.test_ai_grading_runs (created_at, id)
  where status in ('queued', 'running');

create function private.kick_test_ai_grading_run(p_run_id uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  if p_run_id is null or not exists (
    select 1 from public.test_ai_grading_runs run
    where run.id = p_run_id
      and run.status in ('queued', 'running')
      and (run.lease_expires_at is null or run.lease_expires_at <= clock_timestamp())
      and exists (
        select 1 from public.test_ai_grading_run_items item
        where item.run_id = run.id
          and item.status in ('queued', 'processing')
          and (item.next_retry_at is null or item.next_retry_at <= clock_timestamp())
      )
  ) then
    return null;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'pika_test_ai_grading_worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'pika_test_ai_grading_worker_secret';
  if v_url is null or v_url !~ '^https://[^[:space:]/]+/api/cron/test-ai-grading$'
    or v_secret is null or length(v_secret) < 32 then
    return null;
  end if;

  v_request_id := net.http_post(
    url => v_url,
    body => jsonb_build_object('run_id', p_run_id),
    headers => jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds => 5000
  );
  return v_request_id;
exception when others then
  -- Creation and finalization are authoritative; a missed wake is recovered
  -- by the minute watchdog without rolling back a grade or run transition.
  return null;
end;
$$;
revoke all on function private.kick_test_ai_grading_run(uuid)
  from public, anon, authenticated, service_role;

create function private.wake_inserted_test_ai_grading_items()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_run_id uuid;
begin
  for v_run_id in select distinct run_id from new_items loop
    perform private.kick_test_ai_grading_run(v_run_id);
  end loop;
  return null;
end;
$$;
revoke all on function private.wake_inserted_test_ai_grading_items()
  from public, anon, authenticated, service_role;
create trigger wake_inserted_test_ai_grading_items
  after insert on public.test_ai_grading_run_items
  referencing new table as new_items
  for each statement execute function private.wake_inserted_test_ai_grading_items();

create function private.wake_released_test_ai_grading_run()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.kick_test_ai_grading_run(new.id);
  return null;
end;
$$;
revoke all on function private.wake_released_test_ai_grading_run()
  from public, anon, authenticated, service_role;
create trigger wake_released_test_ai_grading_run
  after update of lease_token on public.test_ai_grading_runs
  for each row
  when (old.lease_token is not null and new.lease_token is null
    and new.status in ('queued', 'running'))
  execute function private.wake_released_test_ai_grading_run();

create function private.watchdog_test_ai_grading_runs()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_run_id uuid;
  v_queued integer := 0;
begin
  for v_run_id in
    select run.id from public.test_ai_grading_runs run
    where run.status in ('queued', 'running')
      and (run.lease_expires_at is null or run.lease_expires_at <= clock_timestamp())
      and exists (
        select 1 from public.test_ai_grading_run_items item
        where item.run_id = run.id
          and item.status in ('queued', 'processing')
          and (item.next_retry_at is null or item.next_retry_at <= clock_timestamp())
      )
    order by run.created_at, run.id
    limit 8
  loop
    if private.kick_test_ai_grading_run(v_run_id) is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;
  return v_queued;
end;
$$;
revoke all on function private.watchdog_test_ai_grading_runs()
  from public, anon, authenticated, service_role;

select cron.schedule(
  'pika-test-ai-grading-watchdog',
  '* * * * *',
  $job$select private.watchdog_test_ai_grading_runs()$job$
);

comment on function private.kick_test_ai_grading_run(uuid) is
  'Wake the protected test AI worker only for due, unleased runs; Vault config activates dispatch.';

commit;
