-- Rollback-only synthetic fixture. Execute ONLY in root's authorized disposable
-- cumulative-schema proof target, never a shared-local or hosted database.
-- This file does not prove two-session concurrency; root supplies those races.
begin;
-- Direct SQL must set cancellation BEFORE the RPC statement (local function
-- settings alone cannot cancel an already-running direct SQL statement).
set local statement_timeout='8s';
set local lock_timeout='1s';

create function pg_temp.gradebook_contract_state(p_classroom uuid)
returns text language sql volatile set search_path='' as $state$
  select encode(sha256(convert_to(jsonb_build_object(
    'classroom',(select to_jsonb(c) from public.classrooms c where id=p_classroom),
    'revision',(select to_jsonb(r) from public.classroom_archive_revisions r where classroom_id=p_classroom),
    'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from public.gradebook_categories c where classroom_id=p_classroom),
    'assignments',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.assignments a where classroom_id=p_classroom),
    'docs',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]') from public.assignment_docs d join public.assignments a on a.id=d.assignment_id where a.classroom_id=p_classroom),
    'tests',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.tests t where classroom_id=p_classroom),
    'questions',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from public.test_questions q join public.tests t on t.id=q.test_id where t.classroom_id=p_classroom),
    'responses',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.test_responses r join public.tests t on t.id=r.test_id where t.classroom_id=p_classroom),
    'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from public.test_attempts a join public.tests t on t.id=a.test_id where t.classroom_id=p_classroom),
    'items',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from public.gradebook_items i where classroom_id=p_classroom),
    'scores',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.gradebook_item_scores s where classroom_id=p_classroom),
    'overrides',(select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]') from public.gradebook_score_overrides o where classroom_id=p_classroom)
  )::text,'UTF8')),'hex')
$state$;
revoke all on function pg_temp.gradebook_contract_state(uuid) from public,anon,authenticated,service_role;

-- AFTER a real payload update and its revision BEFORE trigger, fail and verify
-- both payload and revision roll back together. Installed only within rollback.
create function pg_temp.gradebook_contract_fail_after_write()
returns trigger language plpgsql set search_path='' as $fault$
begin
  if current_setting('pika.gradebook_contract_fault',true)=new.id::text then
    raise exception using errcode='PT503',message='gradebook_contract_after_write';
  end if;
  return new;
end;
$fault$;
create trigger gradebook_contract_after_write after update on public.assignments
for each row execute function pg_temp.gradebook_contract_fail_after_write();

do $contract$
declare
  v_owner uuid:=gen_random_uuid(); v_member uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid();
  v_classroom uuid:=gen_random_uuid(); v_foreign uuid:=gen_random_uuid();
  v_assignment uuid:=gen_random_uuid(); v_draft uuid:=gen_random_uuid(); v_test uuid:=gen_random_uuid(); v_question uuid:=gen_random_uuid();
  v_item uuid:=gen_random_uuid(); v_category uuid; v_purge uuid:=gen_random_uuid();
  v_payload jsonb; v_snapshot jsonb; v_source jsonb; v_result jsonb; v_before text; v_message text;
  v_function regprocedure; v_relation text; v_guc text; v_categories jsonb;
begin
  foreach v_function in array array[
    'public.get_gradebook_for_owner_v1(uuid,uuid,uuid,timestamptz)'::regprocedure,
    'public.get_gradebook_for_member_v1(uuid,uuid,text,timestamptz)'::regprocedure,
    'public.mutate_gradebook_for_owner_v1(uuid,uuid,text,jsonb,timestamptz)'::regprocedure
  ] loop
    assert has_function_privilege('service_role',v_function,'EXECUTE');
    assert not has_function_privilege('anon',v_function,'EXECUTE');
    assert not has_function_privilege('authenticated',v_function,'EXECUTE');
    assert not exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=v_function and a.grantee=0 and a.privilege_type='EXECUTE');
    assert (select prosecdef and proconfig @> array['search_path=""','lock_timeout=1s','statement_timeout=8s'] from pg_proc where oid=v_function);
  end loop;
  assert not has_function_privilege('service_role','private.lock_gradebook_context_v1(uuid,uuid,boolean,boolean)','EXECUTE');
  assert not has_function_privilege('service_role','private.gradebook_source_v1(uuid,public.classrooms,text)','EXECUTE');
  foreach v_relation in array array['gradebook_categories','assignments','assignment_docs','tests','test_questions','test_responses','test_attempts','gradebook_items','gradebook_item_scores','gradebook_score_overrides'] loop
    assert exists(select 1 from pg_trigger t where t.tgrelid=('public.'||v_relation)::regclass
      and t.tgfoid='public.bump_classroom_archive_revision_from_resource()'::regprocedure
      and (t.tgtype::integer & 2)=2 and t.tgenabled<>'D'), 'Missing BEFORE archive revision fence';
  end loop;
  insert into public.users(id,email,role) values
    (v_owner,v_owner::text||'@gradebook.invalid','student'),
    (v_member,v_member::text||'@gradebook.invalid','teacher'),
    (v_other,v_other::text||'@gradebook.invalid','student');
  perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),v_owner,'classrooms.create','manual',true,clock_timestamp(),null,10,'test:270','gradebook_contract',0);
  insert into public.classrooms(id,teacher_id,title,class_code) values
    (v_classroom,v_owner,'Gradebook contract',upper(substr(replace(v_classroom::text,'-',''),1,8))),
    (v_foreign,v_owner,'Foreign Gradebook contract',upper(substr(replace(v_foreign::text,'-',''),1,8)));
  update public.classrooms set feature_visibility=jsonb_set(feature_visibility,'{student_grades}','true') where id=v_classroom;
  insert into public.classroom_enrollments(classroom_id,student_id) values(v_classroom,v_owner),(v_classroom,v_member),(v_classroom,v_other);
  select id into strict v_category from public.gradebook_categories where classroom_id=v_classroom and is_default;
  insert into public.assignments(id,classroom_id,created_by,title,due_at,is_draft,points_possible) values
    (v_assignment,v_classroom,v_owner,'Returned assignment',clock_timestamp()+interval '1 day',false,30),
    (v_draft,v_classroom,v_owner,'Draft assignment',clock_timestamp()+interval '1 day',true,30);
  insert into public.assignment_docs(assignment_id,student_id,score_completion,score_thinking,score_workflow,returned_at) values
    (v_assignment,v_member,8,9,null,clock_timestamp()),(v_assignment,v_other,10,10,10,clock_timestamp());
  insert into public.tests(id,classroom_id,created_by,title,status) values(v_test,v_classroom,v_owner,'Returned Test','active');
  insert into public.test_questions(id,test_id,question_type,question_text,points,position) values(v_question,v_test,'open_response','Private answer prompt',10,0);
  insert into public.test_responses(test_id,question_id,student_id,response_text,score) values(v_test,v_question,v_member,'PRIVATE RESPONSE',7),(v_test,v_question,v_other,'PEER RESPONSE',9);
  insert into public.test_attempts(test_id,student_id,returned_at) values(v_test,v_member,clock_timestamp()),(v_test,v_other,clock_timestamp());
  execute 'set local role service_role';
  v_snapshot:=public.get_gradebook_for_owner_v1(v_owner,v_classroom,v_member,clock_timestamp()+interval '8 seconds');
  assert v_snapshot->>'selected_student_id'=v_member::text;
  assert jsonb_array_length(v_snapshot->'source'->'roster')=2;
  assert jsonb_array_length(v_snapshot->'source'->'assignments')=2;
  assert not jsonb_path_exists(v_snapshot,'$.source.assignment_docs[*].content');
  assert not jsonb_path_exists(v_snapshot,'$.source.test_questions[*].question_text');
  assert not jsonb_path_exists(v_snapshot,'$.source.test_responses[*].response_text');
  begin perform public.get_gradebook_for_member_v1(v_owner,v_classroom,'grades',clock_timestamp()+interval '8 seconds'); raise exception 'Owner precedence failed'; exception when sqlstate 'PT403' then null; end;
  begin perform public.get_gradebook_for_owner_v1(v_member,v_classroom,null,clock_timestamp()+interval '8 seconds'); raise exception 'Member owner authority failed'; exception when sqlstate 'PT403' then null; end;
  begin perform public.get_gradebook_for_member_v1(v_other,v_foreign,'grades',clock_timestamp()+interval '8 seconds'); raise exception 'Foreign membership failed'; exception when sqlstate 'PT403' then null; end;
  v_source:=public.get_gradebook_for_member_v1(v_member,v_classroom,'grades',clock_timestamp()+interval '8 seconds')->'source';
  assert v_source->>'student_id'=v_member::text;
  assert not (v_source ?| array['roster','profiles','email']);
  assert jsonb_array_length(v_source->'assignment_docs')=1 and jsonb_array_length(v_source->'assignments')=1;
  assert jsonb_array_length(v_source->'test_responses')=1;
  assert v_source->'test_responses'->0->>'student_id'=v_member::text;
  assert (v_source->'assignment_docs'->0->'score_workflow')='null'::jsonb, 'Source must preserve partial rows for existing projector';

  v_payload:=jsonb_build_object('item_id',v_item,'title','Standalone','points_possible',10,'gradebook_category_id',v_category,'gradebook_weight',0,'include_in_final',true);
  v_result:=public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'item_create',v_payload,clock_timestamp()+interval '8 seconds');
  assert v_result->'target'=jsonb_build_object('item_id',v_item);
  assert v_result->'result'->'item'->>'id'=v_item::text;
  assert v_result=public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'item_create',v_payload,clock_timestamp()+interval '8 seconds');
  begin perform public.mutate_gradebook_for_owner_v1(v_owner,v_foreign,'item_create',v_payload,clock_timestamp()+interval '8 seconds'); raise exception 'Create parent conflict failed'; exception when sqlstate 'PT409' then null; end;
  v_payload:=v_payload||jsonb_build_object('title','Standalone updated','points_possible',20);
  v_result:=public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'item_update',v_payload,clock_timestamp()+interval '8 seconds');
  assert exists(select 1 from public.gradebook_items where id=v_item and title='Standalone updated' and points_possible=20);
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'item_weight',jsonb_build_object('item_id',v_item,'gradebook_weight',1),clock_timestamp()+interval '8 seconds');
  assert exists(select 1 from public.gradebook_items where id=v_item and gradebook_weight=1);
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'item_weight',jsonb_build_object('item_id',v_item,'gradebook_weight',0),clock_timestamp()+interval '8 seconds');
  assert exists(select 1 from public.gradebook_items where id=v_item and gradebook_weight=0);
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'item_score',jsonb_build_object('item_id',v_item,'student_id',v_member,'earned',0),clock_timestamp()+interval '8 seconds');
  assert exists(select 1 from public.gradebook_item_scores where item_id=v_item and student_id=v_member and earned=0 and returned_at is null);
  v_source:=public.get_gradebook_for_member_v1(v_member,v_classroom,'items',clock_timestamp()+interval '8 seconds')->'source';
  assert jsonb_array_length(v_source->'items')=1 and jsonb_array_length(v_source->'item_scores')=1;
  assert jsonb_array_length(v_source->'assignments')=0 and jsonb_array_length(v_source->'tests')=0 and jsonb_array_length(v_source->'score_overrides')=0;
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'item_return_marks',jsonb_build_object('item_id',v_item),clock_timestamp()+interval '8 seconds');
  assert exists(select 1 from public.gradebook_item_scores where item_id=v_item and returned_at is not null);
  v_categories:=jsonb_build_array(jsonb_build_object('id',v_category,'name','Replacement','percentage',100,'default_assessment_weight',1,'position',0,'is_default',true));
  v_result:=public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'categories_replace',jsonb_build_object('categories',v_categories),clock_timestamp()+interval '8 seconds');
  assert v_result->'target'=jsonb_build_object('category_ids',jsonb_build_array(v_category));
  assert jsonb_array_length(v_result->'result'->'categories')=1;
  assert exists(select 1 from public.gradebook_categories where classroom_id=v_classroom and id=v_category and name='Replacement' and percentage=100 and is_default);
  begin perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'categories_replace',jsonb_build_object('categories',jsonb_set(v_categories,'{0,percentage}','99')),clock_timestamp()+interval '8 seconds'); raise exception 'Invalid categories accepted'; exception when sqlstate 'PT400' then null; end;

  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'maximum',jsonb_build_object('assessment_type','assignment','assessment_id',v_assignment,'maximum',60,'mode','preserve_percentages','expected_maximum',30,'expected_scale',1),clock_timestamp()+interval '8 seconds');
  assert exists(select 1 from public.assignments where id=v_assignment and gradebook_maximum_override=60 and gradebook_score_scale=2);
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'override_save',jsonb_build_object('assessment_type','assignment','assessment_id',v_assignment,'student_id',v_member,'earned',50),clock_timestamp()+interval '8 seconds');
  assert exists(select 1 from public.gradebook_score_overrides where assessment_id=v_assignment and student_id=v_member and earned=25);
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'override_save',jsonb_build_object('assessment_type','final','assessment_id',v_classroom,'student_id',v_member,'earned',91.2),clock_timestamp()+interval '8 seconds');
  assert exists(select 1 from public.gradebook_score_overrides where assessment_type='final' and assessment_id=v_classroom and student_id=v_member and earned=91.2 and created_by=v_owner);
  v_source:=public.get_gradebook_for_member_v1(v_member,v_classroom,'grades',clock_timestamp()+interval '8 seconds')->'source';
  assert jsonb_array_length(v_source->'score_overrides')=1 and v_source->'score_overrides'->0->>'assessment_type'='assignment';
  begin perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'maximum',jsonb_build_object('assessment_type','assignment','assessment_id',v_assignment,'maximum',20,'mode','keep_marks','expected_maximum',30,'expected_scale',1),clock_timestamp()+interval '8 seconds'); raise exception 'Stale maximum CAS failed'; exception when sqlstate 'PT409' then null; end;
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'maximum',jsonb_build_object('assessment_type','assignment','assessment_id',v_assignment,'maximum',null,'mode','reset','expected_maximum',60,'expected_scale',2),clock_timestamp()+interval '8 seconds');
  assert exists(select 1 from public.assignments where id=v_assignment and gradebook_maximum_override is null and gradebook_score_scale=1);
  execute 'reset role';
  v_before:=pg_temp.gradebook_contract_state(v_classroom);
  perform set_config('pika.gradebook_contract_fault',v_assignment::text,true);
  execute 'set local role service_role';
  begin perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'assessment_weight',jsonb_build_object('assessment_type','assignment','assessment_id',v_assignment,'gradebook_weight',0),clock_timestamp()+interval '8 seconds'); raise exception 'Partial write rollback failed'; exception when sqlstate 'PT503' then get stacked diagnostics v_message=message_text; assert v_message='gradebook_contract_after_write'; end;
  execute 'reset role';
  assert v_before=pg_temp.gradebook_contract_state(v_classroom),'Payload/revision changed after failed mutation';
  perform set_config('pika.gradebook_contract_fault','',true);
  execute 'set local role service_role';
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'assessment_weight',jsonb_build_object('assessment_type','assignment','assessment_id',v_assignment,'gradebook_weight',0),clock_timestamp()+interval '8 seconds');
  assert exists(select 1 from public.assignments where id=v_assignment and gradebook_weight=0);
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'assessment_details',jsonb_build_object('assessment_type','assignment','assessment_id',v_assignment,'gradebook_weight',0,'gradebook_category_id',null),clock_timestamp()+interval '8 seconds');
  assert exists(select 1 from public.assignments where id=v_assignment and gradebook_weight=0 and gradebook_category_id is null);
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'override_delete_one',jsonb_build_object('assessment_type','final','assessment_id',v_classroom,'student_id',v_member),clock_timestamp()+interval '8 seconds');
  assert not exists(select 1 from public.gradebook_score_overrides where assessment_type='final' and classroom_id=v_classroom);
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'override_delete_all','{}',clock_timestamp()+interval '8 seconds');
  assert not exists(select 1 from public.gradebook_score_overrides where classroom_id=v_classroom);
  assert exists(select 1 from public.gradebook_item_scores where item_id=v_item and earned=0);
  begin perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'override_delete_all',jsonb_build_object('actor_id',v_member),clock_timestamp()+interval '8 seconds'); raise exception 'Extra actor payload failed'; exception when sqlstate 'PT400' then null; end;

  -- A removed affected score subject must still block broad mutations.
  execute 'reset role';
  delete from public.classroom_enrollments where classroom_id=v_classroom and student_id=v_member;
  insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_binding_sha256,request_sha256,source_revision)
    values(v_purge,v_owner,v_classroom,v_member,repeat('a',64),repeat('b',64),1);
  insert into public.student_purge_fences(classroom_id,student_id,operation_id,teacher_id) values(v_classroom,v_member,v_purge,v_owner);
  execute 'set local role service_role';
  begin perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'item_delete',jsonb_build_object('item_id',v_item),clock_timestamp()+interval '8 seconds'); raise exception 'Removed subject fence failed'; exception when sqlstate 'PT409' then null; end;
  assert exists(select 1 from public.gradebook_items where id=v_item);
  begin perform public.get_gradebook_for_member_v1(v_member,v_classroom,'grades',clock_timestamp()+interval '8 seconds'); raise exception 'Removed membership failed'; exception when sqlstate 'PT403' then null; end;
  execute 'reset role';
  delete from public.student_purge_fences where operation_id=v_purge;
  delete from public.student_purge_operations where id=v_purge;
  insert into public.classroom_enrollments(classroom_id,student_id) values(v_classroom,v_member);
  update public.test_attempts set returned_at=null where test_id=v_test and student_id=v_member;
  execute 'set local role service_role';
  assert jsonb_array_length(public.get_gradebook_for_member_v1(v_member,v_classroom,'grades',clock_timestamp()+interval '8 seconds')->'source'->'tests')=0;
  execute 'reset role';
  update public.classrooms set feature_visibility=jsonb_set(feature_visibility,'{student_grades}','false') where id=v_classroom;
  execute 'set local role service_role';
  begin perform public.get_gradebook_for_member_v1(v_member,v_classroom,'grades',clock_timestamp()+interval '8 seconds'); raise exception 'Hidden Grades failed'; exception when sqlstate 'PT403' then null; end;
  assert jsonb_array_length(public.get_gradebook_for_member_v1(v_member,v_classroom,'items',clock_timestamp()+interval '8 seconds')->'source'->'items')=1;
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'item_score',jsonb_build_object('item_id',v_item,'student_id',v_member,'earned',null),clock_timestamp()+interval '8 seconds');
  assert not exists(select 1 from public.gradebook_item_scores where item_id=v_item and student_id=v_member);
  assert jsonb_array_length(public.get_gradebook_for_member_v1(v_member,v_classroom,'items',clock_timestamp()+interval '8 seconds')->'source'->'items')=0;
  perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'item_delete',jsonb_build_object('item_id',v_item),clock_timestamp()+interval '8 seconds');
  assert not exists(select 1 from public.gradebook_items where id=v_item);
  execute 'reset role';
  insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,installation_ref,roster_ref,actor_principal_ref)
    values(v_purge,v_classroom,v_owner,'gradebook-contract',v_purge::text,'gradebook-contract');
  execute 'set local role service_role';
  begin perform public.get_gradebook_for_owner_v1(v_owner,v_classroom,null,clock_timestamp()+interval '8 seconds'); raise exception 'Persisted lifecycle bypass failed';
    exception when sqlstate '55000' then get stacked diagnostics v_message=message_text; assert v_message='attendance_decommission_active'; end;
  execute 'reset role';
  delete from public.attendance_decommission_operations where id=v_purge and classroom_id=v_classroom;
  execute 'reset role';
  update public.classrooms set archived_at=clock_timestamp() where id=v_classroom;
  execute 'set local role service_role';
  assert public.get_gradebook_for_owner_v1(v_owner,v_classroom,null,clock_timestamp()+interval '8 seconds')->'classroom'->'archived_at'<>'null'::jsonb;
  begin perform public.mutate_gradebook_for_owner_v1(v_owner,v_classroom,'item_delete',jsonb_build_object('item_id',v_item),clock_timestamp()+interval '8 seconds'); raise exception 'Archived mutation failed'; exception when sqlstate 'PT403' then null; end;
  begin perform public.get_gradebook_for_member_v1(v_member,v_classroom,'items',clock_timestamp()+interval '8 seconds'); raise exception 'Archived member failed'; exception when sqlstate 'PT403' then null; end;
  begin perform public.get_gradebook_for_owner_v1(v_owner,v_classroom,null,clock_timestamp()-interval '1 second'); raise exception 'Expired deadline failed'; exception when sqlstate 'PT503' then null; end;
  foreach v_guc in array array['pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
    perform set_config(v_guc,'on',true);
    begin perform public.get_gradebook_for_owner_v1(v_owner,v_classroom,null,clock_timestamp()+interval '8 seconds'); raise exception 'Maintenance bypass failed'; exception when sqlstate 'PT403' then null; end;
    perform set_config(v_guc,'off',true);
  end loop;
  execute 'reset role';
  raise info 'Gradebook rollback contract assertions passed; concurrency and SDK proof remain separate';
end;
$contract$;
rollback;
