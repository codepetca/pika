-- Match managed paths as decoded JSON values rather than raw serialized JSON.
-- This closes reservation and sharing gaps for valid paths containing quotes,
-- control characters, percent escapes, or other URL-encoded characters.

create or replace function public.classroom_purge_percent_decode(p_value text)
returns text
language plpgsql
immutable
strict
security definer
set search_path = pg_catalog
as $$
declare
  v_bytes bytea := ''::bytea;
  v_character text;
  v_hex text;
  v_index integer := 1;
begin
  while v_index <= char_length(p_value) loop
    v_character := substr(p_value, v_index, 1);
    if v_character = '%'
      and v_index + 2 <= char_length(p_value)
      and substr(p_value, v_index + 1, 2) ~ '^[0-9A-Fa-f]{2}$'
    then
      v_hex := substr(p_value, v_index + 1, 2);
      v_bytes := v_bytes || decode(v_hex, 'hex');
      v_index := v_index + 3;
    else
      v_bytes := v_bytes || convert_to(v_character, 'UTF8');
      v_index := v_index + 1;
    end if;
  end loop;
  return convert_from(v_bytes, 'UTF8');
exception
  when others then
    -- Invalid or non-UTF-8 percent sequences are not canonical managed URLs.
    return null;
end;
$$;

create or replace function public.classroom_purge_jsonb_text_values(p_payload jsonb)
returns setof text
language sql
immutable
strict
security definer
set search_path = pg_catalog
as $$
  select value #>> '{}'
  from jsonb_path_query(
    p_payload,
    'strict $.** ? (@.type() == "string")'::jsonpath
  ) value;
$$;

create or replace function public.classroom_purge_jsonb_references_storage_path(
  p_payload jsonb,
  p_storage_path text
)
returns boolean
language sql
immutable
strict
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.classroom_purge_jsonb_text_values(p_payload) candidate(value)
    where strpos(candidate.value, p_storage_path) > 0
      or strpos(
        coalesce(public.classroom_purge_percent_decode(candidate.value), ''),
        p_storage_path
      ) > 0
  );
$$;

create or replace function public.classroom_purge_storage_path_is_shared(
  p_operation_id uuid,
  p_storage_bucket text,
  p_storage_path text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_resource record;
  v_shared boolean;
begin
  if p_storage_bucket = 'assignment-artifacts' and exists (
    select 1
    from public.assignment_submission_artifacts artifact
    where artifact.storage_path = p_storage_path
      and not exists (
        select 1
        from public.classroom_purge_resources snapshot
        where snapshot.operation_id = p_operation_id
          and snapshot.table_name = 'assignment_submission_artifacts'
          and snapshot.row_id = artifact.id
      )
  ) then
    return true;
  end if;

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
  loop
    execute format(
      'select exists (
         select 1
         from public.%I source
         where public.classroom_purge_jsonb_references_storage_path(
             to_jsonb(source),
             $1
           )
           and not exists (
             select 1
             from public.classroom_purge_resources snapshot
             where snapshot.operation_id = $2
               and snapshot.table_name = $3
               and snapshot.row_id = source.%I
           )
       )',
      v_resource.table_name,
      v_resource.primary_key_column
    )
    into v_shared
    using p_storage_path, p_operation_id, v_resource.table_name;
    if v_shared then return true; end if;
  end loop;

  select exists (
    select 1 from public.course_blueprints row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_versions row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_assignments row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_assessments row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_lesson_templates row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_materials row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_surveys row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_change_proposals row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  ) or exists (
    select 1 from public.course_blueprint_editing_sessions row
    where public.classroom_purge_jsonb_references_storage_path(to_jsonb(row), p_storage_path)
  )
  into v_shared;

  return coalesce(v_shared, false);
end;
$$;

create or replace function public.reject_reserved_classroom_purge_storage_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return new;
  end if;

  perform pg_advisory_xact_lock_shared(
    hashtextextended('pika-classroom-purge-storage-references', 0)
  );

  if exists (
    select 1
    from public.classroom_purge_objects object
    join public.classroom_purge_operations operation
      on operation.id = object.operation_id
    where object.disposition = 'delete'
      and object.status in ('pending', 'processing', 'failed', 'deleted')
      and operation.status <> 'completed'
      and object.storage_path is not null
      and public.classroom_purge_jsonb_references_storage_path(
        to_jsonb(new),
        object.storage_path
      )
  ) then
    raise exception 'A managed file referenced by this content is being permanently deleted'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.classroom_purge_percent_decode(text)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_jsonb_text_values(jsonb)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_jsonb_references_storage_path(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.reject_reserved_classroom_purge_storage_reference()
  from public, anon, authenticated;

comment on function public.classroom_purge_percent_decode(text) is
  'Decodes canonical URL percent escapes for fail-safe managed-path matching.';
comment on function public.classroom_purge_jsonb_text_values(jsonb) is
  'Returns decoded JSON string scalar values without relying on serialized JSON representation.';
comment on function public.classroom_purge_jsonb_references_storage_path(jsonb, text) is
  'Matches raw or once-percent-decoded JSON string values against an exact managed storage path.';
comment on function public.reject_reserved_classroom_purge_storage_reference() is
  'Rejects canonical raw or URL-encoded path references reserved by an active classroom purge.';
