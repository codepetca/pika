-- Rollback-only contracts. Run only inside the governed owned ephemeral full schema.
begin;
set local lock_timeout='2s'; set local statement_timeout='20s';
do $acl$ declare n text; begin
 foreach n in array array['get_assignment_repolight_source_v1','begin_assignment_repolight_run_v1','advance_assignment_repolight_run_v1','read_assignment_repolight_run_v1','import_assignment_repolight_feedback_v1','begin_repolight_subject_erasure_v1','record_repolight_subject_erasure_v1'] loop
 if not exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname=n and p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE') and has_function_privilege('service_role',p.oid,'EXECUTE')) then raise exception 'RepoLight RPC ACL differs'; end if; end loop;
 if private.repolight_canonical_json_v1('{"z":1,"aa":[true,null,"q"],"a":{"b":2,"a":1}}') <> '{"a":{"a":1,"b":2},"aa":[true,null,"q"],"z":1}' then raise exception 'Canonical JSON differs from JS fixture'; end if;
end $acl$;
insert into public.users(id,email,role) values
 ('f2930000-0000-4000-8000-000000000001','repolight-owner@example.invalid','teacher'),
 ('f2930000-0000-4000-8000-000000000002','repolight-student@example.invalid','student'),
 ('f2930000-0000-4000-8000-000000000003','repolight-outsider@example.invalid','teacher');
insert into public.classrooms(id,teacher_id,title,class_code) values('f2930000-0000-4000-8000-000000000010','f2930000-0000-4000-8000-000000000001','Synthetic RepoLight','R293FX');
insert into public.classroom_enrollments(id,classroom_id,student_id) values('f2930000-0000-4000-8000-000000000011','f2930000-0000-4000-8000-000000000010','f2930000-0000-4000-8000-000000000002');
insert into public.assignments(id,classroom_id,title,description,due_at,created_by,is_draft,released_at) values('f2930000-0000-4000-8000-000000000020','f2930000-0000-4000-8000-000000000010','Synthetic analysis','','2026-10-25T04:00:00Z','f2930000-0000-4000-8000-000000000001',false,'2026-09-01T04:00:00Z');
insert into public.assignment_docs(id,assignment_id,student_id,repo_url,github_username,score_completion,score_thinking,score_workflow,teacher_feedback_draft) values('f2930000-0000-4000-8000-000000000030','f2930000-0000-4000-8000-000000000020','f2930000-0000-4000-8000-000000000002','https://github.com/example/project',null,7,8,9,'Teacher original');
update private.repolight_settings set enabled=true where singleton;
set local role service_role;
do $behavior$
declare actor constant uuid:='f2930000-0000-4000-8000-000000000001'; assignment constant uuid:='f2930000-0000-4000-8000-000000000020'; learner constant uuid:='f2930000-0000-4000-8000-000000000002'; source jsonb; r jsonb; replay jsonb; held jsonb; binding uuid; token uuid; generation integer; report jsonb; receipt jsonb; doc_before jsonb; doc_after jsonb;
begin
 source:=public.get_assignment_repolight_source_v1(actor,assignment,learner);
 perform public.get_assignment_repolight_source_v1(actor,assignment,'f2930000-0000-4000-8000-000000000003');
 begin perform public.begin_assignment_repolight_run_v1(actor,assignment,'f2930000-0000-4000-8000-000000000003',gen_random_uuid(),'{}','{}','{}');raise exception 'Unenrolled write accepted';exception when insufficient_privilege then null;end;
 r:=public.begin_assignment_repolight_run_v1(actor,assignment,learner,'f2930000-0000-4000-8000-000000000040','{"connectionRef":"fixture","workspaceRef":"fixture_workspace","installationRef":"pika_fixture"}','{"repositoryUrl":"https://github.com/example/project","period":{"startAt":"2026-09-01T04:00:00Z","endAt":"2026-10-25T04:00:00Z","timezone":"America/Toronto"},"scheduledProjectDates":null,"baselineReviewed":false,"exclusions":{"commitShas":[],"pathPrefixes":[],"botLogins":[]}}',source->'source');
 replay:=public.begin_assignment_repolight_run_v1(actor,assignment,learner,'f2930000-0000-4000-8000-000000000040','{"connectionRef":"fixture","workspaceRef":"fixture_workspace","installationRef":"pika_fixture"}',r->'request_json',source->'source');
 if r->>'id'<>replay->>'id' or r#>>'{create_envelope,clientBinding,sourceRevisionRef}'<>source->>'source_fingerprint' or r#>'{create_envelope,request}' ? 'githubUsername' then raise exception 'Intent/binding/optional-login differs'; end if;
 begin perform public.get_assignment_repolight_source_v1('f2930000-0000-4000-8000-000000000003',assignment,learner);raise exception 'Foreign teacher accepted';exception when insufficient_privilege then null;end;
 held:=public.advance_assignment_repolight_run_v1(actor,assignment,learner,(r->>'id')::uuid,'claim','{}');token:=(held->>'lease_token')::uuid;generation:=(held->>'lease_generation')::integer;binding:=(r->>'subject_binding_id')::uuid;
 begin perform public.advance_assignment_repolight_run_v1(actor,assignment,learner,(r->>'id')::uuid,'authorize',jsonb_build_object('leaseToken',gen_random_uuid(),'leaseGeneration',generation));raise exception 'Stale token accepted';exception when sqlstate '40001' then null;end;
 perform public.advance_assignment_repolight_run_v1(actor,assignment,learner,(r->>'id')::uuid,'record_remote',jsonb_build_object('leaseToken',token,'leaseGeneration',generation,'analysisId','f2930000-0000-4000-8000-000000000050'));
 begin delete from public.assignment_docs where id='f2930000-0000-4000-8000-000000000030';raise exception 'Uncertain remote subject lost';exception when sqlstate '55000' then null;end;
 begin update public.assignment_repolight_runs set request_fingerprint=repeat('0',64) where id=(r->>'id')::uuid;raise exception 'Direct mutation accepted';exception when insufficient_privilege then null;end;
 -- Test completion envelope binding without accepting arbitrary provider suggestions.
 report:=jsonb_build_object('schemaVersion','1.0','analysisId','f2930000-0000-4000-8000-000000000050','reportRef','f2930000-0000-4000-8000-000000000050','requestFingerprint',r->>'request_fingerprint','clientBinding',r#>'{create_envelope,clientBinding}','reportDigest',repeat('a',64),'bundle',jsonb_build_object('schemaVersion','1.0','bundleRef','f2930000-0000-4000-8000-000000000050','overview',jsonb_build_object('ruleFeedback',jsonb_build_object('feedbackDraft','Generated review')),'contributors','[]'::jsonb));
 report:=jsonb_set(report,'{reportDigest}',to_jsonb('fc9d5fb85eb1ca43ae71125700032fda8dc1222c0e6db9f550a877a0ad842357'::text));
 perform public.advance_assignment_repolight_run_v1(actor,assignment,learner,(r->>'id')::uuid,'complete',jsonb_build_object('leaseToken',token,'leaseGeneration',generation,'result',report));
 select to_jsonb(d) into doc_before from public.assignment_docs d where d.id='f2930000-0000-4000-8000-000000000030';
 perform public.import_assignment_repolight_feedback_v1(actor,assignment,learner,(r->>'id')::uuid,'f2930000-0000-4000-8000-000000000060','repository',(doc_before->>'updated_at')::timestamptz,report->>'reportDigest',null);
 select to_jsonb(d) into doc_after from public.assignment_docs d where d.id='f2930000-0000-4000-8000-000000000030';
 if doc_after->>'teacher_feedback_draft' <> E'Teacher original\n\nGenerated review' or (doc_after-array['teacher_feedback_draft','teacher_feedback_draft_updated_at','updated_at']) is distinct from (doc_before-array['teacher_feedback_draft','teacher_feedback_draft_updated_at','updated_at']) then raise exception 'Import changed non-draft fields';end if;
 perform public.import_assignment_repolight_feedback_v1(actor,assignment,learner,(r->>'id')::uuid,'f2930000-0000-4000-8000-000000000060','repository',(doc_before->>'updated_at')::timestamptz,report->>'reportDigest',null);
 if public.classroom_purge_conflict('f2930000-0000-4000-8000-000000000010') is distinct from 'repolight_erasure_required' then raise exception 'Purge blocker missing';end if;
 update public.classrooms set archived_at=clock_timestamp() where id='f2930000-0000-4000-8000-000000000010';
 if public.get_assignment_repolight_source_v1(actor,assignment,learner)#>>'{latest_run,id}' is distinct from r->>'id' then raise exception 'Archived cached context missing';end if;
 perform public.read_assignment_repolight_run_v1(actor,assignment,learner,(r->>'id')::uuid,true);
 begin perform public.advance_assignment_repolight_run_v1(actor,assignment,learner,(r->>'id')::uuid,'claim','{}');raise exception 'Archived write accepted';exception when sqlstate '55000' then null;end;
 held:=public.begin_repolight_subject_erasure_v1(actor,binding,'f2930000-0000-4000-8000-000000000070');
 receipt:=jsonb_build_object('schemaVersion','1.0','operationRef','f2930000-0000-4000-8000-000000000070','installationRef','pika_fixture','subjectRef',held->>'subject_ref','status','erased','absenceVerified',true);
 perform public.record_repolight_subject_erasure_v1(actor,binding,'f2930000-0000-4000-8000-000000000070',receipt);
 if exists(select 1 from public.assignment_repolight_runs where id=(r->>'id')::uuid) then raise exception 'Erased local result remains';end if;
end $behavior$;
reset role;
rollback;
