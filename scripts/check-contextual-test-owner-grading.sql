-- INERT SOURCE-ONLY contracts for258. Execute only with fresh exact-source
-- disposable authority. No canonical/shared/hosted execution is authorized.
-- Rollback covers rows, not sequence allocations. This single-session source
-- is not held-contention, committed cross-session freshness or SDK evidence.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='1s';
set local statement_timeout='30s';
-- owner-grading-fixture-begin
insert into public.users(id,email,role) values
 ('a2580000-0000-4000-8000-000000000001','owner258@example.invalid','student'),
 ('a2580000-0000-4000-8000-000000000002','member258@example.invalid','teacher'),
 ('a2580000-0000-4000-8000-000000000003','peer258@example.invalid','student'),
 ('a2580000-0000-4000-8000-000000000004','outsider258@example.invalid','teacher');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('a2580000-0000-4000-8000-000000000010','a2580000-0000-4000-8000-000000000001','Owner grade258','GRADE2580'),
 ('a2580000-0000-4000-8000-000000000019','a2580000-0000-4000-8000-000000000004','Other258','GRADE2581');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('a2580000-0000-4000-8000-000000000010','a2580000-0000-4000-8000-000000000001'),
 ('a2580000-0000-4000-8000-000000000010','a2580000-0000-4000-8000-000000000002'),
 ('a2580000-0000-4000-8000-000000000010','a2580000-0000-4000-8000-000000000003');
insert into public.tests(id,classroom_id,title,status,created_by,points_possible,show_results) values
 ('a2580000-0000-4000-8000-000000000011','a2580000-0000-4000-8000-000000000010','Owner grading','active','a2580000-0000-4000-8000-000000000004',2,false);
insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,answer_key,points,position) values
 ('a2580000-0000-4000-8000-000000000101','a2580000-0000-4000-8000-000000000011','open_response','Open synthetic','[]',null,'Synthetic answer',1,0),
 ('a2580000-0000-4000-8000-000000000102','a2580000-0000-4000-8000-000000000011','multiple_choice','MC synthetic','["A","B"]',0,null,1,1);
insert into public.test_attempts(id,test_id,student_id,is_submitted,submitted_at,responses) values
 ('a2580000-0000-4000-8000-000000000201','a2580000-0000-4000-8000-000000000011','a2580000-0000-4000-8000-000000000002',true,clock_timestamp(),'{}'),
 ('a2580000-0000-4000-8000-000000000202','a2580000-0000-4000-8000-000000000011','a2580000-0000-4000-8000-000000000003',true,clock_timestamp(),'{}');
insert into public.test_responses(id,test_id,question_id,student_id,response_text,selected_option,score,graded_at) values
 ('a2580000-0000-4000-8000-000000000301','a2580000-0000-4000-8000-000000000011','a2580000-0000-4000-8000-000000000101','a2580000-0000-4000-8000-000000000002','Synthetic one',null,null,null),
 ('a2580000-0000-4000-8000-000000000302','a2580000-0000-4000-8000-000000000011','a2580000-0000-4000-8000-000000000102','a2580000-0000-4000-8000-000000000002',null,0,1,clock_timestamp()),
 ('a2580000-0000-4000-8000-000000000303','a2580000-0000-4000-8000-000000000011','a2580000-0000-4000-8000-000000000101','a2580000-0000-4000-8000-000000000003','Synthetic two',null,null,null),
 ('a2580000-0000-4000-8000-000000000304','a2580000-0000-4000-8000-000000000011','a2580000-0000-4000-8000-000000000102','a2580000-0000-4000-8000-000000000003',null,0,1,clock_timestamp());
insert into public.test_student_availability(test_id,student_id,state,updated_by) values
 ('a2580000-0000-4000-8000-000000000011','a2580000-0000-4000-8000-000000000002','closed','a2580000-0000-4000-8000-000000000001'),
 ('a2580000-0000-4000-8000-000000000011','a2580000-0000-4000-8000-000000000003','closed','a2580000-0000-4000-8000-000000000001');
update public.tests set questions_locked_at=clock_timestamp() where id='a2580000-0000-4000-8000-000000000011';
-- owner-grading-fixture-end
-- owner-grading-contracts-begin
do $contracts$
#variable_conflict use_variable
declare
 owner_id uuid:='a2580000-0000-4000-8000-000000000001';
 member_id uuid:='a2580000-0000-4000-8000-000000000002';
 peer_id uuid:='a2580000-0000-4000-8000-000000000003';
 outsider_id uuid:='a2580000-0000-4000-8000-000000000004';
 class_id uuid:='a2580000-0000-4000-8000-000000000010';
 wrong_class uuid:='a2580000-0000-4000-8000-000000000019';
 test_id uuid:='a2580000-0000-4000-8000-000000000011';
 empty_test_id uuid:='a2580000-0000-4000-8000-000000000012';
 open_question uuid:='a2580000-0000-4000-8000-000000000101';
 open_response uuid:='a2580000-0000-4000-8000-000000000301';
 peer_response uuid:='a2580000-0000-4000-8000-000000000303';
 run_id uuid:='a2580000-0000-4000-8000-000000000401';
 expected_test jsonb;result jsonb;grade jsonb;before_rows jsonb;after_rows jsonb;
 revision bigint;returned_stamp timestamptz;returned_actor uuid;mc_before jsonb;
 ai_result jsonb;run_state text;mutation text;review_before jsonb;provenance_before jsonb;suggestion jsonb;
 fresh_test jsonb;nonfinite_rejected boolean:=false;
begin
 if has_function_privilege('anon','public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)','execute')
 or has_function_privilege('authenticated','public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)','execute')
 or not has_function_privilege('service_role','public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)','execute')
 then raise exception 'Owner grading ACL differs';end if;
 result:=public.test_owner_workflow_v1(owner_id,test_id,null,'inspect','{}',null,clock_timestamp()+interval '25 seconds');expected_test:=result->'test';
 -- Persist only synthetic already-produced suggestion metadata. No provider work,
 -- signing key or route token issuance occurs in this SQL proof.
 suggestion:=jsonb_build_object('response_id',open_response,'question_id',open_question,'expected_response_revision',1,'clear_grade',false,'score',1,'feedback','Synthetic AI suggestion',
  'ai_grading_basis','teacher_key','ai_reference_answers',null,'ai_model','contract-model','ai_suggested_score',1,'ai_suggested_feedback','Synthetic AI suggestion',
  'question_grading_snapshot',(select jsonb_build_object('test_title',t.title,'question_text',q.question_text,'points',q.points,'response_monospace',q.response_monospace,'answer_key',q.answer_key,'sample_solution',q.sample_solution) from public.test_questions q join public.tests t on t.id=q.test_id where q.id=open_question),
  'ai_grading_provenance',jsonb_build_object('schemaVersion','test-grading-provenance-v1','gradingRequestId',run_id,'provider','openai','model','contract-model',
   'policyVersion','pika-test-open-response-policy-v1','promptVersion','pika-test-open-response-manual-prompt-v1','gradingProfileVersion','pika-test-open-response-v1',
   'rubricVersion','pika-test-open-response-rubric-v1','operation','single','batchSize',1,'providerRequestCount',1,'tokenUsage',jsonb_build_object('inputTokens',100,'outputTokens',20,'totalTokens',120)));
 result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'manual-save',jsonb_build_object('student_id',member_id,'grades',jsonb_build_array(suggestion)),expected_test,clock_timestamp()+interval '25 seconds');
 if result#>>'{result,responses,0,revision}'<>'2' or (select r.ai_grading_review->>'reviewStatus' from public.test_responses r where r.id=open_response)<>'pending'
 then raise exception 'Suggestion provenance phase advanced revision twice or lost review';end if;
 -- current-nonowner-roster: both account roles, excluding self and outsiders.
 result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'results','{}',expected_test,clock_timestamp()+interval '25 seconds');
 if result->>'actor_id'<>owner_id::text or result->>'classroom_id'<>class_id::text or result->>'operation'<>'results'
 or (select array_agg(value::uuid order by value::uuid) from jsonb_array_elements_text(result#>'{result,student_ids}')) is distinct from (select array_agg(id order by id) from unnest(array[member_id,peer_id]) id)
 or exists(select 1 from jsonb_array_elements(result#>'{result,responses}') row where row->>'student_id' not in(member_id::text,peer_id::text))
 or jsonb_array_length(result#>'{result,questions}')<>2 or jsonb_array_length(result#>'{result,responses}')<>4
 or jsonb_array_length(result#>'{result,users}')<>2
 or exists(select 1 from jsonb_array_elements(result#>'{result,questions}') row where row ?| array['answer_key','sample_solution'])
 or exists(select 1 from jsonb_array_elements(result#>'{result,responses}') row where row ?| array['ai_grading_provenance','ai_grading_review','ai_provenance_token'])
 then raise exception 'current-nonowner-roster differs';end if;
 begin update public.users set role='teacher' where id=owner_id;
  result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'results','{}',expected_test,clock_timestamp()+interval '25 seconds');
  if result->>'actor_id'<>owner_id::text then raise exception 'Teacher-account owner witness differs';end if;
  raise exception using errcode='ZX258',message='Rollback owner account role';
 exception when sqlstate 'ZX258' then null;end;
 begin perform public.test_owner_workflow_v1(outsider_id,test_id,class_id,'results','{}',expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Historical creator accepted';exception when sqlstate 'PT403' then null;end;
 begin perform public.test_owner_workflow_v1(member_id,test_id,class_id,'results','{}',expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Member accepted as owner';exception when sqlstate 'PT403' then null;end;
 begin perform public.test_owner_workflow_v1(owner_id,test_id,wrong_class,'results','{}',expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Wrong parent accepted';exception when sqlstate 'PT409' then null;end;
 select r.revision into revision from public.test_responses r where r.id=open_response;
 grade:=jsonb_build_object('response_id',open_response,'question_id',open_question,'expected_response_revision',revision,'clear_grade',false,'score',0,'feedback','Synthetic manual feedback');
 -- late-batch-rollback: a late stale response cannot commit the earlier row.
 select jsonb_agg(to_jsonb(r) order by r.id) into before_rows from public.test_responses r where r.test_id=test_id;
 begin
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'manual-save',jsonb_build_object('student_id',member_id,'grades',jsonb_build_array(grade,
   jsonb_build_object('response_id','a2580000-0000-4000-8000-000000000302','question_id','a2580000-0000-4000-8000-000000000102','expected_response_revision',999,'clear_grade',false,'score',0,'feedback','Late stale'))),expected_test,clock_timestamp()+interval '25 seconds');
  raise exception 'Late stale batch accepted';
 exception when sqlstate 'PT409' then null;end;
 select jsonb_agg(to_jsonb(r) order by r.id) into after_rows from public.test_responses r where r.test_id=test_id;
 if after_rows is distinct from before_rows then raise exception 'late-batch-rollback changed rows';end if;
 -- answered-mc-clear: preserve the inherited trigger's normalized zero. This
 -- nested scope tests single clear, a mixed batch, and returned-work semantics
 -- without changing the fixture used by the remaining contracts.
 begin
  select r.revision into revision from public.test_responses r where r.id='a2580000-0000-4000-8000-000000000302';
  result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'manual-save',jsonb_build_object('student_id',null,'grades',jsonb_build_array(
   jsonb_build_object('response_id','a2580000-0000-4000-8000-000000000302','expected_response_revision',revision,'clear_grade',true,'score',null,'feedback',null))),expected_test,clock_timestamp()+interval '25 seconds');
  if result#>'{result,student_id}'<>'null'::jsonb or result#>>'{result,saved_count}'<>'1' or result#>>'{result,cleared_count}'<>'1'
   or (result#>>'{result,responses,0,score}')::numeric is distinct from 0::numeric
   or (result#>>'{result,responses,0,revision}')::bigint is distinct from revision+1
   or result#>'{result,responses,0,feedback}'<>'null'::jsonb
   or result#>'{result,clear_context}' is distinct from jsonb_build_array(jsonb_build_object('response_id','a2580000-0000-4000-8000-000000000302','question_id','a2580000-0000-4000-8000-000000000102','question_type','multiple_choice','selected_option',0))
   then raise exception 'Answered MC single clear differs';end if;
  result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'manual-save',jsonb_build_object('student_id',member_id,'grades',jsonb_build_array(
   jsonb_build_object('response_id','a2580000-0000-4000-8000-000000000302','question_id','a2580000-0000-4000-8000-000000000102','expected_response_revision',(select r.revision from public.test_responses r where r.id='a2580000-0000-4000-8000-000000000302'),'clear_grade',true,'score',null,'feedback',null),
   jsonb_build_object('response_id',open_response,'question_id',open_question,'expected_response_revision',(select r.revision from public.test_responses r where r.id=open_response),'clear_grade',false,'score',0,'feedback','Mixed MC clear/open edit'))),expected_test,clock_timestamp()+interval '25 seconds');
  if result#>>'{result,saved_count}'<>'2' or result#>>'{result,cleared_count}'<>'1'
   or (select r.score from public.test_responses r where r.id='a2580000-0000-4000-8000-000000000302') is distinct from 0::numeric
   or (select r.score from public.test_responses r where r.id=open_response) is distinct from 0::numeric
   or (select r.feedback from public.test_responses r where r.id=open_response) is distinct from 'Mixed MC clear/open edit'
   then raise exception 'Answered MC mixed clear/edit batch differs';end if;
  result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id)),expected_test,clock_timestamp()+interval '25 seconds');
  if result#>>'{result,returned_count}'<>'1' then raise exception 'Answered MC normalized zero is not return eligible';end if;
  select a.returned_at into returned_stamp from public.test_attempts a where a.test_id=test_id and a.student_id=member_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'manual-save',jsonb_build_object('student_id',member_id,'grades',jsonb_build_array(
   jsonb_build_object('response_id','a2580000-0000-4000-8000-000000000302','question_id','a2580000-0000-4000-8000-000000000102','expected_response_revision',(select r.revision from public.test_responses r where r.id='a2580000-0000-4000-8000-000000000302'),'clear_grade',true,'score',null,'feedback',null))),expected_test,clock_timestamp()+interval '25 seconds');
  if returned_stamp is null or (select a.returned_at from public.test_attempts a where a.test_id=test_id and a.student_id=member_id) is distinct from returned_stamp
   then raise exception 'Answered MC clear revoked complete return';end if;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'manual-save',jsonb_build_object('student_id',member_id,'grades',jsonb_build_array(
   jsonb_build_object('response_id',open_response,'question_id',open_question,'expected_response_revision',(select r.revision from public.test_responses r where r.id=open_response),'clear_grade',true,'score',null,'feedback',null))),expected_test,clock_timestamp()+interval '25 seconds');
  if (select r.score from public.test_responses r where r.id=open_response) is not null
   or (select a.returned_at from public.test_attempts a where a.test_id=test_id and a.student_id=member_id) is not null
   then raise exception 'Open clear did not revoke incomplete return';end if;
  raise exception using errcode='ZX258',message='Rollback answered MC clear';
 exception when sqlstate 'ZX258' then null;end;
 -- revision-provenance-review: manual edit preserves source suggestion metadata.
 select ai_grading_provenance,ai_grading_review into provenance_before,review_before from public.test_responses where id=open_response;
 result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'manual-save',jsonb_build_object('student_id',member_id,'grades',jsonb_build_array(grade)),expected_test,clock_timestamp()+interval '25 seconds');
 if result#>>'{result,saved_count}'<>'1' or result#>>'{result,student_id}'<>member_id::text
 or (result#>>'{result,responses,0,revision}')::bigint<=revision
 or (select ai_grading_provenance from public.test_responses where id=open_response) is distinct from provenance_before
 or (select r.ai_grading_review#>'{criteria,0,suggestedScore}' from public.test_responses r where r.id=open_response) is distinct from review_before#>'{criteria,0,suggestedScore}'
 or (select (r.ai_grading_review#>>'{criteria,0,finalScore}')::numeric from public.test_responses r where r.id=open_response) is distinct from 0::numeric
 then raise exception 'revision-provenance-review manual save differs';end if;
 -- Closed access is required even for a complete selection; refusal is atomic.
 begin update public.test_student_availability a set state='open' where a.test_id=test_id and a.student_id=member_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id,peer_id)),expected_test,clock_timestamp()+interval '25 seconds');
  raise exception 'Open selected access returned';exception when sqlstate 'PT409' then null;end;
 -- zero-return-idempotent: zero is eligible; replay never restamps or closes Test.
 result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id,peer_id)),expected_test,clock_timestamp()+interval '25 seconds');
 if result#>>'{result,returned_count}'<>'1' or result#>>'{result,skipped_count}'<>'1' or result#>'{result,test_closed}'<>'false'::jsonb
 or (select status from public.tests where id=test_id)<>'active' or (select show_results from public.tests where id=test_id)
 then raise exception 'zero-return-idempotent first differs';end if;
 select a.returned_at,a.returned_by into returned_stamp,returned_actor from public.test_attempts a where a.test_id=test_id and a.student_id=member_id;
 if returned_stamp is null or (select r.ai_grading_review->>'reviewStatus' from public.test_responses r where r.id=open_response)<>'reviewed'
 then raise exception 'Return lost review transition';end if;
 result:=public.test_learner_workflow_v1(member_id,test_id,class_id,'results','{}',clock_timestamp()+interval '25 seconds');
 if (result#>>'{result,summary,earned_points}')::numeric is distinct from 1::numeric or (result#>>'{result,summary,possible_points}')::numeric is distinct from 2::numeric
  then raise exception 'Returned zero/MC result disclosure differs with show_results false';end if;
 result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id)),expected_test,clock_timestamp()+interval '25 seconds');
 if result#>>'{result,already_returned_count}'<>'1' or (select a.returned_at from public.test_attempts a where a.test_id=test_id and a.student_id=member_id) is distinct from returned_stamp
 or (select a.returned_by from public.test_attempts a where a.test_id=test_id and a.student_id=member_id) is distinct from returned_actor then raise exception 'Replay restamped return';end if;
 select r.revision into revision from public.test_responses r where r.id=open_response;
 grade:=jsonb_set(grade,'{expected_response_revision}',to_jsonb(revision));grade:=jsonb_set(grade,'{feedback}','"Complete returned edit"');
 perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'manual-save',jsonb_build_object('student_id',member_id,'grades',jsonb_build_array(grade)),expected_test,clock_timestamp()+interval '25 seconds');
 if (select a.returned_at from public.test_attempts a where a.test_id=test_id and a.student_id=member_id) is distinct from returned_stamp then raise exception 'Complete edit revoked return';end if;
 -- clear-retracts-return and exact expected-set CAS; MC grade bytes survive.
 select to_jsonb(r) into mc_before from public.test_responses r where id='a2580000-0000-4000-8000-000000000302';
 begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'clear-open-grades',jsonb_build_object('student_ids',jsonb_build_array(member_id),'responses','[]'::jsonb),expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Incomplete expected clear set accepted';exception when sqlstate 'PT409' then null;end;
 select r.revision into revision from public.test_responses r where r.id=open_response;
 result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'clear-open-grades',jsonb_build_object('student_ids',jsonb_build_array(member_id),'responses',jsonb_build_array(jsonb_build_object('response_id',open_response,'expected_response_revision',revision))),expected_test,clock_timestamp()+interval '25 seconds');
 if result#>>'{result,cleared_responses}'<>'1' or (select a.returned_at from public.test_attempts a where a.test_id=test_id and a.student_id=member_id) is not null
 or (select r.ai_grading_review->>'reviewStatus' from public.test_responses r where r.id=open_response)<>'dismissed'
 or (select to_jsonb(r) from public.test_responses r where id='a2580000-0000-4000-8000-000000000302') is distinct from mc_before
 then raise exception 'clear-retracts-return or MC preservation differs';end if;
 begin perform public.test_learner_workflow_v1(member_id,test_id,class_id,'results','{}',clock_timestamp()+interval '25 seconds');raise exception 'Cleared grade still disclosed';exception when sqlstate 'PT403' then null;end;
 -- Minimal eligibility edge cases reuse these exact rows in rollback scopes.
 begin
  delete from public.classroom_enrollments e where e.classroom_id=class_id and e.student_id in(member_id,peer_id);
  result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'results','{}',expected_test,clock_timestamp()+interval '25 seconds');
  if result#>'{result,student_ids}'<>'[]'::jsonb or result#>'{result,responses}'<>'[]'::jsonb or result#>'{result,attempts}'<>'[]'::jsonb
   or result#>'{result,users}'<>'[]'::jsonb or result#>'{result,profiles}'<>'[]'::jsonb or result#>'{result,focus_events}'<>'[]'::jsonb
   or result#>'{result,availability}'<>'[]'::jsonb then raise exception 'Empty roster results source differs';end if;
  raise exception using errcode='ZX258',message='Rollback empty roster';
 exception when sqlstate 'ZX258' then null;end;
 begin
  -- Compressible logical source exceeds the one-MiB pre-aggregation budget,
  -- while staying below the separate two-MiB result budget. This distinguishes
  -- logical source accounting from TOAST/compressed physical tuple size.
  update public.test_attempts a set responses=jsonb_build_object(open_question::text,jsonb_build_object('question_type','open_response','response_text',repeat('x',1200000)))
   where a.test_id=test_id and a.student_id=peer_id;
  begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'results','{}',expected_test,clock_timestamp()+interval '25 seconds');
   raise exception 'Large compressible logical source was accepted';exception when sqlstate 'PT503' then null;end;
  raise exception using errcode='ZX258',message='Rollback expanded source bound';
 exception when sqlstate 'ZX258' then null;end;
 begin
  -- JSON string escaping expands180,000 control characters beyond the one-MiB
  -- logical source budget despite their much smaller raw text/physical size.
  update public.test_attempts a set responses=jsonb_build_object(open_question::text,jsonb_build_object('question_type','open_response','response_text',repeat(chr(1),180000)))
   where a.test_id=test_id and a.student_id=peer_id;
  begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'results','{}',expected_test,clock_timestamp()+interval '25 seconds');
   raise exception 'JSON escaped logical source was accepted';exception when sqlstate 'PT503' then null;end;
  raise exception using errcode='ZX258',message='Rollback JSON escaped source bound';
 exception when sqlstate 'ZX258' then null;end;
 begin
  -- Never delete or unlock started questions. This separate synthetic Test is
  -- empty from the outset, with ordinary triggers retained throughout.
  insert into public.tests(id,classroom_id,title,status,created_by,points_possible,show_results) values
   (empty_test_id,class_id,'Initially empty owner grading','active',owner_id,1,false);
  insert into public.test_attempts(id,test_id,student_id,is_submitted,submitted_at,responses) values
   ('a2580000-0000-4000-8000-000000000211',empty_test_id,member_id,true,clock_timestamp(),'{}'),
   ('a2580000-0000-4000-8000-000000000212',empty_test_id,peer_id,true,clock_timestamp(),'{}');
  insert into public.test_student_availability(test_id,student_id,state,updated_by) values
   (empty_test_id,member_id,'closed',owner_id),(empty_test_id,peer_id,'closed',owner_id);
  result:=public.test_owner_workflow_v1(owner_id,empty_test_id,null,'inspect','{}',null,clock_timestamp()+interval '25 seconds');fresh_test:=result->'test';
  result:=public.test_owner_workflow_v1(owner_id,empty_test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id,peer_id)),fresh_test,clock_timestamp()+interval '25 seconds');
  if result#>>'{result,returned_count}'<>'0' or result#>>'{result,already_returned_count}'<>'0' or result#>>'{result,skipped_count}'<>'2'
   or exists(select 1 from public.test_attempts a where a.test_id=empty_test_id and a.returned_at is not null) then raise exception 'No-question return eligibility differs';end if;
  raise exception using errcode='ZX258',message='Rollback no-question selection';
 exception when sqlstate 'ZX258' then null;end;
 begin
  select to_jsonb(r) into before_rows from public.test_responses r where r.id=open_response;
  begin update public.test_responses r set score='NaN'::numeric where r.id=open_response;
   exception when check_violation or invalid_parameter_value or numeric_value_out_of_range then nonfinite_rejected:=true;end;
  if nonfinite_rejected then
   if (select to_jsonb(r) from public.test_responses r where r.id=open_response) is distinct from before_rows then raise exception 'Nonfinite constraint rejection changed response';end if;
  else
   if (select r.score::text from public.test_responses r where r.id=open_response)<>'NaN' then raise exception 'Nonfinite fixture did not persist NaN';end if;
   result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id)),expected_test,clock_timestamp()+interval '25 seconds');
   if result#>>'{result,returned_count}'<>'0' or result#>>'{result,skipped_count}'<>'1'
    or (select a.returned_at from public.test_attempts a where a.test_id=test_id and a.student_id=member_id) is not null then raise exception 'Nonfinite return eligibility differs';end if;
  end if;
  raise exception using errcode='ZX258',message='Rollback nonfinite fixture';
 exception when sqlstate 'ZX258' then null;end;
 begin
  -- Preserve both current response IDs while simulating saved unfinished work.
  select r.revision into revision from public.test_responses r where r.id=peer_response;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'manual-save',jsonb_build_object('student_id',peer_id,'grades',jsonb_build_array(
   jsonb_build_object('response_id',peer_response,'question_id',open_question,'expected_response_revision',revision,'clear_grade',false,'score',0,'feedback','Synthetic closed draft grade'))),expected_test,clock_timestamp()+interval '25 seconds');
  update public.test_attempts a set is_submitted=false,submitted_at=null,closed_for_grading_at=null,closed_for_grading_by=null,
   responses=jsonb_build_object(open_question::text,jsonb_build_object('question_type','open_response','response_text','Synthetic saved unfinished work'),
     'a2580000-0000-4000-8000-000000000102',jsonb_build_object('question_type','multiple_choice','selected_option',0))
   where a.test_id=test_id and a.student_id=peer_id;
  update public.tests t set status='closed' where t.id=test_id;
  result:=public.test_owner_workflow_v1(owner_id,test_id,null,'inspect','{}',null,clock_timestamp()+interval '25 seconds');fresh_test:=result->'test';
  select jsonb_agg(to_jsonb(r) order by r.id) into before_rows from public.test_responses r where r.test_id=test_id and r.student_id=peer_id;
  result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(peer_id)),fresh_test,clock_timestamp()+interval '25 seconds');
  if result#>>'{result,returned_count}'<>'1' or result#>'{result,test_closed}'<>'false'::jsonb
   or not exists(select 1 from public.test_attempts a where a.test_id=test_id and a.student_id=peer_id and not a.is_submitted and a.closed_for_grading_at is not null and a.closed_for_grading_by=owner_id and a.returned_at is not null)
   or (select jsonb_agg(to_jsonb(r) order by r.id) from public.test_responses r where r.test_id=test_id and r.student_id=peer_id) is distinct from before_rows
   then raise exception 'Globally closed finalization or finite open/MC grades differ';end if;
  raise exception using errcode='ZX258',message='Rollback globally closed finalization';
 exception when sqlstate 'ZX258' then null;end;
 -- Every selected subject is current and nonowner; no partial acceptance.
 foreach mutation in array array['clear-open-grades','return'] loop
  begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,mutation,
   case when mutation='return' then jsonb_build_object('student_ids',jsonb_build_array(member_id,owner_id)) else jsonb_build_object('student_ids',jsonb_build_array(member_id,owner_id),'responses','[]'::jsonb) end,
   expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Owner selection accepted';exception when sqlstate 'PT400' then null;end;
 end loop;
 -- Parent, owner, roster and original-Test freshness refuse inside transaction.
 begin update public.classrooms set teacher_id=outsider_id where id=class_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id)),expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Transferred owner accepted';exception when sqlstate 'PT403' then null;end;
 begin update public.tests set classroom_id=wrong_class where id=test_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id)),expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Changed parent accepted';exception when sqlstate 'PT409' then null;end;
 begin delete from public.classroom_enrollments where classroom_id=class_id and student_id=member_id;
  result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'results','{}',expected_test,clock_timestamp()+interval '25 seconds');
  if result#>'{result,student_ids}' is distinct from jsonb_build_array(peer_id) or jsonb_array_length(result#>'{result,responses}')<>2
   or jsonb_array_length(result#>'{result,users}')<>1 then raise exception 'Removed roster result source differs';end if;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id)),expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Removed member accepted';exception when sqlstate 'PT400' then null;end;
 begin update public.tests set title='Stale original Test' where id=test_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id)),expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Stale Test witness accepted';exception when sqlstate 'PT409' then null;end;
 begin perform set_config('pika.identity_mapping','on',true);
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'results','{}',expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Identity mapping accepted';exception when sqlstate 'PT403' then null;end;
 begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'results','{}',expected_test,clock_timestamp()-interval '1 second');raise exception 'Expired deadline accepted';exception when sqlstate 'PT503' then null;end;
 -- Archived reads remain compatible; writes reject both archive sources.
 begin update public.classrooms set archived_at=clock_timestamp() where id=class_id;
  result:=public.test_owner_workflow_v1(owner_id,test_id,class_id,'results','{}',expected_test,clock_timestamp()+interval '25 seconds');
  if result->>'operation'<>'results' then raise exception 'Archived read witness differs';end if;
  begin perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id)),expected_test,clock_timestamp()+interval '25 seconds');raise exception 'Archived write accepted';exception when sqlstate 'PT403' then null;end;
  raise exception using errcode='ZX258',message='Rollback archived fixture';
 exception when sqlstate 'ZX258' then null;end;
 begin update public.tests set blueprint_archived_at=clock_timestamp() where id=test_id;
  perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'return',jsonb_build_object('student_ids',jsonb_build_array(member_id)),null,clock_timestamp()+interval '25 seconds');raise exception 'Blueprint archive write accepted';exception when sqlstate 'PT403' then null;end;
 -- active-ai-both-orders: creation first refuses every contextual write; manual
 -- first makes a stale creator reject and a fresh creator bind the new revision.
 foreach run_state in array array['queued','running'] loop
  begin
   insert into public.test_ai_grading_runs(id,test_id,status,triggered_by,model,selection_hash,requested_count,eligible_student_count,queued_response_count)
    values(run_id,test_id,run_state,owner_id,'synthetic-contract','owner-grade258',1,1,1);
   select jsonb_agg(to_jsonb(r) order by r.id) into before_rows from public.test_responses r where r.test_id=test_id;
   foreach mutation in array array['manual-save','clear-open-grades','return'] loop
    begin
     perform public.test_owner_workflow_v1(owner_id,test_id,class_id,mutation,
      case when mutation='manual-save' then jsonb_build_object('student_id',member_id,'grades',jsonb_build_array(jsonb_set(grade,'{expected_response_revision}',to_jsonb((select r.revision from public.test_responses r where r.id=open_response)))))
       when mutation='clear-open-grades' then jsonb_build_object('student_ids',jsonb_build_array(member_id),'responses',jsonb_build_array(jsonb_build_object('response_id',open_response,'expected_response_revision',(select r.revision from public.test_responses r where r.id=open_response))))
       else jsonb_build_object('student_ids',jsonb_build_array(member_id)) end,expected_test,clock_timestamp()+interval '25 seconds');
     raise exception 'Active AI mutation accepted';exception when sqlstate 'PT409' then null;end;
   end loop;
   select jsonb_agg(to_jsonb(r) order by r.id) into after_rows from public.test_responses r where r.test_id=test_id;
   if before_rows is distinct from after_rows or (select status from public.test_ai_grading_runs where id=run_id)<>run_state then raise exception 'Active AI rejection mutated rows';end if;
   raise exception using errcode='ZX258',message='Rollback synthetic active run';
  exception when sqlstate 'ZX258' then null;end;
 end loop;
 foreach run_state in array array['failed','completed'] loop
  begin
   insert into public.test_ai_grading_runs(id,test_id,status,triggered_by,model,selection_hash,requested_count,eligible_student_count,queued_response_count)
    values(run_id,test_id,run_state,owner_id,'synthetic-contract','inactive-owner-grade258',1,1,1);
   select r.revision into revision from public.test_responses r where r.id=open_response;
   perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'manual-save',jsonb_build_object('student_id',member_id,'grades',jsonb_build_array(jsonb_set(grade,'{expected_response_revision}',to_jsonb(revision)))),expected_test,clock_timestamp()+interval '25 seconds');
   raise exception using errcode='ZX258',message='Rollback inactive AI history';
  exception when sqlstate 'ZX258' then null;end;
 end loop;
 select r.revision into revision from public.test_responses r where r.id=open_response;
 grade:=jsonb_set(grade,'{expected_response_revision}',to_jsonb(revision));
 perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'manual-save',jsonb_build_object('student_id',member_id,'grades',jsonb_build_array(grade)),expected_test,clock_timestamp()+interval '25 seconds');
 begin
  perform public.create_test_ai_grading_run_atomic(test_id,owner_id,'synthetic-contract',array[member_id],array[member_id],'grade-first-stale',1,0,0,
   jsonb_build_array(jsonb_build_object('student_id',member_id,'question_id',open_question,'response_id',open_response,'response_revision',revision,'queue_position',0)),'[]',null);
  raise exception 'Stale AI creator accepted';exception when sqlstate 'PT409' or sqlstate '40001' then null;end;
 -- The real creator excludes already-graded work. Clear first; creator must use
 -- the newly observed revision, preserving manual-first source freshness.
 select r.revision into revision from public.test_responses r where r.id=open_response;
 perform public.test_owner_workflow_v1(owner_id,test_id,class_id,'clear-open-grades',jsonb_build_object('student_ids',jsonb_build_array(member_id),'responses',jsonb_build_array(jsonb_build_object('response_id',open_response,'expected_response_revision',revision))),expected_test,clock_timestamp()+interval '25 seconds');
 ai_result:=public.create_test_ai_grading_run_atomic(test_id,owner_id,'synthetic-contract',array[member_id],array[member_id],'grade-first-current',1,0,0,
  jsonb_build_array(jsonb_build_object('student_id',member_id,'question_id',open_question,'response_id',open_response,'response_revision',(select r.revision from public.test_responses r where r.id=open_response),'queue_position',0)),'[]',null);
 if ai_result->>'outcome'<>'created' or not exists(select 1 from public.test_ai_grading_run_items item join public.test_responses response on response.id=item.response_id where item.run_id=(ai_result->>'run_id')::uuid and item.response_revision=response.revision)
 then raise exception 'Manual-first AI creator source differs';end if;
end;
$contracts$;
-- owner-grading-contracts-end
select jsonb_build_object('checks',jsonb_build_array('current-nonowner-roster','late-batch-rollback','answered-mc-clear','revision-provenance-review','zero-return-idempotent','clear-retracts-return','empty-roster-source','logical-source-bound','no-question-return','nonfinite-eligibility-or-constraint','global-closed-finalization','authority-freshness','active-ai-both-orders')) as result;
rollback;
