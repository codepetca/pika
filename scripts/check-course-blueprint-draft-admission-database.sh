#!/usr/bin/env bash

set -euo pipefail

DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Local Supabase database container is not running." >&2
  exit 1
fi

TEACHER_ID="c1390000-0000-4000-8000-000000000002"
TMP_DIR="$(mktemp -d)"

cleanup() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
    -c "delete from public.users where id = '$TEACHER_ID';" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "delete from public.users where id = '$TEACHER_ID';
      insert into public.users (id, email, role)
      values ('$TEACHER_ID', 'blueprint-draft-admission@example.invalid', 'teacher');" >/dev/null

acquire() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
    -c "set role service_role;
        select public.acquire_course_blueprint_draft_slot('$TEACHER_ID');"
}

release_result() {
  local lease_token="$1"
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
    -c "set role service_role;
        select public.release_course_blueprint_draft_slot(
          '$TEACHER_ID', '$lease_token'
        );"
}

release() {
  local result
  result="$(release_result "$1")"
  if [[ "$result" != "t" ]]; then
    echo "Expected the active Blueprint draft lease to release." >&2
    exit 1
  fi
}

run_race() {
  local label="$1"
  local worker_a_file="$TMP_DIR/$label-worker-a.json"
  local worker_b_file="$TMP_DIR/$label-worker-b.json"
  local worker_a_pid
  local worker_b_pid
  local success_count=0
  local active_count=0
  local worker_file

  RACE_WINNER_FILE=""
  acquire >"$worker_a_file" &
  worker_a_pid=$!
  acquire >"$worker_b_file" &
  worker_b_pid=$!
  wait "$worker_a_pid"
  wait "$worker_b_pid"

  for worker_file in "$worker_a_file" "$worker_b_file"; do
    if jq -e '.ok == true' "$worker_file" >/dev/null; then
      success_count=$((success_count + 1))
      RACE_WINNER_FILE="$worker_file"
    elif jq -e '.ok == false and .reason == "active"' "$worker_file" >/dev/null; then
      active_count=$((active_count + 1))
    fi
  done

  if [[ "$success_count" -ne 1 || "$active_count" -ne 1 ]]; then
    echo "Expected one acquired lease and one active refusal in $label race." >&2
    cat "$worker_a_file" "$worker_b_file" >&2
    exit 1
  fi
}

# An exposed public table must remain private even when the function runs with
# elevated privileges. Only the service role may execute either RPC.
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "do \$contract\$
      declare
        client_role text;
        privilege text;
      begin
        if not (
          select relrowsecurity from pg_class
          where oid = 'public.course_blueprint_draft_admissions'::regclass
        ) then
          raise exception 'Blueprint draft admission RLS is disabled';
        end if;
        foreach client_role in array array['anon', 'authenticated', 'service_role'] loop
          foreach privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
            if has_table_privilege(
              client_role, 'public.course_blueprint_draft_admissions', privilege
            ) then
              raise exception 'Unexpected Blueprint admission table grant: %, %',
                client_role, privilege;
            end if;
          end loop;
        end loop;
        foreach client_role in array array['anon', 'authenticated'] loop
          if has_function_privilege(
            client_role, 'public.acquire_course_blueprint_draft_slot(uuid)', 'EXECUTE'
          ) or has_function_privilege(
            client_role, 'public.release_course_blueprint_draft_slot(uuid,uuid)', 'EXECUTE'
          ) then
            raise exception 'Blueprint admission RPC exposed to %', client_role;
          end if;
        end loop;
        if not has_function_privilege(
          'service_role', 'public.acquire_course_blueprint_draft_slot(uuid)', 'EXECUTE'
        ) or not has_function_privilege(
          'service_role', 'public.release_course_blueprint_draft_slot(uuid,uuid)', 'EXECUTE'
        ) then
          raise exception 'Blueprint admission RPC missing service-role execution';
        end if;
      end;
      \$contract\$;" >/dev/null

# Independent sessions contend while creating the first teacher row.
run_race "initial"
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "do \$contract\$
      begin
        if not exists (
          select 1 from public.course_blueprint_draft_admissions
          where teacher_id = '$TEACHER_ID'
            and active_lease_expires_at >= clock_timestamp() + interval '75 seconds'
            and cardinality(attempt_timestamps) = 1
        ) then
          raise exception 'Blueprint draft initial lease or attempt was not reserved';
        end if;
      end;
      \$contract\$;" >/dev/null
release "$(jq -r '.lease_token' "$RACE_WINNER_FILE")"

# A refused concurrent request consumes no attempt. Three successful starts
# fit in the rolling ten-minute window; the fourth must be refused.
for attempt in 2 3; do
  result="$(acquire)"
  if ! jq -e '.ok == true' <<<"$result" >/dev/null; then
    echo "Expected Blueprint draft attempt $attempt to acquire: $result" >&2
    exit 1
  fi
  release "$(jq -r '.lease_token' <<<"$result")"
done

fourth_result="$(acquire)"
if ! jq -e '.ok == false and .reason == "rate_limited"' <<<"$fourth_result" >/dev/null; then
  echo "Expected rolling fourth Blueprint draft attempt to be rate limited: $fourth_result" >&2
  exit 1
fi

# Once the oldest attempt ages out, exactly one new start is available.
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "update public.course_blueprint_draft_admissions
      set attempt_timestamps[1] = clock_timestamp() - interval '11 minutes'
      where teacher_id = '$TEACHER_ID';" >/dev/null
recovered_result="$(acquire)"
if ! jq -e '.ok == true' <<<"$recovered_result" >/dev/null; then
  echo "Expected an expired attempt to restore one Blueprint draft slot." >&2
  exit 1
fi
release "$(jq -r '.lease_token' <<<"$recovered_result")"
if ! jq -e '.ok == false and .reason == "rate_limited"' <<<"$(acquire)" >/dev/null; then
  echo "Expected the rolling window to reject another Blueprint draft." >&2
  exit 1
fi

# Two recent attempts on an existing row admit one concurrent third start.
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "delete from public.course_blueprint_draft_admissions
      where teacher_id = '$TEACHER_ID';
      insert into public.course_blueprint_draft_admissions (
        teacher_id, attempt_timestamps
      ) values (
        '$TEACHER_ID',
        array[clock_timestamp() - interval '2 minutes',
              clock_timestamp() - interval '1 minute']
      );" >/dev/null
run_race "existing-row"
release "$(jq -r '.lease_token' "$RACE_WINNER_FILE")"
if ! jq -e '.ok == false and .reason == "rate_limited"' <<<"$(acquire)" >/dev/null; then
  echo "Expected existing-row fourth Blueprint draft attempt to be rate limited." >&2
  exit 1
fi

# An expired token cannot release the replacement lease.
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "delete from public.course_blueprint_draft_admissions
      where teacher_id = '$TEACHER_ID';" >/dev/null
old_lease="$(acquire)"
old_lease_token="$(jq -r '.lease_token' <<<"$old_lease")"
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "update public.course_blueprint_draft_admissions
      set active_lease_expires_at = clock_timestamp() - interval '1 second'
      where teacher_id = '$TEACHER_ID';" >/dev/null
replacement_lease="$(acquire)"
replacement_lease_token="$(jq -r '.lease_token' <<<"$replacement_lease")"
if [[ "$(release_result "$old_lease_token")" != "f" ]]; then
  echo "Expected stale Blueprint draft token release to return false." >&2
  exit 1
fi
replacement_still_active="$(
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
    -c "select active_lease_token = '$replacement_lease_token'
        from public.course_blueprint_draft_admissions
        where teacher_id = '$TEACHER_ID';"
)"
if [[ "$replacement_still_active" != "t" ]]; then
  echo "Stale Blueprint draft token cleared the replacement lease." >&2
  exit 1
fi
release "$replacement_lease_token"

echo "Blueprint draft admission privacy, concurrency, rolling quota, and stale-token safety verified."
