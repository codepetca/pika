-- Migration265 rollback-only contracts. Run only on an explicitly authorized
-- disposable database replayed through265. No shared/local/hosted authority is
-- implied. Rows roll back; PostgreSQL sequence allocations do not.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $contracts$
declare
  teacher uuid := gen_random_uuid();
  foreign_teacher uuid := gen_random_uuid();
  submitted uuid := gen_random_uuid();
  partial uuid := gen_random_uuid();
  unfinished uuid := gen_random_uuid();
  never_started uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  classroom uuid := gen_random_uuid();
  assessment uuid := gen_random_uuid();
  global_closed uuid := gen_random_uuid();
  draft uuid := gen_random_uuid();
  no_questions uuid := gen_random_uuid();
  first_question uuid := gen_random_uuid();
  second_question uuid := gen_random_uuid();
  global_question uuid := gen_random_uuid();
  student uuid;
  response_id uuid;
  old_revision bigint;
  fresh_revision bigint;
  response_revision bigint;
  result jsonb;
  answers jsonb;
  attempt_before jsonb;
  responses_before jsonb;
  expected jsonb;
  signature text;
begin
  insert into public.users(id,email,role) values
    (teacher,'return265-' || teacher || '@example.test','teacher'),
    (foreign_teacher,'return265-' || foreign_teacher || '@example.test','teacher'),
    (submitted,'return265-' || submitted || '@example.test','student'),
    (partial,'return265-' || partial || '@example.test','student'),
    (unfinished,'return265-' || unfinished || '@example.test','student'),
    (never_started,'return265-' || never_started || '@example.test','student'),
    (outsider,'return265-' || outsider || '@example.test','student');
  insert into public.classrooms(id,teacher_id,title,class_code)
    values(classroom,teacher,'Return265 disposable fixture','R265' || left(replace(classroom::text,'-',''),8));
  insert into public.classroom_enrollments(classroom_id,student_id)
    select classroom,id from unnest(array[submitted,partial,unfinished,never_started]) selected(id);
  insert into public.tests(id,classroom_id,title,status,points_possible,created_by) values
    (assessment,classroom,'Selected closed ungraded return','active',10,teacher),
    (global_closed,classroom,'Global closed unfinished return','active',5,teacher),
    (draft,classroom,'Draft return refused','draft',5,teacher),
    (no_questions,classroom,'Empty return skipped','closed',5,teacher);
  insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,points,position) values
    (first_question,assessment,'open_response','First synthetic answer','[]',null,5,0),
    (second_question,assessment,'open_response','Second synthetic answer','[]',null,5,1),
    (global_question,global_closed,'open_response','Global synthetic answer','[]',null,5,0);

  foreach signature in array array[
    'public.return_test_attempts_checked_atomic(uuid,uuid[],uuid)',
    'public.start_test_attempt_revision_atomic(uuid,uuid)',
    'public.save_test_attempt_revision_atomic(uuid,uuid,jsonb,bigint)',
    'public.submit_test_attempt_revision_atomic(uuid,uuid,jsonb,bigint,timestamp with time zone)'
  ] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
      or not has_function_privilege('service_role',signature,'execute') then raise exception 'Unexpected ACL: %',signature; end if;
  end loop;
  if has_function_privilege('anon','private.revoke_incomplete_test_returns(uuid,uuid[])','execute')
    or has_function_privilege('authenticated','private.revoke_incomplete_test_returns(uuid,uuid[])','execute')
    or has_function_privilege('service_role','private.revoke_incomplete_test_returns(uuid,uuid[])','execute') then
    raise exception 'Compatibility hook became externally callable';
  end if;

  answers := jsonb_build_object(first_question::text,jsonb_build_object('question_type','open_response','response_text','Saved first answer'),
    second_question::text,jsonb_build_object('question_type','open_response','response_text','Saved second answer'));
  foreach student in array array[submitted,partial,unfinished] loop
    result := public.start_test_attempt_revision_atomic(assessment,student);
    fresh_revision := (result#>>'{attempt,draft_revision}')::bigint;
    if student=unfinished then
      result := public.save_test_attempt_revision_atomic(assessment,student,answers,fresh_revision);
      old_revision := (result#>>'{attempt,draft_revision}')::bigint;
    else
      perform public.submit_test_attempt_revision_atomic(assessment,student,answers,fresh_revision,clock_timestamp());
    end if;
  end loop;
  select id,revision into response_id,response_revision from public.test_responses
    where test_id=assessment and student_id=partial and question_id=first_question;
  perform public.save_test_response_grades_atomic(assessment,partial,teacher,jsonb_build_array(
    jsonb_build_object('response_id',response_id,'expected_response_revision',response_revision,'score',3,'feedback','First graded','clear_grade',false)),clock_timestamp());

  -- One open student makes the entire Return refuse without disclosing siblings.
  begin
    perform public.return_test_attempts_checked_atomic(assessment,array[submitted,partial,unfinished,never_started],teacher);
    raise exception 'Open selection accepted';
  exception when sqlstate 'PT409' then null; end;
  if exists(select 1 from public.test_attempts where test_id=assessment and returned_at is not null) then raise exception 'Open refusal disclosed work'; end if;
  begin
    perform public.return_test_attempts_checked_atomic(assessment,array[submitted],foreign_teacher);
    raise exception 'Foreign teacher accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.return_test_attempts_checked_atomic(assessment,array[submitted,outsider],teacher);
    raise exception 'Foreign member accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.return_test_attempts_checked_atomic(draft,array[submitted],teacher);
    raise exception 'Draft accepted';
  exception when invalid_parameter_value then null; end;

  -- Model closed availability with an existing draft but no prior closure stamp.
  -- Return itself must finalize this saved attempt even while the Test is active.
  insert into public.test_student_availability(test_id,student_id,state,updated_by)
    select assessment,id,'closed',teacher from unnest(array[submitted,partial,unfinished,never_started]) selected(id);
  result := public.return_test_attempts_checked_atomic(assessment,array[submitted,partial,unfinished,never_started],teacher);
  if result is distinct from jsonb_build_object('returned_count',3,'already_returned_count',0,'skipped_count',1,'test_closed',false) then
    raise exception 'Mixed Return counts differ: %',result;
  end if;
  if exists(select 1 from public.test_attempts where test_id=assessment and student_id=never_started)
    or exists(select 1 from public.test_responses where test_id=assessment and student_id=never_started) then raise exception 'Never-started work created'; end if;
  if not exists(select 1 from public.test_attempts where test_id=assessment and student_id=unfinished and not is_submitted
    and submitted_at is null and responses=answers and closed_for_grading_at is not null and closed_for_grading_by=teacher and returned_at is not null) then
    raise exception 'Return lost draft or fabricated submission';
  end if;
  if (select count(*) from public.test_responses where test_id=assessment and score is null)<>5
    or (select count(*) from public.test_responses where test_id=assessment)<>6 then raise exception 'Return invented nonblank grades or omitted answers'; end if;
  if (select status from public.tests where id=assessment)<>'active' then raise exception 'Return closed entire Test'; end if;
  select to_jsonb(attempt) into attempt_before from public.test_attempts attempt where test_id=assessment and student_id=unfinished;
  select jsonb_agg(to_jsonb(response) order by id) into responses_before from public.test_responses response where test_id=assessment;
  result := public.return_test_attempts_checked_atomic(assessment,array[submitted,partial,unfinished,never_started],teacher);
  if result is distinct from jsonb_build_object('returned_count',0,'already_returned_count',3,'skipped_count',1,'test_closed',false)
    or (select to_jsonb(attempt) from public.test_attempts attempt where test_id=assessment and student_id=unfinished) is distinct from attempt_before
    or (select jsonb_agg(to_jsonb(response) order by id) from public.test_responses response where test_id=assessment) is distinct from responses_before then
    raise exception 'Idempotent Return restamped work: %',result;
  end if;

  -- Save only one grade while another remains ungraded, then clear all open
  -- grades. Both transactions preserve Return, closure and original answer bytes.
  select id,revision into response_id,response_revision from public.test_responses where test_id=assessment and student_id=unfinished and question_id=first_question;
  perform public.save_test_response_grades_atomic(assessment,unfinished,teacher,jsonb_build_array(
    jsonb_build_object('response_id',response_id,'expected_response_revision',response_revision,'score',4,'feedback','Partial returned edit','clear_grade',false)),clock_timestamp());
  if (select to_jsonb(attempt) from public.test_attempts attempt where test_id=assessment and student_id=unfinished) is distinct from attempt_before then
    raise exception 'Partial grade save retracted Return or changed lifecycle';
  end if;
  select jsonb_agg(jsonb_build_object('response_id',id,'expected_response_revision',revision) order by id) into expected
    from public.test_responses where test_id=assessment and student_id=unfinished;
  perform public.clear_test_open_response_grades_atomic(assessment,teacher,array[unfinished],expected,clock_timestamp());
  if (select to_jsonb(attempt) from public.test_attempts attempt where test_id=assessment and student_id=unfinished) is distinct from attempt_before
    or exists(select 1 from public.test_responses where test_id=assessment and student_id=unfinished and score is not null)
    or (select count(*) from public.test_responses where test_id=assessment and student_id=unfinished and response_text in('Saved first answer','Saved second answer'))<>2 then
    raise exception 'Grade clear retracted Return, closure or answers';
  end if;

  -- Returned unsubmitted work remains write-protected. Stale revisions may
  -- return the pre-existing conflict shape, but can never persist student work.
  fresh_revision := (attempt_before->>'draft_revision')::bigint;
  begin perform public.start_test_attempt_revision_atomic(assessment,unfinished); raise exception 'Returned draft Start accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.save_test_attempt_revision_atomic(assessment,unfinished,answers,fresh_revision); raise exception 'Returned draft fresh save accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.submit_test_attempt_revision_atomic(assessment,unfinished,answers,fresh_revision,clock_timestamp()); raise exception 'Returned draft fresh submit accepted';
  exception when invalid_parameter_value then null; end;
  result := public.save_test_attempt_revision_atomic(assessment,unfinished,'{}',old_revision);
  if result->>'conflict'<>'true' then raise exception 'Returned draft stale save accepted'; end if;
  result := public.submit_test_attempt_revision_atomic(assessment,unfinished,'{}',old_revision,clock_timestamp());
  if result->>'conflict'<>'true' then raise exception 'Returned draft stale submit accepted'; end if;
  if (select to_jsonb(attempt) from public.test_attempts attempt where test_id=assessment and student_id=unfinished) is distinct from attempt_before then
    raise exception 'Rejected student write changed returned draft';
  end if;

  -- Global closure finalizes saved work without attributing submission to the student.
  result := public.start_test_attempt_revision_atomic(global_closed,unfinished);
  perform public.save_test_attempt_revision_atomic(global_closed,unfinished,jsonb_build_object(global_question::text,
    jsonb_build_object('question_type','open_response','response_text','Global saved answer')),(result#>>'{attempt,draft_revision}')::bigint);
  update public.tests set status='closed' where id=global_closed;
  result := public.return_test_attempts_checked_atomic(global_closed,array[unfinished,never_started],teacher);
  if result->>'returned_count'<>'1' or result->>'skipped_count'<>'1'
    or not exists(select 1 from public.test_attempts where test_id=global_closed and student_id=unfinished and not is_submitted and submitted_at is null and returned_at is not null)
    or not exists(select 1 from public.test_responses where test_id=global_closed and student_id=unfinished and response_text='Global saved answer' and score is null) then
    raise exception 'Global closed saved return differs';
  end if;
  -- An existing submitted attempt still cannot disclose a Test with no questions.
  insert into public.test_attempts(test_id,student_id,is_submitted,submitted_at) values(no_questions,submitted,true,clock_timestamp());
  result := public.return_test_attempts_checked_atomic(no_questions,array[submitted],teacher);
  if result->>'skipped_count'<>'1' or result->>'returned_count'<>'0' then raise exception 'Empty Test return guard lost'; end if;
end;
$contracts$;
\echo Return265 ungraded submitted/unfinished, persistence and student fencing: PASS
rollback;
