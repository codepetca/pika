#!/usr/bin/env bash

set -euo pipefail

DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Local Supabase database container is not running." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.users (id, email, role)
values ('c1470000-0000-4000-8000-000000000001', 'gradebook-contract@example.invalid', 'teacher');

insert into public.classrooms (id, teacher_id, title, class_code)
values (
  'c1470000-0000-4000-8000-000000000002',
  'c1470000-0000-4000-8000-000000000001',
  'Gradebook contract',
  'GB147C'
);

do $contract$
declare
  v_classroom_id constant uuid := 'c1470000-0000-4000-8000-000000000002';
  v_teacher_id constant uuid := 'c1470000-0000-4000-8000-000000000001';
  v_attendance_id uuid;
  v_term_id uuid;
  v_final_id uuid;
  v_new_attendance_id uuid := gen_random_uuid();
  v_row jsonb;
begin
  if (
    select jsonb_agg(jsonb_build_array(name, percentage, is_default) order by position)
    from public.gradebook_categories
    where classroom_id = v_classroom_id
  ) is distinct from '[
    ["Attendance", 10.00, false],
    ["Term", 65.00, true],
    ["Final", 25.00, false]
  ]'::jsonb then
    raise exception 'Default Gradebook categories are incorrect';
  end if;

  select id into v_attendance_id from public.gradebook_categories
  where classroom_id = v_classroom_id and name = 'Attendance';
  select id into v_term_id from public.gradebook_categories
  where classroom_id = v_classroom_id and name = 'Term';
  select id into v_final_id from public.gradebook_categories
  where classroom_id = v_classroom_id and name = 'Final';

  update public.gradebook_categories
  set default_assessment_weight = 17
  where id = v_term_id;

  insert into public.assignments (id, classroom_id, title, due_at, created_by)
  values (
    'c1470000-0000-4000-8000-000000000003',
    v_classroom_id,
    'Omitted assignment weight',
    clock_timestamp(),
    v_teacher_id
  );
  insert into public.assignments (
    id, classroom_id, title, due_at, created_by, gradebook_weight
  ) values (
    'c1470000-0000-4000-8000-000000000004',
    v_classroom_id,
    'Explicit assignment weight',
    clock_timestamp(),
    v_teacher_id,
    37
  );
  insert into public.tests (id, classroom_id, title, created_by)
  values (
    'c1470000-0000-4000-8000-000000000005',
    v_classroom_id,
    'Omitted test weight',
    v_teacher_id
  );
  insert into public.tests (id, classroom_id, title, created_by, gradebook_weight)
  values (
    'c1470000-0000-4000-8000-000000000006',
    v_classroom_id,
    'Explicit test weight',
    v_teacher_id,
    37
  );

  if exists (
    select 1 from public.assignments
    where id = 'c1470000-0000-4000-8000-000000000003'
      and (gradebook_weight <> 17 or gradebook_category_id <> v_term_id)
  ) or exists (
    select 1 from public.tests
    where id = 'c1470000-0000-4000-8000-000000000005'
      and (gradebook_weight <> 17 or gradebook_category_id <> v_term_id)
  ) then
    raise exception 'Omitted assessment weights did not use the Term default';
  end if;

  if exists (
    select 1 from public.assignments
    where id = 'c1470000-0000-4000-8000-000000000004'
      and gradebook_weight <> 37
  ) or exists (
    select 1 from public.tests
    where id = 'c1470000-0000-4000-8000-000000000006'
      and gradebook_weight <> 37
  ) then
    raise exception 'Explicit assessment weights were overwritten';
  end if;

  perform set_config('pika.classroom_archive_restore', 'on', true);
  insert into public.assignments (
    id, classroom_id, title, due_at, created_by, gradebook_category_id, gradebook_weight
  ) values (
    'c1470000-0000-4000-8000-000000000007',
    v_classroom_id,
    'Legacy restore assignment',
    clock_timestamp(),
    v_teacher_id,
    null,
    37
  );
  perform set_config('pika.classroom_archive_restore', 'off', true);
  if exists (
    select 1 from public.assignments
    where id = 'c1470000-0000-4000-8000-000000000007'
      and (gradebook_category_id <> v_term_id or gradebook_weight <> 37)
  ) then
    raise exception 'Legacy restore did not default category while preserving weight';
  end if;

  perform public.replace_gradebook_categories(v_classroom_id, jsonb_build_array(
    jsonb_build_object('id', v_attendance_id, 'name', 'Attendance', 'percentage', 10, 'default_assessment_weight', 10, 'position', 0, 'is_default', false),
    jsonb_build_object('id', v_term_id, 'name', 'Final', 'percentage', 65, 'default_assessment_weight', 17, 'position', 1, 'is_default', true),
    jsonb_build_object('id', v_final_id, 'name', 'Term', 'percentage', 25, 'default_assessment_weight', 10, 'position', 2, 'is_default', false)
  ));

  perform public.replace_gradebook_categories(v_classroom_id, jsonb_build_array(
    jsonb_build_object('id', v_new_attendance_id, 'name', 'Attendance', 'percentage', 10, 'default_assessment_weight', 10, 'position', 0, 'is_default', false),
    jsonb_build_object('id', v_term_id, 'name', 'Final', 'percentage', 65, 'default_assessment_weight', 17, 'position', 1, 'is_default', true),
    jsonb_build_object('id', v_final_id, 'name', 'Term', 'percentage', 25, 'default_assessment_weight', 10, 'position', 2, 'is_default', false)
  ));

  if exists (
    select 1 from public.gradebook_categories
    where classroom_id = v_classroom_id and id = v_attendance_id
  ) or not exists (
    select 1 from public.gradebook_categories
    where classroom_id = v_classroom_id and id = v_new_attendance_id and name = 'Attendance'
  ) then
    raise exception 'Category delete-and-recreate by name failed';
  end if;

  if not exists (
    select 1
    from public.classroom_archive_resource_contract_versions
    where format_version = 2 and table_name = 'gradebook_categories'
  ) or not exists (
    select 1
    from public.classroom_archive_resource_contract_versions
    where format_version = 2 and table_name = 'assignments'
      and restore_after @> array['gradebook_categories']
  ) or not exists (
    select 1
    from public.classroom_archive_resource_contract_versions
    where format_version = 2 and table_name = 'tests'
      and restore_after @> array['gradebook_categories']
  ) then
    raise exception 'Gradebook archive resource contract is incomplete';
  end if;

  v_row := public.normalize_classroom_archive_restore_row(
    gen_random_uuid(),
    'assignments',
    '{}'::jsonb
  );
  if not (v_row ? 'gradebook_category_id')
    or jsonb_typeof(v_row->'gradebook_category_id') <> 'null'
  then
    raise exception 'Legacy assignment restore normalization is incomplete';
  end if;
end;
$contract$;

rollback;
SQL

echo "Gradebook category defaults, replacement, portability, and weight preservation verified."
