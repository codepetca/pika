-- Rollback-only checks on an isolated database after the 334 replay.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $acl$
declare signature text := 'public.test_learner_self_mutation_v1(uuid,uuid,text,jsonb,timestamptz)';
begin
  if has_function_privilege('anon',signature,'execute')
    or has_function_privilege('authenticated',signature,'execute')
    or not has_function_privilege('service_role',signature,'execute')
    or (select prosecdef from pg_proc where oid = signature::regprocedure) is distinct from false then
    raise exception 'Contextual self-mutation RPC access changed';
  end if;
end;
$acl$;

insert into public.users(id,email,role) values
 ('d3340000-0000-4000-8000-000000000001','owner334@example.test','student'),
 ('d3340000-0000-4000-8000-000000000002','member334@example.test','teacher'),
 ('d3340000-0000-4000-8000-000000000003','nonmember334@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('d3340000-0000-4000-8000-000000000010','d3340000-0000-4000-8000-000000000001','Mutation334','TEST334');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('d3340000-0000-4000-8000-000000000010','d3340000-0000-4000-8000-000000000001'),
 ('d3340000-0000-4000-8000-000000000010','d3340000-0000-4000-8000-000000000002');
insert into public.tests(id,classroom_id,title,status,created_by) values
 ('d3340000-0000-4000-8000-000000000011','d3340000-0000-4000-8000-000000000010','Mutation334','draft','d3340000-0000-4000-8000-000000000001');
insert into public.test_questions(id,test_id,question_type,question_text,options,points,position) values
 ('d3340000-0000-4000-8000-000000000101','d3340000-0000-4000-8000-000000000011','open_response','Question','[]',1,0);
update public.tests set status = 'active' where id = 'd3340000-0000-4000-8000-000000000011';

set local role service_role;
do $mutation$
declare
  owner_id uuid := 'd3340000-0000-4000-8000-000000000001';
  member_id uuid := 'd3340000-0000-4000-8000-000000000002';
  outsider_id uuid := 'd3340000-0000-4000-8000-000000000003';
  class_id uuid := 'd3340000-0000-4000-8000-000000000010';
  tid uuid := 'd3340000-0000-4000-8000-000000000011';
  qid uuid := 'd3340000-0000-4000-8000-000000000101';
  deadline timestamptz := clock_timestamp() + interval '25 seconds';
  answers jsonb := jsonb_build_object(qid::text,jsonb_build_object('question_type','open_response','response_text','saved334'));
  result jsonb; saved jsonb; started_revision integer; operation text;
begin
  begin
    perform public.test_learner_self_mutation_v1(member_id,tid,'inspect','{}',deadline);
    raise exception 'Self-mutation exposed another operation';
  exception when sqlstate 'PT400' then null; end;
  begin
    perform public.test_learner_self_mutation_v1(member_id,tid,'start',jsonb_build_object('requested_student_id',member_id),deadline);
    raise exception 'Self-mutation accepted a supplied subject';
  exception when sqlstate 'PT400' then null; end;
  begin
    perform public.test_learner_self_mutation_v1(owner_id,tid,'start','{}',deadline);
    raise exception 'Owner precedence was bypassed';
  exception when sqlstate 'PT403' then null; end;
  begin
    perform public.test_learner_self_mutation_v1(outsider_id,tid,'start','{}',deadline);
    raise exception 'Nonmember accepted';
  exception when sqlstate 'PT403' then null; end;
  begin
    perform public.test_learner_self_mutation_v1(member_id,tid,'start','{}',clock_timestamp()-interval '1 second');
    raise exception 'Expired deadline accepted';
  exception when sqlstate 'PT503' then null; end;
  perform set_config('pika.identity_mapping','on',true);
  begin
    perform public.test_learner_self_mutation_v1(member_id,tid,'start','{}',deadline);
    raise exception 'Identity maintenance fence bypassed';
  exception when sqlstate 'PT403' then null; end;
  perform set_config('pika.identity_mapping','off',true);

  result := public.test_learner_self_mutation_v1(member_id,tid,'start','{}',deadline);
  started_revision := (result#>>'{result,attempt,draft_revision}')::integer;
  if result->>'actor_id' is distinct from member_id::text or result->>'subject_id' is distinct from member_id::text
    or result->>'classroom_id' is distinct from class_id::text or result->>'test_id' is distinct from tid::text
    or result->>'operation' is distinct from 'start' or coalesce(started_revision,0) < 1 then
    raise exception 'Start witness lost authoritative identifiers';
  end if;
  result := public.test_learner_self_mutation_v1(member_id,tid,'focus','{"session_id":"fixture-334","event_type":"away_start","metadata":null}',deadline);
  if result#>>'{result,event_id}' is null then raise exception 'Focus event missing'; end if;

  result := public.test_learner_self_mutation_v1(member_id,tid,'save',jsonb_build_object('responses',answers,'expected_revision',started_revision),deadline);
  saved := result#>'{result,attempt}';
  if saved->'responses' is distinct from answers or coalesce((saved->>'draft_revision')::integer,0) <= started_revision
    then raise exception 'Save did not advance the draft'; end if;
  result := public.test_learner_self_mutation_v1(member_id,tid,'save',jsonb_build_object('responses','{}'::jsonb,'expected_revision',started_revision),deadline);
  if result#>>'{result,conflict}' is distinct from 'true' or result#>'{result,attempt}' is distinct from saved
    then raise exception 'Stale draft CAS changed saved answers'; end if;
  result := public.test_learner_self_mutation_v1(member_id,tid,'submit',jsonb_build_object('responses',answers,'expected_revision',saved->'draft_revision'),deadline);
  if result#>>'{result,attempt_id}' is distinct from saved->>'id' or result#>>'{result,inserted_responses}' is distinct from '1'
    then raise exception 'Submit result did not match the saved attempt'; end if;
  foreach operation in array array['save','submit'] loop
    begin
      perform public.test_learner_self_mutation_v1(member_id,tid,operation,jsonb_build_object('responses',answers,'expected_revision',started_revision),deadline);
      raise exception 'Closed participation returned a stale revision or mutated the Test';
    exception when sqlstate 'PT403' then null; end;
  end loop;
end;
$mutation$;
reset role;
do $stored$
begin
  if (select count(*) from public.test_responses where test_id = 'd3340000-0000-4000-8000-000000000011'
    and student_id = 'd3340000-0000-4000-8000-000000000002' and response_text = 'saved334') <> 1
    or (select count(*) from public.test_attempts where test_id = 'd3340000-0000-4000-8000-000000000011' and is_submitted) <> 1
    or (select count(*) from public.test_focus_events where test_id = 'd3340000-0000-4000-8000-000000000011') <> 1 then
    raise exception 'Final attempts, responses, or focus evidence changed';
  end if;
end;
$stored$;
rollback;
\echo 'Contextual self-mutation ACL, authority, revision and stored responses: PASS'
