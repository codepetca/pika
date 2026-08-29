#!/usr/bin/env bash

set -euo pipefail

DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Local Supabase database container is not running." >&2
  exit 1
fi

TEACHER_ID="c1390000-0000-4000-8000-000000000001"
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
      values ('$TEACHER_ID', 'course-guide-rate-limit@example.invalid', 'teacher');" >/dev/null

acquire() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
    -c "set role service_role;
        select public.acquire_course_guide_import_extraction_slot('$TEACHER_ID');"
}

release() {
  local lease_token="$1"
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
    -c "set role service_role;
        select public.release_course_guide_import_extraction_slot(
          '$TEACHER_ID', '$lease_token'
        );" >/dev/null
}

release_result() {
  local lease_token="$1"
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
    -c "set role service_role;
        select public.release_course_guide_import_extraction_slot(
          '$TEACHER_ID', '$lease_token'
        );"
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

# Independent database sessions must contend while creating the teacher row.
run_race "initial"
winner_file="$RACE_WINNER_FILE"

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "do \$contract\$
      begin
        if not exists (
          select 1
          from public.course_guide_import_rate_limits
          where teacher_id = '$TEACHER_ID'
            and active_lease_expires_at >= clock_timestamp() + interval '75 seconds'
        ) then
          raise exception 'Course Guide extraction lease lacks deadline margin';
        end if;
      end;
      \$contract\$;" >/dev/null

release "$(jq -r '.lease_token' "$winner_file")"

# The successful race was attempt one. Two more released acquisitions are allowed.
for attempt in 2 3; do
  result="$(acquire)"
  if ! jq -e '.ok == true' <<<"$result" >/dev/null; then
    echo "Expected attempt $attempt to acquire a lease: $result" >&2
    exit 1
  fi
  release "$(jq -r '.lease_token' <<<"$result")"
done

# Simulate the old fixed-window boundary while preserving three genuinely
# recent attempts. A rolling limiter must still reject the next provider call.
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "update public.course_guide_import_rate_limits
      set window_started_at = clock_timestamp() - interval '10 minutes 1 second'
      where teacher_id = '$TEACHER_ID';" >/dev/null

fourth_result="$(acquire)"
if ! jq -e '.ok == false and .reason == "rate_limited"' <<<"$fourth_result" >/dev/null; then
  echo "Expected the rolling fourth provider attempt to be rate limited: $fourth_result" >&2
  exit 1
fi

# Mirror the 140-to-141 backfill outcome: an old fixed-window start with recent
# activity must remain conservatively rate limited after migration.
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "delete from public.course_guide_import_rate_limits
      where teacher_id = '$TEACHER_ID';
      insert into public.course_guide_import_rate_limits (
        teacher_id, window_started_at, attempt_count, attempt_timestamps,
        active_lease_token, active_lease_expires_at, updated_at
      ) values (
        '$TEACHER_ID',
        clock_timestamp() - interval '11 minutes',
        3,
        array_fill(clock_timestamp() - interval '30 seconds', array[3]),
        null,
        null,
        clock_timestamp() - interval '30 seconds'
      );" >/dev/null

backfilled_result="$(acquire)"
if ! jq -e '.ok == false and .reason == "rate_limited"' <<<"$backfilled_result" >/dev/null; then
  echo "Expected the conservative 140-to-141 backfill to remain rate limited." >&2
  exit 1
fi

# Two recent attempts on an existing row must admit exactly one concurrent
# third attempt, then reject the next acquisition within the rolling window.
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "delete from public.course_guide_import_rate_limits
      where teacher_id = '$TEACHER_ID';
      insert into public.course_guide_import_rate_limits (
        teacher_id, window_started_at, attempt_count, attempt_timestamps,
        active_lease_token, active_lease_expires_at, updated_at
      ) values (
        '$TEACHER_ID',
        clock_timestamp() - interval '2 minutes',
        2,
        array[
          clock_timestamp() - interval '2 minutes',
          clock_timestamp() - interval '1 minute'
        ],
        null,
        null,
        clock_timestamp() - interval '1 minute'
      );" >/dev/null

run_race "existing-row"
release "$(jq -r '.lease_token' "$RACE_WINNER_FILE")"
existing_row_fourth_result="$(acquire)"
if ! jq -e '.ok == false and .reason == "rate_limited"' \
  <<<"$existing_row_fourth_result" >/dev/null; then
  echo "Expected the existing-row fourth attempt to be rate limited." >&2
  exit 1
fi

# Replacing an expired lease must make the old release token harmless.
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "delete from public.course_guide_import_rate_limits
      where teacher_id = '$TEACHER_ID';" >/dev/null
old_lease="$(acquire)"
old_lease_token="$(jq -r '.lease_token' <<<"$old_lease")"
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "update public.course_guide_import_rate_limits
      set active_lease_expires_at = clock_timestamp() - interval '1 second'
      where teacher_id = '$TEACHER_ID';" >/dev/null
replacement_lease="$(acquire)"
replacement_lease_token="$(jq -r '.lease_token' <<<"$replacement_lease")"

if [[ "$(release_result "$old_lease_token")" != "f" ]]; then
  echo "Expected an expired lease token release to return false." >&2
  exit 1
fi

replacement_still_active="$(
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 \
    -c "select active_lease_token = '$replacement_lease_token'
        from public.course_guide_import_rate_limits
        where teacher_id = '$TEACHER_ID';"
)"
if [[ "$replacement_still_active" != "t" ]]; then
  echo "Expired lease release cleared the replacement lease." >&2
  exit 1
fi
release "$replacement_lease_token"

echo "Course Guide shared lease, rolling window, and stale-token safety verified."
