#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after migration 193 is applied locally.
CLASSWORK_CREATION_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$CLASSWORK_CREATION_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$CLASSWORK_CREATION_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
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
    select 1 from supabase_migrations.schema_migrations where version = '193'
  ) then
    raise exception 'Migration 193 is required; this harness never applies it';
  end if;

  foreach v_signature in array array[
    'public.create_assignment_for_owner_v1(uuid,uuid,text,text,text,jsonb,timestamp with time zone,jsonb)',
    'public.create_classwork_material_for_owner_v1(uuid,uuid,text,jsonb,boolean)',
    'public.create_survey_for_owner_v1(uuid,uuid,text,boolean,boolean)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Contextual classwork creation function is missing: %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
    then
      raise exception 'Contextual classwork creation privileges are incorrect: %', v_signature;
    end if;
    select procedure.prosecdef, procedure.proconfig
    into strict v_security_definer, v_config
    from pg_proc as procedure
    where procedure.oid = to_regprocedure(v_signature);
    if not v_security_definer or not (v_config @> array['search_path=""']::text[]) then
      raise exception 'Contextual classwork creation security metadata is incorrect: %', v_signature;
    end if;
  end loop;

  if has_function_privilege(
    'service_role',
    'private.lock_classwork_creation_context_v1(uuid,uuid)',
    'execute'
  ) then
    raise exception 'Private classwork creation helper is directly executable';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1930000-0000-4000-8000-000000000001', 'classwork-creation-student@example.invalid', 'student'),
  ('c1930000-0000-4000-8000-000000000002', 'classwork-creation-teacher@example.invalid', 'teacher'),
  ('c1930000-0000-4000-8000-000000000003', 'classwork-creation-outsider@example.invalid', 'teacher');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), owner_id, 'classrooms.create', 'manual', true,
  clock_timestamp(), null, 10, 'test:migration-193', 'classwork_creation_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = owner_id and feature_key = 'classrooms.create'), 0)
)
from (values
  ('c1930000-0000-4000-8000-000000000001'::uuid),
  ('c1930000-0000-4000-8000-000000000002'::uuid)
) as owners(owner_id);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c1930000-0000-4000-8000-000000000010', 'c1930000-0000-4000-8000-000000000001', 'Student-valued owner', 'C193LIVE', null),
  ('c1930000-0000-4000-8000-000000000011', 'c1930000-0000-4000-8000-000000000002', 'Archived owner', 'C193ARCH', clock_timestamp());

set local role service_role;
do $behavior$
declare
  v_owner constant uuid := 'c1930000-0000-4000-8000-000000000001';
  v_outsider constant uuid := 'c1930000-0000-4000-8000-000000000003';
  v_assignment jsonb;
  v_material jsonb;
  v_survey jsonb;
begin
  v_assignment := public.create_assignment_for_owner_v1(
    v_owner, 'c1930000-0000-4000-8000-000000000010',
    'Assignment', '', 'Instructions', '{"type":"doc","content":[]}'::jsonb,
    clock_timestamp() + interval '7 days', '[]'::jsonb
  );
  v_material := public.create_classwork_material_for_owner_v1(
    v_owner, 'c1930000-0000-4000-8000-000000000010',
    '  Reference  ', '{"type":"doc","content":[]}'::jsonb, false
  );
  v_survey := public.create_survey_for_owner_v1(
    v_owner, 'c1930000-0000-4000-8000-000000000010',
    '  Check-in  ', false, true
  );

  if (v_assignment->'assignment'->>'position')::integer <> 0
    or (v_material->'material'->>'position')::integer <> 1
    or (v_survey->'survey'->>'position')::integer <> 2
    or v_material->'material'->>'title' is distinct from 'Reference'
    or (v_material->'material'->>'released_at') is null
    or v_survey->'survey'->>'title' is distinct from 'Check-in'
    or (v_survey->'survey'->>'show_results')::boolean
    or not (v_survey->'survey'->>'dynamic_responses')::boolean
  then
    raise exception 'Mixed classwork creation returned invalid evidence: %, %, %',
      v_assignment, v_material, v_survey;
  end if;

  begin
    perform public.create_classwork_material_for_owner_v1(
      v_outsider, 'c1930000-0000-4000-8000-000000000010',
      'Forbidden', '{"type":"doc"}'::jsonb, true
    );
    raise exception 'Expected unrelated user material creation denial';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.create_survey_for_owner_v1(
      'c1930000-0000-4000-8000-000000000002',
      'c1930000-0000-4000-8000-000000000011',
      'Forbidden archive', true, false
    );
    raise exception 'Expected archived Classroom survey creation denial';
  exception when sqlstate '55000' then null;
  end;

  begin
    perform public.create_classwork_material_for_owner_v1(
      v_owner, 'c1930000-0000-4000-8000-000000000010',
      'Invalid content', '{"type":"paragraph"}'::jsonb, true
    );
    raise exception 'Expected invalid material content denial';
  exception when invalid_parameter_value then null;
  end;
end;
$behavior$;
reset role;

rollback;
SQL

echo 'Contextual classwork creation database checks passed.'
