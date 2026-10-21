-- Atomic active-owned classroom ordering; no creation grant/capacity consumption.
begin;
create function public.reorder_classrooms_for_owner_v1(p_actor_id uuid,p_classroom_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
declare
  v_ids uuid[];
  v_current uuid[];
  v_id uuid;
  v_row public.classrooms%rowtype;
  v_revision public.classroom_archive_revisions%rowtype;
  v_expected_rows jsonb:='{}'::jsonb;
  v_expected_revisions jsonb:='{}'::jsonb;
  v_actual jsonb;
  v_count bigint;
begin
  -- Private wire/work bound, not a plan quota. SQL arrays must be one-dimensional,
  -- one-based, nonnull and duplicate-free; the exact empty set remains valid.
  if p_actor_id is null or p_classroom_ids is null or cardinality(p_classroom_ids)>4096
    or coalesce(array_ndims(p_classroom_ids),1)<>1 or coalesce(array_lower(p_classroom_ids,1),1)<>1
    or exists(select 1 from unnest(p_classroom_ids) id where id is null)
    or cardinality(p_classroom_ids)<>(select count(distinct id) from unnest(p_classroom_ids) id) then
    raise exception using errcode='PT400',message='classroom_list_reorder_invalid_request';
  end if;
  -- Indexed actor existence only, before private locks. Account labels grant no ownership.
  if not exists(select 1 from public.users u where u.id=p_actor_id) then
    raise exception using errcode='PT403',message='classroom_list_reorder_forbidden';
  end if;
  -- Match167/268: subject before every operation lock, before classroom/revision rows.
  -- This serializes set changes, but does not assert/create an enabled grant.
  perform public.lock_effective_feature_entitlement_v1(p_actor_id,'classrooms.create');
  select coalesce(array_agg(c.id order by c.id),'{}'::uuid[]) into v_ids from public.classrooms c
    where c.teacher_id=p_actor_id and c.archived_at is null;
  if cardinality(v_ids)>4096 or cardinality(v_ids)<>cardinality(p_classroom_ids)
    or not (v_ids @> p_classroom_ids and v_ids <@ p_classroom_ids) then
    raise exception using errcode='PT400',message='classroom_list_reorder_invalid_set';
  end if;
  -- Never acquire operation/row locks on caller-supplied foreign classroom IDs.
  foreach v_id in array v_ids loop
    if not public.classroom_purge_try_lock(v_id) then
      raise exception using errcode='PT409',message='classroom_list_reorder_busy';
    end if;
  end loop;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off')='on' then
    raise exception using errcode='PT503',message='classroom_list_reorder_fenced';
  end if;
  foreach v_id in array v_ids loop
    select c.* into v_row from public.classrooms c where c.id=v_id for update nowait;
    if not found or v_row.teacher_id is distinct from p_actor_id or v_row.archived_at is not null then
      raise exception using errcode='PT400',message='classroom_list_reorder_invalid_set';
    end if;
    perform public.guard_classroom_purge_lifecycle(v_id);
    if exists(select 1 from public.cold_classroom_purge_fences f where f.classroom_id=v_id) then
      raise exception using errcode='PT503',message='classroom_list_reorder_fenced';
    end if;
  end loop;
  foreach v_id in array v_ids loop
    select r.* into v_revision from public.classroom_archive_revisions r where r.classroom_id=v_id for update nowait;
    if not found or v_revision.revision is null or v_revision.revision<1 or v_revision.revision=9223372036854775807 or v_revision.updated_at is null then
      raise exception using errcode='PT503',message='classroom_list_reorder_postcondition_failed';
    end if;
  end loop;
  -- Aggregate each locked before-image once, rather than repeatedly copying an
  -- ever-growing JSON map at the genuine1001-class boundary.
  select coalesce(jsonb_object_agg(c.id::text,to_jsonb(c)||jsonb_build_object(
    'position',array_position(p_classroom_ids,c.id)-1,'updated_at',transaction_timestamp())),'{}'::jsonb)
    into v_expected_rows from public.classrooms c where c.id=any(v_ids);
  select coalesce(jsonb_object_agg(r.classroom_id::text,to_jsonb(r)||jsonb_build_object(
    'revision',r.revision+1,'updated_at',transaction_timestamp())),'{}'::jsonb)
    into v_expected_revisions from public.classroom_archive_revisions r where r.classroom_id=any(v_ids);
  -- A fresh statement after all locks rechecks additions/removals/ownership before effects.
  select coalesce(array_agg(c.id order by c.id),'{}'::uuid[]) into v_current from public.classrooms c
    where c.teacher_id=p_actor_id and c.archived_at is null;
  if v_current is distinct from v_ids then
    raise exception using errcode='PT400',message='classroom_list_reorder_invalid_set';
  end if;
  -- Update every row even for an unchanged order, retaining006/095 trigger behavior.
  update public.classrooms c set position=array_position(p_classroom_ids,c.id)-1
    where c.id=any(v_ids) and c.teacher_id=p_actor_id and c.archived_at is null;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_ids) then
    raise exception using errcode='PT503',message='classroom_list_reorder_postcondition_failed';
  end if;
  select coalesce(jsonb_object_agg(c.id::text,to_jsonb(c)),'{}'::jsonb) into v_actual
    from public.classrooms c where c.id=any(v_ids);
  if v_actual is distinct from v_expected_rows then
    raise exception using errcode='PT503',message='classroom_list_reorder_postcondition_failed';
  end if;
  select coalesce(jsonb_object_agg(r.classroom_id::text,to_jsonb(r)),'{}'::jsonb) into v_actual
    from public.classroom_archive_revisions r where r.classroom_id=any(v_ids);
  if v_actual is distinct from v_expected_revisions or v_ids is distinct from (
    select coalesce(array_agg(c.id order by c.id),'{}'::uuid[]) from public.classrooms c where c.teacher_id=p_actor_id and c.archived_at is null) then
    raise exception using errcode='PT503',message='classroom_list_reorder_postcondition_failed';
  end if;
  return jsonb_build_object('actor_id',p_actor_id,'classroom_ids',to_jsonb(p_classroom_ids),'reordered',true);
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode='PT409',message='classroom_list_reorder_busy';
  when sqlstate '55000' then
    if sqlerrm in ('classroom_purge_active','attendance_decommission_active','attendance_decommission_irreversible') then
      raise exception using errcode='PT503',message='classroom_list_reorder_fenced';
    end if;
    raise;
end;
$function$;
alter function public.reorder_classrooms_for_owner_v1(uuid,uuid[]) owner to postgres;
revoke all on function public.reorder_classrooms_for_owner_v1(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_classrooms_for_owner_v1(uuid,uuid[]) to service_role;
commit;
