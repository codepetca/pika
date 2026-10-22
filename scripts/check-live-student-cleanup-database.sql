-- Synthetic rollback-only live lifecycle. Requires175. CI uses its ordinary disposable database.
-- No provider HTTP or physical-byte claim is made by SQL metadata deletion.
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
'announcement_reads','assignment_doc_history','assignment_doc_save_operations','assignment_submission_artifacts','assignment_docs','assignment_feedback_entries','entries','report_card_rows','survey_responses','test_attempt_history','test_attempts','test_focus_events','test_responses','test_student_availability','gradebook_score_overrides','gradebook_item_scores','retained_manual_attendance_marks','managed_storage_json_references','attendance_check_in_facts','attendance_record_projection','attendance_status_overrides','attendance_status_override_events'];
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
  insert into public.entries(student_id,classroom_id,date,text,on_time) values
    (student,course_a,'2026-09-11','target',true),(peer,course_a,'2026-09-11','peer',true),
    (student,course_b,'2026-09-11','other class',true);
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

  if private.live_attendance_ack_known('roster.snapshot','{"studentName":"target"}'::jsonb,'{}'::jsonb)
    or not private.live_attendance_ack_known('roster.snapshot',
      '{"outcome":"applied","rosterRef":"roster_known","revision":1,"createdCount":1,"updatedCount":0,"deactivatedCount":0}'::jsonb,
      '{"roster_ref":"roster_known"}'::jsonb) then raise exception 'Unknown live response was accepted or aggregate reply blocked'; end if;
  update private.student_provider_cleanup_settings set live_enabled=true where singleton;
  update private.removed_student_academic_settings set enabled=true where singleton;
  select participant_ref into f from public.attendance_participant_mappings where classroom_id=course_a and student_id=student;
  insert into public.attendance_integration_outbox(classroom_id,idempotency_key,message_type,payload,status)
    values(course_a,'fixture175:snapshot','roster.snapshot',jsonb_build_object('schema_version',1,
      'message_type','roster.snapshot','idempotency_key','fixture175:snapshot','correlation_ref','fixture175',
      'installation_ref','pika_synthetic_173','roster_ref','roster_fixture175','participants',jsonb_build_array(
        jsonb_build_object('participant_ref',f,'display_name','Target'),
        jsonb_build_object('participant_ref','participant_preserved','display_name','Peer'))),'delivered');
  select to_jsonb(doc) into before_peer from public.assignment_docs doc where id='c1730000-0000-4000-8000-000000000072';
  select to_jsonb(entry) into before_other from public.entries entry where classroom_id=course_b and student_id=student;
  perform public.remove_classroom_students_preserving_data(teacher,course_a,array['c1730000-0000-4000-8000-000000000030'::uuid]);
  saved:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'live_reserve');
  if saved->>'pal_schema_version'<>'2' or saved->>'pal_policy'<>'pika-live-v1' then raise exception 'Live policy not bound'; end if;
  update private.removed_student_academic_settings set enabled=false where singleton;
  begin
    perform public.authorize_student_provider_cleanup(op,teacher,course_a,student,gen_a);
    raise exception 'Provider authorization ignored paused academic cleanup';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_live_cleanup_prerequisite_paused' then raise; end if;
  end;
  update private.removed_student_academic_settings set enabled=true where singleton;
  update public.managed_storage_settings set mode='compatibility',activated_at=null,
    readiness_verified_at=null,readiness_digest=null where singleton;
  begin
    perform public.authorize_student_provider_cleanup(op,teacher,course_a,student,gen_a);
    raise exception 'Provider authorization ignored managed storage pause';
  exception when sqlstate '55000' then
    if sqlerrm<>'student_live_cleanup_prerequisite_paused' then raise; end if;
  end;
  update public.managed_storage_settings set mode='enforced',activated_at=clock_timestamp(),
    readiness_verified_at=clock_timestamp(),readiness_digest=repeat('e',64) where singleton;
  if saved<>public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'live_reserve') then
    raise exception 'Lost reserve response changed binding'; end if;
  begin
    update private.student_provider_cleanup_bindings set pal_schema_version=1,pal_policy='strict-v1' where operation_id=op;
    raise exception 'Policy downgrade accepted';
  exception when sqlstate '55000' then if sqlerrm<>'student_provider_binding_immutable' then raise; end if; end;
  begin
    perform public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'live_complete');
    raise exception 'Unverified cleanup completed';
  exception when sqlstate '55000' then if sqlerrm<>'student_live_absence_unverified' then raise; end if; end;
  receipt:=jsonb_build_object('schema_version',1,'operation_id',op,'learner_id',saved->>'pal_reference',
    'status','completed','begun_at','2026-09-13T15:00:00.000Z','completed_at','2026-09-13T15:01:00.000Z');
  begin
    perform public.record_student_provider_cleanup_receipt(op,teacher,course_a,student,gen_a,'pal',receipt);
    raise exception 'Strict receipt completed live operation';
  exception when sqlstate '22023' then null; end;
  receipt:=receipt||jsonb_build_object('schema_version',2,'policy','pika-live-v1',
    'historical_backups','excluded','backup_retention','not_attested');
  begin
    perform public.record_student_provider_cleanup_receipt(op,teacher,course_a,student,gen_a,'pal',receipt||'{"completed_at":"2026-09-13T15:01:00Z"}');
    raise exception 'Noncanonical timestamp accepted';
  exception when sqlstate '22023' then null; end;
  perform public.record_student_provider_cleanup_receipt(op,teacher,course_a,student,gen_a,'pal',receipt);
  perform public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'inventory');
  result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
  if result->'object'<>'null'::jsonb then raise exception 'Missing Bara allowed file delete'; end if;
  receipt:=jsonb_build_object('schema_version',1,'ok',true,'installation_ref',saved->>'installation_ref',
    'roster_ref',saved->>'roster_ref','participant_ref',saved->>'participant_ref',
    'operation_ref','erase_participant_'||replace(op::text,'-',''),'state','deleted','absence_verified',true,'deleted_count',0);
  perform public.record_student_provider_cleanup_receipt(op,teacher,course_a,student,gen_a,'bara',receipt);
  perform set_config('storage.allow_delete_query','true',true);
  for wrong in select id from public.student_purge_objects where operation_id=op loop
    claim:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
    if claim->'object'='null'::jsonb then raise exception 'Expected leased file: %',claim->'blockers'; end if;
    delete from storage.objects where bucket_id=claim->'object'->>'storage_bucket' and name=claim->'object'->>'storage_path';
    perform public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'acknowledge',1,
      (claim->'object'->>'id')::uuid,(claim->'object'->>'lease_token')::uuid);
  end loop;
  result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'claim');
  if result->>'local_status'<>'local_completed' or result->>'overall_status'<>'provider_pending' then
    raise exception 'Local completion lied about overall status'; end if;
  begin
    insert into public.classroom_enrollments(classroom_id,student_id) values(course_a,student);
    raise exception 'Local completion released re-add';
  exception when sqlstate '55000' then null; end;
  result:=public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'live_complete');
  if result->>'status'<>'completed' or result->>'local_status'<>'local_completed' then raise exception 'Live completion missing'; end if;
  if exists(select 1 from public.student_purge_operations where id=op and (student_id is not null or student_email is not null)) then
    raise exception 'Completed public operation retained subject identifiers'; end if;
  begin
    perform public.get_student_provider_cleanup(op,teacher,course_a,peer,gen_a);
    raise exception 'Wrong-subject completed replay accepted';
  exception when sqlstate '42501' then null; end;
  if (public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'live_reserve'))->>'status'<>'completed' then
    raise exception 'Completed reservation retry lost its private scope binding'; end if;
  if result<>public.advance_removed_student_academic_cleanup(op,teacher,course_a,student,gen_a,'live_complete') then
    raise exception 'Lost final response changed completion'; end if;
  if exists(select 1 from public.student_purge_fences where operation_id=op)
    or exists(select 1 from public.classroom_roster where removed_enrollment_id=gen_a)
    or exists(select 1 from public.attendance_participant_mappings where classroom_id=course_a and student_id=student)
    or not exists(select 1 from private.pal_membership_generations where generation_id=gen_a and state='purged' and scope_digest is null)
    or not private.attendance_participant_generation_closed(saved->>'participant_ref') then raise exception 'Fresh rejoin release or tombstone failed'; end if;
  if (select payload->'participants' from public.attendance_integration_outbox where idempotency_key='fixture175:snapshot')
      <> '[{"participant_ref":"participant_preserved","display_name":"Peer"}]'::jsonb then raise exception 'Shared payload redaction changed classmates'; end if;
  if before_peer<>(select to_jsonb(doc) from public.assignment_docs doc where id='c1730000-0000-4000-8000-000000000072')
    or before_other<>(select to_jsonb(entry) from public.entries entry where classroom_id=course_b and student_id=student)
    or not exists(select 1 from public.users where id=student)
    or not exists(select 1 from public.student_profiles where user_id=student) then raise exception 'Neighbor/account changed'; end if;
  insert into public.classroom_roster(classroom_id,email) values(course_a,'student-173@example.invalid');
  insert into public.classroom_enrollments(classroom_id,student_id) values(course_a,student) returning id into wrong;
  insert into public.attendance_participant_mappings(classroom_id,student_id) values(course_a,student);
  if wrong=gen_a or (select pal_reference from private.pal_membership_generations where generation_id=wrong)=saved->>'pal_reference'
    or (select participant_ref from public.attendance_participant_mappings where classroom_id=course_a and student_id=student)=saved->>'participant_ref'
    or not exists(select 1 from private.attendance_membership_generations where generation_id=wrong) then raise exception 'Fresh identity reused old state'; end if;
  if not private.attendance_payload_generation_closed(course_a,jsonb_build_object('message_type','roster.snapshot',
    'participants',jsonb_build_array(jsonb_build_object('participant_ref',saved->>'participant_ref')))) then raise exception 'Old payload reopened after rejoin'; end if;
  begin
    perform private.register_pal_membership(gen_a,course_a,student,'active');
    raise exception 'Old generation reopened';
  exception when sqlstate '55000' then null; end;
  begin
    perform public.record_student_provider_cleanup_receipt(op,teacher,course_a,student,gen_a,'bara',receipt);
    raise exception 'Stale callback accepted after fresh join';
  exception when sqlstate '55000' then null; end;
end $$;

-- Forward288 real singleton removal/automatic reservation/completion contract.
-- Historical175 cases above remain unchanged; no provider HTTP is performed.
-- Rollback-only callback witness: never read Vault or queue an HTTP request.
create or replace function private.kick_removed_student_cleanup(p_source text)
returns bigint language plpgsql security definer set search_path='' as $$
begin
  perform set_config('pika.cleanup288_kicks',
    (coalesce(nullif(current_setting('pika.cleanup288_kicks',true),''),'0')::integer+1)::text,true);
  return null;
end;
$$;
do $contextual_live288$
declare owner_label text; member_label text; owner_id uuid; member_id uuid; peer_id uuid;
  class_id uuid; other_class uuid; roster_id uuid; v_generation_id uuid; fresh_generation uuid;
  op_id uuid; job_id uuid; lease_id uuid; assignment_id uuid; doc_id uuid; before_peer jsonb; before_other jsonb;
  teaching_class uuid; teaching_assignment uuid; teaching_event uuid; teaching_before jsonb; teaching_after jsonb; kick_before integer;
  fallback_roster uuid; fallback_operation uuid; fallback_before jsonb;
  saved jsonb; job jsonb; result jsonb; receipt jsonb; owner_before jsonb; member_before jsonb;
begin
  if pg_get_functiondef('private.reserve_live_student_cleanup(uuid,uuid,uuid,uuid,uuid)'::regprocedure)
    not like '%Exact removed enrollment/generation/scope%' then return; end if;
  if has_function_privilege('service_role','private.reserve_live_student_cleanup(uuid,uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','public.advance_removed_student_academic_cleanup(uuid,uuid,uuid,uuid,uuid,text,integer,uuid,uuid)','execute') then
    raise exception 'Live288 private reservation/public RPC authority widened'; end if;
  update private.student_provider_cleanup_settings set enabled=true,live_enabled=true,automatic_enabled=true,
    eligible_after=clock_timestamp()-interval '1 minute' where singleton;
  update private.removed_student_academic_settings set enabled=true where singleton;
  update private.pal_membership_settings set enabled=true where singleton;
  -- The signal gate compares with transaction-stable now(), not wall clock.
  update private.pal_classroom_signal_settings set enabled=true,activated_at=coalesce(activated_at,now()-interval '1 second') where singleton;
  update public.managed_storage_settings set mode='enforced',activated_at=clock_timestamp(),
    readiness_verified_at=clock_timestamp(),readiness_digest=repeat('e',64) where singleton;
  foreach owner_label in array array['student','teacher'] loop
    foreach member_label in array array['student','teacher'] loop
      owner_id:=gen_random_uuid(); member_id:=gen_random_uuid(); peer_id:=gen_random_uuid();
      class_id:=gen_random_uuid(); other_class:=gen_random_uuid(); roster_id:=gen_random_uuid();
      teaching_class:=gen_random_uuid(); teaching_assignment:=gen_random_uuid();
      v_generation_id:=gen_random_uuid(); lease_id:=gen_random_uuid(); assignment_id:=gen_random_uuid(); doc_id:=gen_random_uuid();
      insert into public.users(id,email,role) values
        (owner_id,'owner288-'||owner_id::text||'@example.invalid',owner_label),
        (member_id,'member288-'||member_id::text||'@example.invalid',member_label),
        (peer_id,'peer288-'||peer_id::text||'@example.invalid','student');
      perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),owner_id,'classrooms.create','manual',true,
        clock_timestamp(),null,2,'test:live288','live288_fixture',
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=owner_id and feature_key='classrooms.create'),0));
      perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),member_id,'classrooms.create','manual',true,
        clock_timestamp(),null,2,'test:live288','live288_fixture',
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=member_id and feature_key='classrooms.create'),0));
      insert into public.classrooms(id,teacher_id,title,class_code) values
        (class_id,owner_id,'Singleton cleanup288',upper(substr(replace(class_id::text,'-',''),1,10))),
        (other_class,owner_id,'Unrelated cleanup288',upper(substr(replace(other_class::text,'-',''),1,10))),
        (teaching_class,member_id,'Learner also teaches288',upper(substr(replace(teaching_class::text,'-',''),1,10)));
      insert into public.classroom_roster(id,classroom_id,email) values
        (roster_id,class_id,'member288-'||member_id::text||'@example.invalid');
      insert into public.classroom_enrollments(id,classroom_id,student_id) values
        (v_generation_id,class_id,member_id),(gen_random_uuid(),other_class,member_id),(gen_random_uuid(),class_id,peer_id),
        (gen_random_uuid(),teaching_class,peer_id);
      -- The real contextual writer carries stable bindings for either label.
      insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id)
        values(roster_id,class_id,member_id) on conflict do nothing;
      insert into public.attendance_roster_mappings(classroom_id) values(class_id),(teaching_class);
      insert into public.attendance_principal_mappings(user_id) values(owner_id),(member_id);
      insert into public.attendance_participant_mappings(classroom_id,student_id) values(class_id,member_id),(teaching_class,peer_id);
      insert into public.assignments(id,classroom_id,title,due_at,created_by)
        values(assignment_id,class_id,'Preserved shared assignment288',clock_timestamp()+interval '1 day',owner_id);
      insert into public.assignments(id,classroom_id,title,due_at,created_by)
        values(teaching_assignment,teaching_class,'Mixed-role teaching work288',clock_timestamp()+interval '1 day',member_id);
      insert into public.assignment_docs(id,assignment_id,student_id,content) values
        (doc_id,assignment_id,member_id,'{"type":"doc","content":[]}'::jsonb);
      insert into public.entries(classroom_id,student_id,date,text,on_time) values
        (class_id,member_id,'2026-09-11','removed member288',true),
        (class_id,peer_id,'2026-09-11','preserved peer288',true),
        (other_class,member_id,'2026-09-11','preserved other classroom288',true),
        (teaching_class,peer_id,'2026-09-11','preserved teaching classroom288',true);
      teaching_event:=private.enqueue_membership_pal_fact(peer_id,teaching_class,'platform.session.started','preserved-teaching288',clock_timestamp(),'{}'::jsonb);
      if teaching_event is null then raise exception 'Live288 must preserve nonempty mixed-role Pal history'; end if;
      update public.pal_event_outbox set status='processing',lease_token=lease_id,lease_expires_at=now()+interval '1 minute' where id=teaching_event;
      if not public.complete_pal_event_outbox(teaching_event,lease_id) then raise exception 'Live288 teaching event was not delivered'; end if;
      select jsonb_build_object('class',to_jsonb(c),'assignment',to_jsonb(a),'entry',to_jsonb(e),
        'enrollment',to_jsonb(enrollment),'attendance',to_jsonb(mapping),'pal',to_jsonb(event)) into teaching_before
        from public.classrooms c join public.assignments a on a.classroom_id=c.id
        join public.entries e on e.classroom_id=c.id join public.classroom_enrollments enrollment on enrollment.classroom_id=c.id
        join public.attendance_participant_mappings mapping on mapping.classroom_id=c.id
        join public.pal_event_outbox event on event.id=teaching_event where c.id=teaching_class;
      select to_jsonb(entry) into before_peer from public.entries entry where classroom_id=class_id and student_id=peer_id;
      select to_jsonb(entry) into before_other from public.entries entry where classroom_id=other_class and student_id=member_id;
      select to_jsonb(account) into owner_before from public.users account where id=owner_id;
      select to_jsonb(account) into member_before from public.users account where id=member_id;
      if member_label='teacher' then
        -- Genuine public-table fallback: this actual enrolled learner's legacy
        -- email binder deliberately leaves the teacher-labelled roster unbound.
        fallback_roster:=gen_random_uuid(); fallback_operation:=gen_random_uuid();
        insert into public.classroom_roster(id,classroom_id,email,first_name)
          values(fallback_roster,other_class,'member288-'||member_id::text||'@example.invalid','Unbound fallback288');
        if exists(select 1 from public.classroom_roster_student_bindings binding where binding.roster_id=fallback_roster)
          or not exists(select 1 from public.classroom_enrollments where classroom_id=other_class and student_id=member_id) then
          raise exception 'Live288 fallback fixture is not an unbound active teacher-labelled membership'; end if;
        select to_jsonb(roster) into fallback_before from public.classroom_roster roster where id=fallback_roster;
        begin
          -- Install a synthetic exact non-provider lifecycle fence under the
          -- real membership/purge locks. No begin/erase/provider action occurs.
          perform private.try_lock_classroom_membership_change(other_class,member_id);
          perform public.student_purge_lock(other_class,member_id);
          perform public.guard_classroom_purge_lifecycle(other_class);
          insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,
            student_binding_sha256,request_sha256,status,source_revision)
            values(fallback_operation,owner_id,other_class,member_id,repeat('a',64),repeat('b',64),'inventorying',1);
          insert into public.student_purge_fences(classroom_id,student_id,operation_id,teacher_id)
            values(other_class,member_id,fallback_operation,owner_id);
          if coalesce(current_setting('pika.student_purge_finalize',true),'off')='on'
            or private.removed_academic_delete_allowed('classroom_roster',fallback_before)
            or exists(select 1 from private.removed_academic_mutations where transaction_id=txid_current()) then
            raise exception 'Live288 fallback witness acquired a trusted delete capability'; end if;
          begin
            update public.classroom_roster set first_name='Must be fenced288' where id=fallback_roster;
            raise exception 'Live288 active-enrollment email fallback allowed update';
          exception when sqlstate '55000' then if sqlerrm<>'student_purge_active' then raise; end if; end;
          begin
            delete from public.classroom_roster where id=fallback_roster;
            raise exception 'Live288 active-enrollment email fallback allowed untrusted delete';
          exception when sqlstate '55000' then if sqlerrm<>'student_purge_active' then raise; end if; end;
          if fallback_before is distinct from (select to_jsonb(roster) from public.classroom_roster roster where id=fallback_roster)
            or before_peer is distinct from (select to_jsonb(entry) from public.entries entry where classroom_id=class_id and student_id=peer_id)
            or before_other is distinct from (select to_jsonb(entry) from public.entries entry where classroom_id=other_class and student_id=member_id) then
            raise exception 'Live288 fallback denial changed roster/peer/other-class evidence'; end if;
          raise exception using errcode='ZX288',message='rollback_live288_fallback_fence';
        exception when sqlstate 'ZX288' then
          if sqlerrm<>'rollback_live288_fallback_fence' then raise; end if;
        end;
        if exists(select 1 from public.student_purge_operations where id=fallback_operation)
          or exists(select 1 from public.student_purge_fences where operation_id=fallback_operation)
          or exists(select 1 from public.classroom_roster_student_bindings binding where binding.roster_id=fallback_roster)
          or fallback_before is distinct from (select to_jsonb(roster) from public.classroom_roster roster where id=fallback_roster) then
          raise exception 'Live288 fallback subtransaction did not restore exact fence-free state'; end if;
      end if;
      kick_before:=coalesce(nullif(current_setting('pika.cleanup288_kicks',true),''),'0')::integer;
      perform public.remove_classroom_students_for_owner_v1(owner_id,class_id,array[roster_id]);
      if coalesce(current_setting('pika.cleanup288_kicks',true),'0')::integer<>kick_before+1
        or (select count(*) from private.removed_student_cleanup_jobs queued where queued.generation_id=v_generation_id)<>1 then
        raise exception 'Live288 removal did not queue exactly one generation'; end if;
      job:=public.claim_removed_student_cleanup_job(lease_id);
      if (job->>'generation_id')::uuid is distinct from v_generation_id
        or (job->>'teacher_id')::uuid is distinct from owner_id or (job->>'student_id')::uuid is distinct from member_id then
        raise exception 'Live288 actual claimed job identity changed'; end if;
      op_id:=(job->>'operation_id')::uuid; job_id:=(job->>'job_id')::uuid;
      -- Same-class owner promotion is not removed-subject cleanup authority.
      begin
        update public.classrooms set teacher_id=member_id where id=class_id;
        perform public.advance_removed_student_academic_cleanup(op_id,member_id,class_id,member_id,v_generation_id,'live_reserve');
        raise exception 'Live288 current owner accepted as cleanup subject';
      exception when sqlstate '55000' then
        if sqlerrm<>'retained_roster_cleanup_group_invalid' then raise; end if;
      end;
      saved:=public.advance_removed_student_academic_cleanup(op_id,owner_id,class_id,member_id,v_generation_id,'live_reserve');
      if saved->>'pal_schema_version'<>'2' or saved->>'pal_policy'<>'pika-live-v1'
        or saved<>public.advance_removed_student_academic_cleanup(op_id,owner_id,class_id,member_id,v_generation_id,'live_reserve') then
        raise exception 'Live288 role-neutral reservation lost exact live replay'; end if;
      if public.get_student_provider_cleanup(op_id,owner_id,class_id,member_id,v_generation_id) is distinct from saved
        or public.discover_retained_student_cleanup_groups(owner_id,class_id,member_id)->'targets'->0->>'operation_id' is distinct from op_id::text then
        raise exception 'Live288 actual owner could not read exact saved progress'; end if;
      begin
        perform public.advance_removed_student_academic_cleanup(op_id,owner_id,class_id,member_id,v_generation_id,'live_complete');
        raise exception 'Live288 completed without receipts/academic absence';
      exception when sqlstate '55000' then if sqlerrm<>'student_live_absence_unverified' then raise; end if; end;
      receipt:=jsonb_build_object('schema_version',2,'policy','pika-live-v1','operation_id',op_id,
        'learner_id',saved->>'pal_reference','status','completed','begun_at','2026-09-13T15:00:00.000Z',
        'completed_at','2026-09-13T15:01:00.000Z','historical_backups','excluded','backup_retention','not_attested');
      begin
        perform public.record_student_provider_cleanup_receipt(op_id,owner_id,class_id,member_id,v_generation_id,'pal',
          receipt||jsonb_build_object('learner_id','wrong_scope'));
        raise exception 'Live288 substituted receipt accepted';
      exception when sqlstate '22023' then null; end;
      perform public.record_student_provider_cleanup_receipt(op_id,owner_id,class_id,member_id,v_generation_id,'pal',receipt);
      perform public.advance_removed_student_academic_cleanup(op_id,owner_id,class_id,member_id,v_generation_id,'inventory');
      result:=public.advance_removed_student_academic_cleanup(op_id,owner_id,class_id,member_id,v_generation_id,'claim');
      if not exists(select 1 from public.assignment_docs where id=doc_id)
        or result->>'local_status'='local_completed' then raise exception 'Live288 missing Bara allowed academic deletion'; end if;
      update private.removed_student_academic_settings set enabled=false where singleton;
      begin
        perform public.authorize_student_provider_cleanup(op_id,owner_id,class_id,member_id,v_generation_id);
        raise exception 'Live288 ignored revoked academic prerequisite';
      exception when sqlstate '55000' then if sqlerrm<>'student_live_cleanup_prerequisite_paused' then raise; end if; end;
      update private.removed_student_academic_settings set enabled=true where singleton;
      receipt:=jsonb_build_object('schema_version',1,'ok',true,'installation_ref',saved->>'installation_ref',
        'roster_ref',saved->>'roster_ref','participant_ref',saved->>'participant_ref',
        'operation_ref','erase_participant_'||replace(op_id::text,'-',''),'state','deleted','absence_verified',true,'deleted_count',0);
      perform public.record_student_provider_cleanup_receipt(op_id,owner_id,class_id,member_id,v_generation_id,'bara',receipt);
      result:=public.advance_removed_student_academic_cleanup(op_id,owner_id,class_id,member_id,v_generation_id,'claim');
      if result->>'local_status'<>'local_completed' then raise exception 'Live288 academic stage did not complete'; end if;
      result:=public.advance_removed_student_academic_cleanup(op_id,owner_id,class_id,member_id,v_generation_id,'live_complete');
      if result->>'status'<>'completed' or not public.release_removed_student_cleanup_job(job_id,lease_id,true,null,30) then
        raise exception 'Live288 exact job/live completion failed'; end if;
      if exists(select 1 from public.assignment_docs where id=doc_id)
        or not exists(select 1 from public.assignments where id=assignment_id)
        or before_peer is distinct from (select to_jsonb(entry) from public.entries entry where classroom_id=class_id and student_id=peer_id)
        or before_other is distinct from (select to_jsonb(entry) from public.entries entry where classroom_id=other_class and student_id=member_id)
        or owner_before is distinct from (select to_jsonb(account) from public.users account where id=owner_id)
        or member_before is distinct from (select to_jsonb(account) from public.users account where id=member_id) then
        raise exception 'Live288 cleanup changed shared/account/other-class evidence'; end if;
      insert into public.classroom_roster(classroom_id,email) values(class_id,'member288-'||member_id::text||'@example.invalid');
      insert into public.classroom_enrollments(classroom_id,student_id) values(class_id,member_id) returning id into fresh_generation;
      insert into public.attendance_participant_mappings(classroom_id,student_id) values(class_id,member_id);
      if fresh_generation=v_generation_id or (select pal_reference from private.pal_membership_generations membership where membership.generation_id=fresh_generation)=saved->>'pal_reference'
        or (select participant_ref from public.attendance_participant_mappings where classroom_id=class_id and student_id=member_id)=saved->>'participant_ref'
        or not private.attendance_participant_generation_closed(saved->>'participant_ref') then
        raise exception 'Live288 fresh rejoin reused removed evidence'; end if;
      select jsonb_build_object('class',to_jsonb(c),'assignment',to_jsonb(a),'entry',to_jsonb(e),
        'enrollment',to_jsonb(enrollment),'attendance',to_jsonb(mapping),'pal',to_jsonb(event)) into teaching_after
        from public.classrooms c join public.assignments a on a.classroom_id=c.id
        join public.entries e on e.classroom_id=c.id join public.classroom_enrollments enrollment on enrollment.classroom_id=c.id
        join public.attendance_participant_mappings mapping on mapping.classroom_id=c.id
        join public.pal_event_outbox event on event.id=teaching_event where c.id=teaching_class;
      if teaching_before is distinct from teaching_after then raise exception 'Live288 scoped cleanup changed mixed-role teaching data'; end if;
    end loop;
  end loop;
end;
$contextual_live288$;
rollback;
