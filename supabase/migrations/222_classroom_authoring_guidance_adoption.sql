-- Guidance adoption changes future drafting rules without changing copied content lineage.
begin;
alter table public.classrooms add column authoring_guidance_version_id uuid
  references public.course_blueprint_versions(id) on delete set null;
create index idx_classrooms_authoring_guidance_version
  on public.classrooms(authoring_guidance_version_id)
  where authoring_guidance_version_id is not null;
comment on column public.classrooms.authoring_guidance_version_id is
  'Explicit immutable guidance Version. NULL inherits the structural source Version.';

create function public.guard_classroom_authoring_guidance_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.authoring_guidance_version_id is not null then
    if new.source_blueprint_id is null or new.source_blueprint_version_id is null then
      raise exception using errcode = '23514', message = 'Guidance requires a linked content Version';
    end if;
    perform public.guard_course_blueprint_purge_lifecycle(new.source_blueprint_id);
    if not exists (select 1 from public.course_blueprint_versions v
      where v.id = new.authoring_guidance_version_id
        and v.course_blueprint_id = new.source_blueprint_id) then
      raise exception using errcode = '23514', message = 'Guidance Version belongs to another Blueprint';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_classroom_authoring_guidance_version()
  from public, anon, authenticated, service_role;
-- Explicit structural application also clears an override when it reapplies the
-- same content Version. INSERT-based archive restores preserve their selection.
create function public.reset_classroom_authoring_guidance_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.authoring_guidance_version_id := null;
  return new;
end;
$$;
revoke all on function public.reset_classroom_authoring_guidance_version() from public, anon, authenticated, service_role;
create trigger aa_classroom_reset_authoring_guidance_version
  before update of source_blueprint_id, source_blueprint_version_id on public.classrooms
  for each row execute function public.reset_classroom_authoring_guidance_version();
create trigger ab_classroom_authoring_guidance_version
  before insert or update of source_blueprint_id, source_blueprint_version_id, authoring_guidance_version_id
  on public.classrooms for each row execute function public.guard_classroom_authoring_guidance_version();

create function public.adopt_classroom_authoring_guidance_v1(
  p_actor_id uuid, p_classroom_id uuid, p_blueprint_id uuid,
  p_expected_content_version_id uuid, p_expected_guidance_version_id uuid,
  p_expected_draft_revision bigint, p_guidance_version_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_classroom public.classrooms%rowtype;
  v_blueprint public.course_blueprints%rowtype;
  v_version public.course_blueprint_versions%rowtype;
begin
  if p_actor_id is null or p_classroom_id is null or p_blueprint_id is null
    or p_expected_content_version_id is null or p_expected_guidance_version_id is null
    or p_expected_draft_revision is null or p_guidance_version_id is null then
    raise exception using errcode = '22023', message = 'Invalid guidance adoption';
  end if;
  -- Lifecycle advisory locks precede row locks, matching both purge workflows.
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  perform public.guard_course_blueprint_purge_lifecycle(p_blueprint_id);
  select * into v_blueprint from public.course_blueprints
    where id = p_blueprint_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Blueprint not found'; end if;
  if v_blueprint.teacher_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  select * into v_classroom from public.classrooms where id = p_classroom_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Classroom not found'; end if;
  if v_classroom.teacher_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_classroom.archived_at is not null then
    raise exception using errcode = '55000', message = 'Classroom is archived';
  end if;
  if v_classroom.source_blueprint_id is distinct from p_blueprint_id
    or v_classroom.source_blueprint_version_id is distinct from p_expected_content_version_id
    or coalesce(v_classroom.authoring_guidance_version_id, v_classroom.source_blueprint_version_id)
      is distinct from p_expected_guidance_version_id
    or v_blueprint.content_revision is distinct from p_expected_draft_revision then
    raise exception using errcode = '40001', message = 'Blueprint guidance changed; review and retry';
  end if;
  select * into v_version from public.course_blueprint_versions
    where id = p_guidance_version_id and course_blueprint_id = p_blueprint_id
      and source_draft_revision = p_expected_draft_revision;
  if not found then raise exception using errcode = '40001', message = 'Guidance Version is unavailable or stale'; end if;
  if not public.is_course_blueprint_authoring_guidance(v_version.snapshot_json->'authoring_guidance') then
    raise exception using errcode = '22023', message = 'Invalid saved guidance';
  end if;
  update public.classrooms set authoring_guidance_version_id = v_version.id
    where id = p_classroom_id;
  return jsonb_build_object('guidance_version_id', v_version.id, 'guidance_version_number', v_version.version_number);
end;
$$;
revoke all on function public.adopt_classroom_authoring_guidance_v1(uuid,uuid,uuid,uuid,uuid,bigint,uuid)
  from public, anon, authenticated;
grant execute on function public.adopt_classroom_authoring_guidance_v1(uuid,uuid,uuid,uuid,uuid,bigint,uuid) to service_role;

alter table public.classroom_guided_draft_provenance add column content_version_id uuid;
comment on column public.classroom_guided_draft_provenance.content_version_id is
  'Structural course context consumed by the model; NULL on legacy records means source_blueprint_version_id.';
drop function public.assert_classroom_guided_draft_context_v1(uuid,uuid,uuid,uuid,text,text);
create function public.assert_classroom_guided_draft_context_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_expected_blueprint_version_id uuid,
  p_unit_exception_id uuid,
  p_target text,
  p_rules_markdown text,
  p_expected_content_version_id uuid default null
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
  if v_classroom.source_blueprint_version_id is distinct from coalesce(p_expected_content_version_id, p_expected_blueprint_version_id)
    or coalesce(v_classroom.authoring_guidance_version_id, v_classroom.source_blueprint_version_id) is distinct from p_expected_blueprint_version_id
    or v_classroom.source_blueprint_id is null
  then
    raise exception using errcode = '40001', message = 'Classroom Blueprint Version changed';
  end if;

  select version.* into v_version
  from public.course_blueprint_versions as version
  where version.id = coalesce(v_classroom.authoring_guidance_version_id, v_classroom.source_blueprint_version_id)
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
    'content_version_id', v_classroom.source_blueprint_version_id,
    'source_blueprint_version_id', v_version.id,
    'source_blueprint_version_number', v_version.version_number,
    'source_draft_revision', v_version.source_draft_revision,
    'unit_label', v_resolved->'unit_label'
  );
end;
$function$;

revoke all on function public.assert_classroom_guided_draft_context_v1(uuid,uuid,uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.assert_classroom_guided_draft_context_v1(uuid,uuid,uuid,uuid,text,text,uuid) to service_role;

create or replace function public.guard_course_blueprint_version_lineage_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_blueprint_id uuid;
begin
  if current_setting('pika.course_blueprint_purge_finalize', true) = 'on'
  then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE'
    and current_setting('pika.classroom_purge_finalize', true) = 'on'
  then return old; end if;

  for v_blueprint_id in
    select distinct candidate from (
      select nullif(v_old->>'source_blueprint_id', '')::uuid candidate
      union all select nullif(v_new->>'source_blueprint_id', '')::uuid
      union all
      select version.course_blueprint_id
      from public.course_blueprint_versions version
      where version.id in (
        nullif(v_old->>'source_blueprint_version_id', '')::uuid,
        nullif(v_new->>'source_blueprint_version_id', '')::uuid,
        nullif(v_old->>'authoring_guidance_version_id', '')::uuid,
        nullif(v_new->>'authoring_guidance_version_id', '')::uuid
      )
    ) candidates where candidate is not null
  loop
    perform public.guard_course_blueprint_purge_lifecycle(v_blueprint_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Include removals as well as new references in the existing purge write fence.
drop trigger classrooms_blueprint_purge_lineage_fence on public.classrooms;
create trigger classrooms_blueprint_purge_lineage_fence
before insert or update of source_blueprint_id, source_blueprint_version_id, authoring_guidance_version_id or delete
on public.classrooms for each row
execute function public.guard_course_blueprint_version_lineage_write();

create or replace function public.get_course_blueprint_purge_inventory(
  p_teacher_id uuid,
  p_blueprint_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_blueprint public.course_blueprints;
  v_mode text;
  v_allowed boolean;
  v_conflict text;
  v_file_count integer;
  v_file_bytes bigint;
  v_missing integer;
  v_digest text;
  v_counts jsonb;
  v_row_count integer;
  v_linked integer;
begin
  select * into v_blueprint from public.course_blueprints
  where id = p_blueprint_id and teacher_id = p_teacher_id;
  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'course_blueprint_not_found',
      'error', 'Course Blueprint not found'
    );
  end if;

  select mode into v_mode from public.managed_storage_settings where singleton;
  v_allowed := public.course_blueprint_purge_enabled(p_teacher_id, p_blueprint_id);
  v_conflict := public.course_blueprint_purge_conflict(p_blueprint_id);

  select count(*), coalesce(sum(byte_size), 0), count(*) filter (
      where status <> 'ready'
        or not exists (
          select 1 from storage.objects stored
          where stored.bucket_id = object.storage_bucket
            and stored.name = object.storage_path
        )
    )
  into v_file_count, v_file_bytes, v_missing
  from public.managed_storage_objects object
  where object.course_blueprint_id = p_blueprint_id;

  -- The confirmation digest covers graph membership, linked Classrooms, and
  -- exact managed-object identities. This catches equal-count replacements,
  -- not merely file-count drift.
  select encode(extensions.digest(
    convert_to(coalesce(string_agg(member, ',' order by member), ''), 'UTF8'),
    'sha256'), 'hex') into v_digest
  from (
    select 'blueprint:' || blueprint.id || ':' || blueprint.content_revision member
    from public.course_blueprints blueprint where blueprint.id = p_blueprint_id
    union all select 'assignment:' || id from public.course_blueprint_assignments where course_blueprint_id = p_blueprint_id
    union all select 'assessment:' || id from public.course_blueprint_assessments where course_blueprint_id = p_blueprint_id
    union all select 'lesson:' || id from public.course_blueprint_lesson_templates where course_blueprint_id = p_blueprint_id
    union all select 'material:' || id from public.course_blueprint_materials where course_blueprint_id = p_blueprint_id
    union all select 'survey:' || id from public.course_blueprint_surveys where course_blueprint_id = p_blueprint_id
    union all select 'version:' || id from public.course_blueprint_versions where course_blueprint_id = p_blueprint_id
    union all select 'proposal:' || id from public.course_blueprint_change_proposals where course_blueprint_id = p_blueprint_id
    union all select 'session:' || id from public.course_blueprint_editing_sessions where course_blueprint_id = p_blueprint_id
    union all
    select 'classroom:' || classroom.id || ':'
      || coalesce(classroom.source_blueprint_version_id::text, 'none') || ':'
      || coalesce(classroom.authoring_guidance_version_id::text, 'none') || ':'
      || classroom.blueprint_source_revision::text || ':'
      || encode(extensions.digest(convert_to(
        coalesce(classroom.source_blueprint_origin, 'null'::jsonb)::text,
        'UTF8'
      ), 'sha256'), 'hex')
    from public.classrooms classroom
    where classroom.source_blueprint_id = p_blueprint_id
    union all
    select 'object:' || object.id || ':' || object.storage_bucket || ':'
      || public.managed_storage_identity_sha256(object.storage_bucket, object.storage_path)
      || ':' || object.status
    from public.managed_storage_objects object
    where object.course_blueprint_id = p_blueprint_id
  ) inventory_members;

  select count(*) into v_linked from public.classrooms
  where source_blueprint_id = p_blueprint_id;

  v_counts := jsonb_build_object(
    'course_blueprints', 1,
    'course_blueprint_assignments', (select count(*) from public.course_blueprint_assignments where course_blueprint_id = p_blueprint_id),
    'course_blueprint_assessments', (select count(*) from public.course_blueprint_assessments where course_blueprint_id = p_blueprint_id),
    'course_blueprint_lesson_templates', (select count(*) from public.course_blueprint_lesson_templates where course_blueprint_id = p_blueprint_id),
    'course_blueprint_materials', (select count(*) from public.course_blueprint_materials where course_blueprint_id = p_blueprint_id),
    'course_blueprint_surveys', (select count(*) from public.course_blueprint_surveys where course_blueprint_id = p_blueprint_id),
    'course_blueprint_versions', (select count(*) from public.course_blueprint_versions where course_blueprint_id = p_blueprint_id),
    'course_blueprint_change_proposals', (select count(*) from public.course_blueprint_change_proposals where course_blueprint_id = p_blueprint_id),
    'course_blueprint_editing_sessions', (select count(*) from public.course_blueprint_editing_sessions where course_blueprint_id = p_blueprint_id),
    'managed_storage_json_references', (
      select count(*) from public.managed_storage_json_references reference
      join public.managed_storage_objects object on object.id = reference.managed_object_id
      where object.course_blueprint_id = p_blueprint_id
    ),
    'managed_storage_objects', v_file_count
  );
  select coalesce(sum(value::integer), 0) into v_row_count
  from jsonb_each_text(v_counts);

  return jsonb_build_object(
    'ok', true,
    'status', 200,
    'course_blueprint_id', p_blueprint_id,
    'course_blueprint_title', v_blueprint.title,
    'source_revision', v_blueprint.content_revision,
    'authority_mode', v_blueprint.authority_mode,
    'planned_site_published', v_blueprint.planned_site_published,
    'planned_site_slug', v_blueprint.planned_site_slug,
    'inventory_sha256', v_digest,
    'relational_row_count', v_row_count,
    'linked_classroom_count', v_linked,
    'managed_file_count', v_file_count,
    'managed_file_bytes', v_file_bytes,
    'missing_file_count', v_missing,
    'resource_counts', v_counts,
    'storage_counts', case when v_file_count = 0 then '{}'::jsonb
      else jsonb_build_object('test-documents', v_file_count) end,
    'conflicting_operation', v_conflict,
    'deletion_available', v_mode = 'enforced' and v_allowed
      and v_conflict is null and v_missing = 0
      and v_blueprint.authority_mode = 'pika',
    'unavailable_reason', case
      when v_blueprint.authority_mode <> 'pika'
        then 'Switch to Pika as Editor before deleting this Course Blueprint.'
      when v_mode <> 'enforced'
        then 'Managed file ownership enforcement is not enabled.'
      when not v_allowed
        then 'Permanent Course Blueprint deletion is not enabled.'
      when v_conflict is not null
        then 'Finish the active Course Blueprint operation before deleting permanently.'
      when v_missing > 0
        then 'One or more managed files could not be verified.'
      else null
    end
  );
end;
$$;
drop function public.create_guided_assignment_for_owner_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,timestamptz,jsonb,numeric,text,text);
drop function public.create_guided_test_for_owner_v1(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text);
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
  p_seed_sha256 text,
  p_expected_content_version_id uuid default null
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
    p_unit_exception_id, 'assignments', p_rules_markdown, p_expected_content_version_id
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
    content_version_id, source_blueprint_version_id, source_blueprint_version_number,
    source_draft_revision, unit_exception_id, unit_label, rules_markdown,
    seed_sha256, created_content_sha256, created_by
  ) values (
    p_draft_id, p_classroom_id, v_assignment.id,
    (v_context->>'content_version_id')::uuid,
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
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, timestamptz, jsonb, numeric, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_guided_assignment_for_owner_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, timestamptz, jsonb, numeric, text, text, uuid
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
  p_seed_sha256 text,
  p_expected_content_version_id uuid default null
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
    or p_draft_content->'question_identity_version' is distinct from '1'::jsonb
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
    p_unit_exception_id, 'tests', p_rules_markdown, p_expected_content_version_id
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
    content_version_id, source_blueprint_version_id, source_blueprint_version_number,
    source_draft_revision, unit_exception_id, unit_label, rules_markdown,
    seed_sha256, created_content_sha256, created_by
  ) values (
    p_draft_id, p_classroom_id, v_test.id,
    (v_context->>'content_version_id')::uuid,
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
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_guided_test_for_owner_v1(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text, uuid
) to service_role;

-- Old archives inherit content guidance; newer archives preserve their override.
alter function public.normalize_classroom_archive_restore_row(uuid,text,jsonb)
  rename to normalize_classroom_archive_restore_row_pre_v222;
revoke all on function public.normalize_classroom_archive_restore_row_pre_v222(uuid,text,jsonb)
  from public, anon, authenticated;
create function public.normalize_classroom_archive_restore_row(p_operation_id uuid,p_table_name text,p_row jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  p_row := public.normalize_classroom_archive_restore_row_pre_v222(p_operation_id,p_table_name,p_row);
  if p_table_name = 'classroom_guided_draft_provenance' then
    p_row := p_row || jsonb_build_object('content_version_id', coalesce(p_row->'content_version_id','null'::jsonb));
  end if;
  if p_table_name = 'classrooms' then
    p_row := p_row || jsonb_build_object('authoring_guidance_version_id', coalesce(p_row->'authoring_guidance_version_id','null'::jsonb));
  end if;
  return p_row;
end;
$$;
revoke all on function public.normalize_classroom_archive_restore_row(uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.normalize_classroom_archive_restore_row(uuid,text,jsonb) to service_role;
commit;
