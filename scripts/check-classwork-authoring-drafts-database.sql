-- Disposable schema-replay fixture only. All test data and mutations roll back.
begin;
insert into public.users(id,email,role) values ('c2890000-0000-4000-8000-000000000001','draft-owner@example.invalid','teacher'),('c2890000-0000-4000-8000-000000000002','draft-other@example.invalid','teacher'),('c2890000-0000-4000-8000-000000000003','draft-student@example.invalid','student');
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),'c2890000-0000-4000-8000-000000000001','classrooms.create','manual',true,clock_timestamp(),null,10,'test:draft','draft_rollback',0);
insert into public.classrooms(id,teacher_id,title,class_code) values ('c2890000-0000-4000-8000-000000000010','c2890000-0000-4000-8000-000000000001','Draft proof','DRAFT123');
insert into public.course_blueprints(id,teacher_id,title) values
 ('c2890000-0000-4000-8000-000000000020','c2890000-0000-4000-8000-000000000001','Lineage proof');
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
 select 'c2890000-0000-4000-8000-000000000021',id,1,content_revision,'{}',repeat('a',64),teacher_id
 from public.course_blueprints where id='c2890000-0000-4000-8000-000000000020';
do $$
declare a uuid := 'c2890000-0000-4000-8000-000000000001'; c uuid := 'c2890000-0000-4000-8000-000000000010'; k text; r jsonb; rr jsonb; i uuid; req uuid; rev uuid; expected uuid; content jsonb; projection jsonb; vals jsonb; q uuid := gen_random_uuid(); signature text; source_revision text;
begin
 foreach signature in array array['public.create_classwork_authoring_draft(uuid,uuid,text,uuid,jsonb,jsonb)','public.read_classwork_authoring_draft(uuid,uuid,text,uuid)','public.save_classwork_authoring_draft(uuid,uuid,text,uuid,uuid,jsonb,text,uuid,boolean,jsonb)','public.apply_classwork_authoring_draft(uuid,uuid,text,uuid,uuid,boolean,jsonb,boolean)'] loop
 if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or not has_function_privilege('service_role',signature,'execute') then raise exception 'bad grants %', signature; end if; end loop;
 foreach k in array array['assignment','material','survey'] loop
 req := gen_random_uuid(); rev := gen_random_uuid(); content := '{"title":"saved","show_results":true,"dynamic_responses":false}'::jsonb;
 projection := case k when 'assignment' then '{"title":"Original","description":"","instructions_markdown":"","rich_instructions":{"type":"doc","content":[]},"due_at":"2030-01-01T00:00:00Z","submission_requirements":[]}'::jsonb when 'material' then '{"title":"Original","content":{"type":"doc","content":[]},"posted_on":"2026-01-01"}'::jsonb else '{"title":"Original","show_results":true,"dynamic_responses":false,"questions":[]}'::jsonb end;
 r := public.create_classwork_authoring_draft(a,c,k,req,content,projection); i := (r->'item'->>'id')::uuid;
 rr := public.create_classwork_authoring_draft(a,c,k,req,content,projection); if (rr->'item'->>'id')::uuid <> i then raise exception 'create retry %',k; end if;
 begin perform public.read_classwork_authoring_draft('c2890000-0000-4000-8000-000000000002',c,k,i); raise exception 'non-owner read accepted %', k; exception when sqlstate 'PT403' or insufficient_privilege then null; end;
 rr := public.read_classwork_authoring_draft(a,c,k,i);
 source_revision := rr->>'sourceRevision';
 if source_revision is null or rr->'item'->>'id' <> i::text or r->>'sourceRevision' <> source_revision then raise exception 'canonical create/read mismatch %',k; end if;
 expected := case when k='survey' then req else null end;
 -- Simulate another editor changing the live source after the initial read.
 if k='assignment' then update public.assignments set title='Concurrent' where id=i;
 elsif k='material' then update public.classwork_materials set title='Concurrent' where id=i;
 else update public.surveys set title='Concurrent' where id=i; end if;
 begin perform public.save_classwork_authoring_draft(a,c,k,i,rev,content,source_revision,expected,false,projection); raise exception 'stale source accepted %',k; exception when sqlstate 'PT409' then null; end;
 if k='assignment' then update public.assignments set title='Original' where id=i;
 elsif k='material' then update public.classwork_materials set title='Original' where id=i;
 else update public.surveys set title='Original' where id=i; end if;
 source_revision := public.read_classwork_authoring_draft(a,c,k,i)->>'sourceRevision';
 perform public.save_classwork_authoring_draft(a,c,k,i,rev,content,source_revision,expected,false,projection);
 if (case k when 'assignment' then (select title from public.assignments where id=i) when 'material' then (select title from public.classwork_materials where id=i) else (select title from public.surveys where id=i) end) <> 'Original' then raise exception 'save changed live %',k; end if;
 begin perform public.save_classwork_authoring_draft(a,c,k,i,gen_random_uuid(),content,source_revision,gen_random_uuid(),false,projection); raise exception 'stale save accepted %',k; exception when sqlstate 'PT409' then null; end;
 vals := case k when 'assignment' then '{"title":"Applied","submission_requirements":[]}'::jsonb when 'material' then '{"title":"Applied"}'::jsonb else jsonb_build_object('title','Applied','show_results',true,'dynamic_responses',false,'questions',jsonb_build_array(jsonb_build_object('id',q,'question_type','short_text','question_text','Q','options','[]'::jsonb,'response_max_chars',500))) end;
 begin perform public.apply_classwork_authoring_draft(a,c,k,i,gen_random_uuid(),k='survey',jsonb_build_object('source',content,'values',vals)); raise exception 'stale apply accepted %',k; exception when sqlstate 'PT409' then null; end;
 r := public.apply_classwork_authoring_draft(a,c,k,i,rev,k='survey',jsonb_build_object('source',content,'values',vals));
 if r->>'sourceRevision' is null or r->>'sourceRevision' <> public.read_classwork_authoring_draft(a,c,k,i)->>'sourceRevision' then raise exception 'apply source revision mismatch %', k; end if;
 if r->'item'->>'title' <> 'Applied' then raise exception 'apply failed %: %',k,r; end if;
 if public.read_classwork_authoring_draft(a,c,k,i)->'draft' <> 'null'::jsonb then raise exception 'draft not cleared %',k; end if;
 if k='survey' then
 insert into public.survey_responses(survey_id,question_id,student_id,response_text) values(i,q,'c2890000-0000-4000-8000-000000000003','answer');
 rev:=gen_random_uuid(); perform public.save_classwork_authoring_draft(a,c,k,i,rev,content,public.read_classwork_authoring_draft(a,c,k,i)->>'sourceRevision',null);
 vals := jsonb_set(vals,'{questions}','[]');
 begin perform public.apply_classwork_authoring_draft(a,c,k,i,rev,false,jsonb_build_object('source',content,'values',vals)); raise exception 'response deletion accepted'; exception when sqlstate 'PT409' then null; end;
 perform set_config('pika.classroom_archive_compaction','on',true);
 begin delete from public.survey_questions where id=q; delete from public.surveys where id=i; raise exception 'compaction deleted pending draft'; exception when sqlstate 'PT409' then null; end;
 perform set_config('pika.classroom_archive_compaction','off',true);
 if not exists(select 1 from public.survey_responses where question_id=q) or not exists(select 1 from public.survey_questions where id=q) or public.read_classwork_authoring_draft(a,c,k,i)->'draft' = 'null'::jsonb then raise exception 'rejected apply was not atomic'; end if;
 end if;
 raise notice 'PASS %',k;
 end loop;
end $$;
do $canonical$
declare
  a uuid := 'c2890000-0000-4000-8000-000000000001';
  c uuid := 'c2890000-0000-4000-8000-000000000010';
  k text; i uuid; req uuid; result jsonb; retry jsonb; published jsonb;
  source_revision text; projection jsonb; values_json jsonb;
  content jsonb := '{"title":"Autosaved"}'::jsonb;
begin
  foreach k in array array['assignment','material'] loop
    projection := case k when 'assignment' then
      '{"title":"Original canonical","description":"","instructions_markdown":"","rich_instructions":{"type":"doc","content":[]},"due_at":"2030-01-01T00:00:00Z","submission_requirements":[]}'::jsonb
      else '{"title":"Original canonical","content":{"type":"doc","content":[]},"posted_on":"2026-01-01"}'::jsonb end;
    result := public.create_classwork_authoring_draft(a,c,k,gen_random_uuid(),content,projection);
    i := (result->'item'->>'id')::uuid;
    source_revision := result->>'sourceRevision';
    req := gen_random_uuid();
    values_json := case k when 'assignment' then '{"title":"Autosaved","submission_requirements":[]}'::jsonb else '{"title":"Autosaved"}'::jsonb end;
    result := public.save_classwork_authoring_draft(a,c,k,i,req,content,source_revision,null,true,values_json);
    if result->'item'->>'title' <> 'Autosaved' or (result->'item'->>'is_draft')::boolean is distinct from true or result->'draft' <> 'null'::jsonb then
      raise exception 'canonical autosave failed %: %',k,result;
    end if;
    retry := public.save_classwork_authoring_draft(a,c,k,i,req,content,source_revision,null,true,values_json);
    if retry is distinct from result then raise exception 'canonical retry changed result %',k; end if;
    if k='assignment' then
      result := public.update_assignment_for_owner_v1(a,i,'{"is_draft":false}',null);
      published := result->'assignment';
    else
      result := public.update_classwork_material_for_owner_v1(a,c,i,'{"is_draft":false}');
      published := result->'material';
    end if;
    if (published->>'is_draft')::boolean is distinct from false or published->>'title' <> 'Autosaved' then raise exception 'post failed %: %',k,result; end if;
    begin
      perform public.save_classwork_authoring_draft(a,c,k,i,req,content,source_revision,null,true,values_json);
      raise exception 'old canonical save accepted after post %',k;
    exception when sqlstate 'PT409' then null; end;
    if k='assignment' then select to_jsonb(x) into result from public.assignments x where id=i;
    else select to_jsonb(x) into result from public.classwork_materials x where id=i; end if;
    if result is distinct from published then raise exception 'rejected canonical save changed published content %',k; end if;
    raise notice 'PASS canonical autosave and post %',k;
  end loop;
end
$canonical$;
do $review_proofs$
declare
 a uuid := 'c2890000-0000-4000-8000-000000000001'; c uuid := 'c2890000-0000-4000-8000-000000000010';
 student uuid := 'c2890000-0000-4000-8000-000000000003';
 survey uuid; material uuid; question uuid := gen_random_uuid(); rev uuid; source text;
 r jsonb; projection jsonb; content jsonb := '{"show_results":true,"dynamic_responses":false}'::jsonb;
begin
 projection := jsonb_build_object('title','Poll','show_results',true,'dynamic_responses',false,'questions',
   jsonb_build_array(jsonb_build_object('id',question,'question_type','short_text','question_text','Question','options','[]'::jsonb,'response_max_chars',500)));
 rev := gen_random_uuid(); r := public.create_classwork_authoring_draft(a,c,'survey',rev,content,projection);
 survey := (r->'item'->>'id')::uuid;
 if r->'item'->'questions'->0->>'id' <> question::text then raise exception 'survey creation lost canonical question'; end if;
 source := r->>'sourceRevision';
 projection := jsonb_set(projection,'{questions,0,question_text}','"Saved while draft"');
 r := public.save_classwork_authoring_draft(a,c,'survey',survey,gen_random_uuid(),content,source,rev,false,projection);
 rev := (r->'draft'->>'revision')::uuid;
 if r->'item'->'questions'->0->>'question_text' <> 'Saved while draft' then raise exception 'unpublished survey save not canonical'; end if;
 r := public.apply_classwork_authoring_draft(a,c,'survey',survey,rev,true,jsonb_build_object('source',content,'values',projection));
 source := r->>'sourceRevision'; rev := gen_random_uuid();
 projection := jsonb_set(projection,'{title}','"Edited privately"');
 r := public.save_classwork_authoring_draft(a,c,'survey',survey,rev,content,source,null,false,projection);
 if r->'item'->>'title' <> 'Poll' or r->>'sourceRevision' is null then raise exception 'posted survey save changed canonical title'; end if;
 update public.surveys set status='closed' where id=survey;
 r := public.read_classwork_authoring_draft(a,c,'survey',survey);
 if (r->'draft'->>'stale')::boolean then raise exception 'status-only change marked draft stale'; end if;
 r := public.apply_classwork_authoring_draft(a,c,'survey',survey,rev,false,jsonb_build_object('source',content,'values',projection));
 if r->'item'->>'title' <> 'Edited privately' or r->'item'->>'status' <> 'closed' then raise exception 'status-only change prevented apply'; end if;
 source := r->>'sourceRevision'; rev := gen_random_uuid();
 r := public.save_classwork_authoring_draft(a,c,'survey',survey,rev,content,source,null,false,projection);
 update public.surveys set title='Concurrent edit' where id=survey;
 r := public.read_classwork_authoring_draft(a,c,'survey',survey);
 if (r->'draft'->>'stale')::boolean is distinct from true then raise exception 'content conflict not marked stale'; end if;
 begin perform public.apply_classwork_authoring_draft(a,c,'survey',survey,gen_random_uuid(),false,'{}',true); raise exception 'wrong revision discard accepted'; exception when sqlstate 'PT409' then null; end;
 perform public.apply_classwork_authoring_draft(a,c,'survey',survey,rev,false,'{}',true);
 if public.read_classwork_authoring_draft(a,c,'survey',survey)->'draft' <> 'null'::jsonb then raise exception 'discard did not clear draft'; end if;
 -- A posted unanswered question changing type/options must receive a fresh ID.
 update public.survey_questions set
   artifact_id='c2890000-0000-4000-8000-000000000022',
   source_artifact_id='c2890000-0000-4000-8000-000000000023',
   source_blueprint_version_id='c2890000-0000-4000-8000-000000000021',
   created_at='2020-01-02T03:04:05Z'::timestamptz
 where id=question;

 source := public.read_classwork_authoring_draft(a,c,'survey',survey)->>'sourceRevision'; rev := gen_random_uuid();
 projection := jsonb_set(projection,'{questions,0,question_type}','"multiple_choice"');
 projection := jsonb_set(projection,'{questions,0,options}','["One","Two"]');
 perform public.save_classwork_authoring_draft(a,c,'survey',survey,rev,content,source,null,false,projection);
 r := public.apply_classwork_authoring_draft(a,c,'survey',survey,rev,false,jsonb_build_object('source',content,'values',projection));
 if exists(select 1 from public.survey_questions where id=question) or not exists(select 1 from public.survey_questions where survey_id=survey and question_type='multiple_choice' and id<>question) then raise exception 'posted question ID not rotated'; end if;
 if not exists(select 1 from public.survey_questions where survey_id=survey and id<>question
   and artifact_id='c2890000-0000-4000-8000-000000000022'
   and source_artifact_id='c2890000-0000-4000-8000-000000000023'
   and source_blueprint_version_id='c2890000-0000-4000-8000-000000000021'
   and created_at='2020-01-02T03:04:05Z'::timestamptz) then
   raise exception 'question rotation lost lineage or creation time';
 end if;

 begin insert into public.survey_responses(survey_id,question_id,student_id,response_text) values(survey,question,student,'legacy'); raise exception 'old question ID accepted'; exception when foreign_key_violation then null; end;
 -- Response-bearing questions cannot change type or options.
 select id into question from public.survey_questions where survey_id=survey;
 insert into public.survey_responses(survey_id,question_id,student_id,selected_option) values(survey,question,student,0);
 projection := jsonb_set(projection,'{questions,0,id}',to_jsonb(question));
 projection := jsonb_set(projection,'{questions,0,options}','["Different","Two"]');
 source := public.read_classwork_authoring_draft(a,c,'survey',survey)->>'sourceRevision'; rev := gen_random_uuid();
 perform public.save_classwork_authoring_draft(a,c,'survey',survey,rev,content,source,null,false,projection);
 begin perform public.apply_classwork_authoring_draft(a,c,'survey',survey,rev,false,jsonb_build_object('source',content,'values',projection)); raise exception 'response-bearing option change accepted'; exception when sqlstate 'PT409' then null; end;
 if not exists(select 1 from public.survey_responses where question_id=question) then raise exception 'response lost on rejected question edit'; end if;
 projection := jsonb_set(projection,'{questions,0,question_type}','"short_text"');
 projection := jsonb_set(projection,'{questions,0,options}','[]');
 begin perform public.apply_classwork_authoring_draft(a,c,'survey',survey,rev,false,jsonb_build_object('source',content,'values',projection)); raise exception 'response-bearing type change accepted'; exception when sqlstate 'PT409' then null; end;
 -- Material publication accepts only publication fields and the exact current source.
 r := public.create_classwork_authoring_draft(a,c,'material',gen_random_uuid(),content,'{"title":"Material original","content":{"type":"doc","content":[]},"posted_on":"2026-01-01"}');
 material := (r->'item'->>'id')::uuid; source := r->>'sourceRevision';
 update public.classwork_materials set title='Current draft' where id=material;
 begin perform public.publish_classwork_authoring_material(a,c,material,source,'{"is_draft":false}'); raise exception 'stale material publication accepted'; exception when sqlstate 'PT409' then null; end;
 source := public.read_classwork_authoring_draft(a,c,'material',material)->>'sourceRevision';
 begin perform public.publish_classwork_authoring_material(a,c,material,source,'{"is_draft":false,"title":"Injected"}'); raise exception 'material content injection accepted'; exception when sqlstate 'PT400' then null; end;
 r := public.publish_classwork_authoring_material(a,c,material,source,'{"is_draft":false}');
 if r->'item'->>'title' <> 'Current draft' or (r->'item'->>'is_draft')::boolean then raise exception 'material publication changed existing draft content'; end if;
 raise notice 'PASS status-only apply, stale discard, question rotation and material publication';
end
$review_proofs$;
-- A legacy response must bind the entire question snapshot, not just old IDs.
do $response_snapshot$
declare
  owner_id uuid := 'c2890000-0000-4000-8000-000000000001';
  v_classroom_id uuid := 'c2890000-0000-4000-8000-000000000010';
  v_student_id uuid := 'c2890000-0000-4000-8000-000000000003';
  first_id uuid := gen_random_uuid(); second_id uuid := gen_random_uuid();
  v_survey_id uuid; revision uuid := gen_random_uuid(); source text;
  content jsonb := '{"show_results":true,"dynamic_responses":false}'::jsonb;
  projection jsonb; result jsonb; old_questions jsonb; current_questions jsonb; answers jsonb;
begin
  insert into public.classroom_enrollments(classroom_id,student_id) values(v_classroom_id,v_student_id);
  projection := jsonb_build_object('title','Snapshot poll','show_results',true,'dynamic_responses',false,'questions',
    jsonb_build_array(jsonb_build_object('id',first_id,'question_type','short_text','question_text','First','options','[]'::jsonb,'response_max_chars',500)));
  result := public.create_classwork_authoring_draft(owner_id,v_classroom_id,'survey',revision,content,projection);
  v_survey_id := (result->'item'->>'id')::uuid;
  perform public.apply_classwork_authoring_draft(owner_id,v_classroom_id,'survey',v_survey_id,revision,true,jsonb_build_object('source',content,'values',projection));
  old_questions := public.get_survey_for_member_v1(v_student_id,v_survey_id)->'questions';
  source := public.read_classwork_authoring_draft(owner_id,v_classroom_id,'survey',v_survey_id)->>'sourceRevision';
  revision := gen_random_uuid();
  projection := jsonb_set(projection,'{questions}',(projection->'questions') || jsonb_build_array(
    jsonb_build_object('id',second_id,'question_type','short_text','question_text','Second','options','[]'::jsonb,'response_max_chars',500)));
  perform public.save_classwork_authoring_draft(owner_id,v_classroom_id,'survey',v_survey_id,revision,content,source,null,false,projection);
  perform public.apply_classwork_authoring_draft(owner_id,v_classroom_id,'survey',v_survey_id,revision,false,jsonb_build_object('source',content,'values',projection));
  current_questions := public.get_survey_for_member_v1(v_student_id,v_survey_id)->'questions';
  if jsonb_array_length(current_questions) <> 2 or not exists(select 1 from public.survey_questions where id=first_id and public.survey_questions.survey_id=v_survey_id) then
    raise exception 'question addition did not preserve original ID';
  end if;
  answers := jsonb_build_object(first_id::text,jsonb_build_object('question_type','short_text','response_text','First answer'),
    second_id::text,jsonb_build_object('question_type','short_text','response_text','Second answer'));
  begin
    perform public.respond_to_survey_for_member_v1(v_student_id,v_survey_id,v_classroom_id,old_questions,answers);
    raise exception 'stale question snapshot accepted';
  exception when sqlstate 'PT409' then
    if sqlerrm <> 'survey_questions_changed' then raise; end if;
  end;
  if exists(select 1 from public.survey_responses where public.survey_responses.student_id=v_student_id and public.survey_responses.survey_id=v_survey_id) then
    raise exception 'stale snapshot committed a response';
  end if;
  result := public.respond_to_survey_for_member_v1(v_student_id,v_survey_id,v_classroom_id,current_questions,answers);
  if result->>'success' <> 'true' or (select count(*) from public.survey_responses r where r.student_id=v_student_id and r.survey_id=v_survey_id) <> 2 then
    raise exception 'current snapshot did not commit both responses';
  end if;
  raise notice 'PASS survey response question snapshot';
end
$response_snapshot$;
rollback;
