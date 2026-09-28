-- Guided classroom drafts are teacher-only artifacts derived from the frozen
-- Blueprint Version that created the classroom. A separate private sidecar
-- retains the guidance used for the AI seed; source_blueprint_version_id on
-- assignments/tests remains reserved for direct copied-artifact lineage.

begin;

create table public.classroom_guided_draft_provenance (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  assignment_id uuid unique references public.assignments (id) on delete cascade,
  test_id uuid unique references public.tests (id) on delete cascade,
  source_blueprint_version_id uuid not null,
  source_blueprint_version_number bigint not null check (source_blueprint_version_number > 0),
  source_draft_revision bigint not null check (source_draft_revision > 0),
  unit_exception_id uuid,
  unit_label text,
  rules_markdown text not null,
  seed_sha256 text not null check (seed_sha256 ~ '^[a-f0-9]{64}$'),
  created_content_sha256 text not null check (created_content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint classroom_guided_draft_one_artifact
    check ((assignment_id is null) <> (test_id is null)),
  constraint classroom_guided_draft_unit_pair
    check ((unit_exception_id is null) = (unit_label is null))
);

create index idx_classroom_guided_draft_provenance_classroom
  on public.classroom_guided_draft_provenance (classroom_id, created_at desc);

comment on table public.classroom_guided_draft_provenance is
  'Private AI seed guidance and frozen Blueprint Version provenance for teacher-created classroom drafts. Version identity is retained after the source Blueprint is deleted.';

alter table public.classroom_guided_draft_provenance enable row level security;
revoke all on public.classroom_guided_draft_provenance from public, anon, authenticated;
grant select, insert on public.classroom_guided_draft_provenance to service_role;

-- Keep teacher-private provenance in portable classroom archives. Existing v2
-- archives predate this additive table and restore it as an empty collection.
insert into public.classroom_archive_resource_contract_versions (
  format_version, table_name, primary_key_columns, parent_table, parent_column,
  actor_columns, restore_after, export_position
)
select 2, 'classroom_guided_draft_provenance', array['id'], 'classrooms',
  'classroom_id', array['created_by'], array['classrooms', 'assignments', 'tests'],
  coalesce(max(export_position), 0) + 1
from public.classroom_archive_resource_contract_versions
where format_version = 2;

insert into public.classroom_archive_resource_contract (
  table_name, primary_key_columns, parent_table, parent_column,
  actor_columns, restore_after, export_position
)
select 'classroom_guided_draft_provenance', array['id'], 'classrooms',
  'classroom_id', array['created_by'], array['classrooms', 'assignments', 'tests'],
  coalesce(max(export_position), 0) + 1
from public.classroom_archive_resource_contract;

create trigger car_classroom_guided_draft_provenance
  before insert or delete or update on public.classroom_guided_draft_provenance
  for each row execute function public.bump_classroom_archive_revision_from_resource(
    'classrooms', 'classroom_id'
  );

create trigger classroom_purge_fence_guided_draft_provenance
  before insert or delete or update on public.classroom_guided_draft_provenance
  for each row execute function public.reject_classroom_resource_change_during_purge(
    'classrooms', 'classroom_id'
  );

-- Reconstruct the exact ordered Markdown supplied by the application. This
-- prevents an RPC caller from attaching unrelated rules to a Version or unit.
create function public.resolve_classroom_guided_rules_v1(
  p_guidance jsonb,
  p_target text,
  p_unit_exception_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_default_guidance constant jsonb := '{"course_expectations_markdown":"","assignment_guidance_markdown":"","test_guidance_markdown":"","unit_exceptions":[]}'::jsonb;
  v_guidance jsonb := coalesce(p_guidance, v_default_guidance);
  v_unit jsonb;
  v_unit_label text;
  v_target_key text;
  v_sections text[] := array[]::text[];
  v_body text;
begin
  if p_target not in ('assignments', 'tests')
    or not public.is_course_blueprint_authoring_guidance(v_guidance)
  then
    raise exception using errcode = '22023', message = 'Invalid frozen Blueprint guidance';
  end if;

  if p_unit_exception_id is not null then
    select unit.value into v_unit
    from jsonb_array_elements(v_guidance->'unit_exceptions') as unit(value)
    where unit.value->>'id' = p_unit_exception_id::text;
    if not found then
      raise exception using errcode = '22023', message = 'Selected unit is not in the frozen Blueprint Version';
    end if;
    v_unit_label := v_unit->>'unit_label';
  end if;

  v_target_key := case p_target
    when 'tests' then 'test_guidance_markdown'
    else 'assignment_guidance_markdown'
  end;
  v_body := btrim(v_guidance->>'course_expectations_markdown');
  if v_body <> '' then
    v_sections := array_append(v_sections, '## Course expectations' || E'\n\n' || v_body);
  end if;
  v_body := btrim(v_guidance->>v_target_key);
  if v_body <> '' then
    v_sections := array_append(
      v_sections,
      case p_target when 'tests' then '## Test rules' else '## Assignment rules' end
        || E'\n\n' || v_body
    );
  end if;
  if v_unit is not null then
    v_body := btrim(v_unit->>v_target_key);
    if v_body <> '' then
      v_sections := array_append(v_sections, '## Unit: ' || v_unit_label || E'\n\n' || v_body);
    end if;
  end if;

  return jsonb_build_object(
    'unit_label', v_unit_label,
    'rules_markdown', array_to_string(v_sections, E'\n\n')
  );
end;
$function$;

revoke all on function public.resolve_classroom_guided_rules_v1(jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_classroom_guided_rules_v1(jsonb, text, uuid)
  to service_role;

-- This helper locks the classroom and derives Version and unit identity from
-- the database. The caller-supplied Version is only a stale-preview guard.
create function public.assert_classroom_guided_draft_context_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_expected_blueprint_version_id uuid,
  p_unit_exception_id uuid,
  p_target text,
  p_rules_markdown text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_classroom public.classrooms%rowtype;
  v_version public.course_blueprint_versions%rowtype;
  v_resolved jsonb;
begin
  if p_actor_id is null or p_classroom_id is null
    or p_expected_blueprint_version_id is null or p_rules_markdown is null
    or length(p_rules_markdown) > 100000
  then
    raise exception using errcode = '22023', message = 'Invalid guided draft context';
  end if;

  select classroom.* into v_classroom
  from public.classrooms as classroom
  where classroom.id = p_classroom_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Classroom not found';
  end if;
  if v_classroom.teacher_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_classroom.archived_at is not null then
    raise exception using errcode = '55000', message = 'Classroom is archived';
  end if;
  if v_classroom.source_blueprint_version_id is distinct from p_expected_blueprint_version_id
    or v_classroom.source_blueprint_id is null
  then
    raise exception using errcode = '40001', message = 'Classroom Blueprint Version changed';
  end if;

  select version.* into v_version
  from public.course_blueprint_versions as version
  where version.id = v_classroom.source_blueprint_version_id
    and version.course_blueprint_id = v_classroom.source_blueprint_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Classroom Blueprint Version is unavailable';
  end if;

  v_resolved := public.resolve_classroom_guided_rules_v1(
    v_version.snapshot_json->'authoring_guidance', p_target, p_unit_exception_id
  );
  if p_rules_markdown is distinct from v_resolved->>'rules_markdown' then
    raise exception using errcode = '22023', message = 'Guidance does not match the frozen Blueprint Version';
  end if;
  return jsonb_build_object(
    'source_blueprint_version_id', v_version.id,
    'source_blueprint_version_number', v_version.version_number,
    'source_draft_revision', v_version.source_draft_revision,
    'unit_label', v_resolved->'unit_label'
  );
end;
$function$;

revoke all on function public.assert_classroom_guided_draft_context_v1(
  uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.assert_classroom_guided_draft_context_v1(
  uuid, uuid, uuid, uuid, text, text
) to service_role;

create function public.create_guided_assignment_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_expected_blueprint_version_id uuid,
  p_unit_exception_id uuid,
  p_draft_id uuid,
  p_title text,
  p_description text,
  p_instructions_markdown text,
  p_rich_instructions jsonb,
  p_due_at timestamptz,
  p_requirements jsonb,
  p_points_possible numeric,
  p_rules_markdown text,
  p_seed_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_created jsonb;
  v_assignment public.assignments%rowtype;
  v_context jsonb;
  v_provenance public.classroom_guided_draft_provenance%rowtype;
begin
  if p_draft_id is null or p_seed_sha256 is null
    or p_seed_sha256 !~ '^[a-f0-9]{64}$'
    or p_points_possible is null or p_points_possible <= 0 or p_points_possible > 1000
  then
    raise exception using errcode = '22023', message = 'Invalid guided assignment request';
  end if;

  -- Reuse the established owner check, lock order, position calculation, and
  -- normalized requirement transaction. Any later error rolls it all back.
  v_created := public.create_assignment_for_owner_v1(
    p_actor_id, p_classroom_id, p_title, p_description,
    p_instructions_markdown, p_rich_instructions, p_due_at, p_requirements
  );
  v_context := public.assert_classroom_guided_draft_context_v1(
    p_actor_id, p_classroom_id, p_expected_blueprint_version_id,
    p_unit_exception_id, 'assignments', p_rules_markdown
  );

  update public.assignments
  set points_possible = p_points_possible, is_draft = true
  where id = (v_created->'assignment'->>'id')::uuid
    and classroom_id = p_classroom_id
  returning * into v_assignment;
  if not found then
    raise exception using errcode = 'P0002', message = 'Created assignment is unavailable';
  end if;

  insert into public.classroom_guided_draft_provenance (
    draft_id, classroom_id, assignment_id,
    source_blueprint_version_id, source_blueprint_version_number,
    source_draft_revision, unit_exception_id, unit_label, rules_markdown,
    seed_sha256, created_content_sha256, created_by
  ) values (
    p_draft_id, p_classroom_id, v_assignment.id,
    (v_context->>'source_blueprint_version_id')::uuid,
    (v_context->>'source_blueprint_version_number')::bigint,
    (v_context->>'source_draft_revision')::bigint,
    p_unit_exception_id, v_context->>'unit_label', p_rules_markdown,
    p_seed_sha256,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'title', v_assignment.title,
      'instructions_markdown', v_assignment.instructions_markdown,
      'points_possible', v_assignment.points_possible,
      'submission_requirements', v_created->'submission_requirements'
    )::text, 'UTF8'), 'sha256'), 'hex'),
    p_actor_id
  ) returning * into v_provenance;

  return v_created || jsonb_build_object(
    'assignment', to_jsonb(v_assignment),
    'provenance', to_jsonb(v_provenance)
  );
end;
$function$;

revoke all on function public.create_guided_assignment_for_owner_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, timestamptz, jsonb, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.create_guided_assignment_for_owner_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, timestamptz, jsonb, numeric, text, text
) to service_role;

create function public.create_guided_test_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_expected_blueprint_version_id uuid,
  p_unit_exception_id uuid,
  p_draft_id uuid,
  p_draft_content jsonb,
  p_documents jsonb,
  p_rules_markdown text,
  p_seed_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_test public.tests%rowtype;
  v_draft public.assessment_drafts%rowtype;
  v_provenance public.classroom_guided_draft_provenance%rowtype;
  v_position integer;
  v_points numeric;
  v_title text;
begin
  if p_draft_id is null or p_seed_sha256 is null
    or p_seed_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_draft_content) is distinct from 'object'
    or jsonb_typeof(p_draft_content->'questions') is distinct from 'array'
    or jsonb_array_length(p_draft_content->'questions') not between 1 and 50
    or jsonb_typeof(p_draft_content->'show_results') is distinct from 'boolean'
    or jsonb_typeof(p_documents) is distinct from 'array'
    or jsonb_array_length(p_documents) > 20
  then
    raise exception using errcode = '22023', message = 'Invalid guided test request';
  end if;
  v_title := btrim(p_draft_content->>'title');
  if v_title is null or length(v_title) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Invalid guided test title';
  end if;

  v_context := public.assert_classroom_guided_draft_context_v1(
    p_actor_id, p_classroom_id, p_expected_blueprint_version_id,
    p_unit_exception_id, 'tests', p_rules_markdown
  );
  select coalesce(max(test.position), -1) + 1 into v_position
  from public.tests as test where test.classroom_id = p_classroom_id;
  select sum((question.value->>'points')::numeric) into v_points
  from jsonb_array_elements(p_draft_content->'questions') as question(value);
  if v_points is null or v_points <= 0 or v_points > 9999.99 then
    raise exception using errcode = '22023', message = 'Invalid guided test points';
  end if;

  insert into public.tests (
    classroom_id, title, created_by, position, status,
    show_results, points_possible, documents
  ) values (
    p_classroom_id, v_title, p_actor_id, v_position, 'draft',
    (p_draft_content->>'show_results')::boolean, v_points, p_documents
  ) returning * into v_test;

  insert into public.assessment_drafts (
    assessment_type, assessment_id, classroom_id, content, created_by, updated_by
  ) values (
    'test', v_test.id, p_classroom_id, p_draft_content, p_actor_id, p_actor_id
  ) returning * into v_draft;

  insert into public.classroom_guided_draft_provenance (
    draft_id, classroom_id, test_id,
    source_blueprint_version_id, source_blueprint_version_number,
    source_draft_revision, unit_exception_id, unit_label, rules_markdown,
    seed_sha256, created_content_sha256, created_by
  ) values (
    p_draft_id, p_classroom_id, v_test.id,
    (v_context->>'source_blueprint_version_id')::uuid,
    (v_context->>'source_blueprint_version_number')::bigint,
    (v_context->>'source_draft_revision')::bigint,
    p_unit_exception_id, v_context->>'unit_label', p_rules_markdown,
    p_seed_sha256,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'draft_content', p_draft_content, 'documents', p_documents
    )::text, 'UTF8'), 'sha256'), 'hex'),
    p_actor_id
  ) returning * into v_provenance;

  return jsonb_build_object(
    'ok', true,
    'test', to_jsonb(v_test),
    'assessment_draft', to_jsonb(v_draft),
    'provenance', to_jsonb(v_provenance)
  );
end;
$function$;

revoke all on function public.create_guided_test_for_owner_v1(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.create_guided_test_for_owner_v1(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) to service_role;

commit;
