#!/usr/bin/env bash
set -euo pipefail

# This deliberately creates a real two-session overlap. It is CI-only because
# it commits isolated fixtures and temporarily enables the billing sandbox in
# the fresh Supabase database that CI disposes after this job.
DB_CONTAINER='supabase_db_pika'
DB_NAME='postgres'

if [[ "${CI:-}" != 'true' ]]; then
  echo 'Stripe binding race regression is CI-only; refusing a non-CI database.' >&2
  exit 2
fi
if [[ "${STRIPE_BINDING_RACE_TIMEOUT_GUARD:-}" != '1' ]]; then
  if ! command -v timeout >/dev/null 2>&1; then
    echo 'Stripe binding race requires the CI timeout utility.' >&2
    exit 2
  fi
  export STRIPE_BINDING_RACE_TIMEOUT_GUARD=1
  exec timeout --kill-after=1s 27s bash "$0"
fi
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1 \
  || [[ "$(docker inspect "$DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != 'pika' ]] \
  || ! docker port "$DB_CONTAINER" 5432/tcp | grep -q ':54322$'; then
  echo 'Refusing unexpected Stripe binding race database target.' >&2
  exit 2
fi

psql_local() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -X -v ON_ERROR_STOP=1 "$@"
}

if [[ "$(psql_local -Atc "select count(*) from supabase_migrations.schema_migrations where version = '209'")" != '1' ]]; then
  echo 'Migration 209 must already be replayed; this harness never applies migrations.' >&2
  exit 2
fi
if [[ "$(psql_local -Atc 'select sandbox_enabled from private.stripe_billing_settings where singleton')" != 'f' ]]; then
  echo 'Stripe binding race requires the CI sandbox to start disabled.' >&2
  exit 2
fi

race_token="r209$(date +%s%N)$$"
race_user_id="f2090000-0000-4000-8000-${race_token: -12}"
race_account="acct_${race_token}"
race_customer="cus_${race_token}"
race_subscription="sub_${race_token}"
race_price="price_${race_token}"
race_product="prod_${race_token}"
race_event="evt_${race_token}"
race_email="${race_token}@example.invalid"
race_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
race_dir="$(mktemp -d)"
binder_app="pika_stripe_binding_binder_${race_token}"
webhook_app="pika_stripe_binding_webhook_${race_token}"
binder_in="$race_dir/binder.in"
webhook_in="$race_dir/webhook.in"
binder_pid=''
webhook_pid=''
sandbox_touched=false

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  exec 3>&- || true
  exec 4>&- || true
  for child_pid in "$binder_pid" "$webhook_pid"; do
    if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done
  if [[ "$sandbox_touched" == true ]]; then
    psql_local -v binder_app="$binder_app" -v webhook_app="$webhook_app" >/dev/null 2>&1 <<'SQL' || true
select pg_terminate_backend(activity.pid)
from pg_stat_activity activity
where activity.datname = current_database()
  and activity.application_name in (:'binder_app', :'webhook_app')
  and activity.pid <> pg_backend_pid();
update private.stripe_billing_settings
set sandbox_enabled = false
where singleton;
SQL
  fi
  for child_pid in "$binder_pid" "$webhook_pid"; do
    if [[ -n "$child_pid" ]]; then
      wait "$child_pid" 2>/dev/null || true
    fi
  done
  rm -rf "$race_dir"
  exit "$status"
}
trap cleanup EXIT INT TERM

wait_for_binder_lock() {
  for _ in {1..50}; do
    if [[ "$(psql_local -At -v binder_app="$binder_app" <<'SQL'
select exists (
  select 1
  from pg_stat_activity activity
  join pg_locks lock on lock.pid = activity.pid
  where activity.datname = current_database()
    and activity.application_name = :'binder_app'
    and activity.state = 'idle in transaction'
    and lock.locktype = 'advisory'
    and lock.granted
);
SQL
)" == 't' ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo 'Binder never reached the held advisory transaction boundary.' >&2
  [[ -f "$race_dir/binder.err" ]] && cat "$race_dir/binder.err" >&2
  return 1
}

wait_for_webhook_contention() {
  for _ in {1..50}; do
    if [[ "$(psql_local -At -v binder_app="$binder_app" -v webhook_app="$webhook_app" <<'SQL'
select exists (
  select 1
  from pg_locks holder
  join pg_stat_activity binder on binder.pid = holder.pid
  join pg_locks waiter on waiter.locktype = holder.locktype
    and waiter.database is not distinct from holder.database
    and waiter.classid = holder.classid
    and waiter.objid = holder.objid
    and waiter.objsubid = holder.objsubid
  join pg_stat_activity webhook on webhook.pid = waiter.pid
  where binder.datname = current_database()
    and binder.application_name = :'binder_app'
    and webhook.application_name = :'webhook_app'
    and holder.locktype = 'advisory'
    and holder.granted
    and not waiter.granted
    and webhook.state = 'active'
    and webhook.wait_event = 'advisory'
);
SQL
)" == 't' ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo 'Webhook did not wait on the binder advisory lock; the early-receipt race is unprotected.' >&2
  [[ -f "$race_dir/binder.err" ]] && cat "$race_dir/binder.err" >&2
  [[ -f "$race_dir/webhook.err" ]] && cat "$race_dir/webhook.err" >&2
  return 1
}

wait_for_session_exit() {
  local child_pid="$1"
  local name="$2"
  local output_file="$3"
  local error_file="$4"
  for _ in {1..80}; do
    if ! kill -0 "$child_pid" 2>/dev/null; then
      if ! wait "$child_pid"; then
        echo "$name PostgreSQL session failed." >&2
        cat "$error_file" >&2 || true
        return 1
      fi
      return 0
    fi
    sleep 0.1
  done
  echo "$name PostgreSQL session exceeded its bounded completion window." >&2
  cat "$output_file" >&2 || true
  cat "$error_file" >&2 || true
  return 1
}

# The fixture names are unique, and this is the last database step in CI. The
# only non-fixture setting is restored by cleanup even when an assertion fails.
sandbox_touched=true
psql_local -v race_user_id="$race_user_id" -v race_email="$race_email" \
  -v race_account="$race_account" -v race_product="$race_product" -v race_price="$race_price" >/dev/null <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '8s';
update private.stripe_billing_settings set sandbox_enabled = true where singleton;
insert into public.users (id, email, role)
values (:'race_user_id'::uuid, :'race_email', 'teacher');
insert into public.stripe_billing_offerings (plan_key) values ('plus') on conflict (plan_key) do nothing;
set local role service_role;
select public.set_account_plan_v1(
  gen_random_uuid(), :'race_user_id'::uuid, 'free',
  'test:migration-209', 'binding_race_fixture', 0
)
where not exists (
  select 1 from public.account_plans where subject_user_id = :'race_user_id'::uuid
);
with next_version as (
  select coalesce(max(version), 0) + 1 as value
  from public.stripe_billing_offering_versions version
  join public.stripe_billing_offerings offering on offering.id = version.offering_id
  where offering.plan_key = 'plus'
)
select public.billing_register_offering_v1(jsonb_build_object(
  'plan_key', 'plus', 'version', (select value from next_version),
  'stripe_account', :'race_account', 'provider_mode', 'test',
  'stripe_product_id', :'race_product', 'stripe_price_id', :'race_price',
  'currency', 'cad', 'unit_amount', 2090, 'interval', 'month',
  'classroom_limit', 9, 'features', jsonb_build_object('classrooms', true),
  'ai_definition', null, 'availability', jsonb_build_object('is_available', true)
));
commit;
SQL

race_offering_version_id="$(psql_local -At -v race_price="$race_price" <<'SQL'
select id
from public.stripe_billing_offering_versions
where stripe_price_id = :'race_price';
SQL
)"
if [[ ! "$race_offering_version_id" =~ ^[0-9a-f-]{36}$ ]]; then
  echo 'Race fixture did not create exactly one billing offering version.' >&2
  exit 1
fi

mkfifo "$binder_in" "$webhook_in"
docker exec -e PGAPPNAME="$binder_app" -i "$DB_CONTAINER" \
  psql -U postgres -d "$DB_NAME" -X -qAt -v ON_ERROR_STOP=1 \
  -v race_user_id="$race_user_id" -v race_account="$race_account" \
  -v race_customer="$race_customer" -v race_subscription="$race_subscription" \
  -v race_price="$race_price" -v race_offering_version_id="$race_offering_version_id" \
  <"$binder_in" >"$race_dir/binder.out" 2>"$race_dir/binder.err" &
binder_pid=$!
exec 3>"$binder_in"
printf '%s\n' \
  'begin;' \
  "set local lock_timeout = '8s';" \
  "set local statement_timeout = '12s';" \
  "set local role service_role;" \
  "select public.billing_bind_customer_v1(jsonb_build_object('subject_user_id', :'race_user_id', 'stripe_account', :'race_account', 'provider_mode', 'test', 'stripe_customer_id', :'race_customer', 'stripe_subscription_id', :'race_subscription', 'stripe_price_id', :'race_price', 'offering_version_id', :'race_offering_version_id'));" \
  >&3
wait_for_binder_lock

docker exec -e PGAPPNAME="$webhook_app" -i "$DB_CONTAINER" \
  psql -U postgres -d "$DB_NAME" -X -qAt -v ON_ERROR_STOP=1 \
  -v race_account="$race_account" -v race_customer="$race_customer" \
  -v race_subscription="$race_subscription" -v race_event="$race_event" -v race_hash="$race_hash" \
  <"$webhook_in" >"$race_dir/webhook.out" 2>"$race_dir/webhook.err" &
webhook_pid=$!
exec 4>"$webhook_in"
printf '%s\n' \
  "set statement_timeout = '12s';" \
  "set role service_role;" \
  "select public.billing_record_event_v1(jsonb_build_object('stripe_account', :'race_account', 'event_id', :'race_event', 'payload_hash', :'race_hash', 'event_type', 'invoice.paid', 'payload', jsonb_build_object('object_id', 'in_race', 'customer_id', :'race_customer', 'subscription_id', :'race_subscription'), 'event_created_at', '2026-09-26T00:00:00Z', 'received_at', clock_timestamp()));" \
  >&4
wait_for_webhook_contention

printf '%s\n' 'commit;' '\q' >&3
exec 3>&-
wait_for_session_exit "$binder_pid" 'Binder' "$race_dir/binder.out" "$race_dir/binder.err"
printf '%s\n' '\q' >&4
exec 4>&-
wait_for_session_exit "$webhook_pid" 'Webhook' "$race_dir/webhook.out" "$race_dir/webhook.err"

if [[ "$(psql_local -At -v race_account="$race_account" -v race_customer="$race_customer" -v race_subscription="$race_subscription" -v race_event="$race_event" -v race_user_id="$race_user_id" <<'SQL'
select exists (
  select 1
  from public.stripe_billing_event_inbox event
  join public.stripe_billing_subscription_bindings binding on binding.id = event.subscription_id
  where event.stripe_account = :'race_account'
    and event.stripe_event_id = :'race_event'
    and event.status = 'received'
    and event.exception_code is null
    and event.next_attempt_at <= clock_timestamp()
    and event.stripe_customer_id = :'race_customer'
    and event.stripe_subscription_id = :'race_subscription'
    and binding.subject_user_id = :'race_user_id'::uuid
    and binding.stripe_customer_id = :'race_customer'
    and binding.stripe_subscription_id = :'race_subscription'
);
SQL
)" != 't' ]]; then
  echo 'Released webhook was not accepted, bound to the matching customer, and due for work.' >&2
  exit 1
fi

echo 'Stripe binding/webhook advisory-lock race regression passed.'
