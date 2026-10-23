-- Personal Joined-home presentation only. Membership, archive state, classroom
-- ordering, source revisions, academic records and other actors are unaffected.
begin;

create table private.classroom_home_hidden_enrollments (
  enrollment_id uuid primary key references public.classroom_enrollments(id) on delete cascade
);
alter table private.classroom_home_hidden_enrollments enable row level security;
revoke all on table private.classroom_home_hidden_enrollments from public,anon,authenticated,service_role;

create function public.read_classroom_home_visibility_v1(p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
declare v_ids uuid[];
begin
  if p_actor_id is null then
    raise exception using errcode='PT400',message='classroom_home_visibility_invalid_request';
  end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='PT503',message='classroom_home_visibility_unavailable';
  end if;
  if not exists(select 1 from public.users u where u.id=p_actor_id) then
    raise exception using errcode='PT403',message='classroom_home_visibility_forbidden';
  end if;
  -- One complete statement snapshot; no pagination/truncation. Ownership always
  -- wins over a historical self-enrollment, including previously hidden rows.
  select coalesce(array_agg(e.id order by e.id),'{}'::uuid[]) into v_ids
    from private.classroom_home_hidden_enrollments h
    join public.classroom_enrollments e on e.id=h.enrollment_id
    join public.classrooms c on c.id=e.classroom_id
    where e.student_id=p_actor_id and c.teacher_id<>p_actor_id
      and c.archived_at is null;
  -- Private transport/work ceiling, never a membership or account-plan limit.
  if cardinality(v_ids)>4096 then
    raise exception using errcode='PT503',message='classroom_home_visibility_unavailable';
  end if;
  return jsonb_build_object('actor_id',p_actor_id,'hidden_enrollment_ids',to_jsonb(v_ids));
end;
$function$;
alter function public.read_classroom_home_visibility_v1(uuid) owner to postgres;
revoke all on function public.read_classroom_home_visibility_v1(uuid) from public,anon,authenticated;
grant execute on function public.read_classroom_home_visibility_v1(uuid) to service_role;

create function public.set_classroom_home_visibility_v1(
  p_actor_id uuid,p_classroom_id uuid,p_expected_enrollment_id uuid,p_hidden boolean
)
returns jsonb language plpgsql security definer
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
declare v_owner uuid; v_archived_at timestamptz; v_enrollment_id uuid;
begin
  if p_actor_id is null or p_classroom_id is null or p_expected_enrollment_id is null or p_hidden is null then
    raise exception using errcode='PT400',message='classroom_home_visibility_invalid_request';
  end if;
  -- A fresh snapshot after the membership operation lock is essential. A stale
  -- repeatable-read snapshot must never resurrect a former enrollment preference.
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='PT503',message='classroom_home_visibility_unavailable';
  end if;
  -- Indexed proof before locking any caller-supplied classroom. Account labels
  -- and plan entitlements neither grant membership nor limit personal hiding.
  if not exists(select 1 from public.classroom_enrollments e
    join public.classrooms c on c.id=e.classroom_id
    where e.classroom_id=p_classroom_id and e.student_id=p_actor_id
      and c.teacher_id<>p_actor_id and c.archived_at is null) then
    raise exception using errcode='PT403',message='classroom_home_visibility_forbidden';
  end if;
  --164/168's classroom operation -> subject -> pair protocol precedes proof
  --rows; removal/rejoin and cleanup therefore cannot cross this write boundary.
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_actor_id);
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(current_setting('pika.identity_mapping',true),'off')='on'
    or coalesce(current_setting('pika.classroom_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.student_purge_finalize',true),'off')='on' then
    raise exception using errcode='PT503',message='classroom_home_visibility_unavailable';
  end if;
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  select c.teacher_id,c.archived_at into v_owner,v_archived_at
    from public.classrooms c where c.id=p_classroom_id for share nowait;
  if not found or v_owner=p_actor_id or v_archived_at is not null then
    raise exception using errcode='PT403',message='classroom_home_visibility_forbidden';
  end if;
  select e.id into v_enrollment_id from public.classroom_enrollments e
    where e.classroom_id=p_classroom_id and e.student_id=p_actor_id for share nowait;
  if not found or exists(select 1 from public.student_purge_fences f
    where f.classroom_id=p_classroom_id and f.student_id=p_actor_id) then
    raise exception using errcode='PT403',message='classroom_home_visibility_forbidden';
  end if;
  -- A request from an old home view cannot change a later rejoin's preference.
  if v_enrollment_id is distinct from p_expected_enrollment_id then
    raise exception using errcode='PT409',message='classroom_home_visibility_membership_changed';
  end if;
  if p_hidden then
    insert into private.classroom_home_hidden_enrollments(enrollment_id)
      values(v_enrollment_id) on conflict(enrollment_id) do nothing;
  else
    delete from private.classroom_home_hidden_enrollments where enrollment_id=v_enrollment_id;
  end if;
  if exists(select 1 from private.classroom_home_hidden_enrollments where enrollment_id=v_enrollment_id)
    is distinct from p_hidden then
    raise exception using errcode='PT503',message='classroom_home_visibility_unavailable';
  end if;
  return jsonb_build_object('actor_id',p_actor_id,'classroom_id',p_classroom_id,
    'enrollment_id',v_enrollment_id,'hidden',p_hidden);
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode='PT409',message='classroom_home_visibility_busy';
  when sqlstate '55000' then
    if sqlerrm in ('classroom_purge_active','attendance_decommission_active','attendance_decommission_irreversible') then
      raise exception using errcode='PT503',message='classroom_home_visibility_unavailable';
    end if;
    raise;
end;
$function$;
alter function public.set_classroom_home_visibility_v1(uuid,uuid,uuid,boolean) owner to postgres;
revoke all on function public.set_classroom_home_visibility_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_classroom_home_visibility_v1(uuid,uuid,uuid,boolean) to service_role;
commit;
