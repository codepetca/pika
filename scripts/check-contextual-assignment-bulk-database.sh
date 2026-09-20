#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after migration 198 is applied locally.
ASSIGNMENT_BULK_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$ASSIGNMENT_BULK_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$ASSIGNMENT_BULK_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
declare
  v_config text[];
  v_security_definer boolean;
  v_signature constant text := 'public.save_assignments_bulk_for_owner_v1(uuid,uuid,jsonb)';
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '199'
  ) then
    raise exception 'Migration 199 is required; this harness never applies it';
  end if;
  if to_regprocedure(v_signature) is null then
    raise exception 'Contextual Assignment bulk function is missing';
  end if;
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute')
  then
    raise exception 'Contextual Assignment bulk privileges are incorrect';
  end if;
  select procedure.prosecdef, procedure.proconfig
  into strict v_security_definer, v_config
  from pg_proc as procedure
  where procedure.oid = to_regprocedure(v_signature);
  if not v_security_definer or not (v_config @> array['search_path=""']::text[]) then
    raise exception 'Contextual Assignment bulk security metadata is incorrect';
  end if;
  if has_function_privilege(
    'service_role',
    'private.save_assignments_bulk_unscoped_v1(uuid,uuid,jsonb)',
    'execute'
  ) then
    raise exception 'Private unscoped Assignment bulk implementation is directly executable';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1980000-0000-4000-8000-000000000001', 'bulk-owner-student@example.invalid', 'student'),
  ('c1980000-0000-4000-8000-000000000002', 'bulk-outsider@example.invalid', 'teacher');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c1980000-0000-4000-8000-000000000001',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 2,
  'test:migration-198', 'assignment_bulk_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c1980000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code) values (
  'c1980000-0000-4000-8000-000000000010',
  'c1980000-0000-4000-8000-000000000001',
  'Student-valued bulk owner', 'C198LIVE'
);
insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, position, is_draft
) values (
  'c1980000-0000-4000-8000-000000000020',
  'c1980000-0000-4000-8000-000000000010',
  'Existing draft', '', clock_timestamp() + interval '7 days',
  'c1980000-0000-4000-8000-000000000001', 0, true
);
insert into public.classwork_materials (
  id, classroom_id, title, content, created_by, position
) values (
  'c1980000-0000-4000-8000-000000000030',
  'c1980000-0000-4000-8000-000000000010',
  'Reference', '{"type":"doc","content":[]}'::jsonb,
  'c1980000-0000-4000-8000-000000000001', 1
);
insert into public.surveys (
  id, classroom_id, title, position, created_by
) values (
  'c1980000-0000-4000-8000-000000000040',
  'c1980000-0000-4000-8000-000000000010',
  'Check-in', 3, 'c1980000-0000-4000-8000-000000000001'
);

set local role service_role;
do $behavior$
declare
  v_before integer;
  v_classroom constant uuid := 'c1980000-0000-4000-8000-000000000010';
  v_existing constant uuid := 'c1980000-0000-4000-8000-000000000020';
  v_new_id uuid;
  v_outsider constant uuid := 'c1980000-0000-4000-8000-000000000002';
  v_owner constant uuid := 'c1980000-0000-4000-8000-000000000001';
  v_result jsonb;
begin
  v_result := public.save_assignments_bulk_for_owner_v1(
    v_owner,
    v_classroom,
    jsonb_build_array(
      jsonb_build_object(
        'id', v_existing, 'title', 'Released existing',
        'due_at', clock_timestamp() + interval '8 days',
        'instructions_markdown', 'Existing directions', 'description', 'Existing directions',
        'rich_instructions', '{"type":"doc","content":[]}'::jsonb, 'is_draft', false
      ),
      jsonb_build_object(
        'title', 'New forced draft', 'due_at', clock_timestamp() + interval '9 days',
        'instructions_markdown', 'New directions', 'description', 'New directions',
        'rich_instructions', '{"type":"doc","content":[]}'::jsonb, 'is_draft', false
      )
    )
  );

  if v_result->>'ok' <> 'true'
    or (v_result->>'created')::integer <> 1
    or (v_result->>'updated')::integer <> 1
    or jsonb_array_length(v_result->'assignments') <> 2
    or v_result->'assignments'->1->>'id' <> v_existing::text
  then
    raise exception 'Unexpected bulk result evidence: %', v_result;
  end if;
  v_new_id := (v_result->'assignments'->0->>'id')::uuid;
  if (select position from public.assignments where id = v_existing) <> 0
    or (select is_draft from public.assignments where id = v_existing)
    or (select released_at from public.assignments where id = v_existing) is null
    or (select position from public.assignments where id = v_new_id) <> 2
    or not (select is_draft from public.assignments where id = v_new_id)
    or (select position from public.classwork_materials where id = 'c1980000-0000-4000-8000-000000000030') <> 1
    or (select position from public.surveys where id = 'c1980000-0000-4000-8000-000000000040') <> 3
  then
    raise exception 'Bulk release, forced-draft, or mixed positions were not preserved';
  end if;

  select count(*) into v_before from public.assignments where classroom_id = v_classroom;
  v_result := public.save_assignments_bulk_for_owner_v1(
    v_owner,
    v_classroom,
    jsonb_build_array(
      jsonb_build_object(
        'title', 'Must roll back', 'due_at', clock_timestamp() + interval '10 days',
        'instructions_markdown', '', 'description', '',
        'rich_instructions', '{"type":"doc","content":[]}'::jsonb, 'is_draft', true
      ),
      jsonb_build_object(
        'id', 'c1980000-0000-4000-8000-000000000099', 'title', 'Missing',
        'due_at', clock_timestamp() + interval '10 days',
        'instructions_markdown', '', 'description', '',
        'rich_instructions', '{"type":"doc","content":[]}'::jsonb, 'is_draft', true
      )
    )
  );
  if v_result->>'ok' <> 'false'
    or v_result->>'status' <> '400'
    or (select count(*) from public.assignments where classroom_id = v_classroom) <> v_before
  then
    raise exception 'Missing-ID validation did not remain atomic: %', v_result;
  end if;

  begin
    perform public.save_assignments_bulk_for_owner_v1(
      v_owner,
      v_classroom,
      jsonb_build_array(jsonb_build_object(
        'title', 'Invalid date must not write', 'due_at', 'not-a-date',
        'instructions_markdown', '', 'description', '',
        'rich_instructions', '{"type":"doc","content":[]}'::jsonb, 'is_draft', true
      ))
    );
    raise exception 'Expected malformed date rejection';
  exception when invalid_datetime_format then null;
  end;
  if (select count(*) from public.assignments where classroom_id = v_classroom) <> v_before then
    raise exception 'Malformed date wrote an Assignment';
  end if;

  v_result := public.save_assignments_bulk_for_owner_v1(
    v_owner,
    v_classroom,
    jsonb_build_array(jsonb_build_object(
      'id', v_existing, 'title', 'Cannot hide live work',
      'due_at', clock_timestamp() + interval '11 days',
      'instructions_markdown', '', 'description', '',
      'rich_instructions', '{"type":"doc","content":[]}'::jsonb, 'is_draft', true
    ))
  );
  if v_result->>'ok' <> 'false'
    or v_result->'errors'->>0 <> 'Cannot un-release assignment: Cannot hide live work'
    or (select title from public.assignments where id = v_existing) <> 'Released existing'
  then
    raise exception 'Live un-release validation did not preserve legacy behavior: %', v_result;
  end if;

  begin
    perform public.save_assignments_bulk_for_owner_v1(v_outsider, v_classroom, '[]'::jsonb);
    raise exception 'Expected unrelated actor bulk denial';
  exception when insufficient_privilege then null;
  end;

  update public.classrooms set archived_at = clock_timestamp() where id = v_classroom;
  begin
    perform public.save_assignments_bulk_for_owner_v1(v_owner, v_classroom, '[]'::jsonb);
    raise exception 'Expected archived Classroom bulk denial';
  exception when sqlstate '55000' then
    if sqlerrm <> 'assignment_bulk_archived' then raise; end if;
  end;
end;
$behavior$;
reset role;

rollback;
SQL

echo 'Contextual Assignment bulk database checks passed.'
