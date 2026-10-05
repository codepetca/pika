-- Dormant owner Test draft GET. Application admission remains a separate gate.
-- Clock checks reject permission to commit after the deadline. Function-local
-- statement_timeout does not physically reschedule an already running RPC.
begin;

create function private.test_draft_owner_source_v1(
  p_actor_id uuid, p_test_id uuid, p_fixed_classroom_id uuid,
  p_deadline timestamptz, p_phase_deadline timestamptz
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_classroom_id uuid;
  v_classroom public.classrooms%rowtype;
  v_test public.tests%rowtype;
  v_draft public.assessment_drafts%rowtype;
  v_draft_json jsonb := 'null'::jsonb;
  v_question_count bigint;
  v_source_bytes bigint;
  v_questions jsonb;
  v_source jsonb;
  v_phase_deadline timestamptz := least(p_deadline, p_phase_deadline);
begin
  if p_actor_id is null or p_test_id is null or p_deadline is null
    or not pg_catalog.isfinite(p_deadline) or p_phase_deadline is null then
    raise exception using errcode = 'PT400', message = 'test_draft_invalid_input';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_draft_deadline';
  end if;

  -- Discovery holds no tuple locks. Final never follows a moved Test.
  select test.classroom_id into v_classroom_id from public.tests test where test.id = p_test_id;
  if not found then
    if p_fixed_classroom_id is not null then
      raise exception using errcode = 'PT409', message = 'test_draft_source_changed';
    end if;
    raise exception using errcode = 'PT404', message = 'test_draft_not_found';
  end if;
  if p_fixed_classroom_id is not null and p_fixed_classroom_id is distinct from v_classroom_id then
    raise exception using errcode = 'PT409', message = 'test_draft_source_changed';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_test_id::text, 0)) then
    raise exception using errcode = 'PT409', message = 'test_draft_busy';
  end if;
  if not public.classroom_purge_try_lock(v_classroom_id) then
    raise exception using errcode = 'PT409', message = 'test_draft_busy';
  end if;
  -- Reject genuine maintenance context; never set a bypass GUC.
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false) then
    raise exception using errcode = 'PT403', message = 'test_draft_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  select classroom.* into v_classroom from public.classrooms classroom
    where classroom.id = v_classroom_id for update nowait;
  if not found then
    if p_fixed_classroom_id is not null then
      raise exception using errcode = 'PT409', message = 'test_draft_source_changed';
    end if;
    raise exception using errcode = 'PT404', message = 'test_draft_not_found';
  end if;
  if v_classroom.teacher_id is distinct from p_actor_id or v_classroom.archived_at is not null then
    raise exception using errcode = 'PT403', message = 'test_draft_forbidden';
  end if;
  select test.* into v_test from public.tests test
    where test.id = p_test_id and test.classroom_id = v_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT409', message = 'test_draft_source_changed';
  end if;
  if v_test.status not in ('draft', 'active', 'closed') then
    raise exception using errcode = 'PT503', message = 'test_draft_invalid_source';
  end if;
  if pg_catalog.octet_length(v_test.title) > 8388608 then
    raise exception using errcode = 'PT503', message = 'test_draft_source_limit';
  end if;
  -- Exact type/id lookup deliberately does not hide a wrong-Class draft.
  select draft.* into v_draft from public.assessment_drafts draft
    where draft.assessment_type = 'test' and draft.assessment_id = p_test_id for update nowait;
  if found then
    if v_draft.classroom_id is distinct from v_classroom_id or v_draft.version < 1 then
      raise exception using errcode = 'PT503', message = 'test_draft_invalid_source';
    end if;
    if pg_catalog.octet_length(v_draft.content::text) > 2097152 then
      raise exception using errcode = 'PT503', message = 'test_draft_source_limit';
    end if;
    v_draft_json := pg_catalog.to_jsonb(v_draft);
  end if;
  -- Raw OTHER draft writers take this row before their AFTER Class trigger.
  perform 1 from public.classroom_archive_revisions revision
    where revision.classroom_id = v_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_draft_invalid_source';
  end if;

  select count(*) into v_question_count from (
    select question.id from public.test_questions question where question.test_id = p_test_id limit 10001
  ) bounded;
  if v_question_count > 10000 then
    raise exception using errcode = 'PT503', message = 'test_draft_source_limit';
  end if;
  v_source := pg_catalog.jsonb_build_object(
    'version', 1, 'actor_id', p_actor_id,
    'classroom', pg_catalog.jsonb_build_object('id', v_classroom.id, 'teacher_id', v_classroom.teacher_id, 'archived_at', v_classroom.archived_at),
    'test', pg_catalog.jsonb_build_object('id', v_test.id, 'classroom_id', v_test.classroom_id,
      'title', v_test.title, 'show_results', v_test.show_results, 'status', v_test.status,
      'blueprint_archived_at', v_test.blueprint_archived_at, 'questions_locked_at', v_test.questions_locked_at),
    'draft', v_draft_json, 'question_count', v_question_count
  );
  -- Bound full projected rows before jsonb_agg. Parent locks prevent authored
  -- changes from committing; question tuple locks would invert legacy order.
  -- Explicit operational cache fields and automatic timestamps are excluded.
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(projected)::text)), 0)
    + pg_catalog.octet_length(v_source::text) + 256 + 2 * v_question_count
  into v_source_bytes from (
    select question.id, question.test_id, question.artifact_id, question.source_artifact_id,
      question.question_type, question.question_text, question.options, question.correct_option,
      question.answer_key, question.sample_solution, question.points, question.response_max_chars,
      question.response_monospace, question.position
    from public.test_questions question where question.test_id = p_test_id
  ) projected;
  if v_source_bytes > 8388608 then
    raise exception using errcode = 'PT503', message = 'test_draft_source_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_draft_deadline';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(projected) order by projected.position, projected.id), '[]'::jsonb)
  into v_questions from (
    select question.id, question.test_id, question.artifact_id, question.source_artifact_id,
      question.question_type, question.question_text, question.options, question.correct_option,
      question.answer_key, question.sample_solution, question.points, question.response_max_chars,
      question.response_monospace, question.position
    from public.test_questions question where question.test_id = p_test_id
  ) projected;
  if pg_catalog.jsonb_array_length(v_questions) <> v_question_count then
    raise exception using errcode = 'PT409', message = 'test_draft_source_changed';
  end if;
  v_source := v_source || pg_catalog.jsonb_build_object('questions', v_questions);
  v_source := v_source || pg_catalog.jsonb_build_object('source_sha256', pg_catalog.encode(extensions.digest(v_source::text, 'sha256'), 'hex'));
  if pg_catalog.octet_length(v_source::text) > 8388608 then
    raise exception using errcode = 'PT503', message = 'test_draft_source_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_draft_deadline';
  end if;
  return v_source;
end;
$function$;
revoke all on function private.test_draft_owner_source_v1(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated, service_role;

create function public.snapshot_test_draft_for_owner_v1(
  p_actor_id uuid, p_test_id uuid, p_deadline timestamptz
)
returns jsonb language plpgsql security definer
set search_path = ''
set lock_timeout = '1s'
as $function$
declare
  v_phase_deadline timestamptz := least(p_deadline, pg_catalog.clock_timestamp() + interval '8 seconds');
  v_source jsonb;
begin
  v_source := private.test_draft_owner_source_v1(p_actor_id, p_test_id, null, p_deadline, v_phase_deadline);
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_draft_deadline';
  end if;
  return v_source;
exception
  when sqlstate '40P01' or sqlstate '55P03' or sqlstate '40001' or sqlstate '23505' then
    raise exception using errcode = 'PT409', message = 'test_draft_busy';
  when sqlstate '55000' then
    raise exception using errcode = 'PT403', message = 'test_draft_fenced';
end;
$function$;
revoke all on function public.snapshot_test_draft_for_owner_v1(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.snapshot_test_draft_for_owner_v1(uuid,uuid,timestamptz) to service_role;

create function public.finish_test_draft_get_for_owner_v1(
  p_actor_id uuid, p_test_id uuid, p_classroom_id uuid,
  p_expected_source_sha256 text, p_operation text, p_content jsonb, p_deadline timestamptz
)
returns jsonb language plpgsql security definer
set search_path = ''
set lock_timeout = '1s'
as $function$
declare
  v_phase_deadline timestamptz := least(p_deadline, pg_catalog.clock_timestamp() + interval '8 seconds');
  v_source jsonb;
  v_result jsonb;
  v_before public.assessment_drafts%rowtype;
  v_expected public.assessment_drafts%rowtype;
  v_after public.assessment_drafts%rowtype;
  v_test public.tests%rowtype;
  v_test_before jsonb;
  v_classroom_before public.classrooms%rowtype;
  v_classroom_after public.classrooms%rowtype;
  v_classroom_expected public.classrooms%rowtype;
  v_blueprint_before bigint;
  v_archive_before bigint;
  v_archive_after bigint;
  v_delta integer := 0;
  v_count bigint;
begin
  if p_classroom_id is null or p_expected_source_sha256 is null
    or p_expected_source_sha256 !~ '^[a-f0-9]{64}$'
    or p_operation is null or p_operation not in ('inspect', 'create', 'repair')
    or p_content is null or pg_catalog.jsonb_typeof(p_content) is distinct from 'object' then
    raise exception using errcode = 'PT400', message = 'test_draft_invalid_input';
  end if;
  if pg_catalog.octet_length(p_content::text) > 2097152 then
    raise exception using errcode = 'PT503', message = 'test_draft_content_limit';
  end if;
  -- Trusted JS owns canonical content validation and portable identity projection.
  -- SQL independently binds a finite candidate envelope; arbitrary keys fail.
  if pg_catalog.jsonb_typeof(p_content->'title') is distinct from 'string'
    or nullif(pg_catalog.btrim(p_content->>'title'), '') is null
    or pg_catalog.jsonb_typeof(p_content->'show_results') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_content->'questions') is distinct from 'array'
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_content) as keys(key)
      where key not in ('title','show_results','questions','question_identity_version','source_format','source_markdown')) then
    raise exception using errcode = 'PT400', message = 'test_draft_invalid_content';
  end if;
  if pg_catalog.jsonb_array_length(p_content->'questions') > 10000 then
    raise exception using errcode = 'PT503', message = 'test_draft_content_limit';
  end if;
  v_source := private.test_draft_owner_source_v1(p_actor_id, p_test_id, p_classroom_id, p_deadline, v_phase_deadline);
  if v_source->>'source_sha256' is distinct from p_expected_source_sha256 then
    raise exception using errcode = 'PT409', message = 'test_draft_source_changed';
  end if;
  select test.* into strict v_test from public.tests test where test.id = p_test_id and test.classroom_id = p_classroom_id;
  v_test_before := pg_catalog.to_jsonb(v_test);
  select classroom.* into strict v_classroom_before from public.classrooms classroom where classroom.id = p_classroom_id;
  v_classroom_expected := v_classroom_before;
  v_blueprint_before := v_classroom_before.blueprint_source_revision;
  select revision.revision into strict v_archive_before from public.classroom_archive_revisions revision where revision.classroom_id = p_classroom_id;

  if (p_operation = 'create' and v_source->'draft' <> 'null'::jsonb)
    or (p_operation in ('inspect', 'repair') and v_source->'draft' = 'null'::jsonb) then
    raise exception using errcode = 'PT409', message = 'test_draft_source_changed';
  end if;
  if p_operation = 'repair' and v_test.status <> 'draft' then
    raise exception using errcode = 'PT409', message = 'test_draft_source_changed';
  end if;
  if p_operation <> 'inspect' and v_test.blueprint_archived_at is not null then
    raise exception using errcode = 'PT403', message = 'test_draft_retired';
  end if;
  if v_source->'draft' <> 'null'::jsonb then
    v_before := pg_catalog.jsonb_populate_record(null::public.assessment_drafts, v_source->'draft');
    v_expected := v_before;
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_draft_deadline';
  end if;

  if p_operation = 'create' then
    insert into public.assessment_drafts(assessment_type,assessment_id,classroom_id,content,version,created_by,updated_by)
      values ('test',p_test_id,p_classroom_id,p_content,1,p_actor_id,p_actor_id)
      returning * into v_expected;
    get diagnostics v_count = row_count;
    if v_count <> 1 or v_expected.assessment_type is distinct from 'test'
      or v_expected.assessment_id is distinct from p_test_id or v_expected.classroom_id is distinct from p_classroom_id
      or v_expected.content is distinct from p_content or v_expected.version is distinct from 1
      or v_expected.created_by is distinct from p_actor_id or v_expected.updated_by is distinct from p_actor_id
      or v_expected.created_at is distinct from pg_catalog.transaction_timestamp()
      or v_expected.updated_at is distinct from pg_catalog.transaction_timestamp() then
      raise exception using errcode = 'PT503', message = 'test_draft_postcondition_failed';
    end if;
    v_delta := 1;
  elsif p_operation = 'repair' then
    if v_before.version = 2147483647 then
      raise exception using errcode = 'PT503', message = 'test_draft_version_limit';
    end if;
    v_expected.content := p_content;
    v_expected.version := v_before.version + 1;
    v_expected.updated_by := p_actor_id;
    v_expected.updated_at := pg_catalog.transaction_timestamp();
    update public.assessment_drafts draft set content = p_content, version = v_expected.version, updated_by = p_actor_id
      where draft.id = v_before.id and draft.assessment_type = 'test' and draft.assessment_id = p_test_id
        and draft.classroom_id = p_classroom_id and draft.version = v_before.version;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception using errcode = 'PT503', message = 'test_draft_postcondition_failed';
    end if;
    v_delta := 1;
  end if;

  -- Bound rereads after all immediate triggers, inside this same transaction.
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_draft_deadline';
  end if;
  select draft.* into v_after from public.assessment_drafts draft where draft.id = v_expected.id;
  if not found or to_jsonb(v_after) is distinct from to_jsonb(v_expected) then
    raise exception using errcode = 'PT503', message = 'test_draft_postcondition_failed';
  end if;
  select classroom.* into v_classroom_after from public.classrooms classroom where classroom.id = p_classroom_id;
  v_classroom_expected.blueprint_source_revision := v_blueprint_before + v_delta;
  if v_delta = 1 then v_classroom_expected.updated_at := pg_catalog.transaction_timestamp(); end if;
  if not found or pg_catalog.to_jsonb(v_classroom_after) is distinct from pg_catalog.to_jsonb(v_classroom_expected) then
    raise exception using errcode = 'PT503', message = 'test_draft_postcondition_failed';
  end if;
  select revision.revision into v_archive_after from public.classroom_archive_revisions revision where revision.classroom_id = p_classroom_id;
  if not found or v_archive_after is distinct from v_archive_before + 2 * v_delta
    or not exists (select 1 from public.tests test where test.id = p_test_id
      and test.classroom_id = p_classroom_id and pg_catalog.to_jsonb(test) = v_test_before) then
    raise exception using errcode = 'PT503', message = 'test_draft_postcondition_failed';
  end if;
  v_result := pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',p_classroom_id,
    'test_id',p_test_id,'operation',p_operation,'draft',pg_catalog.to_jsonb(v_after) || pg_catalog.jsonb_build_object('content',p_content),
    'editingPolicy',pg_catalog.jsonb_build_object('structureLocked', v_test.questions_locked_at is not null));
  if pg_catalog.octet_length(v_result::text) > 8388608 then
    raise exception using errcode = 'PT503', message = 'test_draft_content_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_draft_deadline';
  end if;
  return v_result;
exception
  when sqlstate '40P01' or sqlstate '55P03' or sqlstate '40001' or sqlstate '23505' then
    raise exception using errcode = 'PT409', message = 'test_draft_busy';
  when sqlstate '55000' then
    raise exception using errcode = 'PT403', message = 'test_draft_fenced';
end;
$function$;
revoke all on function public.finish_test_draft_get_for_owner_v1(uuid,uuid,uuid,text,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.finish_test_draft_get_for_owner_v1(uuid,uuid,uuid,text,text,jsonb,timestamptz) to service_role;

commit;
