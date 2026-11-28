-- Disposable full-migration CI database only. No shared/local/prod application.
-- All fixtures and temporary ACL/catalog assertions roll back.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $acl$
declare signature text := 'public.read_test_session_for_member_v1(uuid,uuid,timestamptz)';
begin
  if has_function_privilege('anon',signature,'execute')
    or has_function_privilege('authenticated',signature,'execute')
    or not has_function_privilege('service_role',signature,'execute') then
    raise exception 'Contextual session function ACL changed';
  end if;
  if not exists(select 1 from pg_proc where oid = signature::regprocedure and provolatile = 's' and prosecdef)
    then raise exception 'Contextual session stable private-data boundary changed'; end if;
end;
$acl$;
set local role anon;
do $denied$
begin
  begin
    perform public.read_test_session_for_member_v1('d3330000-0000-4000-8000-000000000002',
      'd3330000-0000-4000-8000-000000000011',clock_timestamp()+interval '25 seconds');
    raise exception 'Anon session execution succeeded';
  exception when insufficient_privilege then null; end;
end;
$denied$;
reset role;
set local role authenticated;
do $denied$
begin
  begin
    perform public.read_test_session_for_member_v1('d3330000-0000-4000-8000-000000000002',
      'd3330000-0000-4000-8000-000000000011',clock_timestamp()+interval '25 seconds');
    raise exception 'Authenticated session execution succeeded';
  exception when insufficient_privilege then null; end;
end;
$denied$;
reset role;
insert into public.users(id,email,role) values
 ('d3330000-0000-4000-8000-000000000001','owner333@example.test','student'),
 ('d3330000-0000-4000-8000-000000000002','member333@example.test','teacher'),
 ('d3330000-0000-4000-8000-000000000003','peer333@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('d3330000-0000-4000-8000-000000000010','d3330000-0000-4000-8000-000000000001','Session333','TEST333');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('d3330000-0000-4000-8000-000000000010','d3330000-0000-4000-8000-000000000001'),
 ('d3330000-0000-4000-8000-000000000010','d3330000-0000-4000-8000-000000000002');
insert into public.tests(id,classroom_id,title,status,created_by) values
 ('d3330000-0000-4000-8000-000000000011','d3330000-0000-4000-8000-000000000010','Session333','active','d3330000-0000-4000-8000-000000000001');
insert into public.test_questions(id,test_id,question_type,question_text,options,points,position,response_max_chars) values
 ('d3330000-0000-4000-8000-000000000101','d3330000-0000-4000-8000-000000000011','open_response','Private prompt','[]',1,0,20000);
-- A peer response must never become this member's submission evidence.
insert into public.test_responses(test_id,question_id,student_id,response_text) values
 ('d3330000-0000-4000-8000-000000000011','d3330000-0000-4000-8000-000000000101','d3330000-0000-4000-8000-000000000003','private-peer-answer');
set local role service_role;
do $initial$
declare result jsonb;
begin
  result := public.read_test_session_for_member_v1('d3330000-0000-4000-8000-000000000002',
    'd3330000-0000-4000-8000-000000000011',clock_timestamp()+interval '25 seconds');
  if result->>'outcome' <> 'ok' or result#>>'{projection,has_submitted}' <> 'false'
    or result#>'{projection,returned_at}' <> 'null'::jsonb
    or result->>'classroom_id' <> 'd3330000-0000-4000-8000-000000000010'
    or result::text like '%private%' or octet_length(result::text) > 4096 then
    raise exception 'Compact role-neutral own-session snapshot changed';
  end if;
  if public.read_test_session_for_member_v1('d3330000-0000-4000-8000-000000000001',
    'd3330000-0000-4000-8000-000000000011',clock_timestamp()+interval '25 seconds')->>'outcome' <> 'forbidden'
    then raise exception 'Self-enrolled owner acquired learner session authority'; end if;
  if public.read_test_session_for_member_v1('d3330000-0000-4000-8000-000000000003',
    'd3330000-0000-4000-8000-000000000011',clock_timestamp()+interval '25 seconds')->>'outcome' <> 'forbidden'
    then raise exception 'Nonmember acquired session authority'; end if;
  if public.read_test_session_for_member_v1('d3330000-0000-4000-8000-000000000002',
    'd3330000-0000-4000-8000-000000000099',clock_timestamp()+interval '25 seconds')->>'outcome' <> 'not_found'
    then raise exception 'Missing Test response changed'; end if;
  if public.read_test_session_for_member_v1('d3330000-0000-4000-8000-000000000002',
    'd3330000-0000-4000-8000-000000000011',clock_timestamp()-interval '1 second')->>'outcome' <> 'unavailable'
    then raise exception 'Expired session accepted'; end if;
end;
$initial$;
reset role;
insert into public.test_attempts(test_id,student_id,responses) values
 ('d3330000-0000-4000-8000-000000000011','d3330000-0000-4000-8000-000000000002','{}');
insert into public.test_responses(test_id,question_id,student_id,response_text) values
 ('d3330000-0000-4000-8000-000000000011','d3330000-0000-4000-8000-000000000101','d3330000-0000-4000-8000-000000000002','');
do $parity$
declare st text; av text; submitted boolean; returned boolean; locked boolean; meaningful boolean;
  fresh jsonb; old jsonb; old_not_found boolean; count_cases integer := 0;
  actor uuid := 'd3330000-0000-4000-8000-000000000002';
  tid uuid := 'd3330000-0000-4000-8000-000000000011';
  cid uuid := 'd3330000-0000-4000-8000-000000000010';
begin
  foreach st in array array['draft','active','closed'] loop
  foreach av in array array[null::text,'open','closed'] loop
  foreach submitted in array array[false,true] loop
  foreach returned in array array[false,true] loop
  foreach locked in array array[false,true] loop
  foreach meaningful in array array[false,true] loop
    update public.tests set status = st where id = tid;
    delete from public.test_student_availability where test_id = tid;
    if av is not null then insert into public.test_student_availability(test_id,student_id,state,updated_by)
      values(tid,actor,av,'d3330000-0000-4000-8000-000000000001'); end if;
    update public.test_attempts set is_submitted = submitted,
      returned_at = case when returned then '2026-11-28T12:00:00Z'::timestamptz end,
      closed_for_grading_at = case when locked then '2026-11-28T12:00:00Z'::timestamptz end
      where test_id = tid and student_id = actor;
    update public.test_responses set response_text = case when meaningful then E'\t' else '  ' end
      where test_id = tid and student_id = actor;
    fresh := public.read_test_session_for_member_v1(actor,tid,clock_timestamp()+interval '25 seconds');
    old_not_found := false;
    begin
      old := public.test_learner_workflow_v1(actor,tid,cid,'session','{}',clock_timestamp()+interval '25 seconds');
    exception when sqlstate 'PT404' then old_not_found := true; end;
    if old_not_found then
      if fresh->>'outcome' <> 'not_found' or fresh->'projection' <> 'null'::jsonb
        then raise exception 'Contextual closed/draft 404 parity changed'; end if;
    elsif fresh->>'outcome' <> 'ok' or fresh->'projection' <> jsonb_build_object(
      'test_status',old#>'{result,state,test,status}','is_submitted',old#>'{result,state,attempt,is_submitted}',
      'returned_at',old#>'{result,state,attempt,returned_at}','closed_for_grading_at',old#>'{result,state,attempt,closed_for_grading_at}',
      'access_state',old#>'{result,state,access_state}','has_submitted',old#>'{result,state,has_submitted}') then
      raise exception 'Contextual session fact parity changed';
    end if;
    count_cases := count_cases + 1;
  end loop; end loop; end loop; end loop; end loop; end loop;
  if count_cases <> 144 then raise exception 'Incomplete session parity matrix'; end if;
end;
$parity$;
update public.tests set status = 'active' where id = 'd3330000-0000-4000-8000-000000000011';
do $fences$
declare setting text; result jsonb;
begin
  foreach setting in array array['pika.classroom_archive_restore','pika.classroom_archive_compaction',
    'pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
    perform set_config(setting,'on',true);
    result := public.read_test_session_for_member_v1('d3330000-0000-4000-8000-000000000002',
      'd3330000-0000-4000-8000-000000000011',clock_timestamp()+interval '25 seconds');
    if result->>'outcome' <> 'forbidden' or result->'projection' <> 'null'::jsonb
      then raise exception 'Maintenance-fenced session exposed facts'; end if;
    perform set_config(setting,'off',true);
  end loop;
end;
$fences$;
update public.classrooms set feature_visibility = '{"tests":false}' where id = 'd3330000-0000-4000-8000-000000000010';
do $hidden$
begin
  if public.read_test_session_for_member_v1('d3330000-0000-4000-8000-000000000002',
    'd3330000-0000-4000-8000-000000000011',clock_timestamp()+interval '25 seconds')->>'outcome' <> 'forbidden'
    then raise exception 'Hidden Tests exposed session'; end if;
end;
$hidden$;
update public.classrooms set feature_visibility = '{}', archived_at = clock_timestamp() where id = 'd3330000-0000-4000-8000-000000000010';
do $archive$
begin
  if public.read_test_session_for_member_v1('d3330000-0000-4000-8000-000000000002',
    'd3330000-0000-4000-8000-000000000011',clock_timestamp()+interval '25 seconds')->>'outcome' <> 'forbidden'
    then raise exception 'Archived Classroom exposed session'; end if;
end;
$archive$;
update public.classrooms set archived_at = null where id = 'd3330000-0000-4000-8000-000000000010';
delete from public.classroom_enrollments where classroom_id = 'd3330000-0000-4000-8000-000000000010'
  and student_id = 'd3330000-0000-4000-8000-000000000002';
do $revoked$
begin
  if public.read_test_session_for_member_v1('d3330000-0000-4000-8000-000000000002',
    'd3330000-0000-4000-8000-000000000011',clock_timestamp()+interval '25 seconds')->>'outcome' <> 'forbidden'
    then raise exception 'Removed member exposed session'; end if;
end;
$revoked$;
rollback;
select 'Contextual session ACL, isolation, status parity, maintenance and revocation: PASS';
