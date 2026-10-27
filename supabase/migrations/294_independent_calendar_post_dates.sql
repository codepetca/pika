-- A calendar label is independent of actual publication/release availability.
-- No backfill: legacy null labels fall back to the existing release day in readers.
-- Existing mutation RPCs omit a null posted_on key for strict-decoder compatibility.
begin;

alter table public.announcements add column posted_on date;
alter table public.classwork_materials add column posted_on date;
alter table public.announcements add constraint announcements_posted_on_civil_day_check
  check (posted_on is null or posted_on between date '0001-01-01' and date '9999-12-31');
alter table public.classwork_materials add constraint classwork_materials_posted_on_civil_day_check
  check (posted_on is null or posted_on between date '0001-01-01' and date '9999-12-31');
comment on column public.announcements.posted_on is 'Calendar post date; does not control publication or scheduling. Null uses the legacy published_at day.';
comment on column public.classwork_materials.posted_on is 'Calendar post date; does not control release or scheduling. Null uses the legacy released_at day.';

create or replace function private.valid_material_owner_write_row_v1(p_material public.classwork_materials)
returns boolean language sql stable set search_path = '' as $function$
  -- Validate the complete materialReadRowSchema transport before committing.
  -- This also fails closed if a future table column widens to_jsonb's payload.
  select coalesce(
    (select count(*) = 15 from pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(p_material)))
    and not exists(select 1 from pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(p_material)) field(key)
      where field.key not in ('id','classroom_id','title','content','is_draft','released_at',
        'created_by','created_at','updated_at','position','artifact_id','source_artifact_id',
        'blueprint_archived_at','source_blueprint_version_id','posted_on'))
    and ((p_material).posted_on is null or (p_material).posted_on between date '0001-01-01' and date '9999-12-31')
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

create or replace function public.create_classwork_material_for_owner_v2(
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
      or v_row.blueprint_archived_at is not null or v_row.posted_on is not null
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
      'material', case when v_row.posted_on is null then pg_catalog.to_jsonb(v_row) - 'posted_on' else pg_catalog.to_jsonb(v_row) end);
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode = 'PT409', message = 'Material operation busy';
  end;
end;
$function$;

create or replace function public.update_classwork_material_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_material_id uuid, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_schedule timestamptz;
  v_posted_on date;
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
    where field.key not in ('title', 'content', 'is_draft', 'scheduled_for', 'posted_on'))
    or (p_patch ? 'title' and (pg_catalog.jsonb_typeof(p_patch->'title') is distinct from 'string'
      or private.material_owner_write_title_v1(p_patch->>'title') = ''
      or p_patch->>'title' is distinct from private.material_owner_write_title_v1(p_patch->>'title')))
    or (p_patch ? 'content' and not private.valid_material_owner_write_content_v1(p_patch->'content'))
    or (p_patch ? 'is_draft' and pg_catalog.jsonb_typeof(p_patch->'is_draft') is distinct from 'boolean')
    or (p_patch ? 'scheduled_for' and pg_catalog.jsonb_typeof(p_patch->'scheduled_for') not in ('string', 'null')) then
    raise exception using errcode = '22023', message = 'Invalid material update request';
  end if;
  if p_patch ? 'posted_on' then
    if pg_catalog.jsonb_typeof(p_patch->'posted_on') is distinct from 'string'
      or p_patch->>'posted_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or pg_catalog.left(p_patch->>'posted_on', 4) = '0000' then
      raise exception using errcode = '22023', message = 'Invalid post date';
    end if;
    begin
      v_posted_on := (p_patch->>'posted_on')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'Invalid post date';
    end;
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
    if p_patch ? 'posted_on' then
      v_expected.posted_on := v_posted_on;
    end if;
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
      is_draft = v_expected.is_draft, released_at = v_expected.released_at, posted_on = v_expected.posted_on
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
      or (v_row.title, v_row.content, v_row.is_draft, v_row.released_at, v_row.posted_on)
        is distinct from (v_expected.title, v_expected.content, v_expected.is_draft, v_expected.released_at, v_expected.posted_on) then
      raise exception using errcode = 'PT409', message = 'Material binding changed';
    end if;
    perform 1 from public.classrooms where id = p_classroom_id
      and teacher_id = p_actor_id and archived_at is null;
    if not found then raise exception using errcode = 'PT409', message = 'Classroom binding changed'; end if;
    if not private.valid_material_owner_write_row_v1(v_row) then
      raise exception using errcode = 'PT503', message = 'Unable to verify material mutation';
    end if;
    return pg_catalog.jsonb_build_object('actor_id', p_actor_id, 'classroom_id', p_classroom_id,
      'material', case when v_row.posted_on is null then pg_catalog.to_jsonb(v_row) - 'posted_on' else pg_catalog.to_jsonb(v_row) end);
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode = 'PT409', message = 'Material operation busy';
  end;
end;
$function$;

-- CREATE OR REPLACE retains the existing service-only execution contract.
revoke all on function public.update_classwork_material_for_owner_v1(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.update_classwork_material_for_owner_v1(uuid,uuid,uuid,jsonb) to service_role;


create or replace function public.update_announcement_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_announcement_id uuid, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid;
  v_archived timestamptz;
  v_row public.announcements%rowtype;
  v_before public.announcements%rowtype;
  v_expected public.announcements%rowtype;
  v_returned public.announcements%rowtype;
  v_posted_on date;
  v_schedule timestamptz;
  v_draft boolean;
begin
  if p_actor_id is null or p_classroom_id is null or p_announcement_id is null
    or p_patch is null or jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Invalid announcement update request';
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) as field(key)
    where field.key not in ('content', 'title', 'is_draft', 'scheduled_for', 'posted_on'))
    or (p_patch ? 'content' and (jsonb_typeof(p_patch->'content') is distinct from 'string'
      or p_patch->>'content' = ''))
    or (p_patch ? 'title' and (jsonb_typeof(p_patch->'title') not in ('string', 'null')
      or char_length(p_patch->>'title') > 60
      or (select sum(case when ascii(unit.character) > 65535 then 2 else 1 end)
        from regexp_split_to_table(p_patch->>'title', '') as unit(character)) > 60))
    or (p_patch ? 'is_draft' and jsonb_typeof(p_patch->'is_draft') is distinct from 'boolean')
    or (p_patch ? 'scheduled_for' and jsonb_typeof(p_patch->'scheduled_for') not in ('string', 'null')) then
    raise exception using errcode = '22023', message = 'Invalid announcement update request';
  end if;
  if p_patch ? 'posted_on' then
    if pg_catalog.jsonb_typeof(p_patch->'posted_on') is distinct from 'string'
      or p_patch->>'posted_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or pg_catalog.left(p_patch->>'posted_on', 4) = '0000' then
      raise exception using errcode = '22023', message = 'Invalid post date';
    end if;
    begin
      v_posted_on := (p_patch->>'posted_on')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'Invalid post date';
    end;
  end if;
  v_draft := (p_patch->>'is_draft')::boolean;
  begin
    v_schedule := (p_patch->>'scheduled_for')::timestamptz;
  exception when sqlstate '22007' or sqlstate '22008' then
    raise exception using errcode = '22023', message = 'Invalid announcement schedule';
  end;
  if (v_schedule is not null and not isfinite(v_schedule))
    or (v_draft is true and v_schedule is not null) then
    raise exception using errcode = '22023', message = 'Invalid announcement schedule';
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
    select * into v_row from public.announcements
      where id = p_announcement_id and classroom_id = p_classroom_id for update nowait;
    if not found then raise exception using errcode = 'PT404', message = 'Announcement not found'; end if;
    v_before := v_row;
    if p_patch ? 'content' then v_row.content := p_patch->>'content'; end if;
    if p_patch ? 'title' then v_row.title := p_patch->>'title'; end if;
    if p_patch ? 'posted_on' then
      v_row.posted_on := v_posted_on;
    end if;
    if v_draft is true then
      v_row.is_draft := true; v_row.published_at := null; v_row.scheduled_for := null;
    elsif p_patch ? 'scheduled_for' then
      v_row.is_draft := false;
      v_row.published_at := coalesce(v_schedule, clock_timestamp());
      v_row.scheduled_for := v_schedule;
    elsif v_draft is false and v_row.is_draft then
      v_row.is_draft := false; v_row.published_at := clock_timestamp(); v_row.scheduled_for := null;
    end if;
    v_expected := v_row;
    -- A publication no-op advances neither updated_at nor archive revision.
    -- Content/title presence still performs the existing explicit save operation.
    if p_patch ? 'posted_on' or p_patch ? 'content' or p_patch ? 'title' or v_draft is true or p_patch ? 'scheduled_for'
      or (v_row.is_draft, v_row.published_at, v_row.scheduled_for)
        is distinct from (v_before.is_draft, v_before.published_at, v_before.scheduled_for) then
      update public.announcements set content = v_row.content, title = v_row.title,
        is_draft = v_row.is_draft, published_at = v_row.published_at, scheduled_for = v_row.scheduled_for, posted_on = v_row.posted_on
        where id = p_announcement_id and classroom_id = p_classroom_id returning * into v_row;
      if not found then raise exception using errcode = 'PT409', message = 'Announcement changed'; end if;
      v_returned := v_row;
      select * into v_row from public.announcements
        where id = p_announcement_id and classroom_id = p_classroom_id;
      if not found or pg_catalog.to_jsonb(v_row) is distinct from pg_catalog.to_jsonb(v_returned)
        or v_row.updated_at is distinct from pg_catalog.transaction_timestamp() then
        raise exception using errcode = 'PT409', message = 'Announcement binding changed';
      end if;
    end if;
    if v_row.id is distinct from p_announcement_id or v_row.classroom_id is distinct from p_classroom_id
      or v_row.created_by is distinct from v_before.created_by
      or v_row.created_at is distinct from v_before.created_at
      or (v_row.content, v_row.title, v_row.is_draft, v_row.published_at, v_row.scheduled_for, v_row.posted_on)
        is distinct from (v_expected.content, v_expected.title, v_expected.is_draft,
          v_expected.published_at, v_expected.scheduled_for, v_expected.posted_on) then
      raise exception using errcode = 'PT409', message = 'Announcement binding changed';
    end if;
    perform 1 from public.classrooms where id = p_classroom_id
      and teacher_id = p_actor_id and archived_at is null;
    if not found then raise exception using errcode = 'PT409', message = 'Classroom binding changed'; end if;
    return pg_catalog.jsonb_build_object('announcement', pg_catalog.jsonb_build_object(
      'id', v_row.id, 'classroom_id', v_row.classroom_id, 'content', v_row.content,
      'title', v_row.title, 'created_by', v_row.created_by, 'is_draft', v_row.is_draft,
      'published_at', v_row.published_at, 'scheduled_for', v_row.scheduled_for,
      'created_at', v_row.created_at, 'updated_at', v_row.updated_at)
      || case when v_row.posted_on is null then '{}'::jsonb
        else pg_catalog.jsonb_build_object('posted_on', v_row.posted_on) end);
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode = 'PT409', message = 'Announcement operation busy';
  end;
end;
$function$;

revoke all on function public.update_announcement_for_owner_v1(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.update_announcement_for_owner_v1(uuid,uuid,uuid,jsonb) to service_role;


-- The legacy creators keep their signatures. Nested calls are atomic and retain
-- their advisory/parent locks through the guarded date-only update.
create function public.create_announcement_for_owner_v2(
  p_actor_id uuid, p_classroom_id uuid, p_content text,
  p_is_draft boolean, p_scheduled_for timestamptz, p_title text,
  p_posted_on date default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_result jsonb;
begin
  if p_posted_on is not null and not (p_posted_on between date '0001-01-01' and date '9999-12-31') then
    raise exception using errcode = '22023', message = 'Invalid post date';
  end if;
  v_result := public.create_announcement_for_owner_v1(
    p_actor_id, p_classroom_id, p_content, p_is_draft, p_scheduled_for, p_title);
  if p_posted_on is not null then
    v_result := public.update_announcement_for_owner_v1(
      p_actor_id, p_classroom_id, (v_result->'announcement'->>'id')::uuid,
      pg_catalog.jsonb_build_object('posted_on', p_posted_on));
  end if;
  return v_result;
end;
$function$;

create function public.create_classwork_material_for_owner_v4(
  p_actor_id uuid, p_classroom_id uuid, p_title text, p_content jsonb,
  p_is_draft boolean, p_scheduled_for timestamptz default null,
  p_posted_on date default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_result jsonb;
begin
  if p_posted_on is not null and not (p_posted_on between date '0001-01-01' and date '9999-12-31') then
    raise exception using errcode = '22023', message = 'Invalid post date';
  end if;
  v_result := public.create_classwork_material_for_owner_v3(
    p_actor_id, p_classroom_id, p_title, p_content, p_is_draft, p_scheduled_for);
  if p_posted_on is not null then
    v_result := public.update_classwork_material_for_owner_v1(
      p_actor_id, p_classroom_id, (v_result->'material'->>'id')::uuid,
      pg_catalog.jsonb_build_object('posted_on', p_posted_on));
  end if;
  return v_result;
end;
$function$;

revoke all on function public.create_classwork_material_for_owner_v2(uuid,uuid,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.create_classwork_material_for_owner_v2(uuid,uuid,text,jsonb,boolean) to service_role;
revoke all on function public.create_announcement_for_owner_v2(uuid,uuid,text,boolean,timestamptz,text,date) from public, anon, authenticated;
grant execute on function public.create_announcement_for_owner_v2(uuid,uuid,text,boolean,timestamptz,text,date) to service_role;
revoke all on function public.create_classwork_material_for_owner_v4(uuid,uuid,text,jsonb,boolean,timestamptz,date) from public, anon, authenticated;
grant execute on function public.create_classwork_material_for_owner_v4(uuid,uuid,text,jsonb,boolean,timestamptz,date) to service_role;
commit;
