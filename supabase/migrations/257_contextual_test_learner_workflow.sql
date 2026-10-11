-- Dormant learner workflow; existing244/255 entrypoints and privileges unchanged.
-- Server admission selects this service-only boundary. No auth/RLS/flag rewrite.
begin;

create function private.test_learner_attempt_projection(p_attempt public.test_attempts)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_attempt.id is null then 'null'::jsonb else pg_catalog.jsonb_build_object(
    'id',p_attempt.id,'test_id',p_attempt.test_id,'student_id',p_attempt.student_id,'responses',p_attempt.responses,
    'is_submitted',p_attempt.is_submitted,'submitted_at',p_attempt.submitted_at,'created_at',p_attempt.created_at,
    'updated_at',p_attempt.updated_at,'draft_revision',p_attempt.draft_revision) end;
$$;
revoke all on function private.test_learner_attempt_projection(public.test_attempts) from public, anon, authenticated, service_role;

create function private.test_learner_history_projection(p_history public.test_attempt_history)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_history.id is null then 'null'::jsonb else pg_catalog.jsonb_build_object(
    'id',p_history.id,'test_attempt_id',p_history.test_attempt_id,'patch',p_history.patch,'snapshot',p_history.snapshot,
    'word_count',p_history.word_count,'char_count',p_history.char_count,'paste_word_count',p_history.paste_word_count,
    'keystroke_count',p_history.keystroke_count,'trigger',p_history.trigger,'created_at',p_history.created_at) end;
$$;
revoke all on function private.test_learner_history_projection(public.test_attempt_history) from public, anon, authenticated, service_role;

create function public.test_learner_workflow_v1(
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
    'title',v_test.title,'status',v_test.status,'show_results',v_test.show_results,'documents',v_test.documents,'position',v_test.position,
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
commit;
