-- Dormant, service-only mark-all read receipts. Admission remains application
-- controlled; this function authorizes the current classroom relationship.
create function public.mark_announcements_read_for_member_v1(
  p_actor_id uuid, p_classroom_id uuid, p_cutoff timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid;
  v_archived timestamptz;
  v_ids uuid[];
  v_marked bigint;
  v_inserted bigint;
  v_bindings_ok boolean;
begin
  if p_actor_id is null or p_classroom_id is null or p_cutoff is null
    or not pg_catalog.isfinite(p_cutoff) then
    raise exception using errcode = '22023', message = 'Invalid announcement read request';
  end if;
  begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'pika-classroom-operation:' || p_classroom_id::text, 0));
    -- Subject-first student purge must not form a cycle with classroom-first
    -- writes. The existing helper acquires subject/pair locks nonblockingly.
    perform private.try_lock_classroom_membership_change(p_classroom_id, p_actor_id);
    perform public.guard_classroom_purge_lifecycle(p_classroom_id);
    if exists(select 1 from public.student_purge_fences
      where classroom_id = p_classroom_id and student_id = p_actor_id) then
      raise exception using errcode = 'PT409', message = 'Announcement operation busy';
    end if;
    select teacher_id, archived_at into v_owner, v_archived
      from public.classrooms where id = p_classroom_id for update nowait;
    if not found then raise exception using errcode = 'P0002', message = 'Classroom not found'; end if;
    if v_owner = p_actor_id or v_archived is not null then
      raise exception using errcode = '42501', message = 'Forbidden';
    end if;
    perform 1 from public.classroom_enrollments
      where classroom_id = p_classroom_id and student_id = p_actor_id for share nowait;
    if not found then raise exception using errcode = '42501', message = 'Forbidden'; end if;

    -- One trusted request cutoff, captured before any lock waits. Lock the
    -- complete eligible set before writing, without PostgREST pagination caps.
    select coalesce(array_agg(eligible.id order by eligible.id), '{}'::uuid[]) into v_ids
    from (
      select announcement.id from public.announcements announcement
      where announcement.classroom_id = p_classroom_id and not announcement.is_draft
        and (announcement.scheduled_for is null or announcement.scheduled_for <= p_cutoff)
      order by announcement.id for share nowait
    ) eligible;
    v_marked := cardinality(v_ids);
    -- Attempt duplicates too: existing BEFORE INSERT archive-revision behavior
    -- is retained, while DO NOTHING preserves each original receipt/read_at.
    with inserted as (
      insert into public.announcement_reads(announcement_id, user_id)
      select candidate.id, p_actor_id from unnest(v_ids) candidate(id) order by candidate.id
      on conflict(announcement_id, user_id) do nothing
      returning announcement_id, user_id
    )
    select count(*), coalesce(bool_and(user_id = p_actor_id and announcement_id = any(v_ids)), true)
      into v_inserted, v_bindings_ok from inserted;
    if not v_bindings_ok or v_inserted > v_marked or exists(
      select 1 from unnest(v_ids) candidate(id) where not exists(
        select 1 from public.announcement_reads receipt
        where receipt.announcement_id = candidate.id and receipt.user_id = p_actor_id
      )
    ) then
      raise exception using errcode = 'PT409', message = 'Announcement receipt binding changed';
    end if;
    return pg_catalog.jsonb_build_object('actor_id', p_actor_id,
      'classroom_id', p_classroom_id, 'marked', v_marked, 'inserted', v_inserted);
  exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000' then
    raise exception using errcode = 'PT409', message = 'Announcement operation busy';
  end;
end;
$function$;

revoke all on function public.mark_announcements_read_for_member_v1(uuid,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_announcements_read_for_member_v1(uuid,uuid,timestamptz) to service_role;
