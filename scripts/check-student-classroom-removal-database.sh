#!/usr/bin/env bash
set -euo pipefail

# Rollback-only fixture; never applies migrations or accepts a hosted URL.
REMOVAL_DB_CONTAINER="${REMOVAL_DB_CONTAINER:-supabase_db_pika}"
REMOVAL_DATABASE_NAME="${REMOVAL_DATABASE_NAME:-postgres}"
if [[ "$REMOVAL_DB_CONTAINER" != supabase_db_pika ]] \
  || [[ "$(docker inspect "$REMOVAL_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != pika ]] \
  || [[ ! "$REMOVAL_DATABASE_NAME" =~ ^(postgres|pika_removal_164_[a-z0-9_]+)$ ]]; then
  echo 'Refusing unexpected classroom-removal test target.' >&2
  exit 2
fi

docker exec -i "$REMOVAL_DB_CONTAINER" psql -U postgres -d "$REMOVAL_DATABASE_NAME" \
  -X -v ON_ERROR_STOP=1 < scripts/check-student-classroom-removal-database.sql

# Competing purge locks must return a retryable conflict, not a deadlock or wait.
for removal_lock_key in \
  'pika-classroom-operation:c1640000-0000-4000-8000-000000000010' \
  'pika-student-purge-subject:c1640000-0000-4000-8000-000000000003'; do
  removal_probe="removal_164_lock_probe_$$"
  docker exec -e PGAPPNAME="$removal_probe" "$REMOVAL_DB_CONTAINER" \
    psql -U postgres -d "$REMOVAL_DATABASE_NAME" -X -v ON_ERROR_STOP=1 \
    -c "begin; select pg_advisory_xact_lock(hashtextextended('$removal_lock_key',0)); select pg_sleep(3); rollback;" >/dev/null &
  removal_holder=$!
  removal_ready=f
  for _ in {1..30}; do
    removal_ready="$(docker exec "$REMOVAL_DB_CONTAINER" psql -U postgres -d "$REMOVAL_DATABASE_NAME" -X -Atc \
      "select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.datname=current_database() and a.application_name='$removal_probe' and l.locktype='advisory' and l.granted)")"
    [[ "$removal_ready" == t ]] && break
    sleep 0.05
  done
  if [[ "$removal_ready" != t ]]; then
    wait "$removal_holder"
    echo 'Lock probe failed to acquire its test lock.' >&2
    exit 1
  fi
  docker exec -i "$REMOVAL_DB_CONTAINER" psql -U postgres -d "$REMOVAL_DATABASE_NAME" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local statement_timeout='1s';
do $$ begin
  begin
    perform private.try_lock_classroom_membership_change(
      'c1640000-0000-4000-8000-000000000010',
      'c1640000-0000-4000-8000-000000000003'
    );
    raise exception 'Expected a retryable busy conflict';
  exception when serialization_failure then null;
  end;
end $$;
rollback;
SQL
  wait "$removal_holder"
done

# Hold a real removal transaction open after it has revoked enrollment. Grade
# inserts and mark-changing updates must be rejected. Earlier archive-revision
# triggers may wait for removal to commit before the enrollment check runs.
# Exercise each operation during a separate removal; neither mark may persist.
docker exec -i "$REMOVAL_DB_CONTAINER" psql -U postgres -d "$REMOVAL_DATABASE_NAME" \
  -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
insert into public.users (id, email, role) values
  ('d1640000-0000-4000-8000-000000000001', 'grade-race-teacher-164@example.invalid', 'teacher'),
  ('d1640000-0000-4000-8000-000000000002', 'grade-race-student-164@example.invalid', 'student');
insert into public.classrooms (
  id, teacher_id, title, class_code, allow_enrollment, join_policy
) values (
  'd1640000-0000-4000-8000-000000000010',
  'd1640000-0000-4000-8000-000000000001',
  'Removal grade race fixture',
  'D164RACE',
  true,
  'roster'
);
insert into public.classroom_roster (id, classroom_id, email) values (
  'd1640000-0000-4000-8000-000000000011',
  'd1640000-0000-4000-8000-000000000010',
  'grade-race-student-164@example.invalid'
);
insert into public.classroom_enrollments (id, classroom_id, student_id) values (
  'd1640000-0000-4000-8000-000000000012',
  'd1640000-0000-4000-8000-000000000010',
  'd1640000-0000-4000-8000-000000000002'
);
insert into public.gradebook_items (
  id, classroom_id, title, points_possible, gradebook_weight,
  include_in_final, created_by
) values (
  'd1640000-0000-4000-8000-000000000013',
  'd1640000-0000-4000-8000-000000000010',
  'Removal race item',
  10,
  10,
  true,
  'd1640000-0000-4000-8000-000000000001'
);
insert into public.gradebook_score_overrides (
  id, classroom_id, student_id, assessment_type, assessment_id, earned, created_by
) values (
  'd1640000-0000-4000-8000-000000000014',
  'd1640000-0000-4000-8000-000000000010',
  'd1640000-0000-4000-8000-000000000002',
  'final',
  'd1640000-0000-4000-8000-000000000010',
  70,
  'd1640000-0000-4000-8000-000000000001'
);
commit;
SQL

cleanup_removal_grade_race() {
  docker exec -i "$REMOVAL_DB_CONTAINER" psql -U postgres -d "$REMOVAL_DATABASE_NAME" \
    -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
begin;
delete from public.pal_event_outbox
where student_id = 'd1640000-0000-4000-8000-000000000002';
delete from public.classrooms
where id = 'd1640000-0000-4000-8000-000000000010';
delete from public.users
where id in (
  'd1640000-0000-4000-8000-000000000001',
  'd1640000-0000-4000-8000-000000000002'
);
commit;
SQL
}
trap cleanup_removal_grade_race EXIT

for removal_grade_action in insert update; do
if [[ "$removal_grade_action" == update ]]; then
  docker exec "$REMOVAL_DB_CONTAINER" psql -U postgres -d "$REMOVAL_DATABASE_NAME" \
    -X -v ON_ERROR_STOP=1 -c "select public.restore_removed_classroom_students('d1640000-0000-4000-8000-000000000001', 'd1640000-0000-4000-8000-000000000010', array['grade-race-student-164@example.invalid']);" >/dev/null
fi
removal_grade_holder_app="removal_164_grade_holder_${removal_grade_action}_$$"
docker exec -e PGAPPNAME="$removal_grade_holder_app" -i "$REMOVAL_DB_CONTAINER" \
  psql -U postgres -d "$REMOVAL_DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.remove_classroom_students_preserving_data(
  'd1640000-0000-4000-8000-000000000001',
  'd1640000-0000-4000-8000-000000000010',
  array['d1640000-0000-4000-8000-000000000011'::uuid]
);
select pg_sleep(3);
commit;
SQL
removal_grade_holder=$!
removal_grade_ready=f
for _ in {1..60}; do
  removal_grade_ready="$(docker exec "$REMOVAL_DB_CONTAINER" \
    psql -U postgres -d "$REMOVAL_DATABASE_NAME" -X -Atc \
    "select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='$removal_grade_holder_app' and wait_event='PgSleep')")"
  [[ "$removal_grade_ready" == t ]] && break
  sleep 0.05
done
if [[ "$removal_grade_ready" != t ]]; then
  wait "$removal_grade_holder"
  echo 'Removal grade-race holder did not reach its commit delay.' >&2
  exit 1
fi

docker exec -i "$REMOVAL_DB_CONTAINER" psql -U postgres -d "$REMOVAL_DATABASE_NAME" \
  -X -v ON_ERROR_STOP=1 -v grade_action="$removal_grade_action" <<'SQL'
begin;
set local statement_timeout = '8s';
select set_config('test.grade_action', :'grade_action', true);
do $$
begin
  begin
    if current_setting('test.grade_action') = 'insert' then
    insert into public.gradebook_item_scores (
      id, classroom_id, item_id, student_id, earned
    ) values (
      'd1640000-0000-4000-8000-000000000015',
      'd1640000-0000-4000-8000-000000000010',
      'd1640000-0000-4000-8000-000000000013',
      'd1640000-0000-4000-8000-000000000002',
      9
    );
    raise exception 'Grade insert crossed an in-flight removal';
    else
    update public.gradebook_score_overrides
    set earned = 99
    where id = 'd1640000-0000-4000-8000-000000000014';
    raise exception 'Grade update crossed an in-flight removal';
    end if;
  exception when serialization_failure then null;
  when foreign_key_violation then
    if sqlerrm <> 'gradebook_student_not_enrolled' then raise; end if;
  end;
end;
$$;
rollback;
SQL
wait "$removal_grade_holder"
done

docker exec -i "$REMOVAL_DB_CONTAINER" psql -U postgres -d "$REMOVAL_DATABASE_NAME" \
  -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
do $$
begin
  begin
    insert into public.gradebook_item_scores (
      id, classroom_id, item_id, student_id, earned
    ) values (
      'd1640000-0000-4000-8000-000000000015',
      'd1640000-0000-4000-8000-000000000010',
      'd1640000-0000-4000-8000-000000000013',
      'd1640000-0000-4000-8000-000000000002',
      9
    );
    raise exception 'Grade insert succeeded after removal';
  exception when foreign_key_violation then
    if sqlerrm <> 'gradebook_student_not_enrolled' then raise; end if;
  end;
  begin
    update public.gradebook_score_overrides
    set earned = 99
    where id = 'd1640000-0000-4000-8000-000000000014';
    raise exception 'Grade update succeeded after removal';
  exception when foreign_key_violation then
    if sqlerrm <> 'gradebook_student_not_enrolled' then raise; end if;
  end;
  if exists (
    select 1 from public.gradebook_item_scores
    where id = 'd1640000-0000-4000-8000-000000000015'
  ) or not exists (
    select 1 from public.gradebook_score_overrides
    where id = 'd1640000-0000-4000-8000-000000000014'
      and earned = 70
  ) then
    raise exception 'A racing or post-removal mark was committed';
  end if;
end;
$$;
rollback;
SQL
