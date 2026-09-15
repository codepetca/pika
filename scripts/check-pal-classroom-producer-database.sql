-- Actual production RPC boundaries; only synthetic rows in a rolled-back transaction.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
insert into public.users(id,email,role) values
 ('c1690001-0000-4000-8000-000000000001','producer-teacher@example.invalid','teacher'),
 ('c1690001-0000-4000-8000-000000000002','producer-student@example.invalid','student');

do $$
declare
 student uuid := 'c1690001-0000-4000-8000-000000000002';
 teacher uuid := 'c1690001-0000-4000-8000-000000000001';
 course uuid; assignment uuid; doc uuid; generation uuid; result jsonb;
 enabled_case boolean; reference text; revision timestamptz;
 content jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Fresh work"}]}]}';
 day date := (now() at time zone 'America/Toronto')::date;
begin
 foreach enabled_case in array array[false,true] loop
  update private.pal_membership_settings set enabled=enabled_case;
  update private.pal_classroom_signal_settings set enabled=enabled_case,
   activated_at=date_trunc('week',now() at time zone 'America/Toronto') at time zone 'America/Toronto';
  course := gen_random_uuid(); assignment := gen_random_uuid();
  insert into public.classrooms(id,teacher_id,title,class_code,allow_enrollment,join_policy)
   values(course,teacher,'Producer fixture',case when enabled_case then 'RPC169ON' else 'RPC169OFF' end,true,'open_join');
  result := public.join_classroom_by_code_atomic_v1(student,course,
   case when enabled_case then 'RPC169ON' else 'RPC169OFF' end,
   repeat('a',64),case when enabled_case then repeat('b',64) else repeat('c',64) end,
   'Test','Student',null,null);
  if result->>'ok' <> 'true' or result->>'created' <> 'true' then
   raise exception 'Actual contextual join failed: %',result; end if;
  generation := (result->'enrollment'->>'id')::uuid;
  insert into public.class_days(classroom_id,date,is_class_day) values(course,day,true);
  result := public.upsert_student_entry_with_pal_event_atomic(student,course,day,
   'Fresh work',content,true,null);
  if result->>'ok' <> 'true' then raise exception 'Actual log RPC failed: %',result; end if;
  insert into public.assignments(id,classroom_id,title,created_by,due_at,is_draft,released_at)
   values(assignment,course,'Producer assignment',teacher,now()+interval '1 day',false,now()-interval '1 hour');
  result := public.create_assignment_doc_with_pal_event_atomic(assignment,student,clock_timestamp(),null);
  if result->>'ok' <> 'true' then raise exception 'Actual view RPC failed: %',result; end if;
  doc := (result->'doc'->>'id')::uuid;
  select updated_at into revision from public.assignment_docs where id=doc;
  result := public.submit_assignment_doc_with_pal_event_atomic(assignment,student,content,revision,2,10,null,array[]::uuid[]);
  if result->>'ok' <> 'true' then raise exception 'Actual submit RPC failed: %',result; end if;
  if enabled_case then
   reference := public.resolve_pal_classroom_context(student,course)->>'learner_id';
   if reference is null or (select count(*) from public.pal_event_outbox where payload->>'learner_id'=reference) <> 4
    or (select count(distinct event_type) from public.pal_event_outbox where payload->>'learner_id'=reference) <> 4
   then raise exception 'Actual source RPCs did not emit one fact per membership family'; end if;
   if (select count(*) from private.pal_membership_outbox where generation_id=generation) <> 4 then
    raise exception 'Actual source events did not bind to the joined generation'; end if;
  elsif exists(select 1 from public.pal_event_outbox where student_id=student) then
   raise exception 'Partial classroom routing created legacy activity';
  end if;
 end loop;
 if exists(select 1 from public.pal_event_outbox where student_id=student and source_kind<>'membership_v1') then
  raise exception 'Classroom source RPCs emitted legacy evidence'; end if;
end;
$$;

-- A failed atomic join cannot leave enrollment, roster, or Pal facts behind.
create function pg_temp.reject_join_pal_fact() returns trigger language plpgsql as $$
begin raise exception using errcode='P0001',message='join_fixture_outbox_failure'; end;
$$;
create trigger reject_join_pal_fact before insert on public.pal_event_outbox
 for each row when (new.source_kind='membership_v1') execute function pg_temp.reject_join_pal_fact();
do $$
declare course uuid:=gen_random_uuid(); result jsonb;
begin
 insert into public.classrooms(id,teacher_id,title,class_code,allow_enrollment,join_policy)
 values(course,'c1690001-0000-4000-8000-000000000001','Rollback join','RPC169FAIL',true,'open_join');
 result := public.join_classroom_by_code_atomic_v1('c1690001-0000-4000-8000-000000000002',course,'RPC169FAIL',repeat('d',64),repeat('e',64),'Test','Student',null,null);
 if result <> '{"ok":false,"status":500,"error_code":"join_failed"}'::jsonb then
  raise exception 'Expected atomic join rejection: %',result; end if;
 if exists(select 1 from public.classroom_enrollments where classroom_id=course)
  or exists(select 1 from public.classroom_roster where classroom_id=course)
  or exists(select 1 from private.pal_membership_outbox where classroom_id=course)
 then raise exception 'Rejected join retained partial academic or Pal state'; end if;
end;
$$;
rollback;
