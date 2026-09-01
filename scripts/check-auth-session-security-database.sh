#!/usr/bin/env bash

set -euo pipefail

DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Local Supabase database container is not running." >&2
  exit 1
fi

USER_ID="a1480000-0000-4000-8000-000000000001"
RATE_SCOPE="auth_contract"
RATE_HASH="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
RACE_HASH="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
HANDOFF_HASH="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
STALE_HASH="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
SIBLING_HASH="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
RACE_HANDOFF_ONE="1111111111111111111111111111111111111111111111111111111111111111"
RACE_HANDOFF_TWO="2222222222222222222222222222222222222222222222222222222222222222"
TMP_DIR="$(mktemp -d)"

cleanup() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
    -c "delete from public.auth_rate_limits
        where scope = '$RATE_SCOPE' and key_hash in ('$RATE_HASH', '$RACE_HASH', '$STALE_HASH');
        delete from public.users where id = '$USER_ID';" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

service_rpc() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
    -c "set role service_role; $1"
}

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "insert into public.auth_rate_limits (
        scope, key_hash, attempt_timestamps, updated_at
      ) values (
        '$RATE_SCOPE', '$STALE_HASH',
        array[clock_timestamp() - interval '2 days'],
        clock_timestamp() - interval '2 days'
      );" >/dev/null

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "delete from public.users where id = '$USER_ID';
      insert into public.users (id, email, role, password_hash)
      values ('$USER_ID', 'auth-contract@example.invalid', 'student', 'old-password-hash');

      do \$contract\$
      begin
        if has_table_privilege('anon', 'public.auth_sessions', 'select')
          or has_table_privilege('authenticated', 'public.auth_sessions', 'select') then
          raise exception 'browser roles can read auth sessions';
        end if;
        if not has_table_privilege('service_role', 'public.auth_sessions', 'select,delete')
          or has_table_privilege('service_role', 'public.auth_sessions', 'insert') then
          raise exception 'service role lacks auth session privileges';
        end if;
        if has_function_privilege(
          'anon',
          'public.consume_auth_rate_limit(text,text,integer,integer)',
          'execute'
        ) or has_function_privilege(
          'authenticated',
          'public.consume_password_reset_and_revoke_sessions(uuid,text,text)',
          'execute'
        ) then
          raise exception 'browser roles can execute auth security functions';
        end if;
        if has_function_privilege(
          'anon',
          'public.issue_auth_session(uuid,bigint,text,text,text,timestamptz,text)',
          'execute'
        ) or not has_function_privilege(
          'service_role',
          'public.issue_auth_session(uuid,bigint,text,text,text,timestamptz,text)',
          'execute'
        ) then
          raise exception 'auth session issuance privileges are invalid';
        end if;
      end;
      \$contract\$;" >/dev/null

first="$(service_rpc "select public.consume_auth_rate_limit('$RATE_SCOPE', '$RATE_HASH', 2, 600);")"
second="$(service_rpc "select public.consume_auth_rate_limit('$RATE_SCOPE', '$RATE_HASH', 2, 600);")"
third="$(service_rpc "select public.consume_auth_rate_limit('$RATE_SCOPE', '$RATE_HASH', 2, 600);")"
if ! jq -e '.ok == true' <<<"$first" >/dev/null \
  || ! jq -e '.ok == true' <<<"$second" >/dev/null \
  || ! jq -e '.ok == false and .retry_after_seconds > 0' <<<"$third" >/dev/null; then
  echo "Authentication rolling rate limit contract failed." >&2
  exit 1
fi

if docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
  -c "select 1 from public.auth_rate_limits
      where scope = '$RATE_SCOPE' and key_hash = '$STALE_HASH';" | grep -q 1; then
  echo "Stale authentication rate-limit metadata was not removed." >&2
  exit 1
fi

service_rpc "select public.clear_auth_rate_limit('$RATE_SCOPE', '$RATE_HASH');" >/dev/null
after_clear="$(service_rpc "select public.consume_auth_rate_limit('$RATE_SCOPE', '$RATE_HASH', 2, 600);")"
if ! jq -e '.ok == true' <<<"$after_clear" >/dev/null; then
  echo "Authentication rate limit did not clear." >&2
  exit 1
fi

service_rpc "select public.clear_auth_rate_limit('$RATE_SCOPE', '$RACE_HASH');" >/dev/null
for worker in 1 2 3; do
  service_rpc "select public.consume_auth_rate_limit('$RATE_SCOPE', '$RACE_HASH', 1, 600);" \
    >"$TMP_DIR/race-$worker.json" &
done
wait

race_successes="$(jq -s '[.[] | select(.ok == true)] | length' "$TMP_DIR"/race-*.json)"
race_refusals="$(jq -s '[.[] | select(.ok == false)] | length' "$TMP_DIR"/race-*.json)"
if [[ "$race_successes" != "1" || "$race_refusals" != "2" ]]; then
  echo "Concurrent authentication limiter admitted the wrong number of attempts." >&2
  exit 1
fi

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "insert into public.verification_codes (
        user_id, code_hash, purpose, expires_at, used_at,
        handoff_token_hash, handoff_expires_at
      ) values (
        '$USER_ID', 'unused-code-hash', 'reset_password',
        clock_timestamp() + interval '10 minutes', clock_timestamp(),
        '$HANDOFF_HASH', clock_timestamp() + interval '10 minutes'
      ), (
        '$USER_ID', 'unused-sibling-code-hash', 'reset_password',
        clock_timestamp() + interval '10 minutes', clock_timestamp(),
        '$SIBLING_HASH', clock_timestamp() + interval '10 minutes'
      );
      insert into public.auth_sessions (
        user_id, token_hash, auth_source, credential_version, expires_at
      ) values
        ('$USER_ID', repeat('1', 64), 'password', 1, clock_timestamp() + interval '1 day'),
        ('$USER_ID', repeat('2', 64), 'password', 1, clock_timestamp() + interval '1 day');" >/dev/null

reset_result="$(service_rpc "select public.consume_password_reset_and_revoke_sessions(
  '$USER_ID', '$HANDOFF_HASH', 'new-password-hash'
);")"
if [[ "$reset_result" != "2" ]]; then
  echo "Password reset transaction did not succeed." >&2
  exit 1
fi

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "do \$contract\$
      begin
        if (select password_hash from public.users where id = '$USER_ID') <> 'new-password-hash' then
          raise exception 'password hash was not updated';
        end if;
        if (select auth_credential_version from public.users where id = '$USER_ID') <> 2 then
          raise exception 'credential version was not advanced';
        end if;
        if exists (select 1 from public.auth_sessions where user_id = '$USER_ID') then
          raise exception 'password reset did not revoke every session';
        end if;
        if not exists (
          select 1 from public.verification_codes
          where user_id = '$USER_ID'
            and handoff_token_hash = '$HANDOFF_HASH'
            and handoff_consumed_at is not null
        ) then
          raise exception 'password reset handoff was not consumed';
        end if;
        if exists (
          select 1 from public.verification_codes
          where user_id = '$USER_ID'
            and purpose = 'reset_password'
            and handoff_consumed_at is null
        ) then
          raise exception 'sibling password reset handoff remained active';
        end if;
      end;
      \$contract\$;" >/dev/null

retry_result="$(service_rpc "select public.consume_password_reset_and_revoke_sessions(
  '$USER_ID', '$SIBLING_HASH', 'unexpected-password-hash'
);")"
if [[ -n "$retry_result" ]]; then
  echo "A sibling password reset handoff remained replayable." >&2
  exit 1
fi

stale_issue="$(service_rpc "select public.issue_auth_session(
  '$USER_ID', 1, repeat('3', 64), 'password', null,
  clock_timestamp() + interval '1 day', null
);")"
if [[ "$stale_issue" != "f" ]]; then
  echo "A login verified before password reset issued a stale session." >&2
  exit 1
fi

current_issue="$(service_rpc "select public.issue_auth_session(
  '$USER_ID', 2, repeat('4', 64), 'password', null,
  clock_timestamp() + interval '1 day', null
);")"
if [[ "$current_issue" != "t" ]]; then
  echo "Current credential version could not issue a session." >&2
  exit 1
fi

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "insert into public.verification_codes (
        user_id, code_hash, purpose, expires_at, used_at,
        handoff_token_hash, handoff_expires_at
      ) values
      (
        '$USER_ID', 'race-code-one', 'reset_password',
        clock_timestamp() + interval '10 minutes', clock_timestamp(),
        '$RACE_HANDOFF_ONE', clock_timestamp() + interval '10 minutes'
      ),
      (
        '$USER_ID', 'race-code-two', 'reset_password',
        clock_timestamp() + interval '10 minutes', clock_timestamp(),
        '$RACE_HANDOFF_TWO', clock_timestamp() + interval '10 minutes'
      );" >/dev/null

service_rpc "select public.consume_password_reset_and_revoke_sessions(
  '$USER_ID', '$RACE_HANDOFF_ONE', 'race-password-one'
);" >"$TMP_DIR/reset-race-one.txt" &
service_rpc "select public.consume_password_reset_and_revoke_sessions(
  '$USER_ID', '$RACE_HANDOFF_TWO', 'race-password-two'
);" >"$TMP_DIR/reset-race-two.txt" &
wait

race_reset_results="$(sed '/^$/d' "$TMP_DIR"/reset-race-*.txt)"
if [[ "$(wc -l <<<"$race_reset_results" | tr -d ' ')" != "1" \
  || "$race_reset_results" != "3" ]]; then
  echo "Concurrent sibling password reset handoffs did not produce one winner." >&2
  exit 1
fi

echo "Authentication issuance fencing, session revocation, layered rate limiting, privileges, and reset atomicity verified."
