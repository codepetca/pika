-- Synthetic transaction only. Requires migrations173–175 and 179.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
do $$ begin
  if to_regprocedure('public.advance_removed_student_academic_cleanup(uuid,uuid,uuid,uuid,uuid,text,integer,uuid,uuid)') is null then
    raise exception 'Migration173 is required'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.assignment_repo_review_runs'::regclass
    and tgname='student_purge_indirect_guard_assignment_repo_review_runs' and not tgisinternal) then
    raise exception 'Migration174 is required'; end if;
  if obj_description('private.enqueue_removed_student_cleanup()'::regprocedure)
      not like '%repairs missing attendance generation evidence%' then
    raise exception 'Migration179 is required';
  end if;
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
  subject uuid; resource record; actual jsonb; expected_tables text[]:=array[
'announcement_reads','assignment_doc_history','assignment_doc_save_operations','assignment_submission_artifacts','assignment_docs','assignment_feedback_entries','entries','report_card_rows','survey_responses','test_attempt_history','test_attempts','test_focus_events','test_responses','test_student_availability','log_summaries','developer_feedback_candidates','gradebook_score_overrides','gradebook_item_scores','retained_manual_attendance_marks','managed_storage_json_references','attendance_check_in_facts','attendance_record_projection','attendance_status_overrides','attendance_status_override_events'];
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
  insert into public.assignments(id,classroom_id,title,due_at,created_by) values
    ('c1730000-0000-4000-8000-000000000074',course_b,'Other class assignment',clock_timestamp()+interval '1 day',teacher);
  insert into public.assignment_repo_review_runs(id,assignment_id,triggered_by,status)
    values('c1730000-0000-4000-8000-000000000098','c1730000-0000-4000-8000-000000000074',teacher,'completed');
  insert into public.assignment_docs(id,assignment_id,student_id,content) values
    ('c1730000-0000-4000-8000-000000000071','c1730000-0000-4000-8000-000000000070',student,'{"type":"doc","content":[]}'),
    ('c1730000-0000-4000-8000-000000000072','c1730000-0000-4000-8000-000000000070',peer,'{"type":"doc","content":[]}');
  insert into public.assignment_doc_history(assignment_doc_id,snapshot,trigger,word_count,char_count) values
    ('c1730000-0000-4000-8000-000000000071','{"type":"doc","content":[]}','autosave',0,0);
  insert into public.assignments(id,classroom_id,title,due_at,created_by) values
    ('c1730000-0000-4000-8000-000000000075',course_a,'Submitted assignment',
      clock_timestamp()+interval '1 day',teacher);
  insert into public.assignment_docs(id,assignment_id,student_id,content,is_submitted,submitted_at) values
    ('c1730000-0000-4000-8000-000000000076','c1730000-0000-4000-8000-000000000075',student,
      '{"type":"doc","content":[]}',true,clock_timestamp());
  insert into public.assignment_doc_history(id,assignment_doc_id,snapshot,trigger,word_count,char_count) values
    ('c1730000-0000-4000-8000-000000000078','c1730000-0000-4000-8000-000000000076',
      '{"type":"doc","content":[]}','submit',0,0);
  insert into public.entries(student_id,classroom_id,date,text,on_time) values
    (student,course_a,'2026-09-11','target',true),(peer,course_a,'2026-09-11','peer',true),
    (student,course_b,'2026-09-11','other class',true);
  insert into public.attendance_occurrence_mappings(
    classroom_id,class_date,occurrence_ref)
    values(course_a,'2026-09-11','occurrence_'||repeat('1',32));
  insert into public.log_summaries(classroom_id,date,model)
    values(course_a,'2026-09-11','fixture');
  insert into public.developer_feedback_candidates(
    dedupe_key,title,original_request,refined_request,source_keys)
    values('fixture173','fixture','fixture','fixture',array[course_a::text||':2026-09-11']);
  insert into public.attendance_override_requests(
    request_id,classroom_id,request_fingerprint,result)
    values('c1730000-0000-4000-8000-000000000077',course_a,repeat('a',32),
      jsonb_build_object('outcome','applied','occurrence_ref','occurrence_'||repeat('1',32),
        'applied_count',1,'unchanged_count',0));
  insert into public.gradebook_score_overrides(classroom_id,student_id,assessment_type,assessment_id,earned,created_by)
    values(course_a,student,'assignment','c1730000-0000-4000-8000-000000000070',80,teacher);
  insert into public.gradebook_items(id,classroom_id,title,points_possible,created_by) values
    ('c1730000-0000-4000-8000-000000000073',course_a,'Shared grade',100,teacher);
  insert into public.gradebook_item_scores(classroom_id,item_id,student_id,earned)
    values(course_a,'c1730000-0000-4000-8000-000000000073',student,75);
insert into public.announcements (id, classroom_id, content, created_by) values (
  'c1730000-0000-4000-8000-000000000030',
  'c1730000-0000-4000-8000-000000000010', 'fixture',
  'c1730000-0000-4000-8000-000000000001'
);
insert into public.announcement_reads (id, announcement_id, user_id) values
  ('c1730000-0000-4000-8000-000000000031', 'c1730000-0000-4000-8000-000000000030', 'c1730000-0000-4000-8000-000000000002'),
  ('c1730000-0000-4000-8000-000000000032', 'c1730000-0000-4000-8000-000000000030', 'c1730000-0000-4000-8000-000000000003');

insert into public.assignments (id, classroom_id, title, due_at, created_by) values (
  'c1730000-0000-4000-8000-000000000040',
  'c1730000-0000-4000-8000-000000000010', 'Shared assignment',
  clock_timestamp() + interval '1 day', 'c1730000-0000-4000-8000-000000000001'
);
insert into public.assignment_docs (id, assignment_id, student_id, content) values
  ('c1730000-0000-4000-8000-000000000041', 'c1730000-0000-4000-8000-000000000040', 'c1730000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}'::jsonb),
  ('c1730000-0000-4000-8000-000000000042', 'c1730000-0000-4000-8000-000000000040', 'c1730000-0000-4000-8000-000000000003', '{"type":"doc","content":[]}'::jsonb);
insert into public.assignment_doc_history (
  id, assignment_doc_id, snapshot, trigger, word_count, char_count
) values (
  'c1730000-0000-4000-8000-000000000043',
  'c1730000-0000-4000-8000-000000000041', '{"type":"doc","content":[]}'::jsonb,
  'autosave', 0, 0
);
insert into public.assignment_doc_save_operations (
  id, assignment_doc_id, save_session_id, save_sequence, metric_session_id,
  paste_word_count, keystroke_count, content_sha256, document_updated_at
) values (
  'c1730000-0000-4000-8000-000000000044',
  'c1730000-0000-4000-8000-000000000041',
  'c1730000-0000-4000-8000-000000000045', 1,
  'c1730000-0000-4000-8000-000000000046', 0, 1, repeat('c', 64), clock_timestamp()
);
insert into public.assignment_feedback_entries (
  id, assignment_id, student_id, author_type, entry_kind, body, created_by
) values (
  'c1730000-0000-4000-8000-000000000047',
  'c1730000-0000-4000-8000-000000000040',
  'c1730000-0000-4000-8000-000000000002', 'teacher', 'teacher_feedback', 'target feedback',
  'c1730000-0000-4000-8000-000000000001'
);
insert into public.tests (id, classroom_id, title, status, created_by) values (
  'c1730000-0000-4000-8000-000000000050',
  'c1730000-0000-4000-8000-000000000010', 'Shared test', 'closed',
  'c1730000-0000-4000-8000-000000000001'
);
insert into public.test_questions (id, test_id, question_type, question_text) values (
  'c1730000-0000-4000-8000-000000000051',
  'c1730000-0000-4000-8000-000000000050', 'open_response', 'Explain'
);
insert into public.test_attempts (id, test_id, student_id, responses, is_submitted, submitted_at) values
  ('c1730000-0000-4000-8000-000000000052', 'c1730000-0000-4000-8000-000000000050', 'c1730000-0000-4000-8000-000000000002', '{}', true, clock_timestamp()),
  ('c1730000-0000-4000-8000-000000000053', 'c1730000-0000-4000-8000-000000000050', 'c1730000-0000-4000-8000-000000000003', '{}', true, clock_timestamp());
insert into public.test_attempt_history (id, test_attempt_id, snapshot, trigger) values (
  'c1730000-0000-4000-8000-000000000054',
  'c1730000-0000-4000-8000-000000000052', '{}', 'submit'
);
insert into public.test_responses (
  id, test_id, question_id, student_id, response_text, revision
) values
  ('c1730000-0000-4000-8000-000000000055', 'c1730000-0000-4000-8000-000000000050', 'c1730000-0000-4000-8000-000000000051', 'c1730000-0000-4000-8000-000000000002', 'target response', 1),
  ('c1730000-0000-4000-8000-000000000056', 'c1730000-0000-4000-8000-000000000050', 'c1730000-0000-4000-8000-000000000051', 'c1730000-0000-4000-8000-000000000003', 'classmate response', 1);
insert into public.test_focus_events (id, test_id, student_id, session_id, event_type) values (
  'c1730000-0000-4000-8000-000000000057',
  'c1730000-0000-4000-8000-000000000050',
  'c1730000-0000-4000-8000-000000000002',
  'c1730000-0000-4000-8000-000000000058', 'away_start'
);
insert into public.test_student_availability (id, test_id, student_id, state, updated_by) values (
  'c1730000-0000-4000-8000-000000000059',
  'c1730000-0000-4000-8000-000000000050',
  'c1730000-0000-4000-8000-000000000002', 'closed',
  'c1730000-0000-4000-8000-000000000001'
);
insert into public.surveys (id, classroom_id, title, position, created_by) values (
  'c1730000-0000-4000-8000-000000000060',
  'c1730000-0000-4000-8000-000000000010', 'Shared survey', 0,
  'c1730000-0000-4000-8000-000000000001'
);
insert into public.survey_questions (id, survey_id, question_type, question_text) values (
  'c1730000-0000-4000-8000-000000000061',
  'c1730000-0000-4000-8000-000000000060', 'short_text', 'Reflection'
);
insert into public.survey_responses (id, survey_id, question_id, student_id, response_text) values
  ('c1730000-0000-4000-8000-000000000062', 'c1730000-0000-4000-8000-000000000060', 'c1730000-0000-4000-8000-000000000061', 'c1730000-0000-4000-8000-000000000002', 'target survey'),
  ('c1730000-0000-4000-8000-000000000063', 'c1730000-0000-4000-8000-000000000060', 'c1730000-0000-4000-8000-000000000061', 'c1730000-0000-4000-8000-000000000003', 'classmate survey');
insert into public.report_cards (id, classroom_id, term, created_by) values (
  'c1730000-0000-4000-8000-000000000070',
  'c1730000-0000-4000-8000-000000000010', 'final',
  'c1730000-0000-4000-8000-000000000001'
);
insert into public.report_card_rows (id, report_card_id, student_id, final_percent) values
  ('c1730000-0000-4000-8000-000000000071', 'c1730000-0000-4000-8000-000000000070', 'c1730000-0000-4000-8000-000000000002', 80),
  ('c1730000-0000-4000-8000-000000000072', 'c1730000-0000-4000-8000-000000000070', 'c1730000-0000-4000-8000-000000000003', 90);

  -- Every exact attendance family has target, classmate and other-class evidence.
  insert into public.attendance_check_in_facts(classroom_id,student_id,installation_ref,roster_ref,
    occurrence_ref,participant_ref,check_in_ref,check_in_revision,accepted_at)
    select mapping.classroom_id,mapping.student_id,'pika_synthetic_173',roster.roster_ref,
      'occurrence_173',mapping.participant_ref,'check_173_'||replace(mapping.classroom_id::text,'-','')||'_'||replace(mapping.student_id::text,'-',''),1,clock_timestamp()
    from public.attendance_participant_mappings mapping join public.attendance_roster_mappings roster using(classroom_id)
    where mapping.classroom_id in(course_a,course_b);
  insert into public.attendance_record_projection(classroom_id,student_id,installation_ref,roster_ref,
    occurrence_ref,participant_ref,record_revision,status,source,actor_type,last_event_id,last_event_at)
    select classroom_id,student_id,installation_ref,roster_ref,occurrence_ref,participant_ref,1,
      'present','student_qr','student',check_in_ref,accepted_at from public.attendance_check_in_facts
    where classroom_id in(course_a,course_b);
  insert into public.attendance_status_overrides(classroom_id,student_id,occurrence_ref,status,active,updated_by)
    select classroom_id,student_id,occurrence_ref,'present',true,teacher from public.attendance_check_in_facts
    where classroom_id in(course_a,course_b);
  insert into public.attendance_status_override_events(override_id,request_id,classroom_id,student_id,
    occurrence_ref,revision,action,status,actor_user_id)
    select id,gen_random_uuid(),classroom_id,student_id,occurrence_ref,1,'set','present',teacher
    from public.attendance_status_overrides where classroom_id in(course_a,course_b);

  perform public.begin_managed_storage_upload(object_id,'submission-images','fixture173/target.png',course_a,
    null,null,'student_inline_image',student,student,'assignment_doc','c1730000-0000-4000-8000-000000000071','image/png',1);
  insert into storage.objects(bucket_id,name) values('submission-images','fixture173/target.png');
  perform public.verify_managed_storage_upload(object_id,repeat('a',64));
  perform public.managed_storage_mark_ready(object_id);

  update public.assignment_docs set content=jsonb_build_object('type','doc','content',jsonb_build_array(
    jsonb_build_object('type','image','attrs',jsonb_build_object('src',
      'https://fixture.example.invalid/storage/v1/object/public/submission-images/fixture173/target.png',
      'managed_object_id',object_id)))) where id='c1730000-0000-4000-8000-000000000071';
  insert into public.assignment_doc_history(assignment_doc_id,snapshot,trigger,word_count,char_count)
    select id,content,'autosave',0,0 from public.assignment_docs where id='c1730000-0000-4000-8000-000000000071';
  insert into public.assignment_submission_requirements(id,assignment_id,type,label)
    values('c1730000-0000-4000-8000-000000000080','c1730000-0000-4000-8000-000000000070','image','Synthetic image');
  perform public.begin_managed_storage_upload('c1730000-0000-4000-8000-000000000081',
    'assignment-artifacts','fixture173/artifact.png',course_a,null,null,'student_assignment_artifact',
    student,student,'assignment_doc','c1730000-0000-4000-8000-000000000071','image/png',1);
  insert into storage.objects(bucket_id,name) values('assignment-artifacts','fixture173/artifact.png');
  perform public.verify_managed_storage_upload('c1730000-0000-4000-8000-000000000081',repeat('b',64));
  perform public.managed_storage_mark_ready('c1730000-0000-4000-8000-000000000081');
  insert into public.assignment_submission_artifacts(assignment_doc_id,requirement_id,student_id,type,storage_path,managed_object_id)
    values('c1730000-0000-4000-8000-000000000071','c1730000-0000-4000-8000-000000000080',student,
      'image','fixture173/artifact.png','c1730000-0000-4000-8000-000000000081');

  -- Simulated readiness satisfies the settings constraint only inside this
  -- rollback transaction; it is not live enforcement-readiness evidence.
  update public.managed_storage_settings set mode='enforced',activated_at=clock_timestamp(),
    readiness_verified_at=clock_timestamp(),readiness_digest=repeat('e',64) where singleton;
  -- Blocked fixture: assignment_remote; subtransaction restores the active baseline.
  begin
insert into public.assignment_ai_grading_runs (
  id, assignment_id, status, triggered_by, selection_hash,
  requested_student_ids_json, requested_count, gradable_count, processed_count, completed_count
) values (
  'c1730000-0000-4000-8000-000000000048',
  'c1730000-0000-4000-8000-000000000040', 'completed',
  'c1730000-0000-4000-8000-000000000001', 'student-purge-shared-assignment',
  '["c1730000-0000-4000-8000-000000000002","c1730000-0000-4000-8000-000000000003"]'::jsonb,
  2, 2, 2, 2
);
insert into public.assignment_ai_grading_run_items (
  id, run_id, assignment_id, student_id, assignment_doc_id, queue_position, status, completed_at
) values
  ('c1730000-0000-4000-8000-000000000049', 'c1730000-0000-4000-8000-000000000048', 'c1730000-0000-4000-8000-000000000040', 'c1730000-0000-4000-8000-000000000002', 'c1730000-0000-4000-8000-000000000041', 0, 'completed', clock_timestamp()),
  ('c1730000-0000-4000-8000-00000000004a', 'c1730000-0000-4000-8000-000000000048', 'c1730000-0000-4000-8000-000000000040', 'c1730000-0000-4000-8000-000000000003', 'c1730000-0000-4000-8000-000000000042', 1, 'completed', clock_timestamp());


    perform public.remove_classroom_students_preserving_data(teacher,course_a,array['c1730000-0000-4000-8000-000000000030'::uuid]);
    perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
    update private.removed_student_academic_settings set enabled=true where singleton;
    result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'inventory');
    if not (result->'blockers' ? 'remote_grading_policy_required') then raise exception 'Missing assignment_remote blocker'; end if;
    if not exists(select 1 from public.student_purge_resources where operation_id=op and table_name='assignment_ai_grading_run_items') then raise exception 'Missing blocked inventory assignment_ai_grading_run_items'; end if;
    if not exists(select 1 from public.student_purge_resources where operation_id=op and table_name='assignment_ai_grading_runs') then raise exception 'Missing blocked inventory assignment_ai_grading_runs'; end if;
    for resource in select * from public.student_purge_resources where operation_id=op loop
      if private.removed_academic_row_hash(resource.table_name,resource.row_id) is distinct from resource.row_sha256 then
        raise exception 'Blocked inventory altered a row'; end if;
    end loop;
    result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
    if result->'object'<>'null'::jsonb or result->>'local_status'='local_completed' then raise exception 'Blocked case allowed deletion'; end if;
    raise exception using errcode='P1731',message='rollback blocked case';
  exception when sqlstate 'P1731' then null; end;

  -- Blocked fixture: test_remote; subtransaction restores the active baseline.
  begin
insert into public.test_ai_grading_runs (
  id, test_id, status, triggered_by, selection_hash, requested_student_ids_json,
  requested_count, eligible_student_count, queued_response_count, processed_count, completed_count
) values (
  'c1730000-0000-4000-8000-00000000005a',
  'c1730000-0000-4000-8000-000000000050', 'completed',
  'c1730000-0000-4000-8000-000000000001', 'student-purge-shared-test',
  '["c1730000-0000-4000-8000-000000000002","c1730000-0000-4000-8000-000000000003"]'::jsonb,
  2, 2, 2, 2, 2
);
insert into public.test_ai_grading_run_items (
  id, run_id, test_id, student_id, question_id, response_id, response_revision,
  queue_position, status, completed_at
) values
  ('c1730000-0000-4000-8000-00000000005b', 'c1730000-0000-4000-8000-00000000005a', 'c1730000-0000-4000-8000-000000000050', 'c1730000-0000-4000-8000-000000000002', 'c1730000-0000-4000-8000-000000000051', 'c1730000-0000-4000-8000-000000000055', 1, 0, 'completed', clock_timestamp()),
  ('c1730000-0000-4000-8000-00000000005c', 'c1730000-0000-4000-8000-00000000005a', 'c1730000-0000-4000-8000-000000000050', 'c1730000-0000-4000-8000-000000000003', 'c1730000-0000-4000-8000-000000000051', 'c1730000-0000-4000-8000-000000000056', 1, 1, 'completed', clock_timestamp());


    perform public.remove_classroom_students_preserving_data(teacher,course_a,array['c1730000-0000-4000-8000-000000000030'::uuid]);
    perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
    update private.removed_student_academic_settings set enabled=true where singleton;
    result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'inventory');
    if not (result->'blockers' ? 'remote_grading_policy_required') then raise exception 'Missing test_remote blocker'; end if;
    if not exists(select 1 from public.student_purge_resources where operation_id=op and table_name='test_ai_grading_run_items') then raise exception 'Missing blocked inventory test_ai_grading_run_items'; end if;
    if not exists(select 1 from public.student_purge_resources where operation_id=op and table_name='test_ai_grading_runs') then raise exception 'Missing blocked inventory test_ai_grading_runs'; end if;
    for resource in select * from public.student_purge_resources where operation_id=op loop
      if private.removed_academic_row_hash(resource.table_name,resource.row_id) is distinct from resource.row_sha256 then
        raise exception 'Blocked inventory altered a row'; end if;
    end loop;
    result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
    if result->'object'<>'null'::jsonb or result->>'local_status'='local_completed' then raise exception 'Blocked case allowed deletion'; end if;
    raise exception using errcode='P1731',message='rollback blocked case';
  exception when sqlstate 'P1731' then null; end;

  -- Blocked fixture: repo_remote; subtransaction restores the active baseline.
  begin
insert into public.assignment_repo_review_runs(id,assignment_id,triggered_by,status) values
('c1730000-0000-4000-8000-000000000090','c1730000-0000-4000-8000-000000000040',teacher,'completed');
insert into public.assignment_repo_review_results(run_id,assignment_id,student_id) values
('c1730000-0000-4000-8000-000000000090','c1730000-0000-4000-8000-000000000040',student);
insert into public.assignment_repo_targets(assignment_id,student_id) values('c1730000-0000-4000-8000-000000000040',student);

    perform public.remove_classroom_students_preserving_data(teacher,course_a,array['c1730000-0000-4000-8000-000000000030'::uuid]);
    perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
    update private.removed_student_academic_settings set enabled=true where singleton;
    result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'inventory');
    if not (result->'blockers' ? 'remote_grading_policy_required') then raise exception 'Missing repo_remote blocker'; end if;
    begin
      update public.assignment_repo_review_runs set assignment_id='c1730000-0000-4000-8000-000000000074'
        where id='c1730000-0000-4000-8000-000000000090';
      raise exception 'Repo run moved out of fenced classroom';
    exception when sqlstate '55000' then
      if sqlerrm<>'student_purge_active' then raise; end if;
    end;

    if not exists(select 1 from public.student_purge_resources where operation_id=op and table_name='assignment_repo_review_results') then raise exception 'Missing blocked inventory assignment_repo_review_results'; end if;
    if not exists(select 1 from public.student_purge_resources where operation_id=op and table_name='assignment_repo_targets') then raise exception 'Missing blocked inventory assignment_repo_targets'; end if;
    for resource in select * from public.student_purge_resources where operation_id=op loop
      if private.removed_academic_row_hash(resource.table_name,resource.row_id) is distinct from resource.row_sha256 then
        raise exception 'Blocked inventory altered a row'; end if;
    end loop;
    result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
    if result->'object'<>'null'::jsonb or result->>'local_status'='local_completed' then raise exception 'Blocked case allowed deletion'; end if;
    raise exception using errcode='P1731',message='rollback blocked case';
  exception when sqlstate 'P1731' then null; end;

  -- Legacy or malformed request receipts must retain the shared-data blocker.
  execute 'alter table public.attendance_override_requests disable trigger guard_attendance_override_request_cleanup';
  foreach f in array array['extra_key','nested_ref','invalid_count','malformed_fingerprint'] loop
    begin
      insert into public.attendance_override_requests(
        request_id,classroom_id,request_fingerprint,result)
      values(gen_random_uuid(),course_a,
        case when f='malformed_fingerprint' then 'not-an-md5' else repeat('b',32) end,
        case f
          when 'extra_key' then jsonb_build_object(
            'outcome','applied','occurrence_ref','occurrence_'||repeat('1',32),
            'applied_count',1,'unchanged_count',0,'student_id',student)
          when 'nested_ref' then jsonb_build_object(
            'outcome','applied','occurrence_ref','occurrence_'||repeat('1',32),
            'applied_count',1,'unchanged_count',0,
            'metadata',jsonb_build_object('participant_ref','participant_unknown'))
          when 'invalid_count' then jsonb_build_object(
            'outcome','applied','occurrence_ref','occurrence_'||repeat('1',32),
            'applied_count','one','unchanged_count',0)
          else jsonb_build_object(
            'outcome','applied','occurrence_ref','occurrence_'||repeat('1',32),
            'applied_count',1,'unchanged_count',0)
        end);
      perform public.remove_classroom_students_preserving_data(
        teacher,course_a,array['c1730000-0000-4000-8000-000000000030'::uuid]);
      perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
      update private.removed_student_academic_settings set enabled=true where singleton;
      result:=public.advance_removed_student_academic_cleanup(
        op,teacher,course_a,student,gen_a,'inventory');
      if not (result->'blockers' ? 'shared_attendance_request_policy_required') then
        raise exception 'Malformed attendance receipt was unblocked: %',f;
      end if;
      result:=public.advance_removed_student_academic_cleanup(
        op,teacher,course_a,student,gen_a,'claim');
      if result->'object'<>'null'::jsonb or result->>'local_status'='local_completed' then
        raise exception 'Malformed attendance receipt allowed deletion: %',f;
      end if;
      raise exception using errcode='P1731',message='rollback malformed attendance receipt';
    exception when sqlstate 'P1731' then null; end;
  end loop;
  execute 'alter table public.attendance_override_requests enable trigger guard_attendance_override_request_cleanup';

  -- Blocked fixture: unknown_file; subtransaction restores the active baseline.
  begin
update public.managed_storage_objects set resource_type='unknown' where id=object_id;
    perform public.remove_classroom_students_preserving_data(teacher,course_a,array['c1730000-0000-4000-8000-000000000030'::uuid]);
    perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
    update private.removed_student_academic_settings set enabled=true where singleton;
    result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'inventory');
    if not (result->'blockers' ? 'object_ownership_unknown') then raise exception 'Missing unknown_file blocker'; end if;
    for resource in select * from public.student_purge_resources where operation_id=op loop
      if private.removed_academic_row_hash(resource.table_name,resource.row_id) is distinct from resource.row_sha256 then
        raise exception 'Blocked inventory altered a row'; end if;
    end loop;
    result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
    if result->'object'<>'null'::jsonb or result->>'local_status'='local_completed' then raise exception 'Blocked case allowed deletion'; end if;
    raise exception using errcode='P1731',message='rollback blocked case';
  exception when sqlstate 'P1731' then null; end;

  -- Blocked fixture: shared_file; subtransaction restores the active baseline.
  begin
insert into public.managed_storage_json_references(managed_object_id,storage_bucket,storage_path,assignment_doc_id,reference_role,evidence_sha256)
values(object_id,'submission-images','fixture173/target.png','c1730000-0000-4000-8000-000000000072','content',repeat('f',64));
    perform public.remove_classroom_students_preserving_data(teacher,course_a,array['c1730000-0000-4000-8000-000000000030'::uuid]);
    perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
    update private.removed_student_academic_settings set enabled=true where singleton;
    result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'inventory');
    if not (result->'blockers' ? 'shared_object_policy_required') then raise exception 'Missing shared_file blocker'; end if;
    for resource in select * from public.student_purge_resources where operation_id=op loop
      if private.removed_academic_row_hash(resource.table_name,resource.row_id) is distinct from resource.row_sha256 then
        raise exception 'Blocked inventory altered a row'; end if;
    end loop;
    result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
    if result->'object'<>'null'::jsonb or result->>'local_status'='local_completed' then raise exception 'Blocked case allowed deletion'; end if;
    raise exception using errcode='P1731',message='rollback blocked case';
  exception when sqlstate 'P1731' then null; end;

  -- Pre-existing mixed children on both peer and other-class scopes must block.
  foreach f in array array['peer','other_class'] loop
    begin
      insert into public.attendance_status_override_events(id,override_id,request_id,classroom_id,student_id,
        occurrence_ref,revision,action,status,actor_user_id)
        select 'c1730000-0000-4000-8000-000000000099',id,gen_random_uuid(),
          case when f='peer' then course_a else course_b end,case when f='peer' then peer else student end,
          occurrence_ref,1,'set','present',teacher from public.attendance_status_overrides
        where classroom_id=course_a and student_id=student;
      actual:=to_jsonb(private.removed_academic_row_hash('attendance_status_override_events','c1730000-0000-4000-8000-000000000099'));
      perform public.remove_classroom_students_preserving_data(teacher,course_a,array['c1730000-0000-4000-8000-000000000030'::uuid]);
      perform public.reserve_student_provider_cleanup(op,teacher,course_a,student,gen_a);
      update private.removed_student_academic_settings set enabled=true where singleton;
      result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'inventory');
      if not(result->'blockers' ? 'attendance_ownership_unknown') then raise exception 'Mixed attendance link unblocked'; end if;
      result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
      if result->'object'<>'null'::jsonb or result->>'local_status'='local_completed'
        or actual is distinct from to_jsonb(private.removed_academic_row_hash('attendance_status_override_events',
          'c1730000-0000-4000-8000-000000000099')) then raise exception 'Mixed attendance child changed'; end if;
      raise exception using errcode='P1731',message='rollback mixed attendance';
    exception when sqlstate 'P1731' then null; end;
  end loop;
  create temporary table academic_preserved_rows on commit drop as
    select preserved_resource.*,private.removed_academic_row_hash(table_name,row_id) expected_hash
    from (select * from private.removed_academic_resources(course_a,peer)
      union all select * from private.removed_academic_resources(course_b,student)) preserved_resource
    where table_name not in ('log_summaries','developer_feedback_candidates');
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
  foreach f in array expected_tables loop
    if not exists(select 1 from public.student_purge_resources where operation_id=op and table_name=f
      and disposition=case when f='retained_manual_attendance_marks' then 'redact' else 'delete' end) then
      raise exception 'Missing explicit inventory/disposition: %',f; end if;
  end loop;
  if exists(select 1 from public.student_purge_resources where operation_id=op and not(table_name=any(expected_tables))) then
    raise exception 'Unclassified success resource'; end if;
  create temporary table academic_target_rows on commit drop as
    select table_name,row_id from public.student_purge_resources where operation_id=op and disposition='delete';
  if result<>public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'inventory') then
    raise exception 'Inventory retry changed receipt'; end if;
  result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
  if result->'object'<>'null'::jsonb then raise exception 'Unknown provider allowed claim'; end if;
  -- Match existing managed-storage fixtures: emulate the Storage API's SQL
  -- delete permission within this rollback transaction, leaving Pika guards live.
  perform set_config('storage.allow_delete_query','true',true);
  begin
    delete from storage.objects where bucket_id='submission-images' and name='fixture173/target.png';
    raise exception 'Storage deletion accepted without provider completion/lease';
  exception when sqlstate '55000' then
    if sqlerrm<>'academic_cleanup_storage_authority_required' then raise; end if;
  end;

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
    update public.assignments set classroom_id=course_b,gradebook_category_id=null
      where id='c1730000-0000-4000-8000-000000000070';
    raise exception 'Parent move accepted';
  exception when sqlstate '55000' then
    if sqlerrm<>'academic_cleanup_parent_fenced' then raise; end if;
  end;
  begin
    insert into public.managed_storage_provisional_owners(owner_kind,target_classroom_id,operation_id,created_by_user_id,expires_at)
      values('restore_copy',course_a,gen_random_uuid(),teacher,clock_timestamp()+interval '1 day');
    raise exception 'Restore intent accepted';
  exception when sqlstate '55000' then null; end;
  -- Attempts arriving after inventory must consult the parent's fenced scope.
  -- These are serialized mutation checks, not a committed-row MVCC race proof.
  foreach f in array array['peer','other_class'] loop
    begin
      insert into public.attendance_status_override_events(override_id,request_id,classroom_id,student_id,
        occurrence_ref,revision,action,status,actor_user_id)
        select id,gen_random_uuid(),case when f='peer' then course_a else course_b end,
          case when f='peer' then peer else student end,occurrence_ref,1,'set','present',teacher
        from public.attendance_status_overrides where classroom_id=course_a and student_id=student;
      raise exception 'Late cross-scope attendance link accepted';
    exception when sqlstate '55000' then
      if sqlerrm<>'academic_cleanup_attendance_reference_fenced' then raise; end if;
    end;
  end loop;
  -- A request may have cached student data before removal. Its later run INSERT
  -- must fail after inventory, before the route can dispatch any remote work.
  begin
    insert into public.assignment_repo_review_runs(assignment_id,triggered_by,status)
      values('c1730000-0000-4000-8000-000000000070',teacher,'running');
    raise exception 'Late repo grading run accepted after inventory';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_purge_active' then raise; end if;
  end;
  if exists(select 1 from public.assignment_repo_review_runs
    where assignment_id='c1730000-0000-4000-8000-000000000070') then
    raise exception 'Late repo grading run persisted'; end if;
  begin
    update public.assignment_repo_review_runs set assignment_id='c1730000-0000-4000-8000-000000000070'
      where id='c1730000-0000-4000-8000-000000000098';
    raise exception 'Repo run moved into fenced classroom';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_purge_active' then raise; end if;
  end;
  if not exists(select 1 from public.assignment_repo_review_runs
    where id='c1730000-0000-4000-8000-000000000098'
      and assignment_id='c1730000-0000-4000-8000-000000000074') then
    raise exception 'Other-class repo run changed'; end if;
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
  -- Failure/backoff and expired-lease recovery are simulated only inside rolled-back
  -- subtransactions. Superuser clock-state injection is not committed-row MVCC proof.
  begin
    perform public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'fail',1,
      (claim->'object'->>'id')::uuid,(claim->'object'->>'lease_token')::uuid);
    if not exists(select 1 from public.student_purge_objects where id=(claim->'object'->>'id')::uuid
      and status='failed' and last_error_code='storage_delete_failed' and next_attempt_at>clock_timestamp()
      and lease_token is null) then raise exception 'Failure lost retry/backoff state'; end if;
    raise exception using errcode='P1731',message='rollback retry';
  exception when sqlstate 'P1731' then null; end;
  begin
    insert into private.removed_academic_mutations(transaction_id,operation_id,action) values(txid_current(),op,'claim');
    update public.student_purge_objects set lease_expires_at=clock_timestamp()-interval '1 second'
      where id=(claim->'object'->>'id')::uuid;
    delete from private.removed_academic_mutations where transaction_id=txid_current();
    begin
      perform public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'acknowledge',1,
        (claim->'object'->>'id')::uuid,(claim->'object'->>'lease_token')::uuid);
      raise exception 'Expired callback accepted';
    exception when sqlstate '55000' then if sqlerrm<>'academic_cleanup_lease_lost' then raise; end if; end;
    begin
      delete from storage.objects where bucket_id=claim->'object'->>'storage_bucket' and name=claim->'object'->>'storage_path';
      raise exception 'Storage deletion accepted with expired lease';
    exception when sqlstate '55000' then
      if sqlerrm<>'academic_cleanup_storage_authority_required' then raise; end if;
    end;
    result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
    if result->'object'->>'lease_token'=claim->'object'->>'lease_token' then raise exception 'Expired lease reused'; end if;
    raise exception using errcode='P1731',message='rollback expiry';
  exception when sqlstate 'P1731' then null; end;
  -- Metadata deletion models SQL storage authorization only, not a live byte erase.
  delete from storage.objects where bucket_id=claim->'object'->>'storage_bucket' and name=claim->'object'->>'storage_path';
  result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'acknowledge',1,
    (claim->'object'->>'id')::uuid,(claim->'object'->>'lease_token')::uuid);
  if result<>public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'acknowledge',1,
    (claim->'object'->>'id')::uuid,(claim->'object'->>'lease_token')::uuid) then raise exception 'Lost ack replay changed evidence'; end if;
  -- Drain the second independently leased file, preserving the same exact scope.
  claim:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
  if claim->'object'='null'::jsonb then raise exception 'Second file claim missing'; end if;
  delete from storage.objects where bucket_id=claim->'object'->>'storage_bucket' and name=claim->'object'->>'storage_path';
  perform public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'acknowledge',1,
    (claim->'object'->>'id')::uuid,(claim->'object'->>'lease_token')::uuid);
  result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
  if result->>'local_status'<>'local_completed' or result->>'overall_status'<>'provider_pending' then
    raise exception 'Wrong local completion'; end if;
  if result<>public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim') then
    raise exception 'Completion replay changed evidence'; end if;
  if exists(select 1 from private.removed_academic_resources(course_a,student))
    or exists(select 1 from private.removed_academic_objects(course_a,student)) then raise exception 'Target rows remain'; end if;
  if not exists(select 1 from public.attendance_override_requests
      where request_id='c1730000-0000-4000-8000-000000000077') then
    raise exception 'Aggregate attendance request receipt was not preserved'; end if;
  for resource in select * from academic_target_rows loop
    execute format('select to_jsonb(row) from public.%I row where id=$1',resource.table_name) into actual using resource.row_id;
    if actual is not null then raise exception 'Exact target row remains: %',resource.table_name; end if;
  end loop;
  for resource in select * from academic_preserved_rows loop
    if private.removed_academic_row_hash(resource.table_name,resource.row_id) is distinct from resource.expected_hash then
      raise exception 'Classmate/other-class row changed: %',resource.table_name; end if;
  end loop;
  if before_roster-'retained_manual_attendance_marks'  is distinct from
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
  -- The retained fence must also reject a request that resumes after local
  -- completion. This is deterministic late insertion, not committed-row MVCC proof.
  begin
    insert into public.assignment_repo_review_runs(assignment_id,triggered_by,status)
      values('c1730000-0000-4000-8000-000000000070',teacher,'running');
    raise exception 'Late repo grading run accepted after local completion';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_purge_active' then raise; end if;
  end;
  foreach f in array array['claim_student_purge_object','finalize_student_purge','finalize_student_purge_without_attendance_v1'] loop
    begin
      execute format('select public.%I($1,$2)',f) into result using op,teacher;
      if coalesce((result->>'ok')::boolean,false) then raise exception 'Legacy path released local stage'; end if;
    exception when sqlstate '55000' then null; end;
  end loop;
end $$;
rollback;
