-- Dormant service-only Pal adapters. Original account/membership contracts,
-- signal gates, generations, provider operations and rollout settings stay fixed.
begin;

create function private.contextual_pal_member_context_v1(p_actor_id uuid,p_classroom_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare v_owner uuid; v_archived_at timestamptz; v_message text;
begin
  if p_actor_id is null or p_classroom_id is null then
    raise exception using errcode='22023',message='pal_invalid_context';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(current_setting('pika.identity_mapping',true),'off')='on'
    or coalesce(current_setting('pika.classroom_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.student_purge_finalize',true),'off')='on' then
    return jsonb_build_object('status','forbidden');
  end if;
  --164's EXCLUSIVE class-operation -> subject -> pair protocol, all try-locks
  --before row locks. Subject-first purge cannot deadlock this caller.
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_actor_id);
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  select teacher_id,archived_at into v_owner,v_archived_at from public.classrooms where id=p_classroom_id for update nowait;
  if not found or v_owner=p_actor_id or v_archived_at is not null then
    return jsonb_build_object('status','forbidden');
  end if;
  perform 1 from public.classroom_enrollments
    where classroom_id=p_classroom_id and student_id=p_actor_id for share nowait;
  if not found or exists(select 1 from public.student_purge_fences
    where classroom_id=p_classroom_id and student_id=p_actor_id) then
    return jsonb_build_object('status','forbidden');
  end if;
  -- Original169/183 owns immutable generation/scope, removal and signal gates.
  -- Its164 locks are reentrant in this transaction, never acquired out of order.
  return public.resolve_pal_classroom_context(p_actor_id,p_classroom_id);
exception when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' then
  get stacked diagnostics v_message=message_text;
  if sqlstate='40001' and v_message not in ('classroom_operation_busy','student_operation_busy') then raise; end if;
  raise exception using errcode='PT409',message='pal_operation_busy';
when sqlstate '55000' then
  get stacked diagnostics v_message=message_text;
  if v_message not in ('classroom_purge_active','attendance_decommission_active') then raise; end if;
  return jsonb_build_object('status','forbidden');
end;
$function$;
revoke all on function private.contextual_pal_member_context_v1(uuid,uuid) from public,anon,authenticated,service_role;

create function public.resolve_pal_classroom_context_for_member_v1(p_actor_id uuid,p_classroom_id uuid)
returns jsonb language sql security definer set search_path = ''
set lock_timeout='1s' set statement_timeout='5s' as $function$
  select private.contextual_pal_member_context_v1(p_actor_id,p_classroom_id);
$function$;

create function public.record_pal_classroom_visit_for_member_v1(p_actor_id uuid,p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout='1s' set statement_timeout='5s' as $function$
declare v_context jsonb;
begin
  v_context:=private.contextual_pal_member_context_v1(p_actor_id,p_classroom_id);
  if v_context->>'status' is distinct from 'active' then
    return jsonb_build_object('status',v_context->>'status');
  end if;
  -- Existing170 captures the original Toronto-day fact/dedup atomically.
  -- Class, enrollment and generation fences remain held until this RPC ends.
  return public.record_pal_classroom_visit(p_actor_id,p_classroom_id);
end;
$function$;

revoke all on function public.resolve_pal_classroom_context_for_member_v1(uuid,uuid),
  public.record_pal_classroom_visit_for_member_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.resolve_pal_classroom_context_for_member_v1(uuid,uuid),
  public.record_pal_classroom_visit_for_member_v1(uuid,uuid) to service_role;
alter function private.contextual_pal_member_context_v1(uuid,uuid) owner to postgres;
alter function public.resolve_pal_classroom_context_for_member_v1(uuid,uuid) owner to postgres;
alter function public.record_pal_classroom_visit_for_member_v1(uuid,uuid) owner to postgres;
commit;
