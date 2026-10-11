-- INERT rollback contracts260. Fresh exact-source disposable authority required.
-- Sequence allocations are not transactional; rows/catalogs are rolled back.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='1s';
set local statement_timeout='30s';
-- owner-recovery-fixture-begin
insert into public.users(id,email,role) values
 ('a2600000-0000-4000-8000-000000000001','owner260@example.invalid','student'),
 ('a2600000-0000-4000-8000-000000000002','member260@example.invalid','teacher'),
 ('a2600000-0000-4000-8000-000000000003','peer260@example.invalid','student'),
 ('a2600000-0000-4000-8000-000000000004','outsider260@example.invalid','teacher');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('a2600000-0000-4000-8000-000000000010','a2600000-0000-4000-8000-000000000001','Recovery260','RECOV260'),
 ('a2600000-0000-4000-8000-000000000019','a2600000-0000-4000-8000-000000000004','Other260','RECOV261');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('a2600000-0000-4000-8000-000000000010','a2600000-0000-4000-8000-000000000001'),
 ('a2600000-0000-4000-8000-000000000010','a2600000-0000-4000-8000-000000000002'),
 ('a2600000-0000-4000-8000-000000000010','a2600000-0000-4000-8000-000000000003');
insert into public.tests(id,classroom_id,title,status,created_by,points_possible,show_results) values
 ('a2600000-0000-4000-8000-000000000011','a2600000-0000-4000-8000-000000000010','Recovery','active','a2600000-0000-4000-8000-000000000004',2,false);
insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,answer_key,points,position) values
 ('a2600000-0000-4000-8000-000000000101','a2600000-0000-4000-8000-000000000011','open_response','Open','[]',null,'Synthetic answer',1,0),
 ('a2600000-0000-4000-8000-000000000102','a2600000-0000-4000-8000-000000000011','multiple_choice','MC','["A","B"]',0,null,1,1);
insert into public.test_attempts(id,test_id,student_id,is_submitted,submitted_at,responses) values
 ('a2600000-0000-4000-8000-000000000201','a2600000-0000-4000-8000-000000000011','a2600000-0000-4000-8000-000000000002',true,clock_timestamp(),'{}'),
 ('a2600000-0000-4000-8000-000000000202','a2600000-0000-4000-8000-000000000011','a2600000-0000-4000-8000-000000000003',true,clock_timestamp(),'{}');
insert into public.test_responses(id,test_id,question_id,student_id,response_text,selected_option,score,graded_at) values
 ('a2600000-0000-4000-8000-000000000301','a2600000-0000-4000-8000-000000000011','a2600000-0000-4000-8000-000000000101','a2600000-0000-4000-8000-000000000002','Synthetic one',null,0,clock_timestamp()),
 ('a2600000-0000-4000-8000-000000000302','a2600000-0000-4000-8000-000000000011','a2600000-0000-4000-8000-000000000102','a2600000-0000-4000-8000-000000000002',null,0,1,clock_timestamp()),
 ('a2600000-0000-4000-8000-000000000303','a2600000-0000-4000-8000-000000000011','a2600000-0000-4000-8000-000000000101','a2600000-0000-4000-8000-000000000003','Synthetic two',null,0,clock_timestamp()),
 ('a2600000-0000-4000-8000-000000000304','a2600000-0000-4000-8000-000000000011','a2600000-0000-4000-8000-000000000102','a2600000-0000-4000-8000-000000000003',null,0,1,clock_timestamp());
insert into public.test_student_availability(test_id,student_id,state,updated_by) values
 ('a2600000-0000-4000-8000-000000000011','a2600000-0000-4000-8000-000000000002','closed','a2600000-0000-4000-8000-000000000001'),
 ('a2600000-0000-4000-8000-000000000011','a2600000-0000-4000-8000-000000000003','closed','a2600000-0000-4000-8000-000000000001');
update public.tests set questions_locked_at=clock_timestamp() where id='a2600000-0000-4000-8000-000000000011';
-- owner-recovery-fixture-end
-- owner-recovery-contracts-begin
do $contracts$
#variable_conflict use_variable
declare
 owner_id uuid:='a2600000-0000-4000-8000-000000000001';member_id uuid:='a2600000-0000-4000-8000-000000000002';
 peer_id uuid:='a2600000-0000-4000-8000-000000000003';outsider_id uuid:='a2600000-0000-4000-8000-000000000004';
 class_id uuid:='a2600000-0000-4000-8000-000000000010';wrong_class uuid:='a2600000-0000-4000-8000-000000000019';
 test_id uuid:='a2600000-0000-4000-8000-000000000011';open_question uuid:='a2600000-0000-4000-8000-000000000101';
 run_id uuid:='a2600000-0000-4000-8000-000000000401';item_id uuid:='a2600000-0000-4000-8000-000000000501';
 expected_test jsonb;plan jsonb;payload jsonb;result jsonb;before_rows jsonb;after_rows jsonb;peer_before jsonb;
 attempt_id uuid;revision bigint;saved jsonb;snapshot jsonb;selected jsonb;operation text;run_state text;category_id uuid;
begin
 -- service-only-empty-search-path
 if has_function_privilege('anon','public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)','execute')
 or has_function_privilege('authenticated','public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)','execute')
 or not has_function_privilege('service_role','public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)','execute')
 or not exists(select 1 from pg_proc where oid='public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)'::regprocedure
  and prosecdef and proconfig @> array['search_path=""']) then raise exception 'Recovery ACL/search path differs';end if;
 result:=public.test_owner_workflow_v1(owner_id,test_id,null,'inspect','{}',null,clock_timestamp()+interval '25 seconds');expected_test:=result->'test';
 selected:=jsonb_build_object('student_ids',jsonb_build_array(member_id,outsider_id));
 -- mixed-role-current-owner / current-nonowner-selection
 plan:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit-plan',selected,expected_test,clock_timestamp()+interval '25 seconds');
 if plan#>'{result,eligible_student_ids}'<>jsonb_build_array(member_id) or jsonb_array_length(plan#>'{result,attempts}')<>1
 or plan#>>'{result,attempts,0,student_id}'<>member_id::text then raise exception 'Partial current roster plan differs';end if;
 begin update public.users set role='teacher' where id=owner_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit-plan',selected,expected_test,clock_timestamp()+interval '25 seconds');
  raise exception using errcode='ZX260',message='rollback owner role';exception when sqlstate 'ZX260' then null;end;
 begin perform public.test_owner_workflow_v1(member_id,test_id,class_id,'unsubmit-plan',selected,expected_test,clock_timestamp()+interval '25 seconds');
  raise exception 'Member accepted as owner';exception when sqlstate 'PT403' then null;end;
 begin perform public.test_owner_workflow_v1(outsider_id,test_id,class_id,'unsubmit-plan',selected,expected_test,clock_timestamp()+interval '25 seconds');
  raise exception 'Historical creator accepted';exception when sqlstate 'PT403' then null;end;
 foreach operation in array array['delete-single','delete-bulk'] loop
  begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,operation,jsonb_build_object('student_ids',jsonb_build_array(owner_id)),expected_test,clock_timestamp()+interval '25 seconds');
   raise exception 'Owner self enrollment deleted';exception when sqlstate 'PT400' then null;when sqlstate 'PT403' then null;end;
  begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,operation,jsonb_build_object('student_ids',jsonb_build_array(outsider_id)),expected_test,clock_timestamp()+interval '25 seconds');
   raise exception 'Unenrolled subject deleted';exception when sqlstate 'PT400' then null;when sqlstate 'PT403' then null;end;
 end loop;
 -- Setup ordinary triggered rows inside rollback only. Never reset the global revision sequence.
 snapshot:=jsonb_build_object(open_question::text,jsonb_build_object('question_type','open_response','response_text','Synthetic recovery answer'));
 update public.test_attempts a set responses=snapshot where a.test_id=test_id and a.student_id=member_id;
 select id,draft_revision,responses into attempt_id,revision,saved from public.test_attempts a where a.test_id=test_id and a.student_id=member_id;
 plan:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit-plan',selected,expected_test,clock_timestamp()+interval '25 seconds');
 payload:=(plan->'result')||jsonb_build_object('attempts',jsonb_build_array((plan#>'{result,attempts,0}')||jsonb_build_object(
  'snapshot',snapshot,'word_count',3,'char_count',char_length('{"'||open_question::text||'":{"question_type":"open_response","response_text":"Synthetic recovery answer"}}'),
  'paste_word_count',0,'keystroke_count',0)));
 -- source-revision-cas: current raw content and revision must both remain exact.
 before_rows:=(select jsonb_agg(to_jsonb(a) order by a.id) from public.test_attempts a where a.test_id=test_id);
 begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit',jsonb_set(payload,'{attempts,0,draft_revision}',to_jsonb(revision+1)),expected_test,clock_timestamp()+interval '25 seconds');
  raise exception 'Stale revision accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit',jsonb_set(payload,'{attempts,0,responses}','{}'),expected_test,clock_timestamp()+interval '25 seconds');
  raise exception 'Stale raw content accepted';exception when sqlstate 'PT409' then null;end;
 after_rows:=(select jsonb_agg(to_jsonb(a) order by a.id) from public.test_attempts a where a.test_id=test_id);
 if before_rows is distinct from after_rows then raise exception 'Rejected CAS changed attempts';end if;
 -- partial-unsubmit-counts / retained-draft-return-clear
 begin
  update public.test_responses r set score=0,graded_at=clock_timestamp() where r.test_id=test_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id)),expected_test,clock_timestamp()+interval '25 seconds');
  if (select a.returned_at from public.test_attempts a where a.id=attempt_id) is null then raise exception 'Return fixture not established';end if;
  plan:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit-plan',selected,expected_test,clock_timestamp()+interval '25 seconds');
  payload:=(plan->'result')||jsonb_build_object('attempts',jsonb_build_array((plan#>'{result,attempts,0}')||jsonb_build_object('snapshot',snapshot,'word_count',3,
   'char_count',char_length('{"'||open_question::text||'":{"question_type":"open_response","response_text":"Synthetic recovery answer"}}'),'paste_word_count',0,'keystroke_count',0)));
  result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit',payload,expected_test,clock_timestamp()+interval '25 seconds');
  if result#>>'{result,unsubmitted_count}'<>'1' or result#>>'{result,skipped_count}'<>'1' or result#>>'{result,skipped_enrollment_count}'<>'1'
  or result#>>'{result,history_written_count}'<>'1' or not exists(select 1 from public.test_attempts a where a.id=attempt_id and a.responses=saved
   and not a.is_submitted and a.submitted_at is null and a.returned_at is null and a.returned_by is null and a.closed_for_grading_at is null and a.closed_for_grading_by is null and a.draft_revision>revision)
  or exists(select 1 from public.test_responses r where r.test_id=test_id and r.student_id=member_id)
  or not exists(select 1 from public.test_student_availability a where a.test_id=test_id and a.student_id=member_id and a.state='closed')
  or not exists(select 1 from public.tests t where t.id=test_id and t.questions_locked_at is not null)
  or not exists(select 1 from public.test_attempt_history h where h.test_attempt_id=attempt_id and h.trigger='teacher_unsubmit' and h.snapshot=snapshot and h.word_count=3)
  then raise exception 'Unsubmit retained draft/counts/return/history differs';end if;
  begin perform public.test_learner_workflow_v1(member_id,test_id,class_id,'results','{}',clock_timestamp()+interval '25 seconds');raise exception 'Unsubmitted results disclosed';exception when sqlstate 'PT403' then null;end;
  raise exception using errcode='ZX260',message='rollback successful unsubmit';exception when sqlstate 'ZX260' then null;end;
 -- best-effort-history-failure: only history faults; successful work mutation survives.
 plan:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit-plan',selected,expected_test,clock_timestamp()+interval '25 seconds');
 payload:=(plan->'result')||jsonb_build_object('attempts',jsonb_build_array((plan#>'{result,attempts,0}')||jsonb_build_object('snapshot',snapshot,'word_count',3,
  'char_count',char_length('{"'||open_question::text||'":{"question_type":"open_response","response_text":"Synthetic recovery answer"}}'),'paste_word_count',0,'keystroke_count',0)));
 begin
  execute 'create function pg_temp.history_fault260() returns trigger language plpgsql as $fault$ begin raise exception using errcode=''55000'',message=''synthetic history failure'';end;$fault$';
  execute 'create trigger history_fault260 before insert on public.test_attempt_history for each row execute function pg_temp.history_fault260()';
  result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit',payload,expected_test,clock_timestamp()+interval '25 seconds');
  if result#>>'{result,unsubmitted_count}'<>'1' or result#>>'{result,history_written_count}'<>'0'
  or not exists(select 1 from public.test_attempts a where a.id=attempt_id and a.responses=saved and not a.is_submitted and a.draft_revision>revision)
  or exists(select 1 from public.test_responses r where r.test_id=test_id and r.student_id=member_id) then raise exception 'History fault rolled back successful unsubmit';end if;
  raise exception using errcode='ZX260',message='rollback history fault';exception when sqlstate 'ZX260' then null;end;
 -- single-delete-exact-cascade / bulk-delete-nontarget-preservation / zero-work-replay
 insert into public.test_attempt_history(test_attempt_id,snapshot,word_count,char_count,paste_word_count,keystroke_count,trigger)
 select a.id,'{}',0,2,0,0,'baseline' from public.test_attempts a where a.test_id=test_id;
 insert into public.test_focus_events(test_id,student_id,session_id,event_type) values(test_id,member_id,'recovery260','away_start'),(test_id,peer_id,'recovery260','away_start');
 insert into public.test_ai_grading_runs(id,test_id,status,triggered_by,model,selection_hash) values(run_id,test_id,'completed',owner_id,'synthetic','recovery260');
 insert into public.test_ai_grading_run_items(id,run_id,test_id,student_id,question_id,response_id,status)
 values(item_id,run_id,test_id,member_id,open_question,'a2600000-0000-4000-8000-000000000301','completed');
 peer_before:=jsonb_build_object('attempt',(select to_jsonb(a) from public.test_attempts a where a.test_id=test_id and a.student_id=peer_id),
  'responses',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_responses r where r.test_id=test_id and r.student_id=peer_id),
  'focus',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_focus_events r where r.test_id=test_id and r.student_id=peer_id),
  'history',(select jsonb_agg(to_jsonb(h) order by h.id) from public.test_attempt_history h join public.test_attempts a on a.id=h.test_attempt_id where a.test_id=test_id and a.student_id=peer_id));
 foreach operation in array array['delete-single','delete-bulk'] loop
  begin
   result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,operation,jsonb_build_object('student_ids',jsonb_build_array(member_id)),expected_test,clock_timestamp()+interval '25 seconds');
   if result#>>'{result,deleted_attempts}'<>'1' or result#>>'{result,deleted_responses}'<>'2' or result#>>'{result,deleted_focus_events}'<>'1' or result#>>'{result,deleted_ai_grading_items}'<>'1'
   or exists(select 1 from public.test_attempt_history h where h.test_attempt_id=attempt_id)
   or not exists(select 1 from public.test_student_availability a where a.test_id=test_id and a.student_id=member_id and a.state='closed')
   or (operation='delete-bulk' and (result#>>'{result,requested_count}'<>'1' or result#>>'{result,deleted_student_count}'<>'1')) then raise exception 'Exact delete counters/cascade/access differs';end if;
   if peer_before is distinct from jsonb_build_object('attempt',(select to_jsonb(a) from public.test_attempts a where a.test_id=test_id and a.student_id=peer_id),
    'responses',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_responses r where r.test_id=test_id and r.student_id=peer_id),
    'focus',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_focus_events r where r.test_id=test_id and r.student_id=peer_id),
    'history',(select jsonb_agg(to_jsonb(h) order by h.id) from public.test_attempt_history h join public.test_attempts a on a.id=h.test_attempt_id where a.test_id=test_id and a.student_id=peer_id)) then raise exception 'Delete changed non-target peer';end if;
   result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,operation,jsonb_build_object('student_ids',jsonb_build_array(member_id)),expected_test,clock_timestamp()+interval '25 seconds');
   if result#>>'{result,deleted_attempts}'<>'0' or result#>>'{result,deleted_responses}'<>'0' or result#>>'{result,deleted_focus_events}'<>'0' or result#>>'{result,deleted_ai_grading_items}'<>'0'
    or (operation='delete-bulk' and result#>>'{result,deleted_student_count}'<>'0') then raise exception 'Zero work replay differs';end if;
   raise exception using errcode='ZX260',message='rollback exact deletion';exception when sqlstate 'ZX260' then null;end;
 end loop;
 -- late-failure-rollback: a delete fault after earlier row changes restores every attempted-subject work table.
 before_rows:=jsonb_build_object('attempts',(select jsonb_agg(to_jsonb(a) order by a.id) from public.test_attempts a where a.test_id=test_id),
  'responses',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_responses r where r.test_id=test_id),'items',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_ai_grading_run_items r where r.test_id=test_id),
  'focus',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_focus_events r where r.test_id=test_id),
  'availability',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_student_availability r where r.test_id=test_id),
  'history',(select jsonb_agg(to_jsonb(h) order by h.id) from public.test_attempt_history h join public.test_attempts a on a.id=h.test_attempt_id where a.test_id=test_id));
 execute 'create function pg_temp.delete_fault260() returns trigger language plpgsql as $fault$ begin raise exception using errcode=''55000'',message=''synthetic late delete failure'';end;$fault$';
 execute 'create trigger delete_fault260 after delete on public.test_responses for each row execute function pg_temp.delete_fault260()';
 begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'delete-bulk',jsonb_build_object('student_ids',jsonb_build_array(member_id,peer_id)),expected_test,clock_timestamp()+interval '25 seconds');
  raise exception 'Late delete failure accepted';exception when sqlstate '55000' then null;when sqlstate 'PT503' then null;end;
 after_rows:=jsonb_build_object('attempts',(select jsonb_agg(to_jsonb(a) order by a.id) from public.test_attempts a where a.test_id=test_id),
  'responses',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_responses r where r.test_id=test_id),'items',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_ai_grading_run_items r where r.test_id=test_id),
  'focus',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_focus_events r where r.test_id=test_id),
  'availability',(select jsonb_agg(to_jsonb(r) order by r.id) from public.test_student_availability r where r.test_id=test_id),
  'history',(select jsonb_agg(to_jsonb(h) order by h.id) from public.test_attempt_history h join public.test_attempts a on a.id=h.test_attempt_id where a.test_id=test_id));
 if before_rows is distinct from after_rows then raise exception 'Late failure changed academic rows';end if;
 execute 'drop trigger delete_fault260 on public.test_responses';execute 'drop function pg_temp.delete_fault260()';
 -- active-ai-exclusion: completed history remains but queued/running exclude every operation.
 foreach run_state in array array['queued','running'] loop
  begin update public.test_ai_grading_runs set status=run_state where id=run_id;
   foreach operation in array array['unsubmit-plan','unsubmit','delete-single','delete-bulk'] loop
    begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,operation,case when operation='unsubmit' then payload else jsonb_build_object('student_ids',jsonb_build_array(member_id)) end,expected_test,clock_timestamp()+interval '25 seconds');
     raise exception 'Active AI recovery accepted';exception when sqlstate 'PT409' then null;end;
   end loop;
   raise exception using errcode='ZX260',message='rollback active AI';exception when sqlstate 'ZX260' then null;end;
 end loop;
 -- authority-archive-parent-purge: post-plan relationship and lifecycle checks are current.
 begin update public.classrooms set teacher_id=outsider_id where id=class_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit',payload,expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Transferred owner accepted';exception when sqlstate 'PT403' then null;end;
 begin update public.classrooms set archived_at=clock_timestamp() where id=class_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit',payload,expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Archived owner write accepted';exception when sqlstate 'PT403' then null;end;
 begin update public.tests set blueprint_archived_at=clock_timestamp() where id=test_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit',payload,expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Retired Test write accepted';exception when sqlstate 'PT403' then null;end;
 begin select id into strict category_id from public.gradebook_categories where classroom_id=wrong_class and is_default;
  update public.tests set classroom_id=wrong_class,gradebook_category_id=category_id where id=test_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit',payload,expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Moved Test accepted';exception when sqlstate 'PT409' then null;end;
 begin delete from public.classroom_enrollments where classroom_id=class_id and student_id=member_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit',payload,expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Removed planned member accepted';exception when sqlstate 'PT409' then null;end;
 begin perform set_config('pika.classroom_purge_finalize','on',true);
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'unsubmit',payload,expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Purge bypass accepted';exception when sqlstate 'PT403' then null;end;
end;$contracts$;
-- owner-recovery-contracts-end
rollback;
