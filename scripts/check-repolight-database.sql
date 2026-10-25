-- Rollback-only contracts. Run only inside the governed owned ephemeral full schema.
begin;
set local lock_timeout='2s'; set local statement_timeout='20s';
do $acl$ declare n text; begin
 foreach n in array array['get_assignment_repolight_source_v1','begin_assignment_repolight_run_v1','advance_assignment_repolight_run_v1','read_assignment_repolight_run_v1','import_assignment_repolight_feedback_v1','begin_repolight_subject_erasure_v1','record_repolight_subject_erasure_v1','reserve_repolight_hot_classroom_purge_v1','read_repolight_purge_cleanup_subjects_v1','reserve_repolight_removed_student_cleanup_v1','get_repolight_assignment_delete_context_v1','reserve_repolight_assignment_delete_v1','read_repolight_decommission_subjects_v1','finalize_repolight_assignment_delete_v1','get_repolight_removed_student_cleanup_context_v1','discover_repolight_removed_student_cleanup_groups_v1'] loop
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
insert into public.assignments(id,classroom_id,title,description,due_at,created_by,is_draft) values('f2930000-0000-4000-8000-000000000099','f2930000-0000-4000-8000-000000000010','Other teacher-owned assignment','','2026-10-25T04:00:00Z','f2930000-0000-4000-8000-000000000001',true);
insert into public.assignment_docs(id,assignment_id,student_id,repo_url,github_username,score_completion,score_thinking,score_workflow,teacher_feedback_draft) values('f2930000-0000-4000-8000-000000000030','f2930000-0000-4000-8000-000000000020','f2930000-0000-4000-8000-000000000002','https://github.com/example/project.git',null,7,8,9,'Teacher original');
insert into public.assignment_submission_requirements(id,assignment_id,type,label) values('f2930000-0000-4000-8000-000000000080','f2930000-0000-4000-8000-000000000020','link','Non-repository attachment');
insert into public.assignment_submission_artifacts(assignment_doc_id,requirement_id,student_id,type,url) values('f2930000-0000-4000-8000-000000000030','f2930000-0000-4000-8000-000000000080','f2930000-0000-4000-8000-000000000002','link','https://example.invalid/worksheet');
insert into public.classroom_roster(id,classroom_id,email) values('f2930000-0000-4000-8000-000000000082','f2930000-0000-4000-8000-000000000010','repolight-student@example.invalid');
update private.student_provider_cleanup_settings set live_enabled=true,eligible_after='2026-01-01T00:00:00Z' where singleton;
update private.repolight_settings set enabled=true where singleton;
update public.managed_storage_settings set mode='enforced',activated_at=clock_timestamp(),readiness_verified_at=clock_timestamp(),readiness_digest=repeat('e',64) where singleton;
update public.student_purge_settings set rollout_mode='enabled',canary_teacher_id=null,canary_classroom_id=null,canary_student_id=null where singleton;
update public.classroom_purge_settings set rollout_mode='enabled',canary_teacher_id=null,canary_classroom_id=null where singleton;
set local role service_role;
do $behavior$
declare actor constant uuid:='f2930000-0000-4000-8000-000000000001'; assignment constant uuid:='f2930000-0000-4000-8000-000000000020'; learner constant uuid:='f2930000-0000-4000-8000-000000000002'; source jsonb; r jsonb; replay jsonb; held jsonb; binding uuid; token uuid; generation integer; report jsonb; receipt jsonb; doc_before jsonb; doc_after jsonb; impact jsonb; reserved jsonb; children jsonb; replay_children jsonb; purge_id constant uuid:='f2930000-0000-4000-8000-000000000095';
begin
 source:=public.get_assignment_repolight_source_v1(actor,assignment,learner);
 if jsonb_array_length(source#>'{source,artifacts}')<>0 then raise exception 'Non-repository artifact entered analysis source';end if;
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
 -- Removed-generation intent proves exact retained enrollment without Pal setup.
 begin
  perform public.remove_classroom_students_preserving_data(actor,'f2930000-0000-4000-8000-000000000010',array['f2930000-0000-4000-8000-000000000082'::uuid]);
  begin perform public.reserve_repolight_removed_student_cleanup_v1(purge_id,actor,'f2930000-0000-4000-8000-000000000010',learner,gen_random_uuid());raise exception 'Wrong removed generation accepted';exception when sqlstate '55000' then null;end;
  impact:=public.get_repolight_removed_student_cleanup_context_v1(actor,'f2930000-0000-4000-8000-000000000010',learner,null);
  if impact->>'other_providers'<>'out_of_scope' or impact->>'generation_id'<>'f2930000-0000-4000-8000-000000000011' or impact->>'scope'<>'repolight_only' or not coalesce((impact->>'academic_preserved')::boolean,false) then raise exception 'Remote-only read context misclassified provider/local authority';end if;
  if public.discover_repolight_removed_student_cleanup_groups_v1(actor,'f2930000-0000-4000-8000-000000000010',null)->>'target_count'<>'1' then raise exception 'Remote-only discovery omitted exact saved subject';end if;
  reserved:=public.reserve_repolight_removed_student_cleanup_v1(purge_id,actor,'f2930000-0000-4000-8000-000000000010',learner,'f2930000-0000-4000-8000-000000000011');
  children:=public.read_repolight_decommission_subjects_v1(actor,purge_id);
  if reserved->>'status'<>'cleanup_pending' or jsonb_array_length(children)<>1 or children#>>'{0,enrollment_id}'<>'f2930000-0000-4000-8000-000000000011' or children#>>'{0,operation_id}' is null then raise exception 'Removed generation snapshot differs';end if;
  perform public.record_repolight_subject_erasure_v1(actor,(children#>>'{0,id}')::uuid,(children#>>'{0,operation_id}')::uuid,jsonb_build_object('schemaVersion','1.0','operationRef',children#>>'{0,operation_id}','installationRef',children#>>'{0,installation_ref}','subjectRef',children#>>'{0,subject_ref}','status','erased','absenceVerified',true));
  if jsonb_array_length(public.read_repolight_decommission_subjects_v1(actor,purge_id))<>0 or public.reserve_repolight_removed_student_cleanup_v1(purge_id,actor,'f2930000-0000-4000-8000-000000000010',learner,'f2930000-0000-4000-8000-000000000011')->>'status'<>'completed' then raise exception 'Removed completion did not preserve exact receipt';end if;
  raise exception using errcode='P2931',message='rollback synthetic admission';
 exception when sqlstate 'P2931' then null;
 end;
 -- Both legacy and contextual Delete stay fenced through the same durable intent.
 begin
  impact:=public.get_repolight_assignment_delete_context_v1(actor,assignment);
  begin perform public.reserve_repolight_assignment_delete_v1(purge_id,actor,assignment,(impact->>'assignment_updated_at')::timestamptz,repeat('0',64));raise exception 'Stale Delete source reserved';exception when sqlstate '40001' then null;end;
  reserved:=public.reserve_repolight_assignment_delete_v1(purge_id,actor,assignment,(impact->>'assignment_updated_at')::timestamptz,impact->>'source_fingerprint');
  children:=public.read_repolight_decommission_subjects_v1(actor,purge_id);
  if reserved->>'status'<>'cleanup_pending' or jsonb_array_length(children)<>1 then raise exception 'Assignment subject snapshot missing';end if;
  begin update public.assignment_docs set teacher_feedback_draft='Concurrent change' where id='f2930000-0000-4000-8000-000000000030';raise exception 'Pending Delete allowed source writes';exception when sqlstate '55000' then null;end;
  begin perform public.delete_assignment_for_owner_v1(actor,assignment);raise exception 'Contextual Delete bypassed pending intent';exception when sqlstate '55000' then null;end;
  begin delete from public.assignments where id=assignment;raise exception 'Legacy Delete bypassed pending intent';exception when sqlstate '55000' then null;end;
  begin perform public.finalize_repolight_assignment_delete_v1(actor,purge_id,'f2930000-0000-4000-8000-000000000099');raise exception 'Wrong assignment route accepted pending intent';exception when insufficient_privilege then null;end;
  begin perform public.finalize_repolight_assignment_delete_v1(actor,purge_id,assignment);raise exception 'Delete finalized without receipts';exception when sqlstate '55000' then null;end;
  perform public.record_repolight_subject_erasure_v1(actor,(children#>>'{0,id}')::uuid,(children#>>'{0,operation_id}')::uuid,jsonb_build_object('schemaVersion','1.0','operationRef',children#>>'{0,operation_id}','installationRef',children#>>'{0,installation_ref}','subjectRef',children#>>'{0,subject_ref}','status','erased','absenceVerified',true));
  reserved:=public.finalize_repolight_assignment_delete_v1(actor,purge_id,assignment);
  begin perform public.finalize_repolight_assignment_delete_v1(actor,purge_id,'f2930000-0000-4000-8000-000000000099');raise exception 'Wrong assignment route accepted completed receipt';exception when insufficient_privilege then null;end;
  if not coalesce((reserved->>'deleted')::boolean,false) or exists(select 1 from public.assignments where id=assignment) or public.finalize_repolight_assignment_delete_v1(actor,purge_id,assignment)->>'classroom_id' is distinct from reserved->>'classroom_id' then raise exception 'Assignment finalization/replay differs';end if;
  raise exception using errcode='P2931',message='rollback synthetic admission';
 exception when sqlstate 'P2931' then null;
 end;
 -- Admission tests roll back their successful destructive intent without egress.
 begin
  impact:=public.get_student_purge_inventory(actor,'f2930000-0000-4000-8000-000000000010',learner);
  if (impact->>'deletion_available')::boolean or not coalesce((impact->>'can_reserve_cleanup')::boolean,false) then raise exception 'Student cleanup eligibility projection differs';end if;
  reserved:=public.begin_student_purge(purge_id,actor,'f2930000-0000-4000-8000-000000000010',learner,'WRONG',(impact->>'source_revision')::bigint,impact->>'storage_inventory_sha256',impact->>'relational_inventory_sha256');
  if coalesce((reserved->>'ok')::boolean,false) or exists(select 1 from public.student_purge_operations where id=purge_id) then raise exception 'Wrong confirmation reserved cleanup';end if;
  reserved:=public.begin_student_purge(purge_id,actor,'f2930000-0000-4000-8000-000000000010',learner,'repolight-student@example.invalid',(impact->>'source_revision')::bigint,repeat('0',64),impact->>'relational_inventory_sha256');
  if coalesce((reserved->>'ok')::boolean,false) or exists(select 1 from public.student_purge_operations where id=purge_id) then raise exception 'Wrong hashes reserved cleanup';end if;
  reserved:=public.begin_student_purge(purge_id,actor,'f2930000-0000-4000-8000-000000000010',learner,'repolight-student@example.invalid',(impact->>'source_revision')::bigint,impact->>'storage_inventory_sha256',impact->>'relational_inventory_sha256');
  if not coalesce((reserved->>'ok')::boolean,false) then raise exception 'Confirmed student cleanup admission failed: %',reserved;end if;
  children:=public.read_repolight_purge_cleanup_subjects_v1(actor,purge_id);
  if jsonb_array_length(children)<>1 or children#>>'{0,operation_id}' is null then raise exception 'Student immutable subject snapshot missing';end if;
  reserved:=public.begin_student_purge(purge_id,actor,'f2930000-0000-4000-8000-000000000010',learner,'repolight-student@example.invalid',(impact->>'source_revision')::bigint,impact->>'storage_inventory_sha256',impact->>'relational_inventory_sha256');
  replay_children:=public.read_repolight_purge_cleanup_subjects_v1(actor,purge_id);
  if not coalesce((reserved->>'replayed')::boolean,false) or children is distinct from replay_children then raise exception 'Student replay recaptured subjects';end if;
  if not coalesce((public.claim_student_purge_object(purge_id,actor)->>'waiting_for_repolight')::boolean,false) or public.finalize_student_purge(purge_id,actor)->>'error_code'<>'repolight_erasure_required' then raise exception 'Student receipt fence missing';end if;
  raise exception using errcode='P2931',message='rollback synthetic admission';
 exception when sqlstate 'P2931' then null;
 end;
 update public.classrooms set archived_at=clock_timestamp() where id='f2930000-0000-4000-8000-000000000010';
 if public.get_assignment_repolight_source_v1(actor,assignment,learner)#>>'{latest_run,id}' is distinct from r->>'id' then raise exception 'Archived cached context missing';end if;
 perform public.read_assignment_repolight_run_v1(actor,assignment,learner,(r->>'id')::uuid,true);
 begin perform public.advance_assignment_repolight_run_v1(actor,assignment,learner,(r->>'id')::uuid,'claim','{}');raise exception 'Archived write accepted';exception when sqlstate '55000' then null;end;
 begin
  impact:=public.get_hot_archived_classroom_purge_inventory(actor,'f2930000-0000-4000-8000-000000000010');
  if (impact->>'deletion_available')::boolean or not coalesce((impact->>'can_reserve_cleanup')::boolean,false) then raise exception 'Hot cleanup eligibility projection differs';end if;
  reserved:=public.reserve_repolight_hot_classroom_purge_v1(purge_id,actor,'f2930000-0000-4000-8000-000000000010','WRONG',(impact->>'source_revision')::bigint,impact->>'storage_inventory_sha256',impact->>'operational_inventory_sha256');
  if coalesce((reserved->>'ok')::boolean,false) or exists(select 1 from public.classroom_purge_operations where id=purge_id) then raise exception 'Wrong hot confirmation reserved cleanup';end if;
  reserved:=public.reserve_repolight_hot_classroom_purge_v1(purge_id,actor,'f2930000-0000-4000-8000-000000000010','DELETE',(impact->>'source_revision')::bigint,repeat('0',64),impact->>'operational_inventory_sha256');
  if coalesce((reserved->>'ok')::boolean,false) or exists(select 1 from public.classroom_purge_operations where id=purge_id) then raise exception 'Wrong hot hashes reserved cleanup';end if;
  reserved:=public.reserve_repolight_hot_classroom_purge_v1(purge_id,actor,'f2930000-0000-4000-8000-000000000010','DELETE',(impact->>'source_revision')::bigint,impact->>'storage_inventory_sha256',impact->>'operational_inventory_sha256');
  if not coalesce((reserved->>'ok')::boolean,false) then raise exception 'Confirmed hot cleanup admission failed: %',reserved;end if;
  children:=public.read_repolight_purge_cleanup_subjects_v1(actor,purge_id);
  reserved:=public.reserve_repolight_hot_classroom_purge_v1(purge_id,actor,'f2930000-0000-4000-8000-000000000010','DELETE',(impact->>'source_revision')::bigint,impact->>'storage_inventory_sha256',impact->>'operational_inventory_sha256');
  if jsonb_array_length(children)<>1 or children#>>'{0,operation_id}' is null or children is distinct from public.read_repolight_purge_cleanup_subjects_v1(actor,purge_id) or not coalesce((reserved->>'replayed')::boolean,false) then raise exception 'Hot replay changed subject snapshot';end if;
  if exists(select 1 from public.claim_classroom_purge_object(purge_id,actor,gen_random_uuid(),60)) or public.finalize_hot_archived_classroom_purge(purge_id,actor)->>'error_code'<>'repolight_erasure_required' then raise exception 'Hot receipt fence missing';end if;
  raise exception using errcode='P2931',message='rollback synthetic admission';
 exception when sqlstate 'P2931' then null;
 end;
 held:=public.begin_repolight_subject_erasure_v1(actor,binding,'f2930000-0000-4000-8000-000000000070');
 receipt:=jsonb_build_object('schemaVersion','1.0','operationRef','f2930000-0000-4000-8000-000000000070','installationRef','pika_fixture','subjectRef',held->>'subject_ref','status','erased','absenceVerified',true);
 perform public.record_repolight_subject_erasure_v1(actor,binding,'f2930000-0000-4000-8000-000000000070',receipt);
 if not exists(select 1 from public.assignment_repolight_runs where id=(r->>'id')::uuid) or not exists(select 1 from public.assignment_repolight_reports where run_id=(r->>'id')::uuid) then raise exception 'Remote erasure destroyed portable local facts';end if;
 perform public.read_assignment_repolight_run_v1(actor,assignment,learner,(r->>'id')::uuid,true);
 begin perform public.advance_assignment_repolight_run_v1(actor,assignment,learner,(r->>'id')::uuid,'claim','{}');raise exception 'Closed provider binding resumed';exception when sqlstate '55000' then null;end;
end $behavior$;
reset role;
-- Real original175/288 provider admission with synthetic configuration only.
-- No provider HTTP is called. Both orderings must preserve the old provider and
-- academic authorities; a queued RepoLight subject grants no automatic power.
do $mixed_admission$
declare actor constant uuid:='f2930000-0000-4000-8000-000000000001'; learner constant uuid:='f2930000-0000-4000-8000-000000000002';
 cid constant uuid:='f2950000-0000-4000-8000-000000000010'; gen constant uuid:='f2950000-0000-4000-8000-000000000011'; aid constant uuid:='f2950000-0000-4000-8000-000000000020';
 op constant uuid:='f2950000-0000-4000-8000-000000000050'; remote_op constant uuid:='f2950000-0000-4000-8000-000000000051';
 source jsonb; run jsonb; saved jsonb; children jsonb; pending_binding uuid; historical_binding uuid; original_erasure uuid;
begin
 update private.student_provider_cleanup_settings set enabled=true,live_enabled=true,eligible_after='2026-01-01T00:00:00Z',pal_origin='https://pal.example.invalid',pal_integration_id='f2950000-0000-4000-8000-000000000090',bara_origin='https://bara.example.invalid',installation_ref='pika_mixed_fixture' where singleton;
 update private.removed_student_academic_settings set enabled=true where singleton;
 insert into public.classrooms(id,teacher_id,title,class_code) values(cid,actor,'Synthetic mixed lifecycle','R295FX');
 insert into public.classroom_roster(id,classroom_id,email) values('f2950000-0000-4000-8000-000000000012',cid,'repolight-student@example.invalid');
 insert into public.classroom_enrollments(id,classroom_id,student_id,manual_attendance_marks) values(gen,cid,learner,'{}');
 insert into public.attendance_roster_mappings(classroom_id) values(cid);
 insert into public.attendance_principal_mappings(user_id) values(actor) on conflict do nothing;
 insert into public.attendance_participant_mappings(classroom_id,student_id) values(cid,learner);
 insert into public.assignments(id,classroom_id,title,due_at,created_by,is_draft) values(aid,cid,'Mixed queued subject','2026-10-25T04:00:00Z',actor,false);
 insert into public.assignment_docs(assignment_id,student_id,repo_url) values(aid,learner,'https://github.com/example/mixed');
 source:=public.get_assignment_repolight_source_v1(actor,aid,learner);
 run:=public.begin_assignment_repolight_run_v1(actor,aid,learner,'f2950000-0000-4000-8000-000000000040','{"connectionRef":"fixture","workspaceRef":"fixture_workspace","installationRef":"pika_fixture"}','{"repositoryUrl":"https://github.com/example/mixed","period":{"startAt":"2026-09-01T04:00:00Z","endAt":"2026-10-25T04:00:00Z","timezone":"America/Toronto"},"scheduledProjectDates":null,"baselineReviewed":false,"exclusions":{"commitShas":[],"pathPrefixes":[],"botLogins":[]}}',source->'source');
 pending_binding:=(run->>'subject_binding_id')::uuid;
 perform public.remove_classroom_students_preserving_data(actor,cid,array['f2950000-0000-4000-8000-000000000012'::uuid]);
 -- Atomic automatic preflight: feature enabled is still not new erasure authority.
 begin
  update private.student_provider_cleanup_settings set automatic_enabled=true where singleton;
  begin perform public.reserve_automatic_live_student_cleanup_v1(op,actor,cid,learner,gen);raise exception 'Automatic admission captured unresolved RepoLight subject';exception when sqlstate '55000' then if sqlerrm<>'repolight_manual_cleanup_required' then raise;end if;end;
  if exists(select 1 from public.student_purge_operations where id=op) or exists(select 1 from private.repolight_purge_reservations where operation_id=op) then raise exception 'Automatic denial wrote cleanup state';end if;
  raise exception using errcode='P2931',message='rollback automatic gate';
 exception when sqlstate 'P2931' then null;
 end;
 -- An unrelated old conflict must survive the RepoLight-only exemption.
 begin
  insert into public.classroom_archive_operations(id,teacher_id,classroom_id,operation_type,request_sha256,status,source_revision,source_schema_migration,source_app_commit,retention,snapshot_created_at,snapshot_expires_at,source_contract_version,archive_format_version,restore_contract_version)
  values('f2950000-0000-4000-8000-000000000080',actor,cid,'export',repeat('a',64),'snapshot_ready',1,'293_repolight_report_service','abcdef1234567890','{"mode":"teacher_managed","delete_after":null}',clock_timestamp(),clock_timestamp()+interval '1 hour',2,2,2);
  begin perform public.advance_removed_student_academic_cleanup(op,actor,cid,learner,gen,'live_reserve');raise exception 'Mixed admission bypassed old archive conflict';exception when sqlstate '55000' then if sqlerrm<>'student_provider_operation_conflict' then raise;end if;end;
  if exists(select 1 from public.student_purge_operations where id=op) or exists(select 1 from private.repolight_purge_admissions where transaction_id=txid_current()) then raise exception 'Rejected mixed admission left an operation/capability';end if;
  raise exception using errcode='P2931',message='rollback old blocker';
 exception when sqlstate 'P2931' then null;
 end;
 -- Provider first now atomically owns a RepoLight child snapshot. Its own fence
 -- cannot force a second standalone admission; the operation read is sufficient.
 begin
  insert into private.repolight_subject_bindings(intent_id,teacher_id,classroom_id,assignment_id,student_id,enrollment_id,scope_digest,connection_ref,workspace_ref,installation_ref)
  values('f2950000-0000-4000-8000-000000000041',actor,cid,aid,learner,'f2950000-0000-4000-8000-000000000099',repeat('b',64),'fixture','fixture_workspace','pika_fixture') returning id into historical_binding;
  saved:=public.advance_removed_student_academic_cleanup(op,actor,cid,learner,gen,'live_reserve');
  children:=public.read_repolight_purge_cleanup_subjects_v1(actor,op);
  if saved->>'pal_policy'<>'pika-live-v1' or jsonb_array_length(children)<>1 or children#>>'{0,id}'<>pending_binding::text or children#>>'{0,enrollment_id}'<>gen::text or children#>>'{0,operation_id}' is null then raise exception 'Mixed admission did not capture exact-generation subject';end if;
  if exists(select 1 from private.repolight_purge_subjects where operation_id=op and binding_id=historical_binding) then raise exception 'Mixed admission captured another historical generation';end if;
  saved:=public.advance_removed_student_academic_cleanup(op,actor,cid,learner,gen,'live_reserve');
  if children is distinct from public.read_repolight_purge_cleanup_subjects_v1(actor,op) or not('repolight_erasure_required'=any(private.removed_academic_blockers(op))) then raise exception 'Mixed replay recaptured subjects or lost academic fence';end if;
  if exists(select 1 from private.student_provider_cleanup_bindings where operation_id=op and (pal_receipt is not null or bara_receipt is not null)) then raise exception 'RepoLight admission invented provider receipts';end if;
  raise exception using errcode='P2931',message='rollback provider first';
 exception when sqlstate 'P2931' then null;
 end;
 -- RepoLight-only first remains explicitly scoped; the full original provider
 -- reservation can subsequently join the same persisted erasure identity.
 begin
  saved:=public.reserve_repolight_removed_student_cleanup_v1(remote_op,actor,cid,learner,gen);
  children:=public.read_repolight_decommission_subjects_v1(actor,remote_op);original_erasure:=(children#>>'{0,operation_id}')::uuid;
  saved:=public.advance_removed_student_academic_cleanup(op,actor,cid,learner,gen,'live_reserve');
  children:=public.read_repolight_purge_cleanup_subjects_v1(actor,op);
  if jsonb_array_length(children)<>1 or (children#>>'{0,operation_id}')::uuid is distinct from original_erasure or not exists(select 1 from public.assignment_docs where assignment_id=aid and student_id=learner) then raise exception 'RepoLight-first admission changed erasure identity or academic data';end if;
  raise exception using errcode='P2931',message='rollback RepoLight first';
 exception when sqlstate 'P2931' then null;
 end;
end $mixed_admission$;

rollback;
