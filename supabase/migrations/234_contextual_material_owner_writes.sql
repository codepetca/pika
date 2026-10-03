-- Candidate source only until the exact reviewed migration is locally approved.
-- Shared admission remains OFF. Retain creator193 and all existing triggers.
begin;

create function private.material_owner_write_title_v1(p_title text)
returns text language sql immutable strict set search_path = '' as $function$
  -- Match JavaScript String.trim, including non-ASCII whitespace.
  select pg_catalog.btrim(p_title, E' \t\n\r\f' || pg_catalog.chr(11) || pg_catalog.chr(160)
    || pg_catalog.chr(5760) || pg_catalog.chr(8192) || pg_catalog.chr(8193)
    || pg_catalog.chr(8194) || pg_catalog.chr(8195) || pg_catalog.chr(8196)
    || pg_catalog.chr(8197) || pg_catalog.chr(8198) || pg_catalog.chr(8199)
    || pg_catalog.chr(8200) || pg_catalog.chr(8201) || pg_catalog.chr(8202)
    || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239)
    || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279));
$function$;

create function private.material_owner_write_utf16_length_v1(p_text text)
returns bigint language sql immutable strict set search_path = '' as $function$
  select coalesce(sum(case when pg_catalog.ascii(unit.character) > 65535 then 2 else 1 end), 0)
  from pg_catalog.regexp_split_to_table(p_text, '') as unit(character)
  where unit.character <> '';
$function$;

create function private.valid_material_owner_write_content_v1(p_content jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  -- Same bounded document contract as isValidTiptapContent at the HTTP boundary.
  with recursive nodes(node, depth) as (
    select child.value, 1 from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p_content->'content') = 'array'
        then p_content->'content' else '[]'::jsonb end) child
    union all
    select child.value, parent.depth + 1 from nodes parent
      cross join lateral pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(parent.node->'content') = 'array'
          then parent.node->'content' else '[]'::jsonb end) child
      where parent.depth <= 100
  )
  select coalesce(pg_catalog.jsonb_typeof(p_content) = 'object'
    and p_content->>'type' = 'doc'
    and (not p_content ? 'content' or pg_catalog.jsonb_typeof(p_content->'content') = 'array')
    and (select count(*) <= 10000 from nodes)
    and not exists(select 1 from nodes where depth > 100
      or pg_catalog.jsonb_typeof(node) is distinct from 'object'
      or pg_catalog.jsonb_typeof(node->'type') is distinct from 'string'
      or private.material_owner_write_utf16_length_v1(node->>'type') not between 1 and 100
      or (node ? 'text' and (pg_catalog.jsonb_typeof(node->'text') is distinct from 'string'
        or pg_catalog.char_length(node->>'text') > 1000000
        or (pg_catalog.char_length(node->>'text') > 500000
          and private.material_owner_write_utf16_length_v1(node->>'text') > 1000000)))
      or (node ? 'attrs' and pg_catalog.jsonb_typeof(node->'attrs') is distinct from 'object')
      or (node ? 'content' and (pg_catalog.jsonb_typeof(node->'content') is distinct from 'array'
        or pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(node->'content') = 'array'
          then node->'content' else '[]'::jsonb end) > 10000))
      or (node ? 'marks' and (pg_catalog.jsonb_typeof(node->'marks') is distinct from 'array'
        or pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(node->'marks') = 'array'
          then node->'marks' else '[]'::jsonb end) > 100
        or exists(select 1 from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(node->'marks') = 'array' then node->'marks' else '[]'::jsonb end) mark
          where pg_catalog.jsonb_typeof(mark.value) is distinct from 'object'
            or pg_catalog.jsonb_typeof(mark.value->'type') is distinct from 'string'
            or mark.value->>'type' = ''
            or (mark.value ? 'attrs' and pg_catalog.jsonb_typeof(mark.value->'attrs') is distinct from 'object'))))
    ), false);
$function$;

create function private.valid_material_owner_write_uuid_v1(p_uuid uuid)
returns boolean language sql immutable set search_path = '' as $function$
  -- Match installed Zod4 z.string().uuid(), including its nil/max exceptions.
  select coalesce(p_uuid::text ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$', false);
$function$;

create function private.valid_material_owner_write_timestamp_v1(p_timestamp timestamptz)
returns boolean language sql stable set search_path = '' as $function$
  -- Check the actual emitted JSON string under this transaction's TimeZone.
  -- PostgreSQL supplies valid calendar dates, but finite BC/>9999 years and
  -- historical zones with offset seconds do not satisfy the SDK datetime schema.
  select coalesce(pg_catalog.isfinite(p_timestamp)
    and extract(year from p_timestamp) between 1 and 9999
    and (pg_catalog.to_jsonb(p_timestamp) #>> '{}') ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$', false);
$function$;

create function private.valid_material_owner_write_row_v1(p_material public.classwork_materials)
returns boolean language sql stable set search_path = '' as $function$
  -- Validate the complete materialReadRowSchema transport before committing.
  -- This also fails closed if a future table column widens to_jsonb's payload.
  select coalesce(
    (select count(*) = 14 from pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(p_material)))
    and not exists(select 1 from pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(p_material)) field(key)
      where field.key not in ('id','classroom_id','title','content','is_draft','released_at',
        'created_by','created_at','updated_at','position','artifact_id','source_artifact_id',
        'blueprint_archived_at','source_blueprint_version_id'))
    and private.valid_material_owner_write_uuid_v1((p_material).id)
    and private.valid_material_owner_write_uuid_v1((p_material).classroom_id)
    and (p_material).title is not null
    and private.valid_material_owner_write_content_v1((p_material).content)
    and (p_material).is_draft is not null
    and ((p_material).released_at is null or private.valid_material_owner_write_timestamp_v1((p_material).released_at))
    and private.valid_material_owner_write_uuid_v1((p_material).created_by)
    and private.valid_material_owner_write_timestamp_v1((p_material).created_at)
    and private.valid_material_owner_write_timestamp_v1((p_material).updated_at)
    and (p_material).position is not null and (p_material).position between -2147483648 and 2147483647
    and private.valid_material_owner_write_uuid_v1((p_material).artifact_id)
    and ((p_material).source_artifact_id is null or private.valid_material_owner_write_uuid_v1((p_material).source_artifact_id))
    and ((p_material).blueprint_archived_at is null or private.valid_material_owner_write_timestamp_v1((p_material).blueprint_archived_at))
    and ((p_material).source_blueprint_version_id is null or private.valid_material_owner_write_uuid_v1((p_material).source_blueprint_version_id)), false);
$function$;

create function public.create_classwork_material_for_owner_v2(
  p_actor_id uuid, p_classroom_id uuid, p_title text, p_content jsonb, p_is_draft boolean
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid;
  v_archived timestamptz;
  v_result jsonb;
  v_row public.classwork_materials%rowtype;
  v_next_position integer;
begin
  if not private.valid_material_owner_write_uuid_v1(p_actor_id)
    or not private.valid_material_owner_write_uuid_v1(p_classroom_id) or p_title is null
    or private.material_owner_write_title_v1(p_title) = ''
    or p_title is distinct from private.material_owner_write_title_v1(p_title)
    or private.material_owner_write_utf16_length_v1(p_title) > 500
    or not private.valid_material_owner_write_content_v1(p_content) or p_is_draft is null then
    raise exception using errcode = '22023', message = 'Invalid material creation request';
  end if;
  begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'pika-classroom-operation:' || p_classroom_id::text, 0));
    perform public.guard_classroom_purge_lifecycle(p_classroom_id);
    select teacher_id, archived_at into v_owner, v_archived
      from public.classrooms where id = p_classroom_id for update nowait;
    if not found then raise exception using errcode = 'P0002', message = 'Classroom not found'; end if;
    if v_owner is distinct from p_actor_id or v_archived is not null then
      raise exception using errcode = '42501', message = 'Forbidden';
    end if;
    -- The old creator's blocking parent lock is reentrant after NOWAIT succeeds.
    -- Retain the canonical mixed Assignment/material/survey allocator unchanged.
    v_next_position := private.lock_classwork_creation_context_v1(p_actor_id, p_classroom_id);
    v_result := public.create_classwork_material_for_owner_v1(
      p_actor_id, p_classroom_id, p_title, p_content, p_is_draft);
    if v_result->'ok' is distinct from 'true'::jsonb
      or pg_catalog.jsonb_typeof(v_result->'material'->'id') is distinct from 'string' then
      raise exception using errcode = 'PT409', message = 'Material creation changed';
    end if;
    -- Re-read after all AFTER triggers, not only the creator's RETURNING image.
    select * into v_row from public.classwork_materials
      where id = (v_result->'material'->>'id')::uuid and classroom_id = p_classroom_id;
    if not found or pg_catalog.to_jsonb(v_row) is distinct from v_result->'material'
      or v_row.created_by is distinct from p_actor_id or v_row.title is distinct from p_title
      or v_row.content is distinct from p_content or v_row.is_draft is distinct from p_is_draft
      or (p_is_draft and v_row.released_at is not null)
      or (not p_is_draft and v_row.released_at is null)
      or v_row.position is distinct from v_next_position
      or v_row.source_artifact_id is not null or v_row.source_blueprint_version_id is not null
      or v_row.blueprint_archived_at is not null
      or v_row.created_at is distinct from pg_catalog.transaction_timestamp()
      or v_row.updated_at is distinct from pg_catalog.transaction_timestamp()
      or (v_row.released_at is not null and not pg_catalog.isfinite(v_row.released_at)) then
      raise exception using errcode = 'PT409', message = 'Material creation binding changed';
    end if;
    perform 1 from public.classrooms where id = p_classroom_id
      and teacher_id = p_actor_id and archived_at is null;
    if not found then raise exception using errcode = 'PT409', message = 'Classroom binding changed'; end if;
    if not private.valid_material_owner_write_row_v1(v_row) then
      raise exception using errcode = 'PT503', message = 'Unable to verify material mutation';
    end if;
    return pg_catalog.jsonb_build_object('actor_id', p_actor_id, 'classroom_id', p_classroom_id,
      'material', pg_catalog.to_jsonb(v_row));
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode = 'PT409', message = 'Material operation busy';
  end;
end;
$function$;

create function public.update_classwork_material_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_material_id uuid, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid;
  v_archived timestamptz;
  v_before public.classwork_materials%rowtype;
  v_expected public.classwork_materials%rowtype;
  v_returned public.classwork_materials%rowtype;
  v_row public.classwork_materials%rowtype;
begin
  if not private.valid_material_owner_write_uuid_v1(p_actor_id)
    or not private.valid_material_owner_write_uuid_v1(p_classroom_id)
    or not private.valid_material_owner_write_uuid_v1(p_material_id)
    or p_patch is null or pg_catalog.jsonb_typeof(p_patch) is distinct from 'object'
    or p_patch = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Invalid material update request';
  end if;
  if exists(select 1 from pg_catalog.jsonb_object_keys(p_patch) field(key)
    where field.key not in ('title', 'content', 'is_draft'))
    or (p_patch ? 'title' and (pg_catalog.jsonb_typeof(p_patch->'title') is distinct from 'string'
      or private.material_owner_write_title_v1(p_patch->>'title') = ''
      or p_patch->>'title' is distinct from private.material_owner_write_title_v1(p_patch->>'title')))
    or (p_patch ? 'content' and not private.valid_material_owner_write_content_v1(p_patch->'content'))
    or (p_patch ? 'is_draft' and pg_catalog.jsonb_typeof(p_patch->'is_draft') is distinct from 'boolean') then
    raise exception using errcode = '22023', message = 'Invalid material update request';
  end if;
  begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'pika-classroom-operation:' || p_classroom_id::text, 0));
    perform public.guard_classroom_purge_lifecycle(p_classroom_id);
    select teacher_id, archived_at into v_owner, v_archived
      from public.classrooms where id = p_classroom_id for update nowait;
    if not found then raise exception using errcode = 'P0002', message = 'Classroom not found'; end if;
    if v_owner is distinct from p_actor_id or v_archived is not null then
      raise exception using errcode = '42501', message = 'Forbidden';
    end if;
    select * into v_before from public.classwork_materials
      where id = p_material_id and classroom_id = p_classroom_id for update nowait;
    if not found then raise exception using errcode = 'PT404', message = 'Material not found'; end if;
    v_expected := v_before;
    if p_patch ? 'title' then v_expected.title := p_patch->>'title'; end if;
    if p_patch ? 'content' then v_expected.content := p_patch->'content'; end if;
    if p_patch ? 'is_draft' then
      v_expected.is_draft := (p_patch->>'is_draft')::boolean;
      v_expected.released_at := case when v_expected.is_draft then null
        else coalesce(v_before.released_at, pg_catalog.clock_timestamp()) end;
    end if;
    -- Every accepted PATCH executes UPDATE, including identical publication saves.
    -- Immutable identity, position, author, artifact and lineage never occur in SET.
    update public.classwork_materials set title = v_expected.title, content = v_expected.content,
      is_draft = v_expected.is_draft, released_at = v_expected.released_at
      where id = p_material_id and classroom_id = p_classroom_id returning * into v_returned;
    if not found then raise exception using errcode = 'PT409', message = 'Material changed'; end if;
    select * into v_row from public.classwork_materials
      where id = p_material_id and classroom_id = p_classroom_id;
    if not found or pg_catalog.to_jsonb(v_row) is distinct from pg_catalog.to_jsonb(v_returned)
      or (v_row.id, v_row.classroom_id, v_row.created_by, v_row.created_at, v_row.position,
        v_row.artifact_id, v_row.source_artifact_id, v_row.source_blueprint_version_id, v_row.blueprint_archived_at)
        is distinct from (v_before.id, v_before.classroom_id, v_before.created_by, v_before.created_at,
          v_before.position, v_before.artifact_id, v_before.source_artifact_id,
          v_before.source_blueprint_version_id, v_before.blueprint_archived_at)
      or v_row.updated_at is distinct from pg_catalog.transaction_timestamp()
      or (v_row.title, v_row.content, v_row.is_draft, v_row.released_at)
        is distinct from (v_expected.title, v_expected.content, v_expected.is_draft, v_expected.released_at) then
      raise exception using errcode = 'PT409', message = 'Material binding changed';
    end if;
    perform 1 from public.classrooms where id = p_classroom_id
      and teacher_id = p_actor_id and archived_at is null;
    if not found then raise exception using errcode = 'PT409', message = 'Classroom binding changed'; end if;
    if not private.valid_material_owner_write_row_v1(v_row) then
      raise exception using errcode = 'PT503', message = 'Unable to verify material mutation';
    end if;
    return pg_catalog.jsonb_build_object('actor_id', p_actor_id, 'classroom_id', p_classroom_id,
      'material', pg_catalog.to_jsonb(v_row));
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode = 'PT409', message = 'Material operation busy';
  end;
end;
$function$;

create function public.delete_classwork_material_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_material_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid;
  v_archived timestamptz;
  v_before public.classwork_materials%rowtype;
  v_deleted public.classwork_materials%rowtype;
begin
  if not private.valid_material_owner_write_uuid_v1(p_actor_id)
    or not private.valid_material_owner_write_uuid_v1(p_classroom_id)
    or not private.valid_material_owner_write_uuid_v1(p_material_id) then
    raise exception using errcode = '22023', message = 'Invalid material deletion request';
  end if;
  begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'pika-classroom-operation:' || p_classroom_id::text, 0));
    perform public.guard_classroom_purge_lifecycle(p_classroom_id);
    select teacher_id, archived_at into v_owner, v_archived
      from public.classrooms where id = p_classroom_id for update nowait;
    if not found then raise exception using errcode = 'P0002', message = 'Classroom not found'; end if;
    if v_owner is distinct from p_actor_id or v_archived is not null then
      raise exception using errcode = '42501', message = 'Forbidden';
    end if;
    select * into v_before from public.classwork_materials
      where id = p_material_id and classroom_id = p_classroom_id for update nowait;
    if not found then raise exception using errcode = 'PT404', message = 'Material not found'; end if;
    -- Existing archive, Blueprint lineage, purge and revision triggers remain intact.
    delete from public.classwork_materials where id = p_material_id and classroom_id = p_classroom_id
      returning * into v_deleted;
    if not found or pg_catalog.to_jsonb(v_deleted) is distinct from pg_catalog.to_jsonb(v_before)
      or exists(select 1 from public.classwork_materials where id = p_material_id) then
      raise exception using errcode = 'PT409', message = 'Material deletion binding changed';
    end if;
    perform 1 from public.classrooms where id = p_classroom_id
      and teacher_id = p_actor_id and archived_at is null;
    if not found then raise exception using errcode = 'PT409', message = 'Classroom binding changed'; end if;
    return pg_catalog.jsonb_build_object('deleted', true, 'actor_id', p_actor_id,
      'classroom_id', p_classroom_id, 'material_id', p_material_id);
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode = 'PT409', message = 'Material operation busy';
  end;
end;
$function$;

revoke all on function private.material_owner_write_title_v1(text) from public, anon, authenticated, service_role;
revoke all on function private.material_owner_write_utf16_length_v1(text) from public, anon, authenticated, service_role;
revoke all on function private.valid_material_owner_write_content_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.valid_material_owner_write_uuid_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function private.valid_material_owner_write_timestamp_v1(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.valid_material_owner_write_row_v1(public.classwork_materials) from public, anon, authenticated, service_role;
revoke all on function public.create_classwork_material_for_owner_v2(uuid,uuid,text,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.update_classwork_material_for_owner_v1(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.delete_classwork_material_for_owner_v1(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.create_classwork_material_for_owner_v2(uuid,uuid,text,jsonb,boolean) to service_role;
grant execute on function public.update_classwork_material_for_owner_v1(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.delete_classwork_material_for_owner_v1(uuid,uuid,uuid) to service_role;
commit;
