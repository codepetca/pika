#!/usr/bin/env bash

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "Refusing to source the authentication generation database harness." >&2
  return 1
fi

set -euo pipefail

EXPECTED_PROJECT="${AUTH_GENERATION_DB_PROJECT:-pika}"
if [[ ! "$EXPECTED_PROJECT" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "Invalid explicitly named local project." >&2
  exit 2
fi
EXPECTED_CONTAINER="supabase_db_$EXPECTED_PROJECT"
if [[ "$#" -ne 3 \
  || "$1" != "--execute-local-contract" \
  || "$2" != "--container" \
  || "$3" != "$EXPECTED_CONTAINER" ]]; then
  echo "Usage: $0 --execute-local-contract --container $EXPECTED_CONTAINER" >&2
  exit 2
fi

DB_CONTAINER="$3"
container_name="$(docker inspect --format '{{.Name}}' "$DB_CONTAINER" 2>/dev/null || true)"
project_label="$(docker inspect --format '{{index .Config.Labels "com.supabase.cli.project"}}' "$DB_CONTAINER" 2>/dev/null || true)"
if [[ "$container_name" != "/$EXPECTED_CONTAINER" || "$project_label" != "$EXPECTED_PROJECT" ]]; then
  echo "Refusing a container that is not the named local Pika Supabase database." >&2
  exit 2
fi

USER_ID="a2460000-0000-4000-8000-000000000001"
USER_EMAIL="generation-contract@example.invalid"
CODE_HASH='$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
HANDOFF_ONE="1111111111111111111111111111111111111111111111111111111111111111"
HANDOFF_TWO="2222222222222222222222222222222222222222222222222222222222222222"
HANDOFF_THREE="3333333333333333333333333333333333333333333333333333333333333333"
HANDOFF_FOUR="4444444444444444444444444444444444444444444444444444444444444444"
HANDOFF_FIVE="5555555555555555555555555555555555555555555555555555555555555555"
HANDOFF_SIX="6666666666666666666666666666666666666666666666666666666666666666"
TMP_DIR="$(mktemp -d)"
CREATED_USER=0

postgres_query() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -c "$1"
}

service_rpc() {
  postgres_query "set role service_role; $1"
}

wait_for_advisory_barrier() {
  local lock_id="$1"
  local failure="$2"
  for _ in {1..80}; do
    [[ "$(postgres_query "select count(*) from pg_locks where locktype = 'advisory' and objid = $lock_id and granted;")" == "1" ]] && return 0
    sleep 0.1
  done
  echo "$failure" >&2
  return 1
}

wait_for_application_lock() {
  local application_name="$1"
  local failure="$2"
  for _ in {1..40}; do
    [[ "$(postgres_query "select count(*) from pg_stat_activity where application_name = '$application_name' and wait_event_type = 'Lock';")" == "1" ]] && return 0
    sleep 0.1
  done
  echo "$failure" >&2
  return 1
}

cleanup() {
  status=$?
  trap - EXIT
  cleanup_status=0
  if [[ "$CREATED_USER" == "1" ]]; then
    if ! postgres_query "delete from public.users where id = '$USER_ID' and email = '$USER_EMAIL';" >/dev/null; then
      echo "Failed to remove the authentication generation fixture." >&2
      cleanup_status=1
    elif [[ "$(postgres_query "select count(*) from public.users where id = '$USER_ID' or email = '$USER_EMAIL';")" != "0" ]]; then
      echo "Authentication generation fixture remains after cleanup." >&2
      cleanup_status=1
    fi
  fi
  rm -rf "$TMP_DIR"
  if [[ "$cleanup_status" != "0" ]]; then exit "$cleanup_status"; fi
  exit "$status"
}
trap cleanup EXIT

# Read-only preflight precedes every fixture mutation.
preflight="$(postgres_query "
  select concat_ws(':',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'verification_codes'
        and column_name = 'verification_generation' and is_nullable = 'NO'
    )::int,
    (to_regprocedure('public.issue_auth_verification_code_v1(uuid,text,text,timestamptz)') is not null)::int,
    (to_regprocedure('public.finalize_auth_verification_attempt_v1(uuid,text,uuid,bigint,boolean,text,timestamptz,integer)') is not null)::int,
    (to_regprocedure('public.consume_signup_password_handoff_v1(uuid,bigint,text,text,bigint)') is not null)::int,
    (not has_table_privilege('service_role', 'public.verification_codes', 'select'))::int
  );")"
if [[ "$preflight" != "1:1:1:1:1" ]]; then
  echo "Migration 246 schema, RPCs, or direct-access revocation is not installed." >&2
  exit 1
fi

collision_count="$(postgres_query "select count(*) from public.users where id = '$USER_ID' or email = '$USER_EMAIL';")"
if [[ "$collision_count" != "0" ]]; then
  echo "Refusing to overwrite an existing authentication generation fixture identity." >&2
  exit 1
fi

postgres_query "insert into public.users (id, email, role)
  values ('$USER_ID', '$USER_EMAIL', 'student');" >/dev/null
CREATED_USER=1

# Session A observes generation one before bcrypt. Session B issues generation
# two before A finalizes, so the stale comparison must never mint a handoff.
service_rpc "select public.issue_auth_verification_code_v1(
  '$USER_ID', 'signup', '$CODE_HASH', clock_timestamp() + interval '10 minutes'
);" >/dev/null
candidate_one="$(service_rpc "select public.get_latest_auth_verification_code_v1('$USER_ID', 'signup');")"
candidate_one_id="$(jq -r '.id' <<<"$candidate_one")"
candidate_one_generation="$(jq -r '.generation' <<<"$candidate_one")"
service_rpc "select public.issue_auth_verification_code_v1(
  '$USER_ID', 'signup', '$CODE_HASH', clock_timestamp() + interval '10 minutes'
);" >/dev/null
stale_finalize="$(service_rpc "select public.finalize_auth_verification_attempt_v1(
  '$USER_ID', 'signup', '$candidate_one_id', $candidate_one_generation,
  true, '$HANDOFF_ONE', clock_timestamp() + interval '10 minutes', 5
);")"
if ! jq -e '.ok == false' <<<"$stale_finalize" >/dev/null; then
  echo "A superseded code minted a handoff." >&2
  exit 1
fi

# Finalization completes while retaining the user lock in session A. The
# observed advisory barrier proves that ordering before session B starts; B's
# observed Lock wait proves issuance serialized behind A. Once A commits, B
# issues a new generation and must invalidate A's minted handoff.
candidate_two="$(service_rpc "select public.get_latest_auth_verification_code_v1('$USER_ID', 'signup');")"
candidate_two_id="$(jq -r '.id' <<<"$candidate_two")"
candidate_two_generation="$(jq -r '.generation' <<<"$candidate_two")"
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
  -c "begin;
      set local role service_role;
      set local application_name = 'auth-generation-finalizer';
      select public.finalize_auth_verification_attempt_v1(
        '$USER_ID', 'signup', '$candidate_two_id', $candidate_two_generation,
        true, '$HANDOFF_TWO', clock_timestamp() + interval '10 minutes', 5
      );
      select pg_advisory_xact_lock(246246);
      select pg_sleep(8);
      commit;" >"$TMP_DIR/finalize.json" &
finalize_pid=$!

for _ in {1..80}; do
  [[ "$(postgres_query "select count(*) from pg_locks where locktype = 'advisory' and objid = 246246 and granted;")" == "1" ]] && break
  sleep 0.1
done
if [[ "$(postgres_query "select count(*) from pg_locks where locktype = 'advisory' and objid = 246246 and granted;")" != "1" ]]; then
  echo "Finalization barrier was not observed." >&2
  exit 1
fi

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
  -c "set application_name = 'auth-generation-issuer';
      set role service_role;
      select public.issue_auth_verification_code_v1(
        '$USER_ID', 'signup', '$CODE_HASH', clock_timestamp() + interval '10 minutes'
      );" >"$TMP_DIR/issue.json" &
issue_pid=$!
for _ in {1..40}; do
  [[ "$(postgres_query "select count(*) from pg_stat_activity where application_name = 'auth-generation-issuer' and wait_event_type = 'Lock';")" == "1" ]] && break
  sleep 0.1
done
if [[ "$(postgres_query "select count(*) from pg_stat_activity where application_name = 'auth-generation-issuer' and wait_event_type = 'Lock';")" != "1" ]]; then
  echo "Issuance was not observed waiting behind finalization." >&2
  exit 1
fi
wait "$finalize_pid"
wait "$issue_pid"

if ! sed '/^$/d' "$TMP_DIR/finalize.json" | head -n 1 | jq -e '.ok == true' >/dev/null; then
  echo "Serialized finalization did not complete." >&2
  exit 1
fi
if ! jq -e '.ok == true' "$TMP_DIR/issue.json" >/dev/null; then
  echo "Serialized resend did not complete." >&2
  exit 1
fi
if [[ -n "$(service_rpc "select public.inspect_latest_auth_handoff_v1('signup', '$HANDOFF_TWO');")" ]]; then
  echo "A handoff minted before a resend remained current." >&2
  exit 1
fi

# Repeated wrong attempts respect the atomic one-attempt limit.
latest="$(service_rpc "select public.get_latest_auth_verification_code_v1('$USER_ID', 'signup');")"
latest_id="$(jq -r '.id' <<<"$latest")"
latest_generation="$(jq -r '.generation' <<<"$latest")"
for worker in 1 2; do
  service_rpc "select public.finalize_auth_verification_attempt_v1(
    '$USER_ID', 'signup', '$latest_id', $latest_generation,
    false, null, null, 1
  );" >"$TMP_DIR/wrong-$worker.json"
done
if ! jq -s -e 'all(.[]; .ok == false)' "$TMP_DIR"/wrong-*.json >/dev/null; then
  echo "A wrong verification attempt was accepted." >&2
  exit 1
fi
attempts="$(service_rpc "select (public.get_latest_auth_verification_code_v1('$USER_ID', 'signup')->>'attempts')::int;")"
if [[ "$attempts" != "1" ]]; then
  echo "Wrong attempts exceeded the atomic limit." >&2
  exit 1
fi

# A finalization that begins before expiry but waits on the exact user lock
# must use a fresh post-lock clock and leave the code untouched.
service_rpc "select public.issue_auth_verification_code_v1(
  '$USER_ID', 'signup', '$CODE_HASH', clock_timestamp() + interval '5 seconds'
);" >/dev/null
expiring_code="$(service_rpc "select public.get_latest_auth_verification_code_v1('$USER_ID', 'signup');")"
expiring_code_id="$(jq -r '.id' <<<"$expiring_code")"
expiring_generation="$(jq -r '.generation' <<<"$expiring_code")"
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
  -c "begin;
      set local application_name = 'auth-generation-finalize-blocker';
      select 1 from public.users where id = '$USER_ID' for update;
      select pg_advisory_xact_lock(246247);
      select pg_sleep(7);
      commit;" >"$TMP_DIR/finalize-expiry-blocker.txt" &
finalize_blocker_pid=$!
wait_for_advisory_barrier 246247 "Finalization expiry blocker was not observed."
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
  -c "set application_name = 'auth-generation-expiring-finalizer';
      set role service_role;
      select public.finalize_auth_verification_attempt_v1(
        '$USER_ID', 'signup', '$expiring_code_id', $expiring_generation,
        true, '$HANDOFF_THREE', clock_timestamp() + interval '10 minutes', 5
      );" >"$TMP_DIR/finalize-expiry.json" &
finalize_expiry_pid=$!
wait_for_application_lock auth-generation-expiring-finalizer \
  "Expiring finalization was not observed waiting on the user lock."
if [[ "$(postgres_query "select (expires_at > clock_timestamp())::int from public.verification_codes where id = '$expiring_code_id';")" != "1" ]]; then
  echo "Finalization lock wait was not observed before code expiry." >&2
  exit 1
fi
wait "$finalize_blocker_pid"
wait "$finalize_expiry_pid"
if ! jq -e '.ok == false' "$TMP_DIR/finalize-expiry.json" >/dev/null; then
  echo "A finalization accepted a code that expired while waiting for its lock." >&2
  exit 1
fi
after_expired_finalize="$(service_rpc "select public.get_latest_auth_verification_code_v1('$USER_ID', 'signup');")"
if ! jq -e '.used_at == null and .attempts == 0' <<<"$after_expired_finalize" >/dev/null; then
  echo "Expired finalization mutated the verification code." >&2
  exit 1
fi

# Mint a short signup handoff, then prove direct signup consumption refuses it
# after an observed user-lock wait carries it past expiry.
service_rpc "select public.issue_auth_verification_code_v1(
  '$USER_ID', 'signup', '$CODE_HASH', clock_timestamp() + interval '10 minutes'
);" >/dev/null
signup_expiring="$(service_rpc "select public.get_latest_auth_verification_code_v1('$USER_ID', 'signup');")"
signup_expiring_id="$(jq -r '.id' <<<"$signup_expiring")"
signup_expiring_generation="$(jq -r '.generation' <<<"$signup_expiring")"
service_rpc "select public.finalize_auth_verification_attempt_v1(
  '$USER_ID', 'signup', '$signup_expiring_id', $signup_expiring_generation,
  true, '$HANDOFF_FOUR', clock_timestamp() + interval '5 seconds', 5
);" >/dev/null
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
  -c "begin;
      set local application_name = 'auth-generation-signup-consume-blocker';
      select 1 from public.users where id = '$USER_ID' for update;
      select pg_advisory_xact_lock(246248);
      select pg_sleep(7);
      commit;" >"$TMP_DIR/signup-expiry-blocker.txt" &
signup_blocker_pid=$!
wait_for_advisory_barrier 246248 "Signup consume expiry blocker was not observed."
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
  -c "set application_name = 'auth-generation-expiring-signup-consumer';
      set role service_role;
      select public.consume_signup_password_handoff_v1(
        '$USER_ID', $signup_expiring_generation, '$HANDOFF_FOUR',
        'unexpected-signup-password', 1
      );" >"$TMP_DIR/signup-expiry-result.txt" &
signup_expiry_pid=$!
wait_for_application_lock auth-generation-expiring-signup-consumer \
  "Expiring signup consume was not observed waiting on the user lock."
if [[ "$(postgres_query "select (handoff_expires_at > clock_timestamp())::int from public.verification_codes where id = '$signup_expiring_id';")" != "1" ]]; then
  echo "Signup consume lock wait was not observed before handoff expiry." >&2
  exit 1
fi
wait "$signup_blocker_pid"
wait "$signup_expiry_pid"
if [[ -n "$(sed '/^$/d' "$TMP_DIR/signup-expiry-result.txt")" ]]; then
  echo "Signup password installation accepted a handoff that expired while waiting." >&2
  exit 1
fi
signup_expired_state="$(postgres_query "select concat_ws(':',
  (password_hash is null)::int,
  auth_credential_version,
  (select (handoff_consumed_at is null)::int from public.verification_codes
    where id = '$signup_expiring_id')
  ) from public.users where id = '$USER_ID';")"
if [[ "$signup_expired_state" != "1:1:1" ]]; then
  echo "Refused signup consumption changed credentials or handoff state." >&2
  exit 1
fi

# Direct signup consume positive control and replay refusal.
service_rpc "select public.issue_auth_verification_code_v1(
  '$USER_ID', 'signup', '$CODE_HASH', clock_timestamp() + interval '10 minutes'
);" >/dev/null
signup_current="$(service_rpc "select public.get_latest_auth_verification_code_v1('$USER_ID', 'signup');")"
signup_current_id="$(jq -r '.id' <<<"$signup_current")"
signup_current_generation="$(jq -r '.generation' <<<"$signup_current")"
service_rpc "select public.finalize_auth_verification_attempt_v1(
  '$USER_ID', 'signup', '$signup_current_id', $signup_current_generation,
  true, '$HANDOFF_FIVE', clock_timestamp() + interval '10 minutes', 5
);" >/dev/null
signup_result="$(service_rpc "select public.consume_signup_password_handoff_v1(
  '$USER_ID', $signup_current_generation, '$HANDOFF_FIVE', 'signup-password', 1
);")"
if [[ "$signup_result" != "1" ]]; then
  echo "Direct signup password consumption did not succeed." >&2
  exit 1
fi
signup_replay="$(service_rpc "select public.consume_signup_password_handoff_v1(
  '$USER_ID', $signup_current_generation, '$HANDOFF_FIVE', 'unexpected-replay', 1
);")"
if [[ -n "$signup_replay" ]]; then
  echo "Consumed signup handoff remained replayable." >&2
  exit 1
fi

# A short reset handoff must likewise fail after an observed lock wait without
# changing the password, credential epoch, existing session, or handoff.
service_rpc "select public.issue_auth_session(
  '$USER_ID', 1, repeat('7', 64), 'password', null,
  clock_timestamp() + interval '1 day', null
);" >/dev/null
service_rpc "select public.issue_auth_verification_code_v1(
  '$USER_ID', 'reset_password', '$CODE_HASH', clock_timestamp() + interval '10 minutes'
);" >/dev/null
reset_expiring="$(service_rpc "select public.get_latest_auth_verification_code_v1('$USER_ID', 'reset_password');")"
reset_expiring_id="$(jq -r '.id' <<<"$reset_expiring")"
reset_expiring_generation="$(jq -r '.generation' <<<"$reset_expiring")"
service_rpc "select public.finalize_auth_verification_attempt_v1(
  '$USER_ID', 'reset_password', '$reset_expiring_id', $reset_expiring_generation,
  true, '$HANDOFF_SIX', clock_timestamp() + interval '5 seconds', 5
);" >/dev/null
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
  -c "begin;
      set local application_name = 'auth-generation-reset-consume-blocker';
      select 1 from public.users where id = '$USER_ID' for update;
      select pg_advisory_xact_lock(246249);
      select pg_sleep(7);
      commit;" >"$TMP_DIR/reset-expiry-blocker.txt" &
reset_blocker_pid=$!
wait_for_advisory_barrier 246249 "Reset consume expiry blocker was not observed."
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
  -c "set application_name = 'auth-generation-expiring-reset-consumer';
      set role service_role;
      select public.consume_latest_password_reset_and_revoke_sessions_v1(
        '$USER_ID', $reset_expiring_generation, '$HANDOFF_SIX', 'unexpected-reset-password'
      );" >"$TMP_DIR/reset-expiry-result.txt" &
reset_expiry_pid=$!
wait_for_application_lock auth-generation-expiring-reset-consumer \
  "Expiring reset consume was not observed waiting on the user lock."
if [[ "$(postgres_query "select (handoff_expires_at > clock_timestamp())::int from public.verification_codes where id = '$reset_expiring_id';")" != "1" ]]; then
  echo "Reset consume lock wait was not observed before handoff expiry." >&2
  exit 1
fi
wait "$reset_blocker_pid"
wait "$reset_expiry_pid"
if [[ -n "$(sed '/^$/d' "$TMP_DIR/reset-expiry-result.txt")" ]]; then
  echo "Password reset accepted a handoff that expired while waiting." >&2
  exit 1
fi
reset_expired_state="$(postgres_query "select concat_ws(':',
  (password_hash = 'signup-password')::int,
  auth_credential_version,
  (select count(*) from public.auth_sessions where user_id = '$USER_ID'),
  (select (handoff_consumed_at is null)::int from public.verification_codes
    where id = '$reset_expiring_id')
  ) from public.users where id = '$USER_ID';")"
if [[ "$reset_expired_state" != "1:1:1:1" ]]; then
  echo "Refused reset consumption changed credential, session, or handoff state." >&2
  exit 1
fi

# Direct reset consume positive control and replay refusal.
service_rpc "select public.issue_auth_verification_code_v1(
  '$USER_ID', 'reset_password', '$CODE_HASH', clock_timestamp() + interval '10 minutes'
);" >/dev/null
reset_current="$(service_rpc "select public.get_latest_auth_verification_code_v1('$USER_ID', 'reset_password');")"
reset_current_id="$(jq -r '.id' <<<"$reset_current")"
reset_current_generation="$(jq -r '.generation' <<<"$reset_current")"
service_rpc "select public.finalize_auth_verification_attempt_v1(
  '$USER_ID', 'reset_password', '$reset_current_id', $reset_current_generation,
  true, '$HANDOFF_THREE', clock_timestamp() + interval '10 minutes', 5
);" >/dev/null
reset_result="$(service_rpc "select public.consume_latest_password_reset_and_revoke_sessions_v1(
  '$USER_ID', $reset_current_generation, '$HANDOFF_THREE', 'reset-password'
);")"
if [[ "$reset_result" != "2" ]]; then
  echo "Direct reset password consumption did not succeed." >&2
  exit 1
fi
reset_replay="$(service_rpc "select public.consume_latest_password_reset_and_revoke_sessions_v1(
  '$USER_ID', $reset_current_generation, '$HANDOFF_THREE', 'unexpected-reset-replay'
);")"
if [[ -n "$reset_replay" ]]; then
  echo "Consumed reset handoff remained replayable." >&2
  exit 1
fi
reset_success_state="$(postgres_query "select concat_ws(':',
  (password_hash = 'reset-password')::int,
  auth_credential_version,
  (select count(*) from public.auth_sessions where user_id = '$USER_ID')
  ) from public.users where id = '$USER_ID';")"
if [[ "$reset_success_state" != "1:2:0" ]]; then
  echo "Successful direct reset did not atomically update credentials and sessions." >&2
  exit 1
fi

echo "Authentication verification generation database contract passed."
