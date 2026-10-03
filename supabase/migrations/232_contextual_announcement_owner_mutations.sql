-- Provisional numbering while billing-owned 230/231 finish main integration.
-- Dormant service-only announcement writes. No admission, data backfill or grants
-- to browser roles. The caller supplies only its authenticated iron-session actor.
create function public.create_announcement_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_content text,
  p_is_draft boolean, p_scheduled_for timestamptz, p_title text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid;
  v_archived timestamptz;
  v_row public.announcements%rowtype;
begin
  -- Text is already normalized using JavaScript trim/title semantics at the
  -- request boundary; SQL must not reinterpret Unicode whitespace differently.
  if p_actor_id is null or p_classroom_id is null or p_content is null
    or p_content = '' or p_is_draft is null
    or (p_is_draft and p_scheduled_for is not null)
    or (p_scheduled_for is not null and not isfinite(p_scheduled_for))
    or char_length(p_title) > 60
    or (select sum(case when ascii(unit.character) > 65535 then 2 else 1 end)
      from regexp_split_to_table(p_title, '') as unit(character)) > 60 then
    raise exception using errcode = '22023', message = 'Invalid announcement create request';
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
    -- Future scheduling was validated against the request clock before waits.
    -- Crossing that boundary while waiting does not invalidate an accepted save.
    insert into public.announcements(classroom_id, created_by, content, title,
      is_draft, published_at, scheduled_for)
    values(p_classroom_id, p_actor_id, p_content, p_title, p_is_draft,
      case when p_is_draft then null else coalesce(p_scheduled_for, clock_timestamp()) end,
      case when p_is_draft then null else p_scheduled_for end)
    returning * into v_row;
    if not found or v_row.classroom_id is distinct from p_classroom_id
      or v_row.created_by is distinct from p_actor_id or v_row.id is null
      or v_row.content is distinct from p_content or v_row.title is distinct from p_title
      or v_row.is_draft is distinct from p_is_draft
      or v_row.scheduled_for is distinct from p_scheduled_for
      or (not p_is_draft and p_scheduled_for is not null
        and v_row.published_at is distinct from p_scheduled_for) then
      raise exception using errcode = 'PT409', message = 'Announcement binding changed';
    end if;
    return pg_catalog.jsonb_build_object('announcement', pg_catalog.jsonb_build_object(
      'id', v_row.id, 'classroom_id', v_row.classroom_id, 'content', v_row.content,
      'title', v_row.title, 'created_by', v_row.created_by, 'is_draft', v_row.is_draft,
      'published_at', v_row.published_at, 'scheduled_for', v_row.scheduled_for,
      'created_at', v_row.created_at, 'updated_at', v_row.updated_at));
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode = 'PT409', message = 'Announcement operation busy';
  end;
end;
$function$;

create function public.update_announcement_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_announcement_id uuid, p_patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid;
  v_archived timestamptz;
  v_row public.announcements%rowtype;
  v_before public.announcements%rowtype;
  v_expected public.announcements%rowtype;
  v_schedule timestamptz;
  v_draft boolean;
begin
  if p_actor_id is null or p_classroom_id is null or p_announcement_id is null
    or p_patch is null or jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Invalid announcement update request';
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) as field(key)
    where field.key not in ('content', 'title', 'is_draft', 'scheduled_for'))
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
    if p_patch ? 'content' or p_patch ? 'title' or v_draft is true or p_patch ? 'scheduled_for'
      or (v_row.is_draft, v_row.published_at, v_row.scheduled_for)
        is distinct from (v_before.is_draft, v_before.published_at, v_before.scheduled_for) then
      update public.announcements set content = v_row.content, title = v_row.title,
        is_draft = v_row.is_draft, published_at = v_row.published_at, scheduled_for = v_row.scheduled_for
        where id = p_announcement_id and classroom_id = p_classroom_id returning * into v_row;
      if not found then raise exception using errcode = 'PT409', message = 'Announcement changed'; end if;
    end if;
    if v_row.id is distinct from p_announcement_id or v_row.classroom_id is distinct from p_classroom_id
      or v_row.created_by is distinct from v_before.created_by
      or v_row.created_at is distinct from v_before.created_at
      or (v_row.content, v_row.title, v_row.is_draft, v_row.published_at, v_row.scheduled_for)
        is distinct from (v_expected.content, v_expected.title, v_expected.is_draft,
          v_expected.published_at, v_expected.scheduled_for) then
      raise exception using errcode = 'PT409', message = 'Announcement binding changed';
    end if;
    return pg_catalog.jsonb_build_object('announcement', pg_catalog.jsonb_build_object(
      'id', v_row.id, 'classroom_id', v_row.classroom_id, 'content', v_row.content,
      'title', v_row.title, 'created_by', v_row.created_by, 'is_draft', v_row.is_draft,
      'published_at', v_row.published_at, 'scheduled_for', v_row.scheduled_for,
      'created_at', v_row.created_at, 'updated_at', v_row.updated_at));
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode = 'PT409', message = 'Announcement operation busy';
  end;
end;
$function$;

create function public.delete_announcement_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_announcement_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid;
  v_archived timestamptz;
  v_id uuid;
begin
  if p_actor_id is null or p_classroom_id is null or p_announcement_id is null then
    raise exception using errcode = '22023', message = 'Invalid announcement deletion request';
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
    select id into v_id from public.announcements
      where id = p_announcement_id and classroom_id = p_classroom_id for update nowait;
    if not found then raise exception using errcode = 'PT404', message = 'Announcement not found'; end if;
    -- Keep receipt cascades, removed-academic guards and revision triggers intact.
    delete from public.announcements where id = p_announcement_id and classroom_id = p_classroom_id
      returning id into v_id;
    if not found or v_id is distinct from p_announcement_id then
      raise exception using errcode = 'PT409', message = 'Announcement changed';
    end if;
    return pg_catalog.jsonb_build_object('deleted', true,
      'announcement_id', v_id, 'classroom_id', p_classroom_id);
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode = 'PT409', message = 'Announcement operation busy';
  end;
end;
$function$;

revoke all on function public.create_announcement_for_owner_v1(uuid,uuid,text,boolean,timestamptz,text)
  from public, anon, authenticated;
revoke all on function public.update_announcement_for_owner_v1(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
revoke all on function public.delete_announcement_for_owner_v1(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.create_announcement_for_owner_v1(uuid,uuid,text,boolean,timestamptz,text) to service_role;
grant execute on function public.update_announcement_for_owner_v1(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.delete_announcement_for_owner_v1(uuid,uuid,uuid) to service_role;
