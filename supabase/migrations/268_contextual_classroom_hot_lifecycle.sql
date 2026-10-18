-- Ordinary hot archive/restore only. This does not move or compact any content.
-- The server supplies the current authenticated actor; execute is service-only.
begin;

create function public.set_classroom_hot_archive_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_archived boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_before public.classrooms%rowtype;
  v_expected public.classrooms%rowtype;
  v_after public.classrooms%rowtype;
  v_archive_before public.classroom_archive_revisions%rowtype;
  v_archive_after public.classroom_archive_revisions%rowtype;
  v_count bigint;
  v_result jsonb;
begin
  if p_actor_id is null or p_classroom_id is null or p_archived is null then
    raise exception using errcode = 'PT400', message = 'classroom_hot_lifecycle_invalid_patch';
  end if;

  -- Match creation's subject-first order, before operation and classroom locks.
  -- Archive also serializes capacity release, but does not require an enabled grant.
  perform public.lock_effective_feature_entitlement_v1(p_actor_id, 'classrooms.create');
  if not public.classroom_purge_try_lock(p_classroom_id) then
    raise exception using errcode = 'PT409', message = 'classroom_hot_lifecycle_busy';
  end if;
  select classroom.* into v_before from public.classrooms classroom
    where classroom.id = p_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT404', message = 'classroom_hot_lifecycle_not_found';
  end if;
  if v_before.teacher_id is distinct from p_actor_id then
    raise exception using errcode = 'PT403', message = 'classroom_hot_lifecycle_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false) then
    raise exception using errcode = 'PT403', message = 'classroom_hot_lifecycle_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  select revision.* into v_archive_before from public.classroom_archive_revisions revision
    where revision.classroom_id = p_classroom_id for update nowait;
  if not found or v_archive_before.revision is null or v_archive_before.revision < 1
    or v_archive_before.revision = 9223372036854775807
    or v_archive_before.updated_at is null then
    raise exception using errcode = 'PT503', message = 'classroom_hot_lifecycle_postcondition_failed';
  end if;
  if p_archived and v_before.archived_at is not null then
    raise exception using errcode = 'PT400', message = 'classroom_hot_lifecycle_already_archived';
  elsif not p_archived and v_before.archived_at is null then
    raise exception using errcode = 'PT400', message = 'classroom_hot_lifecycle_not_archived';
  end if;

  v_expected := v_before;
  v_expected.updated_at := transaction_timestamp();
  if p_archived then
    v_expected.archived_at := clock_timestamp();
  else
    -- Live admission uses the locked subject and is repeated by the retained
    -- classroom entitlement trigger. Preserve its native SQLSTATE and message.
    perform public.assert_classroom_creation_allowed_v1(
      p_actor_id, p_classroom_id, clock_timestamp()
    );
    v_expected.archived_at := null;
    select coalesce(min(classroom.position), 1) - 1 into v_expected.position
      from public.classrooms classroom
      where classroom.teacher_id = p_actor_id and classroom.archived_at is null;
    -- Legacy reorder does not take the subject lock: this is not a global
    -- ordering guarantee against that writer. No other classroom is rewritten.
  end if;

  update public.classrooms classroom set
    archived_at = v_expected.archived_at,
    position = v_expected.position
  where classroom.id = p_classroom_id and classroom.teacher_id = p_actor_id
    and classroom.archived_at is not distinct from v_before.archived_at;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception using errcode = 'PT503', message = 'classroom_hot_lifecycle_postcondition_failed';
  end if;

  -- Reread after all immediate triggers, including AFTER-trigger writes.
  -- Whole-row equality preserves owner, content, provenance and Blueprint revision.
  select classroom.* into v_after from public.classrooms classroom where classroom.id = p_classroom_id;
  if not found or to_jsonb(v_after) is distinct from to_jsonb(v_expected) then
    raise exception using errcode = 'PT503', message = 'classroom_hot_lifecycle_postcondition_failed';
  end if;
  select revision.* into v_archive_after from public.classroom_archive_revisions revision
    where revision.classroom_id = p_classroom_id;
  if not found or to_jsonb(v_archive_after) is distinct from (
    to_jsonb(v_archive_before) || jsonb_build_object('revision', v_archive_before.revision + 1, 'updated_at', transaction_timestamp())
  ) then
    raise exception using errcode = 'PT503', message = 'classroom_hot_lifecycle_postcondition_failed';
  end if;

  -- Same explicit thirty-column owner contract as contextual metadata writes.
  v_result := jsonb_build_object(
    'id',v_after.id,'teacher_id',v_after.teacher_id,'title',v_after.title,'class_code',v_after.class_code,
    'term_label',v_after.term_label,'allow_enrollment',v_after.allow_enrollment,'join_policy',v_after.join_policy,
    'archived_at',v_after.archived_at,'created_at',v_after.created_at,'updated_at',v_after.updated_at,
    'start_date',v_after.start_date,'end_date',v_after.end_date,'position',v_after.position,
    'theme_color',v_after.theme_color,'lesson_plan_visibility',v_after.lesson_plan_visibility,
    'blueprint_source_revision',v_after.blueprint_source_revision,'source_blueprint_id',v_after.source_blueprint_id,
    'source_blueprint_origin',v_after.source_blueprint_origin,'source_blueprint_version_id',v_after.source_blueprint_version_id,
    'authoring_guidance_version_id',v_after.authoring_guidance_version_id,'actual_site_slug',v_after.actual_site_slug,
    'actual_site_published',v_after.actual_site_published,'actual_site_config',v_after.actual_site_config,
    'feature_visibility',v_after.feature_visibility,'course_overview_markdown',v_after.course_overview_markdown,
    'course_outline_markdown',v_after.course_outline_markdown,'manual_attendance_revision',v_after.manual_attendance_revision,
    'manual_attendance_session_starts_local',v_after.manual_attendance_session_starts_local,
    'manual_attendance_session_ends_local',v_after.manual_attendance_session_ends_local,
    'manual_attendance_source_mode',v_after.manual_attendance_source_mode
  );
  if v_result is distinct from to_jsonb(v_after) then
    raise exception using errcode = 'PT503', message = 'classroom_hot_lifecycle_postcondition_failed';
  end if;
  return v_result;
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'PT409', message = 'classroom_hot_lifecycle_busy';
  when sqlstate '55000' then
    if sqlerrm in ('classroom_purge_active','attendance_decommission_active','attendance_decommission_irreversible') then
      raise exception using errcode = 'PT403', message = 'classroom_hot_lifecycle_fenced';
    end if;
    raise;
end;
$function$;

revoke all on function public.set_classroom_hot_archive_for_owner_v1(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_classroom_hot_archive_for_owner_v1(uuid,uuid,boolean) to service_role;

commit;
