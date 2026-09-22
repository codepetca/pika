#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavior contract. Migration 201 must already be
# applied; this script never applies schema or leaves durable fixture rows.
USAGE_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$USAGE_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$USAGE_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $security$
declare
  v_signature text;
  v_security_definer boolean;
  v_config text[];
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '201'
  ) then
    raise exception 'Migration 201 is required; this harness never applies it';
  end if;
  if has_table_privilege('service_role', 'public.feature_usage_reservations', 'insert')
    or has_table_privilege('authenticated', 'public.feature_usage_reservations', 'select')
  then
    raise exception 'Feature usage ledger table privileges are incorrect';
  end if;

  foreach v_signature in array array[
    'public.reserve_feature_usage_v1(uuid,uuid,text,text,text,integer,integer)',
    'public.settle_feature_usage_v1(uuid,uuid,text,integer)',
    'public.release_feature_usage_v1(uuid,uuid,text,integer,text)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
    then
      raise exception 'Feature usage function privileges are incorrect: %', v_signature;
    end if;
    select procedure.prosecdef, procedure.proconfig
    into strict v_security_definer, v_config
    from pg_proc as procedure
    where procedure.oid = to_regprocedure(v_signature);
    if not v_security_definer or not (v_config @> array['search_path=""']::text[]) then
      raise exception 'Feature usage function security metadata is incorrect: %', v_signature;
    end if;
  end loop;
end;
$security$;

insert into public.users (id, email, role) values (
  'c2010000-0000-4000-8000-000000000001',
  'metered-feature-owner@example.invalid',
  'student'
);

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  'c2010000-0000-4000-8000-000000000010',
  'c2010000-0000-4000-8000-000000000001',
  'grading.ai', 'manual', true, clock_timestamp(), null, 2,
  'test:migration-201', 'metered_feature_usage_fixture', 0
);

do $behavior$
declare
  v_result jsonb;
begin
  v_result := public.reserve_feature_usage_v1(
    'c2010000-0000-4000-8000-000000000020',
    'c2010000-0000-4000-8000-000000000001',
    'grading.ai', 'assignment_ai_grading', 'assignment:item:attempt1', 1, 3600
  );
  if (v_result ->> 'duplicate')::boolean
    or v_result #>> '{reservation,status}' <> 'reserved'
    or (v_result ->> 'used_after')::integer <> 1
  then
    raise exception 'Initial reservation evidence is invalid: %', v_result;
  end if;

  v_result := public.reserve_feature_usage_v1(
    'c2010000-0000-4000-8000-000000000020',
    'c2010000-0000-4000-8000-000000000001',
    'grading.ai', 'assignment_ai_grading', 'assignment:item:attempt1', 1, 3600
  );
  if not (v_result ->> 'duplicate')::boolean then
    raise exception 'Exact reservation replay was not idempotent: %', v_result;
  end if;

  begin
    perform public.reserve_feature_usage_v1(
      'c2010000-0000-4000-8000-000000000020',
      'c2010000-0000-4000-8000-000000000001',
      'grading.ai', 'assignment_ai_grading', 'assignment:item:attempt1', 2, 3600
    );
    raise exception 'Expected operation fingerprint conflict';
  exception when unique_violation then null;
  end;

  perform public.reserve_feature_usage_v1(
    'c2010000-0000-4000-8000-000000000021',
    'c2010000-0000-4000-8000-000000000001',
    'grading.ai', 'repository_review', 'repository:run1', 1, 3600
  );

  begin
    perform public.reserve_feature_usage_v1(
      'c2010000-0000-4000-8000-000000000022',
      'c2010000-0000-4000-8000-000000000001',
      'grading.ai', 'test_ai_grading', 'test:item:attempt1', 1, 3600
    );
    raise exception 'Expected quota exhaustion';
  exception when check_violation then null;
  end;

  v_result := public.settle_feature_usage_v1(
    'c2010000-0000-4000-8000-000000000020',
    'c2010000-0000-4000-8000-000000000001', 'grading.ai', 1
  );
  if v_result #>> '{reservation,status}' <> 'settled' then
    raise exception 'Settlement failed: %', v_result;
  end if;
  v_result := public.settle_feature_usage_v1(
    'c2010000-0000-4000-8000-000000000020',
    'c2010000-0000-4000-8000-000000000001', 'grading.ai', 1
  );
  if not (v_result ->> 'duplicate')::boolean then
    raise exception 'Settlement replay was not idempotent: %', v_result;
  end if;

  v_result := public.release_feature_usage_v1(
    'c2010000-0000-4000-8000-000000000021',
    'c2010000-0000-4000-8000-000000000001', 'grading.ai', 1, 'provider_failed'
  );
  if v_result #>> '{reservation,status}' <> 'released' then
    raise exception 'Release failed: %', v_result;
  end if;
  v_result := public.release_feature_usage_v1(
    'c2010000-0000-4000-8000-000000000021',
    'c2010000-0000-4000-8000-000000000001', 'grading.ai', 1, 'provider_failed'
  );
  if not (v_result ->> 'duplicate')::boolean then
    raise exception 'Release replay was not idempotent: %', v_result;
  end if;

  begin
    perform public.release_feature_usage_v1(
      'c2010000-0000-4000-8000-000000000021',
      'c2010000-0000-4000-8000-000000000001', 'grading.ai', 1, 'cancelled'
    );
    raise exception 'Expected conflicting release reason denial';
  exception when unique_violation then null;
  end;

  perform public.reserve_feature_usage_v1(
    'c2010000-0000-4000-8000-000000000022',
    'c2010000-0000-4000-8000-000000000001',
    'grading.ai', 'test_ai_grading', 'test:item:attempt1', 1, 3600
  );

  begin
    perform public.release_feature_usage_v1(
      'c2010000-0000-4000-8000-000000000022',
      'c2010000-0000-4000-8000-000000000001', 'grading.ai', 1, null
    );
    raise exception 'Expected null release reason denial';
  exception when invalid_parameter_value then null;
  end;
end;
$behavior$;
reset role;

rollback;
SQL

echo 'Metered feature usage reservation database contracts passed.'
