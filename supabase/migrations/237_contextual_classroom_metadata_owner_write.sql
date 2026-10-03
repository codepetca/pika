-- PRIVATE SOURCE DRAFT. Migration number/application/types are coordinator-owned.
-- Metadata only: no ownership, lifecycle, position, plan or enrollment writes.
begin;

create function public.update_classroom_metadata_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_patch jsonb
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
  v_key text;
  v_value jsonb;
  v_count bigint;
  v_constraint text;
  v_schema text;
  v_table text;
  v_result jsonb;
begin
  if p_actor_id is null or p_classroom_id is null or p_patch is null
    or jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb then
    raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
  end if;

  -- The direct service boundary independently validates all normalized keys.
  for v_key, v_value in select key, value from jsonb_each(p_patch) loop
    if not (v_key = any(array[
      'title','class_code','term_label','allow_enrollment','join_policy','theme_color',
      'lesson_plan_visibility','feature_visibility','actual_site_slug','actual_site_published',
      'actual_site_config','course_overview_markdown','course_outline_markdown'
    ]::text[])) then
      raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
    end if;
    if v_key = any(array['title','class_code','term_label','course_overview_markdown','course_outline_markdown']) then
      if jsonb_typeof(v_value) is distinct from 'string'
        or (v_key = 'title' and length(v_value #>> '{}') < 1) then
        raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
      end if;
    elsif v_key = any(array['allow_enrollment','actual_site_published']) then
      if jsonb_typeof(v_value) is distinct from 'boolean' then
        raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
      end if;
    elsif v_key = 'join_policy' then
      if jsonb_typeof(v_value) is distinct from 'string' or not ((v_value #>> '{}') = any(array['roster','open_join'])) then
        raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
      end if;
    elsif v_key = 'theme_color' then
      if jsonb_typeof(v_value) is distinct from 'string' or not ((v_value #>> '{}') = any(array['blue','teal','green','amber','rose','violet','cyan','slate'])) then
        raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
      end if;
    elsif v_key = 'lesson_plan_visibility' then
      if jsonb_typeof(v_value) is distinct from 'string' or not ((v_value #>> '{}') = any(array['current_week','one_week_ahead','all'])) then
        raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
      end if;
    elsif v_key = 'actual_site_slug' then
      if v_value <> 'null'::jsonb and (
        jsonb_typeof(v_value) is distinct from 'string' or (v_value #>> '{}') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      ) then
        raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
      end if;
    elsif v_key = 'feature_visibility' then
      if jsonb_typeof(v_value) is distinct from 'object' then
        raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
      end if;
      if (select count(*) from jsonb_object_keys(v_value)) <> 9 or exists (
        select 1 from jsonb_each(v_value) flag where jsonb_typeof(flag.value) is distinct from 'boolean'
          or not (flag.key = any(array['attendance','classwork','tests','gradebook','student_grades','calendar','syllabus','announcements','achievements']))
      ) then
        raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
      end if;
    elsif v_key = 'actual_site_config' then
      if jsonb_typeof(v_value) is distinct from 'object' then
        raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
      end if;
      if (select count(*) from jsonb_object_keys(v_value)) <> 8 or exists (
        select 1 from jsonb_each(v_value) flag where
          not (flag.key = any(array['overview','outline','resources','assignments','tests','lesson_plans','announcements','lesson_plan_scope']))
          or (flag.key <> 'lesson_plan_scope' and jsonb_typeof(flag.value) is distinct from 'boolean')
          or (flag.key = 'lesson_plan_scope' and (jsonb_typeof(flag.value) is distinct from 'string'
            or not ((flag.value #>> '{}') = any(array['current_week','one_week_ahead','all']))))
      ) then
        raise exception using errcode = 'PT400', message = 'classroom_metadata_invalid_patch';
      end if;
    end if;
  end loop;

  -- Established operation-before-classroom-row order. Do not queue holding a conflicting row lock.
  if not public.classroom_purge_try_lock(p_classroom_id) then
    raise exception using errcode = 'PT409', message = 'classroom_metadata_busy';
  end if;
  select classroom.* into v_before from public.classrooms classroom
    where classroom.id = p_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT404', message = 'classroom_metadata_not_found';
  end if;
  if v_before.teacher_id is distinct from p_actor_id then
    raise exception using errcode = 'PT403', message = 'classroom_metadata_forbidden';
  end if;
  if v_before.archived_at is not null then
    raise exception using errcode = 'PT403', message = 'classroom_metadata_archived';
  end if;
  -- Keep the genuine purge/decommission policy; no archive-maintenance bypass.
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false) then
    raise exception using errcode = 'PT403', message = 'classroom_metadata_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  select revision.* into v_archive_before from public.classroom_archive_revisions revision
    where revision.classroom_id = p_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'classroom_metadata_postcondition_failed';
  end if;

  -- Presence-sensitive publication checks use the locked current pair, never a preflight.
  v_expected := jsonb_populate_record(v_before, p_patch);
  if v_expected.actual_site_published and v_expected.actual_site_slug is null then
    raise exception using errcode = 'PT400', message = 'classroom_metadata_public_slug_required';
  end if;
  -- Existing 004/006 timestamp and 112 structural-revision trigger semantics only.
  v_expected.updated_at := transaction_timestamp();
  if v_expected.course_overview_markdown is distinct from v_before.course_overview_markdown
    or v_expected.course_outline_markdown is distinct from v_before.course_outline_markdown then
    v_expected.blueprint_source_revision := v_before.blueprint_source_revision + 1;
  end if;

  update public.classrooms classroom set
    title = v_expected.title,
    class_code = v_expected.class_code,
    term_label = v_expected.term_label,
    allow_enrollment = v_expected.allow_enrollment,
    join_policy = v_expected.join_policy,
    theme_color = v_expected.theme_color,
    lesson_plan_visibility = v_expected.lesson_plan_visibility,
    feature_visibility = v_expected.feature_visibility,
    actual_site_slug = v_expected.actual_site_slug,
    actual_site_published = v_expected.actual_site_published,
    actual_site_config = v_expected.actual_site_config,
    course_overview_markdown = v_expected.course_overview_markdown,
    course_outline_markdown = v_expected.course_outline_markdown
  where classroom.id = p_classroom_id and classroom.teacher_id = p_actor_id and classroom.archived_at is null;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception using errcode = 'PT503', message = 'classroom_metadata_postcondition_failed';
  end if;

  -- Reread after immediate BEFORE/AFTER triggers. UPDATE RETURNING alone is insufficient.
  select classroom.* into v_after from public.classrooms classroom where classroom.id = p_classroom_id;
  if not found or to_jsonb(v_after) is distinct from to_jsonb(v_expected) then
    raise exception using errcode = 'PT503', message = 'classroom_metadata_postcondition_failed';
  end if;
  select revision.* into v_archive_after from public.classroom_archive_revisions revision where revision.classroom_id = p_classroom_id;
  if not found or to_jsonb(v_archive_after) is distinct from (
    to_jsonb(v_archive_before) || jsonb_build_object('revision', v_archive_before.revision + 1, 'updated_at', transaction_timestamp())
  ) then
    raise exception using errcode = 'PT503', message = 'classroom_metadata_postcondition_failed';
  end if;

  -- Explicit thirty-column owner contract. Full preimage equality protects every nonmetadata field.
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
    raise exception using errcode = 'PT503', message = 'classroom_metadata_postcondition_failed';
  end if;
  return v_result;
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name, v_schema = schema_name, v_table = table_name;
    if v_constraint = 'idx_classrooms_actual_site_slug_unique' and v_schema = 'public' and v_table = 'classrooms' then
      raise exception using errcode = 'PT409', message = 'classroom_metadata_slug_conflict';
    end if;
    raise;
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'PT409', message = 'classroom_metadata_busy';
  when sqlstate '55000' then
    if sqlerrm in ('classroom_purge_active','attendance_decommission_active','attendance_decommission_irreversible') then
      raise exception using errcode = 'PT403', message = 'classroom_metadata_fenced';
    end if;
    raise;
end;
$function$;

revoke all on function public.update_classroom_metadata_for_owner_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_classroom_metadata_for_owner_v1(uuid,uuid,jsonb) to service_role;

commit;
