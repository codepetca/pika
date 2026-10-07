-- Dormant current-Class-owner Test publication. Application admission and the
-- dedicated HTTP route remain separate gates. This wrapper owns no question
-- materialization algorithm: it delegates exactly once to139, which delegates
-- exactly once to134, then proves the complete transaction postimage.
begin;

create function public.publish_test_from_draft_for_owner_v1(
  p_actor_id uuid, p_test_id uuid, p_classroom_id uuid,
  p_expected_authoring_sha256 text, p_expected_draft_version integer,
  p_validated_content jsonb, p_deadline timestamptz
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
  v_source jsonb;
  v_columns text[];
  v_classroom_before public.classrooms%rowtype;
  v_classroom_expected public.classrooms%rowtype;
  v_classroom_after public.classrooms%rowtype;
  v_archive_before public.classroom_archive_revisions%rowtype;
  v_archive_expected public.classroom_archive_revisions%rowtype;
  v_archive_after public.classroom_archive_revisions%rowtype;
  v_settings_before public.managed_storage_settings%rowtype;
  v_settings_after public.managed_storage_settings%rowtype;
  v_test_before public.tests%rowtype;
  v_test_expected public.tests%rowtype;
  v_test_after public.tests%rowtype;
  v_draft_before public.assessment_drafts%rowtype;
  v_draft_after public.assessment_drafts%rowtype;
  v_questions_before jsonb;
  v_provenance_before jsonb;
  v_provenance_after jsonb;
  v_managed_refs_before jsonb;
  v_managed_refs_after jsonb;
  v_managed_objects_before jsonb;
  v_managed_objects_after jsonb;
  v_document_cleanup_before jsonb;
  v_document_cleanup_after jsonb;
  v_managed_object_ids_before uuid[] := array[]::uuid[];
  v_managed_object_ids_after uuid[] := array[]::uuid[];
  v_provenance_count bigint;
  v_provenance_bytes bigint;
  v_managed_count bigint;
  v_managed_bytes bigint;
  v_question_count bigint;
  v_question_bytes bigint;
  v_state_bytes bigint;
  v_post_state_bytes bigint;
  v_question_insert_count bigint;
  v_question_update_count bigint;
  v_question_delete_count bigint;
  v_question_change_count bigint;
  v_test_source_delta bigint;
  v_draft_question jsonb;
  v_before_question jsonb;
  v_before_authored_changed boolean;
  after_question public.test_questions%rowtype;
  v_legacy_result jsonb;
  v_result jsonb;
begin
  if p_actor_id is null or p_test_id is null or p_classroom_id is null
    or p_expected_authoring_sha256 is null
    or p_expected_authoring_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_draft_version is null or p_expected_draft_version < 1
    or p_validated_content is null
    or pg_catalog.jsonb_typeof(p_validated_content) is distinct from 'object'
    or p_deadline is null or not pg_catalog.isfinite(p_deadline) then
    raise exception using errcode = 'PT400', message = 'test_publication_invalid_input';
  end if;
  if pg_catalog.octet_length(p_validated_content::text) > 2097152 then
    raise exception using errcode = 'PT400', message = 'test_publication_invalid_content';
  end if;
  if p_deadline > pg_catalog.clock_timestamp() + interval '20 seconds' then
    raise exception using errcode = 'PT400', message = 'test_publication_invalid_deadline';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_publication_deadline';
  end if;
  -- Trusted TypeScript supplies its canonical projection. This independent
  -- finite predicate rejects transport drift before privileged locks or DML.
  perform private.validate_test_draft_save_content_v1(p_validated_content, false);
  v_state_bytes := pg_catalog.octet_length(p_validated_content::text);

  -- A full-row witness must fail closed if a later migration silently changes
  -- any physical row shape. Catalog/native proof additionally seals triggers.
  select pg_catalog.array_agg(attribute.attname::text order by attribute.attname::text collate pg_catalog."C")
  into v_columns from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.tests'::pg_catalog.regclass
    and attribute.attnum > 0 and not attribute.attisdropped;
  if v_columns is distinct from array[
    'artifact_id','blueprint_archived_at','classroom_id','created_at','created_by','documents',
    'gradebook_category_id','gradebook_maximum_override','gradebook_score_scale','gradebook_weight',
    'id','include_in_final','points_possible','position','questions_locked_at','show_results',
    'source_artifact_id','source_blueprint_version_id','status','title','updated_at']::text[] then
    raise exception using errcode = 'PT503', message = 'test_publication_catalog_changed';
  end if;
  select pg_catalog.array_agg(attribute.attname::text order by attribute.attname::text collate pg_catalog."C")
  into v_columns from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.assessment_drafts'::pg_catalog.regclass
    and attribute.attnum > 0 and not attribute.attisdropped;
  if v_columns is distinct from array['assessment_id','assessment_type','classroom_id','content','created_at',
    'created_by','id','updated_at','updated_by','version']::text[] then
    raise exception using errcode = 'PT503', message = 'test_publication_catalog_changed';
  end if;
  select pg_catalog.array_agg(attribute.attname::text order by attribute.attname::text collate pg_catalog."C")
  into v_columns from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.test_questions'::pg_catalog.regclass
    and attribute.attnum > 0 and not attribute.attisdropped;
  if v_columns is distinct from array[
    'ai_reference_cache_answers','ai_reference_cache_generated_at','ai_reference_cache_key',
    'ai_reference_cache_model','answer_key','artifact_id','correct_option','created_at','id','options',
    'points','position','question_text','question_type','response_max_chars','response_monospace',
    'sample_solution','source_artifact_id','source_blueprint_version_id','test_id','updated_at']::text[] then
    raise exception using errcode = 'PT503', message = 'test_publication_catalog_changed';
  end if;

  -- Discovery takes no tuple lock. The fixed-Class argument prevents the final
  -- phase from following a Test moved after the read-only snapshot.
  select discovery.classroom_id into v_classroom_id
  from public.tests discovery where discovery.id = p_test_id;
  if not found then
    raise exception using errcode = 'PT409', message = 'test_publication_source_changed';
  end if;
  if v_classroom_id is distinct from p_classroom_id then
    raise exception using errcode = 'PT409', message = 'test_publication_source_changed';
  end if;

  -- Modern writer order: managed settings SHARE, Test identity advisory,
  -- Class operation and membership keys, full Class, archive, actor, Test,
  -- Draft, then question/provenance rows. Do not advance117's writer sequence.
  select settings.* into v_settings_before
  from public.managed_storage_settings settings
  where settings.singleton for share nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_publication_invalid_source';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_test_id::text, 0)) then
    raise exception using errcode = 'PT409', message = 'test_publication_busy';
  end if;
  if not public.classroom_purge_try_lock(v_classroom_id) then
    raise exception using errcode = 'PT409', message = 'test_publication_busy';
  end if;
  perform private.try_lock_classroom_membership_change(v_classroom_id);
  select classroom.* into v_classroom_before from public.classrooms classroom
  where classroom.id = v_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT409', message = 'test_publication_source_changed';
  end if;
  if v_classroom_before.teacher_id is distinct from p_actor_id
    or v_classroom_before.archived_at is not null then
    raise exception using errcode = 'PT403', message = 'test_publication_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize', true), 'off') = 'on' then
    raise exception using errcode = 'PT403', message = 'test_publication_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  if exists(select 1 from public.student_purge_operations operation
    join private.student_provider_cleanup_bindings binding on binding.operation_id = operation.id
    where operation.classroom_id = v_classroom_id and operation.status <> 'completed') then
    raise exception using errcode = 'PT403', message = 'test_publication_fenced';
  end if;
  select revision.* into v_archive_before from public.classroom_archive_revisions revision
  where revision.classroom_id = v_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_publication_invalid_source';
  end if;
  perform 1 from public.users actor where actor.id = p_actor_id for key share nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_publication_invalid_source';
  end if;
  select test.* into v_test_before from public.tests test
  where test.id = p_test_id and test.classroom_id = p_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT409', message = 'test_publication_source_changed';
  end if;
  if v_test_before.blueprint_archived_at is not null then
    raise exception using errcode = 'PT403', message = 'test_publication_forbidden';
  end if;
  if v_test_before.status is distinct from 'draft'
    or v_test_before.questions_locked_at is not null then
    raise exception using errcode = 'PT409', message = 'test_publication_source_changed';
  end if;
  select draft.* into v_draft_before from public.assessment_drafts draft
  where draft.assessment_type = 'test' and draft.assessment_id = p_test_id
  for update nowait;
  if not found or v_draft_before.classroom_id is distinct from p_classroom_id then
    raise exception using errcode = 'PT409', message = 'test_publication_source_changed';
  end if;
  if v_draft_before.version is distinct from p_expected_draft_version then
    raise exception using errcode = 'PT409', message = 'test_publication_source_changed';
  end if;
  if p_validated_content is distinct from v_draft_before.content then
    raise exception using errcode = 'PT409', message = 'test_publication_source_changed';
  end if;

  -- Parent locks fence compliant question writers. Explicit row locks provide
  -- complete private preimages and preserve deterministic id ordering.
  select count(*) into v_question_count from (
    select question.id from public.test_questions question
    where question.test_id = p_test_id limit 10001
  ) bounded_questions;
  if v_question_count > 10000 then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  if pg_catalog.octet_length(pg_catalog.to_jsonb(v_test_before)::text) > 2097152
    or pg_catalog.octet_length(pg_catalog.to_jsonb(v_draft_before)::text) > 2097152 then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_publication_deadline';
  end if;
  perform question.id from public.test_questions question
  where question.test_id = p_test_id order by question.id for update nowait;
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(question)::text)),0)
  into v_question_bytes from public.test_questions question where question.test_id = p_test_id;
  v_state_bytes := v_state_bytes
    + 2 * (v_question_bytes + 2 + 2 * v_question_count)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_test_before)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_draft_before)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_classroom_before)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_archive_before)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_settings_before)::text);
  if v_state_bytes > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(question) order by question.id),'[]'::jsonb)
  into v_questions_before from public.test_questions question where question.test_id = p_test_id;
  if exists(select 1 from public.test_questions question where question.test_id = p_test_id
    group by coalesce(question.source_artifact_id,question.artifact_id) having count(*) <> 1) then
    raise exception using errcode = 'PT503', message = 'test_publication_invalid_source';
  end if;

  select count(*),coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(provenance)::text)),0)
  into v_provenance_count,v_provenance_bytes
  from public.classroom_guided_draft_provenance provenance where provenance.test_id = p_test_id;
  if v_provenance_count > 1
    or v_state_bytes + 2 * (v_provenance_bytes + 4) > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_publication_deadline';
  end if;
  perform provenance.id from public.classroom_guided_draft_provenance provenance
  where provenance.test_id = p_test_id order by provenance.id for update nowait;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(provenance) order by provenance.id),'[]'::jsonb)
  into v_provenance_before from public.classroom_guided_draft_provenance provenance
  where provenance.test_id = p_test_id;
  if pg_catalog.jsonb_array_length(v_provenance_before) is distinct from v_provenance_count then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  v_state_bytes := v_state_bytes + 2 * (v_provenance_bytes + 4);

  -- Publication does not name the Test documents column, so117 must not touch
  -- its relational mirrors or cleanup queue. Capture and lock the complete
  -- scoped rows while allowing legitimate existing teacher documents.
  select count(*) into v_managed_count from (
    select reference.id from public.managed_storage_json_references reference
    where reference.test_id = p_test_id limit 10001
  ) bounded_refs;
  if v_managed_count > 10000 then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(reference)::text)),0)
  into v_managed_bytes from public.managed_storage_json_references reference
  where reference.test_id = p_test_id;
  if v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count) > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  perform reference.id from public.managed_storage_json_references reference
  where reference.test_id = p_test_id order by reference.id for update nowait;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(reference) order by reference.id),'[]'::jsonb),
    coalesce(pg_catalog.array_agg(distinct reference.managed_object_id),array[]::uuid[])
  into v_managed_refs_before,v_managed_object_ids_before
  from public.managed_storage_json_references reference where reference.test_id = p_test_id;
  v_state_bytes := v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count);

  select count(*) into v_managed_count from (
    select object.id from public.managed_storage_objects object
    where object.id = any(v_managed_object_ids_before)
      or (object.resource_type = 'test' and object.resource_id = p_test_id)
    limit 10001
  ) bounded_objects;
  if v_managed_count > 10000 then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(object)::text)),0)
  into v_managed_bytes from public.managed_storage_objects object
  where object.id = any(v_managed_object_ids_before)
    or (object.resource_type = 'test' and object.resource_id = p_test_id);
  if v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count) > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  perform object.id from public.managed_storage_objects object
  where object.id = any(v_managed_object_ids_before)
    or (object.resource_type = 'test' and object.resource_id = p_test_id)
  order by object.id for update nowait;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(object) order by object.id),'[]'::jsonb),
    coalesce(pg_catalog.array_agg(distinct object.id),array[]::uuid[])
  into v_managed_objects_before,v_managed_object_ids_before
  from public.managed_storage_objects object
  where object.id = any(v_managed_object_ids_before)
    or (object.resource_type = 'test' and object.resource_id = p_test_id);
  v_state_bytes := v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count);

  select count(*) into v_managed_count from (
    select cleanup.id from public.test_document_snapshot_storage_cleanup cleanup
    where cleanup.managed_object_id = any(v_managed_object_ids_before) limit 10001
  ) bounded_cleanup;
  if v_managed_count > 10000 then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(cleanup)::text)),0)
  into v_managed_bytes from public.test_document_snapshot_storage_cleanup cleanup
  where cleanup.managed_object_id = any(v_managed_object_ids_before);
  if v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count) > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  perform cleanup.id from public.test_document_snapshot_storage_cleanup cleanup
  where cleanup.managed_object_id = any(v_managed_object_ids_before)
  order by cleanup.id for update nowait;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(cleanup) order by cleanup.id),'[]'::jsonb)
  into v_document_cleanup_before from public.test_document_snapshot_storage_cleanup cleanup
  where cleanup.managed_object_id = any(v_managed_object_ids_before);
  v_state_bytes := v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count);
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_publication_deadline';
  end if;

  -- Recompute247's declared authoring/materializer digest only after the modern
  -- fences and complete row locks. It is deliberately not a full-row digest.
  v_source := private.test_draft_owner_source_v1(p_actor_id,p_test_id,p_classroom_id,
    p_deadline,v_phase_deadline);
  if v_source->>'source_sha256' is distinct from p_expected_authoring_sha256
    or (v_source->'draft'->>'version')::integer is distinct from p_expected_draft_version then
    raise exception using errcode = 'PT409', message = 'test_publication_source_changed';
  end if;
  v_state_bytes := v_state_bytes + pg_catalog.octet_length(v_source::text);
  if v_state_bytes > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_source_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_publication_deadline';
  end if;

  -- Draft publication cannot coexist with learner, availability, grading or AI
  -- evidence. Polymorphic overrides are global by Test identity: a wrong-Class
  -- row is still a blocker and must not disappear behind a Class predicate.
  -- The current-Class lock fences ordinary override writers through their
  -- archive trigger. A malformed wrong-Class no-FK legacy writer is not falsely
  -- claimed as a closed two-session race; runtime acceptance must retain it as
  -- an explicit residual unless that writer later adopts the Test advisory key.
  if exists(select 1 from public.test_attempts where test_id = p_test_id)
    or exists(select 1 from public.test_responses where test_id = p_test_id)
    or exists(select 1 from public.test_student_availability where test_id = p_test_id)
    or exists(select 1 from public.test_focus_events where test_id = p_test_id)
    or exists(select 1 from public.test_ai_grading_runs where test_id = p_test_id)
    or exists(select 1 from public.test_ai_grading_run_items where test_id = p_test_id)
    or exists(select 1 from public.gradebook_score_overrides where assessment_type = 'test' and assessment_id = p_test_id) then
    raise exception using errcode = 'PT409', message = 'test_publication_has_dependent_work';
  end if;

  -- Derive effects from134's exact identity and authored-field predicates.
  select
    count(*) filter(where existing.id is null),
    count(*) filter(where existing.id is not null and (
      existing.question_type is distinct from draft_question.value->>'question_type'
      or existing.question_text is distinct from pg_catalog.btrim(draft_question.value->>'question_text')
      or existing.options is distinct from coalesce(draft_question.value->'options','[]'::jsonb)
      or existing.correct_option is distinct from (draft_question.value->>'correct_option')::integer
      or existing.answer_key is distinct from nullif(pg_catalog.btrim(draft_question.value->>'answer_key'),'')
      or existing.sample_solution is distinct from nullif(pg_catalog.btrim(draft_question.value->>'sample_solution'),'')
      or existing.points is distinct from (draft_question.value->>'points')::numeric
      or existing.response_max_chars is distinct from (draft_question.value->>'response_max_chars')::integer
      or existing.response_monospace is distinct from coalesce((draft_question.value->>'response_monospace')::boolean,false)
      or existing.position is distinct from draft_question.ordinality - 1))
  into v_question_insert_count, v_question_update_count
  from pg_catalog.jsonb_array_elements(p_validated_content->'questions') with ordinality draft_question(value,ordinality)
  left join public.test_questions existing on existing.test_id = p_test_id
    and coalesce(existing.source_artifact_id,existing.artifact_id) = (draft_question.value->>'id')::uuid;
  select count(*) into v_question_delete_count from public.test_questions existing
  where existing.test_id = p_test_id and not exists(
    select 1 from pg_catalog.jsonb_array_elements(p_validated_content->'questions') draft_question(value)
    where (draft_question.value->>'id')::uuid = coalesce(existing.source_artifact_id,existing.artifact_id));
  v_question_change_count := v_question_insert_count + v_question_update_count + v_question_delete_count;
  v_test_source_delta := case when v_test_before.title is distinct from p_validated_content->>'title'
    or v_test_before.show_results is distinct from (p_validated_content->>'show_results')::boolean then 1 else 0 end;
  if v_classroom_before.blueprint_source_revision > 9223372036854775807 - v_test_source_delta - v_question_change_count
    or v_archive_before.revision > 9223372036854775807 - 2 - v_test_source_delta - 2 * v_question_change_count then
    raise exception using errcode = 'PT503', message = 'test_publication_revision_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_publication_deadline';
  end if;

  -- A postgres outer definer could otherwise bypass withdrawn nested grants.
  if not pg_catalog.has_function_privilege('service_role',
    'public.publish_test_from_draft_atomic(uuid,uuid,integer)','EXECUTE')
    or not pg_catalog.has_function_privilege('service_role',
      'public.activate_test_from_draft_atomic(uuid,uuid,integer)','EXECUTE') then
    raise exception using errcode = '42501', message = 'test_publication_capability_unavailable';
  end if;
  v_legacy_result := public.publish_test_from_draft_atomic(
    p_actor_id,p_test_id,p_expected_draft_version);
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_publication_deadline';
  end if;

  select test.* into v_test_after from public.tests test
  where test.id = p_test_id and test.classroom_id = p_classroom_id;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  v_test_expected := v_test_before;
  v_test_expected.title := p_validated_content->>'title';
  v_test_expected.show_results := (p_validated_content->>'show_results')::boolean;
  v_test_expected.status := 'closed';
  v_test_expected.updated_at := pg_catalog.transaction_timestamp();
  if pg_catalog.to_jsonb(v_test_after) is distinct from pg_catalog.to_jsonb(v_test_expected)
    or v_test_after.status is distinct from 'closed'
    or v_legacy_result->>'draft_version' is distinct from p_expected_draft_version::text
    or v_legacy_result->'test' is distinct from pg_catalog.to_jsonb(v_test_after) then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  select draft.* into v_draft_after from public.assessment_drafts draft
  where draft.assessment_type = 'test' and draft.assessment_id = p_test_id;
  if not found or pg_catalog.to_jsonb(v_draft_after) is distinct from pg_catalog.to_jsonb(v_draft_before) then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;

  if pg_catalog.octet_length(pg_catalog.to_jsonb(v_test_after)::text) > 2097152
    or pg_catalog.octet_length(pg_catalog.to_jsonb(v_draft_after)::text) > 2097152 then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  select count(*) into v_question_count from (
    select question.id from public.test_questions question
    where question.test_id = p_test_id limit 10001
  ) bounded_questions;
  if v_question_count > 10000
    or v_question_count is distinct from pg_catalog.jsonb_array_length(p_validated_content->'questions') then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(question)::text)),0)
  into v_question_bytes from public.test_questions question where question.test_id = p_test_id;
  v_post_state_bytes := v_question_bytes
    + 2 + 2 * v_question_count
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_test_after)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_draft_after)::text);
  if v_state_bytes + v_post_state_bytes > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  v_state_bytes := v_state_bytes + v_post_state_bytes;

  for after_question in select question.* from public.test_questions question
    where question.test_id = p_test_id order by question.id loop
    select value into v_draft_question
    from pg_catalog.jsonb_array_elements(p_validated_content->'questions') draft_question(value)
    where (draft_question.value->>'id')::uuid = coalesce(after_question.source_artifact_id,after_question.artifact_id);
    if not found then
      raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
    end if;
    select value into v_before_question
    from pg_catalog.jsonb_array_elements(v_questions_before) before_question(value)
    where coalesce((before_question.value->>'source_artifact_id')::uuid,
      (before_question.value->>'artifact_id')::uuid) = (v_draft_question->>'id')::uuid;
    if found then
      v_before_authored_changed :=
        v_before_question->>'question_type' is distinct from v_draft_question->>'question_type'
        or v_before_question->>'question_text' is distinct from pg_catalog.btrim(v_draft_question->>'question_text')
        or v_before_question->'options' is distinct from coalesce(v_draft_question->'options','[]'::jsonb)
        or (v_before_question->>'correct_option')::integer is distinct from (v_draft_question->>'correct_option')::integer
        or v_before_question->>'answer_key' is distinct from nullif(pg_catalog.btrim(v_draft_question->>'answer_key'),'')
        or v_before_question->>'sample_solution' is distinct from nullif(pg_catalog.btrim(v_draft_question->>'sample_solution'),'')
        or (v_before_question->>'points')::numeric is distinct from (v_draft_question->>'points')::numeric
        or (v_before_question->>'response_max_chars')::integer is distinct from (v_draft_question->>'response_max_chars')::integer
        or (v_before_question->>'response_monospace')::boolean is distinct from coalesce((v_draft_question->>'response_monospace')::boolean,false)
        or (v_before_question->>'position')::integer is distinct from
          (select ordinality - 1 from pg_catalog.jsonb_array_elements(p_validated_content->'questions')
            with ordinality item(value,ordinality) where item.value = v_draft_question);
      if after_question.id is distinct from (v_before_question->>'id')::uuid
        or (pg_catalog.to_jsonb(after_question) - array['question_type','question_text','options','correct_option',
          'answer_key','sample_solution','points','response_max_chars','response_monospace','position','updated_at']::text[])
          is distinct from (v_before_question - array['question_type','question_text','options','correct_option',
          'answer_key','sample_solution','points','response_max_chars','response_monospace','position','updated_at']::text[])
        or (v_before_authored_changed and after_question.updated_at is distinct from pg_catalog.transaction_timestamp())
        or (not v_before_authored_changed and after_question.updated_at is distinct from (v_before_question->>'updated_at')::timestamptz) then
        raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
      end if;
    else
      if after_question.id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or after_question.artifact_id is distinct from (v_draft_question->>'id')::uuid
        or after_question.source_artifact_id is not null
        or after_question.source_blueprint_version_id is not null
        or after_question.ai_reference_cache_key is not null
        or after_question.ai_reference_cache_answers is not null
        or after_question.ai_reference_cache_model is not null
        or after_question.ai_reference_cache_generated_at is not null
        or after_question.created_at is distinct from pg_catalog.transaction_timestamp()
        or after_question.updated_at is distinct from pg_catalog.transaction_timestamp() then
        raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
      end if;
    end if;
    if after_question.question_type is distinct from v_draft_question->>'question_type'
      or after_question.question_text is distinct from pg_catalog.btrim(v_draft_question->>'question_text')
      or after_question.options is distinct from coalesce(v_draft_question->'options','[]'::jsonb)
      or after_question.correct_option is distinct from (v_draft_question->>'correct_option')::integer
      or after_question.answer_key is distinct from nullif(pg_catalog.btrim(v_draft_question->>'answer_key'),'')
      or after_question.sample_solution is distinct from nullif(pg_catalog.btrim(v_draft_question->>'sample_solution'),'')
      or after_question.points is distinct from (v_draft_question->>'points')::numeric
      or after_question.response_max_chars is distinct from (v_draft_question->>'response_max_chars')::integer
      or after_question.response_monospace is distinct from coalesce((v_draft_question->>'response_monospace')::boolean,false)
      or after_question.position is distinct from
        (select ordinality - 1 from pg_catalog.jsonb_array_elements(p_validated_content->'questions')
          with ordinality item(value,ordinality) where item.value = v_draft_question) then
      raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
    end if;
  end loop;
  if exists(select 1 from public.test_questions question where question.test_id = p_test_id
    group by coalesce(question.source_artifact_id,question.artifact_id) having count(*) <> 1) then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  if exists(select 1 from public.test_attempts where test_id = p_test_id)
    or exists(select 1 from public.test_responses where test_id = p_test_id)
    or exists(select 1 from public.test_student_availability where test_id = p_test_id)
    or exists(select 1 from public.test_focus_events where test_id = p_test_id)
    or exists(select 1 from public.test_ai_grading_runs where test_id = p_test_id)
    or exists(select 1 from public.test_ai_grading_run_items where test_id = p_test_id)
    or exists(select 1 from public.gradebook_score_overrides
      where assessment_type = 'test' and assessment_id = p_test_id) then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;

  v_classroom_expected := v_classroom_before;
  v_classroom_expected.blueprint_source_revision := v_classroom_before.blueprint_source_revision
    + v_test_source_delta + v_question_change_count;
  if v_test_source_delta + v_question_change_count > 0 then
    v_classroom_expected.updated_at := pg_catalog.transaction_timestamp();
  end if;
  select classroom.* into v_classroom_after from public.classrooms classroom where classroom.id = p_classroom_id;
  if not found or pg_catalog.to_jsonb(v_classroom_after) is distinct from pg_catalog.to_jsonb(v_classroom_expected) then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  v_archive_expected := v_archive_before;
  v_archive_expected.revision := v_archive_before.revision + 2 + v_test_source_delta + 2 * v_question_change_count;
  v_archive_expected.updated_at := pg_catalog.transaction_timestamp();
  select revision.* into v_archive_after from public.classroom_archive_revisions revision
  where revision.classroom_id = p_classroom_id;
  if not found or pg_catalog.to_jsonb(v_archive_after) is distinct from pg_catalog.to_jsonb(v_archive_expected) then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  select settings.* into v_settings_after from public.managed_storage_settings settings where settings.singleton;
  if not found or pg_catalog.to_jsonb(v_settings_after) is distinct from pg_catalog.to_jsonb(v_settings_before) then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  v_post_state_bytes := pg_catalog.octet_length(pg_catalog.to_jsonb(v_classroom_after)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_archive_after)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_settings_after)::text);
  if v_state_bytes + v_post_state_bytes > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  v_state_bytes := v_state_bytes + v_post_state_bytes;

  select count(*),coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(provenance)::text)),0)
  into v_provenance_count,v_provenance_bytes
  from public.classroom_guided_draft_provenance provenance where provenance.test_id = p_test_id;
  if v_provenance_count > 1
    or v_state_bytes + 2 * (v_provenance_bytes + 4) > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(provenance) order by provenance.id),'[]'::jsonb)
  into v_provenance_after from public.classroom_guided_draft_provenance provenance
  where provenance.test_id = p_test_id;
  if v_provenance_count is distinct from pg_catalog.jsonb_array_length(v_provenance_before)
    or v_provenance_after is distinct from v_provenance_before then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  v_state_bytes := v_state_bytes + 2 * (v_provenance_bytes + 4);

  select count(*) into v_managed_count from (
    select reference.id from public.managed_storage_json_references reference
    where reference.test_id = p_test_id limit 10001
  ) bounded_refs;
  if v_managed_count > 10000 then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(reference)::text)),0)
  into v_managed_bytes from public.managed_storage_json_references reference
  where reference.test_id = p_test_id;
  if v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count) > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(reference) order by reference.id),'[]'::jsonb),
    coalesce(pg_catalog.array_agg(distinct reference.managed_object_id),array[]::uuid[])
  into v_managed_refs_after,v_managed_object_ids_after
  from public.managed_storage_json_references reference where reference.test_id = p_test_id;
  if v_managed_refs_after is distinct from v_managed_refs_before then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  v_state_bytes := v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count);

  select count(*) into v_managed_count from (
    select object.id from public.managed_storage_objects object
    where object.id = any(v_managed_object_ids_after)
      or (object.resource_type = 'test' and object.resource_id = p_test_id)
    limit 10001
  ) bounded_objects;
  if v_managed_count > 10000 then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(object)::text)),0)
  into v_managed_bytes from public.managed_storage_objects object
  where object.id = any(v_managed_object_ids_after)
    or (object.resource_type = 'test' and object.resource_id = p_test_id);
  if v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count) > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(object) order by object.id),'[]'::jsonb),
    coalesce(pg_catalog.array_agg(distinct object.id),array[]::uuid[])
  into v_managed_objects_after,v_managed_object_ids_after
  from public.managed_storage_objects object
  where object.id = any(v_managed_object_ids_after)
    or (object.resource_type = 'test' and object.resource_id = p_test_id);
  if v_managed_objects_after is distinct from v_managed_objects_before then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  v_state_bytes := v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count);

  select count(*) into v_managed_count from (
    select cleanup.id from public.test_document_snapshot_storage_cleanup cleanup
    where cleanup.managed_object_id = any(v_managed_object_ids_after) limit 10001
  ) bounded_cleanup;
  if v_managed_count > 10000 then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(cleanup)::text)),0)
  into v_managed_bytes from public.test_document_snapshot_storage_cleanup cleanup
  where cleanup.managed_object_id = any(v_managed_object_ids_after);
  if v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count) > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(cleanup) order by cleanup.id),'[]'::jsonb)
  into v_document_cleanup_after from public.test_document_snapshot_storage_cleanup cleanup
  where cleanup.managed_object_id = any(v_managed_object_ids_after);
  if v_document_cleanup_after is distinct from v_document_cleanup_before then
    raise exception using errcode = 'PT503', message = 'test_publication_postcondition_failed';
  end if;
  v_state_bytes := v_state_bytes + 2 * (v_managed_bytes + 2 + 2 * v_managed_count);
  perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_publication_deadline';
  end if;

  v_result := pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',p_classroom_id,
    'test_id',p_test_id,'source_sha256',p_expected_authoring_sha256,
    'draft_version',p_expected_draft_version,'test',pg_catalog.to_jsonb(v_test_after));
  if pg_catalog.octet_length(v_result::text) > 8388608 then
    raise exception using errcode = 'PT503', message = 'test_publication_result_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_publication_deadline';
  end if;
  return v_result;
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'PT409', message = 'test_publication_busy';
  when sqlstate '55000' then
    if sqlerrm in ('classroom_purge_active','attendance_decommission_active',
      'attendance_decommission_irreversible','academic_cleanup_parent_fenced',
      'course_blueprint_purge_in_progress','test_archived') then
      raise exception using errcode = 'PT403', message = 'test_publication_fenced';
    end if;
    raise exception using errcode = 'PT503', message = 'test_publication_failed';
end;
$function$;

revoke all on function public.publish_test_from_draft_for_owner_v1(uuid,uuid,uuid,text,integer,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.publish_test_from_draft_for_owner_v1(uuid,uuid,uuid,text,integer,jsonb,timestamptz)
  to service_role;
commit;
