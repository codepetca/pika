-- Disposable schema-replay fixture only. All test data and mutations roll back.
begin;
insert into public.users(id,email,role) values ('c2890000-0000-4000-8000-000000000001','draft-owner@example.invalid','teacher'),('c2890000-0000-4000-8000-000000000002','draft-other@example.invalid','teacher'),('c2890000-0000-4000-8000-000000000003','draft-student@example.invalid','student');
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),'c2890000-0000-4000-8000-000000000001','classrooms.create','manual',true,clock_timestamp(),null,10,'test:draft','draft_rollback',0);
insert into public.classrooms(id,teacher_id,title,class_code) values ('c2890000-0000-4000-8000-000000000010','c2890000-0000-4000-8000-000000000001','Draft proof','DRAFT123');
do $$
declare a uuid := 'c2890000-0000-4000-8000-000000000001'; c uuid := 'c2890000-0000-4000-8000-000000000010'; k text; r jsonb; rr jsonb; i uuid; req uuid; rev uuid; expected uuid; content jsonb; projection jsonb; vals jsonb; q uuid := gen_random_uuid(); signature text; source_revision text;
begin
 foreach signature in array array['public.create_classwork_authoring_draft(uuid,uuid,text,uuid,jsonb,jsonb)','public.read_classwork_authoring_draft(uuid,uuid,text,uuid)','public.save_classwork_authoring_draft(uuid,uuid,text,uuid,uuid,jsonb,text,uuid,boolean,jsonb)','public.apply_classwork_authoring_draft(uuid,uuid,text,uuid,uuid,boolean,jsonb)'] loop
 if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or not has_function_privilege('service_role',signature,'execute') then raise exception 'bad grants %', signature; end if; end loop;
 foreach k in array array['assignment','material','survey'] loop
 req := gen_random_uuid(); rev := gen_random_uuid(); content := '{"title":"saved","show_results":true,"dynamic_responses":false}'::jsonb;
 projection := case k when 'assignment' then '{"title":"Original","description":"","instructions_markdown":"","rich_instructions":{"type":"doc","content":[]},"due_at":"2030-01-01T00:00:00Z","submission_requirements":[]}'::jsonb when 'material' then '{"title":"Original","content":{"type":"doc","content":[]},"posted_on":"2026-01-01"}'::jsonb else '{"title":"Original"}'::jsonb end;
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
 begin perform public.save_classwork_authoring_draft(a,c,k,i,rev,content,source_revision,expected); raise exception 'stale source accepted %',k; exception when sqlstate 'PT409' then null; end;
 if k='assignment' then update public.assignments set title='Original' where id=i;
 elsif k='material' then update public.classwork_materials set title='Original' where id=i;
 else update public.surveys set title='Original' where id=i; end if;
 source_revision := public.read_classwork_authoring_draft(a,c,k,i)->>'sourceRevision';
 perform public.save_classwork_authoring_draft(a,c,k,i,rev,content,source_revision,expected);
 if (case k when 'assignment' then (select title from public.assignments where id=i) when 'material' then (select title from public.classwork_materials where id=i) else (select title from public.surveys where id=i) end) <> 'Original' then raise exception 'save changed live %',k; end if;
 begin perform public.save_classwork_authoring_draft(a,c,k,i,gen_random_uuid(),content,source_revision,gen_random_uuid()); raise exception 'stale save accepted %',k; exception when sqlstate 'PT409' then null; end;
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
rollback;
