-- SOURCE-ONLY regression contracts for257. Execute only in an explicitly
-- authorized disposable full-migration database, never canonical/shared/prod.
-- All fixture rows roll back; inherited sequence allocations do not roll back.
-- No real Storage bytes, signed delivery, concurrent locks or SDK proof here.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
insert into public.users(id,email,role) values
 ('a2570000-0000-4000-8000-000000000001','owner257@example.test','student'),
 ('a2570000-0000-4000-8000-000000000002','member257@example.test','teacher'),
 ('a2570000-0000-4000-8000-000000000003','peer257@example.test','student'),
 ('a2570000-0000-4000-8000-000000000004','departed257@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('a2570000-0000-4000-8000-000000000010','a2570000-0000-4000-8000-000000000001','Learner workflow257','CORE2570');
insert into public.classroom_enrollments(classroom_id,student_id)
 select 'a2570000-0000-4000-8000-000000000010'::uuid,id from public.users
 where id in ('a2570000-0000-4000-8000-000000000001','a2570000-0000-4000-8000-000000000002',
   'a2570000-0000-4000-8000-000000000003','a2570000-0000-4000-8000-000000000004');
insert into public.tests(id,classroom_id,title,status,points_possible,created_by) values
 ('a2570000-0000-4000-8000-000000000011','a2570000-0000-4000-8000-000000000010','Participation','draft',5,'a2570000-0000-4000-8000-000000000001'),
 ('a2570000-0000-4000-8000-000000000012','a2570000-0000-4000-8000-000000000010','Closed recovery','closed',1,'a2570000-0000-4000-8000-000000000001');
insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,points,position) values
 ('a2570000-0000-4000-8000-000000000101','a2570000-0000-4000-8000-000000000011','multiple_choice','Answer','["A","B"]',1,5,0);
update public.tests set status='active' where id='a2570000-0000-4000-8000-000000000011';
insert into public.test_attempts(test_id,student_id,responses) values
 ('a2570000-0000-4000-8000-000000000012','a2570000-0000-4000-8000-000000000002','{}');

do $contracts$
#variable_conflict use_variable
declare
 owner_id uuid := 'a2570000-0000-4000-8000-000000000001';
 member_id uuid := 'a2570000-0000-4000-8000-000000000002';
 peer_id uuid := 'a2570000-0000-4000-8000-000000000003';
 departed_id uuid := 'a2570000-0000-4000-8000-000000000004';
 class_id uuid := 'a2570000-0000-4000-8000-000000000010';
 test_id uuid := 'a2570000-0000-4000-8000-000000000011';
 closed_id uuid := 'a2570000-0000-4000-8000-000000000012';
 question_id uuid := 'a2570000-0000-4000-8000-000000000101';
 result jsonb; plan jsonb; saved jsonb; answers jsonb; old_history jsonb; revision bigint; attempt_id uuid;
 history_id uuid; signature text := 'public.test_learner_workflow_v1(uuid,uuid,uuid,text,jsonb,timestamptz)';
begin
 if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
   or not has_function_privilege('service_role',signature,'execute') then raise exception 'Learner RPC privilege changed'; end if;
 result := public.test_learner_workflow_v1(member_id,test_id,null,'inspect','{}',clock_timestamp()+interval '25 seconds');
 if result->>'actor_id' <> member_id::text or result->>'subject_id' <> member_id::text
   or result->>'classroom_id' <> class_id::text or result#>>'{result,access_mode}' <> 'member' then raise exception 'Role-neutral witness changed'; end if;
 begin
   perform public.test_learner_workflow_v1(owner_id,test_id,null,'inspect','{}',clock_timestamp()+interval '25 seconds');
   raise exception 'Self-enrolled owner received learner authority';
 exception when sqlstate 'PT403' then null; end;
 begin
   perform public.test_learner_workflow_v1(member_id,test_id,null,'inspect',jsonb_build_object('requested_student_id',peer_id),clock_timestamp()+interval '25 seconds');
   raise exception 'Member subject substitution accepted';
 exception when sqlstate 'PT403' then null; end;
 begin
   perform public.test_learner_workflow_v1(member_id,test_id,closed_id,'inspect','{}',clock_timestamp()+interval '25 seconds');
   raise exception 'Parent substitution accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
   perform public.test_learner_workflow_v1(member_id,test_id,class_id,'inspect','{}',clock_timestamp()-interval '1 second');
   raise exception 'Expired SQL deadline accepted';
 exception when sqlstate 'PT503' then null; end;

 result := public.test_learner_workflow_v1(member_id,test_id,class_id,'start','{}',clock_timestamp()+interval '25 seconds');
 revision := (result#>>'{result,attempt,draft_revision}')::bigint;
 attempt_id := (result#>>'{result,attempt,id}')::uuid;
 if result#>'{result,questions,0}' ?| array['correct_option','sample_solution','score','feedback','ai_reference_answers']
   or result#>'{result,attempt}' ?| array['returned_at','closed_for_grading_at'] then raise exception 'Pre-return projection disclosed private fields'; end if;
 answers := jsonb_build_object(question_id::text,jsonb_build_object('question_type','multiple_choice','selected_option',1));
 result := public.test_learner_workflow_v1(member_id,test_id,class_id,'save',jsonb_build_object('responses',answers,'expected_revision',revision),clock_timestamp()+interval '25 seconds');
 saved := result#>'{result,attempt}';
 result := public.test_learner_workflow_v1(member_id,test_id,class_id,'save',jsonb_build_object('responses','{}'::jsonb,'expected_revision',revision),clock_timestamp()+interval '25 seconds');
 if result#>>'{result,conflict}' <> 'true' or result#>'{result,attempt}' is distinct from saved then raise exception 'Current open stale conflict changed own saved work'; end if;
 -- Mutation/revision commits independently; best-effort history has a separate
 -- exact-attempt/revision + last-entry CAS, not an atomic rollback requirement.
 revision := (saved->>'draft_revision')::bigint;
 plan := public.test_learner_workflow_v1(member_id,test_id,class_id,'history-plan',jsonb_build_object('attempt_id',attempt_id,'draft_revision',revision),clock_timestamp()+interval '25 seconds');
 result := public.test_learner_workflow_v1(member_id,test_id,class_id,'history-write',jsonb_build_object(
   'attempt_id',attempt_id,'draft_revision',revision,'expected_last',plan#>'{result,last_history}','collapse',false,
   'patch',null,'snapshot',answers,'trigger','baseline','word_count',1,'char_count',96,'paste_word_count',0,'keystroke_count',0),clock_timestamp()+interval '25 seconds');
 history_id := (result#>>'{result,historyEntry,id}')::uuid;
 if history_id is null or result#>'{result,historyEntry,snapshot}' is distinct from answers then raise exception 'Exact history baseline not written'; end if;
 begin
   perform public.test_learner_workflow_v1(member_id,test_id,class_id,'history-write',jsonb_build_object(
     'attempt_id',attempt_id,'draft_revision',revision,'expected_last',null,'collapse',false,'patch',null,'snapshot',answers,
     'trigger','baseline','word_count',1,'char_count',96,'paste_word_count',0,'keystroke_count',0),clock_timestamp()+interval '25 seconds');
   raise exception 'Stale last-entry history CAS accepted';
 exception when sqlstate 'PT409' then null; end;
 plan := public.test_learner_workflow_v1(member_id,test_id,class_id,'history-plan',jsonb_build_object('attempt_id',attempt_id,'draft_revision',revision),clock_timestamp()+interval '25 seconds');
 begin
   perform public.test_learner_workflow_v1(member_id,test_id,class_id,'history-write',jsonb_build_object(
     'attempt_id',attempt_id,'draft_revision',revision,'expected_last',plan#>'{result,last_history}','collapse',false,'patch',null,'snapshot','{}'::jsonb,
     'trigger','baseline','word_count',0,'char_count',2,'paste_word_count',0,'keystroke_count',0),clock_timestamp()+interval '25 seconds');
   raise exception 'Wrong post-revision history snapshot accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
   perform public.test_learner_workflow_v1(member_id,test_id,class_id,'history-plan',jsonb_build_object('attempt_id',attempt_id,'draft_revision',revision-1),clock_timestamp()+interval '25 seconds');
   raise exception 'Stale history revision accepted';
 exception when sqlstate 'PT409' then null; end;
 -- Expiry is distinct from last-entry CAS: pass the exact current old tuple,
 -- retain the production10s cutoff, and require a refusal without any mutation.
 update public.test_attempt_history set created_at=clock_timestamp()-interval '11 seconds' where test_attempt_id=attempt_id;
 select jsonb_agg(to_jsonb(history) order by history.id) into old_history from public.test_attempt_history history where history.test_attempt_id=attempt_id;
 plan := public.test_learner_workflow_v1(member_id,test_id,class_id,'history-plan',jsonb_build_object('attempt_id',attempt_id,'draft_revision',revision),clock_timestamp()+interval '25 seconds');
 if (plan#>>'{result,last_history,created_at}')::timestamptz>clock_timestamp()-interval '10 seconds' then raise exception 'Expired collapse fixture was not old'; end if;
 begin
   perform public.test_learner_workflow_v1(member_id,test_id,class_id,'history-write',jsonb_build_object(
     'attempt_id',attempt_id,'draft_revision',revision,'expected_last',plan#>'{result,last_history}','collapse',true,
     'patch',null,'snapshot',answers,'trigger','autosave','word_count',1,'char_count',96,'paste_word_count',0,'keystroke_count',1),clock_timestamp()+interval '25 seconds');
   raise exception 'Expired history collapse accepted';
 exception when sqlstate 'PT409' then null; end;
 if (select jsonb_agg(to_jsonb(history) order by history.id) from public.test_attempt_history history where history.test_attempt_id=attempt_id) is distinct from old_history
   or (select responses from public.test_attempts where id=attempt_id) is distinct from answers
   or (select draft_revision from public.test_attempts where id=attempt_id) is distinct from revision then raise exception 'Expired history collapse changed saved work'; end if;
 result := public.test_learner_workflow_v1(member_id,test_id,class_id,'focus','{"event_type":"away_start","session_id":"role-neutral","metadata":null}',clock_timestamp()+interval '25 seconds');
 if result#>>'{result,event_id}' is null or jsonb_array_length(result#>'{result,focus_events}') <> 1 then raise exception 'Teacher-role member focus event missing'; end if;

 -- Each refusal is a subtransaction; its fixture revocation also rolls back.
 begin
   delete from public.classroom_enrollments where classroom_id=class_id and student_id=member_id;
   perform public.test_learner_workflow_v1(member_id,test_id,class_id,'save',jsonb_build_object('responses','{}'::jsonb,'expected_revision',revision-1),clock_timestamp()+interval '25 seconds');
   raise exception 'Revoked stale save disclosed conflict';
 exception when sqlstate 'PT403' then null; end;
 begin
   update public.classrooms set feature_visibility='{"tests":false}' where id=class_id;
   perform public.test_learner_workflow_v1(member_id,test_id,class_id,'submit',jsonb_build_object('responses',answers,'expected_revision',revision-1),clock_timestamp()+interval '25 seconds');
   raise exception 'Hidden stale submit disclosed conflict';
 exception when sqlstate 'PT403' then null; end;
 begin
   update public.classrooms set archived_at=clock_timestamp() where id=class_id;
   perform public.test_learner_workflow_v1(member_id,test_id,class_id,'recover','{}',clock_timestamp()+interval '25 seconds');
   raise exception 'Archived member recovery accepted';
 exception when sqlstate 'PT403' then null; end;
 begin
   perform set_config('pika.identity_mapping','on',true);
   perform public.test_learner_workflow_v1(member_id,test_id,class_id,'recover','{}',clock_timestamp()+interval '25 seconds');
   raise exception 'Identity mapping disclosed attempt';
 exception when sqlstate 'PT403' then null; end;
 begin
   insert into public.test_student_availability(test_id,student_id,state,updated_by) values(test_id,member_id,'closed',owner_id);
   perform public.test_learner_workflow_v1(member_id,test_id,class_id,'save',jsonb_build_object('responses','{}'::jsonb,'expected_revision',revision-1),clock_timestamp()+interval '25 seconds');
   raise exception 'Closed stale save disclosed conflict';
 exception when sqlstate 'PT403' then null; end;
 if (select responses from public.test_attempts where id=attempt_id) is distinct from answers
   or (select count(*) from public.test_attempt_history where test_attempt_id=attempt_id) <> 1 then raise exception 'Refusal mutated answers/history'; end if;

 result := public.test_learner_workflow_v1(member_id,closed_id,class_id,'recover','{}',clock_timestamp()+interval '25 seconds');
 if result#>>'{result,attempt,id}' is null then raise exception 'Closed unsubmitted recovery lost'; end if;
 begin
   perform public.test_learner_workflow_v1(member_id,closed_id,class_id,'detail','{}',clock_timestamp()+interval '25 seconds');
   raise exception 'Closed unsubmitted detail became accessible';
 exception when sqlstate 'PT404' then null; end;

 result := public.test_learner_workflow_v1(member_id,test_id,class_id,'submit',jsonb_build_object('responses',answers,'expected_revision',revision),clock_timestamp()+interval '25 seconds');
 if result#>>'{result,draft_revision}' is null or (select count(*) from public.test_responses response where response.test_id=test_id and response.student_id=member_id) <> 1 then raise exception 'Submit did not materialize own answers'; end if;
 begin
   perform public.test_learner_workflow_v1(member_id,test_id,class_id,'results','{}',clock_timestamp()+interval '25 seconds');
   raise exception 'Unreturned results disclosed';
 exception when sqlstate 'PT403' then null; end;
 -- Current-roster aggregate excludes a returned former member. Real return/
 -- grade authorization remains the inherited244 transaction, not fixture SQL.
 perform public.start_test_attempt_revision_atomic(test_id,peer_id);
 perform public.start_test_attempt_revision_atomic(test_id,departed_id);
 -- Inherited legacy entrypoints can construct the historical self-enrolled
 -- owner shape. Contextual participation denies it, aggregates must omit it.
 perform public.start_test_attempt_revision_atomic(test_id,owner_id);
 select attempt.draft_revision into revision from public.test_attempts attempt where attempt.test_id=test_id and attempt.student_id=peer_id;
 perform public.submit_test_attempt_revision_atomic(test_id,peer_id,answers,revision,clock_timestamp());
 select attempt.draft_revision into revision from public.test_attempts attempt where attempt.test_id=test_id and attempt.student_id=departed_id;
 perform public.submit_test_attempt_revision_atomic(test_id,departed_id,answers,revision,clock_timestamp());
 select attempt.draft_revision into revision from public.test_attempts attempt where attempt.test_id=test_id and attempt.student_id=owner_id;
 perform public.submit_test_attempt_revision_atomic(test_id,owner_id,answers,revision,clock_timestamp());
 perform public.update_test_student_access_atomic(test_id,array[member_id,peer_id,departed_id,owner_id],'closed',owner_id);
 perform public.return_test_attempts_checked_atomic(test_id,array[member_id,peer_id,departed_id,owner_id],owner_id);
 if not exists(select 1 from public.test_attempts attempt where attempt.test_id=test_id and attempt.student_id=owner_id and returned_at is not null) then
   raise exception 'Returned self-enrolled owner exclusion fixture missing'; end if;
 delete from public.classroom_enrollments where classroom_id=class_id and student_id=departed_id;
 result := public.test_learner_workflow_v1(member_id,test_id,class_id,'results','{}',clock_timestamp()+interval '25 seconds');
 if result#>>'{result,results,0,total_responses}' <> '2' or result#>>'{result,question_results,0,correct_option}' <> '1'
   or result::text like '%ai_reference_answers%' or result::text like '%student_id%' then raise exception 'Returned projection/current roster aggregate changed'; end if;
 update public.classrooms set archived_at=clock_timestamp() where id=class_id;
 result := public.test_learner_workflow_v1(owner_id,test_id,null,'inspect',jsonb_build_object('requested_student_id',member_id),clock_timestamp()+interval '25 seconds');
 result := public.test_learner_workflow_v1(owner_id,test_id,class_id,'history',jsonb_build_object('requested_student_id',member_id),clock_timestamp()+interval '25 seconds');
 if result#>>'{result,attemptId}' <> attempt_id::text or jsonb_array_length(result#>'{result,history}')<1 then raise exception 'Archived owner inspection lost'; end if;
end;
$contracts$;
rollback;
