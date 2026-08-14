#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${CLEANUP_HISTORY_CRON_DB_CONTAINER:-supabase_db_pika}"
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "Local Pika Supabase database container is not running." >&2
  exit 2
fi

PROJECT_LABEL="$(docker inspect "$DB_CONTAINER" \
  --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
DB_BINDING="$(docker port "$DB_CONTAINER" 5432/tcp 2>/dev/null || true)"
if [[ "$PROJECT_LABEL" != "pika" ]] || ! grep -q ':54322$' <<<"$DB_BINDING"; then
  echo "Refusing non-local or unexpected Supabase database target." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $migration$
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '124'
  ) or to_regprocedure(
    'public.begin_cleanup_history_cron_run(text,text,text)'
  ) is null or to_regprocedure(
    'public.finish_cleanup_history_cron_run(uuid,text,integer,text,jsonb)'
  ) is null or to_regprocedure(
    'public.get_cleanup_history_cron_health_snapshot(integer,integer)'
  ) is null then
    raise exception 'Migration 124 is not applied to the local database';
  end if;
end;
$migration$;

begin;

do $privileges$
begin
  if has_table_privilege('anon', 'public.cleanup_history_cron_runs', 'select')
    or has_table_privilege('authenticated', 'public.cleanup_history_cron_runs', 'select')
    or has_table_privilege('service_role', 'public.cleanup_history_cron_runs', 'insert')
    or has_table_privilege('service_role', 'public.cleanup_history_cron_runs', 'update')
    or not has_table_privilege('service_role', 'public.cleanup_history_cron_runs', 'select')
  then raise exception 'Cron ledger table privileges are unsafe'; end if;

  if has_function_privilege(
      'anon', 'public.begin_cleanup_history_cron_run(text,text,text)', 'execute'
    ) or has_function_privilege(
      'authenticated',
      'public.begin_cleanup_history_cron_run(text,text,text)', 'execute'
    ) or not has_function_privilege(
      'service_role',
      'public.begin_cleanup_history_cron_run(text,text,text)', 'execute'
    ) or has_function_privilege(
      'anon',
      'public.get_cleanup_history_cron_health_snapshot(integer,integer)', 'execute'
    ) or not has_function_privilege(
      'service_role',
      'public.get_cleanup_history_cron_health_snapshot(integer,integer)', 'execute'
    )
  then raise exception 'Cron ledger RPC privileges are unsafe'; end if;
end;
$privileges$;

do $metrics$
begin
  if not public.cleanup_history_cron_metrics_valid(
    '{"history_rows_deleted":3,"managed_health_healthy":true}'::jsonb
  ) then raise exception 'Valid aggregate metrics were rejected'; end if;
  if public.cleanup_history_cron_metrics_valid(
    '{"student_id":"00000000-0000-4000-8000-000000000001"}'::jsonb
  ) then raise exception 'Identity-bearing metrics were accepted'; end if;
  if public.cleanup_history_cron_metrics_valid(
    '{"history_rows_deleted":-1}'::jsonb
  ) or public.cleanup_history_cron_metrics_valid(
    '{"history_rows_deleted":1.5}'::jsonb
  ) or public.cleanup_history_cron_metrics_valid(
    '{"history_rows_deleted":9007199254740992}'::jsonb
  ) then raise exception 'Unsafe aggregate count was accepted'; end if;
end;
$metrics$;

do $lifecycle$
declare
  v_first jsonb;
  v_overlap jsonb;
  v_next jsonb;
  v_stale jsonb;
  v_snapshot jsonb;
  v_run_id uuid;
  v_status text;
begin
  v_snapshot := public.get_cleanup_history_cron_health_snapshot(120, 1560);
  if (v_snapshot->>'healthy')::boolean
    or (v_snapshot->>'scheduled_run_healthy')::boolean
    or v_snapshot->'latest_vercel_run' <> 'null'::jsonb
  then raise exception 'Empty cron ledger reported healthy: %', v_snapshot; end if;

  v_first := public.begin_cleanup_history_cron_run(
    'vercel_cron', '0 7 * * *', 'deployment_fixture'
  );
  if not (v_first->>'started')::boolean then
    raise exception 'First cron run did not start: %', v_first;
  end if;
  v_run_id := (v_first->>'run_id')::uuid;

  v_overlap := public.begin_cleanup_history_cron_run('manual', null, null);
  if (v_overlap->>'started')::boolean then
    raise exception 'Overlapping cron run was started: %', v_overlap;
  end if;
  select status into strict v_status
  from public.cleanup_history_cron_runs
  where id = (v_overlap->>'run_id')::uuid;
  if v_status <> 'skipped_overlap' then
    raise exception 'Overlap attempt was not durably recorded';
  end if;

  if not public.finish_cleanup_history_cron_run(
    v_run_id,
    'succeeded',
    200,
    null,
    '{"history_rows_deleted":3,"managed_health_healthy":true}'::jsonb
  ) then raise exception 'Successful cron run did not finish'; end if;

  begin
    perform public.finish_cleanup_history_cron_run(
      v_run_id, 'succeeded', 200, null, '{}'::jsonb
    );
    raise exception 'Completed cron run was finalized twice';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'cleanup_history_cron_run_not_running' then raise; end if;
  end;

  v_next := public.begin_cleanup_history_cron_run('manual', null, null);
  if not (v_next->>'started')::boolean then
    raise exception 'Next cron run did not start';
  end if;
  if not public.finish_cleanup_history_cron_run(
    (v_next->>'run_id')::uuid,
    'failed',
    503,
    'managed_deletion_health_degraded',
    '{"managed_health_healthy":false,"managed_health_critical":1}'::jsonb
  ) then raise exception 'Failed cron run did not finish'; end if;

  v_stale := public.begin_cleanup_history_cron_run('manual', null, null);
  update public.cleanup_history_cron_runs
  set started_at = clock_timestamp() - interval '3 hours'
  where id = (v_stale->>'run_id')::uuid;
  v_next := public.begin_cleanup_history_cron_run(
    'vercel_cron', '0 7 * * *', 'deployment_fixture_2'
  );
  select status into strict v_status
  from public.cleanup_history_cron_runs
  where id = (v_stale->>'run_id')::uuid;
  if v_status <> 'failed' or not (v_next->>'started')::boolean then
    raise exception 'Stale run was not superseded safely';
  end if;
  perform public.finish_cleanup_history_cron_run(
    (v_next->>'run_id')::uuid,
    'succeeded',
    200,
    null,
    '{"student_health_stuck":0,"managed_health_healthy":true}'::jsonb
  );

  v_snapshot := public.get_cleanup_history_cron_health_snapshot(120, 1560);
  if not (v_snapshot->>'healthy')::boolean
    or (v_snapshot->>'stale_running_count')::integer <> 0
    or v_snapshot#>>'{latest_vercel_run,schedule}' <> '0 7 * * *'
    or v_snapshot#>>'{latest_vercel_run,status}' <> 'succeeded'
    or (v_snapshot#>>'{latest_vercel_run,http_status}')::integer <> 200
    or not (v_snapshot->>'scheduled_run_healthy')::boolean
    or v_snapshot->>'expected_schedule' <> '0 7 * * *'
    or (v_snapshot->>'scheduled_evidence_max_age_minutes')::integer <> 1560
  then raise exception 'Cron health snapshot mismatch: %', v_snapshot; end if;
  if v_snapshot::text ~
      '"(teacher_id|student_id|user_id|classroom_id|operation_id|storage_path|email|title)"[[:space:]]*:'
    or v_snapshot::text ~
      '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  then raise exception 'Identity-bearing evidence escaped cron health'; end if;

  v_first := public.begin_cleanup_history_cron_run(
    'vercel_cron', '0 7 * * *', 'deployment_fixture_failed'
  );
  perform public.finish_cleanup_history_cron_run(
    (v_first->>'run_id')::uuid,
    'failed',
    503,
    'managed_deletion_health_degraded',
    '{"managed_health_healthy":false,"managed_health_critical":1}'::jsonb
  );
  v_next := public.begin_cleanup_history_cron_run('manual', null, null);
  perform public.finish_cleanup_history_cron_run(
    (v_next->>'run_id')::uuid,
    'succeeded',
    200,
    null,
    '{"managed_health_healthy":true}'::jsonb
  );
  v_snapshot := public.get_cleanup_history_cron_health_snapshot(120, 1560);
  if (v_snapshot->>'healthy')::boolean
    or (v_snapshot->>'scheduled_run_healthy')::boolean
    or v_snapshot#>>'{latest_run,invocation_source}' <> 'manual'
    or v_snapshot#>>'{latest_vercel_run,status}' <> 'failed'
  then raise exception 'Manual success masked scheduled failure: %', v_snapshot; end if;

  v_first := public.begin_cleanup_history_cron_run(
    'vercel_cron', '0 7 * * *', 'deployment_fixture_expired'
  );
  perform public.finish_cleanup_history_cron_run(
    (v_first->>'run_id')::uuid,
    'succeeded',
    200,
    null,
    '{"managed_health_healthy":true}'::jsonb
  );
  update public.cleanup_history_cron_runs
  set started_at = clock_timestamp() - interval '3 days',
      completed_at = clock_timestamp() - interval '3 days' + interval '1 second'
  where invocation_source = 'vercel_cron';
  update public.cleanup_history_cron_runs
  set started_at = clock_timestamp() - interval '2 days',
      completed_at = clock_timestamp() - interval '2 days' + interval '1 second'
  where id = (v_first->>'run_id')::uuid;
  v_snapshot := public.get_cleanup_history_cron_health_snapshot(120, 1560);
  if (v_snapshot->>'healthy')::boolean
    or (v_snapshot->>'scheduled_run_healthy')::boolean
  then raise exception 'Expired scheduled evidence reported healthy: %', v_snapshot; end if;

  v_first := public.begin_cleanup_history_cron_run(
    'vercel_cron', '0 7 * * *', 'deployment_fixture_fresh'
  );
  perform public.finish_cleanup_history_cron_run(
    (v_first->>'run_id')::uuid,
    'succeeded',
    200,
    null,
    '{"managed_health_healthy":true}'::jsonb
  );
  v_snapshot := public.get_cleanup_history_cron_health_snapshot(120, 1560);
  if not (v_snapshot->>'healthy')::boolean
    or not (v_snapshot->>'scheduled_run_healthy')::boolean
  then raise exception 'Fresh scheduled success was not healthy: %', v_snapshot; end if;
end;
$lifecycle$;

do $threshold$
begin
  begin
    perform public.get_cleanup_history_cron_health_snapshot(4);
    raise exception 'Low stale threshold was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'cleanup_history_cron_stale_threshold_invalid' then raise; end if;
  end;
  begin
    perform public.get_cleanup_history_cron_health_snapshot(10081);
    raise exception 'High stale threshold was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'cleanup_history_cron_stale_threshold_invalid' then raise; end if;
  end;
  begin
    perform public.get_cleanup_history_cron_health_snapshot(120, 59);
    raise exception 'Low scheduled evidence age was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'cleanup_history_cron_scheduled_age_threshold_invalid' then raise; end if;
  end;
  begin
    perform public.get_cleanup_history_cron_health_snapshot(120, 10081);
    raise exception 'High scheduled evidence age was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'cleanup_history_cron_scheduled_age_threshold_invalid' then raise; end if;
  end;
end;
$threshold$;

rollback;
SQL

echo "Cleanup-history cron ledger database checks passed."
