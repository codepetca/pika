-- SOURCE-ONLY rollback contracts. Run only in an explicitly authorized disposable
-- full-migration database; never against canonical/shared local or hosted data.
-- Sequence allocations by inherited writer triggers do not roll back.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
insert into public.users(id,email,role) values
 ('a2550000-0000-4000-8000-000000000001','owner255@example.test','student'),
 ('a2550000-0000-4000-8000-000000000002','learner255@example.test','teacher');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('a2550000-0000-4000-8000-000000000010','a2550000-0000-4000-8000-000000000001','Owner workflow255','CORE2550');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('a2550000-0000-4000-8000-000000000010','a2550000-0000-4000-8000-000000000001'),
 ('a2550000-0000-4000-8000-000000000010','a2550000-0000-4000-8000-000000000002');
insert into public.tests(id,classroom_id,title,status,created_by) values
 ('a2550000-0000-4000-8000-000000000011','a2550000-0000-4000-8000-000000000010','Original','closed','a2550000-0000-4000-8000-000000000002'),
 ('a2550000-0000-4000-8000-000000000012','a2550000-0000-4000-8000-000000000010','Other','closed','a2550000-0000-4000-8000-000000000001');
do $contracts$
declare
  owner_id uuid := 'a2550000-0000-4000-8000-000000000001';
  learner_id uuid := 'a2550000-0000-4000-8000-000000000002';
  class_id uuid := 'a2550000-0000-4000-8000-000000000010';
  v_test_id uuid := 'a2550000-0000-4000-8000-000000000011';
  deadline timestamptz := clock_timestamp() + interval '25 seconds';
  before_test jsonb; result jsonb; writer_before bigint; writer_after bigint;
  doc_id uuid := 'a2550000-0000-4000-8000-000000000020';
  object_id uuid := 'a2550000-0000-4000-8000-000000000021';
  snapshot_id uuid := 'a2550000-0000-4000-8000-000000000022';
  cancel_id uuid := 'a2550000-0000-4000-8000-000000000023';
  other_test_id uuid := 'a2550000-0000-4000-8000-000000000012';
  other_object_id uuid := 'a2550000-0000-4000-8000-000000000024';
  object_path text; snapshot_path text; documents jsonb; upload_args jsonb;
begin
  if has_function_privilege('anon','public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)','execute')
    or has_function_privilege('authenticated','public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)','execute')
    or not has_function_privilege('service_role','public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)','execute') then
    raise exception 'RPC privilege boundary changed'; end if;
  -- An owner with student account role and a different historical Test creator
  -- owns this workflow. Inspect is genuinely read-only even for Storage revision.
  select last_value into writer_before from public.managed_storage_writer_revision_seq;
  result := public.test_owner_workflow_v1(owner_id,v_test_id,null,'inspect','{}',null,deadline);
  before_test := result->'test';
  select last_value into writer_after from public.managed_storage_writer_revision_seq;
  if writer_before <> writer_after or result->>'actor_id' <> owner_id::text
    or result->>'classroom_id' <> class_id::text then raise exception 'Inspect changed authority or writer revision'; end if;
  result := public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'update','{"title":"Renamed","show_results":true}',before_test,deadline);
  if result#>>'{test,title}' <> 'Renamed' or result#>>'{test,show_results}' <> 'true'
    or result->'test' - array['title','show_results','updated_at'] is distinct from before_test - array['title','show_results','updated_at'] then
    raise exception 'Atomic metadata edit changed unrelated Test fields';
  end if;
  begin
    perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'update','{"title":"Stale"}',before_test,deadline);
    raise exception 'Stale metadata edit accepted';
  exception when sqlstate 'PT409' then null; end;
  if (select title from public.tests where id=v_test_id) <> 'Renamed' then raise exception 'Stale edit mutated metadata'; end if;

  result := public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'student-access',jsonb_build_object('state','open','student_ids',jsonb_build_array(owner_id,learner_id)),null,deadline);
  if result#>>'{result,updated_count}' <> '1' or result#>>'{result,skipped_count}' <> '1'
    or exists(select 1 from public.test_student_availability where test_id=v_test_id and student_id=owner_id)
    or not exists(select 1 from public.test_student_availability availability where availability.test_id=v_test_id and student_id=learner_id and state='open') then
    raise exception 'Owner became a learner or selected member was not opened';
  end if;
  begin
    perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'student-access',jsonb_build_object('state','open','student_ids',jsonb_build_array(owner_id)),null,deadline);
    raise exception 'Owner-only selection accepted';
  exception when sqlstate 'PT400' then null; end;
  begin
    perform public.test_owner_workflow_v1(learner_id,v_test_id,null,'inspect','{}',null,deadline);
    raise exception 'Historical creator/nonowner accepted';
  exception when sqlstate 'PT403' then null; end;
  begin
    perform public.test_owner_workflow_v1(owner_id,v_test_id,learner_id,'inspect','{}',null,deadline);
    raise exception 'Fixed parent mismatch accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'inspect','{}',null,clock_timestamp()-interval '1 second');
    raise exception 'Expired deadline accepted';
  exception when sqlstate 'PT503' then null; end;

  -- SQL-side material lifecycle only. These storage rows are fixture metadata,
  -- not evidence of signed-upload bytes, MIME inspection, or real delivery.
  object_path := 'classrooms/'||class_id||'/tests/'||v_test_id||'/documents/'||doc_id||'/'||object_id||'.pdf';
  upload_args := jsonb_build_object('document_id',doc_id,'managed_object_id',object_id);
  result := public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'reserve',jsonb_build_object(
    'document_id',doc_id,'object_id',object_id,'storage_path',object_path,'purpose','teacher_test_material',
    'content_type','application/pdf','byte_size',20),null,deadline);
  if result#>>'{result,status}' <> 'reserved' or result#>>'{result,resource_id}' <> v_test_id::text then
    raise exception 'Reservation was not bound'; end if;
  insert into storage.objects(bucket_id,name,metadata) values ('test-documents',object_path,'{"mimetype":"application/pdf","size":20}');
  result := public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'verify',upload_args,null,deadline);
  if result#>>'{result,status}' <> 'verified' then raise exception 'Upload not verified'; end if;
  result := public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'cancel',jsonb_build_object('managed_object_id',object_id),null,deadline);
  if result->'result' <> 'false'::jsonb then raise exception 'Cancellation invalidated verified upload'; end if;
  before_test := public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'inspect','{}',null,deadline)->'test';
  documents := jsonb_build_array(jsonb_build_object('id',doc_id,'title','Upload','source','upload',
    'storage_bucket','test-documents','storage_path',object_path,'managed_object_id',object_id));
  perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'update',jsonb_build_object('documents',documents),before_test,deadline);
  result := public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'document',jsonb_build_object('document_id',doc_id,'source','upload'),null,deadline);
  if result#>>'{result,document,storage_path}' <> object_path then raise exception 'File readback not bound'; end if;
  before_test := result->'test';
  documents := jsonb_build_array(jsonb_build_object('id',doc_id,'title','Link','source','link','url','https://example.test/reference'));
  perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'update',jsonb_build_object('documents',documents),before_test,deadline);
  if (select status from public.managed_storage_objects where id=object_id) <> 'cleanup_pending' then
    raise exception 'Detached upload lacked durable cleanup'; end if;
  snapshot_path := 'link-docs/'||owner_id||'/'||v_test_id||'/'||doc_id||'/snapshots/'||snapshot_id;
  perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'reserve',jsonb_build_object('document_id',doc_id,
    'object_id',snapshot_id,'storage_path',snapshot_path,'purpose','test_execution_snapshot','expected_url','https://example.test/reference',
    'content_type','text/html','byte_size',20),null,deadline);
  insert into storage.objects(bucket_id,name,metadata) values ('test-documents',snapshot_path,'{"mimetype":"text/html","size":20}');
  upload_args := jsonb_build_object('document_id',doc_id,'managed_object_id',snapshot_id,'expected_url','https://example.test/reference');
  perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'verify',upload_args,null,deadline);
  before_test := public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'inspect','{}',null,deadline)->'test';
  perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'sync',upload_args||jsonb_build_object('synced_at',clock_timestamp()),before_test,deadline);
  result := public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'document',jsonb_build_object('document_id',doc_id,'source','link'),null,deadline);
  if result#>>'{result,document,snapshot_path}' <> snapshot_path then raise exception 'Snapshot readback not bound'; end if;
  object_path := 'classrooms/'||class_id||'/tests/'||v_test_id||'/documents/'||doc_id||'/'||cancel_id||'.pdf';
  perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'reserve',jsonb_build_object('document_id',doc_id,
    'object_id',cancel_id,'storage_path',object_path,'purpose','teacher_test_material','content_type','application/pdf','byte_size',20),null,deadline);
  result := public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'cancel',jsonb_build_object('managed_object_id',cancel_id),null,deadline);
  if result->'result' <> 'true'::jsonb or (select status from public.managed_storage_objects where id=cancel_id) <> 'cleanup_pending' then
    raise exception 'Reserved cancellation lacked durable cleanup'; end if;
  object_path := 'classrooms/'||class_id||'/tests/'||other_test_id||'/documents/'||doc_id||'/'||other_object_id||'.pdf';
  perform public.test_owner_workflow_v1(owner_id,other_test_id,class_id,'reserve',jsonb_build_object('document_id',doc_id,
    'object_id',other_object_id,'storage_path',object_path,'purpose','teacher_test_material','content_type','application/pdf','byte_size',20),null,deadline);
  begin
    perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'cancel',jsonb_build_object('managed_object_id',other_object_id),null,deadline);
    raise exception 'Another Test object was cancellable';
  exception when sqlstate 'PT404' then null; end;
  if (select status from public.managed_storage_objects where id=other_object_id) <> 'reserved' then
    raise exception 'Cross-Test refusal changed object'; end if;

  update public.tests set blueprint_archived_at=now() where id=v_test_id;
  before_test := public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'inspect','{}',null,deadline)->'test';
  begin
    perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'update','{"title":"Retired"}',before_test,deadline);
    raise exception 'Retired Test mutation accepted';
  exception when sqlstate 'PT403' then null; end;
  update public.tests set blueprint_archived_at=null where id=v_test_id;
  update public.classrooms set archived_at=now() where id=class_id;
  perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'inspect','{}',null,deadline);
  begin
    perform public.test_owner_workflow_v1(owner_id,v_test_id,class_id,'student-access',jsonb_build_object('state','closed','student_ids',jsonb_build_array(learner_id)),null,deadline);
    raise exception 'Archived Classroom mutation accepted';
  exception when sqlstate 'PT403' then null; end;
  if (select state from public.test_student_availability availability where availability.test_id=v_test_id and student_id=learner_id) <> 'open' then
    raise exception 'Archived refusal changed saved access';
  end if;
end;
$contracts$;
rollback;
