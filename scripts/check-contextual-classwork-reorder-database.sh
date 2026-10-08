#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after migration 197 is applied locally.
CLASSWORK_REORDER_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$CLASSWORK_REORDER_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$CLASSWORK_REORDER_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
declare
  v_signature text;
  v_security_definer boolean;
  v_config text[];
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '197'
  ) then
    raise exception 'Migration 197 is required; this harness never applies it';
  end if;

  foreach v_signature in array array[
    'public.reorder_assignments_for_owner_v1(uuid,uuid,jsonb)',
    'public.reorder_classwork_items_for_owner_v1(uuid,uuid,jsonb)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Contextual classwork reorder function is missing: %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
    then
      raise exception 'Contextual classwork reorder privileges are incorrect: %', v_signature;
    end if;
    select procedure.prosecdef, procedure.proconfig
    into strict v_security_definer, v_config
    from pg_proc as procedure
    where procedure.oid = to_regprocedure(v_signature);
    if not v_security_definer or not (v_config @> array['search_path=""']::text[]) then
      raise exception 'Contextual classwork reorder security metadata is incorrect: %', v_signature;
    end if;
  end loop;

  if has_function_privilege(
    'service_role',
    'private.lock_classwork_reorder_context_v1(uuid,uuid)',
    'execute'
  ) then
    raise exception 'Private classwork reorder helper is directly executable';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1970000-0000-4000-8000-000000000001', 'reorder-owner-student@example.invalid', 'student'),
  ('c1970000-0000-4000-8000-000000000002', 'reorder-outsider@example.invalid', 'teacher');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c1970000-0000-4000-8000-000000000001',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 2,
  'test:migration-197', 'classwork_reorder_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c1970000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code) values (
  'c1970000-0000-4000-8000-000000000010',
  'c1970000-0000-4000-8000-000000000001',
  'Student-valued reorder owner', 'C197LIVE'
);
insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, position
) values
  ('c1970000-0000-4000-8000-000000000020', 'c1970000-0000-4000-8000-000000000010',
    'First assignment', '', clock_timestamp() + interval '7 days',
    'c1970000-0000-4000-8000-000000000001', 0),
  ('c1970000-0000-4000-8000-000000000021', 'c1970000-0000-4000-8000-000000000010',
    'Second assignment', '', clock_timestamp() + interval '7 days',
    'c1970000-0000-4000-8000-000000000001', 2);
insert into public.classwork_materials (
  id, classroom_id, title, content, created_by, position
) values (
  'c1970000-0000-4000-8000-000000000030', 'c1970000-0000-4000-8000-000000000010',
  'Reference', '{"type":"doc","content":[]}'::jsonb,
  'c1970000-0000-4000-8000-000000000001', 1
);
insert into public.surveys (
  id, classroom_id, title, position, created_by
) values (
  'c1970000-0000-4000-8000-000000000040', 'c1970000-0000-4000-8000-000000000010',
  'Check-in', 3, 'c1970000-0000-4000-8000-000000000001'
);

set local role service_role;
do $behavior$
declare
  v_owner constant uuid := 'c1970000-0000-4000-8000-000000000001';
  v_outsider constant uuid := 'c1970000-0000-4000-8000-000000000002';
  v_classroom constant uuid := 'c1970000-0000-4000-8000-000000000010';
  v_result jsonb;
begin
  v_result := public.reorder_assignments_for_owner_v1(
    v_owner, v_classroom,
    '["c1970000-0000-4000-8000-000000000021","c1970000-0000-4000-8000-000000000020"]'::jsonb
  );
  if v_result <> jsonb_build_object('ok', true, 'actor_id', v_owner, 'classroom_id', v_classroom)
    or (select position from public.assignments where id = 'c1970000-0000-4000-8000-000000000021') <> 0
    or (select position from public.assignments where id = 'c1970000-0000-4000-8000-000000000020') <> 2
    or (select position from public.classwork_materials where id = 'c1970000-0000-4000-8000-000000000030') <> 1
  then
    raise exception 'Owner assignment reorder returned invalid evidence or positions: %', v_result;
  end if;

  v_result := public.reorder_classwork_items_for_owner_v1(
    v_owner, v_classroom,
    '[
      {"type":"survey","id":"c1970000-0000-4000-8000-000000000040"},
      {"type":"assignment","id":"c1970000-0000-4000-8000-000000000020"},
      {"type":"material","id":"c1970000-0000-4000-8000-000000000030"},
      {"type":"assignment","id":"c1970000-0000-4000-8000-000000000021"}
    ]'::jsonb
  );
  if v_result <> jsonb_build_object('ok', true, 'actor_id', v_owner, 'classroom_id', v_classroom)
    or (select position from public.surveys where id = 'c1970000-0000-4000-8000-000000000040') <> 0
    or (select position from public.assignments where id = 'c1970000-0000-4000-8000-000000000020') <> 1
    or (select position from public.classwork_materials where id = 'c1970000-0000-4000-8000-000000000030') <> 2
    or (select position from public.assignments where id = 'c1970000-0000-4000-8000-000000000021') <> 3
  then
    raise exception 'Owner mixed-classwork reorder returned invalid evidence or positions: %', v_result;
  end if;

  begin
    perform public.reorder_assignments_for_owner_v1(
      v_outsider, v_classroom,
      '["c1970000-0000-4000-8000-000000000020","c1970000-0000-4000-8000-000000000021"]'::jsonb
    );
    raise exception 'Expected unrelated actor reorder denial';
  exception when insufficient_privilege then null;
  end;

  update public.classrooms set archived_at = clock_timestamp() where id = v_classroom;
  begin
    perform public.reorder_classwork_items_for_owner_v1(
      v_owner, v_classroom,
      '[
        {"type":"survey","id":"c1970000-0000-4000-8000-000000000040"},
        {"type":"assignment","id":"c1970000-0000-4000-8000-000000000020"},
        {"type":"material","id":"c1970000-0000-4000-8000-000000000030"},
        {"type":"assignment","id":"c1970000-0000-4000-8000-000000000021"}
      ]'::jsonb
    );
    raise exception 'Expected archived Classroom reorder denial';
  exception when sqlstate '55000' then
    if sqlerrm <> 'classwork_reorder_archived' then raise; end if;
  end;
end;
$behavior$;
reset role;

rollback;
SQL

echo 'Contextual classwork reorder database checks passed.'
