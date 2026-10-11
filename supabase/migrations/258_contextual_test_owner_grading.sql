-- Add bounded owner results and fenced manual grading/clear/return operations.
-- Existing operations/signature and inherited atomic grading writers are preserved.
-- Dormant admission remains server-owned; application requires this migration.
begin;

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
  v_grade jsonb;
  v_student_id uuid;
  v_source jsonb;
  v_source_invalid boolean;
  v_source_bytes bigint;
  v_phase_deadline timestamptz := least(p_deadline, pg_catalog.clock_timestamp() + interval '8 seconds');
begin
  if p_actor_id is null or p_test_id is null or p_deadline is null or not pg_catalog.isfinite(p_deadline)
    or p_operation is null or p_operation not in ('inspect','update','student-access','reserve','upload','verify','cancel','sync','document','results','manual-save','clear-open-grades','return')
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
  if p_operation in ('update','sync','manual-save','clear-open-grades','return') and p_expected_test is distinct from pg_catalog.to_jsonb(v_test) then
    raise exception using errcode = 'PT409', message = 'test_owner_source_changed';
  end if;

  if p_operation = 'inspect' then
    if p_payload <> '{}'::jsonb then raise exception using errcode = 'PT400', message = 'test_owner_invalid_input'; end if;

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
        perform 1 from public.test_responses r join public.test_questions q on q.id = r.question_id and q.test_id = p_test_id
          join public.classroom_enrollments e on e.student_id = r.student_id and e.classroom_id = v_classroom_id
          where r.id = (v_grade->>'response_id')::uuid and r.test_id = p_test_id and r.student_id <> p_actor_id
            and (v_student_id is null or r.student_id = v_student_id)
            and (v_grade->>'question_id' is null or q.id = (v_grade->>'question_id')::uuid)
          for update of r nowait;
        if not found then raise exception using errcode = 'PT400', message = 'test_owner_invalid_grade_target'; end if;
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
          where r->>'id' = (g->>'response_id')::uuid::text
            and r = jsonb_build_object('id',saved.id,'revision',saved.revision,'score',saved.score,'feedback',saved.feedback)
            and saved.score is not distinct from (g->>'score')::numeric
            and saved.feedback is not distinct from (g->>'feedback')
            and saved.revision between (g->>'expected_response_revision')::bigint and (g->>'expected_response_revision')::bigint + 1
        )) then raise exception using errcode = 'PT503', message = 'test_owner_postcondition'; end if;
      v_result := v_inner || jsonb_build_object('student_id',v_student_id);
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
  elsif p_operation = 'update' then
    if p_payload = '{}'::jsonb or p_payload - array['title','show_results','documents'] <> '{}'::jsonb
      or (p_payload ? 'title' and (pg_catalog.jsonb_typeof(p_payload->'title') <> 'string' or length(btrim(p_payload->>'title')) not between 1 and 10000))
      or (p_payload ? 'show_results' and pg_catalog.jsonb_typeof(p_payload->'show_results') <> 'boolean')
      or (p_payload ? 'documents' and pg_catalog.jsonb_typeof(p_payload->'documents') <> 'array') then
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
  select * into v_after from public.tests where id = p_test_id and classroom_id = v_classroom_id;
  if not found or not exists(select 1 from public.classrooms where id = v_classroom_id and teacher_id = p_actor_id)
    or (p_operation = 'update' and pg_catalog.to_jsonb(v_after) - array['title','show_results','documents','updated_at']
      is distinct from pg_catalog.to_jsonb(v_test) - array['title','show_results','documents','updated_at'])
    or (p_operation = 'update' and (v_after.title is distinct from (case when p_payload ? 'title' then p_payload->>'title' else v_test.title end)
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
    or (p_operation not in ('update','sync','student-access') and v_after is distinct from v_test) then
    raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then raise exception using errcode = 'PT503', message = 'test_owner_deadline'; end if;
  if p_operation in ('results','manual-save','clear-open-grades','return') and
    pg_catalog.octet_length(pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',v_classroom_id,
      'test_id',p_test_id,'operation',p_operation,'test',pg_catalog.to_jsonb(v_after),'result',v_result)::text) > 4000000 then
    raise exception using errcode = 'PT503', message = 'test_owner_results_source_limit';
  end if;
  return pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',v_classroom_id,'test_id',p_test_id,
    'operation',p_operation,'test',pg_catalog.to_jsonb(v_after),'result',v_result);
exception
  when insufficient_privilege then
    if p_operation in ('manual-save','clear-open-grades','return') then
      raise exception using errcode = 'PT403', message = 'test_owner_forbidden';
    end if;
    raise;
  when no_data_found then
    if p_operation in ('manual-save','clear-open-grades','return') then
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
commit;
