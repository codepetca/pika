#!/usr/bin/env bash
set -euo pipefail

# Rollback-only synthetic fixture. No hosted target mode and no migration apply.
GRADEBOOK_DB_CONTAINER="supabase_db_pika"
PROJECT_LABEL="$(docker inspect "$GRADEBOOK_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
DB_BINDING="$(docker port "$GRADEBOOK_DB_CONTAINER" 5432/tcp)"
if [[ "$PROJECT_LABEL" != "pika" ]] || ! grep -q ':54322$' <<<"$DB_BINDING"; then
  echo 'Refusing unexpected database target.' >&2
  exit 2
fi

docker exec -i "$GRADEBOOK_DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

do $$
begin
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '157'
  ) then
    raise exception 'Migration 157 requires separate local application approval';
  end if;
end;
$$;

insert into public.users (id, email, role) values
  ('15700000-0000-4000-8000-000000000001', 'gradebook-cleanup-teacher@example.test', 'teacher'),
  ('15700000-0000-4000-8000-000000000002', 'gradebook-cleanup-student@example.test', 'student');

insert into public.classrooms (id, teacher_id, title, class_code) values
  ('15700000-0000-4000-8000-000000000010', '15700000-0000-4000-8000-000000000001', 'Gradebook cleanup', 'G15701');

insert into public.classroom_enrollments (classroom_id, student_id) values
  ('15700000-0000-4000-8000-000000000010', '15700000-0000-4000-8000-000000000002');

-- Assignment and test IDs intentionally match to prove cleanup is scoped by type.
insert into public.assignments (
  id, classroom_id, title, due_at, created_by, gradebook_weight
) values (
  '15700000-0000-4000-8000-000000000020',
  '15700000-0000-4000-8000-000000000010',
  'Cleanup assignment',
  now() + interval '1 day',
  '15700000-0000-4000-8000-000000000001',
  100
);

insert into public.tests (
  id, classroom_id, title, created_by, gradebook_weight
) values (
  '15700000-0000-4000-8000-000000000020',
  '15700000-0000-4000-8000-000000000010',
  'Cleanup test',
  '15700000-0000-4000-8000-000000000001',
  100
);

insert into public.gradebook_score_overrides (
  classroom_id, student_id, assessment_type, assessment_id, earned, created_by
) values
  ('15700000-0000-4000-8000-000000000010', '15700000-0000-4000-8000-000000000002', 'assignment', '15700000-0000-4000-8000-000000000020', 8, '15700000-0000-4000-8000-000000000001'),
  ('15700000-0000-4000-8000-000000000010', '15700000-0000-4000-8000-000000000002', 'test', '15700000-0000-4000-8000-000000000020', 9, '15700000-0000-4000-8000-000000000001'),
  ('15700000-0000-4000-8000-000000000010', '15700000-0000-4000-8000-000000000002', 'final', '15700000-0000-4000-8000-000000000010', 86, '15700000-0000-4000-8000-000000000001');

-- Assignment deletion is performed by the teacher API with the service-role
-- client.  Exercise the database trigger as the migration owner, since the
-- browser role is intentionally denied direct table deletes.
delete from public.assignments
where id = '15700000-0000-4000-8000-000000000020';

do $$
begin
  if exists (
    select 1 from public.gradebook_score_overrides
    where assessment_type = 'assignment'
      and assessment_id = '15700000-0000-4000-8000-000000000020'
  ) then
    raise exception 'Assignment override survived assignment deletion';
  end if;
  if not exists (
    select 1 from public.gradebook_score_overrides
    where assessment_type = 'test'
      and assessment_id = '15700000-0000-4000-8000-000000000020'
  ) then
    raise exception 'Assignment deletion crossed the assessment-type boundary';
  end if;
end;
$$;

select public.delete_test_atomic(
  '15700000-0000-4000-8000-000000000020',
  '15700000-0000-4000-8000-000000000001'
);

do $$
begin
  if exists (
    select 1 from public.gradebook_score_overrides
    where assessment_type = 'test'
      and assessment_id = '15700000-0000-4000-8000-000000000020'
  ) then
    raise exception 'Test override survived atomic test deletion';
  end if;
  if not exists (
    select 1 from public.gradebook_score_overrides
    where assessment_type = 'final'
      and assessment_id = '15700000-0000-4000-8000-000000000010'
  ) then
    raise exception 'Assessment deletion removed the Final override';
  end if;
end;
$$;

do $$
begin
  if has_function_privilege(
    'authenticated',
    'public.delete_gradebook_overrides_for_assessment()',
    'execute'
  ) then
    raise exception 'Browser role can execute the cleanup trigger helper';
  end if;
end;
$$;

rollback;
SQL

echo 'Rollback-only Gradebook score override deletion contracts passed.'
