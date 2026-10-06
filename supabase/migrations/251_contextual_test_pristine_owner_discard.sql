-- Dormant current-Class-owner wrapper around the existing complete156 predicate.
-- Auth/admission and classroom-creation entitlements are separate application gates.
-- No generic Test, managed-object, provenance, mark or queue cleanup is granted.
begin;

-- Exact Test associations must not disappear behind a malformed foreign Class.
--117 has Class-leading indexes, but not this resource identity access path.
create index idx_managed_storage_test_resource_owner_discard
  on public.managed_storage_objects (resource_id) where resource_type = 'test';

create function public.discard_pristine_test_draft_for_owner_v1(
  p_actor_id uuid, p_test_id uuid, p_expected_draft_version integer,
  p_expected_test_updated_at timestamptz, p_deadline timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $function$
declare
  v_phase_deadline timestamptz := least(p_deadline, pg_catalog.clock_timestamp() + interval '8 seconds');
  v_classroom_id uuid;
  v_classroom_before public.classrooms%rowtype;
  v_classroom_expected public.classrooms%rowtype;
  v_classroom_after public.classrooms%rowtype;
  v_archive_before public.classroom_archive_revisions%rowtype;
  v_archive_expected public.classroom_archive_revisions%rowtype;
  v_archive_after public.classroom_archive_revisions%rowtype;
  v_settings_before public.managed_storage_settings%rowtype;
  v_settings_after public.managed_storage_settings%rowtype;
  v_test_before public.tests%rowtype;
  v_test_after public.tests%rowtype;
  v_draft_before public.assessment_drafts%rowtype;
  v_draft_after public.assessment_drafts%rowtype;
  v_draft_json jsonb := 'null'::jsonb;
  v_has_dependent_work boolean;
  v_discarded boolean := false;
  v_legacy_result jsonb;
  v_result jsonb;
begin
  if p_actor_id is null or p_test_id is null or p_expected_draft_version is null
    or p_expected_draft_version < 1 or p_expected_test_updated_at is null
    or not pg_catalog.isfinite(p_expected_test_updated_at)
    or p_deadline is null or not pg_catalog.isfinite(p_deadline) then
    raise exception using errcode = 'PT400', message = 'test_discard_invalid_input';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_discard_deadline';
  end if;
  if p_deadline > pg_catalog.clock_timestamp() + interval '20 seconds' then
    raise exception using errcode = 'PT400', message = 'test_discard_invalid_deadline';
  end if;

  -- Discovery holds no tuple locks; later checks never follow a changed parent.
  select discovery.classroom_id into v_classroom_id from public.tests discovery where discovery.id = p_test_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'test_discard_not_found';
  end if;
  -- Settings first, without calling117's sequence-advancing protocol writer.
  select settings.* into v_settings_before from public.managed_storage_settings settings
    where settings.singleton for share nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_discard_invalid_source';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_test_id::text, 0)) then
    raise exception using errcode = 'PT409', message = 'test_discard_busy';
  end if;
  if not public.classroom_purge_try_lock(v_classroom_id) then
    raise exception using errcode = 'PT409', message = 'test_discard_busy';
  end if;
  --164 uses the same reentrant Class-operation key, not a student lock graph.
  perform private.try_lock_classroom_membership_change(v_classroom_id);
  select classroom.* into v_classroom_before from public.classrooms classroom
    where classroom.id = v_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT409', message = 'test_discard_source_changed';
  end if;
  if v_classroom_before.teacher_id is distinct from p_actor_id or v_classroom_before.archived_at is not null then
    raise exception using errcode = 'PT403', message = 'test_discard_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize', true), 'off') = 'on' then
    raise exception using errcode = 'PT403', message = 'test_discard_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  -- Latest175 removed-academic-parent fence. Do not enter provider cleanup.
  if exists(select 1 from public.student_purge_operations operation
    join private.student_provider_cleanup_bindings binding on binding.operation_id = operation.id
    where operation.classroom_id = v_classroom_id and operation.status <> 'completed') then
    raise exception using errcode = 'PT403', message = 'test_discard_fenced';
  end if;
  select revision.* into v_archive_before from public.classroom_archive_revisions revision
    where revision.classroom_id = v_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_discard_invalid_source';
  end if;
  perform 1 from public.users actor where actor.id = p_actor_id for key share nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_discard_invalid_source';
  end if;
  select test.* into v_test_before from public.tests test
    where test.id = p_test_id and test.classroom_id = v_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT409', message = 'test_discard_source_changed';
  end if;
  if v_test_before.blueprint_archived_at is not null then
    raise exception using errcode = 'PT403', message = 'test_discard_forbidden';
  end if;
  if pg_catalog.octet_length(pg_catalog.to_jsonb(v_test_before)::text) > 2097152 then
    raise exception using errcode = 'PT503', message = 'test_discard_source_limit';
  end if;
  select draft.* into v_draft_before from public.assessment_drafts draft
    where draft.assessment_type = 'test' and draft.assessment_id = p_test_id for update nowait;
  if found then
    if v_draft_before.classroom_id is distinct from v_classroom_id or v_draft_before.version < 1 then
      raise exception using errcode = 'PT503', message = 'test_discard_invalid_source';
    end if;
    v_draft_json := pg_catalog.to_jsonb(v_draft_before);
    if pg_catalog.octet_length(v_draft_json::text) > 2097152 then
      raise exception using errcode = 'PT503', message = 'test_discard_source_limit';
    end if;
  end if;
  if v_classroom_before.blueprint_source_revision > 9223372036854775805
    or v_archive_before.revision > 9223372036854775803 then
    raise exception using errcode = 'PT503', message = 'test_discard_revision_limit';
  end if;

  -- The Test update lock fences new FK children. No child is cleanup authority.
  --157 polymorphic marks and117 objects have no Test FK; Class/revision fences
  --protect current transactions, not a stale legacy no-FK writer after commit.
  v_has_dependent_work := exists(select 1 from public.test_questions where test_id = p_test_id)
    or exists(select 1 from public.test_attempts where test_id = p_test_id)
    or exists(select 1 from public.test_responses where test_id = p_test_id)
    or exists(select 1 from public.test_student_availability where test_id = p_test_id)
    or exists(select 1 from public.test_focus_events where test_id = p_test_id)
    or exists(select 1 from public.test_ai_grading_runs where test_id = p_test_id)
    or exists(select 1 from public.test_ai_grading_run_items where test_id = p_test_id)
    or exists(select 1 from public.gradebook_score_overrides
      where classroom_id = v_classroom_id and assessment_type = 'test' and assessment_id = p_test_id)
    or exists(select 1 from public.managed_storage_json_references reference
      where coalesce(reference.assignment_doc_id,reference.assignment_doc_history_id,reference.test_id,
        reference.course_blueprint_assessment_id,reference.course_blueprint_version_id,
        reference.course_blueprint_change_proposal_id) = p_test_id and reference.test_id = p_test_id)
    or exists(select 1 from public.managed_storage_objects where resource_type = 'test' and resource_id = p_test_id)
    or exists(select 1 from public.classroom_guided_draft_provenance where test_id = p_test_id);
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_discard_deadline';
  end if;
  if not v_has_dependent_work then
    -- A postgres definer would otherwise retain implicit execution after the
    -- inherited service grant is withdrawn. Respect that dependency capability;
    -- unknown/raw privilege errors are never reclassified as owner denials.
    if not pg_catalog.has_function_privilege('service_role',
      'public.discard_pristine_test_draft_atomic(uuid,uuid,integer,timestamptz)', 'EXECUTE') then
      raise exception using errcode = '42501', message = 'test_discard_capability_unavailable';
    end if;
    v_legacy_result := public.discard_pristine_test_draft_atomic(
      p_test_id, p_actor_id, p_expected_draft_version, p_expected_test_updated_at);
    if v_legacy_result->'discarded' = 'true'::jsonb then
      if v_legacy_result is distinct from '{"discarded":true}'::jsonb
        or v_draft_before.id is null or v_draft_before.version is distinct from p_expected_draft_version
        or v_test_before.updated_at is distinct from p_expected_test_updated_at then
        raise exception using errcode = 'PT503', message = 'test_discard_postcondition_failed';
      end if;
      v_discarded := true;
    elsif v_legacy_result is distinct from pg_catalog.jsonb_build_object(
      'discarded',false,'reason','draft_changed','test',pg_catalog.to_jsonb(v_test_before)) then
      raise exception using errcode = 'PT503', message = 'test_discard_postcondition_failed';
    end if;
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_discard_deadline';
  end if;

  v_classroom_expected := v_classroom_before;
  v_archive_expected := v_archive_before;
  if v_discarded then
    --156 does not check DELETE row_count. Reject suppressed/reinserted/half pairs.
    if exists(select 1 from public.tests test where test.id = p_test_id)
      or exists(select 1 from public.assessment_drafts draft where draft.id = v_draft_before.id
        or (draft.assessment_type = 'test' and draft.assessment_id = p_test_id)) then
      raise exception using errcode = 'PT503', message = 'test_discard_postcondition_failed';
    end if;
    v_classroom_expected.blueprint_source_revision := v_classroom_before.blueprint_source_revision + 2;
    v_classroom_expected.updated_at := pg_catalog.transaction_timestamp();
    v_archive_expected.revision := v_archive_before.revision + 4;
    v_archive_expected.updated_at := pg_catalog.transaction_timestamp();
  else
    select test.* into v_test_after from public.tests test where test.id = p_test_id;
    if not found or pg_catalog.to_jsonb(v_test_after) is distinct from pg_catalog.to_jsonb(v_test_before) then
      raise exception using errcode = 'PT503', message = 'test_discard_postcondition_failed';
    end if;
    select draft.* into v_draft_after from public.assessment_drafts draft
      where draft.assessment_type = 'test' and draft.assessment_id = p_test_id;
    if (v_draft_before.id is null and found)
      or (v_draft_before.id is not null and (not found
        or pg_catalog.to_jsonb(v_draft_after) is distinct from pg_catalog.to_jsonb(v_draft_before))) then
      raise exception using errcode = 'PT503', message = 'test_discard_postcondition_failed';
    end if;
  end if;
  select classroom.* into v_classroom_after from public.classrooms classroom where classroom.id = v_classroom_id;
  if not found or pg_catalog.to_jsonb(v_classroom_after) is distinct from pg_catalog.to_jsonb(v_classroom_expected) then
    raise exception using errcode = 'PT503', message = 'test_discard_postcondition_failed';
  end if;
  select revision.* into v_archive_after from public.classroom_archive_revisions revision where revision.classroom_id = v_classroom_id;
  if not found or pg_catalog.to_jsonb(v_archive_after) is distinct from pg_catalog.to_jsonb(v_archive_expected) then
    raise exception using errcode = 'PT503', message = 'test_discard_postcondition_failed';
  end if;
  select settings.* into v_settings_after from public.managed_storage_settings settings where settings.singleton;
  if not found or pg_catalog.to_jsonb(v_settings_after) is distinct from pg_catalog.to_jsonb(v_settings_before) then
    raise exception using errcode = 'PT503', message = 'test_discard_postcondition_failed';
  end if;
  perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  -- Full parent postimage also reattests actor/current owner/active Class. The
  -- exact source/catalog and complete fixture attest unrelated trigger effects.
  --117 consumes a nontransactional writer nextval; do not reset/check equality.
  v_result := pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'test_id',p_test_id,
    'classroom',pg_catalog.jsonb_build_object('id',v_classroom_id,'teacher_id',p_actor_id,'archived_at',null),
    'test',pg_catalog.to_jsonb(v_test_before),'draft',v_draft_json,'discarded',v_discarded);
  if not v_discarded then v_result := v_result || pg_catalog.jsonb_build_object('reason','draft_changed'); end if;
  if pg_catalog.octet_length(v_result::text) > 4194304 then
    raise exception using errcode = 'PT503', message = 'test_discard_result_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_discard_deadline';
  end if;
  return v_result;
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'PT409', message = 'test_discard_busy';
  when sqlstate '55000' then
    if sqlerrm in ('classroom_purge_active','attendance_decommission_active',
      'attendance_decommission_irreversible','academic_cleanup_parent_fenced') then
      raise exception using errcode = 'PT403', message = 'test_discard_fenced';
    end if;
    raise;
end;
$function$;

revoke all on function public.discard_pristine_test_draft_for_owner_v1(uuid,uuid,integer,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.discard_pristine_test_draft_for_owner_v1(uuid,uuid,integer,timestamptz,timestamptz)
  to service_role;
commit;
