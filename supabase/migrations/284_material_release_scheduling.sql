-- Persist material scheduling in released_at; no worker or due date is needed.
begin;

create or replace function public.update_classwork_material_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_material_id uuid, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_schedule timestamptz;
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
    where field.key not in ('title', 'content', 'is_draft', 'scheduled_for'))
    or (p_patch ? 'title' and (pg_catalog.jsonb_typeof(p_patch->'title') is distinct from 'string'
      or private.material_owner_write_title_v1(p_patch->>'title') = ''
      or p_patch->>'title' is distinct from private.material_owner_write_title_v1(p_patch->>'title')))
    or (p_patch ? 'content' and not private.valid_material_owner_write_content_v1(p_patch->'content'))
    or (p_patch ? 'is_draft' and pg_catalog.jsonb_typeof(p_patch->'is_draft') is distinct from 'boolean')
    or (p_patch ? 'scheduled_for' and pg_catalog.jsonb_typeof(p_patch->'scheduled_for') not in ('string', 'null')) then
    raise exception using errcode = '22023', message = 'Invalid material update request';
  end if;
  begin
    v_schedule := (p_patch->>'scheduled_for')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Invalid scheduled date';
  end;
  if v_schedule is not null and (not pg_catalog.isfinite(v_schedule)
    or v_schedule <= pg_catalog.clock_timestamp()
    or not private.valid_material_owner_write_timestamp_v1(v_schedule)
    or p_patch->>'is_draft' = 'true') then
    raise exception using errcode = '22023', message = 'Invalid scheduled date';
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
    if p_patch->>'is_draft' = 'true' then
      v_expected.is_draft := true;
      v_expected.released_at := null;
    elsif p_patch ? 'scheduled_for' then
      v_expected.is_draft := false;
      v_expected.released_at := coalesce(v_schedule, pg_catalog.clock_timestamp());
    elsif p_patch ? 'is_draft' then
      v_expected.is_draft := false;
      v_expected.released_at := coalesce(v_before.released_at, pg_catalog.clock_timestamp());
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

create function public.create_classwork_material_for_owner_v3(
  p_actor_id uuid, p_classroom_id uuid, p_title text, p_content jsonb,
  p_is_draft boolean, p_scheduled_for timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_result jsonb;
begin
  if p_scheduled_for is not null and (p_is_draft is distinct from false
    or not private.valid_material_owner_write_timestamp_v1(p_scheduled_for)
    or p_scheduled_for <= pg_catalog.clock_timestamp()) then
    raise exception using errcode = '22023', message = 'Invalid scheduled date';
  end if;
  -- Nested RPC calls share one transaction and the existing owner/operation locks.
  v_result := public.create_classwork_material_for_owner_v2(
    p_actor_id, p_classroom_id, p_title, p_content, p_is_draft);
  if p_scheduled_for is not null then
    v_result := public.update_classwork_material_for_owner_v1(
      p_actor_id, p_classroom_id, (v_result->'material'->>'id')::uuid,
      pg_catalog.jsonb_build_object('scheduled_for', p_scheduled_for));
  end if;
  return v_result;
end;
$function$;
revoke all on function public.create_classwork_material_for_owner_v3(uuid,uuid,text,jsonb,boolean,timestamptz) from public, anon, authenticated;
grant execute on function public.create_classwork_material_for_owner_v3(uuid,uuid,text,jsonb,boolean,timestamptz) to service_role;

commit;
