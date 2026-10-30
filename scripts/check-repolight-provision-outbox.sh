#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
for binary in initdb pg_ctl psql; do command -v "$binary" >/dev/null || { echo "$binary is required for disposable queue contracts" >&2; exit 1; }; done
PROOF_DIR="$(mktemp -d /tmp/pika-provision-proof.XXXXXX)"
cleanup() {
  pg_ctl -D "$PROOF_DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$PROOF_DIR"
}
trap cleanup EXIT
# A private Unix socket and disabled TCP listener cannot address a shared or
# hosted database. Only the process created below ever receives these files.
initdb -D "$PROOF_DIR/data" --no-locale -A trust -U postgres >"$PROOF_DIR/init.log" 2>&1
pg_ctl -D "$PROOF_DIR/data" -l "$PROOF_DIR/server.log" -o "-c listen_addresses='' -c unix_socket_directories='$PROOF_DIR'" -w start >/dev/null
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$PROOF_DIR" -U postgres -d postgres)
"${PSQL[@]}" >"$PROOF_DIR/proof.log" <<'SQL'
create role anon;create role authenticated;create role service_role;
create schema private;
create table private.repolight_settings(singleton boolean primary key default true check(singleton),billing_access_enabled boolean default false);
insert into private.repolight_settings default values;
create table private.stripe_billing_settings(singleton boolean primary key default true check(singleton),sandbox_enabled boolean default false,provider_mode text default 'test');
insert into private.stripe_billing_settings default values;
create table public.users(id uuid primary key,role text);
create table public.billing_account_access(subject_user_id uuid primary key references public.users(id),
 revision bigint not null,account_plan_revision bigint not null,entitlement_revision bigint,
 starts_at timestamptz not null,access_ends_at timestamptz not null,updated_at timestamptz default clock_timestamp());
SQL
"${PSQL[@]}" -f "$ROOT/supabase/migrations/298_repolight_provision_outbox.sql" >>"$PROOF_DIR/proof.log"
"${PSQL[@]}" -f "$ROOT/scripts/check-repolight-provision-outbox.sql" >>"$PROOF_DIR/proof.log"
echo 'RepoLight disposable queue contracts passed (actual298; minimal prerequisites, no shared DB/provider access)'
