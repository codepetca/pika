begin;

-- Optional calendar metadata, independent of publication and learner access.
-- Existing classroom archives retain full Test rows; old archives restore null.
-- Reusable Blueprint plans intentionally omit classroom calendar dates.
alter table public.tests add column test_date date;
comment on column public.tests.test_date is 'Optional classroom calendar display date; not an availability or submission deadline.';

-- Preserve exact current-schema restoration for archives created before 263.
alter function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  rename to normalize_classroom_archive_restore_row_pre_v263;
revoke all on function public.normalize_classroom_archive_restore_row_pre_v263(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
create function public.normalize_classroom_archive_restore_row(p_operation_id uuid, p_table_name text, p_row jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  p_row := public.normalize_classroom_archive_restore_row_pre_v263(p_operation_id, p_table_name, p_row);
  if p_table_name = 'tests' and not (p_row ? 'test_date') then
    p_row := p_row || pg_catalog.jsonb_build_object('test_date', null);
  end if;
  return p_row;
end;
$function$;
revoke all on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb) to service_role;

create or replace function public.create_test_for_owner_v1(
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
    'test_date',null,'show_results',false,'position',v_position,'points_possible',100,'include_in_final',true,
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


create or replace function public.reorder_tests_for_owner_v1(
  p_actor_id uuid, p_classroom_id uuid, p_test_ids uuid[], p_deadline timestamptz
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
  v_columns text[];
  v_current_ids uuid[];
  v_requested_ids uuid[];
  v_count bigint;
  v_changed_count bigint;
  v_affected_count bigint;
  v_test_bytes bigint;
  v_expected_bytes bigint;
  v_row_bytes bigint;
  v_state_bytes bigint;
  v_post_state_bytes bigint;
  v_tests_expected jsonb;
  v_tests_after jsonb;
  v_positions jsonb;
  v_result jsonb;
begin
  -- SQL also validates the typed RPC boundary. An empty PostgreSQL array has
  -- no dimensions; every nonempty array must be one-dimensional and 1-based.
  if p_actor_id is null or p_classroom_id is null or p_test_ids is null
    or pg_catalog.cardinality(p_test_ids) > 1000
    or (pg_catalog.cardinality(p_test_ids) > 0 and (
      pg_catalog.array_ndims(p_test_ids) is distinct from 1
      or pg_catalog.array_lower(p_test_ids, 1) is distinct from 1))
    or p_deadline is null or not pg_catalog.isfinite(p_deadline) then
    raise exception using errcode = 'PT400', message = 'test_reorder_invalid_input';
  end if;
  if exists(select 1 from pg_catalog.unnest(p_test_ids) requested(id) where requested.id is null)
    or (select count(distinct requested.id) from pg_catalog.unnest(p_test_ids) requested(id))
      is distinct from pg_catalog.cardinality(p_test_ids)::bigint then
    raise exception using errcode = 'PT400', message = 'test_reorder_invalid_input';
  end if;
  if p_deadline > pg_catalog.clock_timestamp() + interval '20 seconds' then
    raise exception using errcode = 'PT400', message = 'test_reorder_invalid_deadline';
  end if;
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = 'PT503', message = 'test_reorder_invalid_source';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_reorder_deadline';
  end if;

  -- Fail closed on a changed physical Test shape. Full Class/archive/settings
  -- records below independently retain every current field in their witnesses.
  select pg_catalog.array_agg(attribute.attname::text order by attribute.attname::text collate pg_catalog."C")
  into v_columns from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.tests'::pg_catalog.regclass
    and attribute.attnum > 0 and not attribute.attisdropped;
  if v_columns is distinct from array[
    'artifact_id','blueprint_archived_at','classroom_id','created_at','created_by','documents',
    'gradebook_category_id','gradebook_maximum_override','gradebook_score_scale','gradebook_weight',
    'id','include_in_final','points_possible','position','questions_locked_at','show_results',
    'source_artifact_id','source_blueprint_version_id','status','test_date','title','updated_at']::text[] then
    raise exception using errcode = 'PT503', message = 'test_reorder_catalog_changed';
  end if;

  -- Shared settings lock WITHOUT117's writer sequence; Class operation key,
  -- membership-change key, full Class, archive, actor, then all Tests by UUID.
  -- NOWAIT avoids waiting behind a legacy writer holding a child before Class.
  select settings.* into v_settings_before
  from public.managed_storage_settings settings
  where settings.singleton for share nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_reorder_invalid_source';
  end if;
  if not public.classroom_purge_try_lock(p_classroom_id) then
    raise exception using errcode = 'PT409', message = 'test_reorder_busy';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  select classroom.* into v_classroom_before from public.classrooms classroom
  where classroom.id = p_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT404', message = 'test_reorder_classroom_not_found';
  end if;
  if v_classroom_before.teacher_id is distinct from p_actor_id
    or v_classroom_before.archived_at is not null then
    raise exception using errcode = 'PT403', message = 'test_reorder_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize', true), 'off') = 'on' then
    raise exception using errcode = 'PT403', message = 'test_reorder_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  if exists(select 1 from public.student_purge_operations operation
    join private.student_provider_cleanup_bindings binding on binding.operation_id = operation.id
    where operation.classroom_id = p_classroom_id and operation.status <> 'completed') then
    raise exception using errcode = 'PT403', message = 'test_reorder_fenced';
  end if;
  select revision.* into v_archive_before from public.classroom_archive_revisions revision
  where revision.classroom_id = p_classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_reorder_invalid_source';
  end if;
  perform 1 from public.users actor where actor.id = p_actor_id for key share nowait;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_reorder_invalid_source';
  end if;

  -- The bound precedes all full Test row reads and aggregate allocation.
  select count(*) into v_count from (
    select test.id from public.tests test where test.classroom_id = p_classroom_id limit 1001
  ) bounded;
  if v_count > 1000 then
    raise exception using errcode = 'PT503', message = 'test_reorder_source_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_reorder_deadline';
  end if;
  perform test.id from public.tests test where test.classroom_id = p_classroom_id
  order by test.id for update nowait;
  select count(*),coalesce(pg_catalog.array_agg(test.id order by test.id),array[]::uuid[])
  into v_count,v_current_ids from public.tests test where test.classroom_id = p_classroom_id;
  select coalesce(pg_catalog.array_agg(requested.id order by requested.id),array[]::uuid[])
  into v_requested_ids from pg_catalog.unnest(p_test_ids) requested(id);
  if v_current_ids is distinct from v_requested_ids then
    raise exception using errcode = 'PT409', message = 'test_reorder_membership_changed';
  end if;

  -- These byte counts concern serialized full rows, not pg_column_size or
  -- compressed/TOAST storage. JSON array separators are counted conservatively.
  -- Materialize only scalar byte counts: SUM/MAX must not each rebuild and
  -- serialize the same full row. Complete JSON aggregates still follow guards.
  with measured as materialized (
    select pg_catalog.octet_length(pg_catalog.to_jsonb(test)::text) as row_bytes
    from public.tests test where test.classroom_id = p_classroom_id
  )
  select coalesce(sum(measured.row_bytes),0),coalesce(max(measured.row_bytes),0)
  into v_test_bytes,v_row_bytes from measured;
  if v_row_bytes > 2097152
    or pg_catalog.octet_length(pg_catalog.to_jsonb(v_classroom_before)::text) > 2097152
    or pg_catalog.octet_length(pg_catalog.to_jsonb(v_archive_before)::text) > 2097152
    or pg_catalog.octet_length(pg_catalog.to_jsonb(v_settings_before)::text) > 2097152 then
    raise exception using errcode = 'PT503', message = 'test_reorder_source_limit';
  end if;
  v_state_bytes := v_test_bytes + 2 + 2 * v_count
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_classroom_before)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_archive_before)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_settings_before)::text);
  if v_state_bytes > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_reorder_source_limit';
  end if;

  select count(*) into v_changed_count
  from public.tests test join (
    select requested.id,(v_count - requested.ordinality)::integer as position
    from pg_catalog.unnest(p_test_ids) with ordinality requested(id,ordinality)
  ) desired on desired.id = test.id
  where test.classroom_id = p_classroom_id and test.position is distinct from desired.position;
  if v_classroom_before.blueprint_source_revision > 9223372036854775807 - v_changed_count
    or v_archive_before.revision > 9223372036854775807 - 2 * v_changed_count then
    raise exception using errcode = 'PT503', message = 'test_reorder_revision_limit';
  end if;
  v_classroom_expected := v_classroom_before;
  v_archive_expected := v_archive_before;
  v_classroom_expected.blueprint_source_revision := v_classroom_before.blueprint_source_revision + v_changed_count;
  v_archive_expected.revision := v_archive_before.revision + 2 * v_changed_count;
  if v_changed_count > 0 then
    v_classroom_expected.updated_at := pg_catalog.transaction_timestamp();
    v_archive_expected.updated_at := pg_catalog.transaction_timestamp();
  end if;

  -- Form a full expected postimage from each locked preimage. Changed rows
  -- replace exactly position/updated_at; unchanged rows retain every byte of
  -- their logical JSON values. Bound expected rows before jsonb_agg or DML.
  with measured as materialized (
    select pg_catalog.octet_length((case when test.position is distinct from desired.position then
      pg_catalog.to_jsonb(test) || pg_catalog.jsonb_build_object(
        'position',desired.position,'updated_at',pg_catalog.transaction_timestamp())
      else pg_catalog.to_jsonb(test) end)::text) as row_bytes
    from public.tests test join (
      select requested.id,(v_count - requested.ordinality)::integer as position
      from pg_catalog.unnest(p_test_ids) with ordinality requested(id,ordinality)
    ) desired on desired.id = test.id where test.classroom_id = p_classroom_id
  )
  select coalesce(sum(measured.row_bytes),0),coalesce(max(measured.row_bytes),0)
  into v_expected_bytes,v_row_bytes from measured;
  v_post_state_bytes := v_expected_bytes + 2 + 2 * v_count
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_classroom_expected)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_archive_expected)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_settings_before)::text);
  if v_row_bytes > 2097152
    or pg_catalog.octet_length(pg_catalog.to_jsonb(v_classroom_expected)::text) > 2097152
    or pg_catalog.octet_length(pg_catalog.to_jsonb(v_archive_expected)::text) > 2097152
    or v_state_bytes + v_post_state_bytes > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_reorder_source_limit';
  end if;
  v_tests_expected := (
    select coalesce(pg_catalog.jsonb_agg(case when test.position is distinct from desired.position then
      pg_catalog.to_jsonb(test) || pg_catalog.jsonb_build_object(
        'position',desired.position,'updated_at',pg_catalog.transaction_timestamp())
      else pg_catalog.to_jsonb(test) end order by test.id),'[]'::jsonb)
    from public.tests test join (
      select requested.id,(v_count - requested.ordinality)::integer as position
      from pg_catalog.unnest(p_test_ids) with ordinality requested(id,ordinality)
    ) desired on desired.id = test.id where test.classroom_id = p_classroom_id
  );
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_reorder_deadline';
  end if;

  -- Exactly one mutation, retaining BOTH the Test identity and fixed Class.
  -- Inherited immediate triggers own timestamps and revision advancement.
  update public.tests test set position = desired.position
  from (
    select requested.id,(v_count - requested.ordinality)::integer as position
    from pg_catalog.unnest(p_test_ids) with ordinality requested(id,ordinality)
  ) desired
  where test.id = desired.id and test.classroom_id = p_classroom_id
    and test.position is distinct from desired.position;
  get diagnostics v_affected_count = row_count;
  if v_affected_count is distinct from v_changed_count then
    raise exception using errcode = 'PT503', message = 'test_reorder_postcondition_failed';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_reorder_deadline';
  end if;

  -- Reread AFTER every immediate trigger: UPDATE RETURNING cannot establish
  -- survival, complete membership, unchanged peers or the final full rows.
  select count(*),coalesce(pg_catalog.array_agg(bounded.id order by bounded.id),array[]::uuid[])
  into v_count,v_current_ids from (
    select test.id from public.tests test where test.classroom_id = p_classroom_id limit 1001
  ) bounded;
  if v_count > 1000 or v_current_ids is distinct from v_requested_ids then
    raise exception using errcode = 'PT503', message = 'test_reorder_postcondition_failed';
  end if;
  select classroom.* into v_classroom_after from public.classrooms classroom where classroom.id = p_classroom_id;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_reorder_postcondition_failed';
  end if;
  select revision.* into v_archive_after from public.classroom_archive_revisions revision
  where revision.classroom_id = p_classroom_id;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_reorder_postcondition_failed';
  end if;
  select settings.* into v_settings_after from public.managed_storage_settings settings where settings.singleton;
  if not found then
    raise exception using errcode = 'PT503', message = 'test_reorder_postcondition_failed';
  end if;
  with measured as materialized (
    select pg_catalog.octet_length(pg_catalog.to_jsonb(test)::text) as row_bytes
    from public.tests test where test.classroom_id = p_classroom_id
  )
  select coalesce(sum(measured.row_bytes),0),coalesce(max(measured.row_bytes),0)
  into v_test_bytes,v_row_bytes from measured;
  if v_row_bytes > 2097152
    or pg_catalog.octet_length(pg_catalog.to_jsonb(v_classroom_after)::text) > 2097152
    or pg_catalog.octet_length(pg_catalog.to_jsonb(v_archive_after)::text) > 2097152
    or pg_catalog.octet_length(pg_catalog.to_jsonb(v_settings_after)::text) > 2097152 then
    raise exception using errcode = 'PT503', message = 'test_reorder_postcondition_failed';
  end if;
  v_post_state_bytes := v_test_bytes + 2 + 2 * v_count
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_classroom_after)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_archive_after)::text)
    + pg_catalog.octet_length(pg_catalog.to_jsonb(v_settings_after)::text);
  if v_state_bytes + v_post_state_bytes > 67108864 then
    raise exception using errcode = 'PT503', message = 'test_reorder_postcondition_failed';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(test) order by test.id),'[]'::jsonb)
  into v_tests_after from public.tests test where test.classroom_id = p_classroom_id;
  if v_tests_after is distinct from v_tests_expected
    or pg_catalog.to_jsonb(v_classroom_after) is distinct from pg_catalog.to_jsonb(v_classroom_expected)
    or pg_catalog.to_jsonb(v_archive_after) is distinct from pg_catalog.to_jsonb(v_archive_expected)
    or pg_catalog.to_jsonb(v_settings_after) is distinct from pg_catalog.to_jsonb(v_settings_before) then
    raise exception using errcode = 'PT503', message = 'test_reorder_postcondition_failed';
  end if;
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  if exists(select 1 from public.student_purge_operations operation
    join private.student_provider_cleanup_bindings binding on binding.operation_id = operation.id
    where operation.classroom_id = p_classroom_id and operation.status <> 'completed') then
    raise exception using errcode = 'PT403', message = 'test_reorder_fenced';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_reorder_deadline';
  end if;
  select coalesce(pg_catalog.jsonb_agg((v_count - requested.ordinality)::integer order by requested.ordinality),'[]'::jsonb)
  into v_positions from pg_catalog.unnest(p_test_ids) with ordinality requested(id,ordinality);
  v_result := pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',p_classroom_id,
    'test_ids',pg_catalog.to_jsonb(p_test_ids),'positions',v_positions,'count',v_count,'changed_count',v_changed_count);
  if pg_catalog.octet_length(v_result::text) > 524288 then
    raise exception using errcode = 'PT503', message = 'test_reorder_result_limit';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_reorder_deadline';
  end if;
  return v_result;
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'PT409', message = 'test_reorder_busy';
  when sqlstate '55000' then
    if sqlerrm in ('classroom_purge_active','attendance_decommission_active',
      'attendance_decommission_irreversible','academic_cleanup_parent_fenced',
      'course_blueprint_purge_in_progress','test_archived') then
      raise exception using errcode = 'PT403', message = 'test_reorder_fenced';
    end if;
    raise exception using errcode = 'PT503', message = 'test_reorder_failed';
end;
$function$;

alter function public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamptz) owner to postgres;
revoke all on function public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamptz)
  from public, anon, authenticated;
grant execute on function public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamptz)
  to service_role;
-- Ordinary last-writer semantics for unchanged membership. Legacy creation may
-- insert a MAX(position) value read before this transaction after it commits;
-- disabled-trigger maintenance and nonconforming post-commit writers remain
-- existing residuals, not guarantees provided by this dormant boundary.


create or replace function public.test_owner_workflow_v1(
  p_actor_id uuid, p_test_id uuid, p_classroom_id uuid, p_operation text,
  p_payload jsonb, p_expected_test jsonb, p_deadline timestamptz
)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s'
-- PostgREST hoists statement_timeout before executing the RPC statement.
-- This requires statement_timeout in db-hoisted-tx-settings (the default).
-- Direct SQL callers must SET LOCAL statement_timeout BEFORE their SELECT;
-- changing it inside a running PostgreSQL function is not cancellation proof.
-- https://docs.postgrest.org/en/v14/references/transactions.html#hoisted-function-settings
set statement_timeout = '8s'
as $function$
declare
  v_unpublish_draft_version integer;
  v_classroom_id uuid;
  v_classroom public.classrooms%rowtype;
  v_test public.tests%rowtype;
  v_after public.tests%rowtype;
  v_object public.managed_storage_objects%rowtype;
  v_document jsonb;
  v_result jsonb := 'null'::jsonb;
  v_inner jsonb;
  v_ids uuid[];
  v_eligible uuid[];
  v_path text;
  v_document_id text;
  v_purpose text;
  v_object_id uuid;
  v_content_type text;
  v_attempts jsonb;
  v_expected_attempts jsonb;
  v_row jsonb;
  v_entry record;
  v_snapshot jsonb;
  v_value jsonb;
  v_selected numeric;
  v_text text;
  v_history_written integer := 0;
  v_attempt_count integer;
  v_response_count integer;
  v_focus_count integer;
  v_ai_count integer;
  v_history_count integer;
  v_deleted_student_count integer;
  v_grade jsonb;
  v_clear_row jsonb;
  v_clear_context jsonb := '[]'::jsonb;
  v_student_id uuid;
  v_source jsonb;
  v_source_invalid boolean;
  v_source_bytes bigint;
  v_phase_deadline timestamptz := least(p_deadline, pg_catalog.clock_timestamp() + interval '8 seconds');
begin
  if p_actor_id is null or p_test_id is null or p_deadline is null or not pg_catalog.isfinite(p_deadline)
    or p_operation is null or p_operation not in ('inspect','update','student-access','reserve','upload','verify','cancel','sync','document','results','manual-save','clear-open-grades','return','unsubmit-plan','unsubmit','delete-single','delete-bulk','unpublish','delete')
    or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or pg_catalog.octet_length(p_payload::text) > 2097152 then
    raise exception using errcode = 'PT400', message = 'test_owner_invalid_input';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_owner_deadline';
  end if;
  if p_deadline > pg_catalog.clock_timestamp() + interval '30 seconds' then
    raise exception using errcode = 'PT400', message = 'test_owner_invalid_deadline';
  end if;
  -- Take the same protocol row before Classroom/Test and object locks, without
  -- advancing writer_revision for reads. Delegated writers call the existing
  -- lock_managed_storage_protocol themselves. Try locks bound legacy inversions.
  perform 1 from public.managed_storage_settings where singleton for share nowait;
  if not found then raise exception using errcode = 'PT503', message = 'test_owner_invalid_source'; end if;
  select classroom_id into v_classroom_id from public.tests where id = p_test_id;
  if not found then raise exception using errcode = 'PT404', message = 'test_owner_not_found'; end if;
  if (p_classroom_id is not null and p_classroom_id is distinct from v_classroom_id)
    or (p_operation <> 'inspect' and p_classroom_id is null) then
    raise exception using errcode = 'PT409', message = 'test_owner_parent_changed';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_test_id::text, 0))
    or not public.classroom_purge_try_lock(v_classroom_id) then
    raise exception using errcode = 'PT409', message = 'test_owner_busy';
  end if;
  perform private.try_lock_classroom_membership_change(v_classroom_id);
  select * into v_classroom from public.classrooms where id = v_classroom_id for update nowait;
  if not found then raise exception using errcode = 'PT404', message = 'test_owner_not_found'; end if;
  if v_classroom.teacher_id is distinct from p_actor_id then
    raise exception using errcode = 'PT403', message = 'test_owner_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize', true), 'off') = 'on' then
    raise exception using errcode = 'PT403', message = 'test_owner_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  if exists(select 1 from public.student_purge_operations operation
    join private.student_provider_cleanup_bindings binding on binding.operation_id = operation.id
    where operation.classroom_id = v_classroom_id and operation.status <> 'completed') then
    raise exception using errcode = 'PT403', message = 'test_owner_fenced';
  end if;
  -- Match255 archive-before-actor/Test order only for the delegated unpublish core.
  if p_operation = 'unpublish' then
    perform 1 from public.classroom_archive_revisions
      where classroom_id = v_classroom_id for update nowait;
    if not found then raise exception using errcode = 'PT503', message = 'test_unpublish_missing_revision'; end if;
  end if;
  perform 1 from public.users where id = p_actor_id for key share nowait;
  if not found then raise exception using errcode = 'PT403', message = 'test_owner_forbidden'; end if;
  select * into v_test from public.tests where id = p_test_id and classroom_id = v_classroom_id for update nowait;
  if not found then raise exception using errcode = 'PT409', message = 'test_owner_parent_changed'; end if;
  if p_operation not in ('inspect','document','results') and (v_classroom.archived_at is not null or v_test.blueprint_archived_at is not null) then
    raise exception using errcode = 'PT403', message = 'test_owner_read_only';
  end if;
  if pg_catalog.octet_length(pg_catalog.to_jsonb(v_test)::text) > 2097152 then
    raise exception using errcode = 'PT503', message = 'test_owner_source_limit';
  end if;
  if p_operation in ('update','sync','manual-save','clear-open-grades','return','unsubmit-plan','unsubmit','delete-single','delete-bulk','unpublish','delete') and p_expected_test is distinct from pg_catalog.to_jsonb(v_test) then
    raise exception using errcode = 'PT409', message = 'test_owner_source_changed';
  end if;

  if p_operation = 'inspect' then
    if p_payload <> '{}'::jsonb then raise exception using errcode = 'PT400', message = 'test_owner_invalid_input'; end if;

  elsif p_operation = 'delete' then
    if p_payload <> '{}'::jsonb then raise exception using errcode = 'PT400', message = 'test_owner_invalid_input'; end if;
    -- Keep094 cascades, retained polymorphic Draft and durable cleanup triggers.
    -- This Test-row CAS does not attest every child/history/grade revision.
    v_inner := public.delete_test_atomic(p_test_id,p_actor_id);
    if pg_catalog.jsonb_typeof(v_inner) is distinct from 'object'
      or v_inner - array['deleted','responses_count'] <> '{}'::jsonb
      or v_inner->'deleted' is distinct from 'true'::jsonb
      or pg_catalog.jsonb_typeof(v_inner->'responses_count') is distinct from 'number'
      or exists(select 1 from public.tests where id = p_test_id) then
      raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
    end if;
    if (v_inner->>'responses_count')::numeric < 0
      or (v_inner->>'responses_count')::numeric > 2147483647
      or (v_inner->>'responses_count')::numeric <> pg_catalog.trunc((v_inner->>'responses_count')::numeric) then
      raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
    end if;
    v_result := v_inner;

  elsif p_operation = 'unpublish' then
    if p_payload <> '{}'::jsonb then raise exception using errcode = 'PT400', message = 'test_owner_invalid_input'; end if;
    v_inner := private.return_test_to_draft_core_v1(p_actor_id,p_test_id,false);
    select * into v_after from public.tests where id = p_test_id and classroom_id = v_classroom_id;
    if not found or pg_catalog.jsonb_typeof(v_inner) is distinct from 'object'
      or v_inner - array['test','draft_version'] <> '{}'::jsonb
      or v_inner->'test' is distinct from pg_catalog.to_jsonb(v_after)
      or pg_catalog.jsonb_typeof(v_inner->'draft_version') is distinct from 'number' then
      raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
    end if;
    select version into v_unpublish_draft_version from public.assessment_drafts
      where assessment_type = 'test' and assessment_id = p_test_id and classroom_id = v_classroom_id;
    if not found or v_unpublish_draft_version is null or v_unpublish_draft_version < 1
      or v_inner->'draft_version' is distinct from pg_catalog.to_jsonb(v_unpublish_draft_version) then
      raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
    end if;
    v_result := pg_catalog.jsonb_build_object('draft_version',v_unpublish_draft_version);

  elsif p_operation = 'results' then
    if p_payload <> '{}'::jsonb then raise exception using errcode = 'PT400', message = 'test_owner_invalid_input'; end if;
    -- All relation reads below use ONE statement snapshot. Each source is
    -- materialized with a cap+1 before any JSON array aggregation. Membership
    -- and parent mutation remain fenced by the common locks above.
    with roster as materialized (
      select student_id from public.classroom_enrollments
      where classroom_id = v_classroom_id and student_id <> p_actor_id
      order by student_id limit 1001
    ), questions as materialized (
      select id,test_id,question_type,question_text,options,correct_option,points,response_max_chars,
        response_monospace,position,created_at,updated_at
      from public.test_questions where test_id = p_test_id order by position,id limit 501
    ), responses as materialized (
      select r.id,r.revision,r.test_id,r.question_id,r.student_id,r.selected_option,r.response_text,
        r.score,r.feedback,r.graded_at,r.graded_by,r.submitted_at
      from public.test_responses r join roster on roster.student_id = r.student_id
      join questions q on q.id = r.question_id and q.test_id = r.test_id
      where r.test_id = p_test_id order by r.id limit 10001
    ), attempts as materialized (
      select a.student_id,a.is_submitted,a.submitted_at,a.returned_at,a.returned_by,
        a.closed_for_grading_at,a.closed_for_grading_by,a.updated_at,a.responses
      from public.test_attempts a join roster on roster.student_id = a.student_id
      where a.test_id = p_test_id order by a.student_id limit 1001
    ), users_source as materialized (
      select u.id,u.email from public.users u join roster on roster.student_id = u.id order by u.id limit 1001
    ), profiles as materialized (
      select p.user_id,p.first_name,p.last_name from public.student_profiles p
      join roster on roster.student_id = p.user_id order by p.user_id limit 1001
    ), focus as materialized (
      select f.id,f.student_id,f.event_type,f.session_id,f.occurred_at,f.metadata
      from public.test_focus_events f join roster on roster.student_id = f.student_id
      where f.test_id = p_test_id order by f.id limit 10001
    ), availability as materialized (
      select a.student_id,a.state from public.test_student_availability a
      join roster on roster.student_id = a.student_id where a.test_id = p_test_id order by a.student_id limit 1001
    ), active_run as materialized (
      select r.id,r.test_id,r.status,r.model,r.prompt_guideline_override,r.requested_student_ids_json,
        r.requested_count,r.eligible_student_count,r.queued_response_count,r.processed_count,r.completed_count,
        r.skipped_unanswered_count,r.skipped_already_graded_count,r.failed_count,r.started_at,r.completed_at,r.created_at
      from public.test_ai_grading_runs r where r.test_id = p_test_id and r.status in ('queued','running')
      order by r.created_at desc,r.id limit 2
    ), run_items as materialized (
      select i.test_id,i.student_id,i.status,i.next_retry_at
      from public.test_ai_grading_run_items i join active_run r on r.id = i.run_id
      order by i.queue_position,i.id limit 10001
    ), bounds as (
      -- Measure each bounded projection's expanded/escaped JSON before any
      -- array aggregation. Physical/compressed storage size is not this budget.
      select (select count(*) > 1000 from roster) or (select count(*) > 500 from questions)
        or (select count(*) > 10000 from responses) or (select count(*) > 1000 from attempts)
        or (select count(*) > 1000 from users_source) or (select count(*) > 1000 from profiles)
        or (select count(*) > 10000 from focus) or (select count(*) > 1000 from availability)
        or (select count(*) > 1 from active_run) or (select count(*) > 10000 from run_items) as invalid,
        (select coalesce(sum(octet_length(to_jsonb(r)::text)),0) from roster r)
        + (select coalesce(sum(octet_length(to_jsonb(q)::text)),0) from questions q)
        + (select coalesce(sum(octet_length(to_jsonb(r)::text)),0) from responses r)
        + (select coalesce(sum(octet_length(to_jsonb(a)::text)),0) from attempts a)
        + (select coalesce(sum(octet_length(to_jsonb(u)::text)),0) from users_source u)
        + (select coalesce(sum(octet_length(to_jsonb(p)::text)),0) from profiles p)
        + (select coalesce(sum(octet_length(to_jsonb(f)::text)),0) from focus f)
        + (select coalesce(sum(octet_length(to_jsonb(a)::text)),0) from availability a)
        + (select coalesce(sum(octet_length(to_jsonb(r)::text)),0) from active_run r)
        + (select coalesce(sum(octet_length(to_jsonb(i)::text)),0) from run_items i) as bytes
    )
    select bounds.invalid,bounds.bytes,
      case when bounds.invalid or bounds.bytes > 1048576 then null else pg_catalog.jsonb_build_object(
        'student_ids',(select coalesce(jsonb_agg(student_id order by student_id),'[]') from roster),
        'questions',(select coalesce(jsonb_agg(to_jsonb(q) order by q.position,q.id),'[]') from questions q),
        'responses',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from responses r),
        'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.student_id),'[]') from attempts a),
        'users',(select coalesce(jsonb_agg(to_jsonb(u) order by u.id),'[]') from users_source u),
        'profiles',(select coalesce(jsonb_agg(to_jsonb(p) order by p.user_id),'[]') from profiles p),
        'focus_events',(select coalesce(jsonb_agg(to_jsonb(f)-'id' order by f.id),'[]') from focus f),
        'availability',(select coalesce(jsonb_agg(to_jsonb(a) order by a.student_id),'[]') from availability a),
        'active_ai_grading_run',(select (to_jsonb(r)-'requested_student_ids_json') || jsonb_build_object(
          'pending_count',greatest(r.queued_response_count-r.processed_count,0),
          'next_retry_at',(select case when count(*) filter(where status in ('queued','processing')
            and (next_retry_at is null or next_retry_at <= statement_timestamp())) > 0 then null
            else min(next_retry_at) filter(where status in ('queued','processing') and next_retry_at > statement_timestamp()) end from run_items),
          -- Never forward stored arbitrary provider/error text. Preserve the
          -- public shape using current-roster identities and a generic message.
          'error_samples',(select coalesce(jsonb_agg(sample),'[]') from (
            select jsonb_build_object('student_id',i.student_id,'code',null,'message','AI grading failed for this response') as sample
            from run_items i where i.status = 'failed' and exists(select 1 from roster where student_id = i.student_id)
            order by i.student_id limit 3
          ) safe_errors)
        ) from active_run r),
        '_run_roster_invalid',exists(select 1 from active_run r where case when jsonb_typeof(r.requested_student_ids_json) is distinct from 'array' then true
          else exists(select 1 from jsonb_array_elements_text(r.requested_student_ids_json) selected(id)
            where not exists(select 1 from roster where student_id::text = selected.id)) end)
          or exists(select 1 from run_items i where i.test_id <> p_test_id or not exists(select 1 from roster where student_id = i.student_id))
      ) end
    into v_source_invalid,v_source_bytes,v_source from bounds;
    if v_source_invalid or v_source_bytes > 1048576 or v_source is null then
      raise exception using errcode = 'PT503', message = 'test_owner_results_source_limit';
    end if;
    if (v_source->>'_run_roster_invalid')::boolean then
      raise exception using errcode = 'PT503', message = 'test_owner_results_run_roster_changed';
    end if;
    v_result := v_source - '_run_roster_invalid';
    if pg_catalog.octet_length(v_result::text) > 2097152 then
      raise exception using errcode = 'PT503', message = 'test_owner_results_source_limit';
    end if;
  elsif p_operation in ('manual-save','clear-open-grades','return') then
    if v_test.status = 'draft' then raise exception using errcode = 'PT400', message = 'test_owner_draft'; end if;
    -- Creation and durable finalization use this same Test advisory key. The
    -- exclusion is checked after acquiring it, never from a preflight summary.
    if exists(select 1 from public.test_ai_grading_runs where test_id = p_test_id and status in ('queued','running')) then
      raise exception using errcode = 'PT409', message = 'test_owner_active_ai_run';
    end if;
    if p_operation = 'manual-save' then
      if p_payload - array['student_id','grades'] <> '{}'::jsonb or not p_payload ? 'student_id'
        or jsonb_typeof(p_payload->'grades') is distinct from 'array' then
        raise exception using errcode = 'PT400', message = 'test_owner_invalid_grades';
      end if;
      if jsonb_array_length(p_payload->'grades') not between 1 and 100 then
        raise exception using errcode = 'PT400', message = 'test_owner_invalid_grades';
      end if;
      v_student_id := (p_payload->>'student_id')::uuid;
      if (v_student_id is null and jsonb_array_length(p_payload->'grades') <> 1)
        or (v_student_id is not null and exists(select 1 from jsonb_array_elements(p_payload->'grades') grade where grade->>'question_id' is null)) then
        raise exception using errcode = 'PT400', message = 'test_owner_invalid_grade_target';
      end if;
      if exists(select 1 from jsonb_array_elements(p_payload->'grades') grade
        where jsonb_typeof(grade) <> 'object' or grade->>'response_id' is null)
        or exists(select 1 from jsonb_array_elements(p_payload->'grades') grade group by (grade->>'response_id')::uuid having count(*) > 1) then
        raise exception using errcode = 'PT400', message = 'test_owner_invalid_grades';
      end if;
      for v_grade in select value from jsonb_array_elements(p_payload->'grades') loop
        select jsonb_build_object('response_id',r.id,'question_id',q.id,'question_type',q.question_type,'selected_option',r.selected_option)
          into v_clear_row from public.test_responses r join public.test_questions q on q.id = r.question_id and q.test_id = p_test_id
          join public.classroom_enrollments e on e.student_id = r.student_id and e.classroom_id = v_classroom_id
          where r.id = (v_grade->>'response_id')::uuid and r.test_id = p_test_id and r.student_id <> p_actor_id
            and (v_student_id is null or r.student_id = v_student_id)
            and (v_grade->>'question_id' is null or q.id = (v_grade->>'question_id')::uuid)
          for update of r nowait for share of q nowait;
        if not found then raise exception using errcode = 'PT400', message = 'test_owner_invalid_grade_target'; end if;
        if (v_grade->>'clear_grade')::boolean then
          v_clear_context := v_clear_context || jsonb_build_array(v_clear_row);
        end if;
      end loop;
      v_inner := public.save_test_response_grades_with_provenance_atomic(p_test_id,v_student_id,p_actor_id,p_payload->'grades',clock_timestamp());
      if jsonb_typeof(v_inner) is distinct from 'object' or v_inner - array['saved_count','cleared_count','responses'] <> '{}'::jsonb
        or v_inner->'saved_count' is distinct from to_jsonb(jsonb_array_length(p_payload->'grades'))
        or v_inner->'cleared_count' is distinct from (select to_jsonb(count(*)) from jsonb_array_elements(p_payload->'grades') g where (g->>'clear_grade')::boolean)
        or jsonb_typeof(v_inner->'responses') is distinct from 'array' then
        raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
      end if;
      if jsonb_array_length(v_inner->'responses') <> jsonb_array_length(p_payload->'grades')
        or exists(select 1 from jsonb_array_elements(v_inner->'responses') r group by r->>'id' having count(*) > 1)
        or exists(select 1 from jsonb_array_elements(p_payload->'grades') g where not exists(
          select 1 from jsonb_array_elements(v_inner->'responses') r
          join public.test_responses saved on saved.id::text = r->>'id' and saved.test_id = p_test_id
          left join jsonb_array_elements(v_clear_context) context on context->>'response_id' = r->>'id'
          where r->>'id' = (g->>'response_id')::uuid::text
            and r = jsonb_build_object('id',saved.id,'revision',saved.revision,'score',saved.score,'feedback',saved.feedback)
            -- The inherited shape trigger normalizes answered MC null to zero.
            -- Only actual locked clear targets receive that exception.
            and saved.score is not distinct from (case when (g->>'clear_grade')::boolean
              and context->>'question_type' = 'multiple_choice' and context->>'selected_option' is not null
              then 0::numeric else (g->>'score')::numeric end)
            and saved.feedback is not distinct from (g->>'feedback')
            and saved.revision between (g->>'expected_response_revision')::bigint and (g->>'expected_response_revision')::bigint + 1
        )) then raise exception using errcode = 'PT503', message = 'test_owner_postcondition'; end if;
      v_result := v_inner || jsonb_build_object('student_id',v_student_id,'clear_context',v_clear_context);
    else
      if p_payload - (case when p_operation = 'return' then array['student_ids'] else array['student_ids','responses'] end) <> '{}'::jsonb
        or jsonb_typeof(p_payload->'student_ids') is distinct from 'array' then
        raise exception using errcode = 'PT400', message = 'test_owner_invalid_selection';
      end if;
      if jsonb_array_length(p_payload->'student_ids') not between 1 and 100 then
        raise exception using errcode = 'PT400', message = 'test_owner_invalid_selection';
      end if;
      select array_agg(distinct value::uuid order by value::uuid) into v_ids from jsonb_array_elements_text(p_payload->'student_ids');
      if array_position(v_ids,null) is not null then raise exception using errcode = 'PT400', message = 'test_owner_invalid_selection'; end if;
      select coalesce(array_agg(student_id order by student_id),array[]::uuid[]) into v_eligible from (
        select student_id from public.classroom_enrollments where classroom_id = v_classroom_id
          and student_id = any(v_ids) and student_id <> p_actor_id order by student_id for share nowait
      ) enrolled;
      if v_ids is distinct from v_eligible then raise exception using errcode = 'PT400', message = 'test_owner_invalid_selection'; end if;
      if p_operation = 'clear-open-grades' then
        v_inner := public.clear_test_open_response_grades_atomic(p_test_id,p_actor_id,v_ids,p_payload->'responses',clock_timestamp());
      else
        v_inner := public.return_test_attempts_checked_atomic(p_test_id,v_ids,p_actor_id);
      end if;
      v_result := v_inner || jsonb_build_object('student_ids',to_jsonb(v_ids));
    end if;
  elsif p_operation in ('unsubmit-plan','unsubmit','delete-single','delete-bulk') then
    if v_test.status = 'draft' then raise exception using errcode = 'PT400', message = 'test_owner_draft'; end if;
    if exists(select 1 from public.test_ai_grading_runs where test_id = p_test_id and status in ('queued','running')) then
      raise exception using errcode = 'PT409', message = 'test_owner_active_ai_run';
    end if;
    if p_payload - (case when p_operation = 'unsubmit' then array['student_ids','eligible_student_ids','attempts'] else array['student_ids'] end) <> '{}'::jsonb
      or jsonb_typeof(p_payload->'student_ids') is distinct from 'array' then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_selection';
    end if;
    if jsonb_array_length(p_payload->'student_ids') not between 1 and 100
      or (p_operation = 'delete-single' and jsonb_array_length(p_payload->'student_ids') <> 1)
      or exists(select 1 from jsonb_array_elements(p_payload->'student_ids') id where jsonb_typeof(id) <> 'string') then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_selection';
    end if;
    select array_agg(distinct value::uuid order by value::uuid) into v_ids from jsonb_array_elements_text(p_payload->'student_ids');
    select coalesce(array_agg(student_id order by student_id),array[]::uuid[]) into v_eligible from (
      select student_id from public.classroom_enrollments where classroom_id = v_classroom_id
        and student_id = any(v_ids) and student_id <> p_actor_id order by student_id for share nowait
    ) enrolled;
    -- A final plan becoming stale is a source conflict even if its last
    -- eligible member left. Initial plans and resets retain invalid-selection400.
    if p_operation = 'unsubmit' and p_payload->'eligible_student_ids' is distinct from to_jsonb(v_eligible) then
      raise exception using errcode = 'PT409', message = 'test_owner_recovery_source_changed';
    end if;
    if cardinality(v_eligible) = 0 or (p_operation in ('delete-single','delete-bulk') and cardinality(v_eligible) <> cardinality(v_ids)) then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_members';
    end if;
    perform 1 from public.test_attempts where test_id = p_test_id and student_id = any(v_eligible) order by student_id for update nowait;
    -- Bound every delegated deletion's exact relation set before the writer.
    -- The Test key and membership fence exclude compatible lifecycle writers.
    select count(*),coalesce(sum(octet_length(to_jsonb(a)::text)),0) into v_attempt_count,v_source_bytes
      from (select id,student_id,draft_revision,responses from public.test_attempts where test_id = p_test_id and student_id = any(v_eligible) limit 101) a;
    if v_attempt_count > 100 or v_source_bytes > 1048576 then
      raise exception using errcode = 'PT503', message = 'test_owner_recovery_source_limit';
    end if;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.student_id),'[]') into v_attempts
      from (select id,student_id,draft_revision,responses from public.test_attempts where test_id = p_test_id and student_id = any(v_eligible) limit 101) a;
    if p_operation = 'unsubmit-plan' then
      v_result := jsonb_build_object('student_ids',v_ids,'eligible_student_ids',v_eligible,'attempts',v_attempts);
    else
      with responses as materialized (
        select r.* from public.test_responses r where r.test_id = p_test_id and r.student_id = any(v_eligible) limit 10001
      ), focus as materialized (
        select f.* from public.test_focus_events f where f.test_id = p_test_id and f.student_id = any(v_eligible) limit 10001
      ), ai as materialized (
        select i.* from public.test_ai_grading_run_items i where i.test_id = p_test_id and i.student_id = any(v_eligible) limit 10001
      ), history as materialized (
        select h.* from public.test_attempt_history h join public.test_attempts a on a.id = h.test_attempt_id
        where a.test_id = p_test_id and a.student_id = any(v_eligible) limit 10001
      )
      select (select count(*) from responses),(select count(*) from focus),(select count(*) from ai),(select count(*) from history),
        (select coalesce(sum(octet_length(to_jsonb(r)::text)),0) from responses r)
        + (select coalesce(sum(octet_length(to_jsonb(f)::text)),0) from focus f)
        + (select coalesce(sum(octet_length(to_jsonb(i)::text)),0) from ai i)
        + (select coalesce(sum(octet_length(to_jsonb(h)::text)),0) from history h)
        into v_response_count,v_focus_count,v_ai_count,v_history_count,v_source_bytes;
      if greatest(v_response_count,v_focus_count,v_ai_count,v_history_count) > 10000 or v_source_bytes > 8388608 then
        raise exception using errcode = 'PT503', message = 'test_owner_recovery_collection_limit';
      end if;
      if p_operation = 'unsubmit' then
        if jsonb_typeof(p_payload->'attempts') is distinct from 'array' then
          raise exception using errcode = 'PT409', message = 'test_owner_recovery_source_changed';
        end if;
        if jsonb_array_length(p_payload->'attempts') <> v_attempt_count then
          raise exception using errcode = 'PT409', message = 'test_owner_recovery_source_changed';
        end if;
        select coalesce(jsonb_agg(row - array['snapshot','word_count','char_count','paste_word_count','keystroke_count'] order by (row->>'student_id')::uuid),'[]')
          into v_expected_attempts from jsonb_array_elements(p_payload->'attempts') row;
        if v_expected_attempts is distinct from v_attempts then
          raise exception using errcode = 'PT409', message = 'test_owner_recovery_source_changed';
        end if;
        -- Bind each normalized baseline to the actual locked saved draft. The
        -- server uses normalizeTestResponses/buildTestAttemptHistoryMetrics,
        -- just as the legacy writer; SQL independently checks the snapshot.
        for v_row in select value from jsonb_array_elements(p_payload->'attempts') loop
          if not v_row ?& array['snapshot','word_count','char_count','paste_word_count','keystroke_count']
            or jsonb_typeof(v_row->'snapshot') is distinct from 'object'
            or exists(select 1 from unnest(array['word_count','char_count','paste_word_count','keystroke_count']) metric
              where jsonb_typeof(v_row->metric) is distinct from 'number' or (v_row->>metric)::numeric < 0
                or (v_row->>metric)::numeric > 2097152 or trunc((v_row->>metric)::numeric) <> (v_row->>metric)::numeric)
            or (v_row->>'paste_word_count')::integer <> 0 or (v_row->>'keystroke_count')::integer <> 0 then
            raise exception using errcode = 'PT400', message = 'test_owner_invalid_history';
          end if;
          v_snapshot := '{}'::jsonb;
          if jsonb_typeof(v_row->'responses') = 'object' then
            for v_entry in select key,value from jsonb_each(v_row->'responses') loop
              -- Match ECMAScript String.trim used by normalizeTestResponses.
              if btrim(v_entry.key, E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194)
                || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
                || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) = '' then continue; end if;
              v_value := v_entry.value; v_selected := null; v_text := null;
              if jsonb_typeof(v_value) = 'number' then
                v_selected := (v_value #>> '{}')::numeric;
              elsif jsonb_typeof(v_value) = 'string' then
                v_text := v_value #>> '{}';
              elsif jsonb_typeof(v_value) = 'object' then
                if v_value->>'question_type' = 'open_response' and jsonb_typeof(v_value->'response_text') = 'string' then
                  v_text := v_value->>'response_text';
                elsif jsonb_typeof(v_value->'selected_option') = 'number'
                  and (v_value->>'selected_option')::numeric >= 0 and trunc((v_value->>'selected_option')::numeric) = (v_value->>'selected_option')::numeric then
                  v_selected := (v_value->>'selected_option')::numeric;
                elsif jsonb_typeof(v_value->'response_text') = 'string' then
                  v_text := v_value->>'response_text';
                end if;
              end if;
              if v_selected is not null and v_selected >= 0 and trunc(v_selected) = v_selected then
                v_snapshot := v_snapshot || jsonb_build_object(v_entry.key,jsonb_build_object('question_type','multiple_choice','selected_option',v_selected));
              elsif v_text is not null then
                v_snapshot := v_snapshot || jsonb_build_object(v_entry.key,jsonb_build_object('question_type','open_response','response_text',replace(v_text,E'\r\n',E'\n')));
              end if;
            end loop;
          end if;
          if v_row->'snapshot' is distinct from v_snapshot then
            raise exception using errcode = 'PT400', message = 'test_owner_invalid_history';
          end if;
        end loop;
        -- The inherited writer deletes responses only for subjects who have an
        -- attempt. Orphan finalized rows retain its original no-attempt behavior.
        select count(*) into v_response_count from public.test_responses r
          where r.test_id = p_test_id and r.student_id in (select (a->>'student_id')::uuid from jsonb_array_elements(v_attempts) a);
        v_inner := public.unsubmit_test_attempts_atomic(p_test_id,v_eligible,p_actor_id);
        if jsonb_typeof(v_inner) is distinct from 'object' or v_inner->'unsubmitted_count' is distinct from to_jsonb(v_attempt_count)
          or v_inner->'deleted_responses' is distinct from to_jsonb(v_response_count)
          or exists(select 1 from public.test_responses where test_id = p_test_id and student_id in (
            select (a->>'student_id')::uuid from jsonb_array_elements(v_attempts) a))
          or exists(select 1 from jsonb_array_elements(v_attempts) a left join public.test_attempts current_attempt on current_attempt.id = (a->>'id')::uuid
            where current_attempt.id is null or current_attempt.test_id <> p_test_id or current_attempt.student_id <> (a->>'student_id')::uuid
              or current_attempt.responses is distinct from a->'responses' or current_attempt.draft_revision < (a->>'draft_revision')::bigint
              or current_attempt.is_submitted or current_attempt.submitted_at is not null or current_attempt.returned_at is not null or current_attempt.returned_by is not null
              or current_attempt.closed_for_grading_at is not null or current_attempt.closed_for_grading_by is not null) then
          raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
        end if;
        -- Preserve the existing best-effort history contract. This savepoint
        -- contains ONLY history inserts, after all mutation/CAS checks above.
        -- A history failure rolls back these baseline rows, not the unsubmit.
        begin
          for v_row in select value from jsonb_array_elements(p_payload->'attempts') loop
            insert into public.test_attempt_history(test_attempt_id,patch,snapshot,word_count,char_count,paste_word_count,keystroke_count,trigger)
          values ((v_row->>'id')::uuid,null,v_row->'snapshot',(v_row->>'word_count')::integer,(v_row->>'char_count')::integer,0,0,'teacher_unsubmit');
            v_history_written := v_history_written + 1;
          end loop;
        exception when others then v_history_written := 0;
        end;
        v_result := jsonb_build_object('student_ids',v_ids,'unsubmitted_count',v_attempt_count,'skipped_count',cardinality(v_ids)-v_attempt_count,
          'skipped_enrollment_count',cardinality(v_ids)-cardinality(v_eligible),'history_written_count',v_history_written);
      else
        select count(*) into v_deleted_student_count from unnest(v_ids) selected(student_id) where
          exists(select 1 from public.test_attempts where test_id = p_test_id and student_id = selected.student_id)
          or exists(select 1 from public.test_responses where test_id = p_test_id and student_id = selected.student_id)
          or exists(select 1 from public.test_focus_events where test_id = p_test_id and student_id = selected.student_id)
          or exists(select 1 from public.test_ai_grading_run_items where test_id = p_test_id and student_id = selected.student_id);
        if p_operation = 'delete-single' then v_inner := public.delete_student_test_attempt_atomic(p_test_id,v_ids[1]);
        else v_inner := public.delete_student_test_attempts_atomic(p_test_id,v_ids); end if;
        if v_inner->'deleted_attempts' is distinct from to_jsonb(v_attempt_count)
          or v_inner->'deleted_responses' is distinct from to_jsonb(v_response_count)
          or v_inner->'deleted_focus_events' is distinct from to_jsonb(v_focus_count)
          or v_inner->'deleted_ai_grading_items' is distinct from to_jsonb(v_ai_count)
          or (p_operation = 'delete-bulk' and (v_inner->'requested_count' is distinct from to_jsonb(cardinality(v_ids))
            or v_inner->'deleted_student_count' is distinct from to_jsonb(v_deleted_student_count)))
          or exists(select 1 from public.test_attempts where test_id = p_test_id and student_id = any(v_ids))
          or exists(select 1 from public.test_responses where test_id = p_test_id and student_id = any(v_ids))
          or exists(select 1 from public.test_focus_events where test_id = p_test_id and student_id = any(v_ids))
          or exists(select 1 from public.test_ai_grading_run_items where test_id = p_test_id and student_id = any(v_ids)) then
          raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
        end if;
        v_result := v_inner || jsonb_build_object('student_ids',v_ids);
      end if;
    end if;
  elsif p_operation = 'update' then
    if p_payload = '{}'::jsonb or p_payload - array['title','show_results','documents','test_date'] <> '{}'::jsonb
      or (p_payload ? 'test_date' and p_payload - array['test_date'] <> '{}'::jsonb)
      or (p_payload ? 'title' and (pg_catalog.jsonb_typeof(p_payload->'title') <> 'string' or length(btrim(p_payload->>'title')) not between 1 and 10000))
      or (p_payload ? 'show_results' and pg_catalog.jsonb_typeof(p_payload->'show_results') <> 'boolean')
      or (p_payload ? 'documents' and pg_catalog.jsonb_typeof(p_payload->'documents') <> 'array')
      or (p_payload ? 'test_date' and p_payload->'test_date' <> 'null'::jsonb and
        (pg_catalog.jsonb_typeof(p_payload->'test_date') <> 'string' or p_payload->>'test_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          or ((p_payload->>'test_date')::date)::text is distinct from p_payload->>'test_date')) then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_input';
    end if;
    if v_test.status = 'draft' and (p_payload ? 'title' or p_payload ? 'show_results') then
      raise exception using errcode = 'PT400', message = 'test_owner_use_draft';
    end if;
    if p_payload ? 'documents' and (pg_catalog.jsonb_array_length(p_payload->'documents') > 20
      or exists(select 1 from pg_catalog.jsonb_array_elements(p_payload->'documents') document
        group by document->>'id' having count(*) > 1)) then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_documents';
    end if;
    -- Preserve imported/current references, but a new upload must have been
    -- reserved for this exact Test and current actor, even within one Classroom.
    for v_document in select value from pg_catalog.jsonb_array_elements(coalesce(p_payload->'documents',v_test.documents)) loop
      v_path := coalesce(nullif(btrim(v_document->>'storage_path'), ''), (
        select identity.storage_path from public.managed_storage_public_url_identity(btrim(v_document->>'url')) identity
        where identity.storage_bucket = 'test-documents'
      ));
      if v_document->>'source' = 'upload' and not exists(
        select 1 from pg_catalog.jsonb_array_elements(v_test.documents) existing
        where existing->>'id' = v_document->>'id' and existing->>'source' = 'upload'
          -- The inherited ledger accepts URL-only legacy references. The editor
          -- canonicalizes them to paths; representation is not a new attachment.
          and coalesce(nullif(btrim(existing->>'storage_path'), ''), (
            select identity.storage_path from public.managed_storage_public_url_identity(btrim(existing->>'url')) identity
            where identity.storage_bucket = 'test-documents'
          )) is not distinct from v_path
          and existing->>'managed_object_id' is not distinct from v_document->>'managed_object_id'
      ) then
        select * into v_object from public.managed_storage_objects
          where id = (v_document->>'managed_object_id')::uuid for update nowait;
        if not found or v_object.classroom_id is distinct from v_classroom_id
          or v_object.storage_bucket <> 'test-documents' or v_object.storage_path is distinct from v_path
          or v_object.purpose <> 'teacher_test_material' or v_object.status not in ('verified','ready')
          or v_object.resource_type is distinct from 'test' or v_object.resource_id is distinct from p_test_id
          or v_object.created_by_user_id is distinct from p_actor_id then
          raise exception using errcode = 'PT403', message = 'test_owner_document_forbidden';
        end if;
      end if;
      if v_document->>'source' = 'link' and v_document ? 'snapshot_path' and not exists(
        select 1 from pg_catalog.jsonb_array_elements(v_test.documents) existing
        where existing->>'id' = v_document->>'id' and existing->>'source' = 'link' and existing->>'url' = v_document->>'url'
          and existing->>'snapshot_path' = v_document->>'snapshot_path'
          and existing->>'snapshot_managed_object_id' is not distinct from v_document->>'snapshot_managed_object_id'
      ) then raise exception using errcode = 'PT403', message = 'test_owner_document_forbidden'; end if;
    end loop;
    v_inner := public.update_test_documents_atomic(p_actor_id,p_test_id,v_test.status,v_test.documents,
      case when p_payload ? 'documents' then p_payload->'documents' else v_test.documents end,
      p_payload ? 'title',p_payload->>'title',false,v_test.status,p_payload ? 'show_results',(p_payload->>'show_results')::boolean);
    if p_payload ? 'test_date' then
      update public.tests set test_date = (p_payload->>'test_date')::date where id = p_test_id;
    end if;
    v_result := pg_catalog.jsonb_build_object('cleanup_paths',v_inner->'cleanup_paths');
  elsif p_operation = 'student-access' then
    if p_payload - array['state','student_ids'] <> '{}'::jsonb or p_payload->>'state' is null
      or p_payload->>'state' not in ('open','closed') or pg_catalog.jsonb_typeof(p_payload->'student_ids') is distinct from 'array' then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_selection';
    end if;
    if pg_catalog.jsonb_array_length(p_payload->'student_ids') not between 1 and 100 or v_test.status = 'draft' then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_selection';
    end if;
    select array_agg(distinct value::uuid order by value::uuid) into v_ids from pg_catalog.jsonb_array_elements_text(p_payload->'student_ids');
    select coalesce(array_agg(student_id order by student_id),array[]::uuid[]) into v_eligible from (
      select student_id from public.classroom_enrollments where classroom_id = v_classroom_id
        and student_id = any(v_ids) and student_id <> p_actor_id order by student_id for share nowait
    ) enrolled;
    if cardinality(v_eligible) = 0 then raise exception using errcode = 'PT400', message = 'test_owner_no_selected_members'; end if;
    v_inner := public.update_test_student_access_atomic(p_test_id,v_eligible,p_payload->>'state',p_actor_id);
    v_result := pg_catalog.jsonb_build_object('updated_count',cardinality(v_eligible),'skipped_count',cardinality(v_ids)-cardinality(v_eligible),
      'locked_count',v_inner->'locked_count','unlocked_count',v_inner->'unlocked_count','state',p_payload->>'state');
  elsif p_operation = 'reserve' then
    v_object_id := (p_payload->>'object_id')::uuid; v_document_id := p_payload->>'document_id';
    v_path := p_payload->>'storage_path'; v_purpose := p_payload->>'purpose'; v_content_type := p_payload->>'content_type';
    if v_object_id is null or v_document_id is null or v_path is null or v_content_type is null
      or v_purpose is null or v_purpose not in ('teacher_test_material','test_execution_snapshot')
      or p_payload->>'byte_size' is null or (p_payload->>'byte_size')::bigint not between 1 and 26214400 then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_reservation';
    end if;
    perform v_document_id::uuid;
    if v_purpose = 'test_execution_snapshot' then
      select document into v_document from pg_catalog.jsonb_array_elements(v_test.documents) document
        where document->>'id' = v_document_id and document->>'source' = 'link' and document->>'url' = p_payload->>'expected_url';
      if not found or v_path <> 'link-docs/'||p_actor_id::text||'/'||p_test_id::text||'/'||v_document_id||'/snapshots/'||v_object_id::text
        or v_content_type not in ('text/html','application/pdf','text/plain','text/markdown') then
        raise exception using errcode = 'PT409', message = 'test_owner_document_changed';
      end if;
    elsif v_path !~ ('^classrooms/'||v_classroom_id::text||'/tests/'||p_test_id::text||'/documents/'||v_document_id||'/(images/)?'||v_object_id::text||'\.[a-z0-9]+$')
      or v_content_type not in ('application/pdf','text/plain','text/markdown','text/csv','application/json','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg') then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_reservation';
    end if;
    select * into v_object from public.begin_managed_storage_upload(v_object_id,'test-documents',v_path,v_classroom_id,null,null,
      v_purpose,p_actor_id,null,'test',p_test_id,v_content_type,(p_payload->>'byte_size')::bigint);
  elsif p_operation in ('upload','verify','cancel','sync') then
    v_object_id := (p_payload->>'managed_object_id')::uuid;
    select * into v_object from public.managed_storage_objects where id = v_object_id for update nowait;
    if not found or v_object.storage_bucket <> 'test-documents' or v_object.classroom_id is distinct from v_classroom_id
      or v_object.course_blueprint_id is not null or v_object.provisional_owner_id is not null
      or v_object.resource_type is distinct from 'test' or v_object.resource_id is distinct from p_test_id
      or v_object.created_by_user_id is distinct from p_actor_id then
      raise exception using errcode = 'PT404', message = 'test_owner_upload_not_found';
    end if;
    if p_operation = 'cancel' then
      -- Under the object lock, never cancel a verified concurrent upload or an
      -- image reservation. Expiry retains durable cleanup authority for both.
      if v_object.purpose = 'teacher_test_material' and v_object.status = 'reserved'
        and v_object.content_type not in ('image/png', 'image/jpeg') then
        v_result := pg_catalog.to_jsonb(public.queue_managed_storage_cleanup(v_object.id,'test_document_client_upload_failed'));
      else v_result := 'false'::jsonb; end if;
    else
      v_document_id := p_payload->>'document_id';
      if v_document_id is null then raise exception using errcode = 'PT400', message = 'test_owner_invalid_input'; end if;
      perform v_document_id::uuid;
      if v_object.purpose = 'teacher_test_material' then
        if v_object.storage_path !~ ('^classrooms/'||v_classroom_id::text||'/tests/'||p_test_id::text||'/documents/'||v_document_id||'/(images/)?'||v_object.id::text||'\.[a-z0-9]+$') then
          raise exception using errcode = 'PT404', message = 'test_owner_upload_not_found';
        end if;
      elsif v_object.purpose = 'test_execution_snapshot' then
        select document into v_document from pg_catalog.jsonb_array_elements(v_test.documents) document
          where document->>'id' = v_document_id and document->>'source' = 'link' and document->>'url' = p_payload->>'expected_url';
        if not found or v_object.storage_path <> 'link-docs/'||p_actor_id::text||'/'||p_test_id::text||'/'||v_document_id||'/snapshots/'||v_object.id::text then
          raise exception using errcode = 'PT409', message = 'test_owner_document_changed';
        end if;
      else raise exception using errcode = 'PT404', message = 'test_owner_upload_not_found'; end if;
      if v_object.status not in ('reserved','verified') then raise exception using errcode = 'PT409', message = 'test_owner_upload_changed'; end if;
      if p_operation = 'verify' then select * into v_object from public.verify_managed_storage_upload(v_object.id); end if;
      if p_operation = 'sync' then
        if v_object.purpose <> 'test_execution_snapshot' or v_object.status <> 'verified' then
          raise exception using errcode = 'PT409', message = 'test_owner_upload_changed';
        end if;
        v_inner := public.sync_test_document_snapshot_managed_atomic(p_actor_id,p_test_id,v_document_id,p_payload->>'expected_url',
          v_object.storage_path,v_object.content_type,(p_payload->>'synced_at')::timestamptz,v_object.id);
        v_result := 'null'::jsonb;
      end if;
    end if;
  elsif p_operation = 'document' then
    v_document_id := p_payload->>'document_id';
    select document into v_document from pg_catalog.jsonb_array_elements(v_test.documents) document where document->>'id' = v_document_id;
    if not found or v_document->>'source' is distinct from p_payload->>'source' then
      raise exception using errcode = 'PT404', message = 'test_owner_document_not_found';
    end if;
    v_path := case when p_payload->>'source' = 'upload' then
      coalesce(nullif(btrim(v_document->>'storage_path'), ''), (
        select identity.storage_path from public.managed_storage_public_url_identity(btrim(v_document->>'url')) identity
        where identity.storage_bucket = 'test-documents'
      )) else v_document->>'snapshot_path' end;
    v_object_id := (case when p_payload->>'source' = 'upload' then v_document->>'managed_object_id' else v_document->>'snapshot_managed_object_id' end)::uuid;
    if v_path is null then raise exception using errcode = 'PT404', message = 'test_owner_document_not_found'; end if;
    select * into v_object from public.managed_storage_objects where storage_bucket = 'test-documents' and storage_path = v_path
      and (v_object_id is null or id = v_object_id) for share nowait;
    if not found or v_object.status <> 'ready' or v_object.classroom_id is distinct from v_classroom_id
      or v_object.provisional_owner_id is not null or v_object.course_blueprint_id is not null
      or v_object.purpose is distinct from (case when p_payload->>'source' = 'upload' then 'teacher_test_material' else 'test_execution_snapshot' end)
      or not exists(select 1 from public.managed_storage_json_references reference
        where reference.test_id = p_test_id and reference.managed_object_id = v_object.id
          and reference.storage_bucket = 'test-documents' and reference.storage_path = v_path) then
      raise exception using errcode = 'PT404', message = 'test_owner_document_not_found';
    end if;
    v_result := pg_catalog.jsonb_build_object('document',v_document,'content_type',v_object.content_type);
  end if;

  if p_operation in ('reserve','upload','verify') then
    if v_object.classroom_id is distinct from v_classroom_id or v_object.created_by_user_id is distinct from p_actor_id
      or v_object.resource_type is distinct from 'test' or v_object.resource_id is distinct from p_test_id
      or v_object.storage_bucket <> 'test-documents' or v_object.status not in ('reserved','verified')
      or v_object.content_type is null or v_object.byte_size is null
      or (p_operation = 'reserve' and (v_object.storage_path is distinct from v_path or v_object.purpose is distinct from v_purpose
        or v_object.content_type is distinct from v_content_type or v_object.byte_size is distinct from (p_payload->>'byte_size')::bigint)) then
      raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
    end if;
    v_result := pg_catalog.jsonb_build_object('id',v_object.id,'classroom_id',v_object.classroom_id,'storage_bucket',v_object.storage_bucket,
      'storage_path',v_object.storage_path,'purpose',v_object.purpose,'created_by_user_id',v_object.created_by_user_id,
      'resource_type',v_object.resource_type,'resource_id',v_object.resource_id,'status',v_object.status,
      'content_type',v_object.content_type,'byte_size',v_object.byte_size);
  end if;
  -- Deletion acknowledges the captured source and absence; normal operations retain their surviving-row footer.
  if p_operation = 'delete' then
    if exists(select 1 from public.tests where id = p_test_id)
      or not exists(select 1 from public.classrooms where id = v_classroom_id and teacher_id = p_actor_id and archived_at is null)
      or v_test.blueprint_archived_at is not null
      or coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
      or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false)
      or coalesce(pg_catalog.current_setting('pika.identity_mapping', true), 'off') = 'on'
      or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize', true), 'off') = 'on'
      or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize', true), 'off') = 'on'
      or coalesce(pg_catalog.current_setting('pika.student_purge_finalize', true), 'off') = 'on'
      or exists(select 1 from public.student_purge_operations operation
        join private.student_provider_cleanup_bindings binding on binding.operation_id = operation.id
        where operation.classroom_id = v_classroom_id and operation.status <> 'completed') then
      raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
    end if;
    perform public.guard_classroom_purge_lifecycle(v_classroom_id);
    if pg_catalog.clock_timestamp() >= v_phase_deadline then raise exception using errcode = 'PT503', message = 'test_owner_deadline'; end if;
    if pg_catalog.octet_length(pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',v_classroom_id,
      'test_id',p_test_id,'operation',p_operation,'test',pg_catalog.to_jsonb(v_test),'result',v_result,'test_absent',true)::text) > 4000000 then
      raise exception using errcode = 'PT503', message = 'test_owner_results_source_limit';
    end if;
    return pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',v_classroom_id,'test_id',p_test_id,
      'operation',p_operation,'test',pg_catalog.to_jsonb(v_test),'result',v_result,'test_absent',true);
  end if;
  select * into v_after from public.tests where id = p_test_id and classroom_id = v_classroom_id;
  if not found or not exists(select 1 from public.classrooms where id = v_classroom_id and teacher_id = p_actor_id)
    or (p_operation = 'update' and pg_catalog.to_jsonb(v_after) - array['title','show_results','documents','test_date','updated_at']
      is distinct from pg_catalog.to_jsonb(v_test) - array['title','show_results','documents','test_date','updated_at'])
    or (p_operation = 'update' and (v_after.title is distinct from (case when p_payload ? 'title' then p_payload->>'title' else v_test.title end)
      or v_after.test_date is distinct from (case when p_payload ? 'test_date' then (p_payload->>'test_date')::date else v_test.test_date end)
      or v_after.show_results is distinct from (case when p_payload ? 'show_results' then (p_payload->>'show_results')::boolean else v_test.show_results end)
      or v_after.documents is distinct from (case when p_payload ? 'documents' then p_payload->'documents' else v_test.documents end)))
    or (p_operation = 'sync' and (pg_catalog.to_jsonb(v_after) - array['documents','updated_at']
      is distinct from pg_catalog.to_jsonb(v_test) - array['documents','updated_at']
      or v_after.documents is distinct from (
        select pg_catalog.jsonb_agg(case when document->>'id' = v_document_id then
          document || pg_catalog.jsonb_build_object('snapshot_path',v_object.storage_path,'snapshot_managed_object_id',v_object.id,
            'snapshot_content_type',v_object.content_type,'synced_at',(p_payload->>'synced_at')::timestamptz)
          else document end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_test.documents) with ordinality documents(document,ordinal))))
    or (p_operation = 'unpublish' and (pg_catalog.to_jsonb(v_after) - array['status','updated_at']
      is distinct from pg_catalog.to_jsonb(v_test) - array['status','updated_at']
      or v_after.status is distinct from 'draft' or v_after.questions_locked_at is not null
      or v_after.questions_locked_at is distinct from v_test.questions_locked_at
      or (v_test.status = 'draft' and v_after is distinct from v_test)
      or v_inner->'test' is distinct from pg_catalog.to_jsonb(v_after)))
    or (p_operation not in ('update','sync','student-access','unpublish') and v_after is distinct from v_test) then
    raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then raise exception using errcode = 'PT503', message = 'test_owner_deadline'; end if;
  if p_operation in ('results','manual-save','clear-open-grades','return','unsubmit-plan','unsubmit','delete-single','delete-bulk','unpublish') and
    pg_catalog.octet_length(pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',v_classroom_id,
      'test_id',p_test_id,'operation',p_operation,'test',pg_catalog.to_jsonb(v_after),'result',v_result)::text) > 4000000 then
    raise exception using errcode = 'PT503', message = 'test_owner_results_source_limit';
  end if;
  return pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',v_classroom_id,'test_id',p_test_id,
    'operation',p_operation,'test',pg_catalog.to_jsonb(v_after),'result',v_result);
exception
  when insufficient_privilege then
    if p_operation in ('manual-save','clear-open-grades','return','unsubmit-plan','unsubmit','delete-single','delete-bulk','delete') then
      raise exception using errcode = 'PT403', message = 'test_owner_forbidden';
    end if;
    raise;
  when no_data_found then
    if p_operation in ('manual-save','clear-open-grades','return','unsubmit-plan','unsubmit','delete-single','delete-bulk','delete') then
      raise exception using errcode = 'PT404', message = 'test_owner_not_found';
    end if;
    raise;
  when serialization_failure then raise exception using errcode = 'PT409', message = 'test_owner_source_changed';
  when lock_not_available or deadlock_detected then raise exception using errcode = 'PT409', message = 'test_owner_busy';
  when invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range then
    raise exception using errcode = 'PT400', message = 'test_owner_invalid_input';
end;
$function$;
alter function public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz) owner to postgres;
revoke all on function public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz) to service_role;


create or replace function public.test_learner_workflow_v1(
  p_actor_id uuid, p_test_id uuid, p_classroom_id uuid, p_operation text,
  p_payload jsonb, p_deadline timestamptz
)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '8s'
as $function$
declare
  v_classroom_id uuid; v_classroom public.classrooms%rowtype; v_test public.tests%rowtype;
  v_attempt public.test_attempts%rowtype; v_history public.test_attempt_history%rowtype;
  v_object public.managed_storage_objects%rowtype; v_subject uuid; v_owner boolean;
  v_state text; v_has_submitted boolean; v_locked boolean; v_can_continue boolean; v_can_view boolean;
  v_result jsonb := '{}'::jsonb; v_inner jsonb; v_state_json jsonb; v_questions jsonb; v_events jsonb;
  v_document jsonb; v_path text; v_object_id uuid; v_document_id text; v_source text;
  v_rows bigint; v_bytes bigint := 0; v_part_bytes bigint; v_event_id uuid;
  v_phase_deadline timestamptz := least(p_deadline,pg_catalog.clock_timestamp()+interval '8 seconds');
begin
  if p_actor_id is null or p_test_id is null or p_deadline is null or not pg_catalog.isfinite(p_deadline)
    or p_deadline > pg_catalog.clock_timestamp()+interval '30 seconds'
    or p_operation is null or p_operation not in ('inspect','detail','start','save','submit','recover','session','history','focus','results','document','history-plan','history-write')
    or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or pg_catalog.octet_length(p_payload::text) > 2097152 then
    raise exception using errcode='PT400',message='test_learner_invalid_input';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then raise exception using errcode='PT503',message='test_learner_deadline'; end if;
  if p_payload - (case p_operation
    when 'inspect' then array['requested_student_id']
    when 'save' then array['requested_student_id','responses','expected_revision','trigger','paste_word_count','keystroke_count']
    when 'submit' then array['requested_student_id','responses','expected_revision']
    when 'focus' then array['requested_student_id','session_id','event_type','metadata']
    when 'document' then array['requested_student_id','document_id','source']
    when 'history-plan' then array['requested_student_id','attempt_id','draft_revision']
    when 'history-write' then array['requested_student_id','attempt_id','draft_revision','expected_last','collapse','patch','snapshot','trigger','word_count','char_count','paste_word_count','keystroke_count']
    else array['requested_student_id'] end) <> '{}'::jsonb then
    raise exception using errcode='PT400',message='test_learner_invalid_input';
  end if;
  if p_payload ? 'requested_student_id' and pg_catalog.jsonb_typeof(p_payload->'requested_student_id') is distinct from 'string' then
    raise exception using errcode='PT400',message='test_learner_invalid_input';
  end if;
  if p_operation in ('save','submit') then
    if pg_catalog.jsonb_typeof(p_payload->'responses') is distinct from 'object'
      or pg_catalog.jsonb_typeof(p_payload->'expected_revision') is distinct from 'number' then
      raise exception using errcode='PT400',message='test_learner_invalid_input';
    end if;
    select count(*) into v_rows from (select key from pg_catalog.jsonb_object_keys(p_payload->'responses') key limit 10001) bounded;
    if v_rows>10000 then raise exception using errcode='PT400',message='test_learner_invalid_input'; end if;
  end if;
  perform 1 from public.managed_storage_settings where singleton for share nowait;
  if not found then raise exception using errcode='PT503',message='test_learner_source_unavailable'; end if;
  select classroom_id into v_classroom_id from public.tests where id=p_test_id;
  if not found then raise exception using errcode='PT404',message='test_learner_not_found'; end if;
  if (p_classroom_id is not null and p_classroom_id is distinct from v_classroom_id)
    or (p_operation <> 'inspect' and p_classroom_id is null) then
    raise exception using errcode='PT409',message='test_learner_parent_changed';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_test_id::text,0))
    or not public.classroom_purge_try_lock(v_classroom_id) then
    raise exception using errcode='PT409',message='test_learner_busy';
  end if;
  perform private.try_lock_classroom_membership_change(v_classroom_id);
  select * into v_classroom from public.classrooms where id=v_classroom_id for update nowait;
  if not found then raise exception using errcode='PT404',message='test_learner_not_found'; end if;
  perform 1 from public.users where id=p_actor_id for key share nowait;
  if not found then raise exception using errcode='PT403',message='test_learner_identity_changed'; end if;
  v_owner := v_classroom.teacher_id = p_actor_id;
  v_subject := coalesce((p_payload->>'requested_student_id')::uuid,p_actor_id);
  -- Owner precedence: only the explicit existing owner-history inspection mode
  -- can target another currently enrolled subject, including archived Classes.
  if v_owner then
    if p_operation not in ('inspect','history') or not p_payload ? 'requested_student_id' then
      raise exception using errcode='PT403',message='test_learner_owner_precedence';
    end if;
  elsif v_subject <> p_actor_id or v_classroom.archived_at is not null
    or (pg_catalog.jsonb_typeof(v_classroom.feature_visibility)='object' and v_classroom.feature_visibility->'tests' = 'false'::jsonb) then
    raise exception using errcode='PT403',message='test_learner_member_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off')='on' then
    raise exception using errcode='PT403',message='test_learner_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  if exists(select 1 from public.student_purge_operations operation
    join private.student_provider_cleanup_bindings binding on binding.operation_id=operation.id
    where operation.classroom_id=v_classroom_id and operation.student_id=v_subject and operation.status <> 'completed') then
    raise exception using errcode='PT403',message='test_learner_fenced';
  end if;
  perform 1 from public.users where id=v_subject for key share nowait;
  if not found then raise exception using errcode='PT403',message='test_learner_identity_changed'; end if;
  perform 1 from public.classroom_enrollments where classroom_id=v_classroom_id and student_id=v_subject for share nowait;
  if not found then raise exception using errcode='PT403',message='test_learner_member_forbidden'; end if;
  select * into v_test from public.tests where id=p_test_id and classroom_id=v_classroom_id for update nowait;
  if not found then raise exception using errcode='PT409',message='test_learner_parent_changed'; end if;
  if not v_owner and (v_test.status='draft' or v_test.blueprint_archived_at is not null) then
    raise exception using errcode='PT404',message='test_learner_not_found';
  end if;
  if pg_catalog.octet_length(v_test.documents::text)>2097152 or pg_catalog.jsonb_typeof(v_test.documents) is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_test.documents)>20 then raise exception using errcode='PT503',message='test_learner_source_limit'; end if;
  select * into v_attempt from public.test_attempts where test_id=p_test_id and student_id=v_subject for update nowait;
  if v_attempt.id is not null and pg_catalog.octet_length(v_attempt.responses::text)>2097152 then
    raise exception using errcode='PT503',message='test_learner_source_limit';
  end if;
  select state into v_state from public.test_student_availability where test_id=p_test_id and student_id=v_subject for share nowait;
  v_locked := v_attempt.closed_for_grading_at is not null;
  v_has_submitted := coalesce(v_attempt.is_submitted,false) or (not v_locked and exists(select 1 from public.test_responses
    where test_id=p_test_id and student_id=v_subject and (selected_option is not null or length(btrim(coalesce(response_text,'')))>0)));
  v_can_continue := coalesce(v_state,case when v_test.status='active' then 'open' else 'closed' end)='open'
    and not v_has_submitted and v_attempt.returned_at is null and not v_locked;
  v_can_view := v_has_submitted or v_attempt.returned_at is not null or v_locked;
  v_state_json := pg_catalog.jsonb_build_object('test',pg_catalog.jsonb_build_object('id',v_test.id,'classroom_id',v_classroom_id,
    'test_date',v_test.test_date,'title',v_test.title,'status',v_test.status,'show_results',v_test.show_results,'documents',v_test.documents,'position',v_test.position,
    'created_at',v_test.created_at,'updated_at',v_test.updated_at),
    'attempt',case when v_attempt.id is null then 'null'::jsonb else pg_catalog.jsonb_build_object('id',v_attempt.id,
      'is_submitted',v_attempt.is_submitted,'returned_at',v_attempt.returned_at,'closed_for_grading_at',v_attempt.closed_for_grading_at,'draft_revision',v_attempt.draft_revision) end,
    'access_state',v_state,'has_submitted',v_has_submitted);
  if not v_owner and p_operation in ('detail','history','document') and not v_can_continue and not v_can_view then
    raise exception using errcode='PT404',message='test_learner_not_found';
  end if;
  if p_operation='session' and not v_can_continue and not v_can_view and v_state is null then
    raise exception using errcode='PT404',message='test_learner_not_found';
  end if;
  if p_operation='results' and not (
    ((v_has_submitted or v_locked) and v_attempt.returned_at is not null
      and coalesce(v_state,case when v_test.status='active' then 'open' else 'closed' end)='closed')
    or (v_test.status='closed' and v_has_submitted and v_attempt.returned_at is not null)) then
    raise exception using errcode='PT403',message='test_learner_results_not_returned';
  end if;
  if p_operation='focus' and not v_can_continue then raise exception using errcode='PT403',message='test_learner_focus_closed'; end if;
  --244 tests the expected revision before its inner lifecycle authorization.
  -- Fence closed/returned/submitted participation before that conflict reply;
  -- own saved-work recovery remains a separate, explicitly permitted operation.
  if p_operation in ('start','save','submit') and not v_can_continue then
    raise exception using errcode='PT403',message='test_learner_participation_closed';
  end if;

  -- Bound collection cardinality and projected bytes before any json aggregation.
  -- LIMIT10001 witnesses overflow rather than silently truncating a10000-row set.
  if p_operation in ('detail','start','save','submit','results') then
    select count(*),coalesce(sum(pg_catalog.octet_length(question_text)+pg_catalog.octet_length(options::text)
      +case when p_operation='results' then pg_catalog.octet_length(coalesce(sample_solution,'')) else 0 end+512),0)
    into v_rows,v_part_bytes from (select question_text,options,sample_solution from public.test_questions where test_id=p_test_id limit 10001) bounded;
    if v_rows>10000 or v_part_bytes>8388608 then raise exception using errcode='PT503',message='test_learner_collection_limit'; end if;
    v_bytes := v_bytes+v_part_bytes;
  end if;
  if p_operation in ('detail','results') then
    select count(*),coalesce(sum(pg_catalog.octet_length(coalesce(response_text,''))+pg_catalog.octet_length(coalesce(feedback,''))+512),0)
    into v_rows,v_part_bytes from (select response_text,feedback from public.test_responses where test_id=p_test_id and student_id=v_subject limit 10001) bounded;
    if v_rows>10000 or v_part_bytes>8388608 then raise exception using errcode='PT503',message='test_learner_collection_limit'; end if;
    v_bytes := v_bytes+v_part_bytes;
  end if;
  if p_operation in ('detail','focus') then
    select count(*),coalesce(sum(pg_catalog.octet_length(coalesce(metadata::text,''))+512),0) into v_rows,v_part_bytes
    from (select metadata from public.test_focus_events where test_id=p_test_id and student_id=v_subject limit 10001) bounded;
    if v_rows>10000 or v_part_bytes>8388608 then raise exception using errcode='PT503',message='test_learner_collection_limit'; end if;
    v_bytes := v_bytes+v_part_bytes;
  end if;
  if p_operation='history' then
    select count(*),coalesce(sum(pg_catalog.octet_length(coalesce(patch::text,''))+pg_catalog.octet_length(coalesce(snapshot::text,''))+512),0)
    into v_rows,v_part_bytes from (select patch,snapshot from public.test_attempt_history where test_attempt_id=v_attempt.id limit 10001) bounded;
    if v_rows>10000 or v_part_bytes>8388608 then raise exception using errcode='PT503',message='test_learner_collection_limit'; end if;
    v_bytes := v_bytes+v_part_bytes;
  end if;
  if v_bytes>8388608 then raise exception using errcode='PT503',message='test_learner_collection_limit'; end if;
  if pg_catalog.clock_timestamp()>=v_phase_deadline then raise exception using errcode='PT503',message='test_learner_deadline'; end if;

  if p_operation='inspect' then
    if p_payload-array['requested_student_id'] <> '{}'::jsonb then raise exception using errcode='PT400',message='test_learner_invalid_input'; end if;
    v_result := pg_catalog.jsonb_build_object('access_mode',case when v_owner then 'owner' else 'member' end);
  elsif p_operation='start' then
    v_inner := public.start_test_attempt_revision_atomic(p_test_id,v_subject);
    select * into strict v_attempt from public.test_attempts where test_id=p_test_id and student_id=v_subject;
    v_result := pg_catalog.jsonb_build_object('questions',v_inner->'questions','attempt',private.test_learner_attempt_projection(v_attempt));
  elsif p_operation in ('save','submit') then
    if p_operation='save' then
      v_inner := public.save_test_attempt_revision_atomic(p_test_id,v_subject,p_payload->'responses',(p_payload->>'expected_revision')::bigint);
    else
      v_inner := public.submit_test_attempt_revision_atomic(p_test_id,v_subject,p_payload->'responses',(p_payload->>'expected_revision')::bigint,pg_catalog.clock_timestamp());
    end if;
    select * into strict v_attempt from public.test_attempts where test_id=p_test_id and student_id=v_subject;
    if v_inner->'conflict'='true'::jsonb then v_result := pg_catalog.jsonb_build_object('conflict',true,'attempt',private.test_learner_attempt_projection(v_attempt));
    elsif p_operation='save' then v_result := pg_catalog.jsonb_build_object('created',v_inner->'created','previous_responses',v_inner->'previous_responses','attempt',private.test_learner_attempt_projection(v_attempt));
    else v_result := pg_catalog.jsonb_build_object('attempt_id',v_inner->'attempt_id','submitted_at',v_inner->'submitted_at','inserted_responses',v_inner->'inserted_responses','draft_revision',v_attempt.draft_revision);
    end if;
  elsif p_operation='recover' then v_result := pg_catalog.jsonb_build_object('attempt',private.test_learner_attempt_projection(v_attempt));
  elsif p_operation='session' then v_result := pg_catalog.jsonb_build_object('state',v_state_json);
  elsif p_operation='history' then
    select coalesce(pg_catalog.jsonb_agg(private.test_learner_history_projection(bounded.history) order by (bounded.history).created_at desc,(bounded.history).id),'[]'::jsonb)
      into v_inner from (select history from public.test_attempt_history history where test_attempt_id=v_attempt.id order by created_at desc,id limit 10001) bounded;
    if pg_catalog.jsonb_array_length(v_inner)>10000 then raise exception using errcode='PT503',message='test_learner_collection_limit'; end if;
    v_result := pg_catalog.jsonb_build_object('history',v_inner,'attemptId',v_attempt.id);
  elsif p_operation in ('history-plan','history-write') then
    if v_attempt.id is distinct from (p_payload->>'attempt_id')::uuid
      or v_attempt.draft_revision is distinct from (p_payload->>'draft_revision')::bigint then
      raise exception using errcode='PT409',message='test_learner_history_changed';
    end if;
    select * into v_history from public.test_attempt_history where test_attempt_id=v_attempt.id order by created_at desc,id desc limit 1 for update nowait;
    if pg_catalog.octet_length(private.test_learner_history_projection(v_history)::text)>2097152 then
      raise exception using errcode='PT503',message='test_learner_source_limit';
    end if;
    if p_operation='history-plan' then
      v_result := pg_catalog.jsonb_build_object('attempt',private.test_learner_attempt_projection(v_attempt),'last_history',private.test_learner_history_projection(v_history));
    else
      if p_payload->'expected_last' is distinct from private.test_learner_history_projection(v_history)
        or pg_catalog.jsonb_typeof(p_payload->'collapse') is distinct from 'boolean'
        or not p_payload ?& array['patch','snapshot','trigger','word_count','char_count','paste_word_count','keystroke_count']
        or p_payload->>'trigger' not in ('autosave','blur','baseline','submit')
        or (pg_catalog.jsonb_typeof(p_payload->'snapshot') not in ('object','null'))
        or (pg_catalog.jsonb_typeof(p_payload->'patch') not in ('array','null'))
        or (pg_catalog.jsonb_typeof(p_payload->'snapshot')='object' and p_payload->'snapshot' is distinct from v_attempt.responses)
        or coalesce((p_payload->>'word_count')::bigint,-1)<0 or coalesce((p_payload->>'char_count')::bigint,-1)<0
        or coalesce((p_payload->>'paste_word_count')::bigint,-1)<0 or coalesce((p_payload->>'keystroke_count')::bigint,-1)<0 then
        raise exception using errcode='PT409',message='test_learner_history_changed';
      end if;
      if (p_payload->>'collapse')::boolean then
        if v_history.id is null or v_history.trigger='submit' or v_history.created_at<=pg_catalog.clock_timestamp()-interval '10 seconds' then
          raise exception using errcode='PT409',message='test_learner_history_changed';
        end if;
        update public.test_attempt_history set patch=nullif(p_payload->'patch','null'::jsonb),snapshot=nullif(p_payload->'snapshot','null'::jsonb),word_count=(p_payload->>'word_count')::integer,
          char_count=(p_payload->>'char_count')::integer,paste_word_count=(p_payload->>'paste_word_count')::integer,
          keystroke_count=(p_payload->>'keystroke_count')::integer,trigger=p_payload->>'trigger',created_at=pg_catalog.clock_timestamp()
          where id=v_history.id and test_attempt_id=v_attempt.id returning * into strict v_history;
      else
        insert into public.test_attempt_history(test_attempt_id,patch,snapshot,word_count,char_count,paste_word_count,keystroke_count,trigger)
        values(v_attempt.id,nullif(p_payload->'patch','null'::jsonb),nullif(p_payload->'snapshot','null'::jsonb),(p_payload->>'word_count')::integer,(p_payload->>'char_count')::integer,
          (p_payload->>'paste_word_count')::integer,(p_payload->>'keystroke_count')::integer,p_payload->>'trigger') returning * into strict v_history;
      end if;
      v_result := pg_catalog.jsonb_build_object('historyEntry',private.test_learner_history_projection(v_history));
    end if;
  elsif p_operation='document' then
    v_document_id := p_payload->>'document_id'; v_source := p_payload->>'source';
    if v_source not in ('upload','link') then raise exception using errcode='PT400',message='test_learner_invalid_document'; end if;
    select document into v_document from pg_catalog.jsonb_array_elements(v_test.documents) document where document->>'id'=v_document_id and document->>'source'=v_source;
    if not found then raise exception using errcode='PT404',message='test_learner_document_not_found'; end if;
    v_path := case when v_source='upload' then coalesce(nullif(btrim(v_document->>'storage_path'),''),(
      select identity.storage_path from public.managed_storage_public_url_identity(btrim(v_document->>'url')) identity where identity.storage_bucket='test-documents')) else v_document->>'snapshot_path' end;
    v_object_id := (case when v_source='upload' then v_document->>'managed_object_id' else v_document->>'snapshot_managed_object_id' end)::uuid;
    if v_path is null then raise exception using errcode='PT404',message='test_learner_document_not_found'; end if;
    select * into v_object from public.managed_storage_objects where storage_bucket='test-documents' and storage_path=v_path
      and (v_object_id is null or id=v_object_id) for share nowait;
    if v_object.id is not null then
      if v_object.status<>'ready' or v_object.classroom_id is distinct from v_classroom_id or v_object.provisional_owner_id is not null
        or v_object.course_blueprint_id is not null or v_object.purpose is distinct from (case when v_source='upload' then 'teacher_test_material' else 'test_execution_snapshot' end)
        or not exists(select 1 from public.managed_storage_json_references reference where reference.test_id=p_test_id and reference.managed_object_id=v_object.id
          and reference.storage_bucket='test-documents' and reference.storage_path=v_path) then
        raise exception using errcode='PT404',message='test_learner_document_not_found';
      end if;
    elsif v_object_id is not null then raise exception using errcode='PT404',message='test_learner_document_not_found';
    end if;
    -- Unmanaged historical upload/snapshot compatibility remains attached to
    -- this exact Test. The server verifies MIME/bucket and rechecks this tuple.
    v_result := pg_catalog.jsonb_build_object('document',v_document,'content_type',v_object.content_type,
      'object',case when v_object.id is null then 'null'::jsonb else pg_catalog.jsonb_build_object('id',v_object.id,'classroom_id',v_object.classroom_id,
        'storage_path',v_object.storage_path,'status',v_object.status,'purpose',v_object.purpose,'content_type',v_object.content_type) end);
  elsif p_operation in ('detail','focus') then
    if p_operation='focus' then
      if coalesce(p_payload->>'event_type','') not in ('away_start','away_end','route_exit_attempt','window_unmaximize_attempt')
        or coalesce(length(p_payload->>'session_id'),0) not between 1 and 120
        or not p_payload ? 'metadata'
        or (p_payload->'metadata'<>'null'::jsonb and pg_catalog.jsonb_typeof(p_payload->'metadata')<>'object')
        or pg_catalog.octet_length((p_payload->'metadata')::text)>32768 then
        raise exception using errcode='PT400',message='test_learner_invalid_focus_event';
      end if;
      if v_rows>=10000 then raise exception using errcode='PT503',message='test_learner_collection_limit'; end if;
      insert into public.test_focus_events(test_id,student_id,session_id,event_type,metadata)
        values(p_test_id,v_subject,p_payload->>'session_id',p_payload->>'event_type',nullif(p_payload->'metadata','null'::jsonb)) returning id into v_event_id;
    end if;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('event_type',event_type,'session_id',session_id,'occurred_at',occurred_at,'metadata',metadata)
      order by occurred_at,id),'[]'::jsonb) into v_events from (select * from public.test_focus_events where test_id=p_test_id and student_id=v_subject order by occurred_at,id limit 10001) bounded;
    if pg_catalog.jsonb_array_length(v_events)>10000 then raise exception using errcode='PT503',message='test_learner_collection_limit'; end if;
    if p_operation='focus' then v_result := pg_catalog.jsonb_build_object('event_id',v_event_id,'focus_events',v_events);
    else
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'test_id',test_id,'question_type',question_type,'question_text',question_text,
        'options',options,'points',points,'response_max_chars',response_max_chars,'response_monospace',response_monospace,'position',position,
        'created_at',created_at,'updated_at',updated_at) order by position,id),'[]'::jsonb) into v_questions from public.test_questions where test_id=p_test_id;
      select coalesce(pg_catalog.jsonb_object_agg(question_id::text,case when selected_option is not null then pg_catalog.jsonb_build_object('question_type','multiple_choice','selected_option',selected_option)
        else pg_catalog.jsonb_build_object('question_type','open_response','response_text',response_text) end),'{}'::jsonb)
        into v_inner from public.test_responses where test_id=p_test_id and student_id=v_subject and (selected_option is not null or response_text is not null);
      v_result := pg_catalog.jsonb_build_object('state',v_state_json,'attempt',private.test_learner_attempt_projection(v_attempt),'questions',v_questions,'submitted_responses',v_inner,'focus_events',v_events);
    end if;
  elsif p_operation='results' then
    -- The current roster and returns are read under the same Classroom/Test
    -- locks as disclosure. Peer raw rows never leave this function.
    select count(*) into v_rows from (select student_id from public.classroom_enrollments where classroom_id=v_classroom_id limit 10001) bounded;
    if v_rows>10000 then raise exception using errcode='PT503',message='test_learner_collection_limit'; end if;
    perform 1 from public.classroom_enrollments where classroom_id=v_classroom_id order by student_id for share nowait;
    select count(*) into v_rows from (select response.id from public.test_responses response join public.classroom_enrollments member
      on member.classroom_id=v_classroom_id and member.student_id=response.student_id join public.test_attempts attempt
      on attempt.test_id=p_test_id and attempt.student_id=response.student_id and attempt.returned_at is not null
      where response.test_id=p_test_id and member.student_id<>v_classroom.teacher_id limit 10001) bounded;
    if v_rows>10000 then raise exception using errcode='PT503',message='test_learner_collection_limit'; end if;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('question_id',q.id,'question_type',q.question_type,'question_text',q.question_text,
      'options',q.options,'points',coalesce(q.points,0),'response_max_chars',coalesce(q.response_max_chars,5000),'response_monospace',coalesce(q.response_monospace,false),
      'sample_solution',case when q.question_type='open_response' and q.response_monospace and length(btrim(coalesce(q.sample_solution,'')))>0 then btrim(q.sample_solution) else null end,
      'correct_option',q.correct_option,'selected_option',r.selected_option,'response_text',r.response_text,'score',r.score,'feedback',r.feedback,'graded_at',r.graded_at,
      'is_correct',case when q.question_type='open_response' then null else coalesce(r.selected_option=q.correct_option,false) end) order by q.position,q.id),'[]'::jsonb)
      into v_questions from public.test_questions q left join public.test_responses r on r.test_id=p_test_id and r.question_id=q.id and r.student_id=v_subject where q.test_id=p_test_id;
    with option_counts as (select response.question_id,response.selected_option,count(*) as response_count from public.test_responses response
      join public.classroom_enrollments member on member.classroom_id=v_classroom_id and member.student_id=response.student_id
      join public.test_attempts attempt on attempt.test_id=p_test_id and attempt.student_id=response.student_id and attempt.returned_at is not null
      where response.test_id=p_test_id and member.student_id<>v_classroom.teacher_id and response.selected_option is not null group by response.question_id,response.selected_option),
    per_question as (select question_id,sum(response_count) as total_responses,
      pg_catalog.jsonb_object_agg(selected_option::text,response_count) as counts from option_counts group by question_id)
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('question_id',q.id,'question_text',q.question_text,'options',q.options,
      'counts',(select coalesce(pg_catalog.jsonb_agg(coalesce((totals.counts->>(option.ordinality-1)::text)::bigint,0) order by option.ordinality),'[]'::jsonb)
        from pg_catalog.jsonb_array_elements(q.options) with ordinality option),
      'total_responses',coalesce(totals.total_responses,0)) order by q.position,q.id),'[]'::jsonb)
      into v_inner from public.test_questions q left join per_question totals on totals.question_id=q.id
      where q.test_id=p_test_id and q.question_type<>'open_response';
    v_result := pg_catalog.jsonb_build_object('state',v_state_json,'question_results',v_questions,'results',v_inner,
      'my_responses',(select coalesce(pg_catalog.jsonb_object_agg(question_id::text,selected_option),'{}'::jsonb) from public.test_responses where test_id=p_test_id and student_id=v_subject and selected_option is not null),
      'summary',(select pg_catalog.jsonb_build_object('earned_points',earned,'possible_points',possible,'percent',case when possible>0 then earned/possible*100 else 0 end)
        from (select coalesce(sum((q->>'score')::numeric),0) earned,coalesce(sum((q->>'points')::numeric),0) possible from pg_catalog.jsonb_array_elements(v_questions) q) totals));
  end if;
  if pg_catalog.clock_timestamp()>=v_phase_deadline then raise exception using errcode='PT503',message='test_learner_deadline'; end if;
  v_result := pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',v_classroom_id,'test_id',p_test_id,
    'subject_id',v_subject,'operation',p_operation,'result',v_result);
  if pg_catalog.octet_length(v_result::text)>8388608 then raise exception using errcode='PT503',message='test_learner_result_limit'; end if;
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
    raise exception using errcode='PT400',message='test_learner_invalid_input';
  when insufficient_privilege then raise exception using errcode='PT403',message='test_learner_forbidden';
  when no_data_found then raise exception using errcode='PT404',message='test_learner_not_found';
  when lock_not_available or deadlock_detected or serialization_failure then raise exception using errcode='PT409',message='test_learner_busy';
end;
$function$;
alter function public.test_learner_workflow_v1(uuid,uuid,uuid,text,jsonb,timestamptz) owner to postgres;
revoke all on function public.test_learner_workflow_v1(uuid,uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.test_learner_workflow_v1(uuid,uuid,uuid,text,jsonb,timestamptz) to service_role;

create or replace function public.discard_pristine_test_draft_atomic(
  p_test_id uuid,
  p_teacher_id uuid,
  p_expected_draft_version integer,
  p_expected_test_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived_at timestamptz;
  v_classroom_id uuid;
  v_draft public.assessment_drafts%rowtype;
  v_owner_id uuid;
  v_test public.tests%rowtype;
begin
  if p_test_id is null
    or p_teacher_id is null
    or p_expected_draft_version is null
    or p_expected_draft_version < 1
    or p_expected_test_updated_at is null
  then
    raise exception using errcode = '22023', message = 'invalid_test_discard_payload';
  end if;

  select test.classroom_id
    into v_classroom_id
  from public.tests test
  where test.id = p_test_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_not_found';
  end if;

  -- Match save_test_draft_atomic's Classroom -> Test -> Draft writer order.
  select classroom.teacher_id, classroom.archived_at
    into v_owner_id, v_archived_at
  from public.classrooms classroom
  where classroom.id = v_classroom_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_classroom_not_found';
  end if;
  if v_owner_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  select test.*
    into v_test
  from public.tests test
  where test.id = p_test_id
    and test.classroom_id = v_classroom_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_not_found';
  end if;
  if v_archived_at is not null or v_test.blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'test_archived';
  end if;

  select draft.*
    into v_draft
  from public.assessment_drafts draft
  where draft.assessment_type = 'test'
    and draft.assessment_id = p_test_id
  for update;

  if not found then
    return jsonb_build_object(
      'discarded', false,
      'reason', 'draft_changed',
      'test', to_jsonb(v_test)
    );
  end if;

  if v_draft.version is distinct from p_expected_draft_version
    or v_test.updated_at is distinct from p_expected_test_updated_at
    or v_test.status is distinct from 'draft'
    or btrim(v_test.title) !~
      '^Untitled([[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}([[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2})?|[[:space:]]*\([0-9]{4}-[0-9]{2}-[0-9]{2}[^)]*\))?$'
    or v_test.test_date is not null
    or v_test.show_results is distinct from false
    or jsonb_typeof(coalesce(v_test.documents, '[]'::jsonb)) is distinct from 'array'
    or jsonb_array_length(coalesce(v_test.documents, '[]'::jsonb)) <> 0
    or btrim(coalesce(v_draft.content->>'title', '')) !~
      '^Untitled([[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}([[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2})?|[[:space:]]*\([0-9]{4}-[0-9]{2}-[0-9]{2}[^)]*\))?$'
    or coalesce((v_draft.content->>'show_results')::boolean, false) is distinct from false
    or jsonb_typeof(v_draft.content->'questions') is distinct from 'array'
    or jsonb_array_length(v_draft.content->'questions') <> 0
    or exists (
      select 1 from public.test_questions question where question.test_id = p_test_id
    )
    or exists (
      select 1 from public.test_attempts attempt where attempt.test_id = p_test_id
    )
    or exists (
      select 1 from public.test_responses response where response.test_id = p_test_id
    )
  then
    return jsonb_build_object(
      'discarded', false,
      'reason', 'draft_changed',
      'test', to_jsonb(v_test)
    );
  end if;

  delete from public.assessment_drafts draft
  where draft.id = v_draft.id;

  delete from public.tests test
  where test.id = p_test_id;

  return jsonb_build_object('discarded', true);
end;
$$;

revoke all on function public.discard_pristine_test_draft_atomic(uuid, uuid, integer, timestamptz)
from public, anon, authenticated;

grant execute on function public.discard_pristine_test_draft_atomic(uuid, uuid, integer, timestamptz)
to service_role;

comment on function public.discard_pristine_test_draft_atomic(uuid, uuid, integer, timestamptz) is
  'Atomically deletes a newly-created untouched Test and its draft, fenced by the observed draft version and Test updated_at.';

-- Preserve the latest publication boundary with the new exact Test row shape.
create or replace function public.publish_test_from_draft_for_owner_v1(
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
    'source_artifact_id','source_blueprint_version_id','status','test_date','title','updated_at']::text[] then
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
