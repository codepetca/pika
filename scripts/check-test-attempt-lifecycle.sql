-- Source-only regression harness for migration 244. DO NOT run without approval
-- naming the local target and migration. All fixture/data writes roll back.
-- Sequence allocations do not roll back (normal PostgreSQL sequence behavior).
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
insert into public.users (id, email, role) values
 ('a2440000-0000-4000-8000-000000000001', 'core244-teacher@example.test', 'teacher'),
 ('a2440000-0000-4000-8000-000000000002', 'core244-student@example.test', 'student'),
 ('a2440000-0000-4000-8000-000000000003', 'core244-unstarted@example.test', 'student');
insert into public.classrooms (id, teacher_id, title, class_code) values
 ('a2440000-0000-4000-8000-000000000010', 'a2440000-0000-4000-8000-000000000001', 'CORE244 disposable fixture', 'CORE2440');
insert into public.classroom_enrollments (classroom_id, student_id) values
 ('a2440000-0000-4000-8000-000000000010', 'a2440000-0000-4000-8000-000000000002'),
 ('a2440000-0000-4000-8000-000000000010', 'a2440000-0000-4000-8000-000000000003');
insert into public.tests (id, classroom_id, title, status, points_possible, created_by) values
 ('a2440000-0000-4000-8000-000000000011', 'a2440000-0000-4000-8000-000000000010', 'MC revision', 'draft', 5, 'a2440000-0000-4000-8000-000000000001'),
 ('a2440000-0000-4000-8000-000000000012', 'a2440000-0000-4000-8000-000000000010', 'Mixed closure', 'draft', 10, 'a2440000-0000-4000-8000-000000000001'),
 ('a2440000-0000-4000-8000-000000000013', 'a2440000-0000-4000-8000-000000000010', 'Global blank closure', 'draft', 5, 'a2440000-0000-4000-8000-000000000001');
insert into public.test_questions (id, test_id, question_type, question_text, options, correct_option, points, response_max_chars, position) values
 ('a2440000-0000-4000-8000-000000000101', 'a2440000-0000-4000-8000-000000000011', 'multiple_choice', 'MC', '["A","B"]', 1, 5, 5000, 0),
 ('a2440000-0000-4000-8000-000000000102', 'a2440000-0000-4000-8000-000000000012', 'multiple_choice', 'Unanswered MC', '["A","B"]', 1, 5, 5000, 0),
 ('a2440000-0000-4000-8000-000000000103', 'a2440000-0000-4000-8000-000000000012', 'open_response', 'Needs grading', '[]', null, 5, 5000, 1),
 ('a2440000-0000-4000-8000-000000000104', 'a2440000-0000-4000-8000-000000000013', 'multiple_choice', 'Blank MC', '["A","B"]', 1, 5, 5000, 0);
-- Current draft status is authoritative even for a valid teacher/enrollment.
do $draft_access$ begin
 begin
  perform public.update_test_student_access_atomic('a2440000-0000-4000-8000-000000000011',
    array['a2440000-0000-4000-8000-000000000002'::uuid], 'open', 'a2440000-0000-4000-8000-000000000001');
  raise exception 'Draft selected access was accepted';
 exception when invalid_parameter_value then null; end;
 if exists(select 1 from public.test_student_availability where test_id='a2440000-0000-4000-8000-000000000011') then raise exception 'Draft refusal mutated access'; end if;
end; $draft_access$;
update public.tests set status = 'active' where classroom_id = 'a2440000-0000-4000-8000-000000000010';

do $contract$
declare
 teacher uuid := 'a2440000-0000-4000-8000-000000000001';
 student uuid := 'a2440000-0000-4000-8000-000000000002';
 absent uuid := 'a2440000-0000-4000-8000-000000000003';
 mc uuid := 'a2440000-0000-4000-8000-000000000011';
 mixed uuid := 'a2440000-0000-4000-8000-000000000012';
 blank uuid := 'a2440000-0000-4000-8000-000000000013';
 revision bigint; result jsonb; snapshot jsonb; expected jsonb; returned timestamptz; signature text; before_clear_revision bigint;
begin
 foreach signature in array array[
  'public.start_test_attempt_revision_atomic(uuid,uuid)',
  'public.save_test_attempt_revision_atomic(uuid,uuid,jsonb,bigint)',
  'public.submit_test_attempt_revision_atomic(uuid,uuid,jsonb,bigint,timestamp with time zone)',
  'public.return_test_attempts_checked_atomic(uuid,uuid[],uuid)'
 ] loop
  if has_function_privilege('anon', signature, 'execute') or has_function_privilege('authenticated', signature, 'execute')
    or not has_function_privilege('service_role', signature, 'execute') then raise exception 'Unexpected privilege: %', signature; end if;
 end loop;
 begin perform public.return_test_attempts_checked_atomic(mc, array[student], absent); raise exception 'Non-owner Return accepted';
 exception when insufficient_privilege then null; end;
 begin
  update public.classrooms set archived_at=now() where id='a2440000-0000-4000-8000-000000000010';
  perform public.return_test_attempts_checked_atomic(mc,array[student],teacher);
  raise exception 'Archived classroom Return accepted';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.classroom_enrollments where classroom_id='a2440000-0000-4000-8000-000000000010' and student_id=student;
  perform public.return_test_attempts_checked_atomic(mc,array[student],teacher);
  raise exception 'Unenrolled Return accepted';
 exception when invalid_parameter_value then null; end;
 result := public.start_test_attempt_revision_atomic(mc, student);
 revision := (result#>>'{attempt,draft_revision}')::bigint;
 -- A forged context is not authority while the student's effective access is open.
 perform set_config('pika.test_teacher_closure', mc::text, true);
 begin
  insert into public.test_responses(test_id,question_id,student_id,score,graded_at) values(mc,'a2440000-0000-4000-8000-000000000101',student,0,now());
  raise exception 'Forged open closure accepted';
 exception when raise_exception then
  if sqlerrm <> 'Unanswered multiple-choice scores require teacher closure' then raise; end if;
 end;
 perform set_config('pika.test_teacher_closure', '', true);
 snapshot := jsonb_build_object('a2440000-0000-4000-8000-000000000101', jsonb_build_object('question_type','multiple_choice','selected_option',1));
 result := public.save_test_attempt_revision_atomic(mc, student, snapshot, revision);
 if (result#>>'{attempt,draft_revision}')::bigint <= revision then raise exception 'Save did not advance revision'; end if;
 result := public.save_test_attempt_revision_atomic(mc, student, '{}'::jsonb, revision);
 if result->>'conflict' <> 'true' or result#>'{attempt,responses}' <> snapshot then raise exception 'Stale snapshot overwrote answers'; end if;
 result := public.submit_test_attempt_revision_atomic(mc, student, '{}'::jsonb, revision, now());
 if result->>'conflict' <> 'true' then raise exception 'Stale submit accepted'; end if;
 begin
  perform public.save_test_attempt_atomic(mc, student, snapshot);
  raise exception 'Unfenced legacy save accepted';
 exception when invalid_parameter_value then null; end;
 select draft_revision into revision from public.test_attempts where test_id=mc and student_id=student;
 result := public.submit_test_attempt_revision_atomic(mc, student, snapshot, revision, now());
 if result->>'attempt_id' is null then raise exception 'Fenced submission failed'; end if;
 perform public.update_test_student_access_atomic(mc, array[student,absent], 'closed', teacher);
 result := public.return_test_attempts_checked_atomic(mc, array[student,absent], teacher);
 if result->>'returned_count' <> '1' or result->>'skipped_count' <> '1' then raise exception 'Return counts or unstarted eligibility wrong: %', result; end if;
 select returned_at into returned from public.test_attempts where test_id=mc and student_id=student;
 result := public.return_test_attempts_checked_atomic(mc, array[student], teacher);
 if result->>'returned_count' <> '0' or result->>'already_returned_count' <> '1' then raise exception 'Return is not idempotent'; end if;
 if returned is distinct from (select returned_at from public.test_attempts where test_id=mc and student_id=student) then raise exception 'Idempotent Return changed disclosure time'; end if;
 -- No unanswered row is manufactured by generic draft saving.
 perform public.start_test_attempt_revision_atomic(mixed, student);
 select draft_revision into revision from public.test_attempts where test_id=mixed and student_id=student;
 snapshot := jsonb_build_object('a2440000-0000-4000-8000-000000000103', jsonb_build_object('question_type','open_response','response_text','Needs a teacher'));
 perform public.save_test_attempt_revision_atomic(mixed, student, snapshot, revision);
 if exists (select 1 from public.test_responses response where test_id=mixed) then raise exception 'Draft created closure zeros'; end if;
 perform public.update_test_student_access_atomic(mixed, array[student,absent], 'closed', teacher);
 if not exists (select 1 from public.test_responses response where test_id=mixed and question_id='a2440000-0000-4000-8000-000000000102' and selected_option is null and score=0 and graded_at is not null) then raise exception 'Selected closure omitted MC zero'; end if;
 if exists (select 1 from public.test_responses response where test_id=mixed and student_id=absent) then raise exception 'Unstarted student received zeros'; end if;
 -- A normal service-role writer cannot forge a closure zero even with a matching GUC.
 begin
  delete from public.test_responses where test_id=mixed and question_id='a2440000-0000-4000-8000-000000000102';
  perform set_config('pika.test_teacher_closure', mixed::text, true);
  execute 'set local role service_role';
  insert into public.test_responses(test_id,question_id,student_id,score,graded_at) values(mixed,'a2440000-0000-4000-8000-000000000102',student,0,now());
  raise exception 'Ordinary writer forged closure';
 exception when raise_exception then
  if sqlerrm <> 'Unanswered multiple-choice scores require teacher closure' then raise; end if;
 end;
 execute 'reset role';
 perform set_config('pika.test_teacher_closure', '', true);
 result := public.return_test_attempts_checked_atomic(mixed, array[student], teacher);
 if result->>'skipped_count' <> '1' then raise exception 'Mixed ungraded work returned'; end if;
 -- Grade using the canonical optimistic grading RPC, never raw lifecycle writes.
 select jsonb_agg(jsonb_build_object('response_id',id,'expected_response_revision',response.revision,'score',4,'feedback','Reviewed','clear_grade',false))
 into expected from public.test_responses response where test_id=mixed and question_id='a2440000-0000-4000-8000-000000000103';
 perform public.save_test_response_grades_atomic(mixed, student, teacher, expected, now());
 if (select sum(score) from public.test_responses where test_id=mixed and student_id=student) <> 4
   or (select sum(points) from public.test_questions where test_id=mixed) <> 10
   or (select count(*) from public.test_responses where test_id=mixed and student_id=student) <> 2 then
  raise exception 'Mixed gradebook numerator/denominator dropped unanswered MC';
 end if;
 result := public.return_test_attempts_checked_atomic(mixed, array[student], teacher);
 if result->>'returned_count' <> '1' then raise exception 'Graded mixed work not returned'; end if;
 -- Normalization must accept repeated IDs without a double-upsert conflict.
 perform public.update_test_student_access_atomic(mixed, array[student,student,absent], 'closed', teacher);
 if (select count(*) from public.test_student_availability where test_id=mixed) <> 2 then raise exception 'Duplicate selected IDs changed the access set'; end if;
 snapshot := jsonb_build_object('availability', (select jsonb_agg(to_jsonb(row) order by student_id) from public.test_student_availability row where test_id=mixed),
  'attempts', (select jsonb_agg(to_jsonb(row) order by id) from public.test_attempts row where test_id=mixed),
  'responses', (select jsonb_agg(to_jsonb(row) order by id) from public.test_responses row where test_id=mixed));
 -- One enrolled ID must not make a partially stale passed set acceptable.
 begin
  delete from public.classroom_enrollments where classroom_id='a2440000-0000-4000-8000-000000000010' and student_id=absent;
  perform public.update_test_student_access_atomic(mixed,array[student,absent],'open',teacher);
  raise exception 'Partial selected membership was accepted';
 exception when serialization_failure then null; end;
 begin
  update public.classrooms set archived_at=now() where id='a2440000-0000-4000-8000-000000000010';
  perform public.update_test_student_access_atomic(mixed,array[student],'open',teacher);
  raise exception 'Archived selected access was accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.update_test_student_access_atomic(mixed,array[student],'open',absent);
  raise exception 'Non-owner selected access was accepted';
 exception when insufficient_privilege then null; end;
 if jsonb_build_object('availability', (select jsonb_agg(to_jsonb(row) order by student_id) from public.test_student_availability row where test_id=mixed),
  'attempts', (select jsonb_agg(to_jsonb(row) order by id) from public.test_attempts row where test_id=mixed),
  'responses', (select jsonb_agg(to_jsonb(row) order by id) from public.test_responses row where test_id=mixed)) is distinct from snapshot then
  raise exception 'Rejected selected access changed availability/responses/closure/Return/revision';
 end if;
 select jsonb_agg(jsonb_build_object('response_id',id,'expected_response_revision',response.revision)) into expected
 from public.test_responses response where test_id=mixed and question_id='a2440000-0000-4000-8000-000000000103';
 select draft_revision into before_clear_revision from public.test_attempts where test_id=mixed and student_id=student;
 perform public.clear_test_open_response_grades_atomic(mixed, teacher, array[student], expected, now());
 if exists (select 1 from public.test_attempts where test_id=mixed and student_id=student and returned_at is not null) then raise exception 'Clear did not revoke disclosed work'; end if;
 if (select draft_revision from public.test_attempts where test_id=mixed and student_id=student) <= before_clear_revision then raise exception 'Revocation did not invalidate prior revision'; end if;
 result := public.return_test_attempts_checked_atomic(mixed, array[student], teacher);
 if result->>'skipped_count' <> '1' then raise exception 'Clear grades left stale Return eligibility'; end if;
 perform public.update_test_student_access_atomic(mixed, array[student], 'open', teacher);
 if exists (select 1 from public.test_responses response where test_id=mixed) then raise exception 'Reopen retained materialized closure rows'; end if;
 begin perform public.return_test_attempts_checked_atomic(mixed,array[student],teacher); raise exception 'Reopened attempt returned';
 exception when serialization_failure then null; end;
 perform public.start_test_attempt_revision_atomic(blank, student);
 perform public.close_test_for_grading_atomic(blank, teacher);
 if not exists (select 1 from public.test_responses where test_id=blank and selected_option is null and score=0) then raise exception 'Global closure omitted blank MC zero'; end if;
 result := public.return_test_attempts_checked_atomic(blank,array[student],teacher);
 if result->>'returned_count' <> '1' then raise exception 'Blank started closed attempt not returnable'; end if;
 perform public.finalize_test_attempts_for_grading_atomic(blank,array[student],teacher);
 if (select returned_at from public.test_attempts where test_id=blank and student_id=student) is null then raise exception 'Repeated closure revoked Return'; end if;
end;
$contract$;

-- The HTTP seed writes test_attempts directly as service_role. RPC-only calls
-- above run under their definer and cannot detect an invoker-trigger regression.
-- Use the existing disposable roots after the unstarted-student checks finish.
set local role service_role;
do $service_role_revision$
declare
 attempt_id uuid := 'a2440000-0000-4000-8000-000000000799';
 revision bigint;
 advanced bigint;
 current_revision bigint;
 recreated bigint;
begin
 if current_user <> 'service_role' then raise exception 'Revision probe is not running as service_role'; end if;
 if has_schema_privilege(current_user, 'private', 'USAGE') then
  raise exception 'Revision probe unexpectedly has private schema access';
 end if;
 if exists (
  select 1 from pg_catalog.pg_proc fn
  join pg_catalog.pg_namespace ns on ns.oid = fn.pronamespace
  where ns.nspname = 'private' and fn.proname = 'advance_test_attempt_draft_revision'
    and has_function_privilege(current_user, fn.oid, 'EXECUTE')
 ) then raise exception 'Revision probe unexpectedly has private allocator execution'; end if;

 -- Omit draft_revision exactly as the seed does: the early-bound default stays
 -- unchanged, while the trigger allocates a fresh revision under its owner.
 insert into public.test_attempts (id, test_id, student_id, responses)
 values (attempt_id, 'a2440000-0000-4000-8000-000000000011', 'a2440000-0000-4000-8000-000000000003', '{}'::jsonb)
 returning draft_revision into revision;
 if revision is null or revision < 1 or revision > 9007199254740991 then
  raise exception 'service-role default insert did not allocate a bounded revision';
 end if;
 update public.test_attempts set responses = jsonb_build_object(
  'a2440000-0000-4000-8000-000000000101', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1)
 ) where id = attempt_id returning draft_revision into advanced;
 if advanced is null or advanced <= revision then
  raise exception 'service-role response update did not advance revision';
 end if;
 update public.test_attempts set draft_revision = 0, updated_at = updated_at
 where id = attempt_id returning draft_revision into current_revision;
 if current_revision is distinct from advanced then
  raise exception 'service-role no-op/reset changed revision';
 end if;
 delete from public.test_attempts where id = attempt_id;
 insert into public.test_attempts (id, test_id, student_id, responses, draft_revision)
 values (attempt_id, 'a2440000-0000-4000-8000-000000000011', 'a2440000-0000-4000-8000-000000000003', '{}'::jsonb, 9007199254740991)
 returning draft_revision into recreated;
 if recreated is null or recreated <= advanced or recreated = 9007199254740991 then
  raise exception 'service-role recreate reused or accepted a supplied revision';
 end if;
end;
$service_role_revision$;
reset role;
\echo CORE244 service-role revision allocation and fencing: PASS
rollback;
