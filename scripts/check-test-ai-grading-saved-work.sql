-- Rollback-only actual SQL contract probe. Run against an explicitly disposable
-- database with migration264; never the shared local or production database.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
insert into public.users(id,email,role) values
 ('a2640000-0000-4000-8000-000000000001','ai264-owner@example.test','teacher'),
 ('a2640000-0000-4000-8000-000000000002','ai264-outsider@example.test','teacher'),
 ('a2640000-0000-4000-8000-000000000003','ai264-saved@example.test','student'),
 ('a2640000-0000-4000-8000-000000000004','ai264-submitted@example.test','student'),
 ('a2640000-0000-4000-8000-000000000005','ai264-never-started@example.test','student'),
 ('a2640000-0000-4000-8000-000000000006','ai264-unselected@example.test','student'),
 ('a2640000-0000-4000-8000-000000000007','ai264-unenrolled@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('a2640000-0000-4000-8000-000000000010','a2640000-0000-4000-8000-000000000001','AI saved work rollback fixture','AI264T');
insert into public.classroom_enrollments(classroom_id,student_id)
 select 'a2640000-0000-4000-8000-000000000010',id from public.users
 where id in ('a2640000-0000-4000-8000-000000000003','a2640000-0000-4000-8000-000000000004',
 'a2640000-0000-4000-8000-000000000005','a2640000-0000-4000-8000-000000000006');
insert into public.tests(id,classroom_id,title,status,points_possible,created_by) values
 ('a2640000-0000-4000-8000-000000000011','a2640000-0000-4000-8000-000000000010','Mixed','draft',20,'a2640000-0000-4000-8000-000000000001'),
 ('a2640000-0000-4000-8000-000000000012','a2640000-0000-4000-8000-000000000010','No open questions','draft',5,'a2640000-0000-4000-8000-000000000001'),
 ('a2640000-0000-4000-8000-000000000013','a2640000-0000-4000-8000-000000000010','Blanks only','draft',5,'a2640000-0000-4000-8000-000000000001'),
 ('a2640000-0000-4000-8000-000000000014','a2640000-0000-4000-8000-000000000010','Closure rollback','draft',5,'a2640000-0000-4000-8000-000000000001'),
 ('a2640000-0000-4000-8000-000000000015','a2640000-0000-4000-8000-000000000010','Draft','draft',5,'a2640000-0000-4000-8000-000000000001');
insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,points,response_max_chars,position) values
 ('a2640000-0000-4000-8000-000000000101','a2640000-0000-4000-8000-000000000011','open_response','Answered','[]',null,5,5000,0),
 ('a2640000-0000-4000-8000-000000000102','a2640000-0000-4000-8000-000000000011','open_response','Blank','[]',null,5,5000,1),
 ('a2640000-0000-4000-8000-000000000103','a2640000-0000-4000-8000-000000000011','multiple_choice','MC','["A","B"]',1,5,5000,2),
 ('a2640000-0000-4000-8000-000000000107','a2640000-0000-4000-8000-000000000011','multiple_choice','Blank MC closure','["A","B"]',1,5,5000,3),
 ('a2640000-0000-4000-8000-000000000104','a2640000-0000-4000-8000-000000000012','multiple_choice','Only MC','["A","B"]',1,5,5000,0),
 ('a2640000-0000-4000-8000-000000000105','a2640000-0000-4000-8000-000000000013','open_response','Whitespace','[]',null,5,5000,0),
 ('a2640000-0000-4000-8000-000000000106','a2640000-0000-4000-8000-000000000014','open_response','Rollback answer','[]',null,5,5000,0);
update public.tests set status='active' where classroom_id='a2640000-0000-4000-8000-000000000010'
 and id<>'a2640000-0000-4000-8000-000000000015';

-- Inject a failure at the actual run insert, after selected closure/materialization.
create function pg_temp.fail_ai264_run_insert() returns trigger language plpgsql as $$
begin
 if new.selection_hash='force-rollback' then raise exception 'fixture_run_insert_failure'; end if;
 return new;
end; $$;
create trigger fixture_ai264_run_failure before insert on public.test_ai_grading_runs
 for each row execute function pg_temp.fail_ai264_run_insert();

do $contract$
#variable_conflict use_variable
declare
 teacher uuid := 'a2640000-0000-4000-8000-000000000001';
 outsider uuid := 'a2640000-0000-4000-8000-000000000002';
 saved uuid := 'a2640000-0000-4000-8000-000000000003';
 submitted uuid := 'a2640000-0000-4000-8000-000000000004';
 never_started uuid := 'a2640000-0000-4000-8000-000000000005';
 unselected uuid := 'a2640000-0000-4000-8000-000000000006';
 unenrolled uuid := 'a2640000-0000-4000-8000-000000000007';
 mixed uuid := 'a2640000-0000-4000-8000-000000000011';
 mc uuid := 'a2640000-0000-4000-8000-000000000012';
 blanks uuid := 'a2640000-0000-4000-8000-000000000013';
 rollback_test uuid := 'a2640000-0000-4000-8000-000000000014';
 draft uuid := 'a2640000-0000-4000-8000-000000000015';
 answered uuid := 'a2640000-0000-4000-8000-000000000101';
 blank_question uuid := 'a2640000-0000-4000-8000-000000000102';
 result jsonb; before_attempt jsonb; before_availability jsonb; snapshot jsonb; run_id uuid;
 revision bigint; existing_response uuid; source_revision bigint; expected_timestamp timestamptz := '2026-10-01T15:00:00Z';
 signature text := 'public.start_test_ai_grading_run_atomic(uuid,uuid,text,uuid[],text,text,text)';
begin
 if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
   or not has_function_privilege('service_role',signature,'execute')
   or has_function_privilege('service_role','private.test_ai_response_is_blank(text)','execute') then
   raise exception 'AI start function privilege boundary widened';
 end if;
 -- Input rejection occurs without partial closure.
 begin perform public.start_test_ai_grading_run_atomic(mixed,outsider,'fixture-model',array[saved],'outsider','all');
   raise exception 'Wrong owner admitted'; exception when insufficient_privilege then null; end;
 begin perform public.start_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array[saved,saved],'duplicate','all');
   raise exception 'Duplicate admitted'; exception when invalid_parameter_value then null; end;
 begin perform public.start_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array[saved,unenrolled],'outsider-student','all');
   raise exception 'Unenrolled admitted'; exception when invalid_parameter_value then null; end;
 begin perform public.start_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array[]::uuid[],'empty','all');
   raise exception 'Empty selection admitted'; exception when invalid_parameter_value then null; end;
 begin perform public.start_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array_fill(saved,array[101]),'oversized','all');
   raise exception 'Oversized selection admitted'; exception when invalid_parameter_value then null; end;
 begin perform public.start_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array[saved,null],'null','all');
   raise exception 'Null student admitted'; exception when invalid_parameter_value then null; end;
 begin perform public.start_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array[saved],'scope','other');
   raise exception 'Bad scope admitted'; exception when invalid_parameter_value then null; end;
 begin perform public.start_test_ai_grading_run_atomic(draft,teacher,'fixture-model',array[saved],'draft','all');
   raise exception 'Draft admitted'; exception when invalid_parameter_value then null; end;
 begin
   update public.classrooms set archived_at=now() where id='a2640000-0000-4000-8000-000000000010';
   perform public.start_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array[saved],'archived','all');
   raise exception 'Archived admitted'; exception when insufficient_privilege then null; end;

 -- Existing durable save/submit APIs establish real student snapshots.
 result:=public.start_test_attempt_revision_atomic(mixed,saved);
 revision:=(result#>>'{attempt,draft_revision}')::bigint;
 snapshot:=jsonb_build_object(answered::text,jsonb_build_object('question_type','open_response','response_text','Latest saved answer'),
   blank_question::text,jsonb_build_object('question_type','open_response','response_text',''),
   'a2640000-0000-4000-8000-000000000103',jsonb_build_object('question_type','multiple_choice','selected_option',1));
 perform public.save_test_attempt_revision_atomic(mixed,saved,snapshot,revision);
 result:=public.start_test_attempt_revision_atomic(mixed,submitted);
 revision:=(result#>>'{attempt,draft_revision}')::bigint;
 perform public.submit_test_attempt_revision_atomic(mixed,submitted,jsonb_set(snapshot,array[blank_question::text,'response_text'],to_jsonb('Submitted second answer'::text)) || jsonb_build_object('a2640000-0000-4000-8000-000000000107',jsonb_build_object('question_type','multiple_choice','selected_option',1)),revision,expected_timestamp);
 update public.test_responses set score=3,graded_at=now(),feedback='Prior grade'
   where test_id=mixed and student_id=submitted;
 perform public.start_test_attempt_revision_atomic(mixed,unselected);
 select to_jsonb(a) into before_attempt from public.test_attempts a where test_id=mixed and student_id=unselected;
 result:=public.start_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array[saved,submitted,never_started],'first','ungraded');
 run_id:=(result->>'run_id')::uuid;
 if result->>'outcome'<>'created' or result->>'eligible_student_count'<>'2'
   or result->>'skipped_unanswered_count'<>'1' or result->>'skipped_already_graded_count'<>'2' then
   raise exception 'Mixed saved/submitted counts wrong: %',result;
 end if;
 if (select count(*) from public.test_ai_grading_run_items where test_ai_grading_run_items.run_id=run_id)<>1
   or not exists(select 1 from public.test_ai_grading_run_items i join public.test_responses r on r.id=i.response_id
      where i.run_id=run_id and i.student_id=saved and r.response_text='Latest saved answer' and i.response_revision=r.revision)
   then raise exception 'Saved response seed/revision wrong'; end if;
 if not exists(select 1 from public.test_attempts where test_id=mixed and student_id=saved
   and not is_submitted and submitted_at is null and closed_for_grading_at is not null and closed_for_grading_by=teacher)
   or not exists(select 1 from public.test_attempts where test_id=mixed and student_id=submitted
   and is_submitted and submitted_at=expected_timestamp and closed_for_grading_at is null) then
   raise exception 'Closure fabricated or changed a student submission'; end if;
 if (select to_jsonb(a) from public.test_attempts a where test_id=mixed and student_id=unselected) is distinct from before_attempt
   or exists(select 1 from public.test_attempts where test_id=mixed and student_id=never_started)
   or exists(select 1 from public.test_student_availability where test_id=mixed and student_id in (unselected,never_started)) then
   raise exception 'Closure mutated unselected/never-started students'; end if;
 if not exists(select 1 from public.test_responses where test_id=mixed and student_id=saved and question_id=blank_question
   and score=0 and feedback='Unanswered' and ai_model is null)
   or not exists(select 1 from public.test_responses where test_id=mixed and student_id=saved
    and question_id='a2640000-0000-4000-8000-000000000103' and score=5) or not exists(select 1 from public.test_responses where test_id=mixed and student_id=saved
    and question_id='a2640000-0000-4000-8000-000000000107' and selected_option is null and response_text is null
    and score=0 and graded_at is not null)
   then raise exception 'Closure zero/MC grading incorrect'; end if;

 -- Same and conflicting active selections return before closing another cohort.
 result:=public.start_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array[unselected],'conflict','all');
 if result->>'outcome'<>'existing' or (result->>'run_id')::uuid<>run_id
   or result->>'eligible_student_count'<>'2' or result->>'skipped_unanswered_count'<>'1'
   or result->>'skipped_already_graded_count'<>'2'
   or (select to_jsonb(a) from public.test_attempts a where test_id=mixed and student_id=unselected) is distinct from before_attempt
   then raise exception 'Conflicting active run mutated cohort or lost stored counts'; end if;
 result:=public.start_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array[saved,submitted,never_started],'first','ungraded');
 if result->>'outcome'<>'existing' or (result->>'run_id')::uuid<>run_id then raise exception 'Active run did not resume'; end if;
 update public.test_ai_grading_runs set status='completed',completed_at=now() where id=run_id;
 -- all requeues all nonblank answers, preserves prior blank grades.
 result:=public.start_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array[saved,submitted],'all','all');
 run_id:=(result->>'run_id')::uuid;
 if result->>'outcome'<>'created' or result->>'skipped_unanswered_count'<>'0' or result->>'skipped_already_graded_count'<>'1'
   or (select count(*) from public.test_ai_grading_run_items i where i.run_id=run_id)<>3 then
   raise exception 'All scope did not regrade nonblank answers: %',result; end if;
 update public.test_ai_grading_runs set status='completed',completed_at=now() where id=run_id;

 -- Legacy create seed revision remains fenced after eligibility widening.
 select id,revision into existing_response,source_revision from public.test_responses where test_id=mixed and student_id=saved and question_id=answered;
 begin
   perform public.create_test_ai_grading_run_atomic(mixed,teacher,'fixture-model',array[saved],array[saved],'stale',1,0,0,
     jsonb_build_array(jsonb_build_object('student_id',saved,'question_id',answered,'response_id',existing_response,
       'response_revision',source_revision+1,'queue_position',0)),'[]');
   raise exception 'Stale response seed accepted'; exception when sqlstate 'PT409' then null; end;

 -- No open questions leaves started work open, and never-started no-op stays absent.
 perform public.start_test_attempt_revision_atomic(mc,saved);
 select to_jsonb(a) into before_attempt from public.test_attempts a where test_id=mc and student_id=saved;
 result:=public.start_test_ai_grading_run_atomic(mc,teacher,'fixture-model',array[saved],'mc','all');
 if result is distinct from '{"outcome":"noop","run_id":null,"noop_reason":"no_open_questions","eligible_student_count":0,"skipped_unanswered_count":0,"skipped_already_graded_count":0}'::jsonb
   or (select to_jsonb(a) from public.test_attempts a where test_id=mc and student_id=saved) is distinct from before_attempt
   or exists(select 1 from public.test_student_availability where test_id=mc) then raise exception 'MC noop closed saved work'; end if;
 result:=public.start_test_ai_grading_run_atomic(blanks,teacher,'fixture-model',array[never_started],'never','all');
 if result->>'outcome'<>'noop' or result->>'eligible_student_count'<>'0'
   or exists(select 1 from public.test_attempts where test_id=blanks) then raise exception 'Never-started noop fabricated work'; end if;

 result:=public.start_test_attempt_revision_atomic(blanks,saved);
 revision:=(result#>>'{attempt,draft_revision}')::bigint;
 perform public.save_test_attempt_revision_atomic(blanks,saved,jsonb_build_object('a2640000-0000-4000-8000-000000000105',
   jsonb_build_object('question_type','open_response','response_text',E'\t\n'||chr(160)||chr(65279))),revision);
 result:=public.start_test_ai_grading_run_atomic(blanks,teacher,'fixture-model',array[saved],'whitespace','all');
 if result->>'outcome'<>'noop' or result->>'eligible_student_count'<>'1' or result->>'skipped_unanswered_count'<>'1'
   or exists(select 1 from public.test_ai_grading_runs where test_id=blanks)
   or not exists(select 1 from public.test_responses where test_id=blanks and score=0 and feedback='Unanswered' and ai_model is null)
   then raise exception 'Whitespace blank was queued or lost zero/count: %',result; end if;

 result:=public.start_test_ai_grading_run_atomic(blanks,teacher,'fixture-model',array[saved],'prior-blank','all');
 if result->>'outcome'<>'noop' or result->>'skipped_unanswered_count'<>'0' or result->>'skipped_already_graded_count'<>'1' then
   raise exception 'Prior blank grade was replaced: %',result; end if;

 result:=public.start_test_attempt_revision_atomic(rollback_test,saved);
 revision:=(result#>>'{attempt,draft_revision}')::bigint;
 perform public.save_test_attempt_revision_atomic(rollback_test,saved,jsonb_build_object('a2640000-0000-4000-8000-000000000106',
   jsonb_build_object('question_type','open_response','response_text','Must survive run failure')),revision);
 select to_jsonb(a) into before_attempt from public.test_attempts a where test_id=rollback_test and student_id=saved;
 begin
   perform public.start_test_ai_grading_run_atomic(rollback_test,teacher,'fixture-model',array[saved],'force-rollback','all');
   raise exception 'Injected failure did not fire';
 exception when raise_exception then if sqlerrm<>'fixture_run_insert_failure' then raise; end if; end;
 if (select to_jsonb(a) from public.test_attempts a where test_id=rollback_test and student_id=saved) is distinct from before_attempt
   or exists(select 1 from public.test_responses where test_id=rollback_test)
   or exists(select 1 from public.test_student_availability where test_id=rollback_test)
   or exists(select 1 from public.test_ai_grading_runs where test_id=rollback_test) then
   raise exception 'Run failure leaked closure/materialization/access/run'; end if;
 raise notice 'AI saved work SQL contract passed';
end;
$contract$;
rollback;
