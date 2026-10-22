-- Change an already published announcement's calendar post date.
-- No signatures, columns, creation semantics or browser grants change.
begin;

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
      or pg_catalog.left(p_patch->>'posted_on', 4) = '0000'
      or p_patch ? 'scheduled_for' or p_patch->>'is_draft' = 'true' then
      raise exception using errcode = '22023', message = 'Invalid post date';
    end if;
    begin
      v_posted_on := (p_patch->>'posted_on')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'Invalid post date';
    end;
    if v_posted_on > (pg_catalog.clock_timestamp() at time zone 'America/Toronto')::date then
      raise exception using errcode = '22023', message = 'Invalid post date';
    end if;
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
    if p_patch ? 'posted_on' and (v_before.is_draft or v_before.published_at is null
      or v_before.published_at > pg_catalog.clock_timestamp()
      or v_before.scheduled_for > pg_catalog.clock_timestamp()) then
      raise exception using errcode = '22023', message = 'Only posted announcements have a post date';
    end if;
    if p_patch ? 'content' then v_row.content := p_patch->>'content'; end if;
    if p_patch ? 'title' then v_row.title := p_patch->>'title'; end if;
    if p_patch ? 'posted_on' then
      v_row.published_at := v_posted_on::timestamp at time zone 'America/Toronto';
      -- Historical schedules are no longer publication constraints after a
      -- calendar post-date edit (publication_state_check requires equality).
      v_row.scheduled_for := null;
    elsif v_draft is true then
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
      or (v_row.content, v_row.title, v_row.is_draft, v_row.published_at, v_row.scheduled_for)
        is distinct from (v_expected.content, v_expected.title, v_expected.is_draft,
          v_expected.published_at, v_expected.scheduled_for) then
      raise exception using errcode = 'PT409', message = 'Announcement binding changed';
    end if;
    perform 1 from public.classrooms where id = p_classroom_id
      and teacher_id = p_actor_id and archived_at is null;
    if not found then raise exception using errcode = 'PT409', message = 'Classroom binding changed'; end if;
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

revoke all on function public.update_announcement_for_owner_v1(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.update_announcement_for_owner_v1(uuid,uuid,uuid,jsonb) to service_role;

commit;
