-- Synthetic transaction only. Requires separately approved local migration173.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
do $$ begin
  if to_regprocedure('public.advance_removed_student_academic_cleanup(uuid,uuid,uuid,uuid,uuid,text,integer,uuid,uuid)') is null then
    raise exception 'Migration173 is required'; end if;
  if (select enabled from private.student_provider_cleanup_settings where singleton) then
    raise exception 'Fixture requires disabled provider cleanup'; end if;
end $$;
insert into public.users(id,email,role,workos_user_id) values
('c1730000-0000-4000-8000-000000000001','teacher-173@example.invalid','teacher','user_173_teacher'),
('c1730000-0000-4000-8000-000000000002','student-173@example.invalid','student','user_173_student'),
('c1730000-0000-4000-8000-000000000003','peer-173@example.invalid','student','user_173_peer');
insert into public.student_profiles(user_id,first_name,last_name) values
('c1730000-0000-4000-8000-000000000002','Synthetic','Target'),
('c1730000-0000-4000-8000-000000000003','Synthetic','Peer');
insert into public.classrooms(id,teacher_id,title,class_code) values
('c1730000-0000-4000-8000-000000000010','c1730000-0000-4000-8000-000000000001','Provider A','C173A'),
('c1730000-0000-4000-8000-000000000011','c1730000-0000-4000-8000-000000000001','Provider B','C173B');
insert into public.classroom_roster(id,classroom_id,email) values
('c1730000-0000-4000-8000-000000000030','c1730000-0000-4000-8000-000000000010','student-173@example.invalid'),
('c1730000-0000-4000-8000-000000000031','c1730000-0000-4000-8000-000000000011','student-173@example.invalid'),
('c1730000-0000-4000-8000-000000000032','c1730000-0000-4000-8000-000000000010','peer-173@example.invalid');

do $$
declare
  teacher uuid:='c1730000-0000-4000-8000-000000000001';
  student uuid:='c1730000-0000-4000-8000-000000000002';
  peer uuid:='c1730000-0000-4000-8000-000000000003';
  course_a uuid:='c1730000-0000-4000-8000-000000000010';
  course_b uuid:='c1730000-0000-4000-8000-000000000011';
  gen_a uuid:='c1730000-0000-4000-8000-000000000020';
  gen_b uuid:='c1730000-0000-4000-8000-000000000021';
  op uuid:='c1730000-0000-4000-8000-000000000040';
  object_id uuid:='c1730000-0000-4000-8000-000000000060';
  result jsonb; saved jsonb; claim jsonb; receipt jsonb; before_roster jsonb;
  before_peer jsonb; before_other jsonb; before_operation jsonb; wrong uuid; f text;
begin
  if has_function_privilege('anon','public.advance_removed_student_academic_cleanup(uuid,uuid,uuid,uuid,uuid,text,integer,uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.advance_removed_student_academic_cleanup(uuid,uuid,uuid,uuid,uuid,text,integer,uuid,uuid)','execute')
    or has_table_privilege('service_role','private.removed_academic_mutations','insert') then
    raise exception 'Local stage authority leaked'; end if;
  update private.student_provider_cleanup_settings set enabled=true,eligible_after=clock_timestamp()-interval '1 minute',
    pal_origin='https://pal.example.invalid',pal_integration_id='c1730000-0000-4000-8000-000000000050',
    bara_origin='https://bara.example.invalid',installation_ref='pika_synthetic_173';
  insert into public.classroom_enrollments(id,classroom_id,student_id,manual_attendance_marks) values
    (gen_a,course_a,student,'{"2026-09-11":"present"}'),(gen_b,course_b,student,'{}'),
    ('c1730000-0000-4000-8000-000000000022',course_a,peer,'{}');
  insert into public.attendance_roster_mappings(classroom_id) values(course_a),(course_b);
  insert into public.attendance_principal_mappings(user_id) values(teacher),(student),(peer);
  insert into public.attendance_participant_mappings(classroom_id,student_id) values(course_a,student),(course_b,student),(course_a,peer);
  insert into public.assignments(id,classroom_id,title,due_at,created_by) values
    ('c1730000-0000-4000-8000-000000000070',course_a,'Shared assignment',clock_timestamp()+interval '1 day',teacher);
  insert into public.assignment_docs(id,assignment_id,student_id,content) values
    ('c1730000-0000-4000-8000-000000000071','c1730000-0000-4000-8000-000000000070',student,'{"type":"doc","content":[]}'),
    ('c1730000-0000-4000-8000-000000000072','c1730000-0000-4000-8000-000000000070',peer,'{"type":"doc","content":[]}');
  insert into public.assignment_doc_history(assignment_doc_id,snapshot,trigger,word_count,char_count) values
    ('c1730000-0000-4000-8000-000000000071','{"type":"doc","content":[]}','autosave',0,0);
  insert into public.entries(student_id,classroom_id,date,text,on_time) values
    (student,course_a,'2026-09-11','target',true),(peer,course_a,'2026-09-11','peer',true),
    (student,course_b,'2026-09-11','other class',true);
  insert into public.gradebook_score_overrides(classroom_id,student_id,assessment_type,assessment_id,earned,created_by)
    values(course_a,student,'assignment','c1730000-0000-4000-8000-000000000070',80,teacher);
  insert into public.gradebook_items(id,classroom_id,title,points_possible,created_by) values
    ('c1730000-0000-4000-8000-000000000073',course_a,'Shared grade',100,teacher);
  insert into public.gradebook_item_scores(classroom_id,item_id,student_id,earned)
    values(course_a,'c1730000-0000-4000-8000-000000000073',student,75);
  perform public.begin_managed_storage_upload(object_id,'submission-images','fixture173/target.png',course_a,
    null,null,'student_inline_image',student,student,'fixture',null,'image/png',1);
  insert into storage.objects(bucket_id,name) values('submission-images','fixture173/target.png');
  perform public.verify_managed_storage_upload(object_id,repeat('a',64));
  perform public.managed_storage_mark_ready(object_id);
  -- Enforcement changes and all fixtures are confined to this rollback transaction.
  update public.managed_storage_settings set mode='enforced' where singleton;
  perform public.remove_classroom_students_preserving_data(teacher,course_a,array['c1730000-0000-4000-8000-000000000030'::uuid]);
  saved:=public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
  select to_jsonb(roster) into before_roster from public.classroom_roster roster where id='c1730000-0000-4000-8000-000000000030';
  select to_jsonb(doc) into before_peer from public.assignment_docs doc where id='c1730000-0000-4000-8000-000000000072';
  select to_jsonb(entry) into before_other from public.entries entry where classroom_id=course_b and student_id=student;
  select to_jsonb(operation) into before_operation from public.student_purge_operations operation where id=op;
  begin
    perform public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'inventory');
    raise exception 'Independent gate was bypassed';
  exception when sqlstate '55000' then if sqlerrm<>'academic_cleanup_disabled' then raise; end if; end;
  update private.removed_student_academic_settings set enabled=true where singleton;
  result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'inventory');
  if not (result->'blockers' ? 'provider_completion_required') then raise exception 'Unknown provider did not block'; end if;
  if (select count(*) from public.student_purge_resources where operation_id=op)<6 then raise exception 'Incomplete retained inventory'; end if;
  if result<>public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'inventory') then
    raise exception 'Inventory retry changed receipt'; end if;
  result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
  if result->'object'<>'null'::jsonb then raise exception 'Unknown provider allowed claim'; end if;
  foreach f in array array['teacher','classroom','student','generation'] loop
    begin
      perform public.advance_removed_student_academic_cleanup(op,
        case when f='teacher' then peer else teacher end,case when f='classroom' then course_b else course_a end,
        case when f='student' then peer else student end,case when f='generation' then gen_b else gen_a end,'claim');
      raise exception 'Wrong tuple accepted: %',f;
    exception when sqlstate '42501' or sqlstate '55000' then null; end;
  end loop;
  begin
    insert into public.classroom_enrollments(classroom_id,student_id) values(course_a,student);
    raise exception 'Readd accepted';
  exception when sqlstate '55000' then null; end;
  begin
    update public.assignment_docs set content='{"type":"doc","content":[]}' where id='c1730000-0000-4000-8000-000000000071';
    raise exception 'Fenced target write accepted';
  exception when sqlstate '55000' then null; end;
  begin
    update public.assignments set classroom_id=course_b where id='c1730000-0000-4000-8000-000000000070';
    raise exception 'Parent move accepted';
  exception when sqlstate '55000' then null; end;
  begin
    insert into public.managed_storage_provisional_owners(owner_kind,target_classroom_id,operation_id,created_by_user_id,expires_at)
      values('restore_copy',course_a,gen_random_uuid(),teacher,clock_timestamp()+interval '1 day');
    raise exception 'Restore intent accepted';
  exception when sqlstate '55000' then null; end;
  -- Source drift is intentionally injected using the old superuser-only fixture
  -- bypass, then rolled back. It never authorizes local deletion.
  begin
    perform set_config('pika.student_purge_finalize','on',true);
    update public.entries set text='drift' where classroom_id=course_a and student_id=student;
    perform set_config('pika.student_purge_finalize','off',true);
    begin
      perform public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
      raise exception 'Inventory drift accepted';
    exception when sqlstate '40001' then if sqlerrm<>'academic_cleanup_inventory_drift' then raise; end if; end;
    raise exception using errcode='P1731',message='rollback drift';
  exception when sqlstate 'P1731' then null; end;
  -- Synthetic saved receipts exercise dormant code; never hosted provider proof.
  receipt:=jsonb_build_object('schema_version',1,'operation_id',op,'learner_id',saved->>'pal_reference',
    'status','completed','begun_at','2026-09-13T15:00:00Z','completed_at','2026-09-13T15:01:00Z');
  perform public.record_student_provider_cleanup_receipt(op,teacher,course_a,student,gen_a,'pal',receipt);
  receipt:=jsonb_build_object('schema_version',1,'ok',true,'installation_ref',saved->>'installation_ref',
    'roster_ref',saved->>'roster_ref','participant_ref',saved->>'participant_ref',
    'operation_ref','erase_participant_'||replace(op::text,'-',''),'state','deleted','absence_verified',true,'deleted_count',0);
  perform public.record_student_provider_cleanup_receipt(op,teacher,course_a,student,gen_a,'bara',receipt);
  claim:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
  if claim->'object'='null'::jsonb then raise exception 'No-copy claim missing: %',claim->'blockers'; end if;
  begin
    perform public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'acknowledge',1,
      (claim->'object'->>'id')::uuid,gen_random_uuid());
    raise exception 'Stale callback accepted';
  exception when sqlstate '55000' then if sqlerrm<>'academic_cleanup_lease_lost' then raise; end if; end;
  begin
    perform public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'acknowledge',1,
      (claim->'object'->>'id')::uuid,(claim->'object'->>'lease_token')::uuid);
    raise exception 'Present object acknowledged';
  exception when sqlstate '55000' then if sqlerrm<>'academic_cleanup_object_still_present' then raise; end if; end;
  -- Metadata deletion models SQL storage authorization only, not a live byte erase.
  delete from storage.objects where bucket_id='submission-images' and name='fixture173/target.png';
  result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'acknowledge',1,
    (claim->'object'->>'id')::uuid,(claim->'object'->>'lease_token')::uuid);
  if result<>public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'acknowledge',1,
    (claim->'object'->>'id')::uuid,(claim->'object'->>'lease_token')::uuid) then raise exception 'Lost ack replay changed evidence'; end if;
  result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
  if result->>'local_status'<>'local_completed' or result->>'overall_status'<>'provider_pending' then
    raise exception 'Wrong local completion'; end if;
  if result<>public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim') then
    raise exception 'Completion replay changed evidence'; end if;
  if exists(select 1 from private.removed_academic_resources(course_a,student))
    or exists(select 1 from private.removed_academic_objects(course_a,student)) then raise exception 'Target rows remain'; end if;
  if before_roster-'retained_manual_attendance_marks' is distinct from
    (select to_jsonb(roster)-'retained_manual_attendance_marks' from public.classroom_roster roster where id='c1730000-0000-4000-8000-000000000030') then
    raise exception 'Tombstone identity/control drift'; end if;
  if before_peer is distinct from (select to_jsonb(doc) from public.assignment_docs doc where id='c1730000-0000-4000-8000-000000000072')
    or before_other is distinct from (select to_jsonb(entry) from public.entries entry where classroom_id=course_b and student_id=student) then
    raise exception 'Classmate or other class changed'; end if;
  if before_operation-'local_academic_cleanup' is distinct from
    (select to_jsonb(operation)-'local_academic_cleanup' from public.student_purge_operations operation where id=op)
    or not exists(select 1 from public.users where id=student)
    or not exists(select 1 from public.student_profiles where user_id=student)
    or not exists(select 1 from public.student_purge_fences where operation_id=op)
    or exists(select 1 from private.removed_academic_mutations) then raise exception 'Overall/fence/account/capability drift'; end if;
  begin
    insert into storage.objects(bucket_id,name) values('submission-images','fixture173/target.png');
    raise exception 'Late upload accepted';
  exception when sqlstate '55000' then null; end;
  foreach f in array array['claim_student_purge_object','finalize_student_purge','finalize_student_purge_without_attendance_v1'] loop
    begin
      execute format('select public.%I($1,$2)',f) into result using op,teacher;
      if coalesce((result->>'ok')::boolean,false) then raise exception 'Legacy path released local stage'; end if;
    exception when sqlstate '55000' then null; end;
  end loop;
end $$;
rollback;
