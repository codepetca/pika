-- Atomic ordinary empty Test creation for the dormant classroom-owner boundary.
-- Application admission, identity and plan remain separate from write authority.
-- Source-only delivery: application and rollout require their own verified gates.
begin;

-- All Tests, including blueprint-retired rows. Not a uniqueness constraint.
-- Source inventory has Class/status and artifact indexes, not this order index.
create index idx_tests_classroom_position_owner_create
  on public.tests (classroom_id, position desc, id desc);

create function public.create_test_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_title text, p_deadline timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $function$
declare
  v_phase_deadline timestamptz := least(p_deadline, pg_catalog.clock_timestamp() + interval '8 seconds');
  v_classroom_before public.classrooms%rowtype;
  v_classroom_expected public.classrooms%rowtype;
  v_classroom_after public.classrooms%rowtype;
  v_archive_before public.classroom_archive_revisions%rowtype;
  v_archive_expected public.classroom_archive_revisions%rowtype;
  v_archive_after public.classroom_archive_revisions%rowtype;
  v_settings_before public.managed_storage_settings%rowtype;
  v_settings_after public.managed_storage_settings%rowtype;
  v_category_before public.gradebook_categories%rowtype;
  v_category_after public.gradebook_categories%rowtype;
  v_category_id uuid;
  v_category_weight integer := 10;
  v_test_id uuid;
  v_artifact_id uuid;
  v_draft_id uuid;
  v_last_position integer;
  v_position integer;
  v_title text;
  -- ECMAScript trim whitespace, matching the upstream title normalization and249.
  v_trim_chars text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_content jsonb;
  v_test_expected jsonb;
  v_draft_expected jsonb;
  v_test public.tests%rowtype;
  v_draft public.assessment_drafts%rowtype;
  v_count bigint;
  v_result jsonb;
begin
  -- HTTP normalization/fallback is upstream. SQL does not derive identity,
  -- consult account role/plan, accept supplied IDs, or implement retries.
  if p_actor_id is null or p_classroom_id is null or p_title is null
    or p_deadline is null or not pg_catalog.isfinite(p_deadline)
    or pg_catalog.char_length(p_title) > 500
    or pg_catalog.octet_length(p_title) > 2000 then
    raise exception using errcode = 'PT400', message = 'test_create_invalid_input';
  end if;
  v_title := pg_catalog.btrim(p_title, v_trim_chars);
  if nullif(v_title, '') is null then
    raise exception using errcode = 'PT400', message = 'test_create_invalid_title';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_create_deadline';
  end if;
  if p_deadline > pg_catalog.clock_timestamp() + interval '20 seconds' then
    raise exception using errcode = 'PT400', message = 'test_create_invalid_deadline';
  end if;

  --117's managed protocol order starts at the settings row. Acquire its share
  -- lock without advancing the sequence; the inherited empty-document trigger
  -- remains the single protocol writer. No settings or sequence mutation here.
  select settings.* into v_settings_before from public.managed_storage_settings settings
    where settings.singleton for share nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_create_invalid_source';
  end if;
  if not public.classroom_purge_try_lock(p_classroom_id) then
    raise exception using errcode = 'PT409', message = 'test_create_busy';
  end if;
  select classroom.* into v_classroom_before from public.classrooms classroom
    where classroom.id = p_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT404', message = 'test_create_classroom_not_found';
  end if;
  if v_classroom_before.teacher_id is distinct from p_actor_id
    or v_classroom_before.archived_at is not null then
    raise exception using errcode = 'PT403', message = 'test_create_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false)
    --112's source-touch routines also recognize this internal provenance GUC.
    -- Never create under that bypass context; no bypass is set by this function.
    or coalesce(pg_catalog.current_setting('pika.identity_mapping', true), 'off') = 'on' then
    raise exception using errcode = 'PT403', message = 'test_create_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  select revision.* into v_archive_before from public.classroom_archive_revisions revision
    where revision.classroom_id = p_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_create_invalid_source';
  end if;
  -- Current owner FK already binds the actor to users; no global-role condition.
  perform 1 from public.users actor where actor.id = p_actor_id for key share nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_create_invalid_source';
  end if;
  if v_classroom_before.blueprint_source_revision > 9223372036854775805
    or v_archive_before.revision > 9223372036854775803 then
    raise exception using errcode = 'PT503', message = 'test_create_revision_limit';
  end if;

  -- Current207 category ordering/weight, including the uncategorized fallback.
  -- Protect the chosen weight against an update; replacement may hold category
  -- rows first, so NOWAIT avoids waiting with Classroom/revision locks retained.
  select category.* into v_category_before from public.gradebook_categories category
    where category.classroom_id = p_classroom_id
    order by category.is_default desc, category.position, category.id
    limit 1 for share nowait;
  if found then
    v_category_id := v_category_before.id;
    v_category_weight := coalesce(v_category_before.default_assessment_weight, 10);
  end if;
  select test.position into v_last_position from public.tests test
    where test.classroom_id = p_classroom_id
    order by test.position desc, test.id desc limit 1;
  if not found then v_position := 0;
  elsif v_last_position = 2147483647 then
    raise exception using errcode = 'PT503', message = 'test_create_position_limit';
  else v_position := v_last_position + 1;
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_create_deadline';
  end if;

  -- Generated only inside SQL. Explicit IDs let postconditions detect BEFORE
  -- triggers changing identities; all business defaults are inherited unchanged.
  v_test_id := pg_catalog.gen_random_uuid();
  v_artifact_id := pg_catalog.gen_random_uuid();
  v_draft_id := pg_catalog.gen_random_uuid();
  v_content := pg_catalog.jsonb_build_object('title', v_title, 'show_results', false,
    'question_identity_version', 1, 'questions', '[]'::jsonb, 'source_format', 'markdown');
  -- These 21 keys are the full current Test contract. Unknown added columns/defaults
  -- fail closed instead of leaking or becoming unverified returned fields.
  v_test_expected := pg_catalog.jsonb_build_object(
    'id',v_test_id,'classroom_id',p_classroom_id,'title',v_title,'status','draft',
    'show_results',false,'position',v_position,'points_possible',100,'include_in_final',true,
    'created_by',p_actor_id,'created_at',pg_catalog.transaction_timestamp(),'updated_at',pg_catalog.transaction_timestamp(),
    'documents','[]'::jsonb,'artifact_id',v_artifact_id,'source_artifact_id',null,
    'blueprint_archived_at',null,'source_blueprint_version_id',null,'questions_locked_at',null,
    'gradebook_category_id',v_category_id,'gradebook_weight',v_category_weight,
    'gradebook_maximum_override',null,'gradebook_score_scale',1);
  v_draft_expected := pg_catalog.jsonb_build_object(
    'id',v_draft_id,'assessment_type','test','assessment_id',v_test_id,'classroom_id',p_classroom_id,
    'content',v_content,'version',1,'created_by',p_actor_id,'updated_by',p_actor_id,
    'created_at',pg_catalog.transaction_timestamp(),'updated_at',pg_catalog.transaction_timestamp());

  insert into public.tests(id,artifact_id,classroom_id,title,created_by,position)
    values(v_test_id,v_artifact_id,p_classroom_id,v_title,p_actor_id,v_position);
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception using errcode = 'PT503', message = 'test_create_postcondition_failed';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_create_deadline';
  end if;
  insert into public.assessment_drafts(id,assessment_type,assessment_id,classroom_id,content,version,created_by,updated_by)
    values(v_draft_id,'test',v_test_id,p_classroom_id,v_content,1,p_actor_id,p_actor_id);
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception using errcode = 'PT503', message = 'test_create_postcondition_failed';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_create_deadline';
  end if;

  -- Verify after BOTH inserts and all immediate triggers. RETURNING alone cannot
  -- prove these rows survived AFTER-trigger mutation/suppression/reparenting.
  select test.* into v_test from public.tests test where test.id = v_test_id for update nowait;
  if not found or pg_catalog.to_jsonb(v_test) is distinct from v_test_expected then
    raise exception using errcode = 'PT503', message = 'test_create_postcondition_failed';
  end if;
  select draft.* into v_draft from public.assessment_drafts draft
    where draft.assessment_type = 'test' and draft.assessment_id = v_test_id for update nowait;
  if not found or pg_catalog.to_jsonb(v_draft) is distinct from v_draft_expected then
    raise exception using errcode = 'PT503', message = 'test_create_postcondition_failed';
  end if;
  -- Unique(type,id)045 is independently catalog-attested by future proof. This
  -- bounded cardinality check also catches a malformed pair in that exact scope.
  if (select count(*) from (select draft.id from public.assessment_drafts draft
        where draft.assessment_type='test' and draft.assessment_id=v_test_id limit 2) bounded) <> 1 then
    raise exception using errcode = 'PT503', message = 'test_create_postcondition_failed';
  end if;
  v_classroom_expected := v_classroom_before;
  v_classroom_expected.blueprint_source_revision := v_classroom_before.blueprint_source_revision + 2;
  v_classroom_expected.updated_at := pg_catalog.transaction_timestamp();
  select classroom.* into v_classroom_after from public.classrooms classroom where classroom.id=p_classroom_id;
  if not found or pg_catalog.to_jsonb(v_classroom_after) is distinct from pg_catalog.to_jsonb(v_classroom_expected) then
    raise exception using errcode = 'PT503', message = 'test_create_postcondition_failed';
  end if;
  v_archive_expected := v_archive_before;
  v_archive_expected.revision := v_archive_before.revision + 4;
  v_archive_expected.updated_at := pg_catalog.transaction_timestamp();
  select revision.* into v_archive_after from public.classroom_archive_revisions revision where revision.classroom_id=p_classroom_id;
  if not found or pg_catalog.to_jsonb(v_archive_after) is distinct from pg_catalog.to_jsonb(v_archive_expected) then
    raise exception using errcode = 'PT503', message = 'test_create_postcondition_failed';
  end if;
  select settings.* into v_settings_after from public.managed_storage_settings settings where settings.singleton;
  if not found or pg_catalog.to_jsonb(v_settings_after) is distinct from pg_catalog.to_jsonb(v_settings_before) then
    raise exception using errcode = 'PT503', message = 'test_create_postcondition_failed';
  end if;
  if v_category_id is not null then
    select category.* into v_category_after from public.gradebook_categories category where category.id=v_category_id;
    if not found or pg_catalog.to_jsonb(v_category_after) is distinct from pg_catalog.to_jsonb(v_category_before) then
      raise exception using errcode = 'PT503', message = 'test_create_postcondition_failed';
    end if;
  end if;
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);

  -- Exact fresh Test resource scope only; no broad source/cleanup discovery.
  -- History cannot exist without attempts (FK), which are independently absent.
  if exists(select 1 from public.test_questions where test_id=v_test_id)
    or exists(select 1 from public.test_attempts where test_id=v_test_id)
    or exists(select 1 from public.test_responses where test_id=v_test_id)
    or exists(select 1 from public.test_student_availability where test_id=v_test_id)
    or exists(select 1 from public.test_focus_events where test_id=v_test_id)
    or exists(select 1 from public.test_ai_grading_runs where test_id=v_test_id)
    or exists(select 1 from public.test_ai_grading_run_items where test_id=v_test_id)
    or exists(select 1 from public.gradebook_score_overrides where classroom_id=p_classroom_id
      and assessment_type='test' and assessment_id=v_test_id)
    --117's host-expression index avoids a global references-table scan while
    -- the extra test_id predicate still restricts this exact resource type.
    or exists(select 1 from public.managed_storage_json_references reference
      where coalesce(reference.assignment_doc_id,reference.assignment_doc_history_id,reference.test_id,
        reference.course_blueprint_assessment_id,reference.course_blueprint_version_id,
        reference.course_blueprint_change_proposal_id)=v_test_id and reference.test_id=v_test_id)
    or exists(select 1 from public.managed_storage_objects where classroom_id=p_classroom_id and resource_id=v_test_id) then
    raise exception using errcode = 'PT503', message = 'test_create_postcondition_failed';
  end if;
  -- Empty117 sync performs one nontransactional writer-sequence nextval. No
  -- watermark equality claim: concurrent writers and rollback consume values.
  -- No snapshot paths exist, so no cleanup-path enumeration or Storage call.
  -- Unrelated rows/queues are attested by fixed-source trigger catalogs and the
  -- future complete synthetic-Class/whole-project fingerprints, NOT asserted
  -- here via an unbounded global preimage or invented queue ownership column.
  v_result := pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,
    'classroom_id',p_classroom_id,'test_id',v_test_id,'test',v_test_expected,'draft',v_draft_expected);
  if pg_catalog.octet_length(v_result::text) > 16384 then
    raise exception using errcode = 'PT503', message = 'test_create_result_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_create_deadline';
  end if;
  return v_result;
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'PT409', message = 'test_create_busy';
  when sqlstate '55000' then
    if sqlerrm in ('classroom_purge_active','attendance_decommission_active','attendance_decommission_irreversible') then
      raise exception using errcode = 'PT403', message = 'test_create_fenced';
    end if;
    raise;
end;
$function$;

revoke all on function public.create_test_for_owner_v1(uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_test_for_owner_v1(uuid,uuid,text,timestamptz)
  to service_role;

-- Distinct positions are guaranteed only between serialized contextual creates.
-- A legacy request can read MAX before our transaction and INSERT stale after
-- our commit. No uniqueness/index constraint, idempotency or legacy rewrite here.
commit;
