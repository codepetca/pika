-- Rollback-only contracts after the complete migration replay on an owned,
-- disposable database. Fixture writes and temporary privilege changes roll back.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $acl$
declare signature text := 'public.test_learner_save_with_history_v1(uuid,uuid,text,jsonb,timestamptz)';
begin
  if has_function_privilege('anon',signature,'execute')
    or has_function_privilege('authenticated',signature,'execute')
    or not has_function_privilege('service_role',signature,'execute')
    or (select prosecdef from pg_proc where oid = signature::regprocedure) is distinct from false
    or has_function_privilege('service_role','private.test_learner_history_projection(public.test_attempt_history)','execute') then
    raise exception 'Combined save/history RPC or private helper ACL changed';
  end if;
end;
$acl$;
set local role anon;
do $anon$
begin
  begin
    perform public.test_learner_save_with_history_v1(null,null,'save','{}',clock_timestamp());
    raise exception 'anon executed save/history';
  exception when insufficient_privilege then null; end;
end;
$anon$;
reset role;
set local role authenticated;
do $authenticated$
begin
  begin
    perform public.test_learner_save_with_history_v1(null,null,'save','{}',clock_timestamp());
    raise exception 'authenticated executed save/history';
  exception when insufficient_privilege then null; end;
end;
$authenticated$;
reset role;

insert into public.users(id,email,role) values
 ('d3350000-0000-4000-8000-000000000001','owner335@example.test','student'),
 ('d3350000-0000-4000-8000-000000000002','member335@example.test','teacher'),
 ('d3350000-0000-4000-8000-000000000003','peer335@example.test','student'),
 ('d3350000-0000-4000-8000-000000000004','outsider335@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('d3350000-0000-4000-8000-000000000010','d3350000-0000-4000-8000-000000000001','History335','TEST335');
insert into public.classroom_enrollments(classroom_id,student_id)
 select 'd3350000-0000-4000-8000-000000000010'::uuid,id from public.users
 where id in ('d3350000-0000-4000-8000-000000000001','d3350000-0000-4000-8000-000000000002','d3350000-0000-4000-8000-000000000003');
insert into public.tests(id,classroom_id,title,status,created_by) values
 ('d3350000-0000-4000-8000-000000000011','d3350000-0000-4000-8000-000000000010','History335','draft','d3350000-0000-4000-8000-000000000001');
insert into public.test_questions(id,test_id,question_type,question_text,options,points,position) values
 ('d3350000-0000-4000-8000-000000000101','d3350000-0000-4000-8000-000000000011','open_response','Question','[]',1,0);
update public.tests set status = 'active' where id = 'd3350000-0000-4000-8000-000000000011';

set local role service_role;
do $save$
declare
  owner_id uuid := 'd3350000-0000-4000-8000-000000000001';
  member_id uuid := 'd3350000-0000-4000-8000-000000000002';
  outsider_id uuid := 'd3350000-0000-4000-8000-000000000004';
  tid uuid := 'd3350000-0000-4000-8000-000000000011';
  answers jsonb := '{"d3350000-0000-4000-8000-000000000101":{"question_type":"open_response","response_text":"saved335"}}';
  saved jsonb; result jsonb; plan jsonb; revision bigint; operation text;
begin
  foreach operation in array array['start','focus','history-plan','history-write','recover','inspect'] loop
    begin
      perform public.test_learner_save_with_history_v1(member_id,tid,operation,'{}',clock_timestamp()+interval '25 seconds');
      raise exception 'Combined boundary accepted operation %',operation;
    exception when sqlstate 'PT400' then null; end;
  end loop;
  begin
    perform public.test_learner_save_with_history_v1(member_id,tid,'save',jsonb_build_object('requested_student_id',member_id),clock_timestamp()+interval '25 seconds');
    raise exception 'Combined boundary accepted supplied subject';
  exception when sqlstate 'PT400' then null; end;
  begin
    perform public.test_learner_save_with_history_v1(member_id,tid,'save',jsonb_build_object('responses',answers,'expected_revision',0),clock_timestamp()-interval '1 second');
    raise exception 'Expired core mutation accepted';
  exception when sqlstate 'PT503' then null; end;
  foreach operation in array array['save','submit'] loop
    begin
      perform public.test_learner_save_with_history_v1(owner_id,tid,operation,jsonb_build_object('responses',answers,'expected_revision',0),clock_timestamp()+interval '25 seconds');
      raise exception 'Combined boundary bypassed owner precedence';
    exception when sqlstate 'PT403' then null; end;
    begin
      perform public.test_learner_save_with_history_v1(outsider_id,tid,operation,jsonb_build_object('responses',answers,'expected_revision',0),clock_timestamp()+interval '25 seconds');
      raise exception 'Combined boundary accepted nonmember';
    exception when sqlstate 'PT403' then null; end;
  end loop;

  result := public.test_learner_self_mutation_v1(member_id,tid,'start','{}',clock_timestamp()+interval '25 seconds');
  revision := (result#>>'{result,attempt,draft_revision}')::bigint;
  result := public.test_learner_save_with_history_v1(member_id,tid,'save',jsonb_build_object('responses',answers,'expected_revision',revision),clock_timestamp()+interval '25 seconds');
  saved := result#>'{mutation,result,attempt}';
  plan := (result->>'history')::jsonb;
  if jsonb_typeof(result->'history') is distinct from 'string'
    or result - array['mutation','history'] <> '{}'::jsonb
    or result#>>'{mutation,version}' is distinct from '1'
    or result#>>'{mutation,actor_id}' is distinct from member_id::text
    or result#>>'{mutation,subject_id}' is distinct from member_id::text
    or result#>>'{mutation,test_id}' is distinct from tid::text
    or result#>>'{mutation,classroom_id}' is distinct from 'd3350000-0000-4000-8000-000000000010'
    or result#>>'{mutation,operation}' is distinct from 'save'
    or saved->'responses' is distinct from answers
    or plan#>>'{attempt_id}' is distinct from saved->>'id'
    or plan#>'{draft_revision}' is distinct from saved->'draft_revision'
    or plan#>'{last_history}' is distinct from 'null'::jsonb
    or plan ? 'responses'
    or (result#>'{mutation,result}') - array['created','previous_responses','attempt'] <> '{}'::jsonb then
    raise exception 'Save witness or empty-history seed changed';
  end if;
  foreach operation in array array['save','submit'] loop
    result := public.test_learner_save_with_history_v1(member_id,tid,operation,jsonb_build_object('responses','{}'::jsonb,'expected_revision',revision),clock_timestamp()+interval '25 seconds');
    if result->'history' is distinct from 'null'::jsonb
      or result#>>'{mutation,result,conflict}' is distinct from 'true'
      or result#>'{mutation,result,attempt}' is distinct from saved then
      raise exception 'Stale % changed saved answers or exposed a history seed',operation;
    end if;
  end loop;
end;
$save$;
reset role;

-- Tie on created_at proves descending id selection; the peer's newer history
-- and the older own row with a greater id must never become this member's seed.
insert into public.test_attempts(id,test_id,student_id,responses) values
 ('d3350000-0000-4000-8000-000000000020','d3350000-0000-4000-8000-000000000011','d3350000-0000-4000-8000-000000000003','{}');
insert into public.test_attempt_history(id,test_attempt_id,patch,snapshot,word_count,char_count,paste_word_count,keystroke_count,trigger,created_at)
 select history.id,attempt.id,history.patch,history.snapshot,1,8,2,3,'autosave',history.created_at
 from public.test_attempts attempt cross join (values
   ('d3350000-0000-4000-8000-000000000501'::uuid,'[{"op":"add","path":"/older","value":1}]'::jsonb,null::jsonb,'2026-01-02'::timestamptz),
   ('d3350000-0000-4000-8000-000000000502'::uuid,null::jsonb,'{"exact":"latest"}'::jsonb,'2026-01-02'::timestamptz),
   ('d3350000-0000-4000-8000-000000000503'::uuid,null::jsonb,'{"older":"own"}'::jsonb,'2026-01-01'::timestamptz)
 ) history(id,patch,snapshot,created_at)
 where attempt.test_id='d3350000-0000-4000-8000-000000000011' and attempt.student_id='d3350000-0000-4000-8000-000000000002';
insert into public.test_attempt_history(id,test_attempt_id,snapshot,word_count,char_count,paste_word_count,keystroke_count,trigger,created_at) values
 ('d3350000-0000-4000-8000-000000000504','d3350000-0000-4000-8000-000000000020','{"private":"peer"}',1,8,0,0,'baseline','2026-01-03');

set local role service_role;
do $latest$
declare
  member_id uuid := 'd3350000-0000-4000-8000-000000000002';
  tid uuid := 'd3350000-0000-4000-8000-000000000011';
  class_id uuid := 'd3350000-0000-4000-8000-000000000010';
  attempt public.test_attempts%rowtype; result jsonb; plan jsonb; written jsonb;
begin
  select * into strict attempt from public.test_attempts where test_id=tid and student_id=member_id;
  result := public.test_learner_save_with_history_v1(member_id,tid,'save',jsonb_build_object('responses',attempt.responses,'expected_revision',attempt.draft_revision),clock_timestamp()+interval '25 seconds');
  if result->'history' is distinct from 'null'::jsonb
    or (result#>>'{mutation,result,attempt,draft_revision}')::bigint is distinct from attempt.draft_revision then
    raise exception 'Raw no-op save fetched history or changed the revision';
  end if;
  attempt.responses := jsonb_set(attempt.responses,'{d3350000-0000-4000-8000-000000000101,response_text}','"changed335"');
  result := public.test_learner_save_with_history_v1(member_id,tid,'save',jsonb_build_object('responses',attempt.responses,'expected_revision',attempt.draft_revision),clock_timestamp()+interval '25 seconds');
  plan := (result->>'history')::jsonb;
  if jsonb_typeof(result->'history') is distinct from 'string'
    or plan#>>'{last_history,id}' is distinct from 'd3350000-0000-4000-8000-000000000502'
    or plan#>'{last_history,snapshot}' is distinct from '{"exact":"latest"}'::jsonb
    or plan#>'{last_history,patch}' is distinct from 'null'::jsonb then
    raise exception 'Combined seed did not select actual latest own history';
  end if;
  -- Passing this exact seed into the unchanged CAS compares it with the private
  -- helper projection, proving every field and JSON null representation agrees.
  written := public.test_learner_workflow_v1(member_id,tid,class_id,'history-write',jsonb_build_object(
    'attempt_id',plan#>'{attempt_id}','draft_revision',plan#>'{draft_revision}',
    'expected_last',plan#>'{last_history}','collapse',false,'patch',null,'snapshot',attempt.responses,
    'trigger','baseline','word_count',1,'char_count',8,'paste_word_count',0,'keystroke_count',0),clock_timestamp()+interval '25 seconds');
  if written#>>'{result,historyEntry,id}' is null then raise exception 'Existing history CAS rejected inline seed'; end if;
end;
$latest$;
reset role;

-- Nested optional payload remains a separate text value in the outer JSON;
-- reading the mandatory acknowledgment never traverses this history snapshot.
insert into public.test_attempt_history(id,test_attempt_id,snapshot,word_count,char_count,paste_word_count,keystroke_count,trigger,created_at)
 select 'd3350000-0000-4000-8000-000000000506',id,(repeat('[',128)||'0'||repeat(']',128))::jsonb,0,0,0,0,'baseline',clock_timestamp()+interval '1 second'
 from public.test_attempts where test_id='d3350000-0000-4000-8000-000000000011' and student_id='d3350000-0000-4000-8000-000000000002';
set local role service_role;
do $optional_text$
declare
  member_id uuid := 'd3350000-0000-4000-8000-000000000002';
  tid uuid := 'd3350000-0000-4000-8000-000000000011';
  attempt public.test_attempts%rowtype; result jsonb; plan jsonb;
begin
  select * into strict attempt from public.test_attempts where test_id=tid and student_id=member_id;
  attempt.responses := jsonb_set(attempt.responses,'{d3350000-0000-4000-8000-000000000101,response_text}','"nested335"');
  result := public.test_learner_save_with_history_v1(member_id,tid,'save',jsonb_build_object('responses',attempt.responses,'expected_revision',attempt.draft_revision),clock_timestamp()+interval '25 seconds');
  plan := (result->>'history')::jsonb;
  if jsonb_typeof(result->'history') is distinct from 'string'
    or result#>'{history,last_history}' is not null
    or plan#>'{last_history,snapshot}' is distinct from (repeat('[',128)||'0'||repeat(']',128))::jsonb
    or result#>'{mutation,result,attempt,responses}' is distinct from attempt.responses
    or (result#>>'{mutation,result,attempt,draft_revision}')::bigint <= attempt.draft_revision
    or octet_length(result::text)>8388608 then
    raise exception 'Nested optional history was not separately encoded beside the core acknowledgment';
  end if;
end;
$optional_text$;
reset role;
delete from public.test_attempt_history where id='d3350000-0000-4000-8000-000000000506';

-- Optional source bounds must also preserve the already successful save.
insert into public.test_attempt_history(id,test_attempt_id,snapshot,word_count,char_count,paste_word_count,keystroke_count,trigger,created_at)
 select 'd3350000-0000-4000-8000-000000000505',id,jsonb_build_object('large',repeat('x',2097152)),0,0,0,0,'baseline',clock_timestamp()+interval '1 second'
 from public.test_attempts where test_id='d3350000-0000-4000-8000-000000000011' and student_id='d3350000-0000-4000-8000-000000000002';
set local role service_role;
do $optional_limit$
declare
  member_id uuid := 'd3350000-0000-4000-8000-000000000002';
  tid uuid := 'd3350000-0000-4000-8000-000000000011';
  attempt public.test_attempts%rowtype; result jsonb;
begin
  select * into strict attempt from public.test_attempts where test_id=tid and student_id=member_id;
  attempt.responses := jsonb_set(attempt.responses,'{d3350000-0000-4000-8000-000000000101,response_text}','"bounded335"');
  result := public.test_learner_save_with_history_v1(member_id,tid,'save',jsonb_build_object('responses',attempt.responses,'expected_revision',attempt.draft_revision),clock_timestamp()+interval '25 seconds');
  if result->'history' is distinct from 'null'::jsonb
    or result#>'{mutation,result,attempt,responses}' is distinct from attempt.responses
    or (result#>>'{mutation,result,attempt,draft_revision}')::bigint <= attempt.draft_revision
    or octet_length(result::text)>8388608 then
    raise exception 'Optional history source limit lost core save or exceeded wire budget';
  end if;
end;
$optional_limit$;
reset role;
delete from public.test_attempt_history where id='d3350000-0000-4000-8000-000000000505';

-- Real optional read failure, with the existing core mutation still authorized.
revoke select on public.test_attempt_history from service_role;
set local role service_role;
do $optional_failure$
declare
  member_id uuid := 'd3350000-0000-4000-8000-000000000002';
  tid uuid := 'd3350000-0000-4000-8000-000000000011';
  attempt public.test_attempts%rowtype; result jsonb; stored public.test_attempts%rowtype; previous jsonb;
begin
  select * into strict attempt from public.test_attempts where test_id=tid and student_id=member_id;
  previous := attempt.responses;
  attempt.responses := jsonb_set(attempt.responses,'{d3350000-0000-4000-8000-000000000101,response_text}','"failure335"');
  result := public.test_learner_save_with_history_v1(member_id,tid,'save',jsonb_build_object('responses',attempt.responses,'expected_revision',attempt.draft_revision),clock_timestamp()+interval '25 seconds');
  select * into strict stored from public.test_attempts where id=attempt.id;
  if result->'history' is distinct from 'null'::jsonb
    or stored.draft_revision <= attempt.draft_revision
    or result#>'{mutation,result,previous_responses}' is distinct from previous
    or result#>'{mutation,result,attempt,responses}' is distinct from stored.responses
    or (result#>>'{mutation,result,attempt,draft_revision}')::bigint is distinct from stored.draft_revision then
    raise exception 'Optional history failure rolled back, replayed or concealed the core save';
  end if;
end;
$optional_failure$;
reset role;
grant select on public.test_attempt_history to service_role;

set local role service_role;
do $submit$
declare
  member_id uuid := 'd3350000-0000-4000-8000-000000000002';
  tid uuid := 'd3350000-0000-4000-8000-000000000011';
  attempt public.test_attempts%rowtype; stored public.test_attempts%rowtype; result jsonb; plan jsonb; operation text;
begin
  select * into strict attempt from public.test_attempts where test_id=tid and student_id=member_id;
  result := public.test_learner_save_with_history_v1(member_id,tid,'submit',jsonb_build_object('responses',attempt.responses,'expected_revision',attempt.draft_revision),clock_timestamp()+interval '25 seconds');
  select * into strict stored from public.test_attempts where id=attempt.id;
  plan := (result->>'history')::jsonb;
  if jsonb_typeof(result->'history') is distinct from 'string' or not stored.is_submitted or stored.draft_revision <= attempt.draft_revision
    or result#>>'{mutation,operation}' is distinct from 'submit'
    or result#>>'{mutation,result,attempt_id}' is distinct from stored.id::text
    or result#>>'{mutation,result,inserted_responses}' is distinct from '1'
    or result#>'{mutation,result,draft_revision}' is distinct from to_jsonb(stored.draft_revision)
    or plan#>'{draft_revision}' is distinct from to_jsonb(stored.draft_revision)
    or plan#>>'{attempt_id}' is distinct from stored.id::text
    or plan#>'{responses}' is distinct from stored.responses
    or plan#>>'{last_history,trigger}' is distinct from 'baseline'
    or (result#>'{mutation,result}') - array['attempt_id','submitted_at','inserted_responses','draft_revision'] <> '{}'::jsonb then
    raise exception 'Submit witness/seed differs from the exact stored attempt';
  end if;
  foreach operation in array array['save','submit'] loop
    begin
      perform public.test_learner_save_with_history_v1(member_id,tid,operation,jsonb_build_object('responses','{}'::jsonb,'expected_revision',attempt.draft_revision),clock_timestamp()+interval '25 seconds');
      raise exception 'Closed participation returned stale conflict or history';
    exception when sqlstate 'PT403' then null; end;
  end loop;
end;
$submit$;
reset role;
rollback;
\echo 'Contextual save/history ACL, authority, latest-own seed, CAS, optional failure and submit: PASS'
