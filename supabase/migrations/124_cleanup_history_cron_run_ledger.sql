-- Durable, privacy-safe evidence for the existing daily cleanup-history cron.
-- This migration installs no schedule and grants no cleanup or deletion authority.

create function public.cleanup_history_cron_metrics_valid(p_metrics jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_metrics) = 'object'
    and pg_column_size(p_metrics) <= 8192
    and not exists (
      select 1
      from jsonb_each(p_metrics) entry
      where entry.key not in (
        'classroom_purge_processed',
        'classroom_purge_completed',
        'classroom_purge_failed',
        'cold_classroom_purge_processed',
        'cold_classroom_purge_completed',
        'cold_classroom_purge_failed',
        'course_blueprint_purge_processed',
        'course_blueprint_purge_completed',
        'course_blueprint_purge_failed',
        'student_purge_processed',
        'student_purge_completed',
        'student_purge_failed',
        'student_health_active',
        'student_health_stuck',
        'student_health_failed',
        'student_health_orphan_fences',
        'student_health_processing_lease_drift',
        'archive_staging_cleaned',
        'archive_objects_claimed',
        'archive_objects_deleted',
        'archive_objects_failed',
        'save_operations_deleted',
        'expired_classrooms_scanned',
        'assignment_history_deleted',
        'test_history_deleted',
        'history_rows_deleted',
        'managed_health_healthy',
        'managed_health_critical',
        'managed_health_warning'
      )
    )
    and not exists (
      select 1
      from jsonb_each(p_metrics) entry
      where case
        when entry.key = 'managed_health_healthy'
          then jsonb_typeof(entry.value) <> 'boolean'
        else jsonb_typeof(entry.value) <> 'number'
          or entry.value::text !~ '^(0|[1-9][0-9]*)$'
          or (entry.value::text)::numeric > 9007199254740991
      end
    ), false)
$$;

create table public.cleanup_history_cron_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null default 'cleanup-history'
    check (job_name = 'cleanup-history'),
  invocation_source text not null
    check (invocation_source in ('vercel_cron', 'manual')),
  schedule text,
  deployment_id text,
  status text not null
    check (status in ('running', 'succeeded', 'failed', 'skipped_overlap')),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  http_status smallint,
  error_code text,
  metrics jsonb not null default '{}'::jsonb,
  check (
    (invocation_source = 'vercel_cron' and schedule is not null)
    or (invocation_source = 'manual' and schedule is null)
  ),
  check (schedule is null or schedule ~ '^[ -~]{1,128}$'),
  check (deployment_id is null or deployment_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  check (public.cleanup_history_cron_metrics_valid(metrics)),
  check (
    (status = 'running'
      and completed_at is null and http_status is null and error_code is null)
    or (status = 'succeeded'
      and completed_at is not null and http_status between 200 and 299
      and error_code is null)
    or (status = 'failed'
      and completed_at is not null and http_status between 400 and 599
      and error_code is not null)
    or (status = 'skipped_overlap'
      and completed_at is not null and http_status = 409
      and error_code = 'overlap')
  )
);

create unique index cleanup_history_cron_runs_one_running
  on public.cleanup_history_cron_runs (job_name)
  where status = 'running';
create index cleanup_history_cron_runs_started
  on public.cleanup_history_cron_runs (started_at desc);
create index cleanup_history_cron_runs_vercel_started
  on public.cleanup_history_cron_runs (started_at desc)
  where invocation_source = 'vercel_cron';

alter table public.cleanup_history_cron_runs enable row level security;

revoke all on function public.cleanup_history_cron_metrics_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on table public.cleanup_history_cron_runs
  from public, anon, authenticated, service_role;
grant select on table public.cleanup_history_cron_runs to service_role;

create function public.begin_cleanup_history_cron_run(
  p_invocation_source text,
  p_schedule text default null,
  p_deployment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_active_id uuid;
begin
  if p_invocation_source not in ('vercel_cron', 'manual')
    or (p_invocation_source = 'vercel_cron') <> (p_schedule is not null)
    or (p_schedule is not null and p_schedule !~ '^[ -~]{1,128}$')
    or (p_deployment_id is not null
      and p_deployment_id !~ '^[A-Za-z0-9_-]{1,128}$') then
    raise exception using
      errcode = '22023',
      message = 'cleanup_history_cron_invocation_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-cron:cleanup-history', 0)
  );

  update public.cleanup_history_cron_runs
  set status = 'failed',
      completed_at = clock_timestamp(),
      http_status = 500,
      error_code = 'stale_run_superseded'
  where job_name = 'cleanup-history'
    and status = 'running'
    and started_at < clock_timestamp() - interval '2 hours';

  select id into v_active_id
  from public.cleanup_history_cron_runs
  where job_name = 'cleanup-history'
    and status = 'running'
  for update;

  if v_active_id is not null then
    insert into public.cleanup_history_cron_runs (
      invocation_source,
      schedule,
      deployment_id,
      status,
      completed_at,
      http_status,
      error_code
    ) values (
      p_invocation_source,
      p_schedule,
      p_deployment_id,
      'skipped_overlap',
      clock_timestamp(),
      409,
      'overlap'
    ) returning id into v_run_id;

    return jsonb_build_object('run_id', v_run_id, 'started', false);
  end if;

  insert into public.cleanup_history_cron_runs (
    invocation_source,
    schedule,
    deployment_id,
    status
  ) values (
    p_invocation_source,
    p_schedule,
    p_deployment_id,
    'running'
  ) returning id into v_run_id;

  return jsonb_build_object('run_id', v_run_id, 'started', true);
end;
$$;

create function public.finish_cleanup_history_cron_run(
  p_run_id uuid,
  p_status text,
  p_http_status integer,
  p_error_code text,
  p_metrics jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_status not in ('succeeded', 'failed')
    or p_http_status < 200 or p_http_status > 599
    or not public.cleanup_history_cron_metrics_valid(p_metrics)
    or (p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,64}$')
    or (p_status = 'succeeded'
      and (p_http_status >= 300 or p_error_code is not null))
    or (p_status = 'failed'
      and (p_http_status < 400 or p_error_code is null)) then
    raise exception using
      errcode = '22023',
      message = 'cleanup_history_cron_outcome_invalid';
  end if;

  update public.cleanup_history_cron_runs
  set status = p_status,
      completed_at = clock_timestamp(),
      http_status = p_http_status,
      error_code = p_error_code,
      metrics = p_metrics
  where id = p_run_id
    and job_name = 'cleanup-history'
    and status = 'running';
  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'cleanup_history_cron_run_not_running';
  end if;
  return true;
end;
$$;

create function public.get_cleanup_history_cron_health_snapshot(
  p_stale_minutes integer default 120
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_latest public.cleanup_history_cron_runs%rowtype;
  v_latest_vercel public.cleanup_history_cron_runs%rowtype;
  v_stale_running bigint;
  v_failed_7d bigint;
  v_overlap_7d bigint;
begin
  if p_stale_minutes < 5 or p_stale_minutes > 10080 then
    raise exception using
      errcode = '22023',
      message = 'cleanup_history_cron_stale_threshold_invalid';
  end if;

  select * into v_latest
  from public.cleanup_history_cron_runs
  order by started_at desc
  limit 1;

  select * into v_latest_vercel
  from public.cleanup_history_cron_runs
  where invocation_source = 'vercel_cron'
  order by started_at desc
  limit 1;

  select count(*) into v_stale_running
  from public.cleanup_history_cron_runs
  where status = 'running'
    and started_at < clock_timestamp()
      - make_interval(mins => p_stale_minutes);

  select count(*) into v_failed_7d
  from public.cleanup_history_cron_runs
  where status = 'failed'
    and started_at >= clock_timestamp() - interval '7 days';

  select count(*) into v_overlap_7d
  from public.cleanup_history_cron_runs
  where status = 'skipped_overlap'
    and started_at >= clock_timestamp() - interval '7 days';

  return jsonb_build_object(
    'version', 1,
    'captured_at', clock_timestamp(),
    'healthy', v_stale_running = 0
      and coalesce(v_latest.status = 'succeeded', true),
    'stale_running_count', v_stale_running,
    'failed_count_7d', v_failed_7d,
    'overlap_count_7d', v_overlap_7d,
    'latest_run', case when v_latest.id is null then null else jsonb_build_object(
      'invocation_source', v_latest.invocation_source,
      'schedule', v_latest.schedule,
      'status', v_latest.status,
      'started_at', v_latest.started_at,
      'completed_at', v_latest.completed_at,
      'http_status', v_latest.http_status,
      'error_code', v_latest.error_code,
      'metrics', v_latest.metrics
    ) end,
    'latest_vercel_run', case when v_latest_vercel.id is null then null else jsonb_build_object(
      'schedule', v_latest_vercel.schedule,
      'status', v_latest_vercel.status,
      'started_at', v_latest_vercel.started_at,
      'completed_at', v_latest_vercel.completed_at,
      'http_status', v_latest_vercel.http_status,
      'error_code', v_latest_vercel.error_code,
      'metrics', v_latest_vercel.metrics
    ) end
  );
end;
$$;

revoke all on function public.begin_cleanup_history_cron_run(text, text, text),
  public.finish_cleanup_history_cron_run(uuid, text, integer, text, jsonb),
  public.get_cleanup_history_cron_health_snapshot(integer)
  from public, anon, authenticated;
grant execute on function public.begin_cleanup_history_cron_run(text, text, text),
  public.finish_cleanup_history_cron_run(uuid, text, integer, text, jsonb),
  public.get_cleanup_history_cron_health_snapshot(integer)
  to service_role;

comment on table public.cleanup_history_cron_runs is
  'Service-only, privacy-safe run evidence for the existing cleanup-history cron; grants no cleanup authority.';
comment on function public.begin_cleanup_history_cron_run(text, text, text) is
  'Serializes cleanup-history runs, records overlap attempts, and supersedes only runs stale beyond two hours.';
comment on function public.finish_cleanup_history_cron_run(uuid, text, integer, text, jsonb) is
  'Finalizes one running cleanup-history ledger row with allowlisted aggregate metrics.';
comment on function public.get_cleanup_history_cron_health_snapshot(integer) is
  'Returns privacy-safe latest-run and failure aggregates for operator verification.';
