-- Source-only contract. Root executes only in its separately authorized
-- disposable cumulative-schema harness. Never a shared local/prod migration.
begin;
set local statement_timeout = '35s';
set local lock_timeout = '1s';

-- Internal equality carrier only: complete rows of the affected Classroom,
-- including all revision/default/membership fields. No large JSON leaves SQL.
create function pg_temp.survey_payload_state(p_classroom uuid)
returns text language sql volatile set search_path = '' as $payload_state$
  select encode(sha256(convert_to(jsonb_build_object(
    'classrooms',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.classrooms r where r.id=p_classroom),
    'revisions',(select coalesce(jsonb_agg(to_jsonb(r) order by r.classroom_id),'[]'::jsonb) from public.classroom_archive_revisions r where r.classroom_id=p_classroom),
    'enrollments',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.classroom_enrollments r where r.classroom_id=p_classroom),
    'generations',(select coalesce(jsonb_agg(to_jsonb(r) order by r.generation_id),'[]'::jsonb) from private.pal_membership_generations r
      where r.generation_id in (select id from public.classroom_enrollments where classroom_id=p_classroom)),
    'categories',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.gradebook_categories r where r.classroom_id=p_classroom),
    'surveys',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.surveys r where r.classroom_id=p_classroom),
    'questions',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.survey_questions r
      where r.survey_id in (select id from public.surveys where classroom_id=p_classroom)),
    'responses',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.survey_responses r
      where r.survey_id in (select id from public.surveys where classroom_id=p_classroom))
  )::text,'UTF8')),'hex')
$payload_state$;
revoke all on function pg_temp.survey_payload_state(uuid) from public,anon,authenticated,service_role;
create temporary table survey_payload_receipts(label text primary key,measured_bytes integer not null,measured_count integer,expected_code text,verified boolean not null) on commit drop;

do $contract$
declare
  v_owner uuid:=gen_random_uuid(); v_member uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid();
  v_classroom uuid:=gen_random_uuid(); v_foreign_classroom uuid:=gen_random_uuid();
  v_survey uuid; v_foreign_survey uuid; v_question uuid; v_choice uuid; v_link uuid;
  v_payload jsonb; v_questions jsonb; v_answers jsonb; v_first_submitted timestamptz;
  v_archive bigint; v_blueprint bigint; v_function regprocedure;
  v_purge uuid:=gen_random_uuid();
  v_link_cap integer; v_raw_metadata jsonb;
  v_boundary_question uuid; v_case text; v_delta integer; v_limit integer; v_measured integer; v_base integer;
  v_code text; v_message text; v_expected_code text; v_expected_message text; v_verified boolean;
  v_before text; v_call_before text; v_probe jsonb; v_result jsonb; v_question_patch jsonb;
  v_fixture_before text; v_fixture_verified boolean; v_saved_receipts jsonb; v_count integer; v_last_question uuid;
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
    v_link::text,jsonb_build_object('question_type','link','response_text','https://example.invalid/','raw_utf16_length',24));
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

  -- Canonical JS validates trimmed raw UTF16 before URL serialization: raw
  -- https://a.co (12) becomes 13; https://example.com/é (21) becomes 26.
  -- Service-only length evidence is question-bound and never stored/returned.
  foreach v_link_cap in array array[12,21] loop
    v_payload:=public.get_survey_for_owner_v1(v_owner,v_survey);
    perform public.update_survey_question_for_owner_v1(v_owner,v_survey,v_link,
      (select value from jsonb_array_elements(v_payload->'questions') where value->>'id'=v_link::text),
      jsonb_build_object('question_type','link','question_text','Share','options','[]'::jsonb,'response_max_chars',v_link_cap));
    v_questions:=public.get_survey_for_member_v1(v_member,v_survey)->'questions';
    v_answers:=jsonb_set(v_answers,array[v_link::text],jsonb_build_object('question_type','link',
      'response_text',case when v_link_cap=12 then 'https://a.co/' else 'https://example.com/%C3%A9' end,
      'raw_utf16_length',v_link_cap));
    assert public.respond_to_survey_for_member_v1(v_member,v_survey,v_classroom,v_questions,v_answers)->>'updated'='true';
    assert (select response_text=v_answers->v_link::text->>'response_text'
      and not (to_jsonb(response)?'raw_utf16_length') from public.survey_responses response where question_id=v_link and student_id=v_member);
    assert not jsonb_path_exists(public.get_survey_for_member_v1(v_member,v_survey),'$.responses[*].raw_utf16_length');
    begin
      perform public.respond_to_survey_for_member_v1(v_member,v_survey,v_classroom,v_questions,
        jsonb_set(v_answers,array[v_link::text],(v_answers->v_link::text)-'raw_utf16_length'));
      raise exception 'missing raw link evidence failed';
    exception when sqlstate 'PT400' then null; end;
    for v_raw_metadata in select value from jsonb_array_elements(jsonb_build_array(null,'12',true,0,-1,v_link_cap+1,v_link_cap+0.5)) loop
      begin
        perform public.respond_to_survey_for_member_v1(v_member,v_survey,v_classroom,v_questions,
          jsonb_set(v_answers,array[v_link::text,'raw_utf16_length'],v_raw_metadata));
        raise exception 'invalid or over-cap raw link evidence failed';
      exception when sqlstate 'PT400' then null; end;
    end loop;
    assert (select response_text=v_answers->v_link::text->>'response_text' from public.survey_responses where question_id=v_link and student_id=v_member);
  end loop;

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
  insert into public.classroom_enrollments(classroom_id,student_id) values(v_classroom,v_other);
  execute 'set local role service_role';
  v_payload:=public.get_survey_results_for_member_v1(v_other,v_survey);
  assert v_payload->'results'->0->'total_responses'='1';
  assert v_payload->'results'->0->'responses'->0->>'response_text'='😀😀';
  execute 'reset role';
  insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_binding_sha256,request_sha256,source_revision)
    values(v_purge,v_owner,v_classroom,v_member,repeat('a',64),repeat('b',64),1);
  insert into public.student_purge_fences(classroom_id,student_id,operation_id,teacher_id)
    values(v_classroom,v_member,v_purge,v_owner);
  execute 'set local role service_role';
  begin perform public.get_survey_for_member_v1(v_member,v_survey); raise exception 'purge member read failed'; exception when sqlstate 'PT409' then null; end;
  begin perform public.get_survey_results_for_member_v1(v_member,v_survey); raise exception 'purge member results failed'; exception when sqlstate 'PT409' then null; end;
  begin perform public.get_survey_results_for_member_v1(v_other,v_survey); raise exception 'purge classmate response disclosure failed'; exception when sqlstate 'PT409' then null; end;
  begin perform public.get_survey_results_for_owner_v1(v_owner,v_survey); raise exception 'purge owner aggregate failed'; exception when sqlstate 'PT409' then null; end;
  execute 'reset role';
  delete from public.student_purge_fences where operation_id=v_purge;
  delete from public.student_purge_operations where id=v_purge;
  execute 'set local role service_role';
  v_payload:=public.get_survey_results_for_member_v1(v_other,v_survey);
  assert v_payload->'results'->0->'total_responses'='1';
  assert v_payload->'results'->0->'responses'->0->>'response_text'='😀😀';
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

  -- Payload subset, folded into this SAME rollback dispatch. All later large
  -- fixtures have fixed literal row bounds; source tests are preparation only.
  -- The unchanged 35s whole-statement and 8s RPC limits still require native proof.
  execute 'reset role';
  insert into public.classroom_enrollments(classroom_id,student_id) values(v_foreign_classroom,v_other);
  execute 'set local role service_role';
  v_boundary_question:=(public.create_survey_question_for_owner_v1(v_owner,v_foreign_survey,
    '{"question_type":"short_text","question_text":"Boundary?","options":[],"response_max_chars":4}'::jsonb)->'question'->>'id')::uuid;
  perform public.update_survey_for_owner_v1(v_owner,v_foreign_survey,'{"status":"active"}');
  execute 'reset role';
  v_question_patch:='{"question_type":"short_text","question_text":"Changed boundary?","options":[],"response_max_chars":4}'::jsonb;
  foreach v_case in array array['owner-patch','question-create','question-update','expected-question','expected-questions','detail-owner','detail-member'] loop
    v_limit:=case when v_case in ('owner-patch','question-create','question-update') then 4194304 else 8388608 end;
    for v_delta in 0..2 loop
      -- Shape checks are input-only; reads have no JSON input shape to corrupt.
      continue when v_delta=2 and v_case in ('detail-owner','detail-member');
      v_expected_code:=case when v_delta=0 then null when v_case in ('expected-question','expected-questions') then 'PT409'
        when v_case in ('detail-owner','detail-member') then 'PT503' else 'PT400' end;
      v_expected_message:=case when v_case='owner-patch' then 'survey_invalid_patch'
        when v_case in ('question-create','question-update') then 'survey_invalid_question'
        when v_case='expected-question' then 'survey_question_changed'
        when v_case='expected-questions' then 'survey_questions_changed' else 'survey_payload_limit' end;
      v_before:=pg_temp.survey_payload_state(v_foreign_classroom);v_verified:=false;v_measured:=0;
      begin
        if v_case='owner-patch' then
          if v_delta=2 then v_probe:='{"unknown":true}'::jsonb;
          else
            v_probe:=jsonb_build_object('title','');
            v_probe:=jsonb_build_object('title',repeat('x',v_limit+v_delta-octet_length(v_probe::text)));
          end if;
          v_measured:=octet_length(v_probe::text);
        elsif v_case in ('question-create','question-update') then
          if v_delta=2 then v_probe:=jsonb_set(v_question_patch,'{options}','{}'::jsonb);
          else
            v_probe:=jsonb_set(v_question_patch,'{question_text}','""'::jsonb);
            v_probe:=jsonb_set(v_probe,'{question_text}',to_jsonb(repeat('x',v_limit+v_delta-octet_length(v_probe::text))));
          end if;
          v_measured:=octet_length(v_probe::text);
        elsif v_case in ('expected-question','expected-questions') then
          -- Table-valid legacy snapshot fixture, NOT an authoring-input claim:
          -- one stored question may exceed the 4MiB authoring JSON budget.
          if v_delta=2 then v_probe:='{}'::jsonb;
          else
            update public.survey_questions set question_text='' where id=v_boundary_question;
            if v_case='expected-question' then
              select to_jsonb(r) into v_probe from public.survey_questions r where id=v_boundary_question;
            else
              select jsonb_agg(to_jsonb(r) order by position,id) into v_probe from public.survey_questions r where survey_id=v_foreign_survey;
            end if;
            v_base:=octet_length(v_probe::text);
            update public.survey_questions set question_text=repeat('x',v_limit+v_delta-v_base) where id=v_boundary_question;
            if v_case='expected-question' then
              select to_jsonb(r) into v_probe from public.survey_questions r where id=v_boundary_question;
            else
              select jsonb_agg(to_jsonb(r) order by position,id) into v_probe from public.survey_questions r where survey_id=v_foreign_survey;
            end if;
          end if;
          v_measured:=octet_length(v_probe::text);
        else
          -- Measure the EXACT detail guard's three-term sum, not JSON wire or
          -- wrapper bytes. The stored title is table-valid legacy fixture data.
          update public.surveys set title='' where id=v_foreign_survey;
          select octet_length(coalesce(jsonb_agg(to_jsonb(r) order by position,id),'[]'::jsonb)::text)
            into v_base from public.survey_questions r where survey_id=v_foreign_survey;
          select v_base+octet_length('[]'::jsonb::text)+octet_length(to_jsonb(r)::text)
            into v_base from public.surveys r where id=v_foreign_survey;
          update public.surveys set title=repeat('x',v_limit+v_delta-v_base) where id=v_foreign_survey;
          select octet_length(coalesce(jsonb_agg(to_jsonb(r) order by position,id),'[]'::jsonb)::text)
            into v_measured from public.survey_questions r where survey_id=v_foreign_survey;
          select v_measured+octet_length('[]'::jsonb::text)+octet_length(to_jsonb(r)::text)
            into v_measured from public.surveys r where id=v_foreign_survey;
        end if;
        if v_delta<2 then assert v_measured=v_limit+v_delta,'Exact SQL payload measurement differs';end if;
        v_call_before:=pg_temp.survey_payload_state(v_foreign_classroom);
        v_code:=null;v_message:=null;
        begin
          execute 'set local role service_role';
          case v_case
            when 'owner-patch' then v_result:=public.update_survey_for_owner_v1(v_owner,v_foreign_survey,v_probe);
            when 'question-create' then v_result:=public.create_survey_question_for_owner_v1(v_owner,v_foreign_survey,v_probe);
            when 'question-update' then
              select to_jsonb(r) into v_payload from public.survey_questions r where id=v_boundary_question;
              v_result:=public.update_survey_question_for_owner_v1(v_owner,v_foreign_survey,v_boundary_question,v_payload,v_probe);
            when 'expected-question' then
              v_result:=public.update_survey_question_for_owner_v1(v_owner,v_foreign_survey,v_boundary_question,v_probe,v_question_patch);
            when 'expected-questions' then
              v_result:=public.respond_to_survey_for_member_v1(v_other,v_foreign_survey,v_foreign_classroom,v_probe,
                jsonb_build_object(v_boundary_question::text,jsonb_build_object('question_type','short_text','response_text','good')));
            when 'detail-owner' then v_result:=public.get_survey_for_owner_v1(v_owner,v_foreign_survey);
            when 'detail-member' then v_result:=public.get_survey_for_member_v1(v_other,v_foreign_survey);
          end case;
        exception when others then get stacked diagnostics v_code=returned_sqlstate,v_message=message_text;end;
        execute 'reset role';
        if v_expected_code is null then
          assert v_code is null,'Exact positive SQL boundary was rejected';
          if v_case='owner-patch' then
            assert v_result->'survey'->'title'=v_probe->'title';
            assert (select title=v_probe->>'title' from public.surveys where id=v_foreign_survey);
          elsif v_case in ('question-create','question-update') then
            assert v_result->'question'->'question_text'=v_probe->'question_text';
            assert exists(select 1 from public.survey_questions where id=(v_result->'question'->>'id')::uuid and question_text=v_probe->>'question_text');
          elsif v_case='expected-question' then
            assert v_result->'question'->>'question_text'='Changed boundary?';
            assert (select question_text='Changed boundary?' from public.survey_questions where id=v_boundary_question);
          elsif v_case='expected-questions' then
            assert v_result='{"success":true,"updated":false}'::jsonb;
            assert (select count(*)=1 and min(response_text)='good' from public.survey_responses where survey_id=v_foreign_survey and student_id=v_other);
          else
            assert v_result->'survey'->>'id'=v_foreign_survey::text;
            assert jsonb_array_length(v_result->'questions')=1 and v_result->'responses'='[]'::jsonb;
            assert pg_temp.survey_payload_state(v_foreign_classroom)=v_call_before,'Boundary read changed data/revisions';
          end if;
        else
          assert v_code=v_expected_code and v_message=v_expected_message,'Exact payload denial differs';
          assert pg_temp.survey_payload_state(v_foreign_classroom)=v_call_before,'Denied payload changed data/revisions';
        end if;
        v_verified:=true;
        -- Success and denial fixture changes BOTH roll back. Only this private
        -- sentinel is caught here; assertions and unexpected RPC errors escape.
        raise exception using errcode='ZP001',message='survey_payload_case_rollback';
      exception when sqlstate 'ZP001' then null;end;
      assert v_verified,'Payload case did not reach its independent assertions';
      assert pg_temp.survey_payload_state(v_foreign_classroom)=v_before,'Payload subtransaction restoration differs';
      insert into survey_payload_receipts values(v_case||case v_delta when 0 then ':exact' when 1 then ':plus-one' else ':shape' end,v_measured,null,v_expected_code,true);
      v_result:=null;v_probe:=null;v_payload:=null;
    end loop;
  end loop;

  -- Read-byte pairs reuse the original RPC's small, exact projection. Padding
  -- only the stored title changes exactly one string in each guard expression.
  foreach v_case in array array['list-owner','list-member','results-owner','results-member'] loop
    for v_delta in 0..1 loop
      v_before:=pg_temp.survey_payload_state(v_foreign_classroom);v_verified:=false;
      v_expected_code:=case when v_delta=0 then null else 'PT503' end;
      begin
        update public.surveys set title='' where id=v_foreign_survey;
        execute 'set local role service_role';
        case v_case
          when 'list-owner' then v_probe:=public.get_surveys_for_owner_v1(v_owner,v_foreign_classroom);
          when 'list-member' then v_probe:=public.get_surveys_for_member_v1(v_other,v_foreign_classroom);
          when 'results-owner' then v_probe:=public.get_survey_results_for_owner_v1(v_owner,v_foreign_survey);
          when 'results-member' then v_probe:=public.get_survey_results_for_member_v1(v_other,v_foreign_survey);
        end case;
        execute 'reset role';
        if v_case in ('list-owner','list-member') then
          v_base:=octet_length((v_probe->'surveys')::text);
          v_probe:=jsonb_set(v_probe,'{surveys,0,title}',to_jsonb(repeat('x',8388608+v_delta-v_base)));
          v_measured:=octet_length((v_probe->'surveys')::text);
        else
          v_base:=octet_length(v_probe::text);
          v_probe:=jsonb_set(v_probe,'{survey,title}',to_jsonb(repeat('x',8388608+v_delta-v_base)));
          v_measured:=octet_length(v_probe::text);
        end if;
        update public.surveys set title=repeat('x',8388608+v_delta-v_base) where id=v_foreign_survey;
        assert v_measured=8388608+v_delta,'Exact read payload measurement differs';
        v_call_before:=pg_temp.survey_payload_state(v_foreign_classroom);v_code:=null;v_message:=null;
        begin
          execute 'set local role service_role';
          case v_case
            when 'list-owner' then v_result:=public.get_surveys_for_owner_v1(v_owner,v_foreign_classroom);
            when 'list-member' then v_result:=public.get_surveys_for_member_v1(v_other,v_foreign_classroom);
            when 'results-owner' then v_result:=public.get_survey_results_for_owner_v1(v_owner,v_foreign_survey);
            when 'results-member' then v_result:=public.get_survey_results_for_member_v1(v_other,v_foreign_survey);
          end case;
        exception when others then get stacked diagnostics v_code=returned_sqlstate,v_message=message_text;end;
        execute 'reset role';
        if v_delta=0 then
          assert v_code is null,'Exact read byte boundary was rejected';
          assert v_result=v_probe,'Exact read payload projection differs';
        else
          assert v_code='PT503' and v_message='survey_payload_limit','Read byte denial differs';
        end if;
        assert pg_temp.survey_payload_state(v_foreign_classroom)=v_call_before,'Read byte case changed data/revisions';
        v_verified:=true;
        raise exception using errcode='ZP001',message='survey_payload_case_rollback';
      exception when sqlstate 'ZP001' then null;end;
      assert v_verified and pg_temp.survey_payload_state(v_foreign_classroom)=v_before,'Read byte restoration differs';
      insert into survey_payload_receipts values(v_case||case v_delta when 0 then ':exact' else ':plus-one' end,v_measured,null,v_expected_code,true);
      v_probe:=null;v_result:=null;
    end loop;
  end loop;

  -- One shared 1700-question fixture for a valid 8MiB response vector. Each
  -- ASCII answer has 1..5000 UTF16 units; no oversized single-answer shortcut.
  assert (select count(*)=1 from public.surveys where classroom_id=v_foreign_classroom);
  assert (select count(*)=1 from public.survey_questions where survey_id=v_foreign_survey);
  assert not exists(select 1 from public.survey_responses where survey_id=v_foreign_survey);
  v_fixture_before:=pg_temp.survey_payload_state(v_foreign_classroom);
  v_fixture_verified:=false;v_saved_receipts:='[]'::jsonb;
  begin
    update public.survey_questions set response_max_chars=5000 where id=v_boundary_question;
    insert into public.survey_questions(survey_id,question_type,question_text,options,response_max_chars,position)
      select v_foreign_survey,'short_text','Q','[]'::jsonb,5000,n from generate_series(1,1699) n;
    select jsonb_agg(to_jsonb(r) order by position,id) into v_questions from public.survey_questions r where survey_id=v_foreign_survey;
    assert jsonb_array_length(v_questions)=1700 and octet_length(v_questions::text)<8388608;
    select jsonb_object_agg(id::text,jsonb_build_object('question_type','short_text','response_text','x'))
      into v_answers from public.survey_questions where survey_id=v_foreign_survey;
    v_base:=octet_length(v_answers::text);
    for v_delta in 0..2 loop
      v_before:=pg_temp.survey_payload_state(v_foreign_classroom);v_verified:=false;
      v_expected_code:=case when v_delta=0 then null else 'PT400' end;
      begin
        if v_delta=2 then v_probe:='[]'::jsonb;
        else
          select jsonb_object_agg(id::text,jsonb_build_object('question_type','short_text','response_text',
            repeat('x',1+least(4999,greatest(0,8388608+v_delta-v_base-(n-1)*4999))::integer))) into v_probe
            from (select id,row_number() over(order by position,id) n from public.survey_questions where survey_id=v_foreign_survey) fixed_rows;
          v_measured:=octet_length(v_probe::text);
          assert v_measured=8388608+v_delta,'Exact response-vector measurement differs';
          assert not exists(select 1 from jsonb_each(v_probe) where length(value->>'response_text') not between 1 and 5000);
        end if;
        v_measured:=octet_length(v_probe::text);v_call_before:=pg_temp.survey_payload_state(v_foreign_classroom);v_code:=null;v_message:=null;
        begin
          execute 'set local role service_role';
          v_result:=public.respond_to_survey_for_member_v1(v_other,v_foreign_survey,v_foreign_classroom,v_questions,v_probe);
        exception when others then get stacked diagnostics v_code=returned_sqlstate,v_message=message_text;end;
        execute 'reset role';
        if v_delta=0 then
          assert v_code is null,'Exact response-vector boundary was rejected';
          assert v_result='{"success":true,"updated":false}'::jsonb;
          assert (select count(*)=1700 and bool_and(to_jsonb(r.response_text)=v_probe->r.question_id::text->'response_text')
            from public.survey_responses r where survey_id=v_foreign_survey and student_id=v_other),'Response-vector stored rows differ';
        else
          assert v_code='PT400' and v_message='survey_invalid_responses','Response-vector denial differs';
          assert pg_temp.survey_payload_state(v_foreign_classroom)=v_call_before,'Response-vector denial changed data/revisions';
        end if;
        v_verified:=true;
        raise exception using errcode='ZP001',message='survey_payload_case_rollback';
      exception when sqlstate 'ZP001' then null;end;
      assert v_verified and pg_temp.survey_payload_state(v_foreign_classroom)=v_before,'Response-vector subtransaction restoration differs';
      v_saved_receipts:=v_saved_receipts||jsonb_build_array(jsonb_build_array('response-vector'||case v_delta when 0 then ':exact' when 1 then ':plus-one' else ':shape' end,v_measured,null,v_expected_code,true));
      v_probe:=null;v_result:=null;
    end loop;
    v_fixture_verified:=true;
    raise exception using errcode='ZP002',message='survey_payload_fixture_rollback';
  exception when sqlstate 'ZP002' then null;end;
  assert v_fixture_verified and pg_temp.survey_payload_state(v_foreign_classroom)=v_fixture_before,'Response-vector fixture restoration differs';
  insert into survey_payload_receipts select value->>0,(value->>1)::integer,(value->>2)::integer,value->>3,(value->>4)::boolean from jsonb_array_elements(v_saved_receipts);
  v_answers:=null;v_questions:=null;

  -- Shared literal-bounded count fixture: 10001 Surveys, 10001 questions and
  -- 10001 consistent answers. The member response count is joint with the question count:
  -- unique(question_id,student_id) prevents an independent valid +1 answer.
  -- No triggers, constraints, ACLs or original function bodies are changed.
  v_fixture_before:=pg_temp.survey_payload_state(v_foreign_classroom);
  v_fixture_verified:=false;v_saved_receipts:='[]'::jsonb;
  begin
    insert into public.surveys(classroom_id,title,status,show_results,dynamic_responses,position,created_by)
      select v_foreign_classroom,'S','active',true,false,n,v_owner from generate_series(1,10000) n;
    insert into public.survey_questions(survey_id,question_type,question_text,options,response_max_chars,position)
      select v_foreign_survey,'short_text','Q','[]'::jsonb,5000,n from generate_series(1,10000) n;
    assert (select count(*)=10001 from public.surveys where classroom_id=v_foreign_classroom);
    assert (select count(*)=10001 from public.survey_questions where survey_id=v_foreign_survey);
    select id into v_last_question from public.survey_questions where survey_id=v_foreign_survey order by position desc,id desc limit 1;
    update public.surveys set dynamic_responses=true where id=v_foreign_survey;
    -- Results counts run first without answers, avoiding 10000 repeated scans
    -- of a large scoped aggregate. The later consistent-answer fixture is built
    -- once, outside each individual case and inside the outer rollback sentinel.
    foreach v_case in array array['results-owner','results-member','detail-questions-owner','detail-questions-member','detail-responses-member-joint','list-owner','list-member','response-questions'] loop
      for v_delta in 0..1 loop
        if v_case='detail-questions-owner' and v_delta=0 then
          insert into public.survey_responses(survey_id,question_id,student_id,response_text)
            select v_foreign_survey,id,v_other,'x' from public.survey_questions where survey_id=v_foreign_survey;
          assert (select count(*)=10001 from public.survey_responses where survey_id=v_foreign_survey and student_id=v_other);
        end if;
        v_before:=pg_temp.survey_payload_state(v_foreign_classroom);v_verified:=false;
        v_expected_code:=case when v_delta=0 then null when v_case='response-questions' then 'PT400' else 'PT503' end;
        begin
          if v_delta=0 then
            if v_case in ('list-owner','list-member') then
              delete from public.surveys where id=(select id from public.surveys where classroom_id=v_foreign_classroom and id<>v_foreign_survey order by id limit 1);
            else delete from public.survey_questions where id=v_last_question;end if;
          end if;
          select jsonb_agg(to_jsonb(r) order by position,id) into v_questions from public.survey_questions r where survey_id=v_foreign_survey;
          select jsonb_object_agg(id::text,jsonb_build_object('question_type','short_text','response_text','x'))
            into v_answers from public.survey_questions where survey_id=v_foreign_survey;
          if v_case in ('list-owner','list-member') then
            select count(*) into v_count from public.surveys where classroom_id=v_foreign_classroom;
          elsif v_case='detail-responses-member-joint' then
            select count(*) into v_count from public.survey_responses where survey_id=v_foreign_survey and student_id=v_other;
            assert jsonb_array_length(v_questions)=v_count,'Joint response/question count fixture differs';
          else v_count:=jsonb_array_length(v_questions);end if;
          assert v_count=10000+v_delta,'Exact count measurement differs';
          -- Reconstruct the unchanged guard projections from this fixed,
          -- one-member fixture (results have no answers; later cases have one
          -- answer per question). Measure the actual
          -- expression even for +1, where the RPC intentionally cannot return.
          if v_case in ('list-owner','list-member') then
            select jsonb_agg(to_jsonb(survey)||case when v_case='list-member' then jsonb_build_object('has_submitted',survey.id=v_foreign_survey)
              else jsonb_build_object('stats',jsonb_build_object('total_students',1,
                'questions_count',case when survey.id=v_foreign_survey then 10001 else 0 end,
                'responded',case when survey.id=v_foreign_survey then 1 else 0 end)) end order by position,created_at,id)
              into v_payload from public.surveys survey where classroom_id=v_foreign_classroom;
            select jsonb_build_object('classroom',jsonb_build_object('id',id,'teacher_id',teacher_id,'archived_at',archived_at),'surveys',v_payload)
              into v_probe from public.classrooms where id=v_foreign_classroom;
            v_measured:=octet_length(v_payload::text);
          elsif v_case in ('results-owner','results-member') then
            assert not exists(select 1 from public.survey_responses where survey_id=v_foreign_survey),'Results count fixture unexpectedly has answers';
            select jsonb_agg(jsonb_build_object('question_id',question.id,'question_type',question.question_type,
              'question_text',question.question_text,'options','[]'::jsonb,'counts','[]'::jsonb,'total_responses',0,'responses','[]'::jsonb)
              order by question.position,question.id) into v_payload from public.survey_questions question where survey_id=v_foreign_survey;
            select jsonb_build_object('classroom',jsonb_build_object('id',classroom.id,'teacher_id',classroom.teacher_id,'archived_at',classroom.archived_at),
              'survey',jsonb_build_object('id',survey.id,'title',survey.title,'status',survey.status,'show_results',survey.show_results,'dynamic_responses',survey.dynamic_responses),
              'results',v_payload) into v_probe from public.surveys survey join public.classrooms classroom on classroom.id=survey.classroom_id where survey.id=v_foreign_survey;
            if v_case='results-owner' then
              select jsonb_agg(jsonb_build_object('id',id,'question_type',question_type,'question_text',question_text,'options',options,
                'response_max_chars',response_max_chars,'position',position) order by position,id) into v_payload from public.survey_questions where survey_id=v_foreign_survey;
              v_probe:=v_probe||jsonb_build_object('questions',v_payload,'stats',jsonb_build_object('total_students',1,'responded',0),'responders','[]'::jsonb);
            end if;
            v_measured:=octet_length(v_probe::text);
          elsif v_case='response-questions' then
            v_measured:=octet_length(v_answers::text);
          else
            select case when v_case='detail-questions-owner' then '[]'::jsonb else jsonb_agg(to_jsonb(r) order by question_id) end into v_payload
              from public.survey_responses r where survey_id=v_foreign_survey and student_id=v_other;
            select jsonb_build_object('classroom',jsonb_build_object('id',classroom.id,'teacher_id',classroom.teacher_id,'archived_at',classroom.archived_at),
              'survey',to_jsonb(survey),'questions',v_questions,'responses',v_payload) into v_probe
              from public.surveys survey join public.classrooms classroom on classroom.id=survey.classroom_id where survey.id=v_foreign_survey;
            v_measured:=octet_length(v_questions::text)+octet_length(v_payload::text)+octet_length((v_probe->'survey')::text);
          end if;
          assert v_measured<8388608 and octet_length(v_answers::text)<8388608 and octet_length(v_questions::text)<8388608,'Count fixture bytes would mask the count guard';
          v_call_before:=pg_temp.survey_payload_state(v_foreign_classroom);v_code:=null;v_message:=null;
          begin
            execute 'set local role service_role';
            case v_case
              when 'detail-questions-owner' then v_result:=public.get_survey_for_owner_v1(v_owner,v_foreign_survey);
              when 'detail-questions-member' then v_result:=public.get_survey_for_member_v1(v_other,v_foreign_survey);
              when 'detail-responses-member-joint' then v_result:=public.get_survey_for_member_v1(v_other,v_foreign_survey);
              when 'list-owner' then v_result:=public.get_surveys_for_owner_v1(v_owner,v_foreign_classroom);
              when 'list-member' then v_result:=public.get_surveys_for_member_v1(v_other,v_foreign_classroom);
              when 'results-owner' then v_result:=public.get_survey_results_for_owner_v1(v_owner,v_foreign_survey);
              when 'results-member' then v_result:=public.get_survey_results_for_member_v1(v_other,v_foreign_survey);
              when 'response-questions' then v_result:=public.respond_to_survey_for_member_v1(v_other,v_foreign_survey,v_foreign_classroom,v_questions,v_answers);
            end case;
          exception when others then get stacked diagnostics v_code=returned_sqlstate,v_message=message_text;end;
          execute 'reset role';
          if v_delta=0 then
            assert v_code is null,'Exact count boundary was rejected';
            if v_case in ('list-owner','list-member') then
              assert jsonb_array_length(v_result->'surveys')=10000;
              assert v_result=v_probe,'Count list projection differs';
              assert not exists(select 1 from jsonb_array_elements(v_result->'surveys') r where r->>'classroom_id'<>v_foreign_classroom::text);
              v_measured:=octet_length((v_result->'surveys')::text);
            elsif v_case in ('results-owner','results-member') then
              assert jsonb_array_length(v_result->'results')=10000 and v_result->'survey'->>'id'=v_foreign_survey::text;
              assert v_result=v_probe,'Count results projection differs';
              assert not exists(select 1 from jsonb_array_elements(v_result->'results') r where r->>'total_responses'<>'0' or r->'responses'<>'[]'::jsonb);
              v_measured:=octet_length(v_result::text);
            elsif v_case='response-questions' then
              assert v_result='{"success":true,"updated":true}'::jsonb;
              assert (select count(*)=10000 and bool_and(response_text='x') from public.survey_responses where survey_id=v_foreign_survey and student_id=v_other);
              v_measured:=octet_length(v_answers::text);
            else
              assert jsonb_array_length(v_result->'questions')=10000 and v_result->'questions'=v_questions;
              assert jsonb_array_length(v_result->'responses')=(case when v_case='detail-questions-owner' then 0 else 10000 end);
              assert v_result=v_probe,'Count detail projection differs';
              v_measured:=octet_length((v_result->'questions')::text)+octet_length((v_result->'responses')::text)+octet_length((v_result->'survey')::text);
            end if;
            assert v_measured<=8388608,'Count positive was masked by bytes';
          else
            assert v_code=v_expected_code and v_message=(case when v_case='response-questions' then 'survey_invalid_responses' else 'survey_payload_limit' end),'Count denial differs';
          end if;
          if v_case<>'response-questions' or v_delta=1 then
            assert pg_temp.survey_payload_state(v_foreign_classroom)=v_call_before,'Count read/denial changed data/revisions';
          end if;
          v_verified:=true;
          raise exception using errcode='ZP001',message='survey_payload_case_rollback';
        exception when sqlstate 'ZP001' then null;end;
        assert v_verified and pg_temp.survey_payload_state(v_foreign_classroom)=v_before,'Count subtransaction restoration differs';
        v_saved_receipts:=v_saved_receipts||jsonb_build_array(jsonb_build_array('count-'||v_case||case v_delta when 0 then ':exact' else ':plus-one' end,v_measured,v_count,v_expected_code,true));
        v_result:=null;v_questions:=null;v_answers:=null;v_probe:=null;v_payload:=null;
      end loop;
    end loop;
    v_fixture_verified:=true;
    raise exception using errcode='ZP002',message='survey_payload_fixture_rollback';
  exception when sqlstate 'ZP002' then null;end;
  assert v_fixture_verified and pg_temp.survey_payload_state(v_foreign_classroom)=v_fixture_before,'Count fixture restoration differs';
  insert into survey_payload_receipts select value->>0,(value->>1)::integer,(value->>2)::integer,value->>3,(value->>4)::boolean from jsonb_array_elements(v_saved_receipts);

  -- Independent nonzero-question and exact response-key cardinality guards.
  foreach v_case in array array['response-empty','response-keys-short','response-keys-extra'] loop
    v_before:=pg_temp.survey_payload_state(v_foreign_classroom);v_verified:=false;
    begin
      if v_case='response-empty' then delete from public.survey_questions where survey_id=v_foreign_survey;end if;
      select coalesce(jsonb_agg(to_jsonb(r) order by position,id),'[]'::jsonb) into v_questions from public.survey_questions r where survey_id=v_foreign_survey;
      v_answers:=case when v_case='response-keys-extra' then jsonb_build_object(v_boundary_question::text,jsonb_build_object('question_type','short_text','response_text','x'),v_question::text,jsonb_build_object('question_type','short_text','response_text','x')) else '{}'::jsonb end;
      select count(*) into v_count from jsonb_object_keys(v_answers);
      v_measured:=octet_length(v_answers::text);v_call_before:=pg_temp.survey_payload_state(v_foreign_classroom);v_code:=null;v_message:=null;
      begin
        execute 'set local role service_role';
        v_result:=public.respond_to_survey_for_member_v1(v_other,v_foreign_survey,v_foreign_classroom,v_questions,v_answers);
      exception when others then get stacked diagnostics v_code=returned_sqlstate,v_message=message_text;end;
      execute 'reset role';
      assert v_code='PT400' and v_message='survey_invalid_responses','Response cardinality denial differs';
      assert pg_temp.survey_payload_state(v_foreign_classroom)=v_call_before,'Response cardinality denial changed data/revisions';
      v_verified:=true;
      raise exception using errcode='ZP001',message='survey_payload_case_rollback';
    exception when sqlstate 'ZP001' then null;end;
    assert v_verified and pg_temp.survey_payload_state(v_foreign_classroom)=v_before,'Response cardinality restoration differs';
    insert into survey_payload_receipts values('count-'||v_case,v_measured,v_count,'PT400',true);
  end loop;
  assert (select count(*)=49 from survey_payload_receipts),'Payload matrix receipt count differs';
end;
$contract$;
-- Compact source-owned receipts only; never SELECT giant payloads/graphs.
select jsonb_build_object('kind','survey-sql-payload-matrix','nativeVerified',false,'schemaVersion',1,'columns',jsonb_build_array('label','bytes','count','code','verified'),
  'cases',jsonb_agg(jsonb_build_array(label,measured_bytes,measured_count,expected_code,verified) order by label)) from survey_payload_receipts;
rollback;
