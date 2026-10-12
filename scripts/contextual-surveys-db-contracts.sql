-- Source-only contract. Root executes only in its separately authorized
-- disposable cumulative-schema harness. Never a shared local/prod migration.
begin;
set local statement_timeout = '35s';
set local lock_timeout = '1s';

do $contract$
declare
  v_owner uuid:=gen_random_uuid(); v_member uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid();
  v_classroom uuid:=gen_random_uuid(); v_foreign_classroom uuid:=gen_random_uuid();
  v_survey uuid; v_foreign_survey uuid; v_question uuid; v_choice uuid; v_link uuid;
  v_payload jsonb; v_questions jsonb; v_answers jsonb; v_first_submitted timestamptz;
  v_archive bigint; v_blueprint bigint; v_function regprocedure;
  v_purge uuid:=gen_random_uuid();
begin
  -- Verify actual catalog ACLs, not migration text.
  foreach v_function in array array[
    'public.get_survey_for_owner_v1(uuid,uuid)'::regprocedure,
    'public.get_survey_for_member_v1(uuid,uuid)'::regprocedure,
    'public.get_surveys_for_owner_v1(uuid,uuid)'::regprocedure,
    'public.get_surveys_for_member_v1(uuid,uuid)'::regprocedure,
    'public.get_survey_results_for_owner_v1(uuid,uuid)'::regprocedure,
    'public.get_survey_results_for_member_v1(uuid,uuid)'::regprocedure,
    'public.update_survey_for_owner_v1(uuid,uuid,jsonb)'::regprocedure,
    'public.delete_survey_for_owner_v1(uuid,uuid)'::regprocedure,
    'public.create_survey_question_for_owner_v1(uuid,uuid,jsonb)'::regprocedure,
    'public.update_survey_question_for_owner_v1(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure,
    'public.delete_survey_question_for_owner_v1(uuid,uuid,uuid)'::regprocedure,
    'public.respond_to_survey_for_member_v1(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure
  ] loop
    assert has_function_privilege('service_role',v_function,'EXECUTE');
    assert not has_function_privilege('anon',v_function,'EXECUTE');
    assert not has_function_privilege('authenticated',v_function,'EXECUTE');
    assert (select prosecdef from pg_proc where oid=v_function);
    assert (select proconfig @> array['search_path=""'] from pg_proc where oid=v_function);
  end loop;
  assert not has_function_privilege('service_role','private.lock_survey_context_v1(uuid,uuid,uuid,boolean,boolean)','EXECUTE');

  insert into public.users(id,email,role) values
    (v_owner,v_owner::text||'@survey.invalid','student'),
    (v_member,v_member::text||'@survey.invalid','teacher'),
    (v_other,v_other::text||'@survey.invalid','student');
  perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),v_owner,'classrooms.create','manual',true,
    clock_timestamp(),null,10,'test:263','survey_contract',0);
  insert into public.classrooms(id,teacher_id,title,class_code) values
    (v_classroom,v_owner,'Survey source contract',upper(substr(replace(v_classroom::text,'-',''),1,8))),
    (v_foreign_classroom,v_owner,'Survey other Classroom',upper(substr(replace(v_foreign_classroom::text,'-',''),1,8)));
  insert into public.classroom_enrollments(classroom_id,student_id) values(v_classroom,v_member),(v_classroom,v_owner);
  execute 'set local role service_role';
  v_survey:=(public.create_survey_for_owner_v1(v_owner,v_classroom,'Feedback',true,false)->'survey'->>'id')::uuid;
  v_foreign_survey:=(public.create_survey_for_owner_v1(v_owner,v_foreign_classroom,'Other',true,false)->'survey'->>'id')::uuid;

  -- Either role works; owner authority is Classroom, not creator/global role.
  assert public.get_surveys_for_owner_v1(v_owner,v_classroom)->'surveys'->0->'stats'->>'total_students'='1';
  assert jsonb_array_length(public.get_surveys_for_member_v1(v_member,v_classroom)->'surveys')=0;
  begin perform public.get_survey_for_member_v1(v_owner,v_survey); raise exception 'owner precedence failed'; exception when sqlstate 'PT403' then null; end;
  begin perform public.get_survey_for_member_v1(v_other,v_survey); raise exception 'nonmember failed'; exception when sqlstate 'PT403' then null; end;
  begin perform public.get_survey_for_member_v1(v_member,v_survey); raise exception 'draft disclosure failed'; exception when sqlstate 'PT404' then null; end;
  begin perform public.update_survey_for_owner_v1(v_owner,v_survey,'{"status":"active"}'); raise exception 'empty publication failed'; exception when sqlstate 'PT400' then null; end;

  v_question:=(public.create_survey_question_for_owner_v1(v_owner,v_survey,'{"question_type":"short_text","question_text":"Thoughts?","options":[],"response_max_chars":4}'::jsonb)->'question'->>'id')::uuid;
  v_choice:=(public.create_survey_question_for_owner_v1(v_owner,v_survey,'{"question_type":"multiple_choice","question_text":"Pick","options":["A","B"],"response_max_chars":500}'::jsonb)->'question'->>'id')::uuid;
  v_link:=(public.create_survey_question_for_owner_v1(v_owner,v_survey,'{"question_type":"link","question_text":"Share","options":[],"response_max_chars":2048}'::jsonb)->'question'->>'id')::uuid;
  perform public.update_survey_for_owner_v1(v_owner,v_survey,jsonb_build_object('status','active','opens_at',clock_timestamp()+interval '1 hour'));
  begin perform public.get_survey_for_member_v1(v_member,v_survey); raise exception 'future disclosure failed'; exception when sqlstate 'PT404' then null; end;
  perform public.update_survey_for_owner_v1(v_owner,v_survey,'{"status":"draft"}');
  perform public.update_survey_for_owner_v1(v_owner,v_survey,'{"status":"active"}');
  begin perform public.update_survey_for_owner_v1(v_owner,v_survey,'{"status":"draft"}'); raise exception 'opened rollback failed'; exception when sqlstate 'PT400' then null; end;

  -- Results before answering are retained; own response snapshot starts empty.
  v_payload:=public.get_survey_for_member_v1(v_member,v_survey);
  v_questions:=v_payload->'questions';
  assert jsonb_array_length(v_payload->'responses')=0;
  assert jsonb_array_length(public.get_survey_results_for_member_v1(v_member,v_survey)->'results')=3;
  v_answers:=jsonb_build_object(v_question::text,jsonb_build_object('question_type','short_text','response_text','😀😀'),
    v_choice::text,jsonb_build_object('question_type','multiple_choice','selected_option',1),
    v_link::text,jsonb_build_object('question_type','link','response_text','https://example.invalid/'));
  begin perform public.respond_to_survey_for_member_v1(v_member,v_survey,v_foreign_classroom,v_questions,v_answers); raise exception 'parent substitution failed'; exception when sqlstate 'PT409' then null; end;
  begin perform public.respond_to_survey_for_member_v1(v_member,v_survey,v_classroom,v_questions,v_answers-v_choice::text); raise exception 'partial response failed'; exception when sqlstate 'PT400' then null; end;
  assert public.respond_to_survey_for_member_v1(v_member,v_survey,v_classroom,v_questions,v_answers)='{"success":true,"updated":false}'::jsonb;
  select submitted_at into v_first_submitted from public.survey_responses where question_id=v_question and student_id=v_member;
  begin perform public.respond_to_survey_for_member_v1(v_member,v_survey,v_classroom,v_questions,v_answers); raise exception 'static duplicate failed'; exception when sqlstate 'PT400' then null; end;
  perform public.update_survey_for_owner_v1(v_owner,v_survey,'{"dynamic_responses":true}');
  assert public.respond_to_survey_for_member_v1(v_member,v_survey,v_classroom,v_questions,v_answers)->>'updated'='true';
  assert (select submitted_at=v_first_submitted from public.survey_responses where question_id=v_question and student_id=v_member);
  begin
    perform public.respond_to_survey_for_member_v1(v_member,v_survey,v_classroom,v_questions,
      jsonb_set(v_answers,array[v_question::text,'response_text'],'"😀😀a"'));
    raise exception 'UTF16 overflow failed';
  exception when sqlstate 'PT400' then null; end;
  assert (select response_text='😀😀' from public.survey_responses where question_id=v_question and student_id=v_member);

  -- Authoring after opening is preserved. Stale expected questions fail atomically.
  v_payload:=public.get_survey_for_owner_v1(v_owner,v_survey);
  perform public.update_survey_question_for_owner_v1(v_owner,v_survey,v_question,
    (select value from jsonb_array_elements(v_payload->'questions') where value->>'id'=v_question::text),
    '{"question_type":"short_text","question_text":"Changed?","options":[],"response_max_chars":4,"position":0}');
  begin perform public.respond_to_survey_for_member_v1(v_member,v_survey,v_classroom,v_questions,v_answers); raise exception 'stale question snapshot failed'; exception when sqlstate 'PT409' then null; end;
  begin perform public.delete_survey_question_for_owner_v1(v_owner,v_foreign_survey,v_question); raise exception 'child substitution failed'; exception when sqlstate 'PT404' then null; end;
  v_payload:=public.get_survey_results_for_member_v1(v_member,v_survey);
  assert not jsonb_path_exists(v_payload,'$.results[*].responses[*].student_id');
  assert not jsonb_path_exists(v_payload,'$.results[*].responses[*].email');
  assert not jsonb_path_exists(v_payload,'$.results[*].responses[*].name');
  assert public.get_survey_results_for_owner_v1(v_owner,v_survey)->'stats'->>'responded'='1';
  -- Existing committed purge fences deny reads even if the enrollment row
  -- remains. Merely acquiring the subject advisory lock is insufficient.
  execute 'reset role';
  insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_binding_sha256,request_sha256,source_revision)
    values(v_purge,v_owner,v_classroom,v_member,repeat('a',64),repeat('b',64),1);
  insert into public.student_purge_fences(classroom_id,student_id,operation_id,teacher_id)
    values(v_classroom,v_member,v_purge,v_owner);
  execute 'set local role service_role';
  begin perform public.get_survey_for_member_v1(v_member,v_survey); raise exception 'purge member read failed'; exception when sqlstate 'PT409' then null; end;
  begin perform public.get_survey_results_for_member_v1(v_member,v_survey); raise exception 'purge member results failed'; exception when sqlstate 'PT409' then null; end;
  begin perform public.get_survey_results_for_owner_v1(v_owner,v_survey); raise exception 'purge owner aggregate failed'; exception when sqlstate 'PT409' then null; end;
  execute 'reset role';
  delete from public.student_purge_fences where operation_id=v_purge;
  delete from public.student_purge_operations where id=v_purge;
  execute 'set local role service_role';
  perform public.update_survey_for_owner_v1(v_owner,v_survey,'{"status":"closed","show_results":false}');
  assert jsonb_array_length(public.get_survey_for_member_v1(v_member,v_survey)->'responses')=3;
  begin perform public.get_survey_results_for_member_v1(v_member,v_survey); raise exception 'hidden results failed'; exception when sqlstate 'PT403' then null; end;
  begin perform public.respond_to_survey_for_member_v1(v_member,v_survey,v_classroom,v_questions,v_answers); raise exception 'closed response failed'; exception when sqlstate 'PT400' then null; end;

  execute 'reset role';
  delete from public.classroom_enrollments where classroom_id=v_classroom and student_id=v_member;
  execute 'set local role service_role';
  assert public.get_survey_results_for_owner_v1(v_owner,v_survey)->'stats'->>'responded'='0';
  begin perform public.get_survey_for_member_v1(v_member,v_survey); raise exception 'revoked disclosure failed'; exception when sqlstate 'PT403' then null; end;
  execute 'reset role';
  update public.classrooms set archived_at=clock_timestamp() where id=v_classroom;
  execute 'set local role service_role';
  assert public.get_survey_for_owner_v1(v_owner,v_survey)->'survey'->>'id'=v_survey::text;
  begin perform public.delete_survey_for_owner_v1(v_owner,v_survey); raise exception 'archive write failed'; exception when sqlstate 'PT403' then null; end;
  execute 'reset role';
  update public.classrooms set archived_at=null where id=v_classroom;
  select revision into v_archive from public.classroom_archive_revisions where classroom_id=v_classroom;
  select blueprint_source_revision into v_blueprint from public.classrooms where id=v_classroom;
  execute 'set local role service_role';
  assert public.delete_survey_for_owner_v1(v_owner,v_survey)='{"success":true}'::jsonb;
  assert not exists(select 1 from public.survey_questions where survey_id=v_survey);
  assert not exists(select 1 from public.survey_responses where survey_id=v_survey);
  assert exists(select 1 from public.surveys where id=v_foreign_survey);
  assert (select revision>v_archive from public.classroom_archive_revisions where classroom_id=v_classroom);
  assert (select blueprint_source_revision>v_blueprint from public.classrooms where id=v_classroom);
end;
$contract$;
rollback;
