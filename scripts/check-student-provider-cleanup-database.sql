-- Synthetic transaction only. Requires separately approved local migration171.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
do $$ begin
  if to_regprocedure('public.reserve_student_provider_cleanup(uuid,uuid,uuid,uuid,uuid)') is null then
    raise exception 'Migration171 is required'; end if;
  if (select enabled from private.student_provider_cleanup_settings where singleton) then
    raise exception 'Fixture requires disabled provider cleanup'; end if;
end $$;
insert into public.users(id,email,role,workos_user_id) values
('c1710000-0000-4000-8000-000000000001','teacher-171@example.invalid','teacher','user_171_teacher'),
('c1710000-0000-4000-8000-000000000002','student-171@example.invalid','student','user_171_student'),
('c1710000-0000-4000-8000-000000000003','peer-171@example.invalid','student','user_171_peer');
insert into public.student_profiles(user_id,first_name,last_name) values
('c1710000-0000-4000-8000-000000000002','Synthetic','Target'),
('c1710000-0000-4000-8000-000000000003','Synthetic','Peer');
insert into public.classrooms(id,teacher_id,title,class_code) values
('c1710000-0000-4000-8000-000000000010','c1710000-0000-4000-8000-000000000001','Provider A','C171A'),
('c1710000-0000-4000-8000-000000000011','c1710000-0000-4000-8000-000000000001','Provider B','C171B');
insert into public.classroom_roster(id,classroom_id,email) values
('c1710000-0000-4000-8000-000000000030','c1710000-0000-4000-8000-000000000010','student-171@example.invalid'),
('c1710000-0000-4000-8000-000000000031','c1710000-0000-4000-8000-000000000011','student-171@example.invalid'),
('c1710000-0000-4000-8000-000000000032','c1710000-0000-4000-8000-000000000010','peer-171@example.invalid');

do $$
declare
  teacher uuid:='c1710000-0000-4000-8000-000000000001';
  student uuid:='c1710000-0000-4000-8000-000000000002';
  peer uuid:='c1710000-0000-4000-8000-000000000003';
  course_a uuid:='c1710000-0000-4000-8000-000000000010';
  course_b uuid:='c1710000-0000-4000-8000-000000000011';
  gen_a uuid:='c1710000-0000-4000-8000-000000000020';
  gen_b uuid:='c1710000-0000-4000-8000-000000000021';
  gen_peer uuid:='c1710000-0000-4000-8000-000000000022';
  op uuid:='c1710000-0000-4000-8000-000000000040';
  ref_a text; ref_b text; ref_peer text; result jsonb; saved jsonb; receipt jsonb; other_id uuid;
  f text; copy_kind text; copy_status text; copy_purpose text; delivery_status text; delivery_target text;
  owner_id uuid; object_id uuid; lease uuid:=gen_random_uuid(); baseline_health jsonb;
begin
  foreach f in array array['reserve_student_provider_cleanup(uuid,uuid,uuid,uuid,uuid)',
    'get_student_provider_cleanup(uuid,uuid,uuid,uuid,uuid)',
    'authorize_student_provider_cleanup(uuid,uuid,uuid,uuid,uuid)',
    'record_student_provider_cleanup_receipt(uuid,uuid,uuid,uuid,uuid,text,jsonb)',
    'authorize_attendance_generation_delivery(uuid,uuid,jsonb)','resolve_attendance_scan_generation(uuid,uuid)'] loop
    if has_function_privilege('anon','public.'||f,'execute') or has_function_privilege('authenticated','public.'||f,'execute')
      or not has_function_privilege('service_role','public.'||f,'execute') then raise exception 'RPC privilege drift: %',f; end if;
  end loop;
  begin
    perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
    raise exception 'Disabled reservation succeeded';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_provider_cleanup_disabled' then raise; end if;
  end;
  update private.student_provider_cleanup_settings set enabled=true,eligible_after=clock_timestamp()-interval '1 minute',
    pal_origin='https://pal.example.invalid',pal_integration_id='c1710000-0000-4000-8000-000000000050',
    bara_origin='https://bara.example.invalid',installation_ref='pika_synthetic_171';
  insert into public.classroom_enrollments(id,classroom_id,student_id) values
    (gen_a,course_a,student),(gen_b,course_b,student),(gen_peer,course_a,peer);
  insert into public.attendance_roster_mappings(classroom_id) values(course_a),(course_b);
  insert into public.attendance_principal_mappings(user_id) values(teacher),(student),(peer);
  insert into public.attendance_participant_mappings(classroom_id,student_id) values(course_a,student),(course_b,student),(course_a,peer);
  select participant_ref into ref_a from public.attendance_participant_mappings where classroom_id=course_a and student_id=student;
  select participant_ref into ref_b from public.attendance_participant_mappings where classroom_id=course_b and student_id=student;
  select participant_ref into ref_peer from public.attendance_participant_mappings where classroom_id=course_a and student_id=peer;
  if ref_a=ref_b then raise exception 'Cross-course generation collision'; end if;
  begin
    perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
    raise exception 'Active enrollment reserved';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_provider_removed_generation_required' then raise; end if;
  end;
  -- Lease closure is asserted within the removal transaction, including a
  -- delivered replay and a classmate row for each state.
  foreach delivery_status in array array['pending','processing','non_retryable','delivered'] loop
    foreach delivery_target in array array[ref_a,ref_peer] loop
      f:='fixture171:'||delivery_status||':'||delivery_target;
      insert into public.attendance_integration_outbox(classroom_id,idempotency_key,message_type,payload,status,
        lease_token,lease_expires_at,response_payload)
      values(course_a,f,'roster.snapshot',jsonb_build_object('schema_version',1,'message_type','roster.snapshot',
        'idempotency_key',f,'correlation_ref','fixture171','installation_ref','pika_synthetic_171',
        'roster_ref','roster_fixture171','participants',jsonb_build_array(jsonb_build_object('participant_ref',delivery_target))),
        delivery_status,case when delivery_status='processing' then lease end,
        case when delivery_status='processing' then clock_timestamp()+interval '10 minutes' end,
        case when delivery_status='delivered' then '{}'::jsonb end);
    end loop;
  end loop;
  perform public.remove_classroom_students_preserving_data(teacher,course_a,array['c1710000-0000-4000-8000-000000000030'::uuid]);
  if (select count(*) from public.attendance_integration_outbox
    where idempotency_key like 'fixture171:%:'||ref_a and status='superseded'
      and lease_token is null and lease_expires_at is null)<>3 then
    raise exception 'Removal failed same-transaction target lease closure'; end if;
  if exists(select 1 from public.attendance_integration_outbox
    where idempotency_key like 'fixture171:%:'||ref_peer and status='superseded') then
    raise exception 'Removal closed classmate delivery'; end if;
  for result in select to_jsonb(outbox) from public.attendance_integration_outbox outbox
    where idempotency_key like 'fixture171:%:'||ref_a loop
    if public.authorize_attendance_generation_delivery((result->>'id')::uuid,
      case when result->>'status'='delivered' then null else lease end,result->'payload') then
      raise exception 'Removed generation delivery/replay authorized'; end if;
    if public.complete_attendance_outbox_v1((result->>'id')::uuid,lease,'{}'::jsonb) then
      raise exception 'Late attendance ack revived removed generation'; end if;
  end loop;
  if not private.attendance_participant_generation_closed(ref_a) or private.attendance_participant_generation_closed(ref_b) then
    raise exception 'Removal generation fence failed'; end if;
  if exists(select 1 from jsonb_array_elements(public.attendance_roster_source_document_v1(course_a)->'participants') p
    where p->>'participant_ref'=ref_a) then raise exception 'Closed ref remains in source snapshot'; end if;
  if public.resolve_attendance_scan_generation(course_a,student)->>'status'<>'forbidden'
    or public.resolve_attendance_scan_generation(course_b,student)->>'status'<>'active' then
    raise exception 'Student scan generation isolation failed'; end if;
  -- Both provisional owner kinds and reserved/verified whole-class copy states
  -- block provider reservation. Each case rolls its own synthetic rows back.
  foreach copy_kind in array array['classroom_copy','restore_copy'] loop
    foreach copy_status in array array['reserved','verified'] loop
      foreach copy_purpose in array array['classroom_archive','gradex_extract'] loop
        begin
          owner_id:=gen_random_uuid(); object_id:=gen_random_uuid();
          insert into public.managed_storage_provisional_owners(id,owner_kind,target_classroom_id,
            operation_id,created_by_user_id,expires_at,adopted_at)
          values(owner_id,copy_kind,course_a,gen_random_uuid(),teacher,clock_timestamp()+interval '1 day',clock_timestamp());
          insert into public.managed_storage_objects(id,storage_bucket,storage_path,provisional_owner_id,purpose,status,verified_at)
          values(object_id,case when copy_purpose='classroom_archive' then 'classroom-archives' else 'gradex-analytics-extracts' end,
            'fixture171/'||object_id::text,owner_id,copy_purpose,copy_status,
            case when copy_status='verified' then clock_timestamp() end);
          begin
            perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
            raise exception 'Provisional whole-class copy bypassed policy';
          exception when sqlstate '55000' then
            if sqlerrm<>'student_provider_copy_policy_required' then raise; end if;
          end;
          raise exception using errcode='P1711',message='rollback synthetic copy case';
        exception when sqlstate 'P1711' then null;
        end;
      end loop;
    end loop;
  end loop;
  -- An unfinished copy intent is blocked before an object can be registered.
  begin
    insert into public.managed_storage_provisional_owners(owner_kind,target_classroom_id,operation_id,created_by_user_id,expires_at)
      values('restore_copy',course_a,gen_random_uuid(),teacher,clock_timestamp()+interval '1 day');
    begin
      perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
      raise exception 'Unfinished provisional copy intent bypassed policy';
    exception when sqlstate '55000' then
      if sqlerrm<>'student_provider_copy_policy_required' then raise; end if;
    end;
    raise exception using errcode='P1711',message='rollback synthetic intent';
  exception when sqlstate 'P1711' then null;
  end;
  -- A copy in the student's other classroom must not block this reservation.
  insert into public.managed_storage_provisional_owners(owner_kind,target_classroom_id,operation_id,created_by_user_id,expires_at)
    values('classroom_copy',course_b,gen_random_uuid(),teacher,clock_timestamp()+interval '1 day');
  baseline_health:=public.get_student_purge_health_snapshot();
  saved:=public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
  result:=public.get_student_purge_health_snapshot();
  if (result->>'active_count')::integer<>(baseline_health->>'active_count')::integer+1
    or result->>'stuck_count' is distinct from baseline_health->>'stuck_count' then
    raise exception 'Provider stage health visibility changed'; end if;
  begin
    insert into public.managed_storage_provisional_owners(owner_kind,target_classroom_id,operation_id,created_by_user_id,expires_at)
      values('restore_copy',course_a,gen_random_uuid(),teacher,clock_timestamp()+interval '1 day');
    raise exception 'Copy producer started after provider reservation';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_provider_copy_policy_required' then raise; end if;
  end;
  if saved->>'status'<>'provider_pending' or saved->>'participant_ref'<>ref_a then raise exception 'Wrong durable binding'; end if;
  if saved<>public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a) then raise exception 'Reservation replay drift'; end if;
  begin
    perform public.reserve_student_provider_cleanup(op,teacher,course_b,student,gen_b);
    raise exception 'Cross-course operation replay accepted';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_provider_binding_conflict' then raise; end if;
  end;
  -- Direct exposed and legacy finalizers, empty claims, and forged statuses.
  foreach f in array array['claim_student_purge_object','finalize_student_purge','finalize_student_purge_without_attendance_v1'] loop
    begin
      execute format('select public.%I($1,$2)',f) into result using op,teacher;
      if coalesce((result->>'ok')::boolean,false) then raise exception 'Provider stage escaped via %',f; end if;
    exception when sqlstate '55000' then
      if sqlerrm not in ('student_provider_stage_required','attendance_student_decommission_required') then raise; end if;
    end;
  end loop;
  begin
    update public.student_purge_operations set status='completed',completed_at=clock_timestamp(),student_id=null where id=op;
    raise exception 'Forged completion accepted';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_provider_stage_required' then raise; end if;
  end;
  begin
    delete from public.student_purge_fences where operation_id=op;
    raise exception 'Provider fence deleted';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_provider_stage_required' then raise; end if;
  end;
  receipt:=jsonb_build_object('schema_version',1,'operation_id',op,'learner_id',saved->>'pal_reference',
    'status','completed','begun_at','2026-09-13T15:00:00Z','completed_at','2026-09-13T15:01:00Z');
  perform public.record_student_provider_cleanup_receipt(op,teacher,course_a,student,gen_a,'pal',receipt);
  begin
    perform public.record_student_provider_cleanup_receipt(op,teacher,course_a,student,gen_a,'pal',receipt||'{"completed_at":"2026-09-13T15:02:00Z"}'::jsonb);
    raise exception 'Conflicting completed Pal receipt accepted';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_provider_receipt_conflict' then raise; end if;
  end;
  receipt:=jsonb_build_object('schema_version',1,'ok',true,'installation_ref',saved->>'installation_ref',
    'roster_ref',saved->>'roster_ref','participant_ref',ref_a,'operation_ref','erase_participant_'||replace(op::text,'-',''),
    'state','deleted','absence_verified',true,'deleted_count',7);
  perform public.record_student_provider_cleanup_receipt(op,teacher,course_a,student,gen_a,'bara',receipt);
  if (select status from public.student_purge_operations where id=op)<>'provider_pending'
    or not exists(select 1 from public.student_purge_fences where operation_id=op)
    or (select state from private.pal_membership_generations where generation_id=gen_a)<>'removed' then
    raise exception 'Provider receipts falsely completed Pika cleanup'; end if;
  update private.student_provider_cleanup_settings set enabled=false;
  begin
    perform public.authorize_student_provider_cleanup(op,teacher,course_a,student,gen_a);
    raise exception 'Paused advance authorized';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_provider_cleanup_disabled' then raise; end if;
  end;
  if public.get_student_provider_cleanup(op,teacher,course_a,student,gen_a)->>'status'<>'provider_pending' then
    raise exception 'Paused status unreadable'; end if;
  if not exists(select 1 from public.classroom_enrollments where id=gen_b)
    or not exists(select 1 from public.classroom_enrollments where id=gen_peer)
    or not exists(select 1 from public.users where id=student) then raise exception 'Collateral membership/account loss'; end if;

  -- Clock-independent health fixture: seed an already-aged prerequisite without
  -- weakening the production trigger that makes reserved operations immutable.
  baseline_health:=public.get_student_purge_health_snapshot();
  begin
  other_id:=gen_random_uuid(); owner_id:=gen_random_uuid();
  insert into private.pal_membership_generations(generation_id,scope_digest,state)
    values(owner_id,private.pal_membership_scope(course_b,peer),'removed');
  insert into private.student_provider_cleanup_bindings(operation_id,generation_id,scope_digest,pal_reference,
    pal_origin,pal_integration_id,bara_origin,installation_ref,roster_ref,participant_ref,actor_principal_ref)
    select other_id,owner_id,scope_digest,pal_reference,'https://pal.example.invalid',
      'c1710000-0000-4000-8000-000000000050','https://bara.example.invalid','pika_synthetic_171',
      saved->>'roster_ref','participant_'||replace(owner_id::text,'-',''),saved->>'actor_principal_ref'
    from private.pal_membership_generations where generation_id=owner_id;
  insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_binding_sha256,
    request_sha256,status,source_revision,started_at,updated_at)
    values(other_id,teacher,course_b,peer,repeat('a',64),repeat('b',64),'provider_pending',1,
      clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours');
  result:=public.get_student_purge_health_snapshot();
  if (result->>'active_count')::integer<>(baseline_health->>'active_count')::integer+1
    or result->>'stuck_count' is distinct from baseline_health->>'stuck_count' then
    raise exception 'Aged provider prerequisite degraded ordinary cleanup health'; end if;
  raise exception using errcode='P1711',message='rollback synthetic aged prerequisite';
  exception when sqlstate 'P1711' then null;
  end;
  foreach f in array array['inventorying','deleting_objects','finalizing'] loop
    begin
      insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_binding_sha256,
        request_sha256,status,source_revision,started_at,updated_at)
        values(gen_random_uuid(),teacher,course_b,peer,repeat('c',64),repeat('d',64),f,1,
          clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours');
      result:=public.get_student_purge_health_snapshot();
      if (result->>'stuck_count')::integer<>(baseline_health->>'stuck_count')::integer+1 then
        raise exception 'Aged legacy % no longer degrades cleanup health',f; end if;
      raise exception using errcode='P1711',message='rollback synthetic legacy health operation';
    exception when sqlstate 'P1711' then null;
    end;
  end loop;
end $$;
rollback;
