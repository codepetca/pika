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
 test_status text; attempt_before jsonb; archive_operation uuid := 'a2630000-0000-4000-8000-000000000020';
 archived_row jsonb; staged_result jsonb; publication_date text; publication_id uuid; publication_draft_id uuid;
 publication_content jsonb; publication_draft_before jsonb; publication_source jsonb;
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
 foreach publication_date in array array['2028-02-29',null]::text[] loop
   witness:=public.create_test_for_owner_v1(actor,classroom,'Calendar publication',clock_timestamp()+interval '20 seconds');
   publication_id:=(witness->'test'->>'id')::uuid;publication_draft_id:=(witness->'draft'->>'id')::uuid;
   select to_jsonb(t) into before_row from public.tests t where id=publication_id;
   perform public.test_owner_workflow_v1(actor,publication_id,classroom,'update',jsonb_build_object('test_date',publication_date),before_row,clock_timestamp()+interval '20 seconds');
   publication_content:=jsonb_build_object('title','Calendar publication','show_results',false,'question_identity_version',1,'questions',jsonb_build_array(
     jsonb_build_object('id',gen_random_uuid(),'question_type','open_response','question_text','Explain a food web.','options','[]'::jsonb,
       'correct_option',null,'answer_key',null,'sample_solution',null,'points',1,'response_max_chars',500,'response_monospace',false)));
   update public.assessment_drafts set content=publication_content where id=publication_draft_id;
   select to_jsonb(d) into publication_draft_before from public.assessment_drafts d where id=publication_draft_id;
   publication_source:=public.snapshot_test_draft_for_owner_v1(actor,publication_id,clock_timestamp()+interval '20 seconds');
   witness:=public.publish_test_from_draft_for_owner_v1(actor,publication_id,classroom,publication_source->>'source_sha256',
     (publication_source->'draft'->>'version')::integer,publication_content,clock_timestamp()+interval '20 seconds');
   if witness->'test'->>'status' is distinct from 'closed' or witness->'test'->'test_date' is distinct from coalesce(to_jsonb(publication_date),'null'::jsonb)
     then raise exception 'Publication did not retain optional calendar date';end if;
   if (select to_jsonb(d) from public.assessment_drafts d where id=publication_draft_id) is distinct from publication_draft_before
     or exists(select 1 from public.test_attempts where test_id=publication_id) then raise exception 'Publication widened Draft or participation effects';end if;
 end loop;
 -- Exercise the real v2 exact-column staging path for both old and dated archives.
 insert into public.classroom_archive_operations(id,teacher_id,classroom_id,operation_type,
   request_sha256,status,source_revision,source_schema_migration,source_app_commit,retention,
   resource_counts,source_resource_counts,snapshot_created_at,snapshot_expires_at,
   target_schema_migration,adapter_chain,source_contract_version,archive_format_version,restore_contract_version)
 values(archive_operation,actor,classroom,'restore',repeat('a',64),'snapshot_ready',1,'262','calendar-date-fixture','{}',
   '{"classrooms":1,"tests":2}','{"classrooms":1,"tests":2}',clock_timestamp(),clock_timestamp()+interval '1 hour',
   '263','[]',2,2,2);
 select to_jsonb(c) || jsonb_build_object('archived_at',clock_timestamp()) into archived_row from public.classrooms c where id=classroom;
 staged_result := public.stage_classroom_archive_restore_rows_v2(archive_operation,actor,'classrooms',jsonb_build_array(archived_row),2);
 if staged_result->'ok' is distinct from 'true'::jsonb then raise exception 'Archive root did not stage';end if;
 select to_jsonb(t) into archived_row from public.tests t where id=test_id;
 staged_result := public.stage_classroom_archive_restore_rows_v2(archive_operation,actor,'tests',jsonb_build_array(
   archived_row - 'test_date', archived_row || jsonb_build_object('id','a2630000-0000-4000-8000-000000000021','test_date','2028-02-29')),2);
 if staged_result->'ok' is distinct from 'true'::jsonb or staged_result->>'staged_count'<>'2' then raise exception 'Old and dated archives did not stage';end if;
 if (select row_data->'test_date' from public.classroom_archive_restore_staging where operation_id=archive_operation and table_name='tests' and row_id=test_id)
   is distinct from 'null'::jsonb then raise exception 'Old archive did not default date to null';end if;
 if (select row_data->>'test_date' from public.classroom_archive_restore_staging where operation_id=archive_operation and table_name='tests' and row_id='a2630000-0000-4000-8000-000000000021')
   is distinct from '2028-02-29' then raise exception 'Dated archive lost date';end if;
 if has_function_privilege('service_role','public.normalize_classroom_archive_restore_row_pre_v263(uuid,text,jsonb)','EXECUTE')
   or has_function_privilege('authenticated','public.normalize_classroom_archive_restore_row(uuid,text,jsonb)','EXECUTE')
   or not has_function_privilege('service_role','public.normalize_classroom_archive_restore_row(uuid,text,jsonb)','EXECUTE') then raise exception 'Archive normalizer privileges widened';end if;
end;$test$;
rollback;
