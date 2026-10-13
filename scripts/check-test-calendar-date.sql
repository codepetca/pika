-- Rollback-only migration263 contract probe. Execute only against an explicitly
-- approved disposable binding; never the shared local or production database.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='1s';
set local statement_timeout='15s';
insert into public.users(id,email,role) values
 ('a2630000-0000-4000-8000-000000000001','calendar-date-owner@example.test','teacher'),
 ('a2630000-0000-4000-8000-000000000002','calendar-date-outsider@example.test','teacher'),
 ('a2630000-0000-4000-8000-000000000003','calendar-date-student@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('a2630000-0000-4000-8000-000000000010','a2630000-0000-4000-8000-000000000001','Calendar date rollback fixture','D263T1');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('a2630000-0000-4000-8000-000000000010','a2630000-0000-4000-8000-000000000003');
do $test$
#variable_conflict use_variable
declare
 actor uuid := 'a2630000-0000-4000-8000-000000000001';
 classroom uuid := 'a2630000-0000-4000-8000-000000000010';
 outsider uuid := 'a2630000-0000-4000-8000-000000000002';
 witness jsonb; before_row jsonb; after_row jsonb; test_id uuid; draft_id uuid;
 draft_version integer; updated timestamptz; denied boolean:=false;
 test_status text; attempt_before jsonb;
begin
 witness:=public.create_test_for_owner_v1(actor,classroom,'Untitled',clock_timestamp()+interval '20 seconds');
 test_id:=(witness->'test'->>'id')::uuid; draft_id:=(witness->'draft'->>'id')::uuid;
 if witness->'test'->'test_date' is distinct from 'null'::jsonb then raise exception 'Create did not attest null calendar date';end if;
 select to_jsonb(t) into before_row from public.tests t where id=test_id;
 witness:=public.test_owner_workflow_v1(actor,test_id,classroom,'update','{"test_date":"2028-02-29"}',before_row,clock_timestamp()+interval '20 seconds');
 after_row:=witness->'test';
 if after_row->>'test_date'<>'2028-02-29' or (after_row-array['test_date','updated_at']) is distinct from (before_row-array['test_date','updated_at']) then
  raise exception 'Date save widened Test metadata';end if;
 select version into draft_version from public.assessment_drafts where id=draft_id;
 select updated_at into updated from public.tests where id=test_id;
 witness:=public.discard_pristine_test_draft_atomic(test_id,actor,draft_version,updated);
 if witness->'discarded' is distinct from 'false'::jsonb then raise exception 'Dated draft was discarded';end if;
 witness:=public.discard_pristine_test_draft_for_owner_v1(actor,test_id,draft_version,updated,clock_timestamp()+interval '20 seconds');
 if witness->'discarded' is distinct from 'false'::jsonb then raise exception 'Shared dated draft was discarded';end if;
 begin perform public.test_owner_workflow_v1(outsider,test_id,classroom,'update','{"test_date":null}',after_row,clock_timestamp()+interval '20 seconds');
 exception when sqlstate 'PT403' then denied:=true;end;
 if not denied then raise exception 'Outsider date save was admitted';end if;
 select to_jsonb(t) into before_row from public.tests t where id=test_id;
 witness:=public.test_owner_workflow_v1(actor,test_id,classroom,'inspect','{}',null,clock_timestamp()+interval '20 seconds');
 if witness->'test' is distinct from before_row then raise exception 'Read did not preserve exact dated row';end if;
 witness:=public.test_owner_workflow_v1(actor,test_id,classroom,'update','{"test_date":null}',before_row,clock_timestamp()+interval '20 seconds');
 if witness->'test'->'test_date' is distinct from 'null'::jsonb then raise exception 'Calendar date did not clear';end if;
 perform public.reorder_tests_for_owner_v1(actor,classroom,array[test_id],clock_timestamp()+interval '20 seconds');
 insert into public.test_attempts(test_id,student_id,responses,is_submitted)
  values(test_id,'a2630000-0000-4000-8000-000000000003','{}',true);
 select to_jsonb(a) into attempt_before from public.test_attempts a where a.test_id=test_id;
 foreach test_status in array array['active','closed'] loop
  update public.tests t set status=test_status where t.id=test_id;
  select to_jsonb(t) into before_row from public.tests t where id=test_id;
  witness:=public.test_owner_workflow_v1(actor,test_id,classroom,'update','{"test_date":"2026-01-01"}',before_row,clock_timestamp()+interval '20 seconds');
  if witness->'test'->>'status' is distinct from test_status or witness->'test'->>'test_date'<>'2026-01-01' then raise exception 'Date metadata rejected a Test with learner work';end if;
  if (select to_jsonb(a) from public.test_attempts a where a.test_id=test_id) is distinct from attempt_before then raise exception 'Date metadata changed participation';end if;
 end loop;
 if not exists(select 1 from public.assessment_drafts where id=draft_id and version=draft_version) then raise exception 'Calendar operations changed the content draft';end if;
end;$test$;
rollback;
