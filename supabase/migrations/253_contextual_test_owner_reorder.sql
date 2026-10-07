-- Dormant current-Class-owner Test-list reorder. Admission is an HTTP gate.
-- Complete membership includes Blueprint-retired and started Tests: position
-- is presentation state; authored content, lineage and runtime remain read-only.
-- Catalog/native proof seals all 13 Test triggers and their reachable routines,
-- including update_tests_updated_at, and attests whole-project preservation.
-- No product-runtime global fingerprint, child/queue write or managed sequence
-- call is introduced. Clock checks fence permission to commit, not physical
-- cancellation of an already-running outer statement.
begin;

create function public.reorder_tests_for_owner_v1(
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
    or pg_catalog.cardinality(p_test_ids) > 10000
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
    'source_artifact_id','source_blueprint_version_id','status','title','updated_at']::text[] then
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
    select test.id from public.tests test where test.classroom_id = p_classroom_id limit 10001
  ) bounded;
  if v_count > 10000 then
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
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(test)::text)),0),
    coalesce(max(pg_catalog.octet_length(pg_catalog.to_jsonb(test)::text)),0)
  into v_test_bytes,v_row_bytes from public.tests test where test.classroom_id = p_classroom_id;
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
  select coalesce(sum(pg_catalog.octet_length(expected.row::text)),0),
    coalesce(max(pg_catalog.octet_length(expected.row::text)),0)
  into v_expected_bytes,v_row_bytes from (
    select case when test.position is distinct from desired.position then
      pg_catalog.to_jsonb(test) || pg_catalog.jsonb_build_object(
        'position',desired.position,'updated_at',pg_catalog.transaction_timestamp())
      else pg_catalog.to_jsonb(test) end as row
    from public.tests test join (
      select requested.id,(v_count - requested.ordinality)::integer as position
      from pg_catalog.unnest(p_test_ids) with ordinality requested(id,ordinality)
    ) desired on desired.id = test.id where test.classroom_id = p_classroom_id
  ) expected;
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
    select test.id from public.tests test where test.classroom_id = p_classroom_id limit 10001
  ) bounded;
  if v_count > 10000 or v_current_ids is distinct from v_requested_ids then
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
  select coalesce(sum(pg_catalog.octet_length(pg_catalog.to_jsonb(test)::text)),0),
    coalesce(max(pg_catalog.octet_length(pg_catalog.to_jsonb(test)::text)),0)
  into v_test_bytes,v_row_bytes from public.tests test where test.classroom_id = p_classroom_id;
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
commit;
