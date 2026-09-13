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
  ref_a text; ref_b text; result jsonb; saved jsonb; receipt jsonb; other_id uuid;
  f text; row_before jsonb; probe public.student_purge_operations;
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
  if ref_a=ref_b then raise exception 'Cross-course generation collision'; end if;
  begin
    perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
    raise exception 'Active enrollment reserved';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_provider_removed_generation_required' then raise; end if;
  end;
  perform public.remove_classroom_students_preserving_data(teacher,course_a,array['c1710000-0000-4000-8000-000000000030'::uuid]);
  if not private.attendance_participant_generation_closed(ref_a) or private.attendance_participant_generation_closed(ref_b) then
    raise exception 'Removal generation fence failed'; end if;
  if exists(select 1 from jsonb_array_elements(public.attendance_roster_source_document_v1(course_a)->'participants') p
    where p->>'participant_ref'=ref_a) then raise exception 'Closed ref remains in source snapshot'; end if;
  if public.resolve_attendance_scan_generation(course_a,student)->>'status'<>'forbidden'
    or public.resolve_attendance_scan_generation(course_b,student)->>'status'<>'active' then
    raise exception 'Student scan generation isolation failed'; end if;
  saved:=public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
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
end $$;
rollback;
