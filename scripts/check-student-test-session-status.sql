begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

do $security$
declare fn regprocedure := 'public.get_student_test_session_status_projection(uuid,text)'::regprocedure;
begin
  if has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute')
    or not has_function_privilege('service_role',fn,'execute') then
    raise exception 'Projection RPC ACL differs';
  end if;
  if exists(select 1 from pg_catalog.pg_proc where oid=fn and (prosecdef or provolatile<>'s' or proowner<>'postgres'::regrole or proconfig<>array['search_path=""'])) then
    raise exception 'Projection ownership/security/search_path/volatility differs';
  end if;
end;
$security$;
set local role anon;
do $denied$
begin
  begin
    perform public.get_student_test_session_status_projection('b2570000-0000-4000-8000-000000000002','missing');
    raise exception 'anon unexpectedly executed projection';
  exception when insufficient_privilege then null; end;
end;
$denied$;
set local role authenticated;
do $denied$
begin
  begin
    perform public.get_student_test_session_status_projection('b2570000-0000-4000-8000-000000000002','missing');
    raise exception 'authenticated unexpectedly executed projection';
  exception when insufficient_privilege then null; end;
end;
$denied$;
reset role;
insert into public.users(id,email,role) values
 ('b2570000-0000-4000-8000-000000000001','session-owner@example.test','teacher'),
 ('b2570000-0000-4000-8000-000000000002','session-student@example.test','student'),
 ('b2570000-0000-4000-8000-000000000003','session-other@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('b2570000-0000-4000-8000-000000000010','b2570000-0000-4000-8000-000000000001','Projection rollback fixture','B257T1');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('b2570000-0000-4000-8000-000000000010','b2570000-0000-4000-8000-000000000002');
insert into public.tests(id,classroom_id,title,status,created_by) values
 ('b2570000-0000-4000-8000-000000000011','b2570000-0000-4000-8000-000000000010','Projection fixture','active','b2570000-0000-4000-8000-000000000001');
insert into public.test_questions(id,test_id,question_type,question_text,options,points,position,response_max_chars) values
 ('b2570000-0000-4000-8000-000000000101','b2570000-0000-4000-8000-000000000011','open_response','Fixture prompt','[]',1,0,20000);
insert into public.test_attempts(test_id,student_id,is_submitted) values
 ('b2570000-0000-4000-8000-000000000011','b2570000-0000-4000-8000-000000000002',false);
insert into public.test_responses(test_id,question_id,student_id,response_text) values
 ('b2570000-0000-4000-8000-000000000011','b2570000-0000-4000-8000-000000000101','b2570000-0000-4000-8000-000000000003',repeat('private-other-answer',1000));

set local role service_role;
do $projection$
declare
  sid uuid := 'b2570000-0000-4000-8000-000000000002'; tid text := 'b2570000-0000-4000-8000-000000000011';
  snapshot jsonb;
begin
  snapshot:=public.get_student_test_session_status_projection(sid,tid);
  if snapshot <> '{"ok":true,"test":{"id":"b2570000-0000-4000-8000-000000000011","status":"active"},"is_submitted":false,"returned_at":null,"closed_for_grading_at":null,"has_meaningful_response":false,"access_state":null}'::jsonb then
    raise exception 'Fresh compact projection or cross-student isolation differs';
  end if;
  if public.get_student_test_session_status_projection(sid,'invalid') <> '{"ok":false,"status":404,"error":"Test not found"}'::jsonb
    or public.get_student_test_session_status_projection(sid,'b2570000-0000-4000-8000-000000000099') <> '{"ok":false,"status":404,"error":"Test not found"}'::jsonb then raise exception 'Missing/invalid test contract differs'; end if;
  if public.get_student_test_session_status_projection('b2570000-0000-4000-8000-000000000003',tid) <> '{"ok":false,"status":403,"error":"Not enrolled in this classroom"}'::jsonb then raise exception 'Enrollment denial differs'; end if;
end;
$projection$;
reset role;

-- Current valid persisted shapes: all ECMAScript trim characters are empty;
-- U+0085/U+180E/U+200B remain meaningful, exactly as JS String.trim.
insert into public.test_responses(test_id,question_id,student_id,response_text) values
 ('b2570000-0000-4000-8000-000000000011','b2570000-0000-4000-8000-000000000101','b2570000-0000-4000-8000-000000000002','');
do $meaningful$
declare c text; snapshot jsonb; chars text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  foreach c in array regexp_split_to_array(chars,'') loop
    update public.test_responses set response_text=c where student_id='b2570000-0000-4000-8000-000000000002';
    snapshot:=public.get_student_test_session_status_projection('b2570000-0000-4000-8000-000000000002','b2570000-0000-4000-8000-000000000011');
    if (snapshot->>'has_meaningful_response')::boolean then raise exception 'JS trim character mismatch'; end if;
  end loop;
  foreach c in array array[U&'\0085',U&'\180E',U&'\200B',repeat('synthetic-answer-',1000)] loop
    update public.test_responses set response_text=c where student_id='b2570000-0000-4000-8000-000000000002';
    snapshot:=public.get_student_test_session_status_projection('b2570000-0000-4000-8000-000000000002','b2570000-0000-4000-8000-000000000011');
    if not (snapshot->>'has_meaningful_response')::boolean or octet_length(snapshot::text)>400 or snapshot::text like '%synthetic-answer%' then raise exception 'Meaningful/large-answer compact contract differs'; end if;
  end loop;
  raise notice 'Many-KiB answer: % bytes; projection: % bytes',octet_length(c),octet_length(snapshot::text);
end;
$meaningful$;

-- Adversarial historical shapes cannot be inserted under the current checks.
-- Temporarily remove only option/shape checks and the shape trigger inside this
-- rollback-only disposable transaction to prove numeric precedence explicitly.
alter table public.test_responses disable trigger validate_test_response_shape;
do $legacy_shapes$
declare constraint_row record; option_value integer; snapshot jsonb;
begin
  for constraint_row in select conname from pg_catalog.pg_constraint
    where conrelid='public.test_responses'::regclass and contype='c'
      and pg_catalog.pg_get_constraintdef(oid) like '%selected_option%' loop
    execute pg_catalog.format('alter table public.test_responses drop constraint %I',constraint_row.conname);
  end loop;
  foreach option_value in array array[-1,0,1] loop
    update public.test_responses set selected_option=option_value,response_text='meaningful text'
      where student_id='b2570000-0000-4000-8000-000000000002';
    snapshot:=public.get_student_test_session_status_projection('b2570000-0000-4000-8000-000000000002','b2570000-0000-4000-8000-000000000011');
    if (snapshot->>'has_meaningful_response')::boolean is distinct from (option_value>=0) then
      raise exception 'Numeric option must override text, including negative options';
    end if;
  end loop;
end;
$legacy_shapes$;
update public.test_responses set selected_option=null,response_text='meaningful text'
 where student_id='b2570000-0000-4000-8000-000000000002';

-- Compare every snapshot fact with direct scoped reads across status, override,
-- submission, return and grading-lock combinations (72 combinations).
do $parity$
declare st text; av text; submitted boolean; returned boolean; locked boolean; snapshot jsonb; direct jsonb; n integer:=0;
begin
  foreach st in array array['draft','active','closed'] loop
  foreach av in array array[null::text,'open','closed'] loop
  foreach submitted in array array[false,true] loop
  foreach returned in array array[false,true] loop
  foreach locked in array array[false,true] loop
    update public.tests set status=st where id='b2570000-0000-4000-8000-000000000011';
    delete from public.test_student_availability where test_id='b2570000-0000-4000-8000-000000000011';
    if av is not null then insert into public.test_student_availability(test_id,student_id,state,updated_by) values ('b2570000-0000-4000-8000-000000000011','b2570000-0000-4000-8000-000000000002',av,'b2570000-0000-4000-8000-000000000001'); end if;
    update public.test_attempts set is_submitted=submitted,returned_at=case when returned then '2026-01-01T00:00:00Z'::timestamptz end,closed_for_grading_at=case when locked then '2026-01-01T00:00:00Z'::timestamptz end where student_id='b2570000-0000-4000-8000-000000000002';
    snapshot:=public.get_student_test_session_status_projection('b2570000-0000-4000-8000-000000000002','b2570000-0000-4000-8000-000000000011');
    select jsonb_build_object('ok',true,'test',jsonb_build_object('id',t.id,'status',t.status),'is_submitted',a.is_submitted,'returned_at',a.returned_at,'closed_for_grading_at',a.closed_for_grading_at,'access_state',av,'has_meaningful_response',true) into direct from public.tests t join public.test_attempts a on a.test_id=t.id where t.id='b2570000-0000-4000-8000-000000000011' and a.student_id='b2570000-0000-4000-8000-000000000002';
    if snapshot<>direct then raise exception 'Direct-read projection parity differs'; end if;
    n:=n+1;
  end loop; end loop; end loop; end loop; end loop;
  raise notice 'Direct-read snapshot parity combinations: %',n;
end;
$parity$;
update public.classrooms set archived_at=now() where id='b2570000-0000-4000-8000-000000000010';
do $archive$
begin
  if public.get_student_test_session_status_projection('b2570000-0000-4000-8000-000000000003','b2570000-0000-4000-8000-000000000011') <> '{"ok":false,"status":403,"error":"Classroom is archived"}'::jsonb then raise exception 'Archive-before-enrollment ordering differs'; end if;
end;
$archive$;
update public.classrooms set archived_at=null where id='b2570000-0000-4000-8000-000000000010';
delete from public.classroom_enrollments where classroom_id='b2570000-0000-4000-8000-000000000010' and student_id='b2570000-0000-4000-8000-000000000002';
do $revocation$
begin
  if public.get_student_test_session_status_projection('b2570000-0000-4000-8000-000000000002','b2570000-0000-4000-8000-000000000011') <> '{"ok":false,"status":403,"error":"Not enrolled in this classroom"}'::jsonb then raise exception 'Fresh membership revocation exposed session facts'; end if;
end;
$revocation$;
rollback;
select 'Student Test session projection ACL, isolation, JS-trim, compactness and direct-read parity: PASS';
