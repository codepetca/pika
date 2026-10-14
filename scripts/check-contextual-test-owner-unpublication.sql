-- Fixed rollback-only255/261 parity fixture. Never execute outside a reviewed disposable binding.
-- legacy-contextual-complete-parity / work-history-state-version-content-fences / portable-question-identities
-- late-fault-atomic-rollback
begin;
set local lock_timeout = '1s';
set local statement_timeout = '12s';
-- owner-unpublication-contracts-begin

do $guard$
begin
  if to_regprocedure('public.return_test_to_draft_atomic(uuid,uuid)') is null then
    raise exception 'Migration 255 is missing from the explicit target';
  end if;
  if to_regprocedure('public.record_test_focus_event_atomic(uuid,uuid,text,text,jsonb)') is null then
    raise exception 'Migration 255 focus recording RPC is missing from the explicit target';
  end if;
  if has_function_privilege('anon','public.record_test_focus_event_atomic(uuid,uuid,text,text,jsonb)','execute')
    or has_function_privilege('authenticated','public.record_test_focus_event_atomic(uuid,uuid,text,text,jsonb)','execute')
    or not has_function_privilege('service_role','public.record_test_focus_event_atomic(uuid,uuid,text,text,jsonb)','execute') then
    raise exception 'Focus recording RPC privileges differ';
  end if;
  if has_function_privilege('anon','public.return_test_to_draft_atomic(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.return_test_to_draft_atomic(uuid,uuid)','execute')
    or not has_function_privilege('service_role','public.return_test_to_draft_atomic(uuid,uuid)','execute') then
    raise exception 'Return Test to draft RPC privileges differ';
  end if;
end;
$guard$;

insert into public.users(id,email,role) values
 ('a2610000-0000-4000-8000-000000000001','unpublish-owner@example.test','teacher'),
 ('a2610000-0000-4000-8000-000000000002','unpublish-other@example.test','teacher'),
 ('a2610000-0000-4000-8000-000000000003','unpublish-student@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('a2610000-0000-4000-8000-000000000010','a2610000-0000-4000-8000-000000000001','Test unpublication rollback fixture','B255T1'),
 ('a2610000-0000-4000-8000-000000000020','a2610000-0000-4000-8000-000000000001','Polymorphic override fixture','B255T2');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('a2610000-0000-4000-8000-000000000010','a2610000-0000-4000-8000-000000000003'),
 ('a2610000-0000-4000-8000-000000000020','a2610000-0000-4000-8000-000000000003');
insert into public.tests(id,classroom_id,title,status,show_results,points_possible,created_by,documents) values
 ('a2610000-0000-4000-8000-000000000011','a2610000-0000-4000-8000-000000000010','Current published title','closed',true,3,'a2610000-0000-4000-8000-000000000001',
  '[{"id":"source-link","source":"link","title":"Retained source","url":"https://example.invalid/lesson"}]'::jsonb),
 ('a2610000-0000-4000-8000-000000000021','a2610000-0000-4000-8000-000000000010','No retained draft','closed',false,1,'a2610000-0000-4000-8000-000000000001','[]'::jsonb),
 ('a2610000-0000-4000-8000-000000000031','a2610000-0000-4000-8000-000000000010','Rejected source','closed',false,2,'a2610000-0000-4000-8000-000000000001','[]'::jsonb);
insert into public.test_questions(id,test_id,artifact_id,source_artifact_id,question_type,question_text,options,correct_option,answer_key,points,response_max_chars,response_monospace,position) values
 ('a2610000-0000-4000-8000-000000000101','a2610000-0000-4000-8000-000000000011','a2610000-0000-4000-8000-000000000111',null,'multiple_choice','Current choice','["Yes","No"]',0,null,1,5000,false,0),
 ('a2610000-0000-4000-8000-000000000102','a2610000-0000-4000-8000-000000000011','a2610000-0000-4000-8000-000000000112','a2610000-0000-4000-8000-000000000122','open_response','Current prompt','[]',null,'Current key',2,5000,true,1),
 ('a2610000-0000-4000-8000-000000000201','a2610000-0000-4000-8000-000000000021','a2610000-0000-4000-8000-000000000211',null,'open_response','No draft prompt','[]',null,'Key',1,5000,false,0),
 ('a2610000-0000-4000-8000-000000000301','a2610000-0000-4000-8000-000000000031','a2610000-0000-4000-8000-000000000311',null,'multiple_choice','Reject prompt one','["A","B"]',0,null,1,5000,false,0),
 ('a2610000-0000-4000-8000-000000000302','a2610000-0000-4000-8000-000000000031','a2610000-0000-4000-8000-000000000312',null,'multiple_choice','Reject prompt two','["A","B"]',0,null,1,5000,false,1);
insert into public.assessment_drafts(id,assessment_type,assessment_id,classroom_id,content,version,created_by,updated_by) values
 ('a2610000-0000-4000-8000-000000000012','test','a2610000-0000-4000-8000-000000000011','a2610000-0000-4000-8000-000000000010',
  '{"title":"Stale title","show_results":false,"question_identity_version":1,"questions":[{"id":"a2610000-0000-4000-8000-000000000111","question_type":"multiple_choice","question_text":"Stale prompt","options":["A","B"],"correct_option":0,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}',
  7,'a2610000-0000-4000-8000-000000000001','a2610000-0000-4000-8000-000000000001');
insert into public.test_student_availability(test_id,student_id,state,updated_by) values
 ('a2610000-0000-4000-8000-000000000011','a2610000-0000-4000-8000-000000000003','closed','a2610000-0000-4000-8000-000000000001');

create function pg_temp.protected_unpublication_graph(p_test_id uuid) returns jsonb
language sql stable security definer set search_path='' as $protected$
 select coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'fingerprint',
 query_to_xml(format('select count(*) as count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) as digest from %I.%I r %s',
 n.nspname,c.relname,case n.nspname||'.'||c.relname
 when 'public.tests' then format('where r.id<>%L::uuid',p_test_id)
 when 'public.assessment_drafts' then format('where not(r.assessment_type=''test'' and r.assessment_id=%L::uuid)',p_test_id)
 when 'public.classrooms' then format('where r.id<>(select classroom_id from public.tests where id=%L::uuid)',p_test_id)
 when 'public.classroom_archive_revisions' then format('where r.classroom_id<>(select classroom_id from public.tests where id=%L::uuid)',p_test_id)
 else '' end),true,false,'')::text) order by n.nspname,c.relname),'[]'::jsonb)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in('r','p') and n.nspname in('public','private','storage');
$protected$;
create function pg_temp.test_unpublication_graph(p_test_id uuid) returns jsonb
language sql stable as $graph$
  select jsonb_build_object(
    'protected',pg_temp.protected_unpublication_graph(p_test_id),
    'archive_revision',(select to_jsonb(r) from public.classroom_archive_revisions r where r.classroom_id=(select classroom_id from public.tests where id=p_test_id)),
    'test',(select to_jsonb(t) from public.tests t where t.id=p_test_id),
    'draft',(select to_jsonb(d) from public.assessment_drafts d where d.assessment_type='test' and d.assessment_id=p_test_id),
    'questions',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb) from public.test_questions q where q.test_id=p_test_id),
    'availability',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.test_student_availability a where a.test_id=p_test_id),
    'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.test_attempts a where a.test_id=p_test_id),
    'responses',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.test_responses r where r.test_id=p_test_id),
    'focus',(select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) from public.test_focus_events f where f.test_id=p_test_id),
    'grading_runs',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.test_ai_grading_runs r where r.test_id=p_test_id),
    'grading_items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.test_ai_grading_run_items i where i.test_id=p_test_id),
    'overrides',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]'::jsonb) from public.gradebook_score_overrides o where o.assessment_type='test' and o.assessment_id=p_test_id),
    'classroom',(select to_jsonb(c) from public.classrooms c where c.id='a2610000-0000-4000-8000-000000000010')
  );
$graph$;

create function pg_temp.expect_unpublication_rejection(p_actor uuid,p_test uuid,p_code text,p_message text,p_label text)
returns void language plpgsql as $reject$
declare before_graph jsonb; after_graph jsonb; actual_code text; actual_message text;
begin
  before_graph := pg_temp.test_unpublication_graph(p_test);
  begin
    perform public.return_test_to_draft_atomic(p_actor,p_test);
    raise exception 'Unexpected unpublication success: %', p_label;
  exception when others then
    get stacked diagnostics actual_code=returned_sqlstate, actual_message=message_text;
    if actual_code is distinct from p_code or actual_message is distinct from p_message then
      raise exception 'Wrong rejection for %: % %',p_label,actual_code,actual_message;
    end if;
  end;
  -- Every inherited255 eligibility probe is also run through the current-owner path.
  begin
    perform public.test_owner_workflow_v1(p_actor,p_test,
      (select classroom_id from public.tests where id=p_test),'unpublish','{}'::jsonb,
      (select to_jsonb(t) from public.tests t where id=p_test),clock_timestamp()+interval '25 seconds');
    raise exception 'Unexpected contextual unpublication success: %',p_label;
  exception when others then
    get stacked diagnostics actual_code=returned_sqlstate;
    if actual_code is distinct from p_code then raise exception 'Contextual parity code differs for %: %',p_label,actual_code;end if;
  end;
  after_graph := pg_temp.test_unpublication_graph(p_test);
  if after_graph is distinct from before_graph then
    raise exception 'Rejected unpublication changed graph: %',p_label;
  end if;
  if p_message='test_unpublish_has_work' then
    -- Every work relation must win over the draft shortcut, including history.
    begin
      update public.tests set status='draft' where id=p_test;
      before_graph:=pg_temp.test_unpublication_graph(p_test);
      begin perform public.return_test_to_draft_atomic(p_actor,p_test);
        raise exception 'Legacy draft work accepted';
      exception when sqlstate 'PT409' then
        get stacked diagnostics actual_message=message_text;
        if actual_message<>'test_unpublish_has_work' then raise exception 'Draft work precedence differs';end if;
      end;
      begin perform public.test_owner_workflow_v1(p_actor,p_test,(select classroom_id from public.tests where id=p_test),'unpublish','{}',
        (select to_jsonb(t) from public.tests t where id=p_test),clock_timestamp()+interval '25 seconds');
        raise exception 'Contextual draft work accepted';
      exception when sqlstate 'PT409' then
        get stacked diagnostics actual_message=message_text;
        if actual_message<>'test_unpublish_has_work' then raise exception 'Contextual draft work precedence differs';end if;
      end;
      if pg_temp.test_unpublication_graph(p_test) is distinct from before_graph then raise exception 'Draft work rejection changed graph';end if;
      raise exception using errcode='ZX261',message='rollback draft work case';
    exception when sqlstate 'ZX261' then null;end;
  end if;
end;
$reject$;

create function pg_temp.reject_unpublication_status_update() returns trigger
language plpgsql as $fault$
begin
  raise exception using errcode='55000', message='forced_unpublication_status_failure';
end;
$fault$;

-- Invoke the success path as the actual granted role; the definer function
-- must perform the private checks without granting private schema access.
set local role service_role;
do $success$
declare
  owner_id uuid := 'a2610000-0000-4000-8000-000000000001';
  retained_id uuid := 'a2610000-0000-4000-8000-000000000011';
  new_id uuid := 'a2610000-0000-4000-8000-000000000021';
  before_graph jsonb; after_graph jsonb; result jsonb; content jsonb;
begin
  if current_user <> 'service_role' then raise exception 'Success did not invoke as service_role'; end if;
  before_graph := pg_temp.test_unpublication_graph(retained_id);
  result := public.return_test_to_draft_atomic(owner_id,retained_id);
  after_graph := pg_temp.test_unpublication_graph(retained_id);
  content := after_graph#>'{draft,content}';
  if result->>'draft_version' <> '8' or result#>>'{test,status}' <> 'draft'
    or after_graph#>>'{draft,version}' <> '8'
    or content->>'title' <> 'Current published title'
    or content->>'show_results' <> 'true'
    or content->>'question_identity_version' <> '1'
    or jsonb_array_length(content->'questions') <> 2
    or content#>>'{questions,0,id}' <> 'a2610000-0000-4000-8000-000000000111'
    or content#>>'{questions,0,question_text}' <> 'Current choice'
    or content#>>'{questions,1,id}' <> 'a2610000-0000-4000-8000-000000000122'
    or content#>>'{questions,1,question_text}' <> 'Current prompt'
    or content#>>'{questions,1,answer_key}' <> 'Current key'
    or after_graph->'protected' is distinct from before_graph->'protected'
    or (after_graph#>>'{archive_revision,revision}')::bigint<>(before_graph#>>'{archive_revision,revision}')::bigint+3
    or ((after_graph->'archive_revision')-array['revision','updated_at']) is distinct from ((before_graph->'archive_revision')-array['revision','updated_at'])
    or (after_graph#>>'{archive_revision,updated_at}')::timestamptz is distinct from transaction_timestamp()
    or (after_graph#>>'{classroom,blueprint_source_revision}')::bigint<>(before_graph#>>'{classroom,blueprint_source_revision}')::bigint+1
    or ((after_graph->'classroom')-array['blueprint_source_revision','updated_at']) is distinct from ((before_graph->'classroom')-array['blueprint_source_revision','updated_at'])
    or (after_graph#>>'{classroom,updated_at}')::timestamptz is distinct from transaction_timestamp()
    or after_graph->'questions' is distinct from before_graph->'questions'
    or after_graph->'availability' is distinct from before_graph->'availability'
    or after_graph#>'{test,documents}' is distinct from before_graph#>'{test,documents}'
    or ((after_graph->'test') - array['status','updated_at']) is distinct from ((before_graph->'test') - array['status','updated_at'])
    or ((after_graph->'draft') - array['content','version','updated_at']) is distinct from ((before_graph->'draft') - array['content','version','updated_at']) then
    raise exception 'Retained draft was not reconstructed from published rows without collateral changes';
  end if;
  before_graph := after_graph;
  result := public.return_test_to_draft_atomic(owner_id,retained_id);
  if result->>'draft_version' <> '8' or pg_temp.test_unpublication_graph(retained_id) is distinct from before_graph then
    raise exception 'Retained draft retry changed state';
  end if;
  before_graph := pg_temp.test_unpublication_graph(new_id);
  result := public.return_test_to_draft_atomic(owner_id,new_id);
  after_graph := pg_temp.test_unpublication_graph(new_id);
  if result->>'draft_version' <> '1' or after_graph#>>'{draft,version}' <> '1'
    or after_graph#>>'{draft,content,title}' <> 'No retained draft'
    or after_graph#>>'{draft,content,questions,0,id}' <> 'a2610000-0000-4000-8000-000000000211'
    or after_graph->'protected' is distinct from before_graph->'protected'
    or (after_graph#>>'{archive_revision,revision}')::bigint<>(before_graph#>>'{archive_revision,revision}')::bigint+3
    or ((after_graph->'archive_revision')-array['revision','updated_at']) is distinct from ((before_graph->'archive_revision')-array['revision','updated_at'])
    or (after_graph#>>'{archive_revision,updated_at}')::timestamptz is distinct from transaction_timestamp()
    or (after_graph#>>'{classroom,blueprint_source_revision}')::bigint<>(before_graph#>>'{classroom,blueprint_source_revision}')::bigint+1
    or ((after_graph->'classroom')-array['blueprint_source_revision','updated_at']) is distinct from ((before_graph->'classroom')-array['blueprint_source_revision','updated_at'])
    or (after_graph#>>'{classroom,updated_at}')::timestamptz is distinct from transaction_timestamp()
    or after_graph->'questions' is distinct from before_graph->'questions' then
    raise exception 'Missing-draft conversion did not create version one';
  end if;
  before_graph := after_graph;
  result := public.return_test_to_draft_atomic(owner_id,new_id);
  if result->>'draft_version' <> '1' or pg_temp.test_unpublication_graph(new_id) is distinct from before_graph then
    raise exception 'Missing-draft retry changed state';
  end if;
end;
$success$;
reset role;

do $reject_cases$
<<scenario>>
declare
  owner_id uuid := 'a2610000-0000-4000-8000-000000000001';
  other_id uuid := 'a2610000-0000-4000-8000-000000000002';
  student_id uuid := 'a2610000-0000-4000-8000-000000000003';
  test_id uuid := 'a2610000-0000-4000-8000-000000000031';
  classroom_id uuid := 'a2610000-0000-4000-8000-000000000010';
  before_graph jsonb;
  before_triggers jsonb; after_triggers jsonb;
begin
  perform pg_temp.expect_unpublication_rejection(other_id,test_id,'PT403','test_unpublish_forbidden','wrong teacher');
  update public.classrooms set archived_at=now() where id=classroom_id;
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT403','test_unpublish_forbidden','archived classroom');
  update public.classrooms set archived_at=null where id=classroom_id;
  update public.tests set blueprint_archived_at=now() where id=test_id;
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT403','test_unpublish_forbidden','archived Blueprint Test');
  update public.tests set blueprint_archived_at=null where id=test_id;
  update public.tests set status='active' where id=test_id;
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_not_eligible','active Test');
  update public.tests set status='closed' where id=test_id;

  insert into public.test_student_availability(test_id,student_id,state,updated_by) values(test_id,student_id,'open',owner_id);
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','open availability');
  delete from public.test_student_availability where test_student_availability.test_id=scenario.test_id;

  insert into public.test_attempts(test_id,student_id,responses) values(test_id,student_id,'{}');
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','attempt');
  delete from public.test_attempts where test_attempts.test_id=scenario.test_id;

  insert into public.test_responses(test_id,question_id,student_id,selected_option) values(test_id,'a2610000-0000-4000-8000-000000000301',student_id,0);
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','response');
  delete from public.test_responses where test_responses.test_id=scenario.test_id;

  insert into public.test_student_availability(test_id,student_id,state,updated_by) values(test_id,student_id,'open',owner_id);
  insert into public.test_focus_events(test_id,student_id,session_id,event_type) values(test_id,student_id,'b255-fixture','away_start');
  update public.test_student_availability set state='closed' where test_student_availability.test_id=scenario.test_id;
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','focus event');
  delete from public.test_focus_events where test_focus_events.test_id=scenario.test_id;
  delete from public.test_student_availability where test_student_availability.test_id=scenario.test_id;

  insert into public.test_ai_grading_runs(id,test_id,triggered_by,selection_hash,status)
    values('a2610000-0000-4000-8000-000000000401',test_id,owner_id,'b255-fixture','completed');
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','grading run');
  insert into public.test_responses(id,test_id,question_id,student_id,selected_option)
    values('a2610000-0000-4000-8000-000000000402',test_id,'a2610000-0000-4000-8000-000000000301',student_id,0);
  insert into public.test_ai_grading_run_items(run_id,test_id,student_id,question_id,response_id,status)
    values('a2610000-0000-4000-8000-000000000401',test_id,student_id,
      'a2610000-0000-4000-8000-000000000301','a2610000-0000-4000-8000-000000000402','completed');
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','grading item with required parents');
  delete from public.test_ai_grading_runs where test_ai_grading_runs.test_id=scenario.test_id;
  delete from public.test_responses where test_responses.test_id=scenario.test_id;

  insert into public.gradebook_score_overrides(classroom_id,student_id,assessment_type,assessment_id,earned,created_by)
    values(classroom_id,student_id,'test',test_id,1,owner_id);
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','grade override');
  delete from public.gradebook_score_overrides where assessment_type='test' and assessment_id=test_id;
  insert into public.gradebook_score_overrides(classroom_id,student_id,assessment_type,assessment_id,earned,created_by)
    values('a2610000-0000-4000-8000-000000000020',student_id,'test',test_id,1,owner_id);
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','wrong-Class polymorphic grade override');
  delete from public.gradebook_score_overrides where assessment_type='test' and assessment_id=test_id;

  -- Migration 254's unique portable-identity index rejects this corruption
  -- before the unpublication RPC can observe it. Prove that failed write rolls
  -- back without changing the graph.
  before_graph := pg_temp.test_unpublication_graph(test_id);
  begin
    update public.test_questions set source_artifact_id='a2610000-0000-4000-8000-000000000311'
      where id='a2610000-0000-4000-8000-000000000302';
    raise exception 'Duplicate portable question identity was accepted';
  exception when unique_violation then null;
  end;
  if pg_temp.test_unpublication_graph(test_id) is distinct from before_graph then
    raise exception 'Duplicate question identity write changed graph';
  end if;
  update public.test_questions set options='["A",""]'::jsonb where id='a2610000-0000-4000-8000-000000000302';
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_invalid_published_content','invalid published question');
  update public.test_questions set options='["A","B"]'::jsonb where id='a2610000-0000-4000-8000-000000000302';
  -- Release the late-fault trigger DDL locks before the next fixed frame.
  before_graph := pg_temp.test_unpublication_graph(test_id);
  select coalesce(jsonb_agg(to_jsonb(t) order by t.oid),'[]'::jsonb) into before_triggers
    from pg_catalog.pg_trigger t where t.tgrelid='public.tests'::regclass;
  begin
    execute $late_fault_ddl$create trigger reject_unpublication_status_update
      before update on public.tests for each row
      when (new.id='a2610000-0000-4000-8000-000000000031'::uuid
        and old.status='closed' and new.status='draft')
      execute function pg_temp.reject_unpublication_status_update()$late_fault_ddl$;
    perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'55000','forced_unpublication_status_failure','partial draft write rollback');
    execute 'drop trigger reject_unpublication_status_update on public.tests';
    raise exception using errcode='ZX261',message='rollback late-fault trigger DDL';
  exception when sqlstate 'ZX261' then null;end;
  if pg_temp.test_unpublication_graph(test_id) is distinct from before_graph then
    raise exception 'Late-fault trigger rollback changed full graph';
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.oid),'[]'::jsonb) into after_triggers
    from pg_catalog.pg_trigger t where t.tgrelid='public.tests'::regclass;
  if after_triggers is distinct from before_triggers then
    raise exception 'Late-fault trigger rollback changed trigger catalog';
  end if;
  if exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='public.tests'::regclass
    and t.tgname='reject_unpublication_status_update') then
    raise exception 'Late-fault trigger rollback retained owned trigger';
  end if;
  if exists(select 1 from pg_catalog.pg_locks l where l.locktype='relation'
    and l.database=(select d.oid from pg_catalog.pg_database d where d.datname=current_database())
    and l.relation='public.tests'::regclass and l.pid=pg_backend_pid()
    and l.mode='AccessExclusiveLock' and l.granted) then
    raise exception 'Late-fault trigger rollback retained owned AccessExclusiveLock';
  end if;
  begin
    update public.tests set questions_locked_at=now() where id=test_id;
    perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_not_eligible','locked questions');
    --143 makes this lock irreversible; restore the fixture by transaction rollback.
    raise exception using errcode='ZX261',message='rollback irreversible question-lock probe';
  exception when sqlstate 'ZX261' then null;end;
end;
$reject_cases$;


-- Additional255/261 parity limits run before the intentional late status fault.
do $limits261$ declare owner_id uuid:='a2610000-0000-4000-8000-000000000001';
 tid uuid:='a2610000-0000-4000-8000-000000000031';cid uuid:='a2610000-0000-4000-8000-000000000010';
 student_id uuid:='a2610000-0000-4000-8000-000000000003';attempt_id uuid;restored integer;
begin
 update public.tests t set status='closed',questions_locked_at=null where t.id=tid and t.classroom_id=cid;
 get diagnostics restored=row_count;
 if restored<>1 or not exists(select 1 from public.tests t where t.id=tid and t.classroom_id=cid and t.status='closed' and t.questions_locked_at is null)
 then raise exception 'Limits fixture pristine Test differs';end if;
 insert into public.assessment_drafts(assessment_type,assessment_id,classroom_id,content,version,created_by,updated_by)
 values('test',tid,'a2610000-0000-4000-8000-000000000020','{"title":"Synthetic retained draft","show_results":false,"question_identity_version":1,"questions":[]}'::jsonb,1,owner_id,owner_id);
 perform pg_temp.expect_unpublication_rejection(owner_id,tid,'PT409','test_unpublish_draft_mismatch','wrong Draft parent');
 update public.assessment_drafts set classroom_id=cid,version=2147483647 where assessment_type='test' and assessment_id=tid;
 perform pg_temp.expect_unpublication_rejection(owner_id,tid,'PT409','test_unpublish_version_limit','closed teacher-owner INT_MAX');
 update public.assessment_drafts set version=1 where assessment_type='test' and assessment_id=tid;
 update public.tests set status='draft' where id=tid;
 insert into public.test_attempts(test_id,student_id,responses) values(tid,student_id,'{}') returning id into attempt_id;
 insert into public.test_attempt_history(test_attempt_id,snapshot,word_count,char_count,paste_word_count,keystroke_count,trigger)
 values(attempt_id,'{}',0,0,0,0,'baseline');
 perform pg_temp.expect_unpublication_rejection(owner_id,tid,'PT409','test_unpublish_has_work','draft shortcut still fences attempt history');
 delete from public.test_attempts where id=attempt_id;
 delete from public.assessment_drafts where assessment_type='test' and assessment_id=tid;
 perform pg_temp.expect_unpublication_rejection(owner_id,tid,'PT409','test_unpublish_missing_draft','draft without retained Draft');
 update public.tests set status='closed' where id=tid;
 update public.test_questions set question_text=repeat('x',1100000) where test_id=tid;
 perform pg_temp.expect_unpublication_rejection(owner_id,tid,'PT503','test_unpublish_content_limit','published JSON beyond2MiB');
 update public.test_questions set question_text='Restored synthetic bounded prompt' where test_id=tid;
end;$limits261$;
create temporary table unpublication_count261_baseline(singleton boolean primary key check(singleton),graph jsonb not null) on commit drop;
insert into pg_temp.unpublication_count261_baseline(singleton,graph)
 select true,pg_temp.test_unpublication_graph('a2610000-0000-4000-8000-000000000031'::uuid);
do $count_pristine261$ begin
 if (select count(*) from public.test_questions where test_id='a2610000-0000-4000-8000-000000000031'::uuid)<>2
 then raise exception 'Count fixture pristine question count differs';end if;
end;$count_pristine261$;
savepoint unpublication_count261;
insert into public.test_questions(id,test_id,artifact_id,question_type,question_text,options,correct_option,points,position)
 select md5('unpublish261-bound-row:'||g)::uuid,'a2610000-0000-4000-8000-000000000031'::uuid,md5('unpublish261-bound-artifact:'||g)::uuid,'open_response','Synthetic bound','[]',null,1,g+1 from generate_series(1,2500) g;

-- Count-only fixture rows2501-5000.
insert into public.test_questions(id,test_id,artifact_id,question_type,question_text,options,correct_option,points,position)
 select md5('unpublish261-bound-row:'||g)::uuid,'a2610000-0000-4000-8000-000000000031'::uuid,md5('unpublish261-bound-artifact:'||g)::uuid,'open_response','Synthetic bound','[]',null,1,g+1 from generate_series(2501,5000) g;

-- Count-only fixture rows5001-7500.
insert into public.test_questions(id,test_id,artifact_id,question_type,question_text,options,correct_option,points,position)
 select md5('unpublish261-bound-row:'||g)::uuid,'a2610000-0000-4000-8000-000000000031'::uuid,md5('unpublish261-bound-artifact:'||g)::uuid,'open_response','Synthetic bound','[]',null,1,g+1 from generate_series(5001,7500) g;

-- Count-only fixture rows7501-10000.
insert into public.test_questions(id,test_id,artifact_id,question_type,question_text,options,correct_option,points,position)
 select md5('unpublish261-bound-row:'||g)::uuid,'a2610000-0000-4000-8000-000000000031'::uuid,md5('unpublish261-bound-artifact:'||g)::uuid,'open_response','Synthetic bound','[]',null,1,g+1 from generate_series(7501,10000) g;

-- Count-only fixture rejection and savepoint restoration.
do $count_limit261$ declare owner_id uuid:='a2610000-0000-4000-8000-000000000001';tid uuid:='a2610000-0000-4000-8000-000000000031';
begin
 if (select count(*) from public.test_questions where test_id=tid)<>10002
 or (select count(*) from public.test_questions q join generate_series(1,10000) g on q.id=md5('unpublish261-bound-row:'||g)::uuid where q.test_id=tid)<>10000
 then raise exception 'Count fixture generated question count differs';end if;
 perform pg_temp.expect_unpublication_rejection(owner_id,tid,'PT503','test_unpublish_question_limit','more than10000 published rows');
end;$count_limit261$;
rollback to savepoint unpublication_count261;
release savepoint unpublication_count261;
do $count_restored261$ declare tid uuid:='a2610000-0000-4000-8000-000000000031';baseline jsonb;
begin
 select graph into strict baseline from pg_temp.unpublication_count261_baseline where singleton;
 if pg_temp.test_unpublication_graph(tid) is distinct from baseline then raise exception 'Count fixture rollback changed full graph';end if;
 if (select count(*) from public.test_questions where test_id=tid)<>2
 or (select jsonb_agg(to_jsonb(q) order by q.id) from public.test_questions q where q.test_id=tid) is distinct from baseline->'questions'
 then raise exception 'Count fixture rollback changed original question rows';end if;
end;$count_restored261$;
drop table pg_temp.unpublication_count261_baseline;
do $limits_fences261$ declare owner_id uuid:='a2610000-0000-4000-8000-000000000001';
 tid uuid:='a2610000-0000-4000-8000-000000000031';cid uuid:='a2610000-0000-4000-8000-000000000010';flag text;prior text;baseline jsonb;
begin
 foreach flag in array array['pika.classroom_archive_restore','pika.classroom_archive_compaction','pika.identity_mapping','pika.classroom_purge_finalize','pika.course_blueprint_purge_finalize','pika.student_purge_finalize'] loop
  prior:=current_setting(flag,true);perform set_config(flag,'on',true);
  perform pg_temp.expect_unpublication_rejection(owner_id,tid,'PT403','test_unpublish_fenced',flag);
  perform set_config(flag,coalesce(prior,'off'),true);
 end loop;
 -- A stale full Test and wrong fixed parent fail before any canonical rewrite.
 baseline:=pg_temp.test_unpublication_graph(tid);
 begin perform public.test_owner_workflow_v1(owner_id,tid,'a2610000-0000-4000-8000-000000000020','unpublish','{}',baseline->'test',clock_timestamp()+interval '25 seconds');
 raise exception 'Wrong fixed parent accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.test_owner_workflow_v1(owner_id,tid,cid,'unpublish','{}',(baseline->'test')||'{"title":"stale inspected source"}',clock_timestamp()+interval '25 seconds');
 raise exception 'Stale full Test accepted';exception when sqlstate 'PT409' then null;end;
 if pg_temp.test_unpublication_graph(tid) is distinct from baseline then raise exception 'Stale-source rejection changed whole graph';end if;
end;$limits_fences261$;

-- Pending provider cleanup is only a relational fence; no provider is called.
do $provider_fence261$ declare owner_id uuid:='a2610000-0000-4000-8000-000000000001';
 tid uuid:='a2610000-0000-4000-8000-000000000031';cid uuid:='a2610000-0000-4000-8000-000000000010';
 sid uuid:='a2610000-0000-4000-8000-000000000003';op uuid:='a2610000-0000-4000-8000-000000000112';generation record;baseline jsonb;
begin
 baseline:=pg_temp.test_unpublication_graph(tid);
 begin
 select * into strict generation from private.pal_membership_generations
 where scope_digest=encode(sha256(convert_to('pika-membership-scope-v1:'||cid::text||':'||sid::text,'UTF8')),'hex') and state='active';
 insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_binding_sha256,request_sha256,status,source_revision)
 values(op,owner_id,cid,sid,repeat('a',64),repeat('b',64),'inventorying',1);
 insert into private.student_provider_cleanup_bindings(operation_id,generation_id,scope_digest,pal_reference,pal_origin,pal_integration_id,
 bara_origin,installation_ref,roster_ref,participant_ref,actor_principal_ref)
 values(op,generation.generation_id,generation.scope_digest,generation.pal_reference,'https://example.invalid',owner_id,
 'https://example.invalid','synthetic','roster_'||repeat('a',32),'participant_'||repeat('a',32),'principal_'||repeat('a',32));
 perform pg_temp.expect_unpublication_rejection(owner_id,tid,'PT403','test_unpublish_fenced','pending provider-cleanup fence');
 raise exception using errcode='ZX261',message='rollback retained provider-fence evidence';
 exception when sqlstate 'ZX261' then null;end;
 if pg_temp.test_unpublication_graph(tid) is distinct from baseline then raise exception 'Provider fence rollback changed full graph';end if;
end;$provider_fence261$;

-- service-only-empty-search-path / private-core-service-denial
do $acl261$ declare p record;begin
 for p in select * from pg_proc where oid in (
 'public.return_test_to_draft_atomic(uuid,uuid)'::regprocedure,
 'public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz)'::regprocedure) loop
 if pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef
 or not ('search_path=""'=any(p.proconfig))
 or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')
 or not has_function_privilege('service_role',p.oid,'execute')
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0)
 then raise exception 'Unpublication outer boundary differs';end if;end loop;
 select * into strict p from pg_proc where oid='private.return_test_to_draft_core_v1(uuid,uuid,boolean)'::regprocedure;
 if pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef or not ('search_path=""'=any(p.proconfig))
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where a.grantee<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable)
 or has_function_privilege('service_role',p.oid,'execute') then raise exception 'Private core ACL differs';end if;
end;$acl261$;
set local role service_role;
do $deny_core261$ begin
 begin perform private.return_test_to_draft_core_v1('a2610000-0000-4000-8000-000000000001','a2610000-0000-4000-8000-000000000011',false);
 raise exception 'Private core was executable as service';exception when insufficient_privilege then null;end;
end;$deny_core261$;
reset role;

-- mixed-role-current-owner / current-member-former-owner-foreign-creator-denial
-- canonical-published-source / whole-graph-preservation / idempotent-draft-full-equality
do $contextual261$ declare
 owner_id uuid:='a2610000-0000-4000-8000-000000000001';member_id uuid:='a2610000-0000-4000-8000-000000000003';
 foreign_id uuid:='a2610000-0000-4000-8000-000000000002';tid uuid:='a2610000-0000-4000-8000-000000000011';
 cid uuid:='a2610000-0000-4000-8000-000000000010';before_graph jsonb;after_graph jsonb;result jsonb;canonical jsonb;
begin
 -- Restore a closed pristine source, retaining the previously rebuilt draft.
 update public.tests set status='closed' where id=tid;
 update public.users set role='student' where id=owner_id;
 insert into public.classroom_enrollments(classroom_id,student_id) values(cid,owner_id);
 update public.tests set created_by=foreign_id where id=tid;
 before_graph:=pg_temp.test_unpublication_graph(tid);
 begin perform public.return_test_to_draft_atomic(owner_id,tid);raise exception 'Legacy student owner accepted';exception when sqlstate 'PT403' then null;end;
 if pg_temp.test_unpublication_graph(tid) is distinct from before_graph then raise exception 'Legacy role denial changed graph';end if;
 result:=public.test_owner_workflow_v1(owner_id,tid,cid,'unpublish','{}',before_graph->'test',clock_timestamp()+interval '25 seconds');
 after_graph:=pg_temp.test_unpublication_graph(tid);
 select jsonb_build_object('title',t.title,'show_results',t.show_results,'question_identity_version',1,'questions',
 (select coalesce(jsonb_agg(jsonb_build_object('id',coalesce(q.source_artifact_id,q.artifact_id,q.id),
 'question_type',q.question_type,'question_text',q.question_text,'options',q.options,'correct_option',q.correct_option,
 'answer_key',q.answer_key,'sample_solution',q.sample_solution,'points',q.points,'response_max_chars',q.response_max_chars,
 'response_monospace',q.response_monospace) order by q.position,q.id),'[]'::jsonb) from public.test_questions q where q.test_id=t.id))
 into canonical from public.tests t where t.id=tid;
 if result#>>'{result,draft_version}'<>'9' or result->'test' is distinct from after_graph->'test'
 or result#>>'{test,status}'<>'draft' or after_graph#>'{draft,content}' is distinct from canonical
 or (after_graph-array['test','draft','archive_revision','classroom']) is distinct from (before_graph-array['test','draft','archive_revision','classroom'])
 or (after_graph#>>'{archive_revision,revision}')::bigint<>(before_graph#>>'{archive_revision,revision}')::bigint+3
 or ((after_graph->'archive_revision')-array['revision','updated_at']) is distinct from ((before_graph->'archive_revision')-array['revision','updated_at'])
 or (after_graph#>>'{archive_revision,updated_at}')::timestamptz is distinct from transaction_timestamp()
 or (after_graph#>>'{classroom,blueprint_source_revision}')::bigint<>(before_graph#>>'{classroom,blueprint_source_revision}')::bigint+1
 or ((after_graph->'classroom')-array['blueprint_source_revision','updated_at']) is distinct from ((before_graph->'classroom')-array['blueprint_source_revision','updated_at'])
 or (after_graph#>>'{classroom,updated_at}')::timestamptz is distinct from transaction_timestamp()
 or ((after_graph->'test')-array['status','updated_at']) is distinct from ((before_graph->'test')-array['status','updated_at'])
 or ((after_graph->'draft')-array['content','version','updated_by','updated_at']) is distinct from ((before_graph->'draft')-array['content','version','updated_by','updated_at'])
 then raise exception 'Contextual canonical content or protected graph differs';end if;
 before_graph:=after_graph;
 result:=public.test_owner_workflow_v1(owner_id,tid,cid,'unpublish','{}',before_graph->'test',clock_timestamp()+interval '25 seconds');
 if pg_temp.test_unpublication_graph(tid) is distinct from before_graph or result#>>'{result,draft_version}'<>'9' then raise exception 'Draft replay changed full graph';end if;
 for foreign_id in select x from unnest(array[member_id,'a2610000-0000-4000-8000-000000000002'::uuid]) x loop
 begin perform public.test_owner_workflow_v1(foreign_id,tid,cid,'unpublish','{}',before_graph->'test',clock_timestamp()+interval '25 seconds');
 raise exception 'Non-owner accepted';exception when sqlstate 'PT403' then null;end;end loop;
 update public.classrooms set teacher_id=member_id where id=cid;
 begin perform public.test_owner_workflow_v1(owner_id,tid,cid,'unpublish','{}',before_graph->'test',clock_timestamp()+interval '25 seconds');
 raise exception 'Former owner accepted';exception when sqlstate 'PT403' then null;end;
 update public.classrooms set teacher_id=owner_id where id=cid;
 -- A draft no-op at INT_MAX skips closed-only validation and writes.
 update public.assessment_drafts set version=2147483647 where assessment_id=tid and assessment_type='test';
 before_graph:=pg_temp.test_unpublication_graph(tid);
 result:=public.test_owner_workflow_v1(owner_id,tid,cid,'unpublish','{}',before_graph->'test',clock_timestamp()+interval '25 seconds');
 if result#>>'{result,draft_version}'<>'2147483647' or pg_temp.test_unpublication_graph(tid) is distinct from before_graph then raise exception 'INT_MAX draft no-op differs';end if;
 update public.tests set status='closed' where id=tid;
 before_graph:=pg_temp.test_unpublication_graph(tid);
 begin perform public.return_test_to_draft_atomic(owner_id,tid);raise exception 'Legacy student owner accepted';exception when sqlstate 'PT403' then null;end;
 begin perform public.test_owner_workflow_v1(owner_id,tid,cid,'unpublish','{}',before_graph->'test',clock_timestamp()+interval '25 seconds');raise exception 'Closed INT_MAX accepted';exception when sqlstate 'PT409' then null;end;
 if pg_temp.test_unpublication_graph(tid) is distinct from before_graph then raise exception 'Role/version denial changed graph';end if;
end;$contextual261$;

-- owner-unpublication-contracts-end
rollback;
