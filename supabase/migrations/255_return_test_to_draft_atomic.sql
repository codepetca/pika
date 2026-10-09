-- Return an untouched, closed Test to authoring. No learner work, grade,
-- question, availability, document, or provenance row is deleted or rewritten.
begin;

create function public.return_test_to_draft_atomic(p_teacher_id uuid, p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '10s'
as $function$
declare
  v_classroom_id uuid;
  v_classroom public.classrooms%rowtype;
  v_test public.tests%rowtype;
  v_draft public.assessment_drafts%rowtype;
  v_question_count bigint;
  v_distinct_identity_count bigint;
  v_content jsonb;
begin
  if p_teacher_id is null or p_test_id is null then
    raise exception using errcode = 'PT400', message = 'test_unpublish_invalid_input';
  end if;

  -- Discover without a tuple lock, then follow the same writer order as 252:
  -- Test identity advisory, Classroom operation/membership, Classroom/archive,
  -- Test lifecycle, Draft, questions. Access writes use 244's lifecycle lock.
  select classroom_id into v_classroom_id from public.tests where id = p_test_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'test_unpublish_not_found';
  end if;
  -- Keep the managed-storage writer's settings-first order even though this
  -- operation never changes documents or their references.
  perform 1 from public.managed_storage_settings where singleton for share nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_unpublish_missing_settings';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_test_id::text, 0))
    or not public.classroom_purge_try_lock(v_classroom_id) then
    raise exception using errcode = 'PT409', message = 'test_unpublish_busy';
  end if;
  perform private.try_lock_classroom_membership_change(v_classroom_id);
  select * into v_classroom from public.classrooms
    where id = v_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT409', message = 'test_unpublish_source_changed';
  end if;
  if v_classroom.teacher_id is distinct from p_teacher_id
    or v_classroom.archived_at is not null then
    raise exception using errcode = 'PT403', message = 'test_unpublish_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize', true), 'off') = 'on' then
    raise exception using errcode = 'PT403', message = 'test_unpublish_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  if exists(select 1 from public.student_purge_operations operation
    join private.student_provider_cleanup_bindings binding on binding.operation_id = operation.id
    where operation.classroom_id = v_classroom_id and operation.status <> 'completed') then
    raise exception using errcode = 'PT403', message = 'test_unpublish_fenced';
  end if;
  perform 1 from public.classroom_archive_revisions
    where classroom_id = v_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_unpublish_missing_revision';
  end if;
  perform 1 from public.users where id = p_teacher_id and role = 'teacher'
    for key share nowait;
  if not found then
    raise exception using errcode = 'PT403', message = 'test_unpublish_forbidden';
  end if;

  -- This helper holds the Test advisory, Classroom, then Test row. The first
  -- two locks are reentrant after the owner/archive checks above.
  v_test := private.lock_test_lifecycle(p_test_id);
  if v_test.classroom_id is distinct from v_classroom_id then
    raise exception using errcode = 'PT409', message = 'test_unpublish_source_changed';
  end if;
  if v_test.blueprint_archived_at is not null then
    raise exception using errcode = 'PT403', message = 'test_unpublish_forbidden';
  end if;
  if v_test.status not in ('closed', 'draft') or v_test.questions_locked_at is not null then
    raise exception using errcode = 'PT409', message = 'test_unpublish_not_eligible';
  end if;

  select * into v_draft from public.assessment_drafts
    where assessment_type = 'test' and assessment_id = p_test_id
    for update nowait;
  if found and v_draft.classroom_id is distinct from v_classroom_id then
    raise exception using errcode = 'PT409', message = 'test_unpublish_draft_mismatch';
  end if;

  -- A wrong-Class polymorphic override still blocks this Test. Closed learner
  -- availability is historical metadata; only an open grant blocks return.
  if exists(select 1 from public.test_attempts where test_id = p_test_id)
    or exists(select 1 from public.test_responses where test_id = p_test_id)
    or exists(select 1 from public.test_focus_events where test_id = p_test_id)
    or exists(select 1 from public.test_ai_grading_runs where test_id = p_test_id)
    or exists(select 1 from public.test_ai_grading_run_items where test_id = p_test_id)
    or exists(select 1 from public.gradebook_score_overrides
      where assessment_type = 'test' and assessment_id = p_test_id)
    or exists(select 1 from public.test_student_availability
      where test_id = p_test_id and state = 'open') then
    raise exception using errcode = 'PT409', message = 'test_unpublish_has_work';
  end if;

  if v_test.status = 'draft' then
    if v_draft.id is null or v_draft.version < 1 then
      raise exception using errcode = 'PT409', message = 'test_unpublish_missing_draft';
    end if;
    return pg_catalog.jsonb_build_object('test', pg_catalog.to_jsonb(v_test), 'draft_version', v_draft.version);
  end if;

  if v_draft.id is not null and v_draft.version >= 2147483647 then
    raise exception using errcode = 'PT409', message = 'test_unpublish_version_limit';
  end if;
  select count(*), count(distinct coalesce(source_artifact_id, artifact_id, id))
    into v_question_count, v_distinct_identity_count
    from public.test_questions where test_id = p_test_id;
  if v_question_count > 10000 then
    raise exception using errcode = 'PT503', message = 'test_unpublish_question_limit';
  end if;
  if v_question_count is distinct from v_distinct_identity_count then
    raise exception using errcode = 'PT409', message = 'test_unpublish_ambiguous_identity';
  end if;
  perform 1 from public.test_questions where test_id = p_test_id
    order by id for update nowait;
  -- The published rows are authoritative: retained draft title/results/prompt
  -- can be stale after legacy PATCH or question correction. Portable IDs are
  -- copied without changing the persisted artifact/source identity columns.
  select pg_catalog.jsonb_build_object(
    'title', v_test.title,
    'show_results', v_test.show_results,
    'question_identity_version', 1,
    'questions', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', coalesce(question.source_artifact_id, question.artifact_id, question.id),
      'question_type', question.question_type,
      'question_text', question.question_text,
      'options', question.options,
      'correct_option', question.correct_option,
      'answer_key', question.answer_key,
      'sample_solution', question.sample_solution,
      'points', question.points,
      'response_max_chars', question.response_max_chars,
      'response_monospace', question.response_monospace
    ) order by question.position, question.id), '[]'::jsonb)
  ) into v_content
  from public.test_questions question where question.test_id = p_test_id;
  if pg_catalog.octet_length(v_content::text) > 2097152 then
    raise exception using errcode = 'PT503', message = 'test_unpublish_content_limit';
  end if;
  begin
    perform private.validate_test_draft_save_content_v1(v_content, true);
  exception when sqlstate 'PT400' then
    raise exception using errcode = 'PT409', message = 'test_unpublish_invalid_published_content';
  end;

  if v_draft.id is null then
    insert into public.assessment_drafts
      (assessment_type, assessment_id, classroom_id, content, version, created_by, updated_by)
    values ('test', p_test_id, v_classroom_id, v_content, 1, p_teacher_id, p_teacher_id)
    returning * into v_draft;
  else
    update public.assessment_drafts
      set content = v_content, version = v_draft.version + 1, updated_by = p_teacher_id
      where id = v_draft.id returning * into v_draft;
  end if;
  update public.tests set status = 'draft' where id = p_test_id returning * into v_test;
  if not found or v_test.status is distinct from 'draft'
    or v_test.questions_locked_at is not null then
    raise exception using errcode = 'PT409', message = 'test_unpublish_source_changed';
  end if;
  return pg_catalog.jsonb_build_object('test', pg_catalog.to_jsonb(v_test), 'draft_version', v_draft.version);
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'PT409', message = 'test_unpublish_busy';
end;
$function$;

revoke all on function public.return_test_to_draft_atomic(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.return_test_to_draft_atomic(uuid,uuid)
  to service_role;

-- The live focus writer shares the Test lifecycle lock with access changes and
-- return-to-draft. Historical direct INSERT/restore behavior is unchanged.
create function public.record_test_focus_event_atomic(
  p_test_id uuid, p_student_id uuid, p_session_id text,
  p_event_type text, p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '10s'
as $function$
declare
  v_test public.tests%rowtype;
  v_state text;
  v_event_id uuid;
begin
  if p_test_id is null or p_student_id is null
    or p_session_id is null or pg_catalog.length(p_session_id) < 1
    or pg_catalog.length(p_session_id) > 120
    or p_event_type is null
    or p_event_type not in ('away_start','away_end','route_exit_attempt','window_unmaximize_attempt')
    or (p_metadata is not null and pg_catalog.jsonb_typeof(p_metadata) <> 'object')
    or (p_metadata is not null and pg_catalog.octet_length(p_metadata::text) > 32768) then
    raise exception using errcode = 'PT400', message = 'test_focus_event_invalid_input';
  end if;

  begin
    v_test := private.lock_test_lifecycle(p_test_id);
  exception when no_data_found then
    raise exception using errcode = 'PT409', message = 'test_focus_event_source_changed';
  end;
  if v_test.status = 'draft' then
    raise exception using errcode = 'PT409', message = 'test_focus_event_access_changed';
  end if;
  perform 1 from public.classrooms classroom
    where classroom.id = v_test.classroom_id and classroom.archived_at is null;
  if not found then
    raise exception using errcode = 'PT409', message = 'test_focus_event_access_changed';
  end if;
  perform 1 from public.users student
    where student.id = p_student_id and student.role = 'student'
    for key share nowait;
  if not found then
    raise exception using errcode = 'PT409', message = 'test_focus_event_participant_changed';
  end if;
  perform 1 from public.classroom_enrollments enrollment
    where enrollment.classroom_id = v_test.classroom_id
      and enrollment.student_id = p_student_id
    for key share nowait;
  if not found then
    raise exception using errcode = 'PT409', message = 'test_focus_event_participant_changed';
  end if;
  select state into v_state from public.test_student_availability
    where test_id = p_test_id and student_id = p_student_id;
  if coalesce(v_state, case when v_test.status = 'active' then 'open' else 'closed' end) <> 'open' then
    raise exception using errcode = 'PT409', message = 'test_focus_event_access_changed';
  end if;
  if exists(select 1 from public.test_attempts attempt
    where attempt.test_id = p_test_id and attempt.student_id = p_student_id
      and attempt.is_submitted) then
    raise exception using errcode = 'PT409', message = 'test_focus_event_attempt_changed';
  end if;

  insert into public.test_focus_events
    (test_id, student_id, session_id, event_type, metadata)
  values (p_test_id, p_student_id, p_session_id, p_event_type, p_metadata)
  returning id into v_event_id;
  return v_event_id;
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'PT409', message = 'test_focus_event_busy';
end;
$function$;

revoke all on function public.record_test_focus_event_atomic(uuid,uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_test_focus_event_atomic(uuid,uuid,text,text,jsonb)
  to service_role;

commit;
