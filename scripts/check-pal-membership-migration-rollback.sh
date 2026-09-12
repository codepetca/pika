#!/usr/bin/env bash
set -euo pipefail

# This executes migration SQL with synthetic failure injection. It is NOT part
# of ordinary checks. Requires separate exact migration/target authorization.
# Run only before applying 168 in the empty disposable pika-pal-phase1 project.
if [[ "${PAL_MEMBERSHIP_ROLLBACK_REPLAY_ACK:-}" != '168:pika-pal-phase1:ambiguous-generation-rollback' ]]; then
  echo 'Separate authorization is required for the migration-168 rollback rehearsal.' >&2
  exit 2
fi
PAL_REPLAY_CONTAINER='supabase_db_pika-pal-phase1'
PAL_REPLAY_LABEL="$(docker inspect "$PAL_REPLAY_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
if [[ "$PAL_REPLAY_LABEL" != 'pika-pal-phase1' ]]; then
  echo 'Refusing unexpected disposable project.' >&2
  exit 2
fi
pal_preflight="$(docker exec "$PAL_REPLAY_CONTAINER" psql -U postgres -d postgres -X -Atc \
  "select (select max(version::integer) from supabase_migrations.schema_migrations)=165 and not exists(select 1 from public.users) and to_regclass('private.pal_membership_generations') is null and to_regclass('private.pal_membership_settings') is null")"
if [[ "$pal_preflight" != t ]]; then
  echo 'Expected an empty disposable schema at migration 165.' >&2
  exit 2
fi
PAL_REPLAY_ROOT="$(git rev-parse --show-toplevel)"
PAL_REPLAY_SQL="$(mktemp)"
PAL_REPLAY_LOG="$(mktemp)"
trap 'rm -f "$PAL_REPLAY_SQL" "$PAL_REPLAY_LOG"' EXIT
python3 - "$PAL_REPLAY_ROOT/supabase/migrations/168_pal_membership_identity_foundation.sql" "$PAL_REPLAY_SQL" <<'PY'
from pathlib import Path
import sys
sql = Path(sys.argv[1]).read_text()
fixture = """
insert into public.users(id,email,role) values
 ('f1680000-0000-4000-8000-000000000001','rollback-teacher-168@example.invalid','teacher'),
 ('f1680000-0000-4000-8000-000000000002','rollback-student-168@example.invalid','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('f1680000-0000-4000-8000-000000000010','f1680000-0000-4000-8000-000000000001','Rollback A','P168RA'),
 ('f1680000-0000-4000-8000-000000000011','f1680000-0000-4000-8000-000000000001','Rollback B','P168RB');
insert into public.classroom_enrollments(id,classroom_id,student_id) values
 ('f1680000-0000-4000-8000-000000000030','f1680000-0000-4000-8000-000000000010','f1680000-0000-4000-8000-000000000002');
insert into public.classroom_roster(classroom_id,email,removed_at,removed_student_id,
 removed_enrollment_id,removed_enrolled_at,retained_manual_attendance_marks) values
 ('f1680000-0000-4000-8000-000000000011','rollback-student-168@example.invalid',now(),
 'f1680000-0000-4000-8000-000000000002','f1680000-0000-4000-8000-000000000030',now(),'{}');
"""
if '\nbegin;' not in sql:
    raise SystemExit('Migration must begin an explicit transaction')
Path(sys.argv[2]).write_text(sql.replace('\nbegin;', '\nbegin;\n' + fixture, 1))
PY
if docker exec -i "$PAL_REPLAY_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  < "$PAL_REPLAY_SQL" > "$PAL_REPLAY_LOG" 2>&1; then
  echo 'Ambiguous generation unexpectedly installed; stop and inspect disposable target.' >&2
  exit 1
fi
if ! rg -q 'duplicate key value violates unique constraint "pal_membership_generations_pkey"' "$PAL_REPLAY_LOG"; then
  cat "$PAL_REPLAY_LOG" >&2
  echo 'Rehearsal failed outside the intended ambiguous-generation boundary.' >&2
  exit 1
fi
pal_postflight="$(docker exec "$PAL_REPLAY_CONTAINER" psql -U postgres -d postgres -X -Atc \
  "select to_regclass('private.pal_membership_generations') is null and to_regclass('private.pal_membership_settings') is null and to_regprocedure('private.pal_membership_scope(uuid,uuid)') is null and to_regprocedure('public.resolve_pal_membership(uuid,uuid)') is null and not exists(select 1 from pg_trigger where tgname like 'track_pal_%') and not exists(select 1 from public.users) and (select max(version::integer) from supabase_migrations.schema_migrations)=165")"
if [[ "$pal_postflight" != t ]]; then
  echo 'Migration failure left durable objects or fixture data; stop.' >&2
  exit 1
fi
echo 'Ambiguous backfill rolled back all migration objects and synthetic fixtures. Clean application still requires fresh authorization.'
